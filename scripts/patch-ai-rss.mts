/**
 * 同步内置 AI RSS 精选源到本机 chat-store 与 ai-rss-feeds.snapshot.json。
 * 用法：npx tsx scripts/patch-ai-rss.mts [--watch]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_RSS_CURATED_FEEDS,
  AI_RSS_TASK_ID,
  AI_RSS_TASK_TITLE
} from '../src/shared/aiRssFeeds.ts'
import { parseFeedXml, rssSourceLabel } from '../src/shared/rssBrief.ts'
import {
  feedIdFromUrl,
  mergeRssTaskItems,
  normalizeRssTaskFeeds,
  RSS_TASK_PER_FEED,
  type RssTaskEntry
} from '../src/shared/rssTask.ts'

const STORE = join(process.env.HOME!, 'Library/Application Support/cursor-pet/chat-store.json')
const SNAPSHOT = join(process.env.HOME!, 'Library/Application Support/cursor-pet/ai-rss-feeds.snapshot.json')
const WATCH_MS = 240_000
const watch = process.argv.includes('--watch')

const titleByUrl = new Map(AI_RSS_CURATED_FEEDS.map((f) => [f.url, f.title]))

async function fetchFeed(url: string): Promise<{ items: RssTaskEntry[]; title: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 25_000)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'CPET-RSS/0.5 (+https://github.com/cursor-pet)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      redirect: 'follow'
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.text()
    const feedId = feedIdFromUrl(url)
    const parsed = parseFeedXml(raw, url, RSS_TASK_PER_FEED)
    const title = titleByUrl.get(url) || parsed.feedTitle || rssSourceLabel(url)
    const now = Date.now()
    const items: RssTaskEntry[] = parsed.entries.map((e) => ({
      id: e.id,
      feedId,
      title: e.title,
      url: e.url,
      feedTitle: title,
      snippet: e.snippet,
      contentHtml: e.contentHtml,
      contentSource: e.contentHtml ? ('feed' as const) : undefined,
      fetchedAt: now,
      publishedAt: e.publishedAt
    }))
    return { items, title }
  } finally {
    clearTimeout(timer)
  }
}

async function buildFetched(): Promise<{ feeds: ReturnType<typeof normalizeRssTaskFeeds>; items: RssTaskEntry[] }> {
  const urls = AI_RSS_CURATED_FEEDS.map((f) => f.url)
  const feeds = normalizeRssTaskFeeds(
    urls.map((url) => ({ url, title: titleByUrl.get(url) }))
  )
  const allItems: RssTaskEntry[] = []
  const errors: string[] = []
  for (const f of feeds) {
    try {
      const { items } = await fetchFeed(f.url)
      allItems.push(...items)
      process.stdout.write(`✓ ${f.title || f.url} (${items.length})\n`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${f.title || f.url}: ${msg}`)
      process.stderr.write(`✗ ${f.title || f.url}: ${msg}\n`)
    }
  }
  if (errors.length) {
    process.stderr.write(`\n${errors.length} 源拉取失败，仍写入可用源。\n`)
  }
  allItems.sort((a, b) => (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt))
  return { feeds, items: allItems }
}

function findAiConvIndex(store: { conversations: unknown[] }): number {
  return store.conversations.findIndex(
    (c) =>
      c &&
      typeof c === 'object' &&
      (c as { kind?: string }).kind === 'rss' &&
      ((c as { title?: string }).title === AI_RSS_TASK_TITLE ||
        (c as { id?: string }).id === AI_RSS_TASK_ID)
  )
}

function patchStore(fetched: { feeds: ReturnType<typeof normalizeRssTaskFeeds>; items: RssTaskEntry[] }) {
  if (!existsSync(STORE)) {
    console.error('chat-store.json 不存在:', STORE)
    process.exit(1)
  }
  const store = JSON.parse(readFileSync(STORE, 'utf8'))
  const idx = findAiConvIndex(store)
  if (idx < 0) {
    console.error('未找到 AI RSS 任务')
    process.exit(1)
  }
  const conv = store.conversations[idx]
  const rss = conv.rss || {}
  const merged = mergeRssTaskItems(rss.items || [], fetched.items)
  merged.sort((a, b) => (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt))
  store.conversations[idx] = {
    ...conv,
    rss: {
      ...rss,
      feeds: fetched.feeds,
      items: merged.slice(0, 1000),
      updatedAt: Date.now(),
      lastError: undefined
    },
    updatedAt: Date.now()
  }
  writeFileSync(STORE, JSON.stringify(store))
  writeFileSync(SNAPSHOT, JSON.stringify({ feeds: fetched.feeds, items: fetched.items }, null, 0))
  return { feeds: fetched.feeds.length, items: merged.length }
}

function urlsSignature(feeds: Array<{ url?: string }>): string {
  return feeds.map((f) => String(f?.url || '').trim()).filter(Boolean).sort().join('\n')
}

function needsReapply(conv: { rss?: { feeds?: unknown[]; items?: unknown[] } }, fetched: {
  feeds: Array<{ url?: string }>
}): boolean {
  const rss = conv.rss || {}
  const desired = urlsSignature(fetched.feeds)
  const current = urlsSignature((rss.feeds as Array<{ url?: string }>) || [])
  const hasExtra = ((rss.items as Array<{ feedId?: string }>) || []).some((it) =>
    fetched.feeds.some((f) => f.url && feedIdFromUrl(f.url) === it.feedId && f.url !== 'https://36kr.com/feed')
  )
  return current !== desired || !hasExtra || (rss.feeds || []).length !== fetched.feeds.length
}

async function main() {
  console.log(`拉取 ${AI_RSS_CURATED_FEEDS.length} 个 AI 精选源…`)
  const fetched = await buildFetched()
  const r = patchStore(fetched)
  console.log(`已写入：${r.feeds} 源 · ${r.items} 条`)

  if (!watch) return

  console.log(`守护 ${WATCH_MS / 1000}s，防止运行中 CPET 覆盖…`)
  let reapplied = 0
  const started = Date.now()
  const iv = setInterval(() => {
    if (!existsSync(STORE)) return
    const store = JSON.parse(readFileSync(STORE, 'utf8'))
    const idx = findAiConvIndex(store)
    if (idx < 0) return
    const conv = store.conversations[idx]
    if (needsReapply(conv, fetched)) {
      patchStore(fetched)
      reapplied++
      if (reapplied <= 5 || reapplied % 20 === 0) console.log(`[reapply] #${reapplied}`)
    }
    if (Date.now() - started > WATCH_MS) {
      clearInterval(iv)
      patchStore(fetched)
      console.log('守护结束, reapplied=', reapplied)
      process.exit(0)
    }
  }, 300)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
