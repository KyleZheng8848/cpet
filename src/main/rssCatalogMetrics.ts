/**
 * 本地目录指标回填：Feedly 订阅数 + 直拉源最新条目时间。
 * 结果落盘到 userData，并与内置 sidecar 合并；可见行优先，后台可续暖。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { parseFeedXml } from '../shared/rssBrief'
import {
  mergeRssFeedMetric,
  rssFeedMetricKey,
  rssMetricNeedsFreshness,
  rssMetricNeedsSubscribers,
  type RssFeedMetric,
  type RssFeedMetricsMap
} from '../shared/rssFeedMetrics'
import bundledMetricsJson from '../shared/data/rss-catalog-metrics.json'

const FEEDLY_SEARCH = 'https://cloud.feedly.com/v3/search/feeds'
const CACHE_VERSION = 1
const MAX_CACHE_ENTRIES = 4000
const LOOKUP_CONCURRENCY = 3

type CacheFile = {
  version: number
  updatedAt: number
  byUrl: RssFeedMetricsMap
}

let memory: CacheFile | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const inFlight = new Map<string, Promise<RssFeedMetric | undefined>>()

function cachePath(): string {
  return join(app.getPath('userData'), 'rss-catalog-metrics.json')
}

function readBundled(): RssFeedMetricsMap {
  const raw = bundledMetricsJson as { byUrl?: RssFeedMetricsMap }
  return raw?.byUrl && typeof raw.byUrl === 'object' ? { ...raw.byUrl } : {}
}

function loadCache(): CacheFile {
  if (memory) return memory
  const bundled = readBundled()
  let disk: CacheFile = { version: CACHE_VERSION, updatedAt: 0, byUrl: {} }
  try {
    const p = cachePath()
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as CacheFile
      if (parsed && typeof parsed === 'object' && parsed.byUrl) {
        disk = {
          version: CACHE_VERSION,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
          byUrl: { ...parsed.byUrl }
        }
      }
    }
  } catch {
    /* keep empty */
  }
  // 磁盘覆盖内置；内置补洞
  memory = {
    version: CACHE_VERSION,
    updatedAt: disk.updatedAt,
    byUrl: { ...bundled, ...disk.byUrl }
  }
  return memory
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistCache()
  }, 800)
}

function persistCache(): void {
  const c = loadCache()
  const keys = Object.keys(c.byUrl)
  if (keys.length > MAX_CACHE_ENTRIES) {
    // 丢掉最旧 fetchedAt
    const ranked = keys
      .map((k) => ({ k, at: c.byUrl[k]?.fetchedAt || 0 }))
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_CACHE_ENTRIES)
    const next: RssFeedMetricsMap = {}
    for (const { k } of ranked) next[k] = c.byUrl[k]!
    c.byUrl = next
  }
  c.updatedAt = Date.now()
  try {
    const p = cachePath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(c))
  } catch {
    /* ignore disk errors */
  }
}

/** 发现/远程结果写入缓存，供目录排序复用。 */
export function ingestRssFeedMetrics(
  items: Array<{ url: string; subscribers?: number; updatedAt?: number }>
): void {
  const c = loadCache()
  const now = Date.now()
  let changed = false
  for (const it of items) {
    const key = rssFeedMetricKey(it.url)
    if (!key) continue
    if (typeof it.subscribers !== 'number' && !(typeof it.updatedAt === 'number' && it.updatedAt > 0)) {
      continue
    }
    const prev = c.byUrl[key]
    const next = mergeRssFeedMetric(prev, {
      subscribers: it.subscribers,
      updatedAt: it.updatedAt,
      fetchedAt: now
    })
    c.byUrl[key] = next
    changed = true
  }
  if (changed) scheduleSave()
}

export function peekRssFeedMetrics(urls: string[]): RssFeedMetricsMap {
  const c = loadCache()
  const out: RssFeedMetricsMap = {}
  for (const url of urls) {
    const key = rssFeedMetricKey(url)
    if (!key) continue
    const m = c.byUrl[key]
    if (m) out[key] = m
  }
  return out
}

async function fetchJson(url: string, ms = 8000): Promise<unknown | null> {
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

async function fetchText(url: string, ms = 8000): Promise<string | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'CPET-RSS/0.4 (+https://github.com/cursor-pet)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function parseFeedlyMatch(
  raw: unknown,
  wantUrl: string
): { subscribers?: number; updatedAt?: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results)) return null
  const want = rssFeedMetricKey(wantUrl)
  let best: { subscribers?: number; updatedAt?: number } | null = null
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const feedId = typeof o.feedId === 'string' ? o.feedId : ''
    const href = (feedId.startsWith('feed/') ? feedId.slice(5) : feedId).trim()
    if (!href) continue
    const key = rssFeedMetricKey(href)
    const subscribers =
      typeof o.subscribers === 'number'
        ? o.subscribers
        : typeof o.estimatedInterest === 'number'
          ? o.estimatedInterest
          : undefined
    const lastUpdated = o.lastUpdated
    let updatedAt: number | undefined
    if (typeof lastUpdated === 'number' && Number.isFinite(lastUpdated) && lastUpdated > 0) {
      updatedAt = lastUpdated < 1e12 ? lastUpdated * 1000 : lastUpdated
    }
    if (key === want) {
      return { subscribers, updatedAt }
    }
    // 同 host 弱匹配：仅在还没有精确命中时留一份
    if (!best && subscribers != null) {
      try {
        if (new URL(href).hostname === new URL(wantUrl).hostname) {
          best = { subscribers, updatedAt }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return best
}

async function probeFeedFreshness(url: string): Promise<number | undefined> {
  const raw = await fetchText(url, 7000)
  if (!raw) return undefined
  try {
    const parsed = parseFeedXml(raw, url, 3)
    let best = 0
    for (const e of parsed.entries) {
      if (typeof e.publishedAt === 'number' && e.publishedAt > best) best = e.publishedAt
    }
    return best > 0 ? best : undefined
  } catch {
    return undefined
  }
}

async function feedlyLookup(
  url: string,
  name?: string
): Promise<{ subscribers?: number; updatedAt?: number } | null> {
  const queries = [url]
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host) queries.push(host)
  } catch {
    /* ignore */
  }
  if (name && name.trim() && name.trim() !== url) queries.push(name.trim())

  let subscribers: number | undefined
  let updatedAt: number | undefined
  for (const q of queries) {
    const feedlyUrl = `${FEEDLY_SEARCH}?query=${encodeURIComponent(q)}&count=8`
    const json = await fetchJson(feedlyUrl)
    const hit = parseFeedlyMatch(json, url)
    if (!hit) continue
    if (typeof hit.subscribers === 'number') subscribers = hit.subscribers
    if (typeof hit.updatedAt === 'number' && hit.updatedAt > 0) {
      updatedAt = Math.max(updatedAt || 0, hit.updatedAt)
    }
    if (typeof subscribers === 'number') break
  }
  if (typeof subscribers !== 'number' && !(typeof updatedAt === 'number' && updatedAt > 0)) {
    return null
  }
  return { subscribers, updatedAt }
}

async function enrichOne(
  url: string,
  name?: string
): Promise<RssFeedMetric | undefined> {
  const key = rssFeedMetricKey(url)
  if (!key) return undefined
  const c = loadCache()
  const prev = c.byUrl[key]
  const needSub = rssMetricNeedsSubscribers(prev)
  const needFresh = rssMetricNeedsFreshness(prev)
  if (!needSub && !needFresh) return prev

  const now = Date.now()
  let subscribers = prev?.subscribers
  let updatedAt = prev?.updatedAt

  // Feedly 与直拉并行，避免串行超时把「回填中」拖成空转
  const jobs: Array<Promise<void>> = []
  if (needSub) {
    jobs.push(
      feedlyLookup(url, name).then((hit) => {
        if (!hit) return
        if (typeof hit.subscribers === 'number') subscribers = hit.subscribers
        if (typeof hit.updatedAt === 'number' && hit.updatedAt > 0) {
          updatedAt = Math.max(updatedAt || 0, hit.updatedAt)
        }
      })
    )
  }
  if (needFresh) {
    jobs.push(
      probeFeedFreshness(url).then((fresh) => {
        if (fresh) updatedAt = Math.max(updatedAt || 0, fresh)
      })
    )
  }
  if (jobs.length) await Promise.all(jobs)

  // 无论有没有数都写入 fetchedAt：负缓存，UI 不再假装一直在回填
  const next = mergeRssFeedMetric(prev, { subscribers, updatedAt, fetchedAt: now })
  c.byUrl[key] = next
  scheduleSave()
  return next
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx]!)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

type LookupItem = { url: string; name?: string }

function normalizeLookupItems(payload: {
  urls?: string[]
  items?: Array<{ url?: string; name?: string }>
}): LookupItem[] {
  const out: LookupItem[] = []
  const seen = new Set<string>()
  const push = (url: string, name?: string): void => {
    const u = url.trim()
    const key = rssFeedMetricKey(u)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ url: u, name: name?.trim() || undefined })
  }
  if (Array.isArray(payload?.items)) {
    for (const it of payload.items) {
      if (it && typeof it.url === 'string') push(it.url, typeof it.name === 'string' ? it.name : undefined)
    }
  }
  if (Array.isArray(payload?.urls)) {
    for (const u of payload.urls) {
      if (typeof u === 'string') push(u)
    }
  }
  return out.slice(0, 80)
}

/**
 * 查询指标：先返回缓存，再按需回填。
 * enrich=false 时只读缓存（含内置 sidecar）。
 */
export async function lookupRssFeedMetrics(payload: {
  urls?: string[]
  items?: Array<{ url?: string; name?: string }>
  enrich?: boolean
}): Promise<{ ok: boolean; metrics: RssFeedMetricsMap }> {
  const items = normalizeLookupItems(payload || {})
  const urls = items.map((it) => it.url)
  const enrich = payload?.enrich !== false
  const cached = peekRssFeedMetrics(urls)
  if (!enrich || items.length === 0) {
    return { ok: true, metrics: cached }
  }

  const need = items.filter((it) => {
    const key = rssFeedMetricKey(it.url)
    const m = key ? loadCache().byUrl[key] : undefined
    return rssMetricNeedsSubscribers(m) || rssMetricNeedsFreshness(m)
  })

  await mapPool(need, LOOKUP_CONCURRENCY, async (it) => {
    const key = rssFeedMetricKey(it.url)
    if (!key) return
    let p = inFlight.get(key)
    if (!p) {
      p = enrichOne(it.url, it.name).finally(() => {
        inFlight.delete(key)
      })
      inFlight.set(key, p)
    }
    await p
  })

  return { ok: true, metrics: peekRssFeedMetrics(urls) }
}

/** 后台暖缓存：不阻塞 UI；用于目录打开后的后续行。 */
export function warmRssFeedMetrics(urls: string[]): void {
  const list = urls.filter((u) => typeof u === 'string' && u.trim()).slice(0, 120)
  if (!list.length) return
  void lookupRssFeedMetrics({ urls: list, enrich: true })
}
