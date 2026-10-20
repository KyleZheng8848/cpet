/**
 * RSS 发现：精选库检索 + 可选远程搜源（Feedly 公开搜索）。
 * 远程失败时诚实报错，仍返回本地精选匹配，不伪装成千级假库。
 */

import { filterRssDiscoverFeeds, getRssDiscoverFeeds } from '../shared/rssCatalog'
import { ingestRssFeedMetrics, peekRssFeedMetrics } from './rssCatalogMetrics'
import { rssFeedMetricKey } from '../shared/rssFeedMetrics'

export type RssDiscoverItem = {
  id: string
  name: string
  url: string
  desc: string
  category?: string
  source: 'preset' | 'remote'
  subscribers?: number
  /** 源最近更新时间（ms）；Feedly lastUpdated。 */
  updatedAt?: number
}

export type RssDiscoverResult = {
  ok: boolean
  items: RssDiscoverItem[]
  error?: string
  /** 远程是否贡献了结果 */
  remote?: boolean
}

const FEEDLY_SEARCH = 'https://cloud.feedly.com/v3/search/feeds'

/** Feedly 在国内常超时；发现页不能被拖成「永远搜索中」。 */
const FEEDLY_TIMEOUT_MS = 2800

async function fetchJson(url: string, ms = FEEDLY_TIMEOUT_MS): Promise<unknown | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'CPET-RSS/0.4 (+https://github.com/cursor-pet)',
        Accept: 'application/json'
      }
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function presetHits(query: string, limit: number): RssDiscoverItem[] {
  const q = query.trim()
  const list = q
    ? filterRssDiscoverFeeds({ category: 'all', query: q })
    : [...getRssDiscoverFeeds()]
  const slice = list.slice(0, limit)
  const cached = peekRssFeedMetrics(slice.map((p) => p.url))
  return slice.map((p) => {
    const m = cached[rssFeedMetricKey(p.url)]
    const subscribers =
      typeof p.subscribers === 'number'
        ? p.subscribers
        : typeof m?.subscribers === 'number'
          ? m.subscribers
          : undefined
    const updatedAt =
      typeof p.updatedAt === 'number' && p.updatedAt > 0
        ? p.updatedAt
        : typeof m?.updatedAt === 'number' && m.updatedAt > 0
          ? m.updatedAt
          : undefined
    return {
      id: `preset:${p.id}`,
      name: p.name,
      url: p.url,
      desc: p.desc,
      category: p.category,
      source: 'preset' as const,
      ...(typeof subscribers === 'number' ? { subscribers } : {}),
      ...(updatedAt ? { updatedAt } : {})
    }
  })
}

function parseFeedly(raw: unknown): RssDiscoverItem[] {
  if (!raw || typeof raw !== 'object') return []
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  const out: RssDiscoverItem[] = []
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const feedId = typeof o.feedId === 'string' ? o.feedId : ''
    const href = (feedId.startsWith('feed/') ? feedId.slice(5) : feedId).trim()
    if (!/^https?:\/\//i.test(href)) continue
    const name =
      (typeof o.title === 'string' && o.title.trim()) ||
      (typeof o.websiteTitle === 'string' && o.websiteTitle.trim()) ||
      href
    const desc =
      (typeof o.description === 'string' && o.description.trim()) ||
      (typeof o.website === 'string' && o.website.trim()) ||
      '远程发现'
    const subscribers =
      typeof o.subscribers === 'number'
        ? o.subscribers
        : typeof o.estimatedInterest === 'number'
          ? o.estimatedInterest
          : undefined
    const lastUpdated = o.lastUpdated
    let updatedAt: number | undefined
    if (typeof lastUpdated === 'number' && Number.isFinite(lastUpdated) && lastUpdated > 0) {
      // Feedly 多为毫秒；若像秒级则抬到 ms
      updatedAt = lastUpdated < 1e12 ? lastUpdated * 1000 : lastUpdated
    }
    out.push({
      id: `remote:${href}`,
      name: String(name).slice(0, 120),
      url: href,
      desc: String(desc).slice(0, 200),
      source: 'remote',
      subscribers,
      ...(updatedAt ? { updatedAt } : {})
    })
  }
  return out
}

function dedupe(items: RssDiscoverItem[]): RssDiscoverItem[] {
  const seen = new Set<string>()
  const out: RssDiscoverItem[] = []
  for (const it of items) {
    let key = it.url
    try {
      key = new URL(it.url).href.toLowerCase()
    } catch {
      key = it.url.toLowerCase()
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

/** 仅本地精选（供 UI 瞬时首屏，不碰网络）。 */
export function discoverRssFeedsLocal(payload: {
  query?: string
  limit?: number
}): RssDiscoverResult {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  const limit = Math.max(8, Math.min(60, Number(payload?.limit) || 30))
  return {
    ok: true,
    items: presetHits(query, limit).slice(0, limit),
    remote: false
  }
}

/** 关键词搜源；空关键词返回精选热门（本地）并尝试远程热搜词 tech。 */
export async function discoverRssFeeds(payload: {
  query?: string
  limit?: number
  /** true：只返回本地，用于首屏；默认会再试 Feedly（短超时）。 */
  localOnly?: boolean
}): Promise<RssDiscoverResult> {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  const limit = Math.max(8, Math.min(60, Number(payload?.limit) || 30))
  const local = presetHits(query, limit)
  if (payload?.localOnly) {
    return { ok: true, items: local.slice(0, limit), remote: false }
  }

  const remoteQuery = query || 'technology'
  const remoteUrl = `${FEEDLY_SEARCH}?query=${encodeURIComponent(remoteQuery)}&count=${Math.min(40, limit)}`
  const json = await fetchJson(remoteUrl, FEEDLY_TIMEOUT_MS)
  if (!json) {
    return {
      ok: true,
      items: local.slice(0, limit),
      remote: false,
      error: query
        ? '在线发现暂不可用，已显示精选库匹配'
        : '在线热门暂不可用，已显示精选库'
    }
  }
  const remote = parseFeedly(json)
  // 远程指标灌进目录缓存，本地目录「最火/最新」可复用
  if (remote.length) ingestRssFeedMetrics(remote)
  // 远程优先（常带热度/更新时间），再补本地精选
  const merged = dedupe([...remote, ...local]).slice(0, limit)
  return {
    ok: true,
    items: merged,
    remote: remote.length > 0,
    error: remote.length ? undefined : '在线无新结果，已显示精选库'
  }
}
