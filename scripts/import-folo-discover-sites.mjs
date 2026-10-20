#!/usr/bin/env node
/**
 * 从 Folo Discover「Browse supported websites」对应的 RSSHub 命名空间入库。
 * API: https://api.follow.is/discover/rsshub?categories=…
 *
 * 用法：
 *   node scripts/import-folo-discover-sites.mjs
 *   node scripts/import-folo-discover-sites.mjs --force
 *   node scripts/import-folo-discover-sites.mjs --categories=popular,new-media
 * 可选：RSSHUB_BASE=https://rsshub.rssforever.com
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'src/shared/data/rss-catalog.json')
const assetsPath = join(root, 'assets/rss-catalog.json')
const RSSHUB = (process.env.RSSHUB_BASE || 'https://rsshub.rssforever.com').replace(/\/$/, '')
const FORCE = process.argv.includes('--force')
const catArg = process.argv.find((a) => a.startsWith('--categories='))
const CATEGORIES = (catArg ? catArg.slice('--categories='.length) : '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const DEFAULT_CATEGORIES = [
  'popular',
  'new-media',
  'traditional-media',
  'programming',
  'finance',
  'blog',
  'social-media',
  'journal',
  'design',
  'reading',
  'multimedia',
  'game',
  'anime'
]

/** 成人类 / 明显不适配桌宠发现库的命名空间 */
const NSFW_NS = new Set(
  [
    'pornhub',
    'javbus',
    'javtiful',
    'javdb',
    'javlibrary',
    'javtrailers',
    '91porn',
    'missav',
    'misskon',
    'hanime1',
    'spankbang',
    '141ppv',
    '141jav',
    't66y',
    '2048',
    'xsijishe',
    'jpxgmn',
    'sis001',
    'xbookcn',
    'kemono',
    'coomer',
    'sehuatang',
    'wnacg',
    'cool18',
    'ehentai',
    'e-hentai',
    'nhentai',
    'gelbooru',
    'konachan',
    'yande',
    'oreno3d',
    'ntrblog',
    'asiantolick',
    'manyvids',
    'netflav',
    'f95zone',
    'dlsite',
    'fantia',
    'fansly',
    'literotica',
    'playno1',
    'uraaka-joshi',
    'chikubi',
    'mmda',
    'booru',
    'abskoop',
    'everia',
    '4kup',
    '4khd',
    'cosplaytele',
    'iwara',
    'myfans',
    '7mmtv',
    '18comic',
    'nhentai',
    'hjd2048'
  ].map((s) => s.toLowerCase())
)

const HEADERS = {
  accept: 'application/json',
  'user-agent': 'CPET-folo-discover/1.0',
  origin: 'https://app.folo.is',
  referer: 'https://app.folo.is/discover'
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

function guessCategory(categories, title, path) {
  const blob = `${(categories || []).join(' ')} ${title} ${path}`.toLowerCase()
  if (/tophub|热搜|热榜|hot-list|trending|排行/.test(blob)) return 'hot'
  if (/ai|llm|openai|anthropic|deepmind|huggingface|machine.?learning/.test(blob)) return 'ai'
  if (/finance|财经|证券|股票|fund|crypto|bitcoin|华尔街|econom/.test(blob)) return 'finance'
  if (/game|游戏|steam|nintendo|epicgames/.test(blob)) return 'game'
  if (/bilibili|youtube|影视|电影|douban\/movie|bangumi/.test(blob)) return 'media'
  if (/social-media|twitter|weibo|小红书|instagram|douyin|telegram|bluesky/.test(blob))
    return 'social'
  if (/programming|github|dev|掘金|v2ex|linux|code|developer/.test(blob)) return 'dev'
  if (/design|dribbble|behance|站酷/.test(blob)) return 'design'
  if (/journal|nature|science|科研|arxiv|nasa/.test(blob)) return 'science'
  if (/traditional-media|news|新闻|早报|bbc|reuters|nyt/.test(blob)) return 'news'
  if (/blog|博客|substack|medium/.test(blob)) return 'blog'
  if (/new-media|资讯|虎嗅|36kr|sspai|少数派|tech/.test(blob)) return 'tech'
  return 'tech'
}

function scoreRoute(rt) {
  const blob = `${rt.name || ''} ${rt.path || ''} ${rt.example || ''}`.toLowerCase()
  let s = 0
  if (!rt.example || !String(rt.example).startsWith('/')) return -999
  s += 5
  if (rt.features?.requireConfig) s -= 25
  if (rt.features?.requirePuppeteer) s -= 6
  if (rt.features?.antiCrawler) s -= 2
  if (/hot-list|\/hot\b|trending|热榜|热门|日报|daily|weekly|rank|frontpage|newsflash|资讯热/.test(blob))
    s += 14
  if (/news|资讯|博客|blog|rss|最新|头条|briefing|homepage|首页/.test(blob)) s += 8
  if (/home_latest|\/friends\b|timeline|user\/bookmarks|community\/@/.test(blob)) s -= 10
  if (/\/user\/:|\/:user|\/:id|\/:uid|\/:channel/.test(rt.path || '') && !/hot|trending|热|daily|news/.test(blob))
    s -= 4
  const segs = String(rt.example).split('/').filter(Boolean)
  if (segs.length <= 3) s += 3
  if (segs.length <= 2) s += 2
  return s
}

/** 站点级优选示例（覆盖打分偏差） */
const ROUTE_OVERRIDES = {
  github: '/github/trending/daily/any',
  twitter: '/twitter/user/GitHub',
  x: '/twitter/user/GitHub',
  bilibili: '/bilibili/ranking/0/3/1',
  youtube: '/youtube/charts',
  zhihu: '/zhihu/hot',
  weibo: '/weibo/search/hot',
  sspai: '/sspai/index',
  juejin: '/juejin/trending/all/monthly',
  '36kr': '/36kr/hot-list',
  hackernews: '/hackernews',
  v2ex: '/v2ex/topics/hot',
  pixiv: '/pixiv/ranking/day',
  xiaohongshu: '/xiaohongshu/explore',
  instagram: '/instagram/user/instagram',
  telegram: '/telegram/channel/awesomeDIYgod',
  nasa: '/nasa/apod',
  nature: '/nature/news',
  bloomberg: '/bloomberg/business',
  nytimes: '/nytimes/rss/HomePage',
  reuters: '/reuters/world',
  bbc: '/bbc/world-asia-chinese',
  anthropic: '/anthropic/research',
  openai: '/openai/blog',
  producthunt: '/producthunt/today',
  solidot: '/solidot/www',
  douban: '/douban/movie/playing',
  tophub: '/tophub/WnBe01o371'
}

function pickRoute(ns, routes) {
  const override = ROUTE_OVERRIDES[ns]
  if (override) {
    return { name: ns, example: override, path: override, features: {} }
  }
  const list = Object.values(routes || {})
  if (!list.length) return null
  return [...list].sort((a, b) => scoreRoute(b) - scoreRoute(a))[0]
}

function displayName(ns, meta, route) {
  const fromRadar = route?.radar?.[0]?.source?.[0]
  let host = ''
  if (fromRadar) {
    try {
      host = new URL(
        fromRadar.includes('://') ? fromRadar : `https://${fromRadar.split('/')[0]}`
      ).hostname.replace(/^www\./, '')
    } catch {
      host = String(fromRadar).split('/')[0]
    }
  }
  const title = String(route?.name || ns).trim()
  if (host && !title.toLowerCase().includes(host.split('.')[0])) {
    return `${ns} · ${title}`.slice(0, 80)
  }
  // Prefer namespace when route name is too generic / long
  if (title.length > 40 || /分类|用户|专栏|作者|Search/i.test(title)) {
    return String(ns).slice(0, 80)
  }
  return `${ns} · ${title}`.slice(0, 80)
}

function slugId(ns, example) {
  const base = `${ns}-${String(example || '')
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')}`
    .toLowerCase()
    .slice(0, 40)
  return `folo-site-${base || ns}`.slice(0, 48)
}

async function probe(url, ms = 10000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'CPET-folo-discover/1.0',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      redirect: 'follow'
    })
    const text = await res.text()
    return (
      res.ok &&
      /<(rss|feed|item|entry)\b/i.test(text) &&
      !/^<!DOCTYPE html/i.test(text.trim()) &&
      text.length > 250
    )
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

async function fetchCategory(category) {
  const url = `https://api.follow.is/discover/rsshub?categories=${encodeURIComponent(category)}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`discover/rsshub ${category}: ${res.status}`)
  const body = await res.json()
  return body.data || {}
}

const categories = CATEGORIES.length ? CATEGORIES : DEFAULT_CATEGORIES
/** @type {Map<string, { meta: any, categories: string[] }>} */
const namespaces = new Map()

for (const cat of categories) {
  process.stdout.write(`fetch category=${cat} … `)
  const data = await fetchCategory(cat)
  const keys = Object.keys(data)
  console.log(`${keys.length} namespaces`)
  for (const [ns, meta] of Object.entries(data)) {
    const key = String(ns).toLowerCase()
    if (NSFW_NS.has(key)) continue
    if (/porn|hentai|jav\b|nhentai|adult|nsfw|sex/.test(key)) continue
    const prev = namespaces.get(key)
    if (prev) {
      prev.categories.push(cat)
      continue
    }
    namespaces.set(key, { meta, categories: [cat] })
  }
}

console.log(`unique namespaces (nsfw filtered): ${namespaces.size}`)

const payload = JSON.parse(readFileSync(catalogPath, 'utf8'))
const feeds = Array.isArray(payload.feeds) ? [...payload.feeds] : []
const seen = new Set(feeds.map((f) => feedKey(f.url)))
const seenPaths = new Set(feeds.map((f) => rsshubPath(f.url)).filter(Boolean))
const seenNs = new Set(
  feeds
    .map((f) => {
      const p = rsshubPath(f.url)
      if (!p) return null
      return p.split('/').filter(Boolean)[0] || null
    })
    .filter(Boolean)
)

let added = 0
let skipped = 0
let failed = 0
const candidates = []

for (const [ns, { meta, categories: cats }] of namespaces) {
  if (seenNs.has(ns) && !FORCE) {
    // still allow if different path not present — but prefer one site-level feed
    skipped++
    continue
  }
  const route = pickRoute(ns, meta.routes)
  if (!route?.example || (!ROUTE_OVERRIDES[ns] && scoreRoute(route) < 0)) {
    skipped++
    continue
  }
  const path = String(route.example).startsWith('/') ? route.example : `/${route.example}`
  const http = `${RSSHUB}${path}`
  const key = feedKey(http)
  const rpath = rsshubPath(http)
  if (seen.has(key) || (rpath && seenPaths.has(rpath))) {
    skipped++
    continue
  }
  candidates.push({
    ns,
    route,
    cats,
    http,
    key,
    rpath,
    name: displayName(ns, meta, route),
    desc: String(route.name || ns)
      .replace(/\s+/g, ' ')
      .slice(0, 120),
    category: guessCategory(cats, route.name || ns, path)
  })
}

console.log(`candidates: ${candidates.length}${FORCE ? ' (--force, skip probe)' : ' (probing)'}`)

if (FORCE) {
  for (const c of candidates) {
    feeds.unshift({
      id: slugId(c.ns, c.route.example),
      name: c.name,
      url: c.http,
      desc: c.desc,
      category: c.category
    })
    seen.add(c.key)
    if (c.rpath) seenPaths.add(c.rpath)
    seenNs.add(c.ns)
    added++
  }
} else {
  const CONCURRENCY = 6
  let i = 0
  async function worker() {
    while (i < candidates.length) {
      const idx = i++
      const c = candidates[idx]
      const ok = await probe(c.http)
      if (!ok) {
        failed++
        console.log(`fail  ${c.ns}  ${c.route.example}`)
        continue
      }
      feeds.unshift({
        id: slugId(c.ns, c.route.example),
        name: c.name,
        url: c.http,
        desc: c.desc,
        category: c.category
      })
      seen.add(c.key)
      if (c.rpath) seenPaths.add(c.rpath)
      seenNs.add(c.ns)
      added++
      console.log(`ok    ${c.ns}  ${c.route.example}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
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
  `folo discover sites: +${added} added, ${skipped} skipped, ${failed} failed → ${feeds.length} total`
)
