#!/usr/bin/env node
/**
 * 从 Folo Discover 热门榜拉取源，探测可用后合并进 rss-catalog.json。
 * 用法：
 *   node scripts/import-folo-trending.mjs
 *   node scripts/import-folo-trending.mjs --force   # 探测失败也入库（与 Folo 榜单对齐）
 * 可选：RSSHUB_BASE=https://rsshub.app
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'src/shared/data/rss-catalog.json')
const assetsPath = join(root, 'assets/rss-catalog.json')
const RSSHUB = (process.env.RSSHUB_BASE || 'https://rsshub.rssforever.com').replace(/\/$/, '')
const TRENDING = 'https://api.follow.is/trending/feeds'
const FORCE = process.argv.includes('--force')

function toHttpUrl(url) {
  if (!url) return null
  if (url.startsWith('rsshub://')) {
    return `${RSSHUB}/${url.slice('rsshub://'.length).replace(/^\/+/, '')}`
  }
  if (/^https?:\/\//i.test(url)) return url
  return null
}

function guessCategory(view, title, url) {
  const t = `${title} ${url}`.toLowerCase()
  if (/热搜|热榜|tophub|hot-list|trending/.test(t)) return 'hot'
  if (view === 1 || /twitter|weibo|小红书|instagram|douyin|telegram/.test(t)) return 'social'
  if (/youtube|bilibili|影视|电影/.test(t)) return 'media'
  if (view === 2) return 'design'
  if (/ai|anthropic|openai|llm/.test(t)) return 'ai'
  if (/github|dev|编程|linux|hacker|product hunt|掘金|v2ex/.test(t)) return 'dev'
  if (/财经|华尔街|证券|economist|金融|麦肯锡/.test(t)) return 'finance'
  if (/科学|nasa|航天|arxiv/.test(t)) return 'science'
  if (/游戏|steam|nintendo|game/.test(t)) return 'game'
  if (/国际|早报|世界/.test(t)) return 'world'
  if (/blog|博客|substack/.test(t)) return 'blog'
  if (/新闻|资讯|热文|cnbeta|虎嗅|36氪|知乎/.test(t)) return 'news'
  return 'tech'
}

function feedKey(url) {
  try {
    return new URL(url).href.toLowerCase()
  } catch {
    return String(url || '').toLowerCase()
  }
}

function rsshubPath(url) {
  const m = String(url).match(/rsshub\.(?:app|rssforever\.com)(\/.*)$/i)
  return m ? m[1].toLowerCase() : null
}

async function probe(url, ms = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'CPET-folo-import/1.0',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      redirect: 'follow'
    })
    const text = await res.text()
    const ok =
      res.ok &&
      /<(rss|feed|item|entry)\b/i.test(text) &&
      !/^<!DOCTYPE html/i.test(text.trim()) &&
      text.length > 250
    return ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

function slugId(title, url) {
  const base = `${title || url}`
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36)
  return `folo-${base || 'feed'}`.slice(0, 48)
}

const payload = JSON.parse(readFileSync(catalogPath, 'utf8'))
const feeds = Array.isArray(payload.feeds) ? [...payload.feeds] : []
const seen = new Set(feeds.map((f) => feedKey(f.url)))
const seenPaths = new Set(feeds.map((f) => rsshubPath(f.url)).filter(Boolean))

const res = await fetch(TRENDING, {
  headers: {
    accept: 'application/json',
    'user-agent': 'CPET-folo-import/1.0',
    origin: 'https://app.folo.is',
    referer: 'https://app.folo.is/discover/category/all'
  }
})
if (!res.ok) {
  console.error(`trending fetch failed: ${res.status}`)
  process.exit(1)
}
const body = await res.json()
const items = Array.isArray(body.data) ? body.data : []
let added = 0
let skipped = 0
let failed = 0

for (const item of items) {
  const feed = item.feed || {}
  const http = toHttpUrl(feed.url)
  const title = String(feed.title || feed.url || '').trim()
  if (!http || !title) {
    skipped++
    continue
  }
  const key = feedKey(http)
  const path = rsshubPath(http)
  if (seen.has(key) || (path && seenPaths.has(path))) {
    skipped++
    continue
  }
  const ok = FORCE ? true : await probe(http)
  if (!ok) {
    failed++
    console.log(`fail  ${title}`)
    continue
  }
  if (FORCE) {
    const probed = await probe(http)
    if (!probed) console.log(`force ${title} (probe failed, still adding)`)
  }
  const id = slugId(title, http)
  feeds.unshift({
    id,
    name: title.slice(0, 80),
    url: http,
    desc: String(feed.description || title)
      .replace(/\s+/g, ' ')
      .slice(0, 120),
    category: guessCategory(item.view, title, feed.url || ''),
    ...(typeof item.analytics?.subscriptionCount === 'number'
      ? { subscribers: item.analytics.subscriptionCount }
      : {})
  })
  seen.add(key)
  if (path) seenPaths.add(path)
  added++
  console.log(`ok    ${title}`)
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: feeds.length,
  feeds
}
mkdirSync(dirname(catalogPath), { recursive: true })
writeFileSync(catalogPath, JSON.stringify(out))
writeFileSync(assetsPath, JSON.stringify(out))
console.log(
  `folo trending: +${added} added, ${skipped} skipped, ${failed} failed → ${feeds.length} total`
)
