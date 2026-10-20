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
import { handleClaudeLine } from './agent/parse/claudeLine'
import type { LineSink } from './agent/parse/sink'
import { claudeAutonomyArgs } from '../shared/agentAutonomy'

/**
 * Claude Code CLI：`claude -p --output-format stream-json`。
 */

const CLAUDE_CANDIDATES = [
  join(homedir(), '.local', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude'
]

const IDLE_TIMEOUT = 10 * 60_000

type Emit = (event: AgentEvent) => void

interface ActiveRun {
  ctx: RunContext
  child: ChildProcessByStdio<null, Readable, Readable> | null
  lines: LineBuffer
  watchdog: NodeJS.Timeout | null
  cleanup?: () => void
}

async function buildSpawnEnv(): Promise<NodeJS.ProcessEnv> {
  return buildAgentEnvAsync()
}

export async function resolveClaudeBin(): Promise<string | undefined> {
  for (const p of CLAUDE_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return whichBin('claude')
}

export class ClaudeCodeRunner extends BaseAgentRunner<ActiveRun> {
  private sink(run: ActiveRun): LineSink {
    return {
      ctx: run.ctx,
      settleDone: (result) => this.settleDone(run, result),
      settleError: (message) => this.settleError(run, message),
      keepAlive: () => this.armWatchdog(run)
    }
  }

  private killPid(pid: number, sig: NodeJS.Signals): void {
    try {
      process.kill(-pid, sig)
    } catch {
      // ignore
    }
    try {
      process.kill(pid, sig)
    } catch {
      // ignore
    }
  }

  private clearWatchdog(run: ActiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog)
      run.watchdog = null
    }
  }

  private armWatchdog(run: ActiveRun): void {
    this.clearWatchdog(run)
    run.watchdog = setTimeout(() => {
      if (run.ctx.settled) return
      run.ctx.error('Claude Code 长时间无响应，已自动中止。')
      run.ctx.aborting = true
      const pid = run.child?.pid
      if (pid != null) this.killPid(pid, 'SIGKILL')
      this.drop(run.ctx.runKey)
    }, IDLE_TIMEOUT)
  }

  private settleDone(run: ActiveRun, result?: string): void {
    if (run.ctx.settled || run.ctx.aborting) return
    this.clearWatchdog(run)
    run.ctx.done(result)
    this.drop(run.ctx.runKey)
  }

  private settleError(run: ActiveRun, message: string): void {
    if (run.ctx.settled || run.ctx.aborting) return
    this.clearWatchdog(run)
    run.ctx.error(humanizeAgentError(message, 'claude-code'))
    this.drop(run.ctx.runKey)
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
      watchdog: null
    }
    run.cleanup = () => {
      this.clearWatchdog(run)
      run.child = null
    }
    ctx.setSettleHook(() => this.settleDone(run))
    this.set(identity.runKey, run)

    const modelRef = identity.modelId
    const bareModel = modelRef ? parseModelRef(modelRef).model : undefined
    const withSkills = applySkillsForEngine(emit, payload, 'claude-code')
    const prompt = wrapPromptWithSystem(withSkills.prompt, withSkills.systemPrompt)
    const cwd = payload.cwd?.trim()
    if (!cwd) {
      this.settleError(run, '未设置工作目录，已取消（请选择项目目录后再发）。')
      return
    }

    const native = await resolveClaudeBin()
    if (!native) {
      this.settleError(
        run,
        '未检测到 Claude Code。请安装 `@anthropic-ai/claude-code` CLI。'
      )
      return
    }

    ctx.state('thinking')

    const bin = native
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...claudeAutonomyArgs(payload.agentAutonomy),
      ...(bareModel && bareModel !== 'default' && bareModel !== 'auto' ? ['--model', bareModel] : []),
      ...(payload.sessionId ? ['--resume', payload.sessionId] : [])
    ]
    try {
      run.child = spawn(bin, args, {
        cwd,
        env: await buildSpawnEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      })
    } catch (err) {
      // spawn 同步抛时若不兜住，run 表会永远留着这一条：UI 收不到终态，也无法再发。
      this.settleError(
        run,
        `启动 Claude Code 失败：${err instanceof Error ? err.message : String(err)}`
      )
      return
    }

    this.armWatchdog(run)

    let stderr = ''
    run.child.stdout.setEncoding('utf8')
    run.child.stdout.on('data', (chunk: string) => {
      if (run.ctx.aborting || run.ctx.settled) return
      // 不在任意 chunk 上续命（TUI/噪声会拖成假死）；有解析到的实质事件时再续
      this.consume(run, chunk)
    })
    run.child.stderr.setEncoding('utf8')
    run.child.stderr.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk)
    })

    run.child.on('error', (err) => {
      this.settleError(run, `启动 Claude Code 失败：${err.message}`)
    })

    run.child.on('close', (code) => {
      if (run.ctx.aborting) {
        this.drop(identity.runKey)
        return
      }
      this.flushTail(run)
      if (run.ctx.settled) return
      if (code !== 0 && code !== null && !run.ctx.hasOutput) {
        const detail = stderr.trim() || `Claude Code 退出码 ${code}`
        this.settleError(run, detail)
        return
      }
      this.settleDone(run)
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
      if (line) handleClaudeLine(this.sink(run), line)
    }
  }

  /** 进程退出：补掉最后一段没有换行收尾的输出。 */
  private flushTail(run: ActiveRun): void {
    for (const raw of run.lines.flush()) {
      const line = cleanCliLine(raw)
      if (line) handleClaudeLine(this.sink(run), line)
    }
  }
}
