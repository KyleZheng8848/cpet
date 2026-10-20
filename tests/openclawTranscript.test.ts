/**
 * OpenClaw 只能靠轮询 Gateway 写的 session jsonl 拿过程事件，
 * 而这个文件是按字节偏移增量读的——分帧和解码一旦出错，用户直接看到乱码或丢事件。
 */
import { describe, it, expect } from 'vitest'
import { RunContext } from '../src/main/agent/runContext'
import type { AgentEvent } from '../src/shared/types'
import {
  OpenclawTranscriptReader,
  tryParseJsonResult
} from '../src/main/agent/parse/openclawTranscript'

function setup() {
  const events: AgentEvent[] = []
  const ctx = new RunContext({ conversationId: 'c1', runKey: 'k1' }, (e) => events.push(e))
  return { ctx, events, reader: new OpenclawTranscriptReader() }
}

const line = (obj: unknown): string => `${JSON.stringify(obj)}\n`
const userLine = line({ type: 'message', message: { role: 'user', content: '问题' } })
const assistantLine = (id: string, text: string): string =>
  line({ type: 'message', id, message: { role: 'assistant', content: [{ type: 'text', text }] } })

describe('OpenclawTranscriptReader：冷启动', () => {
  it('只回放最后一条 user 之后的内容，历史轮次不刷屏', () => {
    const { ctx, reader } = setup()
    reader.consume(
      assistantLine('old', '上一轮的旧回答') + userLine + assistantLine('new', '本轮回答'),
      ctx
    )
    expect(ctx.lastText).toBe('本轮回答')
  })

  it('整个文件都没有 user 时不发任何内容（还没轮到本轮）', () => {
    const { ctx, reader } = setup()
    reader.consume(assistantLine('old', '历史'), ctx)
    expect(ctx.lastText).toBe('')
  })
})

describe('OpenclawTranscriptReader：多字节与分帧', () => {
  it('读取边界切在中文字中间时，正文不会出现替换字符', () => {
    const { ctx, reader } = setup()
    const bytes = Buffer.from(userLine + assistantLine('m1', '你好世界，这是中文流式输出'), 'utf8')
    const cut = bytes.indexOf(Buffer.from('世', 'utf8')) + 1
    reader.consume(bytes.subarray(0, cut), ctx)
    reader.consume(bytes.subarray(cut), ctx)
    expect(ctx.lastText).toBe('你好世界，这是中文流式输出')
    expect(ctx.lastText).not.toContain('\ufffd')
  })

  it('半行 JSON 不会被丢，等下一次轮询补齐', () => {
    const { ctx, reader } = setup()
    const whole = userLine + assistantLine('m1', '分两次写入')
    reader.consume(whole.slice(0, whole.length - 12), ctx)
    reader.consume(whole.slice(whole.length - 12), ctx)
    expect(ctx.lastText).toBe('分两次写入')
  })

  it('同一条消息被反复重写时按偏移只发增量', () => {
    const { ctx, events, reader } = setup()
    reader.consume(userLine + assistantLine('m1', '第一'), ctx)
    reader.consume(assistantLine('m1', '第一第二'), ctx)
    const deltas = events
      .filter((e) => e.type === 'assistant-delta')
      .map((e) => (e as { text: string }).text)
    expect(deltas).toEqual(['第一', '第二'])
  })
})

describe('OpenclawTranscriptReader：过程事件', () => {
  it('exec 类 toolCall 走 command，toolResult 回填原命令文案', () => {
    const { ctx, events, reader } = setup()
    reader.consume(
      userLine +
        line({
          type: 'message',
          id: 'm1',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tc-1', name: 'exec', arguments: { command: 'ls' } }]
          }
        }) +
        line({
          type: 'message',
          id: 'm2',
          message: {
            role: 'toolResult',
            toolCallId: 'tc-1',
            toolName: 'exec',
            content: [{ type: 'text', text: 'a.txt' }]
          }
        }),
      ctx
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'command', id: 'tc-1', command: 'ls', status: 'running' })
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'command', id: 'tc-1', command: 'ls', output: 'a.txt', status: 'done' })
    )
  })

  it('同一个 toolCall 被重复写入时只发一次 running', () => {
    const { ctx, events, reader } = setup()
    const tool = line({
      type: 'message',
      id: 'm1',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'tc-1', name: 'read', arguments: { path: 'a.ts' } }]
      }
    })
    reader.consume(userLine + tool, ctx)
    reader.consume(tool, ctx)
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(1)
  })

  it('thinking 按偏移增量发，不重复整段', () => {
    const { ctx, events, reader } = setup()
    const think = (t: string): string =>
      line({
        type: 'message',
        id: 'm1',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: t }] }
      })
    reader.consume(userLine + think('先'), ctx)
    reader.consume(think('先后'), ctx)
    const deltas = events
      .filter((e) => e.type === 'reasoning-delta')
      .map((e) => (e as { text: string }).text)
    expect(deltas).toEqual(['先', '后'])
  })

  it('reset 后重新冷启动（会话文件被截断/换会话）', () => {
    const { ctx, reader } = setup()
    reader.consume(userLine + assistantLine('m1', '旧'), ctx)
    reader.reset()
    reader.consume(assistantLine('m2', '没有 user 前缀的新内容'), ctx)
    expect(ctx.lastText).toBe('旧')
  })
})

describe('tryParseJsonResult', () => {
  it('CLI 还没写完 JSON 时返回 null，不误判成完成', () => {
    expect(tryParseJsonResult('{"status":"ok","result":{"payl')).toBeNull()
  })

  it('JSON 前面的启动噪声会被跳过', () => {
    expect(tryParseJsonResult('loading...\n{"status":"ok"}')).toEqual({ status: 'ok' })
  })

  it('尾部没闭合的大括号直接判负（避免每个 chunk 都全量 parse）', () => {
    expect(tryParseJsonResult('{"a":1} trailing noise')).toBeNull()
  })

  it('完整 JSON 正常解析', () => {
    expect(tryParseJsonResult('{"status":"ok","payloads":[{"text":"嗨"}]}\n')).toMatchObject({
      status: 'ok'
    })
  })
})
