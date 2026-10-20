/** RSS 简报 / 条目导出为 Markdown。 */

import { safeExportFilename } from './chatExport'
import {
  formatDigestDateTime,
  formatDigestRangeLabel,
  rssDigestDisplayTitle,
  rssDigestTemplateLabel,
  type RssDigestRecord,
  type RssTaskEntry
} from './rssTask'

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : ''
    })
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/** 简洁正文 HTML → 可读 Markdown（条目导出用）。 */
export function articleHtmlToMarkdown(html: string): string {
  if (!html?.trim()) return ''
  let s = html.replace(/\r\n?/g, '\n')
  s = s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const src = /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1] || ''
    if (!src) return ''
    const alt = /\balt=["']([^"']*)["']/i.exec(attrs)?.[1] || ''
    return `\n\n![${alt}](${src})\n\n`
  })
  s = s.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = stripTags(inner) || href
    return `[${text}](${href})`
  })
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi')
    s = s.replace(re, (_m, inner) => `\n\n${'#'.repeat(i)} ${stripTags(inner)}\n\n`)
  }
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${stripTags(inner)}**`)
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${stripTags(inner)}*`)
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${stripTags(inner)}\``)
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => `\n\n\`\`\`\n${stripTags(inner)}\n\`\`\`\n\n`)
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const body = stripTags(inner)
    return body ? `\n\n> ${body}\n\n` : '\n\n'
  })
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `- ${stripTags(inner)}\n`)
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  s = s.replace(/<\/?(p|div|section|article|figure|figcaption|header|footer|main)[^>]*>/gi, '\n\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 简报记录 → Markdown 文件内容。 */
export function rssDigestToMarkdown(d: RssDigestRecord): string {
  const title = rssDigestDisplayTitle(d)
  let body = (d.markdown || '').trim()
  if (!body) {
    return [`# ${title}`, '', '_（空简报）_', ''].join('\n')
  }
  const first = body.split('\n')[0] || ''
  if (!/^#\s+\S/.test(first)) {
    body = `# ${title}\n\n${body}`
  }
  const meta = [
    '---',
    `- 生成：${formatDigestDateTime(d.createdAt)}`,
    `- 范围：${formatDigestRangeLabel(d)}`,
    `- 形式：${rssDigestTemplateLabel(d.template)}`,
    d.entryCount ? `- 条目：${d.entryCount}` : '',
    d.mode === 'model' ? '- 来源：模型' : '- 来源：模板'
  ].filter(Boolean)
  return `${body.replace(/\s*$/, '\n')}\n${meta.join('\n')}\n`
}

/** 订阅条目 → Markdown（标题 / 链接 / 正文）。 */
export function rssEntryToMarkdown(
  entry: RssTaskEntry,
  opts?: { sourceLabel?: string }
): string {
  const title = (entry.title || '无标题').trim() || '无标题'
  const source = (opts?.sourceLabel || entry.feedTitle || '').trim()
  const published =
    entry.publishedAt && Number.isFinite(entry.publishedAt)
      ? new Date(entry.publishedAt).toLocaleString('zh-CN', { hour12: false })
      : ''
  const meta = [
    entry.url ? `- 链接：${entry.url}` : '',
    source ? `- 来源：${source}` : '',
    published ? `- 发布：${published}` : '',
    entry.valueScore != null ? `- 评分：${entry.valueScore}` : ''
  ].filter(Boolean)
  const body = entry.contentHtml?.trim()
    ? articleHtmlToMarkdown(entry.contentHtml)
    : (entry.snippet || '').trim()
  return [`# ${title}`, '', ...meta, '', '---', '', body || '（无正文）', ''].join('\n')
}

export function safeRssExportFilename(title: string): string {
  return safeExportFilename(title || 'RSS')
}
