/** OPML 导入 / 导出：与 Folo / Feedly 等互通订阅列表。 */

export type OpmlFeed = {
  title: string
  url: string
  htmlUrl?: string
  category?: string
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  if (!m) return ''
  return decodeXmlEntities(m[2] ?? m[3] ?? '').trim()
}

function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'http:' || x.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 解析 OPML / 类 OPML 文本，收集带 xmlUrl（或 url）的 outline。
 * 容错：无 body 的扁平 outline 也能读。
 */
export function parseOpml(xml: string): OpmlFeed[] {
  const text = String(xml || '')
  if (!text.trim()) return []
  const outlines = text.match(/<outline\b[^>]*>/gi) || []
  const out: OpmlFeed[] = []
  const seen = new Set<string>()
  let folder = ''

  for (const tag of outlines) {
    const xmlUrl = attr(tag, 'xmlUrl') || attr(tag, 'xmlurl') || attr(tag, 'url')
    const title =
      attr(tag, 'title') || attr(tag, 'text') || attr(tag, 'description') || ''
    const htmlUrl = attr(tag, 'htmlUrl') || attr(tag, 'htmlurl') || undefined
    const type = (attr(tag, 'type') || '').toLowerCase()

    if (!xmlUrl) {
      // 文件夹 outline：记下 text 供后续 feed 归类
      if (title && !/rss|atom/i.test(type)) folder = title.slice(0, 64)
      continue
    }
    if (!isHttpUrl(xmlUrl)) continue
    if (type && type !== 'rss' && type !== 'atom' && type !== 'feed') {
      // 仍接受带 xmlUrl 的非标准 type
    }
    let key = xmlUrl
    try {
      key = new URL(xmlUrl).href
    } catch {
      /* keep */
    }
    if (seen.has(key.toLowerCase())) continue
    seen.add(key.toLowerCase())
    out.push({
      title: (title || key).slice(0, 120),
      url: key,
      htmlUrl: htmlUrl && isHttpUrl(htmlUrl) ? htmlUrl : undefined,
      category: folder || undefined
    })
  }
  return out
}

/** 将源列表写成 OPML 2.0。 */
export function buildOpml(
  feeds: ReadonlyArray<{ title?: string; url: string; htmlUrl?: string }>,
  opts?: { title?: string }
): string {
  const docTitle = (opts?.title || 'CPET RSS').replace(/[<>&]/g, '')
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXml(docTitle)}</title>`,
    '  </head>',
    '  <body>'
  ]
  for (const f of feeds) {
    if (!isHttpUrl(f.url)) continue
    const title = escapeXml((f.title || f.url).slice(0, 120))
    const xmlUrl = escapeXml(f.url)
    const html = f.htmlUrl && isHttpUrl(f.htmlUrl) ? ` htmlUrl="${escapeXml(f.htmlUrl)}"` : ''
    lines.push(
      `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}"${html} />`
    )
  }
  lines.push('  </body>', '</opml>', '')
  return lines.join('\n')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把 OPML 源 URL 合并进多行草稿（去重）。超出 max 时截断。 */
export function mergeOpmlIntoDraft(
  draft: string,
  feeds: ReadonlyArray<OpmlFeed>,
  max = 200
): { draft: string; added: number; truncated: number } {
  const lines = draft
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const keys = new Set(
    lines.map((u) => {
      try {
        return new URL(u).href.toLowerCase()
      } catch {
        return u.toLowerCase()
      }
    })
  )
  let added = 0
  let truncated = 0
  for (const f of feeds) {
    let key = f.url
    try {
      key = new URL(f.url).href
    } catch {
      /* keep */
    }
    if (keys.has(key.toLowerCase())) continue
    if (lines.length >= max) {
      truncated += 1
      continue
    }
    keys.add(key.toLowerCase())
    lines.push(key)
    added += 1
  }
  return { draft: lines.join('\n'), added, truncated }
}
