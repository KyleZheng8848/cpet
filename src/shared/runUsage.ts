import { t as uiText } from './i18n'
import type { AgentRunUsage } from './types'

function fmtTok(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const s = ms / 1000
    return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  }
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m${s}s`
}

/** 气泡下展示：`2.4s · 1.2k→340 tok`；大量缓存时写成「新 + 缓存」。 */
export function formatRunUsage(usage?: AgentRunUsage | null): string {
  if (!usage) return ''
  const parts: string[] = []
  if (typeof usage.durationMs === 'number' && usage.durationMs >= 0) {
    parts.push(fmtDuration(usage.durationMs))
  }
  const hasIn = typeof usage.inputTokens === 'number'
  const hasOut = typeof usage.outputTokens === 'number'
  const cache = usage.cacheReadTokens
  const input = usage.inputTokens ?? 0
  if (hasIn || hasOut) {
    if (typeof cache === 'number' && cache > 0 && input > 0) {
      const fresh = Math.max(0, input - cache)
      parts.push(`${fmtTok(fresh)} 新（${fmtTok(cache)} 缓存）→${fmtTok(usage.outputTokens ?? 0)}`)
    } else {
      parts.push(`${fmtTok(usage.inputTokens ?? 0)}→${fmtTok(usage.outputTokens ?? 0)} tok`)
    }
  } else if (typeof usage.totalTokens === 'number') {
    parts.push(`${fmtTok(usage.totalTokens)} tok`)
  }
  return parts.join(' · ')
}

/** 鼠标悬停：把「输入一百万」拆成新字 vs 缓存 vs 多轮合计。 */
export function formatRunUsageTitle(usage?: AgentRunUsage | null): string {
  if (!usage) return uiText("本轮耗时与 token")
  const cache = usage.cacheReadTokens
  const input = usage.inputTokens
  if (typeof cache === 'number' && cache > 0 && typeof input === 'number' && input > 0) {
    const fresh = Math.max(0, input - cache)
    return uiText("输入是各次模型调用合计，不是这一句的字数。新输入约 {0}，另 {1} 走缓存（几乎不按新字计费）", [fmtTok(fresh), fmtTok(cache)])
  }
  return uiText("本轮耗时与 token")
}
