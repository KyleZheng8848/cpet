/**
 * OpenCode：`opencode run --format json` 非交互跑一轮 + JSONL 事件流。
 *
 * - 自定义 API：把 CPET settings 里 kind=custom 的提供商塞进 OPENCODE_CONFIG_CONTENT
 * - 自治：agent → --auto；plan → --agent plan；ask → 只读权限（禁 edit/bash，避免 headless 挂死）
 * - 二进制：安装包 resources/opencode → ~/.opencode/bin → PATH
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent, SendPromptPayload } from '../shared/types'
import { applySkillsForEngine } from './skills'
import { wrapPromptWithSystem } from '../shared/prompts'
import { parseModelRef } from '../shared/models'
import { cleanCliLine, humanizeAgentError } from './cliSanitize'
import { buildAgentEnvAsync, whichBin } from './cliPath'
import { BaseAgentRunner, RunContext, resolveRunIdentity } from './agent'
import { LineBuffer, appendBounded } from './agent/lineStream'
import { handleOpencodeLine } from './agent/parse/opencodeLine'
import { extractOpencodeFatalError } from './agent/parse/opencodeStderr'
import type { LineSink } from './agent/parse/sink'
import { opencodeAutonomyArgs, opencodePermissionEnv } from '../shared/agentAutonomy'
import { buildOpencodeConfigContent } from '../shared/opencodeInject'
import { getSettings } from './store'

export { extractOpencodeFatalError } from './agent/parse/opencodeStderr'

export {
  buildOpencodeConfigContent,
  cpetOpencodeProviderId,
  listCpetOpencodeCatalogModels
} from '../shared/opencodeInject'

/** 全程 idle：有 JSONL 活动会续命 */
const IDLE_TIMEOUT = 10 * 60_000
/**
 * 首包超时：OpenCode 在自定义 API 失败时会静默重试且不写 JSONL（默认也不打 stderr），
 * 若一直等 10 分钟 idle，UI 会假死在「思考中」。
 */
const FIRST_EVENT_TIMEOUT = 55_000

type Emit = (event: AgentEvent) => void

interface ActiveRun {
  ctx: RunContext
  child: ChildProcessByStdio<null, Readable, Readable> | null
  lines: LineBuffer
  watchdog: NodeJS.Timeout | null
  firstEventWatchdog: NodeJS.Timeout | null
  /** 已收到任意可解析 JSONL */
  sawStreamEvent?: boolean
  cleanup?: () => void
  /** step_finish(stop) 已 settle 时，close 不再二次报错 */
  finishedByEvent?: boolean
}

function firstExisting(paths: Array<string | undefined>): string | undefined {
  for (const p of paths) {
    if (p && existsSync(p)) return p
  }
  return undefined
}

/** 安装包内随附二进制（四端打包时放到 resources/opencode/）。 */
export function bundledOpencodeBin(): string | undefined {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  // electron 开发态 / vitest 没有可信的打包资源目录
  if (!resources || process.env.VITEST || process.defaultApp) return undefined
  const name = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
  return firstExisting([join(resources, 'opencode', name)])
}

export async function resolveOpencodeBin(): Promise<string | undefined> {
  return (
    bundledOpencodeBin() ??
    firstExisting([
      join(homedir(), '.opencode', 'bin', 'opencode'),
      join(homedir(), '.local', 'bin', 'opencode'),
      '/opt/homebrew/bin/opencode',
      '/usr/local/bin/opencode',
      process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'opencode', 'opencode.exe') : undefined
    ]) ??
    (await whichBin('opencode'))
  )
}

export async function getOpencodeMeta(): Promise<{
  installed: boolean
  binPath?: string
  note?: string
}> {
  const binPath = await resolveOpencodeBin()
  if (!binPath) {
    return {
      installed: false,
      note: '未检测到 opencode（curl -fsSL https://opencode.ai/install | bash）'
    }
  }
  const bundled = bundledOpencodeBin()
  return {
    installed: true,
    binPath,
    note: bundled && binPath === bundled ? '已就绪（安装包内置）' : '已就绪'
  }
}

async function buildOpencodeEnv(payload: SendPromptPayload): Promise<NodeJS.ProcessEnv> {
  const base = await buildAgentEnvAsync()
  const settings = getSettings()
  const customs = (settings.modelProviders ?? []).filter((p) => p.kind === 'custom')
  const configContent = buildOpencodeConfigContent(customs)
  const perm = opencodePermissionEnv(payload.agentAutonomy)
  return {
    ...base,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_CLIENT: 'cpet',
    ...(configContent ? { OPENCODE_CONFIG_CONTENT: configContent } : {}),
    ...(perm ? { OPENCODE_PERMISSION: perm } : {})
  }
}

export class OpencodeRunner extends BaseAgentRunner<ActiveRun> {
  private sink(run: ActiveRun): LineSink {
    return {
      ctx: run.ctx,
      settleDone: (result) => this.settleDone(run, result),
      settleError: (message) => this.settleError(run, message),
      keepAlive: () => this.armWatchdog(run)
    }
  }

  private clearWatchdog(run: ActiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog)
      run.watchdog = null
    }
    if (run.firstEventWatchdog) {
      clearTimeout(run.firstEventWatchdog)
      run.firstEventWatchdog = null
    }
  }

  private armWatchdog(run: ActiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog)
      run.watchdog = null
    }
    run.watchdog = setTimeout(() => {
      if (run.ctx.settled || run.ctx.aborting) return
      const pid = run.child?.pid
      if (pid != null) this.killPid(pid, 'SIGKILL')
      this.settleError(run, 'OpenCode 长时间无响应，已取消。')
    }, IDLE_TIMEOUT)
  }

  private armFirstEventWatchdog(run: ActiveRun): void {
    if (run.firstEventWatchdog) {
      clearTimeout(run.firstEventWatchdog)
      run.firstEventWatchdog = null
    }
    run.firstEventWatchdog = setTimeout(() => {
      if (run.ctx.settled || run.ctx.aborting || run.sawStreamEvent) return
      const pid = run.child?.pid
      if (pid != null) this.killPid(pid, 'SIGKILL')
      this.settleError(
        run,
        'OpenCode 一直没有返回事件。常见原因：自定义 API 地址/Key 不可用、模型 id 不对，或网关卡住。请到设置检查提供商后重试。'
      )
    }, FIRST_EVENT_TIMEOUT)
  }

  private markStreamEvent(run: ActiveRun): void {
    if (!run.sawStreamEvent) {
      run.sawStreamEvent = true
      if (run.firstEventWatchdog) {
        clearTimeout(run.firstEventWatchdog)
        run.firstEventWatchdog = null
      }
    }
    this.armWatchdog(run)
  }

  private settleDone(run: ActiveRun, result?: string): void {
    if (run.ctx.settled || run.ctx.aborting) return
    run.finishedByEvent = true
    this.clearWatchdog(run)
    run.ctx.done(result)
    this.drop(run.ctx.runKey)
  }

  private settleError(run: ActiveRun, message: string): void {
    if (run.ctx.settled || run.ctx.aborting) return
    run.finishedByEvent = true
    this.clearWatchdog(run)
    run.ctx.error(humanizeAgentError(message, 'opencode'))
    this.drop(run.ctx.runKey)
  }

  private noteStderr(run: ActiveRun, chunk: string, stderrAcc: { value: string }): void {
    stderrAcc.value = appendBounded(stderrAcc.value, chunk)
    const fatal = extractOpencodeFatalError(stderrAcc.value)
    if (!fatal || run.ctx.settled || run.ctx.aborting) return
    const pid = run.child?.pid
    if (pid != null) this.killPid(pid, 'SIGTERM')
    this.settleError(run, fatal)
  }

  private killPid(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal)
    } catch {
      try {
        process.kill(pid, signal)
      } catch {
        // ignore
      }
    }
  }

  async run(payload: SendPromptPayload, emit: Emit): Promise<void> {
    const identity = resolveRunIdentity(payload)
    const ctx = new RunContext(identity, emit)

    if (this.runs.has(identity.runKey)) {
      ctx.error('该对话还有请求在进行中，请先等待或取消。')
      return
    }

    const run: ActiveRun = {
      ctx,
      child: null,
      lines: new LineBuffer(),
      watchdog: null,
      firstEventWatchdog: null
    }
    run.cleanup = () => {
      this.clearWatchdog(run)
      run.child = null
    }
    ctx.setSettleHook(() => this.settleDone(run))
    this.set(identity.runKey, run)

    const bareModel = identity.modelId ? parseModelRef(identity.modelId).model : undefined
    const withSkills = applySkillsForEngine(emit, payload, 'opencode')
    const prompt = wrapPromptWithSystem(withSkills.prompt, withSkills.systemPrompt)
    const cwd = payload.cwd?.trim()
    if (!cwd) {
      this.settleError(run, '未设置工作目录，已取消（请选择项目目录后再发）。')
      return
    }

    const bin = await resolveOpencodeBin()
    if (!bin) {
      this.settleError(
        run,
        '未检测到 OpenCode。请执行：curl -fsSL https://opencode.ai/install | bash'
      )
      return
    }

    const env = await buildOpencodeEnv(payload)
    ctx.state('thinking')

    const args = [
      'run',
      '--format',
      'json',
      // API 失败时默认不写 JSONL；打开日志才能从 stderr 立刻 fail-closed
      '--print-logs',
      '--log-level',
      'ERROR',
      '--dir',
      cwd,
      ...opencodeAutonomyArgs(payload.agentAutonomy),
      ...(bareModel && bareModel !== 'default' && bareModel !== 'auto'
        ? ['--model', bareModel]
        : []),
      ...(payload.sessionId?.trim() ? ['--session', payload.sessionId.trim()] : []),
      ...(payload.enableThinking ? ['--thinking'] : []),
      prompt
    ]

    try {
      run.child = spawn(bin, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      })
    } catch (err) {
      this.settleError(
        run,
        `启动 OpenCode 失败：${err instanceof Error ? err.message : String(err)}`
      )
      return
    }

    this.armWatchdog(run)
    this.armFirstEventWatchdog(run)

    const stderrAcc = { value: '' }
    run.child.stdout.setEncoding('utf8')
    run.child.stdout.on('data', (chunk: string) => {
      if (run.ctx.aborting || run.ctx.settled) return
      this.consume(run, chunk)
    })
    run.child.stderr.setEncoding('utf8')
    run.child.stderr.on('data', (chunk: string) => {
      if (run.ctx.aborting || run.ctx.settled) return
      this.noteStderr(run, chunk, stderrAcc)
    })

    run.child.on('error', (err) => {
      this.settleError(run, `启动 OpenCode 失败：${err.message}`)
    })

    run.child.on('close', (code) => {
      if (run.ctx.aborting) {
        this.drop(identity.runKey)
        return
      }
      this.flushTail(run)
      if (run.ctx.settled || run.finishedByEvent) return
      if (!run.ctx.sawAssistant && !run.ctx.lastText.trim()) {
        const fatal = extractOpencodeFatalError(stderrAcc.value)
        const detail =
          fatal ||
          cleanCliLine(stderrAcc.value) ||
          stderrAcc.value.trim() ||
          (code ? `OpenCode 退出码 ${code}` : '')
        this.settleError(run, detail || 'OpenCode 未返回可见内容。')
        return
      }
      this.settleDone(run, run.ctx.lastText || undefined)
    })
  }

  protected cancelOne(runKey: string): void {
    const run = this.get(runKey)
    if (!run) return
    this.clearWatchdog(run)
    try {
      run.ctx.aborted()
    } catch {
      // ignore
    }
    const child = run.child
    const pid = child?.pid ?? null
    if (pid != null) {
      this.killPid(pid, 'SIGTERM')
      setTimeout(() => this.killPid(pid, 'SIGKILL'), 350)
      try {
        child?.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
    run.child = null
    this.runs.delete(runKey)
  }

  private consume(run: ActiveRun, chunk: string): void {
    for (const raw of run.lines.push(chunk)) {
      const line = cleanCliLine(raw)
      if (!line) continue
      // 任意可解析 JSON 行都算首包（含 step_start），避免 API 慢但仍在流时被误杀
      try {
        JSON.parse(line)
        this.markStreamEvent(run)
      } catch {
        // 非 JSON 忽略
      }
      handleOpencodeLine(this.sink(run), line)
    }
  }

  private flushTail(run: ActiveRun): void {
    for (const raw of run.lines.flush()) {
      const line = cleanCliLine(raw)
      if (!line) continue
      try {
        JSON.parse(line)
        this.markStreamEvent(run)
      } catch {
        // ignore
      }
      handleOpencodeLine(this.sink(run), line)
    }
  }
}
