/**
 * OpenClaw Gateway 写的 session jsonl（transcript）解析。
 *
 * CLI 的 `--json` 只在最后给一坨结果，过程里的 thinking / toolCall / 流式正文
 * 只能靠轮询这个 jsonl 拿到。文件是按字节偏移增量读的，所以解码必须跨读取边界，
 * 否则一个被切开的中文字会变成 U+FFFD，既糊了正文，又让按长度累计的偏移错位。
 */

import { LineBuffer } from '../lineStream'
import type { RunContext } from '../runContext'

export function textFromContentParts(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = part as { type?: string; text?: unknown }
      return typeof p.text === 'string' ? p.text : ''
    })
    .filter(Boolean)
    .join('')
}

export function describeOpenclawArgs(args: unknown): string | undefined {
  if (args == null) return undefined
  if (typeof args === 'string') return args
  if (typeof args !== 'object') return String(args)
  const obj = args as Record<string, unknown>
  const primary =
    obj.path ?? obj.file ?? obj.query ?? obj.pattern ?? obj.url ?? obj.command ?? obj.cmd
  if (primary != null && Object.keys(obj).length <= 2) return String(primary)
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

export function prettyOpenclawTool(name: string): string {
  const map: Record<string, string> = {
    read: '读取文件',
    write: '写入文件',
    edit: '编辑文件',
    exec: '执行命令',
    process: '进程',
    bash: 'Shell',
    web_search: '联网搜索',
    web_fetch: '抓取网页',
    memory_search: '记忆搜索',
    memory_get: '读取记忆'
  }
  return map[name] ? `${map[name]} · ${name}` : name
}

const SHELL_TOOL = /^(exec|bash|shell|process)$/i

export class OpenclawTranscriptReader {
  private lines = new LineBuffer()
  /** 冷启动：整文件里只认「最后一条 user」之后，避免历史 tool 刷屏。 */
  private bootstrapped = false
  private turnReady = false
  private seq = 0
  private readonly seenToolIds = new Set<string>()
  private readonly thinkingOffset = new Map<string, number>()
  private readonly textOffset = new Map<string, number>()
  private readonly toolCommands = new Map<string, string>()

  /** 文件被截断/换会话：重头再来。 */
  reset(): void {
    this.lines = new LineBuffer()
    this.bootstrapped = false
    this.turnReady = false
  }

  /** 追加一段 transcript 增量（字节或文本），把可见内容映射成 AgentEvent。 */
  consume(chunk: Buffer | string, ctx: RunContext): void {
    const raw = this.lines.push(chunk)
    const parsed: any[] = []
    for (const line of raw) {
      const t = line.trim()
      if (!t) continue
      try {
        parsed.push(JSON.parse(t))
      } catch {
        // 半行/脏行：丢弃即可，下一条完整行会覆盖同一消息
      }
    }
    if (!parsed.length) return

    let start = 0
    if (!this.bootstrapped) {
      this.bootstrapped = true
      let lastUser = -1
      for (let i = 0; i < parsed.length; i++) {
        const obj = parsed[i]
        if (obj?.type === 'message' && obj?.message?.role === 'user') lastUser = i
      }
      this.turnReady = lastUser >= 0
      if (lastUser < 0) return
      start = lastUser + 1
    }

    for (let i = start; i < parsed.length; i++) this.apply(parsed[i], ctx)
  }

  private apply(obj: any, ctx: RunContext): void {
    if (ctx.settled || ctx.aborting) return
    if (obj?.type !== 'message' || !obj.message) return
    const msg = obj.message as {
      role?: string
      content?: unknown
      toolCallId?: string
      toolName?: string
    }
    const role = msg.role

    // 增量阶段：新的 user 开启新一轮
    if (role === 'user') {
      this.turnReady = true
      return
    }
    if (!this.turnReady) return

    if (role === 'assistant' && Array.isArray(msg.content)) {
      const msgId = typeof obj.id === 'string' ? obj.id : `m-${this.seq++}`
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue
        const p = part as {
          type?: string
          thinking?: string
          text?: string
          id?: string
          name?: string
          arguments?: unknown
        }
        if (p.type === 'thinking' && typeof p.thinking === 'string' && p.thinking) {
          const key = `th:${msgId}`
          const prev = this.thinkingOffset.get(key) ?? 0
          if (p.thinking.length > prev) {
            ctx.reasoning(p.thinking.slice(prev))
            this.thinkingOffset.set(key, p.thinking.length)
          }
        }
        // 流式正文（此前只在最终 JSON 结算时才吐字，会又慢又怪）
        if ((p.type === 'text' || p.type === 'output_text') && typeof p.text === 'string' && p.text) {
          const key = `tx:${msgId}`
          const prev = this.textOffset.get(key) ?? 0
          if (p.text.length > prev) {
            ctx.assistant(p.text.slice(prev))
            this.textOffset.set(key, p.text.length)
          }
        }
        if (p.type === 'toolCall' && typeof p.name === 'string') {
          const callId = typeof p.id === 'string' ? p.id : `${p.name}-${msgId}`
          if (this.seenToolIds.has(`${callId}:start`)) continue
          this.seenToolIds.add(`${callId}:start`)
          const args = p.arguments
          const input = describeOpenclawArgs(args)
          if (SHELL_TOOL.test(p.name)) {
            const command =
              args && typeof args === 'object'
                ? String(
                    (args as { command?: unknown; cmd?: unknown }).command ??
                      (args as { cmd?: unknown }).cmd ??
                      input ??
                      p.name
                  )
                : String(input ?? p.name)
            this.toolCommands.set(callId, command)
            ctx.command({ id: callId, command, status: 'running' })
          } else {
            ctx.tool({
              id: callId,
              name: prettyOpenclawTool(p.name),
              input,
              status: 'running'
            })
          }
        }
      }
      return
    }

    if (role === 'toolResult') {
      const callId = typeof msg.toolCallId === 'string' ? msg.toolCallId : ''
      if (!callId || this.seenToolIds.has(`${callId}:done`)) return
      this.seenToolIds.add(`${callId}:done`)
      const name = typeof msg.toolName === 'string' ? msg.toolName : 'tool'
      const output = textFromContentParts(msg.content)
      if (SHELL_TOOL.test(name)) {
        ctx.command({
          id: callId,
          command: this.toolCommands.get(callId) || name,
          output: output || undefined,
          status: 'done'
        })
      } else {
        ctx.tool({
          id: callId,
          name: prettyOpenclawTool(name),
          output: output || undefined,
          status: 'done'
        })
      }
    }
  }
}

/**
 * 尝试从累计 stdout 解析完整 `--json` 结果（CLI 写完 JSON 后常不退出）。
 * 每来一个 chunk 都全量 JSON.parse 会退化成 O(n²)，先看尾字符是否闭合再试。
 */
export function tryParseJsonResult(stdout: string): unknown | null {
  const start = stdout.indexOf('{')
  if (start < 0) return null
  const end = stdout.trimEnd()
  if (!end.endsWith('}')) return null
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return null
  }
}
