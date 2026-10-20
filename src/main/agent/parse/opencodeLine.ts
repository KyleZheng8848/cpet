/**
 * `opencode run --format json` 的行映射。
 *
 * 官方 JSONL：step_start / tool_use / text / step_finish / error（及可选 reasoning）。
 * 见 https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/
 */

import { stripAnsi, stripContentChrome } from '../../cliSanitize'
import { extractRunUsage } from '../usage'
import type { LineSink } from './sink'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const MAX_TOOL_TEXT = 600

function clip(s: string): string {
  return s.length > MAX_TOOL_TEXT ? `${s.slice(0, MAX_TOOL_TEXT)}…` : s
}

function toolInputText(input: Record<string, unknown>): string | undefined {
  const pick =
    str(input.command) ??
    str(input.description) ??
    str(input.path) ??
    str(input.filePath) ??
    str(input.file_path) ??
    str(input.pattern) ??
    str(input.query) ??
    str(input.url)
  if (pick) return clip(pick)
  const keys = Object.keys(input).filter((k) => input[k] !== undefined)
  return keys.length ? clip(JSON.stringify(input)) : undefined
}

function emitTool(sink: LineSink, part: Record<string, unknown>): void {
  const state = rec(part.state)
  const statusRaw = str(state.status) ?? 'completed'
  const failed = statusRaw === 'error' || statusRaw === 'failed'
  const status = failed ? 'error' : statusRaw === 'running' || statusRaw === 'pending' ? 'running' : 'done'
  const name = str(part.tool) ?? 'tool'
  const id = str(part.callID) ?? str(part.id)
  const input = rec(state.input)
  const meta = rec(state.metadata)
  const output =
    str(state.output) ??
    str(state.error) ??
    str(meta.output) ??
    (failed ? str(state.title) : undefined)
  const command = str(input.command)
  if (command && (name === 'bash' || name === 'shell' || name === 'exec')) {
    const exitCode = num(meta.exit) ?? num(meta.exit_code)
    sink.ctx.command({
      id,
      command: clip(command),
      output: output ? clip(output) : undefined,
      exitCode: exitCode ?? (failed ? 1 : undefined),
      status
    })
    return
  }
  sink.ctx.tool({
    id,
    name,
    input: str(state.title) ?? toolInputText(input),
    output: output ? clip(output) : undefined,
    status
  })
}

function applyUsage(sink: LineSink, part: Record<string, unknown>): void {
  const tokens = rec(part.tokens)
  sink.ctx.noteUsage(
    extractRunUsage({
      input_tokens: num(tokens.input),
      output_tokens: num(tokens.output),
      inputTokens: num(tokens.input),
      outputTokens: num(tokens.output)
    })
  )
}

/**
 * 解析一行 JSONL。返回 true 表示本行已触发终态（error / 最终 step_finish）。
 * Runner 在进程 close 时仍会 settleDone 兜底。
 */
export function handleOpencodeLine(sink: LineSink, line: string): boolean {
  if (sink.ctx.settled || sink.ctx.aborting) return false
  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object') return false
    obj = parsed as Record<string, unknown>
  } catch {
    return false
  }

  const type = str(obj.type)
  const sessionID = str(obj.sessionID)
  if (sessionID) sink.ctx.session(sessionID)

  if (type === 'step_start') {
    sink.ctx.state('thinking')
    sink.keepAlive()
    return false
  }

  if (type === 'text') {
    const part = rec(obj.part)
    const text = str(part.text)
    if (!text) return false
    // run --format json 的 text 是完整 part，不是 token delta；按增量拼到会话里
    const cleaned = stripContentChrome(stripAnsi(text).replace(/\r/g, ''))
    if (!cleaned) return false
    if (sink.ctx.assistant(cleaned, 'delta')) {
      sink.ctx.state('talking')
      sink.keepAlive()
    }
    return false
  }

  if (type === 'reasoning' || type === 'thinking') {
    const part = rec(obj.part)
    const text = str(part.text) ?? str(obj.text)
    if (!text) return false
    const cleaned = stripAnsi(text).replace(/\r/g, '')
    if (cleaned && sink.ctx.reasoning(cleaned)) sink.keepAlive()
    return false
  }

  if (type === 'tool_use') {
    emitTool(sink, rec(obj.part))
    sink.keepAlive()
    return false
  }

  if (type === 'step_finish') {
    const part = rec(obj.part)
    applyUsage(sink, part)
    const reason = str(part.reason)
    // tool-calls = 中间步，继续等；stop / 缺省 = 本轮结束
    if (reason === 'tool-calls') {
      sink.ctx.state('thinking')
      sink.keepAlive()
      return false
    }
    // 与其它引擎对齐：终局走 ensureFinalText，避免已封口时丢掉最后一段正文
    const finalText = sink.ctx.lastText || undefined
    if (finalText) sink.ctx.ensureFinalText(finalText)
    sink.settleDone(finalText)
    return true
  }

  if (type === 'error') {
    const err = rec(obj.error)
    const data = rec(err.data)
    const message =
      str(data.message) ?? str(err.message) ?? str(obj.message) ?? 'OpenCode 运行失败'
    sink.settleError(message)
    return true
  }

  return false
}
