/**
 * Claude Code `-p --output-format stream-json --include-partial-messages` 的行映射。
 */

import { stripAnsi, stripContentChrome } from '../../cliSanitize'
import { extractRunUsage } from '../usage'
import type { LineSink } from './sink'

export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('')
}

function emitText(
  sink: LineSink,
  text: string,
  mode: 'delta' | 'snapshot' | 'replace' = 'delta'
): void {
  // token 增量禁止 stripContentChrome（会 trim 掉有意义的空白/短片）
  const cleaned = mode === 'delta' ? stripAnsi(text).replace(/\r/g, '') : stripContentChrome(text)
  if (!cleaned && mode === 'delta') return
  if (sink.ctx.assistant(cleaned, mode)) sink.keepAlive()
}

function emitReasoning(sink: LineSink, text: string): void {
  if (sink.ctx.reasoning(String(text || ''))) sink.keepAlive()
}

export function handleClaudeLine(sink: LineSink, line: string): void {
  if (sink.ctx.settled || sink.ctx.aborting) return
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    // stream-json：忽略非 JSON（ANSI/TUI/熊猫标 等）
    return
  }

  const type = obj.type ?? obj.event
  const sessionId = obj.session_id ?? obj.sessionId

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
    sink.ctx.noteUsage(extractRunUsage(obj))
    const msg = obj.error?.message ?? obj.error ?? obj.message ?? 'Claude Code 出错'
    sink.settleError(String(msg))
    return
  }

  switch (type) {
    case 'system':
      if (sessionId) sink.ctx.session(String(sessionId))
      return

    case 'stream_event': {
      const ev = obj.event ?? {}
      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        emitText(sink, String(ev.delta.text))
      } else if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
        emitReasoning(sink, String(ev.delta.thinking))
      }
      return
    }

    case 'assistant': {
      const msg = obj.message ?? obj
      const content = msg.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'text' && block.text) {
            const t = String(block.text)
            // 流式片 / 累计快照都收；用 snapshot 去重避免整包重贴
            if (obj.timestamp_ms != null || obj.partial === true || obj.subtype === 'delta') {
              emitText(sink, t, 'delta')
            } else {
              emitText(sink, t, 'snapshot')
            }
          } else if (block.type === 'thinking' && block.thinking) {
            emitReasoning(sink, String(block.thinking))
          } else if (block.type === 'tool_use') {
            sink.ctx.tool({
              id: block.id ? String(block.id) : undefined,
              name: String(block.name || 'tool'),
              input: block.input ? JSON.stringify(block.input) : undefined,
              status: 'running'
            })
          }
        }
      } else {
        const text = extractTextFromContent(content)
        if (text) {
          if (obj.timestamp_ms != null || obj.partial === true) {
            emitText(sink, text, 'delta')
          } else {
            emitText(sink, text, 'snapshot')
          }
        }
      }
      return
    }

    case 'result': {
      if (sessionId) sink.ctx.session(String(sessionId))
      sink.ctx.noteUsage(extractRunUsage(obj))
      if (obj.is_error) {
        sink.settleError(String(obj.result ?? obj.error ?? '执行出错'))
        return
      }
      const text =
        typeof obj.result === 'string' ? obj.result : extractTextFromContent(obj.result)
      if (text) sink.ctx.ensureFinalText(text)
      sink.settleDone(text || undefined)
      return
    }

    case 'user': {
      const content = obj.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            sink.ctx.tool({
              id: block.tool_use_id ? String(block.tool_use_id) : undefined,
              name: 'tool',
              output:
                typeof block.content === 'string'
                  ? block.content
                  : extractTextFromContent(block.content) || undefined,
              status: block.is_error ? 'error' : 'done'
            })
          }
        }
      }
      return
    }

    default:
      return
  }
}
