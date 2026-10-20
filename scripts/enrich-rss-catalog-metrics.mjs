#!/usr/bin/env node
/**
 * 离线/批量回填目录指标 → src/shared/data/rss-catalog-metrics.json
 * 用法：
 *   node scripts/enrich-rss-catalog-metrics.mjs            # 默认前 80 条
 *   node scripts/enrich-rss-catalog-metrics.mjs --limit=200
 *   node scripts/enrich-rss-catalog-metrics.mjs --all      # 全量（慢）
 *
 * 订阅数：Feedly search；更新时间：Feedly lastUpdated 或直拉源最新条目。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'src/shared/data/rss-catalog.json')
const metricsPath = join(root, 'src/shared/data/rss-catalog-metrics.json')
const FEEDLY = 'https://cloud.feedly.com/v3/search/feeds'

const args = process.argv.slice(2)
const all = args.includes('--all')
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = all ? Infinity : Number(limitArg?.split('=')[1] || 80)

function metricKey(url) {
  try {
    const u = new URL(url)
    u.hash = ''
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '')
    }
    return u.href.toLowerCase()
  } catch {
    return String(url || '').toLowerCase()
  }
}

async function fetchJson(url, ms = 9000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'CPET-metrics/0.1' }
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function fetchText(url, ms = 8000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'CPET-metrics/0.1'
      }
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function parseRssDate(s) {
  if (!s) return 0
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

function feedFreshness(xml) {
  if (!xml) return 0
  const blocks = [
    ...(xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [])
  ].slice(0, 3)
  let best = 0
  for (const b of blocks) {
    const m =
      b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      b.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
      b.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)
    const at = parseRssDate(m?.[1]?.replace(/<[^>]+>/g, '').trim())
    if (at > best) best = at
  }
  return best
}

function parseFeedly(json, wantUrl) {
  const want = metricKey(wantUrl)
  const results = json?.results
  if (!Array.isArray(results)) return null
  for (const o of results) {
    const feedId = typeof o.feedId === 'string' ? o.feedId : ''
    const href = (feedId.startsWith('feed/') ? feedId.slice(5) : feedId).trim()
    if (metricKey(href) !== want) continue
    const subscribers =
      typeof o.subscribers === 'number'
        ? o.subscribers
        : typeof o.estimatedInterest === 'number'
          ? o.estimatedInterest
          : undefined
    let updatedAt
    if (typeof o.lastUpdated === 'number' && o.lastUpdated > 0) {
      updatedAt = o.lastUpdated < 1e12 ? o.lastUpdated * 1000 : o.lastUpdated
    }
    return { subscribers, updatedAt }
  }
  return null
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
let prev = { version: 1, byUrl: {} }
try {
  prev = JSON.parse(readFileSync(metricsPath, 'utf8'))
} catch {
  /* fresh */
}
const byUrl = { ...(prev.byUrl || {}) }
const feeds = (catalog.feeds || []).slice(0, Number.isFinite(limit) ? limit : undefined)
let ok = 0
for (let i = 0; i < feeds.length; i++) {
  const f = feeds[i]
  const key = metricKey(f.url)
  process.stdout.write(`[${i + 1}/${feeds.length}] ${f.name}… `)
  const feedly = await fetchJson(`${FEEDLY}?query=${encodeURIComponent(f.url)}&count=6`)
  const hit = parseFeedly(feedly, f.url)
  let subscribers = hit?.subscribers
  let updatedAt = hit?.updatedAt
  if (!updatedAt) {
    const xml = await fetchText(f.url)
    const fresh = feedFreshness(xml)
    if (fresh) updatedAt = fresh
  }
  if (typeof subscribers === 'number' || (updatedAt && updatedAt > 0)) {
    byUrl[key] = {
      ...(typeof subscribers === 'number' ? { subscribers } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      fetchedAt: Date.now()
    }
    ok++
    console.log(
      [
        typeof subscribers === 'number' ? `sub=${subscribers}` : null,
        updatedAt ? `fresh=${new Date(updatedAt).toISOString().slice(0, 10)}` : null
      ]
        .filter(Boolean)
        .join(' ') || 'partial'
    )
  } else {
    console.log('miss')
  }
  await new Promise((r) => setTimeout(r, 120))
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: Object.keys(byUrl).length,
  byUrl
}
writeFileSync(metricsPath, JSON.stringify(out, null, 2))
console.log(`done: wrote ${ok} this run, cache size ${out.count} → ${metricsPath}`)
