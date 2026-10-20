/**
 * 自定义 OpenAI / Anthropic 兼容 API 的 SSE 帧映射。
 * 这条路径没有 CLI 兜底，帧解析出错就是「一个字都没有」或「token 永远是空的」。
 */
import { describe, it, expect } from 'vitest'
import { RunContext } from '../src/main/agent/runContext'
import type { AgentEvent } from '../src/shared/types'
import { SseFrameParser } from '../src/main/agent/lineStream'
import {
  applyAnthropicStreamData,
  applyOpenAIStreamData
} from '../src/main/agent/parse/sseChunk'
import { openaiChatBody } from '../src/main/agent/parse/openaiRequest'

function setup() {
  const events: AgentEvent[] = []
  const ctx = new RunContext({ conversationId: 'c1', runKey: 'k1' }, (e) => events.push(e))
  return { ctx, events }
}

const openaiChunk = (delta: unknown, finish?: string): string =>
  JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finish ?? null }]
  })

describe('OpenAI 兼容 SSE', () => {
  it('逐片 content 累加成完整正文', () => {
    const { ctx } = setup()
    for (const t of ['你', '好', '呀']) applyOpenAIStreamData(ctx, openaiChunk({ content: t }))
    expect(ctx.lastText).toBe('你好呀')
  })

  it('reasoning_content 走思考通道（DeepSeek / Qwen）', () => {
    const { ctx, events } = setup()
    applyOpenAIStreamData(ctx, openaiChunk({ reasoning_content: '先想一下' }))
    expect(events.filter((e) => e.type === 'reasoning-delta')).toHaveLength(1)
    expect(ctx.lastText).toBe('')
  })

  it('finish_reason 之后封口，网关重复的尾包不会把正文贴两遍', () => {
    const { ctx } = setup()
    applyOpenAIStreamData(ctx, openaiChunk({ content: '完整回答' }))
    applyOpenAIStreamData(ctx, openaiChunk({}, 'stop'))
    applyOpenAIStreamData(ctx, openaiChunk({ content: '完整回答' }))
    expect(ctx.lastText).toBe('完整回答')
  })

  it('[DONE] 算终止标记，即使一个字都没有也不当作「流式失败」去重发非流式', () => {
    const { ctx } = setup()
    expect(applyOpenAIStreamData(ctx, '[DONE]')).toEqual({ gotDelta: false, terminal: true })
  })

  it('末尾 usage-only 帧（stream_options.include_usage）把 token 收进来', () => {
    const { ctx } = setup()
    applyOpenAIStreamData(ctx, openaiChunk({ content: '嗨' }))
    applyOpenAIStreamData(
      ctx,
      JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 88, completion_tokens: 12, total_tokens: 100 }
      })
    )
    expect(ctx.usage).toMatchObject({ inputTokens: 88, outputTokens: 12, totalTokens: 100 })
  })

  it('坏 JSON 帧被吞掉，不影响后续帧', () => {
    const { ctx } = setup()
    applyOpenAIStreamData(ctx, '{"choices":[{"delta"')
    applyOpenAIStreamData(ctx, openaiChunk({ content: '正常' }))
    expect(ctx.lastText).toBe('正常')
  })
})

describe('Anthropic Messages SSE', () => {
  it('content_block_delta 逐片累加', () => {
    const { ctx } = setup()
    for (const t of ['Hel', 'lo']) {
      applyAnthropicStreamData(
        ctx,
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })
      )
    }
    expect(ctx.lastText).toBe('Hello')
  })

  it('thinking_delta 只进思考通道', () => {
    const { ctx, events } = setup()
    applyAnthropicStreamData(
      ctx,
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '推理' } })
    )
    expect(events.filter((e) => e.type === 'reasoning-delta')).toHaveLength(1)
    expect(ctx.lastText).toBe('')
  })

  it('message_start 的 input_tokens 藏在 message.usage 里，必须抓到', () => {
    const { ctx } = setup()
    applyAnthropicStreamData(
      ctx,
      JSON.stringify({
        type: 'message_start',
        message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 1500, output_tokens: 1 } }
      })
    )
    expect(ctx.usage.inputTokens).toBe(1500)
  })

  it('input 与 output 分散在两帧，合并后的 total 必须是两者之和', () => {
    const { ctx } = setup()
    applyAnthropicStreamData(
      ctx,
      JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 1500, output_tokens: 1 } }
      })
    )
    applyAnthropicStreamData(
      ctx,
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 250 }
      })
    )
    expect(ctx.usage).toMatchObject({ inputTokens: 1500, outputTokens: 250, totalTokens: 1750 })
  })

  it('message_delta 不算结束（只是 usage），否则几乎没正文就 done', () => {
    const { ctx } = setup()
    const r = applyAnthropicStreamData(
      ctx,
      JSON.stringify({ type: 'message_delta', usage: { output_tokens: 3 } })
    )
    expect(r.terminal).toBe(false)
  })

  it('message_stop 才是终止，并封口', () => {
    const { ctx } = setup()
    applyAnthropicStreamData(ctx, JSON.stringify({ type: 'content_block_delta', delta: { text: '嗨' } }))
    const r = applyAnthropicStreamData(ctx, JSON.stringify({ type: 'message_stop' }))
    expect(r.terminal).toBe(true)
    expect(ctx.contentSealed).toBe(true)
  })

  it('content_block_start 里的整段 text 也要收（非流式块）', () => {
    const { ctx } = setup()
    applyAnthropicStreamData(
      ctx,
      JSON.stringify({ type: 'content_block_start', content_block: { type: 'text', text: '整段' } })
    )
    expect(ctx.lastText).toBe('整段')
  })
})

describe('OpenAI 请求体', () => {
  const msgs = [{ role: 'user', content: '你好' }]

  it('流式请求必须显式要 usage，否则网关不会回 token', () => {
    expect(openaiChatBody('gpt-4o', msgs, true, false, 'full')).toMatchObject({
      stream: true,
      stream_options: { include_usage: true }
    })
  })

  it('非流式不带 stream_options（部分网关会因此报 400）', () => {
    expect(openaiChatBody('gpt-4o', msgs, false, false, 'full')).not.toHaveProperty('stream_options')
  })

  it('降级档不带 stream_options：网关不认这个字段时仍能流式', () => {
    for (const style of ['thinking', 'flag', 'plain'] as const) {
      expect(openaiChatBody('gpt-4o', msgs, true, true, style)).not.toHaveProperty('stream_options')
    }
  })

  it('思考模式不带 temperature，普通模式带', () => {
    expect(openaiChatBody('m', msgs, true, true, 'full')).not.toHaveProperty('temperature')
    expect(openaiChatBody('m', msgs, true, false, 'full')).toMatchObject({ temperature: 0.7 })
  })

  it('plain 档只剩最基本字段', () => {
    expect(Object.keys(openaiChatBody('m', msgs, true, true, 'plain')).sort()).toEqual([
      'messages',
      'model',
      'stream',
      'temperature'
    ])
  })
})

describe('分帧 + 映射端到端', () => {
  it('JSON 被网关拆成多条 data 行时仍能解析出正文', () => {
    const { ctx } = setup()
    const frames = new SseFrameParser()
    const raw =
      'data: {"choices":[{"delta":\n' + 'data: {"content":"跨行的正文"}}]}\n' + '\n' + 'data: [DONE]\n\n'
    for (const f of frames.push(raw)) applyOpenAIStreamData(ctx, f)
    expect(ctx.lastText).toBe('跨行的正文')
  })

  it('按字节任意切开的 SSE 流不会丢字也不会乱码', () => {
    const { ctx } = setup()
    const frames = new SseFrameParser()
    const raw =
      `data: ${openaiChunk({ content: '第一段中文' })}\n\n` +
      `data: ${openaiChunk({ content: '第二段中文' })}\n\n` +
      'data: [DONE]\n\n'
    const bytes = Buffer.from(raw, 'utf8')
    for (let i = 0; i < bytes.length; i += 7) {
      for (const f of frames.push(bytes.subarray(i, i + 7))) applyOpenAIStreamData(ctx, f)
    }
    for (const f of frames.flush()) applyOpenAIStreamData(ctx, f)
    expect(ctx.lastText).toBe('第一段中文第二段中文')
  })
})
