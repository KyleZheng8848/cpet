/** 浅层 RSS/Atom 解析：只要标题/链接/摘要，不做阅读器。 */

import { RSS_FEED_PRESETS } from './rssPresets'
import type { RssFeedPreset, RssPresetCategory } from './rssPresets'

export {
  RSS_FEED_PRESETS,
  RSS_PRESET_CATEGORIES,
  type RssFeedPreset,
  type RssPresetCategory
} from './rssPresets'

/** 设置页 / 宠物收件箱默认订阅上限。 */
export const RSS_SETTINGS_MAX_FEEDS = 20
const MAX_FEEDS = RSS_SETTINGS_MAX_FEEDS
const MAX_URL_LEN = 500

/** @deprecated 用 RSS_FEED_PRESETS */
export const BRIEF_RSS_PRESETS = RSS_FEED_PRESETS

/** 草稿/列表里是否已含该 URL（忽略尾斜杠差异）。 */
export function rssDraftHasUrl(draft: string, url: string): boolean {
  const want = normalizeFeedKey(url)
  if (!want) return false
  return draft
    .split(/\r?\n/)
    .map((s) => normalizeFeedKey(s.trim()))
    .some((k) => k === want)
}

/** 在多行草稿里切换某一源（已有则移除，否则追加）。 */
export function toggleUrlInRssDraft(draft: string, url: string): string {
  const want = normalizeFeedKey(url)
  if (!want) return draft
  const lines = draft.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const next = lines.filter((line) => normalizeFeedKey(line) !== want)
  if (next.length === lines.length) next.push(url.trim())
  return next.join('\n')
}

function normalizeFeedKey(url: string): string {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    u.hash = ''
    let href = u.href
    if (href.endsWith('/')) href = href.slice(0, -1)
    return href.toLowerCase()
  } catch {
    return ''
  }
}

export function filterRssPresets(
  presets: ReadonlyArray<RssFeedPreset>,
  opts: { category?: RssPresetCategory | 'all'; query?: string }
): RssFeedPreset[] {
  const cat = opts.category || 'all'
  const q = (opts.query || '').trim().toLowerCase()
  return presets.filter((p) => {
    if (cat !== 'all' && p.category !== cat) return false
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      p.desc.toLowerCase().includes(q) ||
      p.url.toLowerCase().includes(q)
    )
  })
}

export function mergeRssFeedUrls(existing: string[], addUrl: string): string[] {
  return normalizeRssFeedUrls([...existing, addUrl])
}

/** 从 host 去 www. 便于条目 URL 与 feed URL 对齐。 */
export function rssHostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

type BriefFeedStore = {
  conversations?: ReadonlyArray<{ kind?: string; rss?: { feeds?: ReadonlyArray<{ url?: string }> } }>
} | null | undefined

/** 是否已有 RSS 任务（不论里面有没有源）。 */
export function hasRssTaskConversation(store: BriefFeedStore): boolean {
  return !!store?.conversations?.some((c) => c.kind === 'rss')
}

/**
 * 汇总所有 RSS 任务里当前仍订阅的源。
 * 宠物收件箱优先跟任务走，避免「任务里没订、气泡还在推」。
 */
export function collectRssTaskFeedUrls(store: BriefFeedStore, maxFeeds = MAX_FEEDS): string[] {
  const urls: string[] = []
  for (const c of store?.conversations || []) {
    if (c.kind !== 'rss' || !c.rss?.feeds?.length) continue
    for (const f of c.rss.feeds) {
      if (typeof f?.url === 'string' && f.url.trim()) urls.push(f.url)
    }
  }
  return normalizeRssFeedUrls(urls, maxFeeds)
}

/**
 * 宠物简报实际拉取的源：仅来自 RSS 任务订阅并集。
 * 无任务或任务源为空 → 空列表（不再回退 HN/V2EX）。
 * 不再读取设置里的 briefRssFeeds（该全局源已废弃）。
 */
export function resolvePetBriefFeedUrls(
  store: BriefFeedStore,
  maxFeeds = MAX_FEEDS
): string[] {
  if (!hasRssTaskConversation(store)) return []
  return collectRssTaskFeedUrls(store, maxFeeds)
}

/** RSS 简报条目是否仍属于当前允许的订阅源（按主机名）。 */
export function briefRssItemMatchesFeeds(
  item: { source?: string; url?: string },
  feedUrls: readonly string[]
): boolean {
  if (item.source !== 'rss') return true
  if (!feedUrls.length) return false
  const hosts = new Set(
    feedUrls.map((u) => rssHostKey(u)).filter(Boolean)
  )
  const host = rssHostKey(item.url || '')
  return !!host && hosts.has(host)
}

/** 规范化用户填写的 RSS 地址列表。 */
export function normalizeRssFeedUrls(raw: unknown, maxFeeds = MAX_FEEDS): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/\r?\n/)
      : []
  const limit = Math.max(1, Math.min(500, maxFeeds))
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of list) {
    if (typeof row !== 'string') continue
    const u = row.trim()
    if (!u || u.startsWith('#')) continue
    if (u.length > MAX_URL_LEN) continue
    let parsed: URL
    try {
      parsed = new URL(u)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    const key = parsed.href
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= limit) break
  }
  return out
}

export type ParsedFeedEntry = {
  id: string
  title: string
  url: string
  snippet?: string
  /** 条目内嵌 HTML（description / content:encoded），未净化。 */
  contentHtml?: string
  /** enclosure / media:thumbnail / itunes:image。 */
  imageUrl?: string
  publishedAt?: number
}

/** 实体解码：先 &amp; 再 &lt;，并多轮解开 `&amp;lt;img` 这类双重转义。 */
export function decodeXml(s: string): string {
  let out = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;/gi, ' ')
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
      .replace(/&hellip;/gi, '…')
      .replace(/&rsquo;|&lsquo;/gi, "'")
      .replace(/&rdquo;|&ldquo;/gi, '"')
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n)
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : _
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
        const code = parseInt(h, 16)
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : _
      })
    if (next === out) break
    out = next
  }
  return out
}

function stripTags(s: string): string {
  return decodeXml(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u00a0\u202f\u205f\u3000]/g, ' ')
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  return m ? stripTags(m[1]) : ''
}

/** 保留标签的原文（CDATA 已展开）。 */
function tagInnerHtml(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return ''
  return decodeXml(m[1]).trim()
}

function parseRssDate(s: string): number | undefined {
  if (!s.trim()) return undefined
  const t = Date.parse(s.trim())
  return Number.isFinite(t) ? t : undefined
}

function linkHref(block: string): string {
  const atom = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)
  if (atom?.[1]) return atom[1].trim()
  const rss = tagText(block, 'link')
  if (rss) return rss
  return ''
}

function feedLabelFromUrl(feedUrl: string): string {
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'RSS'
  }
}

export function rssSourceLabel(feedUrl: string, feedTitle?: string): string {
  const t = (feedTitle || '').trim()
  if (t) return t.slice(0, 24)
  return feedLabelFromUrl(feedUrl)
}

function looksLikeImageUrl(url: string, type = ''): boolean {
  if (/^image\//i.test(type)) return true
  return /\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i.test(url)
}

function feedEntryImage(block: string): string | undefined {
  const media =
    block.match(/<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i)?.[1] ||
    block.match(/<media:content\b[^>]*\bmedium=["']image["'][^>]*\burl=["']([^"']+)["']/i)?.[1] ||
    block.match(/<media:content\b[^>]*\burl=["']([^"']+)["'][^>]*\bmedium=["']image["']/i)?.[1] ||
    block.match(/<itunes:image\b[^>]*\bhref=["']([^"']+)["']/i)?.[1]
  if (media?.trim()) return media.trim()
  for (const m of block.matchAll(/<enclosure\b[^>]*>/gi)) {
    const tag = m[0]
    const url = tag.match(/\burl=["']([^"']+)["']/i)?.[1]?.trim()
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1] || ''
    if (url && looksLikeImageUrl(url, type)) return url
  }
  return undefined
}

function stableId(feedUrl: string, guid: string, link: string, title: string): string {
  const raw = guid || link || title
  let h = 0
  const s = `${feedUrl}|${raw}`
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `rss:${(h >>> 0).toString(36)}`
}

/** 从 RSS 2.0 / Atom XML 抽条目（最多 limit 条）。 */
export function parseFeedXml(xml: string, feedUrl: string, limit = 6): {
  feedTitle?: string
  entries: ParsedFeedEntry[]
} {
  if (!xml || typeof xml !== 'string') return { entries: [] }
  const feedTitle =
    tagText(xml, 'title') ||
    (() => {
      const m = xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)
      return m ? stripTags(m[1]) : ''
    })() ||
    undefined

  const items: string[] = []
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi
  const entryRe = /<entry[\s>][\s\S]*?<\/entry>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) && items.length < limit * 2) items.push(m[0])
  while ((m = entryRe.exec(xml)) && items.length < limit * 2) items.push(m[0])

  const entries: ParsedFeedEntry[] = []
  for (const block of items) {
    const title = tagText(block, 'title')
    const url = linkHref(block)
    if (!title || !url) continue
    const guid = tagText(block, 'guid') || tagText(block, 'id')
    const htmlRaw =
      tagInnerHtml(block, 'content:encoded') ||
      tagInnerHtml(block, 'content') ||
      tagInnerHtml(block, 'description') ||
      tagInnerHtml(block, 'summary')
    const snippetRaw = stripTags(htmlRaw)
    const snippet = snippetRaw ? snippetRaw.slice(0, 160) : undefined
    const publishedAt =
      parseRssDate(tagText(block, 'pubDate')) ||
      parseRssDate(tagText(block, 'published')) ||
      parseRssDate(tagText(block, 'updated'))
    const imageUrl = feedEntryImage(block)
    entries.push({
      id: stableId(feedUrl, guid, url, title),
      title: title.slice(0, 200),
      url,
      snippet,
      contentHtml:
        htmlRaw && (/</.test(htmlRaw) || /&lt;\s*[a-z]/i.test(htmlRaw))
          ? htmlRaw.slice(0, 80_000)
          : undefined,
      ...(imageUrl ? { imageUrl } : {}),
      publishedAt
    })
    if (entries.length >= limit) break
  }
  return { feedTitle: feedTitle?.slice(0, 48), entries }
}
