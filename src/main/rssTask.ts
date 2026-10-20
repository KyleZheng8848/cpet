/**
 * RSS 任务：按源拉取条目；可选抓取页面做可读提取（消毒 HTML，非通用浏览器）。
 */

import {
  decodeXml,
  parseFeedXml,
  rssSourceLabel
} from '../shared/rssBrief'
import {
  RSS_TASK_PER_FEED,
  RSS_TASK_REFRESH_CONCURRENCY,
  articleHasMedia,
  articleLooksLikeBlocked,
  articleLooksLikeChrome,
  articleMissingExpectedMedia,
  articleNeedsWebHint,
  isThinArticleHtml,
  type RssTaskEntry,
  type RssTaskFeed,
  formatRssFeedPullError,
  normalizeRssTaskFeeds
} from '../shared/rssTask'

export { articleNeedsWebHint, articleLooksLikeChrome, articleLooksLikeBlocked }

async function fetchText(url: string, ms = 10000): Promise<string | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'CPET-RSS/0.4 (+https://github.com/cursor-pet)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*'
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

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'RSS'
  }
}

const SAFE_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'use',
  'title',
  'desc',
  'clippath',
  'mask',
  'lineargradient',
  'radialgradient',
  'stop',
  'symbol',
  'marker',
  'pattern'
])

const SAFE_SVG_ATTR =
  /^(?:aria-[\w-]+|class|clip-path|cx|cy|d|dx|dy|fill|fill-opacity|fill-rule|height|href|id|marker-end|marker-mid|marker-start|opacity|points|preserveAspectRatio|r|rx|ry|stroke|stroke-dasharray|stroke-linecap|stroke-linejoin|stroke-opacity|stroke-width|transform|viewBox|width|x|x1|x2|y|y1|y2|xmlns(?::[\w]+)?|xlink:href)$/i

const DANGEROUS_HTML_TAGS =
  /<\/?(?:object|embed|form|input|button|meta|link|canvas|foreignObject|foreignobject)[^>]*>/gi

/** 允许嵌入的视频站（简洁模式 iframe）；其它 iframe 去掉。 */
const SAFE_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.bilibili.com',
  'player.vimeo.com',
  'www.dailymotion.com'
])

const STYLE_PROMOTE =
  /(?:^|;)\s*(fill|stroke|stroke-width|opacity|fill-opacity|stroke-opacity|fill-rule|stroke-linecap|stroke-linejoin|stroke-dasharray)\s*:\s*([^;]+)/gi

function promoteSvgStyle(styleValue: string): Record<string, string> {
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null
  const re = new RegExp(STYLE_PROMOTE.source, 'gi')
  while ((m = re.exec(styleValue))) {
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (!val || /javascript:|expression\s*\(/i.test(val)) continue
    out[key] = val
  }
  return out
}

function sanitizeSvgAttrs(attrs: string): string {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /([^\s=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=>]+)))?/g
  let m: RegExpExecArray | null
  const promoted: Record<string, string> = {}
  while ((m = re.exec(attrs))) {
    const name = m[1]
    if (!name || name === '/') continue
    const raw = m[3] ?? m[4] ?? m[5]
    if (name.toLowerCase() === 'style' && raw) {
      Object.assign(promoted, promoteSvgStyle(raw))
      continue
    }
    if (!SAFE_SVG_ATTR.test(name)) continue
    if (raw == null) {
      out.push(name)
      seen.add(name.toLowerCase())
      continue
    }
    if (/javascript:/i.test(raw) || /^on/i.test(name)) continue
    const q = raw.includes('"') ? "'" : '"'
    out.push(`${name}=${q}${raw}${q}`)
    seen.add(name.toLowerCase())
  }
  for (const [k, v] of Object.entries(promoted)) {
    if (seen.has(k)) continue
    const q = v.includes('"') ? "'" : '"'
    out.push(`${k}=${q}${v}${q}`)
  }
  return out.length ? ` ${out.join(' ')}` : ''
}

/** 抽出并净化 SVG 块；返回正文占位与块表。 */
function extractSafeSvgs(html: string): { html: string; blocks: string[] } {
  const blocks: string[] = []
  const out = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (block) => {
    // 去掉 SVG 内脚本 / 外部图 / foreignObject
    let svg = block
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
    svg = svg.replace(/<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g, (tag, name: string, attrs: string) => {
      const n = name.toLowerCase()
      if (!SAFE_SVG_TAGS.has(n)) return ''
      const selfClose = /\/>$/.test(tag.trim())
      if (tag.startsWith('</')) return `</${n}>`
      const cleanAttrs = sanitizeSvgAttrs(attrs.replace(/\/\s*$/, ''))
      return selfClose || /\/>$/.test(attrs) ? `<${n}${cleanAttrs} />` : `<${n}${cleanAttrs}>`
    })
    if (!/<svg\b/i.test(svg)) return ''
    const i = blocks.length
    blocks.push(svg)
    return `<!--rss-svg:${i}-->`
  })
  return { html: out, blocks }
}

function firstSrcsetUrl(srcset: string): string {
  const part = srcset.split(',')[0]?.trim() || ''
  return part.split(/\s+/)[0] || ''
}

function isAllowedImgSrc(src: string): boolean {
  const u = src.trim()
  if (!u || /javascript:/i.test(u)) return false
  if (/^https?:\/\//i.test(u)) return true
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)\b/i.test(u)) return true
  return false
}

function isAllowedMediaSrc(src: string): boolean {
  const u = src.trim()
  if (!u || /javascript:/i.test(u) || /^blob:/i.test(u)) return false
  if (/^https?:\/\//i.test(u)) return true
  if (/^data:(audio|video)\/[a-z0-9.+-]+\b/i.test(u)) return true
  return false
}

/** 解开 &amp;、去掉 #fragment（微信 CDN 等常带 #imgIndex=）。 */
function resolveMaybeUrl(raw: string, baseUrl?: string): string {
  const u = decodeXml(raw.trim())
  if (!u) return ''
  if (u.startsWith('data:')) return u
  try {
    const abs = baseUrl ? new URL(u, baseUrl) : new URL(u)
    abs.hash = ''
    return abs.href
  } catch {
    if (/^https?:\/\//i.test(u)) return u.replace(/#.*$/, '')
    return u
  }
}

function attrValue(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\s${name}=["']([^"']+)["']`, 'i'))
  return m?.[1]?.trim() || ''
}

function rewriteMediaElement(tag: string, attrs: string, inner: string, baseUrl?: string): string {
  const t = tag.toLowerCase()
  let a = String(attrs)
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:autoplay|loop)\b/gi, '')
  const src = resolveMaybeUrl(attrValue(a, 'src'), baseUrl)
  if (src) {
    if (!isAllowedMediaSrc(src)) {
      a = a.replace(/\ssrc=["'][^"']*["']/i, '')
    } else {
      a = a.replace(/\ssrc=["'][^"']*["']/i, '')
      a = ` src="${src}"${a}`
    }
  }
  if (t === 'video') {
    const poster = resolveMaybeUrl(attrValue(a, 'poster'), baseUrl)
    if (poster && isAllowedImgSrc(poster)) {
      a = a.replace(/\sposter=["'][^"']*["']/i, '')
      a = ` poster="${poster}"${a}`
    } else {
      a = a.replace(/\sposter=["'][^"']*["']/i, '')
    }
  }
  if (!/\bcontrols\b/i.test(a)) a += ' controls'
  if (t === 'video' && !/\bplaysinline\b/i.test(a)) a += ' playsinline'
  a = a.replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*'|\d+)/gi, '')

  let body = String(inner)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  body = body.replace(/<source\b([^>]*)\/?>/gi, (_s, sAttrs: string) => {
    const sSrc = resolveMaybeUrl(attrValue(sAttrs, 'src'), baseUrl)
    if (!isAllowedMediaSrc(sSrc)) return ''
    const type = attrValue(sAttrs, 'type')
    const typeAttr = type && /^[\w/-]+$/.test(type) ? ` type="${type}"` : ''
    return `<source src="${sSrc}"${typeAttr}>`
  })
  body = body.replace(/<track\b[^>]*>/gi, '')
  const hasSrc = /\ssrc=["']/i.test(a) || /<source\b/i.test(body)
  if (!hasSrc) return ''
  return `<${t}${a}>${body}</${t}>`
}

/** 保留可控播放的 video/audio；去掉脚本源与自动播放。 */
function sanitizeMediaBlocks(html: string, baseUrl?: string): string {
  let s = html.replace(
    /<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_full, tag: string, attrs: string, inner: string) =>
      rewriteMediaElement(tag, attrs, inner, baseUrl)
  )
  // 自闭合 / 无闭合标签
  s = s.replace(/<(video|audio)\b([^>]*)\/>/gi, (_full, tag: string, attrs: string) =>
    rewriteMediaElement(tag, attrs, '', baseUrl)
  )
  return s
}

/**
 * 把仍以实体/纯文本形式躺着的媒体标签救回来（`&lt;img …&gt;`、双重 `&amp;lt;img`）。
 * 常见于部分 RSS description / CMS 导出。
 */
function reviveEscapedMediaHtml(html: string): string {
  let s = decodeXml(html)
  // 若仍残留实体形态的媒体标签，再解一轮针对性片段
  if (/&lt;\s*(?:img|video|audio|source|iframe|figure|picture)\b/i.test(s)) {
    s = decodeXml(s)
  }
  return s
}

function rewriteSafeIframe(attrs: string, baseUrl?: string): string {
  const src = resolveMaybeUrl(attrValue(attrs, 'src'), baseUrl)
  if (!src || !/^https?:\/\//i.test(src)) return ''
  let host = ''
  try {
    host = new URL(src).hostname.toLowerCase()
  } catch {
    return ''
  }
  if (!SAFE_IFRAME_HOSTS.has(host)) return ''
  const title = attrValue(attrs, 'title').replace(/[<>&"]/g, '') || 'embedded media'
  return `<iframe class="rss-embed" src="${src}" title="${title}" loading="lazy" referrerpolicy="no-referrer" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`
}

/** 白名单站内嵌；其余 iframe 删除（防任意页面套进简洁栏）。 */
function sanitizeIframes(html: string, baseUrl?: string): string {
  let s = html.replace(/<iframe\b([^>]*)\/>/gi, (_full, attrs: string) =>
    rewriteSafeIframe(attrs, baseUrl)
  )
  s = s.replace(/<iframe\b([^>]*)>([\s\S]*?)<\/iframe>/gi, (_full, attrs: string) =>
    rewriteSafeIframe(attrs, baseUrl)
  )
  return s
}

/** 极简消毒：去脚本；保留安全 SVG / data 图；相对链接按 base 绝对化。 */
export function sanitizeArticleHtml(html: string, baseUrl?: string): string {
  // 先救回实体转义的媒体/正文标签，避免 `<img…>` 当纯文本显示
  const revived = reviveEscapedMediaHtml(html)
  const { html: withPlaceholders, blocks: svgBlocks } = extractSafeSvgs(revived)
  let s = withPlaceholders
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
  // 危险标签（不再误杀 svg / 媒体）
  s = s.replace(DANGEROUS_HTML_TAGS, '')
  // 非 SVG 区域去掉内联样式/底色/字色，避免盖住手帐或把字拉扁
  s = s.replace(/\s(?:style|bgcolor|background|color)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // class/id 常挂站点布局；须在 iframe 白名单改写之前剥掉，以免误删 rss-embed
  s = s.replace(/\s(?:class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = sanitizeIframes(s, baseUrl)
  s = sanitizeMediaBlocks(s, baseUrl)
  // data-src / data-original / data-lazy-src → src（懒加载图）
  s = s.replace(
    /<img\b([^>]*?)\bdata-(?:src|original|lazy-src|actualsrc)=["']([^"']+)["']([^>]*)>/gi,
    (_m, a, src, b) => `<img${a} src="${src}"${b}>`
  )
  if (baseUrl) {
    s = s.replace(/\s(src|href)=["']([^"']+)["']/gi, (full, attr: string, raw: string) => {
      const u = decodeXml(raw.trim())
      if (!u || u.startsWith('#') || u.startsWith('data:') || u.startsWith('mailto:')) return full
      const resolved = resolveMaybeUrl(u, baseUrl)
      return resolved ? ` ${attr}="${resolved}"` : full
    })
    s = s.replace(/\ssrcset=["']([^"']+)["']/gi, (full, raw: string) => {
      const parts = String(raw)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [u, ...rest] = p.split(/\s+/)
          if (!u || u.startsWith('data:')) return p
          const resolved = resolveMaybeUrl(u, baseUrl)
          return resolved ? [resolved, ...rest].join(' ') : p
        })
      return parts.length ? ` srcset="${parts.join(', ')}"` : full
    })
  }
  // 规范 img：允许 http(s) 与 data:image；无 src 时从 srcset 取第一条
  s = s.replace(/<img\b([^>]*)>/gi, (_tag, attrs: string) => {
    let a = String(attrs)
    const srcM = a.match(/\ssrc=["']([^"']+)["']/i)
    let src = srcM ? resolveMaybeUrl(srcM[1], baseUrl) : ''
    if (!isAllowedImgSrc(src)) {
      const setM = a.match(/\ssrcset=["']([^"']+)["']/i)
      const fromSet = setM ? resolveMaybeUrl(firstSrcsetUrl(setM[1]), baseUrl) : ''
      if (isAllowedImgSrc(fromSet)) {
        src = fromSet
        a = a.replace(/\ssrc=["'][^"']*["']/i, '')
        a = ` src="${src}"${a}`
      } else {
        return ''
      }
    } else if (srcM && src !== srcM[1]?.trim()) {
      a = a.replace(/\ssrc=["'][^"']*["']/i, '')
      a = ` src="${src}"${a}`
    }
    // 去掉 CMS 自闭合残留的 `/`，避免属性挂在 `/` 后被解析坏掉
    let cleaned = a
      .replace(/\s\/\s*$/g, '')
      .replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*'|\d+)/gi, '')
      // 简洁窗 origin 是 localhost；no-referrer / 空 referer 会触发图床 403（如 i.qbitai.com）
      .replace(/\sreferrerpolicy\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    if (!/\bloading=/i.test(cleaned)) cleaned += ' loading="lazy"'
    return `<img${cleaned}>`
  })
  // 站点常用 <font face> 窄体，深色主题下空格几乎看不见
  s = s.replace(/<\/?font\b[^>]*>/gi, ' ')
  // 相邻 inline 标签中间没有空白文本节点时，浏览器会拼成 OpenAIbuys…
  s = separateAdjacentInlineTags(s)
  // 空段落清理
  s = s.replace(/<p>\s*<\/p>/gi, '')
  // 还原安全 SVG
  s = s.replace(/<!--rss-svg:(\d+)-->/g, (_m, idx) => svgBlocks[Number(idx)] || '')
  return s.trim().slice(0, 120_000)
}

const INLINE_HTML_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'cite',
  'em',
  'i',
  'label',
  'q',
  'small',
  'span',
  'strong',
  'u'
])

/** 在 </span><span> 这类缝里补空格，避免正文单词粘成一团。 */
export function separateAdjacentInlineTags(html: string): string {
  return html.replace(/<\/([a-z0-9]+)>(?=<([a-z0-9]+)\b)/gi, (full, close: string, open: string) => {
    const a = close.toLowerCase()
    const b = open.toLowerCase()
    if (!INLINE_HTML_TAGS.has(a) && !INLINE_HTML_TAGS.has(b)) return full
    return `</${close}> `
  })
}

/** 按嵌套深度截取完整标签块（避免非贪婪 </div> 只吃到标题区）。 */
function sliceBalancedBlock(
  html: string,
  openRe: RegExp,
  tag: string
): string | undefined {
  const open = openRe.exec(html)
  if (!open || open.index == null) return undefined
  const start = open.index
  const after = start + open[0].length
  const token = new RegExp(`</?${tag}\\b[^>]*>`, 'gi')
  token.lastIndex = after
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = token.exec(html))) {
    if (m[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return html.slice(start, m.index + m[0].length)
    } else if (!/\/>$/.test(m[0])) {
      depth += 1
    }
  }
  return undefined
}

function plainTextLen(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
}

function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CHROME_OPEN_RE =
  /<(div|section|ul|ol)\b[^>]*(?:id|class)=["'][^"']*(?:\bnav\b|menu|navbar|header|footer|sidebar|breadcrumb|toolbar|share|related|recommend|comment|login|search|sitemap|copyright|advert|\bads?\b|banner|topbar|bottombar|hot-?news|hot-?tag|hot-?list|channel|tag-?cloud|tag-?list|keyword|subscribe|promo|sponsor|ad-?box|recsys)[^"']*["'][^>]*>/i

const NAV_NOISE_RE =
  /登录|注册|搜索|媒体品牌|媒体矩阵|企业服务|政府服务|网站地图|客户端|关注我们|投诉|举报|友情链接|热门推荐|相关阅读|相关新闻|相关资讯|分享到|扫码|下载APP|会员中心|我的订阅|下一篇|项目推荐|我要入驻|城市合作|猜你喜欢|大家还在看|热门标签|文章标签|大家都在搜/

/** 从「下一篇 / 相关阅读」等起整段砍掉，避免简洁区变成相关链目录。 */
function cutRelatedArticleTail(html: string): string {
  const markers =
    /<(?:h[1-6]|div|section|aside|p|ul|ol)\b[^>]*>[\s\S]{0,80}?(?:下一篇|相关阅读|相关文章|相关新闻|相关资讯|推荐阅读|热门文章|热门资讯|热门标签|文章标签|大家还在看|大家都在搜|猜你喜欢|项目推荐|编辑推荐)/i
  const m = markers.exec(html)
  if (m && m.index != null && m.index > 100) {
    return html.slice(0, m.index).trim()
  }
  // 纯文本锚点（无合适包裹标签时）
  const plain = html.search(/(?:^|>)\s*(?:下一篇|相关阅读|相关文章|推荐阅读)\s*(?:<|$)/i)
  if (plain > 100) return html.slice(0, plain).trim()
  return html
}

/** 去掉页眉页脚导航等壳层（整块删除，避免「登录/搜索/栏目」进简洁）。 */
export function stripChromeBlocks(html: string): string {
  let s = html
  for (const tag of ['header', 'footer', 'nav', 'aside']) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), '\n')
  }
  let guard = 0
  while (guard++ < 48) {
    const m = CHROME_OPEN_RE.exec(s)
    if (!m || m.index == null) break
    const tag = m[1]
    const block = sliceBalancedBlock(s.slice(m.index), new RegExp(`^<${tag}\\b`, 'i'), tag)
    if (!block) {
      // 匹配到开标签但截不全：删开标签本身，避免死循环
      s = s.slice(0, m.index) + s.slice(m.index + m[0].length)
      continue
    }
    s = s.slice(0, m.index) + '\n' + s.slice(m.index + block.length)
  }
  s = s.replace(/<form\b[\s\S]*?<\/form>/gi, '\n')
  return s
}

function linkDensity(html: string): number {
  const text = plainText(html)
  if (!text.length) return 1
  const linkText = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])
    .map((a) => plainText(a))
    .join(' ')
  return Math.min(1, linkText.length / text.length)
}

function mediaCount(html: string): number {
  return (html.match(/<(?:img|video|audio)\b/gi) || []).length
}

/** 正文质量分：偏长文段落 + 媒体，惩罚导航/高链接密度。 */
export function scoreArticleCandidate(html: string): number {
  const cleaned = stripChromeBlocks(html)
  const text = plainText(cleaned)
  const len = text.length
  if (len < 40) return 0
  const ps = (cleaned.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).filter((p) => plainTextLen(p) >= 40)
  const density = linkDensity(cleaned)
  const noiseHits = (text.match(new RegExp(NAV_NOISE_RE.source, 'g')) || []).length
  const media = mediaCount(cleaned)
  let score = len + ps.length * 80 + media * 260
  score -= density * len * 0.85
  score -= noiseHits * 120
  // 几乎全是链接的栏目页
  if (density > 0.55 && ps.length < 2) score *= 0.15
  // 纯文本段落汤：略降，避免盖过带图正文块
  if (media === 0 && ps.length >= 2 && !/<(?:ul|ol|blockquote|h[1-6])\b/i.test(cleaned)) {
    score *= 0.82
  }
  return score
}

function extractParagraphSoup(page: string): string {
  const cleaned = stripChromeBlocks(page)
  const ps = cleaned.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []
  const keep = ps.filter((p) => {
    const t = plainText(p)
    if (t.length < 40) return false
    if (NAV_NOISE_RE.test(t) && t.length < 80) return false
    return true
  })
  if (keep.length < 2) return ''
  return keep.slice(0, 80).join('\n')
}

/** sanitize 后再清一遍短链列表 / 空壳。 */
function polishExtractHtml(html: string): string {
  let s = stripChromeBlocks(html)
  s = cutRelatedArticleTail(s)
  // 转载声明 / 授权脚注（界面快讯等挂在正文旁）
  s = s.replace(/<a\b[^>]*>[\s\S]*?本文为转载[\s\S]*?<\/a>/gi, '')
  s = s.replace(/<(?:p|div)\b[^>]*>[\s\S]*?本文为转载[\s\S]*?<\/(?:p|div)>/gi, '')
  // 去掉几乎全是短链的 ul/ol（栏目列表）
  s = s.replace(/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const links = block.match(/<a\b/gi)?.length || 0
    const text = plainText(block)
    if (links >= 4 && (text.length < 180 || linkDensity(block) > 0.65)) return ''
    return block
  })
  // 连续空链接行（顶栏「项目推荐 / 我要入驻」一类）
  s = s.replace(/(?:<a\b[^>]*>\s*[^<]{0,16}\s*<\/a>\s*){4,}/gi, '')
  s = s.replace(/<p>\s*<\/p>/gi, '')
  // 只剩短摘要 + 大量链接 → 当作无效，交给网页模式
  const text = plainText(s)
  const links = (s.match(/<a\b/gi) || []).length
  const paras = (s.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).filter(
    (p) => plainText(p).length >= 40
  ).length
  if (paras <= 1 && links >= 6 && text.length < 900) return ''
  if (/下一篇|相关阅读|项目推荐/.test(text) && paras < 3 && links >= 5) return ''
  return s.trim()
}

function decodeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

/** 从 JSON-LD / 常见字段抠正文（应对 36氪等 SPA 壳页）。 */
function extractFromEmbeddedJson(page: string): string {
  const bodies: string[] = []
  const ldBlocks = page.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || []
  for (const block of ldBlocks) {
    const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '')
    try {
      const data = JSON.parse(raw) as unknown
      const stack = Array.isArray(data) ? data : [data]
      for (const node of stack) {
        if (!node || typeof node !== 'object') continue
        const o = node as Record<string, unknown>
        const body =
          (typeof o.articleBody === 'string' && o.articleBody) ||
          (typeof o.text === 'string' && o.text) ||
          (typeof o.description === 'string' && o.description.length > 120
            ? o.description
            : '')
        if (body && body.trim().length > 80) bodies.push(body.trim())
      }
    } catch {
      /* ignore */
    }
  }
  // 宽松匹配 articleBody
  const m = page.match(/"articleBody"\s*:\s*"((?:\\.|[^"\\]){80,})"/)
  if (m?.[1]) bodies.push(decodeJsonString(m[1]))
  const contentM = page.match(
    /"(?:content|articleContent|contentHtml)"\s*:\s*"((?:\\.|[^"\\]){120,})"/
  )
  if (contentM?.[1]) {
    const raw = decodeJsonString(contentM[1])
    bodies.push(/</.test(raw) ? raw : `<p>${raw}</p>`)
  }
  if (!bodies.length) return ''
  const best = bodies.sort((a, b) => b.length - a.length)[0]
  if (/</.test(best)) return best
  return best
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
    .join('\n')
}

function isUsableExtract(html: string | undefined): boolean {
  if (!html) return false
  if (isThinArticleHtml(html)) return false
  if (articleLooksLikeChrome(html)) return false
  if (articleLooksLikeBlocked(html)) return false
  // 完整短讯体量小，分数门槛略降；长文仍要求更扎实
  const minScore = plainTextLen(html) < 320 ? 80 : 120
  return scoreArticleCandidate(html) >= minScore
}

/** @internal 供测试 / 调试 */
export function extractReadableFromHtml(page: string, pageUrl: string): { title?: string; html: string } {
  const titleM = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleM
    ? titleM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
    : undefined

  if (articleLooksLikeBlocked(page)) {
    return { title, html: '' }
  }

  const candidates: string[] = []
  const fromJson = extractFromEmbeddedJson(page)
  if (fromJson) candidates.push(fromJson)

  const primed = stripChromeBlocks(page)
  // 优先更具体的正文容器，再退到 article / main（main 常含壳，靠打分淘汰）
  const divOpeners = [
    /<div[^>]*class=["'][^"']*(?:entry-content|post-content|article-content|article_content|post_content|rich-content|content-article|article-body|post-body|news-content|detail-content|content_detail|TRS_Editor|articleDetail)[^"']*["'][^>]*>/i,
    /<div[^>]*(?:id|class)=["'][^"']*(?:content|articleText|artbody|main-content|MainContent)[^"']*["'][^>]*>/i,
    /<div[^>]*class=["'][^"']*\barticle\b[^"']*["'][^>]*>/i,
    /<div[^>]*(?:id|class)=["'][^"']*readability[^"']*["'][^>]*>/i
  ]
  for (const re of divOpeners) {
    const block = sliceBalancedBlock(primed, new RegExp(re.source, 'i'), 'div')
    if (block) candidates.push(block)
  }
  const article = sliceBalancedBlock(primed, /<article\b[^>]*>/i, 'article')
  if (article) candidates.push(article)
  const main = sliceBalancedBlock(primed, /<main\b[^>]*>/i, 'main')
  if (main) candidates.push(main)

  const soup = extractParagraphSoup(primed)
  if (soup) candidates.push(soup)

  // 先消毒/去壳再打分：外壳块（class=content）原始分常高于 article-content，
  // 但 polish 后会被清成空；必须在清洗后选优，否则完整短讯会被丢掉。
  let bestHtml = ''
  let bestScore = 0
  for (const c of candidates) {
    if (!c || articleLooksLikeChrome(c)) continue
    const polished = polishExtractHtml(sanitizeArticleHtml(c, pageUrl))
    if (!isUsableExtract(polished)) continue
    const score = scoreArticleCandidate(polished)
    // 无图段落汤不得盖过已有媒体的正文块
    if (
      mediaCount(polished) === 0 &&
      mediaCount(bestHtml) > 0 &&
      score <= bestScore + 40
    ) {
      continue
    }
    if (score > bestScore) {
      bestHtml = polished
      bestScore = score
    }
  }
  if (!bestHtml || bestScore < 80) return { title, html: '' }
  return { title, html: bestHtml }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 0 }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export async function refreshRssTaskFeeds(rawFeeds: unknown): Promise<{
  items: RssTaskEntry[]
  feeds: RssTaskFeed[]
  errors: string[]
}> {
  const feeds = normalizeRssTaskFeeds(rawFeeds)
  const items: RssTaskEntry[] = []
  const errors: string[] = []
  const now = Date.now()
  const updatedFeeds = [...feeds]

  type One = {
    index: number
    feed: RssTaskFeed
    label?: string
    entries?: RssTaskEntry[]
    error?: string
  }

  const results = await mapPool(feeds, RSS_TASK_REFRESH_CONCURRENCY, async (feed, index) => {
    const raw = await fetchText(feed.url, 12000)
    if (!raw) {
      return { index, feed, error: formatRssFeedPullError('access', feed) } satisfies One
    }
    try {
      const parsed = parseFeedXml(raw, feed.url, RSS_TASK_PER_FEED)
      const label = rssSourceLabel(feed.url, parsed.feedTitle || feed.title)
      // 能解析但 0 条：空窗（如 arXiv 周末），不是失败，更不该进「删除该源」
      if (!parsed.entries.length) {
        return { index, feed, label, entries: [] } satisfies One
      }
      const entries: RssTaskEntry[] = parsed.entries.map((e) => {
        let contentHtml: string | undefined
        if (e.contentHtml) {
          const cleaned = polishExtractHtml(sanitizeArticleHtml(e.contentHtml, e.url))
          // 长文无图：不落盘，留给简洁模式抓页面补媒体
          if (isUsableExtract(cleaned) && !articleMissingExpectedMedia(cleaned)) {
            contentHtml = cleaned
          }
        }
        return {
          id: e.id,
          feedId: feed.id,
          feedTitle: label,
          title: e.title,
          url: e.url,
          snippet: e.snippet,
          imageUrl: e.imageUrl,
          contentHtml,
          fetchedAt: now,
          publishedAt: e.publishedAt
        }
      })
      return { index, feed, label, entries } satisfies One
    } catch {
      return { index, feed, error: formatRssFeedPullError('parse', feed) } satisfies One
    }
  })

  for (const r of results) {
    if (r.label && r.label !== r.feed.title) {
      updatedFeeds[r.index] = { ...r.feed, title: r.label }
    }
    if (r.error) errors.push(r.error)
    if (r.entries) items.push(...r.entries)
  }

  return { items, feeds: updatedFeeds, errors }
}

export async function fetchRssArticle(
  url: string,
  opts?: { fallbackHtml?: string }
): Promise<{
  ok: boolean
  title?: string
  html?: string
  error?: string
  /** 建议 UI 切到网页模式（站方反爬 / SPA） */
  preferWeb?: boolean
  /** 仅订阅摘要/半截正文；网页全文未拿到 */
  partial?: boolean
}> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: '链接无效' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: '仅支持 http(s)' }
  }

  const tryFallback = (): { ok: true; html: string } | null => {
    const raw = opts?.fallbackHtml
    if (!raw) return null
    const html = polishExtractHtml(sanitizeArticleHtml(raw, parsed.href))
    if (!isUsableExtract(html)) return null
    return { ok: true, html }
  }

  /** 不够「完整正文」门槛，但仍可先读的摘要/半截。 */
  const tryPartialFallback = (): { ok: true; html: string; partial: true } | null => {
    const raw = opts?.fallbackHtml
    if (!raw) return null
    const html = polishExtractHtml(sanitizeArticleHtml(raw, parsed.href))
    if (!html || articleLooksLikeChrome(html) || articleLooksLikeBlocked(html)) return null
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 40) return null
    return { ok: true, html, partial: true }
  }

  const raw = await fetchText(parsed.href, 15000)
  if (!raw) {
    const fb = tryFallback()
    if (fb) return fb
    const partial = tryPartialFallback()
    if (partial) return { ...partial, preferWeb: true }
    return { ok: false, error: `无法打开 ${safeHost(url)}`, preferWeb: true }
  }
  if (articleLooksLikeBlocked(raw)) {
    const fb = tryFallback()
    if (fb) return { ...fb, preferWeb: true, partial: true }
    const partial = tryPartialFallback()
    if (partial) {
      return {
        ...partial,
        preferWeb: true,
        error: '站点要求验证，未能拉全文；以下为订阅摘要'
      }
    }
    return {
      ok: false,
      error: '站点要求验证，简洁无法提取，请用「网页」阅读',
      preferWeb: true
    }
  }
  const { title, html } = extractReadableFromHtml(raw, parsed.href)
  const fb = tryFallback()
  if (html && isUsableExtract(html)) {
    // 页面提取无图但订阅正文有媒体 → 用订阅（常见于反爬页只吐出摘要）
    if (articleMissingExpectedMedia(html) && fb && articleHasMedia(fb.html)) {
      return { ok: true, title, html: fb.html }
    }
    return { ok: true, title, html }
  }
  if (fb) return { ...fb, title }
  const partial = tryPartialFallback()
  if (partial) {
    return {
      ...partial,
      title,
      preferWeb: true,
      error: '未能提取完整正文；以下为订阅摘要'
    }
  }
  return {
    ok: false,
    title,
    error: '未能提取有效正文（多为导航壳或前端渲染页），请切换「网页」',
    preferWeb: true
  }
}
