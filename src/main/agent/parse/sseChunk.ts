/**
 * 自定义 OpenAI / Anthropic 兼容接口的 SSE 帧映射。
 * 分帧在 SseFrameParser 里做，这里只负责「一帧 data → RunContext 调用」。
 */

import type { RunContext } from '../runContext'
import { extractRunUsage } from '../usage'

/** OpenAI message.content 可能是 string，或 Anthropic 风格 content blocks。 */
export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = part as { type?: string; text?: unknown }
      if (typeof p.text === 'string' && (!p.type || p.type === 'text' || p.type === 'text_delta')) {
        return p.text
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

/** 从兼容接口的 message / delta 里抠思维链（DeepSeek / Qwen / OpenRouter 等）。 */
export function reasoningFromPayload(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const o = obj as Record<string, unknown>
  for (const key of ['reasoning_content', 'reasoning', 'thinking', 'reasoning_text']) {
    const v = o[key]
    if (typeof v === 'string' && v) return v
  }
  // OpenRouter 等：delta.reasoning / message.reasoning 为对象
  const nested = o.reasoning
  if (nested && typeof nested === 'object') {
    const n = nested as Record<string, unknown>
    if (typeof n.content === 'string' && n.content) return n.content
    if (typeof n.text === 'string' && n.text) return n.text
  }
  // 部分中转：reasoning_details: [{ text | content }]
  const details = o.reasoning_details
  if (Array.isArray(details)) {
    const parts = details
      .map((d) => {
        if (!d || typeof d !== 'object') return ''
        const x = d as Record<string, unknown>
        if (typeof x.text === 'string') return x.text
        if (typeof x.content === 'string') return x.content
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join('')
  }
  return ''
}

export function thinkingFromAnthropicContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = part as { type?: string; thinking?: unknown; text?: unknown }
      if (p.type === 'thinking' && typeof p.thinking === 'string') return p.thinking
      return ''
    })
    .filter(Boolean)
    .join('')
}

/** 一帧的处理结果：是否产出了可见增量、是否已到终止标记。 */
export interface SseChunkResult {
  gotDelta: boolean
  terminal: boolean
}

const NOTHING: SseChunkResult = { gotDelta: false, terminal: false }

export function applyOpenAIStreamData(ctx: RunContext, raw: string): SseChunkResult {
  const data = raw.trim()
  if (!data) return NOTHING
  if (data === '[DONE]') return { gotDelta: false, terminal: true }
  let json: any
  try {
    json = JSON.parse(data)
  } catch {
    return NOTHING
  }
  ctx.noteUsage(extractRunUsage(json))
  const choice = json.choices?.[0]
  let terminal = false
  if (choice?.finish_reason) {
    terminal = true
    // 结束后封口，忽略部分网关重复尾包
    ctx.sealContent()
  }
  if (ctx.contentSealed && !choice?.finish_reason) return { gotDelta: false, terminal }

  let gotDelta = false
  const delta = choice?.delta
  // 部分中转在 delta 与 message 里塞累计 reasoning；只取一处并做累计去重
  const reason = reasoningFromPayload(delta) || reasoningFromPayload(choice?.message)
  if (reason && ctx.reasoning(reason)) gotDelta = true
  const content = delta?.content ?? choice?.message?.content
  const text = typeof content === 'string' ? content : textFromContent(content)
  if (text && ctx.assistant(text)) gotDelta = true
  return { gotDelta, terminal }
}

export function applyAnthropicStreamData(ctx: RunContext, raw: string): SseChunkResult {
  const data = raw.trim()
  if (!data) return NOTHING
  if (data === '[DONE]') return { gotDelta: false, terminal: true }
  let json: any
  try {
    json = JSON.parse(data)
  } catch {
    return NOTHING
  }

  // message_start 把 input_tokens 藏在 message.usage 里，顶层没有 usage；
  // 只看顶层会导致 Anthropic 直连永远只统计到 output_tokens。
  if (json.message && typeof json.message === 'object') {
    ctx.noteUsage(extractRunUsage(json.message))
  }
  ctx.noteUsage(extractRunUsage(json))
  // 输入/输出分散在 message_start 与 message_delta 两帧，各帧自算的 total 都是残缺的，
  // 合齐后必须重算，否则 UI 上的总 token 只等于输出。
  const { inputTokens, outputTokens } = ctx.usage
  if (inputTokens != null && outputTokens != null) {
    ctx.noteUsage({ totalTokens: inputTokens + outputTokens })
  }

  // message_delta 常为 usage，不能当结束；否则几乎无正文就 done
  if (json.type === 'message_stop') {
    ctx.sealContent()
    return { gotDelta: false, terminal: true }
  }
  if (ctx.contentSealed) return NOTHING

  let gotDelta = false
  if (json.type === 'content_block_delta') {
    if (json.delta?.type === 'thinking_delta' && typeof json.delta.thinking === 'string') {
      if (ctx.reasoning(json.delta.thinking)) gotDelta = true
    } else if (typeof json.delta?.text === 'string') {
      if (ctx.assistant(json.delta.text)) gotDelta = true
    }
  } else if (json.type === 'content_block_start' && json.content_block) {
    const block = json.content_block
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
      if (ctx.reasoning(block.thinking)) gotDelta = true
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      if (ctx.assistant(block.text)) gotDelta = true
    }
  }
  return { gotDelta, terminal: false }
}
