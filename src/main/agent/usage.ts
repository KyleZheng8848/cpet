import type { AgentRunUsage } from '../../shared/types'

/** 从各引擎 JSON 里尽量抠出 token / 耗时字段。 */
export function extractRunUsage(obj: unknown): AgentRunUsage | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const root = obj as Record<string, unknown>
  const usageObj =
    (root.usage && typeof root.usage === 'object' ? (root.usage as Record<string, unknown>) : null) ||
    (root.token_usage && typeof root.token_usage === 'object'
      ? (root.token_usage as Record<string, unknown>)
      : null) ||
    (root.tokens && typeof root.tokens === 'object' ? (root.tokens as Record<string, unknown>) : null)

  const num = (...keys: string[]): number | undefined => {
    for (const src of [root, usageObj]) {
      if (!src) continue
      for (const k of keys) {
        const v = src[k]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
        if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
      }
    }
    return undefined
  }

  const inputTokens = num(
    'input_tokens',
    'inputTokens',
    'prompt_tokens',
    'promptTokens',
    'input'
  )
  const outputTokens = num(
    'output_tokens',
    'outputTokens',
    'completion_tokens',
    'completionTokens',
    'output'
  )
  const totalTokens =
    num('total_tokens', 'totalTokens', 'total') ??
    (inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined)
  const durationMs = num('duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs', 'duration')
  const details =
    (usageObj && typeof usageObj.prompt_tokens_details === 'object'
      ? (usageObj.prompt_tokens_details as Record<string, unknown>)
      : null) ||
    (root.prompt_tokens_details && typeof root.prompt_tokens_details === 'object'
      ? (root.prompt_tokens_details as Record<string, unknown>)
      : null)
  const nestedCached =
    details && typeof details.cached_tokens === 'number' && Number.isFinite(details.cached_tokens)
      ? details.cached_tokens
      : undefined
  const cacheReadTokens =
    num('cache_read_tokens', 'cacheReadTokens', 'cache_read_input_tokens', 'cached_tokens') ??
    (nestedCached != null && nestedCached >= 0 ? nestedCached : undefined)
  const cacheWriteTokens = num(
    'cache_write_tokens',
    'cacheWriteTokens',
    'cache_creation_input_tokens'
  )

  const out: AgentRunUsage = {}
  if (inputTokens != null) out.inputTokens = Math.round(inputTokens)
  if (outputTokens != null) out.outputTokens = Math.round(outputTokens)
  if (totalTokens != null) out.totalTokens = Math.round(totalTokens)
  if (cacheReadTokens != null) out.cacheReadTokens = Math.round(cacheReadTokens)
  if (cacheWriteTokens != null) out.cacheWriteTokens = Math.round(cacheWriteTokens)
  if (durationMs != null && durationMs > 0) {
    // 有的 CLI 用秒
    out.durationMs = durationMs < 100 && !Number.isInteger(durationMs) ? Math.round(durationMs * 1000) : Math.round(durationMs)
  }
  return Object.keys(out).length ? out : undefined
}

export function mergeRunUsage(base: AgentRunUsage, patch?: AgentRunUsage): AgentRunUsage {
  if (!patch) return base
  return {
    ...base,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null))
  }
}
