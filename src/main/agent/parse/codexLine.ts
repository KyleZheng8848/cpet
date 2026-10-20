/**
 * `codex exec --json` 的行映射。
 */

import { stripAnsi, stripContentChrome } from '../../cliSanitize'
import { extractRunUsage } from '../usage'
import type { LineSink } from './sink'

function emitText(
  sink: LineSink,
  text: string,
  mode: 'delta' | 'snapshot' | 'replace' = 'snapshot'
): void {
  const cleaned = mode === 'delta' ? stripAnsi(text).replace(/\r/g, '') : stripContentChrome(text)
  if (!cleaned) return
  if (sink.ctx.assistant(cleaned, mode)) sink.keepAlive()
}

/** 传输层重试噪声：绝不能当终态错误，否则会在重连中途把窗内对话掐死。 */
export function isTransientCodexErrorMessage(msg: string): boolean {
  const t = msg.trim()
  if (!t) return false
  if (/^Reconnecting\b/i.test(t)) return true
  if (/Falling back from WebSockets/i.test(t)) return true
  if (/retrying|temporary\s+(network|transport)/i.test(t)) return true
  return false
}

function errorMessageOf(obj: any): string {
  return String(obj?.error?.message ?? obj?.error ?? obj?.message ?? 'Codex 出错')
}

export function handleCodexLine(sink: LineSink, line: string): void {
  if (sink.ctx.settled || sink.ctx.aborting) return
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    // stream-json 模式：绝不把非 JSON 当正文（TUI/ANSI 残留）
    return
  }

  const type = obj.type

  const control = sink.ctx.consumeControlEvent(obj)
  if (control === 'settle') {
    sink.settleDone()
    return
  }
  if (control === 'handled') return

  // 兼容简化 content 事件
  if (type === 'content' && typeof obj.content === 'string') {
    emitText(sink, obj.content, 'snapshot')
    return
  }
  if (type === 'error') {
    const msg = errorMessageOf(obj)
    if (isTransientCodexErrorMessage(msg)) {
      sink.keepAlive()
      return
    }
    sink.ctx.noteUsage(extractRunUsage(obj))
    sink.settleError(msg)
    return
  }

  // native codex exec --json
  if (type === 'thread.started' && (obj.thread_id || obj.threadId)) {
    sink.ctx.session(String(obj.thread_id ?? obj.threadId))
    return
  }
  if (type === 'item.completed' || type === 'item.started' || type === 'item.updated') {
    const item = obj.item ?? {}
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      // started/updated 也可能带累计 text；用 snapshot 去重
      emitText(sink, item.text, 'snapshot')
    } else if (item.type === 'reasoning' && typeof item.text === 'string') {
      if (sink.ctx.reasoning(String(item.text))) sink.keepAlive()
    } else if (item.type === 'command_execution') {
      sink.keepAlive()
      sink.ctx.command({
        id: item.id ? String(item.id) : undefined,
        command: String(item.command ?? 'command'),
        output: typeof item.aggregated_output === 'string' ? item.aggregated_output : undefined,
        exitCode: typeof item.exit_code === 'number' ? item.exit_code : undefined,
        status: item.status === 'completed' || type === 'item.completed' ? 'done' : 'running'
      })
    } else if (item.type === 'file_change' || item.type === 'mcp_tool_call') {
      sink.ctx.tool({
        id: item.id ? String(item.id) : undefined,
        name: String(item.type),
        input: item.path || item.command ? String(item.path ?? item.command) : undefined,
        status: type === 'item.completed' ? 'done' : 'running'
      })
    } else if (item.type === 'error') {
      // 传输/工具失败条目：续命等 turn.failed，避免半途掐死
      sink.keepAlive()
    }
    return
  }
  // 部分版本：message / agent_message 顶层字段
  if (
    (type === 'message' || type === 'agent_message') &&
    typeof (obj.text ?? obj.content) === 'string'
  ) {
    emitText(sink, String(obj.text ?? obj.content), 'snapshot')
    return
  }
  if (type === 'turn.failed') {
    sink.ctx.noteUsage(extractRunUsage(obj))
    sink.settleError(String(obj.error?.message ?? obj.message ?? 'Codex 失败'))
    return
  }
  if (type === 'turn.completed') {
    sink.ctx.noteUsage(extractRunUsage(obj))
    const finalMsg =
      typeof obj.last_agent_message === 'string' ? obj.last_agent_message : undefined
    if (finalMsg) sink.ctx.ensureFinalText(stripContentChrome(finalMsg) || finalMsg)
    sink.settleDone(finalMsg || sink.ctx.lastText || undefined)
  }
}
