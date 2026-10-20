/**
 * cursor-agent `--output-format stream-json` 的行映射。
 * 字段结构以实测为准，同时对版本差异做了一定容错。
 */

import { stripAnsi, stripContentChrome } from '../../cliSanitize'
import { extractRunUsage } from '../usage'
import type { CursorLineSink } from './sink'

/** 流被提前关掉的噪声错误（答案往往其实已经写完）。 */
export function isWritableIterableError(text: string): boolean {
  return /WritableIterable\s+is\s+closed/i.test(text)
}

const TOOL_NAME_MAP: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  ls: '列目录',
  glob: '查找文件',
  grep: '搜索内容',
  codebaseSearch: '语义检索',
  semanticSearch: '语义检索',
  deleteFile: '删除文件',
  fetch: '抓取网页',
  webSearch: '联网搜索',
  todoWrite: '更新任务'
}

export function prettyToolName(name: string): string {
  return TOOL_NAME_MAP[name] ? `${TOOL_NAME_MAP[name]} · ${name}` : name
}

function stringify(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** 把工具参数压成简短可读的一行/多行说明。 */
function describeArgs(args: any): string | undefined {
  if (!args || typeof args !== 'object') return stringify(args)
  const primary = args.path ?? args.file ?? args.query ?? args.pattern ?? args.url
  if (primary && Object.keys(args).length <= 2) return String(primary)
  return stringify(args)
}

/** 从各种可能的消息结构里提取纯文本。 */
export function extractText(obj: any): string {
  if (typeof obj?.text === 'string') return obj.text
  if (typeof obj?.delta === 'string') return obj.delta
  const message = obj?.message ?? obj?.delta ?? obj
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('')
  }
  return ''
}

/**
 * 流式助手帧：与旧版一致优先 timestamp_ms && !model_call_id；
 * 并兼容 partial / subtype=delta（缺 timestamp 的 CLI）。
 */
export function isAssistantStreamEvent(obj: any): boolean {
  if (obj?.model_call_id != null && obj?.partial !== true) return false
  if (obj?.timestamp_ms != null) return true
  if (obj?.partial === true) return true
  if (obj?.subtype === 'delta' || obj?.subtype === 'partial') return true
  if (typeof obj?.delta === 'string' && obj.delta) return true
  if (typeof obj?.text === 'string' && obj.text && !obj?.message) return true
  return false
}

/**
 * 把 CLI 文本变成真增量发给 UI。
 * - delta：--stream-partial-output 单片（常带前导空格）；禁止 trim，禁止丢大块
 * - snapshot：result / 完整回放；只补尚未发出的后缀，绝不整段重播
 */
function emitAssistantText(
  sink: CursorLineSink,
  raw: string,
  mode: 'delta' | 'snapshot' = 'delta'
): void {
  const cleaned = mode === 'delta' ? stripAnsi(raw).replace(/\r/g, '') : stripContentChrome(raw)
  if (!cleaned) return
  if (sink.ctx.assistant(cleaned, mode)) sink.keepAlive()
}

function emitReasoningText(sink: CursorLineSink, raw: string): void {
  const text = stripAnsi(String(raw || '')).replace(/\r/g, '')
  if (!text) return
  if (sink.ctx.reasoning(text)) sink.keepAlive()
}

/**
 * tool_call 事件结构：
 * { type:'tool_call', subtype:'started'|'completed', call_id, tool_call:{ <name>ToolCall:{ args, result } } }
 * 工具名是 tool_call 里以 "ToolCall" 结尾的键，参数/结果嵌在其中。
 */
function handleToolCall(sink: CursorLineSink, obj: any): void {
  const tc = obj.tool_call ?? {}
  const key = Object.keys(tc).find((k) => k.endsWith('ToolCall'))
  if (!key) return

  const inner = tc[key] ?? {}
  const name = key.replace(/ToolCall$/, '')
  const callId: string | undefined = obj.call_id ?? inner.toolCallId
  const completed = obj.subtype === 'completed'
  const args = inner.args ?? {}
  const resultVal = inner.result

  let status: 'running' | 'done' | 'error' = completed ? 'done' : 'running'
  let output: string | undefined
  let exitCode: number | undefined
  if (resultVal) {
    const succ = resultVal.success ?? resultVal.result ?? resultVal
    if (resultVal.error || resultVal.failure) status = 'error'
    exitCode = succ?.exitCode ?? succ?.exit_code ?? resultVal.error?.exitCode
    output =
      succ?.content ??
      succ?.output ??
      succ?.stdout ??
      (resultVal.error ? stringify(resultVal.error) : stringify(succ))
  }

  if (/terminal|command|shell|bash/i.test(key)) {
    const command = args.command ?? args.cmd ?? stringify(args) ?? name
    sink.ctx.command({ id: callId, command: String(command), output, exitCode, status })
    sink.keepAlive()
    return
  }

  sink.ctx.tool({
    id: callId,
    name: prettyToolName(name),
    input: describeArgs(args),
    output,
    status
  })
  sink.keepAlive()
}

/** 解析 cursor-agent 的 stream-json 行。 */
export function handleCursorLine(sink: CursorLineSink, line: string): void {
  if (sink.ctx.settled || sink.ctx.aborting) return
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return
  }

  const type = obj.type ?? obj.event
  const sessionId = obj.session_id ?? obj.sessionId ?? obj.chat_id ?? obj.chatId

  const control = sink.ctx.consumeControlEvent(obj)
  if (control === 'settle') {
    sink.settleDone()
    return
  }
  if (control === 'handled') return

  switch (type) {
    case 'system':
      if (sessionId) sink.ctx.session(String(sessionId))
      return

    case 'user':
      return

    case 'assistant': {
      if (!isAssistantStreamEvent(obj)) return
      const text = extractText(obj)
      if (!text) return
      if (isWritableIterableError(text)) {
        const cleaned = stripContentChrome(
          text
            .replace(/\n?Error:\s*T?:\s*WritableIterable\s+is\s+closed/gi, '')
            .replace(/\n?RetriableError:\s*WritableIterable\s+is\s+closed/gi, '')
            .trim()
        )
        if (cleaned) emitAssistantText(sink, cleaned)
        sink.settleAfterStreamBreak('WritableIterable is closed')
        return
      }
      emitAssistantText(sink, text)
      return
    }

    case 'thinking': {
      const t = typeof obj.text === 'string' ? obj.text : ''
      if (!t) return
      emitReasoningText(sink, t)
      return
    }

    case 'tool_call':
      handleToolCall(sink, obj)
      return

    case 'result':
      sink.ctx.noteUsage(extractRunUsage(obj))
      if (obj.is_error) {
        const msg = String(obj.result ?? '执行出错')
        if (isWritableIterableError(msg)) sink.settleAfterStreamBreak(msg)
        else sink.settleError(msg)
      } else {
        // result 是权威终局正文；勿因 contentSealed / 非前缀快照失败而丢掉
        const text = typeof obj.result === 'string' ? obj.result : extractText(obj.result)
        if (text) {
          const cleaned = stripContentChrome(text)
          if (cleaned) sink.ctx.ensureFinalText(cleaned)
        }
        sink.settleDone(text || undefined)
      }
      return

    case 'error': {
      sink.ctx.noteUsage(extractRunUsage(obj))
      const msg = String(obj.message ?? obj.error ?? '未知错误')
      if (isWritableIterableError(msg)) sink.settleAfterStreamBreak(msg)
      else sink.settleError(msg)
      return
    }

    default:
      return
  }
}
