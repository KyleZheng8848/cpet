/**
 * RSS 简报幻觉检测与修复：只允许引用订阅条目中的 URL，
 * 未知链接改写到同源条目或降级为纯文本/删除。
 */

import type { RssTaskEntry } from './rssTask'

export type DigestGuardIssue = {
  kind: 'unknown_url' | 'rewrote_url' | 'removed_link' | 'removed_line' | 'ungrounded_section'
  url?: string
  detail: string
}

export type DigestGuardResult = {
  markdown: string
  issues: DigestGuardIssue[]
  repaired: boolean
  /** 给人看的短摘要，如「已修复 3 处未接地链接」 */
  summary?: string
}

export function canonicalizeDigestUrl(raw: string): string | null {
  const s = (raw || '').trim().replace(/[.,;:!?）】»"'`]+$/g, '')
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    let path = u.pathname || ''
    if (path.length > 1) path = path.replace(/\/+$/, '')
    return `${u.protocol}//${host}${path}${u.search}`
  } catch {
    return null
  }
}

function hostOf(canon: string | null): string | null {
  if (!canon) return null
  try {
    return new URL(canon).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function digestLinkLabel(entry: RssTaskEntry): string {
  const name = (entry.feedTitle || '来源').trim().slice(0, 32) || '来源'
  const title = (entry.title || '无标题').trim().slice(0, 80)
  return `${name}：${title}`
}

export function digestEntryLink(entry: RssTaskEntry): string {
  return `[${digestLinkLabel(entry)}](${entry.url})`
}

function buildEntryIndex(entries: RssTaskEntry[]): {
  byCanon: Map<string, RssTaskEntry>
  byHost: Map<string, RssTaskEntry[]>
} {
  const byCanon = new Map<string, RssTaskEntry>()
  const byHost = new Map<string, RssTaskEntry[]>()
  for (const e of entries) {
    const c = canonicalizeDigestUrl(e.url)
    if (!c) continue
    byCanon.set(c, e)
    const h = hostOf(c)
    if (!h) continue
    const list = byHost.get(h) || []
    list.push(e)
    byHost.set(h, list)
  }
  return { byCanon, byHost }
}

/** 将任意 URL 落到条目：精确 → 前缀 → 唯一宿主。 */
export function matchEntryByUrl(
  url: string,
  entries: RssTaskEntry[],
  index = buildEntryIndex(entries)
): RssTaskEntry | undefined {
  const c = canonicalizeDigestUrl(url)
  if (!c) return undefined
  if (index.byCanon.has(c)) return index.byCanon.get(c)
  for (const [ec, e] of index.byCanon) {
    if (c.startsWith(ec) || ec.startsWith(c)) return e
  }
  const h = hostOf(c)
  if (!h) return undefined
  const sameHost = index.byHost.get(h) || []
  if (sameHost.length === 1) return sameHost[0]
  // 多条同域：挑路径重叠最多的
  let best: RssTaskEntry | undefined
  let bestScore = 0
  for (const e of sameHost) {
    const ec = canonicalizeDigestUrl(e.url)
    if (!ec) continue
    let i = 0
    const n = Math.min(c.length, ec.length)
    while (i < n && c[i] === ec[i]) i++
    if (i > bestScore) {
      bestScore = i
      best = e
    }
  }
  // 要求至少共享到 host 之后若干字符，避免乱绑
  if (best && bestScore >= (hostOf(c)?.length || 0) + 12) return best
  return sameHost.length ? sameHost[0] : undefined
}

export function matchEntryByLinkText(
  text: string,
  entries: RssTaskEntry[]
): RssTaskEntry | undefined {
  const t = (text || '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (t.length < 4) return undefined
  let best: RssTaskEntry | undefined
  let bestScore = 0
  for (const e of entries) {
    const title = (e.title || '').trim().toLowerCase()
    const label = digestLinkLabel(e).toLowerCase()
    if (!title) continue
    if (t === title || t === label || t.includes(title) || title.includes(t)) {
      const score = Math.min(t.length, title.length)
      if (score > bestScore) {
        bestScore = score
        best = e
      }
    }
  }
  return bestScore >= 6 ? best : undefined
}

function extractUrls(md: string): string[] {
  const found: string[] = []
  const re = /https?:\/\/[^\s)\]>'"]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(md))) {
    const u = m[0].replace(/[.,;:!?）】»]+$/g, '')
    if (!found.includes(u)) found.push(u)
  }
  return found
}

/** 仅检测：列出无法对应到条目的 URL。 */
export function detectDigestHallucinations(
  markdown: string,
  entries: RssTaskEntry[]
): DigestGuardIssue[] {
  const index = buildEntryIndex(entries)
  const issues: DigestGuardIssue[] = []
  for (const url of extractUrls(markdown)) {
    if (!matchEntryByUrl(url, entries, index)) {
      issues.push({
        kind: 'unknown_url',
        url,
        detail: '链接不在本期订阅条目中'
      })
    }
  }
  return issues
}

/**
 * 检测并修复：未知 URL 尽量改写到条目；无法落地则去链/删行；
 * 资料来源整段按正文仍保留的合法引用重建。
 */
export function repairDigestHallucinations(
  markdown: string,
  entries: RssTaskEntry[]
): DigestGuardResult {
  const issues: DigestGuardIssue[] = []
  if (!markdown?.trim()) {
    return { markdown: markdown || '', issues, repaired: false }
  }
  if (!entries.length) {
    return { markdown: markdown.trim(), issues, repaired: false }
  }

  const index = buildEntryIndex(entries)
  let md = markdown.replace(/\r\n/g, '\n')

  // 1) Markdown 链接 [text](url)
  md = md.replace(/\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/gi, (_full, text: string, url: string) => {
    const cleanUrl = url.replace(/[.,;:!?]+$/g, '')
    let hit = matchEntryByUrl(cleanUrl, entries, index)
    if (!hit) hit = matchEntryByLinkText(text, entries)
    if (hit) {
      const same = canonicalizeDigestUrl(hit.url) === canonicalizeDigestUrl(cleanUrl)
      if (!same) {
        issues.push({
          kind: 'rewrote_url',
          url: cleanUrl,
          detail: `改写为条目链接 ${hit.url}`
        })
      }
      const label = (text || '').trim() || digestLinkLabel(hit)
      return `[${label}](${hit.url})`
    }
    issues.push({
      kind: 'removed_link',
      url: cleanUrl,
      detail: `移除未接地链接「${(text || '').trim() || cleanUrl}」`
    })
    return (text || '').trim() || ''
  })

  // 2) 逐行：裸 URL 要点
  const keptLines: string[] = []
  for (const line of md.split('\n')) {
    const bare = line.match(/^[●•-]\s*(https?:\/\/\S+)\s*$/i)
    if (bare) {
      const url = bare[1].replace(/[.,;:!?]+$/g, '')
      const hit = matchEntryByUrl(url, entries, index)
      if (hit) {
        keptLines.push(`● ${digestEntryLink(hit)}`)
        if (canonicalizeDigestUrl(hit.url) !== canonicalizeDigestUrl(url)) {
          issues.push({ kind: 'rewrote_url', url, detail: `裸链改写为 ${hit.url}` })
        }
      } else {
        issues.push({ kind: 'removed_line', url, detail: '删除未接地裸链行' })
      }
      continue
    }
    // 行内残留裸 URL（非 markdown 链接）
    if (/https?:\/\//i.test(line) && !/\[[^\]]*]\(https?:\/\//i.test(line)) {
      const repairedLine = line.replace(/https?:\/\/[^\s)\]>'"]+/gi, (url) => {
        const clean = url.replace(/[.,;:!?）】»]+$/g, '')
        const hit = matchEntryByUrl(clean, entries, index)
        if (hit) {
          if (canonicalizeDigestUrl(hit.url) !== canonicalizeDigestUrl(clean)) {
            issues.push({ kind: 'rewrote_url', url: clean, detail: `行内改写为 ${hit.url}` })
          }
          return digestEntryLink(hit)
        }
        issues.push({ kind: 'removed_link', url: clean, detail: '移除行内未接地 URL' })
        return ''
      })
      const trimmed = repairedLine.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/g, '')
      if (/^[●•-]\s*$/.test(trimmed)) {
        issues.push({ kind: 'removed_line', detail: '删除去链后为空的要点' })
        continue
      }
      keptLines.push(trimmed)
      continue
    }
    keptLines.push(line)
  }
  md = keptLines.join('\n')

  // 3) 抽掉「无任何合法链接、且标题对不上条目」的 ### 小节（整段到下一标题）
  md = pruneUngroundedSubsections(md, entries, issues)

  // 4) 重建资料来源：只保留正文仍出现的合法 URL 对应条目
  const cited: RssTaskEntry[] = []
  const seen = new Set<string>()
  for (const url of extractUrls(md.split(/##\s*资料来源/i)[0] || md)) {
    const hit = matchEntryByUrl(url, entries, index)
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id)
      cited.push(hit)
    }
  }
  if (!cited.length) {
    for (const e of [...entries].sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0)).slice(0, 12)) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        cited.push(e)
      }
    }
  }
  const sourcesBlock = ['## 资料来源', '', ...cited.map((e) => `● ${digestEntryLink(e)}`)].join('\n')
  if (/##\s*资料来源[\s\S]*$/i.test(md)) {
    md = md.replace(/##\s*资料来源[\s\S]*$/i, sourcesBlock)
  } else {
    md = `${md.replace(/\s*$/, '')}\n\n${sourcesBlock}`
  }

  md = md.replace(/\n{3,}/g, '\n\n').trim()

  // 去重 issues（同 url+kind）
  const uniq: DigestGuardIssue[] = []
  const keys = new Set<string>()
  for (const issue of issues) {
    const k = `${issue.kind}|${issue.url || ''}|${issue.detail}`
    if (keys.has(k)) continue
    keys.add(k)
    uniq.push(issue)
  }

  const repaired = uniq.length > 0
  const rewriteN = uniq.filter((i) => i.kind === 'rewrote_url').length
  const removeN = uniq.filter((i) => i.kind === 'removed_link' || i.kind === 'removed_line').length
  const sectionN = uniq.filter((i) => i.kind === 'ungrounded_section').length
  const parts: string[] = []
  if (rewriteN) parts.push(`改写 ${rewriteN} 处`)
  if (removeN) parts.push(`移除 ${removeN} 处`)
  if (sectionN) parts.push(`删 ${sectionN} 个未接地小节`)
  const summary = repaired ? `已校验：${parts.join('、')}未对应订阅的链接/段落` : undefined

  if (repaired && summary) {
    // 避免重复页脚
    md = md.replace(/\n*_校验：.*_?\s*$/u, '').trim()
    md = `${md}\n\n_${summary}_`
  }

  return { markdown: md, issues: uniq, repaired, summary }
}

function pruneUngroundedSubsections(
  markdown: string,
  entries: RssTaskEntry[],
  issues: DigestGuardIssue[]
): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  const corpus = entries
    .map((e) => `${e.title || ''} ${e.snippet || ''} ${e.feedTitle || ''}`.toLowerCase())
    .join('\n')

  while (i < lines.length) {
    const line = lines[i]
    const isSub = /^###\s+/.test(line)
    const isSource = /^##\s*资料来源/.test(line)
    if (!isSub || isSource) {
      out.push(line)
      i++
      continue
    }
    const block: string[] = [line]
    i++
    while (i < lines.length && !/^#{1,3}\s+/.test(lines[i])) {
      block.push(lines[i])
      i++
    }
    const body = block.join('\n')
    const hasGoodLink = extractUrls(body).some((u) => !!matchEntryByUrl(u, entries))
    const heading = line.replace(/^###\s+/, '').trim().toLowerCase()
    const headingHit =
      heading.length >= 4 &&
      (corpus.includes(heading) ||
        entries.some((e) => {
          const t = (e.title || '').toLowerCase()
          return t && (heading.includes(t.slice(0, 12)) || t.includes(heading.slice(0, 12)))
        }))
    if (hasGoodLink || headingHit) {
      out.push(...block)
    } else {
      issues.push({
        kind: 'ungrounded_section',
        detail: `删除未接地小节「${line.replace(/^###\s+/, '').trim()}」`
      })
    }
  }
  return out.join('\n')
}
