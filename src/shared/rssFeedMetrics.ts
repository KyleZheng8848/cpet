/** RSS 源热度 / 新鲜度指标（目录与发现共用）。 */

export type RssFeedMetric = {
  /** Feedly 等外部订阅人数；缺失则不参与「最火」加权展示。 */
  subscribers?: number
  /** 最近更新时间（ms）：优先条目 pubDate / Feedly lastUpdated。 */
  updatedAt?: number
  /** 指标写入时间（ms）。 */
  fetchedAt: number
}

export type RssFeedMetricsMap = Record<string, RssFeedMetric>

/** 统一 URL 键，便于目录与 Feedly 结果对齐。 */
export function rssFeedMetricKey(url: string): string {
  const raw = (url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    u.hash = ''
    // 去掉多余尾斜杠，保留根路径 /
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '')
    }
    return u.href.toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

export function mergeRssFeedMetric(
  prev: RssFeedMetric | undefined,
  next: Partial<RssFeedMetric> & { fetchedAt?: number }
): RssFeedMetric {
  const fetchedAt = next.fetchedAt ?? Date.now()
  return {
    subscribers:
      typeof next.subscribers === 'number' && Number.isFinite(next.subscribers)
        ? next.subscribers
        : prev?.subscribers,
    updatedAt:
      typeof next.updatedAt === 'number' && next.updatedAt > 0
        ? Math.max(prev?.updatedAt || 0, next.updatedAt)
        : prev?.updatedAt,
    fetchedAt: Math.max(prev?.fetchedAt || 0, fetchedAt)
  }
}

/** 订阅数缓存多久重查。 */
export const RSS_SUBSCRIBERS_TTL_MS = 7 * 24 * 3600_000
/** 更新时间缓存多久重查。 */
export const RSS_FRESHNESS_TTL_MS = 6 * 3600_000
/** 查过但没有订阅数：冷却多久再打 Feedly（中文/RSSHub 源大量未收录）。 */
export const RSS_SUBSCRIBERS_MISS_TTL_MS = 24 * 3600_000
/** 查过但拉不到更新时间：冷却多久再直拉。 */
export const RSS_FRESHNESS_MISS_TTL_MS = 2 * 3600_000

export function rssMetricNeedsSubscribers(
  m: RssFeedMetric | undefined,
  now = Date.now()
): boolean {
  if (!m) return true
  if (typeof m.subscribers === 'number') {
    return now - (m.fetchedAt || 0) > RSS_SUBSCRIBERS_TTL_MS
  }
  // 已请求过、确认无公开订阅数 → 负缓存，别空转「回填中」
  if (m.fetchedAt > 0) return now - m.fetchedAt > RSS_SUBSCRIBERS_MISS_TTL_MS
  return true
}

export function rssMetricNeedsFreshness(
  m: RssFeedMetric | undefined,
  now = Date.now()
): boolean {
  if (!m) return true
  if (typeof m.updatedAt === 'number' && m.updatedAt > 0) {
    return now - (m.fetchedAt || 0) > RSS_FRESHNESS_TTL_MS
  }
  if (m.fetchedAt > 0) return now - m.fetchedAt > RSS_FRESHNESS_MISS_TTL_MS
  return true
}

/** 是否已有可展示的指标（有数才算，空壳 fetchedAt 不算）。 */
export function rssMetricHasDisplayValue(m: RssFeedMetric | undefined): boolean {
  if (!m) return false
  if (typeof m.subscribers === 'number') return true
  return typeof m.updatedAt === 'number' && m.updatedAt > 0
}
