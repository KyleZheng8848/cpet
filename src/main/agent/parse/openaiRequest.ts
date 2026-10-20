/**
 * OpenAI 兼容请求体（纯函数）。
 * 各家中转对「思考模式」的字段名不统一，只能按档位从宽到严试，失败一档降一档。
 */

import type { ApiChatMessage } from '../../../shared/multimodal'

/**
 * - full：同时带新版 thinking + 旧版 enable_thinking（兼容 DeepSeek V4 / Qwen / 中转）
 * - thinking：仅 {"thinking":{"type":"enabled|disabled"}}
 * - flag：仅 enable_thinking / include_reasoning
 * - plain：不带思考字段
 */
export type ThinkingStyle = 'full' | 'thinking' | 'flag' | 'plain'

export function openaiChatBody(
  model: string,
  messages: ApiChatMessage[],
  stream: boolean,
  enableThinking: boolean,
  style: ThinkingStyle = 'full'
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream
  }
  // 不显式要，OpenAI 兼容网关的流式响应里根本不会带 usage，UI 上 token 永远是空的。
  // 只挂在 full 档：万一网关不认这个字段，降级重试的几档没有它，仍然能流式。
  if (stream && style === 'full') body.stream_options = { include_usage: true }
  // 思考模式时部分网关拒 temperature，普通模式再带
  if (!enableThinking || style === 'plain') body.temperature = 0.7

  if (style === 'plain') return body

  if (style === 'full' || style === 'thinking') {
    body.thinking = { type: enableThinking ? 'enabled' : 'disabled' }
  }
  if (style === 'full' || style === 'flag') {
    body.enable_thinking = enableThinking
    if (enableThinking) body.include_reasoning = true
  }
  return body
}
