import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { AgentEvent, SendPromptPayload } from '../shared/types'
import { applySkillsForEngine } from './skills'
import { wrapPromptWithSystem } from '../shared/prompts'
import { parseModelRef } from '../shared/models'
import { cleanCliLine, humanizeAgentError } from './cliSanitize'
import { buildAgentEnvAsync } from './cliPath'
import { BaseAgentRunner, RunContext, resolveRunIdentity } from './agent'
import { LineBuffer, appendBounded } from './agent/lineStream'
import { handleCodexLine } from './agent/parse/codexLine'
import type { LineSink } from './agent/parse/sink'
import { buildCodexExecArgv, isCodexResumableSessionId } from '../shared/agentAutonomy'
import { nativeVisionPaths } from '../shared/multimodal'
import { isForeignCodexModelId } from '../shared/models'
import { resolveCodexBin } from './codexBin'

export { resolveCodexBin } from './codexBin'

/**
 * 窗内 `codex:` = OpenAI / ChatGPT Codex（ChatGPT.app 内嵌 CLI）。
 */

const IDLE_TIMEOUT = 10 * 60_000

type Emit = (event: AgentEvent) => void

interface ActiveRun {
  ctx: RunContext
  child: ChildProcessByStdio<null, Readable, Readable> | null
  lines: LineBuffer
  watchdog: NodeJS.Timeout | null
  mode: 'native'
  cleanup?: () => void
}

export class CodexRunner extends BaseAgentRunner<ActiveRun> {
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
      run.ctx.error('Codex 长时间无响应，已自动中止。')
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
    run.ctx.error(humanizeAgentError(message, 'codex'))
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
      watchdog: null,
      mode: 'native'
    }
    run.cleanup = () => {
      this.clearWatchdog(run)
      run.child = null
    }
    ctx.setSettleHook(() => this.settleDone(run))
    this.set(identity.runKey, run)

    const modelRef = identity.modelId
    const parsedModel = modelRef ? parseModelRef(modelRef).model : undefined
    // 非 OpenAI 模型残留在选单时不传 --model，避免 CLI 请求不支持的模型
    const bareModel =
      parsedModel && parsedModel !== 'default' && !isForeignCodexModelId(parsedModel)
        ? parsedModel
        : undefined
    const withSkills = applySkillsForEngine(emit, payload, 'codex')
    const prompt = wrapPromptWithSystem(withSkills.prompt, withSkills.systemPrompt)
    const cwd = payload.cwd?.trim()
    if (!cwd) {
      this.settleError(run, '未设置工作目录，已取消（请选择项目目录后再发）。')
      return
    }
    const env = await buildAgentEnvAsync()

    const native = await resolveCodexBin()
    if (!native) {
      this.settleError(
        run,
        '未检测到 ChatGPT / OpenAI Codex。请安装 ChatGPT.app（自带 CLI），或 `npm i -g @openai/codex`。'
      )
      return
    }

    ctx.state('thinking')

    // 假 session（换模型残留）宁开新线程，也不要去 exec resume 撞 CLI 参数错误
    const resumeSession = isCodexResumableSessionId(payload.sessionId)
      ? payload.sessionId
      : undefined

    run.mode = 'native'
    const bin = native
    // `--ask-for-approval` 必须在 `exec` 前；`--sandbox` 必须在 `resume` 前
    const args = buildCodexExecArgv({
      autonomy: payload.agentAutonomy,
      prompt,
      sessionId: resumeSession,
      model: bareModel,
      images: nativeVisionPaths(payload.attachments)
    })

    try {
      run.child = spawn(bin, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      })
    } catch (err) {
      // spawn 同步抛时若不兜住，run 表会永远留着这一条：UI 收不到终态，也无法再发。
      this.settleError(run, `启动 Codex 失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }

    this.armWatchdog(run)

    let stderr = ''
    run.child.stdout.setEncoding('utf8')
    run.child.stdout.on('data', (chunk: string) => {
      if (run.ctx.aborting || run.ctx.settled) return
      // 不在任意 chunk 上续命；实质事件路径里再 armWatchdog
      this.consume(run, chunk)
    })
    run.child.stderr.setEncoding('utf8')
    run.child.stderr.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk)
    })

    run.child.on('error', (err) => {
      this.settleError(run, `启动 Codex 失败：${err.message}`)
    })

    run.child.on('close', (code) => {
      if (run.ctx.aborting) {
        this.drop(identity.runKey)
        return
      }
      this.flushTail(run)
      if (run.ctx.settled) return
      // 必须有助手正文；仅有思考/用量不算成功（否则对比列空气泡 + tok）
      if (!run.ctx.sawAssistant && !run.ctx.lastText.trim()) {
        const detail = cleanCliLine(stderr) || stderr.trim() || (code ? `Codex 退出码 ${code}` : '')
        this.settleError(run, detail || 'Codex 未返回可见内容。')
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
      if (line) handleCodexLine(this.sink(run), line)
    }
  }

  /** 进程退出：补掉最后一段没有换行收尾的输出。 */
  private flushTail(run: ActiveRun): void {
    for (const raw of run.lines.flush()) {
      const line = cleanCliLine(raw)
      if (line) handleCodexLine(this.sink(run), line)
    }
  }
}
