/**
 * 流分帧与解码（纯逻辑，无副作用）。
 *
 * 五个引擎各自 spawn 子进程 / 读文件 / 读 HTTP body，但「字节 → 行 → 帧」这层的
 * 故障模式是共通的：半行被 chunk 切断、多字节 UTF-8 被切断成 U+FFFD、
 * 单行无上限把主进程内存撑爆。集中在这里实现，才能被测试锁住。
 */

import { StringDecoder } from 'node:string_decoder'

/** 单行上限：超过即判定为异常输出（工具把整包二进制吐到 stdout 之类），丢弃止损。 */
export const MAX_LINE_CHARS = 8 * 1024 * 1024

export class LineBuffer {
  private buf = ''
  /** 已越过单行上限，正在丢弃直到下一个换行。 */
  private overflowing = false
  private dropped = 0
  private readonly decoder = new StringDecoder('utf8')

  constructor(private readonly maxLineChars: number = MAX_LINE_CHARS) {}

  /** 因超长被丢弃的行数（诊断用）。 */
  get droppedLines(): number {
    return this.dropped
  }

  /** 尚未成行的残留（不含解码器里未完成的字节）。 */
  get pending(): string {
    return this.buf
  }

  /**
   * 追加一段流数据，返回本次新拼齐的完整行（不含换行符，未做 trim）。
   * 传 Buffer 时用 StringDecoder 解码，跨 chunk 的多字节字符不会变成乱码。
   */
  push(chunk: string | Buffer): string[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    if (!text) return []
    this.buf += text
    return this.take()
  }

  /**
   * 流结束：吐出剩余整行 + 最后一段没有换行收尾的残留。
   * 同时冲刷解码器，避免末尾半个多字节字符被静默吞掉。
   */
  flush(): string[] {
    const tail = this.decoder.end()
    if (tail) this.buf += tail
    const out = this.take()
    const last = this.buf
    this.buf = ''
    if (this.overflowing) {
      this.overflowing = false
      return out
    }
    if (last) out.push(last)
    return out
  }

  reset(): void {
    this.buf = ''
    this.overflowing = false
  }

  private take(): string[] {
    const out: string[] = []
    let idx: number
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      if (this.overflowing) {
        this.overflowing = false
        continue
      }
      out.push(line)
    }
    if (this.buf.length > this.maxLineChars) {
      this.buf = ''
      if (!this.overflowing) {
        this.overflowing = true
        this.dropped += 1
      }
    }
    return out
  }
}

/**
 * SSE 分帧（text/event-stream）。
 *
 * 按规范：一个事件由若干 `field: value` 行组成，空行结束；同一事件里多条 `data:`
 * 要用 `\n` 拼起来再交给 JSON.parse。逐行 parse 会让「JSON 被网关按行拆开」的响应
 * 全部解析失败，表现为正文凭空消失、随后回落非流式（慢一倍且重复计费）。
 */
export class SseFrameParser {
  private readonly lines: LineBuffer
  private data: string[] = []

  constructor(maxLineChars: number = MAX_LINE_CHARS) {
    this.lines = new LineBuffer(maxLineChars)
  }

  push(chunk: string | Buffer): string[] {
    const out: string[] = []
    for (const line of this.lines.push(chunk)) this.feedLine(line, out)
    return out
  }

  /** 流结束：补一帧尾巴（不少网关最后一条 data 后不带空行，甚至不带换行）。 */
  flush(): string[] {
    const out: string[] = []
    for (const line of this.lines.flush()) this.feedLine(line, out)
    this.dispatch(out)
    return out
  }

  private feedLine(rawLine: string, out: string[]): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) {
      this.dispatch(out)
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== 'data') return
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    this.data.push(value)
  }

  private dispatch(out: string[]): void {
    if (!this.data.length) return
    const payload = this.data.join('\n')
    this.data = []
    if (payload.trim()) out.push(payload)
  }
}

/**
 * 有上限的日志累加（stderr 等）：只留尾部。
 * 出错时有用的永远是最后那几行，但一个死循环刷屏的 CLI 能把整个主进程拖垮。
 */
export function appendBounded(prev: string, chunk: string, max = 256 * 1024): string {
  const next = prev + chunk
  return next.length <= max ? next : next.slice(next.length - max)
}
