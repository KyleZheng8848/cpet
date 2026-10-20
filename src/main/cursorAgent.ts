import { spawn, execFile, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentEvent, AgentStatus, SendPromptPayload } from '../shared/types'
import { applyCursorSkills } from './skills'
import { wrapPromptWithSystem } from '../shared/prompts'
import { parseModelRef } from '../shared/models'
import { getSettings } from './store'
import { detectAllEngines } from './agentDetect'
import { listOpenclawAgents } from './openclawAgent'
import { humanizeAgentError, stripAnsi } from './cliSanitize'
import {
  buildAgentEnvAsync,
  clearCliPathCache,
  refreshAugmentedPath,
  whichBin
} from './cliPath'
import { BaseAgentRunner, RunContext, resolveRunIdentity } from './agent'
import { LineBuffer, appendBounded } from './agent/lineStream'
import { handleCursorLine, isWritableIterableError } from './agent/parse/cursorLine'
import type { CursorLineSink } from './agent/parse/sink'
import { cursorAutonomyArgs } from '../shared/agentAutonomy'

const execFileAsync = promisify(execFile)

/**
 * cursor-agent CLI 的封装：负责定位可执行文件、以 stream-json 模式启动、
 * 把 NDJSON 流规范化成 AgentEvent，并在未安装时提供 mock 回退用于开发。
 */

const CANDIDATE_PATHS = [
  join(homedir(), '.local', 'bin', 'cursor-agent'),
  join(homedir(), '.npm-global', 'bin', 'cursor-agent'),
  '/usr/local/bin/cursor-agent',
  '/opt/homebrew/bin/cursor-agent'
]

function resolveBinPath(): string | undefined {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p
  }
  return undefined
}

async function resolveFromPath(): Promise<string | undefined> {
  return whichBin('cursor-agent')
}

// 缓存 agent 状态，避免每次发送都 spawn which/--version
let statusCache: { at: number; value: AgentStatus } | null = null
/** 热路径勿频繁 detectAllEngines（会拖慢每次发送）。 */
const STATUS_TTL = 60_000

/** 安装/登录后调用，强制下次重新检测。 */
export function clearAgentStatusCache(): void {
  statusCache = null
  clearCliPathCache()
}

function resolveActiveBackend(
  settingsBackend: string | undefined
): AgentStatus['backend'] {
  if (settingsBackend === 'openclaw') return 'openclaw'
  if (settingsBackend === 'codex') return 'codex'
  if (settingsBackend === 'claude-code') return 'claude-code'
  return 'cursor'
}

export async function getAgentStatus(): Promise<AgentStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL) return statusCache.value

  // 换机/新装 CLI 后：合并登录 shell PATH，避免 Dock 启动找不到命令
  await refreshAugmentedPath()

  const defaultCwd = homedir()
  const settings = getSettings()
  const engines = await detectAllEngines()
  const oc = engines.find((e) => e.id === 'openclaw')
  const cursor = engines.find((e) => e.id === 'cursor')
  const binPath = cursor?.binPath ?? resolveBinPath() ?? (await resolveFromPath())
  const backend = resolveActiveBackend(settings.agentBackend)
  const agents = listOpenclawAgents()
  const cursorInstalled = Boolean(cursor?.installed || binPath)
  const anyAgentInstalled = engines.some((e) => e.installed) || cursorInstalled

  const value: AgentStatus = {
    installed: cursorInstalled,
    binPath: cursor?.binPath ?? binPath,
    version: cursor?.version,
    usingMock: !anyAgentInstalled,
    anyAgentInstalled,
    defaultCwd,
    backend,
    engines,
    openclawInstalled: Boolean(oc?.installed),
    openclawBinPath: oc?.binPath,
    openclawVersion: oc?.version,
    openclawAgents: agents,
    openclawAgentId: settings.openclawAgentId || 'main'
  }
  statusCache = { at: Date.now(), value }
  return value
}

type Emit = (event: AgentEvent) => void

// 无实质推进（含工具事件）才视为卡死。沙箱跑脚本可能数分钟无正文。
const IDLE_TIMEOUT = 10 * 60_000
/** 绝对上限：防止真死锁；有活动时由 idle 续命，不会误杀长任务 */
const HARD_TIMEOUT = 60 * 60_000

async function buildSpawnEnv(): Promise<NodeJS.ProcessEnv> {
  return buildAgentEnvAsync()
}

interface ActiveRun {
  ctx: RunContext
  child: ChildProcessByStdio<null, Readable, Readable> | null
  /** 子进程代次：作废旧进程的 stdout/close，防止误重试。 */
  childGen: number
  mockTimer: NodeJS.Timeout | null
  watchdog: NodeJS.Timeout | null
  hardWatchdog: NodeJS.Timeout | null
  lines: LineBuffer
  /** run() 等待子进程真正结束（done/error/abort）。 */
  resolveFinished: () => void
  cleanup?: () => void
}

/** run() 需要知道的两件事：用哪个可执行文件，以及没装时该不该退回 mock 演示流。 */
export interface CursorBinChoice {
  binPath?: string
  installed: boolean
}

export type CursorBinResolver = () => Promise<CursorBinChoice>

/**
 * 默认解析：热路径优先吃候选路径/状态缓存，只有都没命中才做一次全引擎探测。
 * （getAgentStatus 会拉起 store + agentDetect + openclawAgent，且结果依赖本机装了什么，
 * 所以 run() 通过构造参数接收它，测试才能钉死一个 bin 去覆盖 spawn 失败路径。）
 */
async function resolveRunBinDefault(): Promise<CursorBinChoice> {
  const fast =
    resolveBinPath() ||
    (statusCache && Date.now() - statusCache.at < STATUS_TTL
      ? statusCache.value.binPath
      : undefined)
  if (fast) return { binPath: fast, installed: true }
  const status = await getAgentStatus()
  return { binPath: status.binPath, installed: status.installed }
}

export class AgentRunner extends BaseAgentRunner<ActiveRun> {
  constructor(private readonly resolveRunBin: CursorBinResolver = resolveRunBinDefault) {
    super()
  }

  private sink(run: ActiveRun): CursorLineSink {
    return {
      ctx: run.ctx,
      settleDone: (result) => this.settleDone(run, result),
      settleError: (message) => this.settleError(run, message),
      settleAfterStreamBreak: (detail) => this.settleAfterStreamBreak(run, detail),
      keepAlive: () => this.armIdleWatchdog(run)
    }
  }

  /** 杀掉某个 pid 及其进程组（尽量成功）。 */
  private killPid(pid: number, sig: NodeJS.Signals): void {
    try {
      process.kill(-pid, sig)
    } catch {
      // 可能不是组长或已退出
    }
    try {
      process.kill(pid, sig)
    } catch {
      // 已退出
    }
  }

  private clearWatchdog(run: ActiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog)
      run.watchdog = null
    }
    if (run.hardWatchdog) {
      clearTimeout(run.hardWatchdog)
      run.hardWatchdog = null
    }
  }

  /** 仅在有实质推进时重置 idle；乱 stdout 不再无限续命 */
  private armIdleWatchdog(run: ActiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog)
      run.watchdog = null
    }
    run.watchdog = setTimeout(() => {
      if (run.ctx.settled || run.ctx.aborting) return
      // 工具/沙箱仍在跑：再续一程，不要当成完成
      if (run.ctx.hasActiveWork) {
        this.armIdleWatchdog(run)
        return
      }
      if (run.ctx.hasOutput) {
        this.settleDone(run)
        return
      }
      this.settleError(run, 'cursor-agent 长时间无响应，已自动中止。')
    }, IDLE_TIMEOUT)
  }

  private armHardWatchdog(run: ActiveRun): void {
    if (run.hardWatchdog) {
      clearTimeout(run.hardWatchdog)
      run.hardWatchdog = null
    }
    run.hardWatchdog = setTimeout(() => {
      if (run.ctx.settled || run.ctx.aborting) return
      if (run.ctx.hasActiveWork) {
        this.armHardWatchdog(run)
        return
      }
      if (run.ctx.hasOutput) {
        this.settleDone(run)
        return
      }
      this.settleError(run, 'cursor-agent 超过时限未完成，已自动中止。')
    }, HARD_TIMEOUT)
  }

  private settleDone(run: ActiveRun, result?: unknown): void {
    if (run.ctx.settled || run.ctx.aborting) return
    this.clearWatchdog(run)
    run.ctx.done(typeof result === 'string' ? result : undefined)
    this.killChild(run)
    this.drop(run.ctx.runKey)
  }

  private settleError(run: ActiveRun, message: string): void {
    if (run.ctx.settled || run.ctx.aborting) return
    this.clearWatchdog(run)
    run.ctx.error(humanizeAgentError(message, 'cursor'))
    this.killChild(run)
    this.drop(run.ctx.runKey)
  }

  private killChild(run: ActiveRun): void {
    const child = run.child
    const pid = child?.pid ?? null
    run.child = null
    run.childGen += 1
    if (child) {
      try {
        child.stdout.removeAllListeners()
        child.stderr.removeAllListeners()
        child.removeAllListeners()
        child.stdout.destroy()
        child.stderr.destroy()
      } catch {
        // ignore
      }
    }
    if (pid == null) return
    this.killPid(pid, 'SIGTERM')
    setTimeout(() => this.killPid(pid, 'SIGKILL'), 350)
    try {
      child?.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  /**
   * 流中断收尾：若已有助手正文，说明回答其实写完了，应 done 而非 error/重试。
   * （cursor-agent 常见：答案出完后 Bun 报 WritableIterable is closed）
   */
  private settleAfterStreamBreak(run: ActiveRun, detail: string): void {
    if (run.ctx.settled || run.ctx.aborting) return
    // 只有思考、没有 assistant-delta 时也应收尾（否则会一直「生成中」）
    if (run.ctx.hasOutput) {
      this.settleDone(run)
      return
    }
    this.settleError(run, detail)
  }

  private async attachChild(
    run: ActiveRun,
    binPath: string,
    args: string[],
    cwd: string
  ): Promise<void> {
    const gen = run.childGen + 1
    run.childGen = gen
    try {
      const env = await buildSpawnEnv()
      run.child = spawn(binPath, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      })
    } catch (err) {
      // spawn 也会同步抛（参数含 NUL、cwd 非法等）。不兜住的话 run 表永远留着这一条，
      // UI 既收不到终态又会一直报「还有请求在进行中」。
      this.settleError(run, `启动 cursor-agent 失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }
    run.lines = new LineBuffer()
    this.armIdleWatchdog(run)
    this.armHardWatchdog(run)

    let stderr = ''
    const child = run.child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (run.childGen !== gen || run.ctx.aborting || run.ctx.settled) return
      // 不在此处续命 idle：未识别 NDJSON / 重连噪声会拖死 10 分钟
      this.consume(run, chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (run.childGen !== gen) return
      stderr = appendBounded(stderr, chunk)
    })
    child.on('error', (err) => {
      if (run.childGen !== gen || run.ctx.settled || run.ctx.aborting) return
      this.settleError(run, `启动 cursor-agent 失败：${err.message}`)
    })
    child.on('close', (code) => {
      if (run.childGen !== gen) return
      this.clearWatchdog(run)
      if (run.ctx.aborting) {
        this.drop(run.ctx.runKey)
        return
      }
      if (run.ctx.settled) {
        this.drop(run.ctx.runKey)
        return
      }
      for (const tail of run.lines.flush()) {
        const line = tail.trim()
        if (line) this.handleLine(run, line)
      }
      if (run.ctx.settled || run.ctx.aborting) return
      const errText = stderr.trim() || `cursor-agent 退出码 ${code}`
      if (code !== 0 && code !== null) {
        if (isWritableIterableError(errText)) {
          this.settleAfterStreamBreak(run, errText)
          return
        }
        // 已有完整回答时，非 0 退出多半是 CLI 收尾噪声 → 正常结束
        if (run.ctx.hasOutput) {
          this.settleDone(run)
          return
        }
        this.settleError(run, errText)
        return
      }
      this.settleDone(run)
    })
  }

  async run(payload: SendPromptPayload, emit: Emit): Promise<void> {
    const identity = resolveRunIdentity(payload)
    const ctx = new RunContext(identity, emit)

    if (this.runs.has(identity.runKey)) {
      ctx.error('该对话还有请求在进行中，请先等待或取消。')
      return
    }

    let resolveFinished = (): void => {}
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve
    })
    ctx.sessionId = payload.sessionId?.trim() || undefined
    const run: ActiveRun = {
      ctx,
      child: null,
      childGen: 0,
      mockTimer: null,
      watchdog: null,
      hardWatchdog: null,
      lines: new LineBuffer(),
      resolveFinished
    }
    run.cleanup = () => {
      this.clearWatchdog(run)
      if (run.mockTimer) {
        clearTimeout(run.mockTimer)
        run.mockTimer = null
      }
      run.child = null
      run.resolveFinished()
    }
    ctx.setSettleHook(() => this.settleDone(run))
    this.set(identity.runKey, run)

    const choice = await this.resolveRunBin()
    // 异步等待期间可能被取消
    if (!this.runs.has(identity.runKey)) {
      await finished
      return
    }
    const binPath = choice.binPath
    if (!choice.installed || !binPath) {
      this.runMock(run, payload)
      await finished
      return
    }

    // headless：--trust 跳过目录信任提示；任务权限 → --mode / --force。
    // model 支持 cursor:auto 形式，传给 CLI 时只用裸名。
    const modelRef = identity.modelId
    const bareModel = modelRef ? parseModelRef(modelRef).model : undefined
    const prompt = applyCursorSkills(
      emit,
      payload,
      wrapPromptWithSystem(payload.prompt, payload.systemPrompt)
    )
    const modeArgs = cursorAutonomyArgs(payload.agentAutonomy)

    const cwd = payload.cwd?.trim()
    if (!cwd) {
      this.settleError(run, '未设置工作目录，已取消（请选择项目目录后再发）。')
      await finished
      return
    }

    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--workspace',
      cwd,
      ...modeArgs,
      ...(bareModel ? ['--model', bareModel] : []),
      ...(ctx.sessionId ? ['--resume', ctx.sessionId] : []),
      prompt
    ]
    ctx.state('thinking')
    await this.attachChild(run, binPath, args, cwd)
    await finished
  }

  protected cancelOne(runKey: string): void {
    const run = this.get(runKey)
    if (!run) return
    try {
      run.ctx.aborted()
    } catch {
      // ignore
    }
    this.killChild(run)
    this.drop(runKey)
  }

  private consume(run: ActiveRun, chunk: string): void {
    for (const raw of run.lines.push(chunk)) {
      const line = raw.trim()
      if (line) this.handleLine(run, line)
    }
  }

  private handleLine(run: ActiveRun, line: string): void {
    handleCursorLine(this.sink(run), line)
  }

  /** Mock 回退用：与解析层同样的文本清洗规则。 */
  private emitAssistantText(run: ActiveRun, raw: string): void {
    const cleaned = stripAnsi(raw).replace(/\r/g, '')
    if (!cleaned) return
    if (run.ctx.assistant(cleaned, 'delta')) this.armIdleWatchdog(run)
  }

  private emitReasoningText(run: ActiveRun, raw: string): void {
    const text = stripAnsi(String(raw || '')).replace(/\r/g, '')
    if (!text) return
    if (run.ctx.reasoning(text)) this.armIdleWatchdog(run)
  }

  // ------- Mock 回退：cursor-agent 未安装时，模拟一段流式响应 -------
  private runMock(run: ActiveRun, payload: SendPromptPayload): void {
    run.ctx.session('mock-' + Date.now())
    // 演示模式：只走 thinking → 文字说明，绝不伪造 tool/command（避免当成真代理）
    run.ctx.state('thinking')

    const steps: Array<() => void> = []
    const reasoning =
      '【演示模式】本机没有可用的真实引擎，下面是说明文字，不会执行任何命令或改文件。'
    for (const chunk of chunkText(reasoning, 18)) {
      steps.push(() => this.emitReasoningText(run, chunk))
    }
    const modelHint = run.ctx.modelId ? `\n\n（当前选单：\`${run.ctx.modelId}\`）` : ''
    const reply =
      `【演示回复 · 未改文件 · 未跑命令】\n\n` +
      `你说的是：**${payload.prompt}**${modelHint}\n\n` +
      `这不是真实 Agent。要离开演示模式：\n` +
      `- 只装了 Cursor 应用 → 设置里开「IDE 联动」，在 Cursor 里跑 Agent，宠物就会动。\n` +
      `- 想在本窗口派活 → 安装并登录某个引擎 CLI，或配置自定义 API，再点「刷新并同步选单」。\n\n` +
      `Cursor CLI（可选）：\n\`\`\`bash\ncurl https://cursor.com/install -fsS | bash\ncursor-agent login\n\`\`\``
    for (const chunk of chunkText(reply, 28)) {
      steps.push(() => this.emitAssistantText(run, chunk))
    }

    let i = 0
    const tick = (): void => {
      if (!this.runs.has(run.ctx.runKey)) return
      if (i >= steps.length) {
        run.mockTimer = null
        run.ctx.done()
        this.drop(run.ctx.runKey)
        return
      }
      steps[i++]()
      run.mockTimer = setTimeout(tick, 40)
    }
    run.mockTimer = setTimeout(tick, 400)
  }
}

/** 把长文切成大约 size 字的块（按空白优先）。 */
function chunkText(text: string, size: number): string[] {
  if (!text) return []
  if (text.length <= size) return [text]
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + size, text.length)
    if (end < text.length) {
      const slice = text.slice(i, end + 8)
      const sp = slice.search(/[\s\n]/)
      if (sp > 0) end = i + sp + 1
    }
    out.push(text.slice(i, end))
    i = end
  }
  return out
}

import { mergeModelPrefs } from '../shared/models'

/** 解析 `cursor-agent --list-models` 输出。 */
export async function listCursorModels(): Promise<Array<{ id: string; label: string }>> {
  const status = await getAgentStatus()
  const bin = status.binPath ?? resolveBinPath() ?? (await resolveFromPath())
  if (!bin) return []
  try {
    const { stdout } = await execFileAsync(bin, ['--list-models'], {
      timeout: 20_000,
      env: await buildSpawnEnv(),
      maxBuffer: 2 * 1024 * 1024
    })
    const out: Array<{ id: string; label: string }> = []
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^([\w./:-]+)\s+-\s+(.+)$/)
      if (!m) continue
      out.push({ id: m[1], label: m[2].trim() })
    }
    return out
  } catch (err) {
    console.error('[cursor-pet] list-models 失败', err)
    return []
  }
}

export { mergeModelPrefs }
