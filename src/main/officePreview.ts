/**
 * Office 族只读预览：OOXML → 安全 HTML。
 * 保留字号/颜色/标题/列表/表格；PPT 做 16:9 幻灯卡片并内嵌小图。
 */
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { unzipBuffer } from './zipUtil'

const MAX_BYTES = 96 * 1024 * 1024
const MAX_ENTRY_BYTES = 24 * 1024 * 1024
const MAX_MEDIA_BYTES = 1_500_000
const MAX_HTML = 480_000
const MAX_PPT_SLIDES = 40
const MAX_PPT_IMAGES = 24

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

function attr(xml: string, name: string): string {
  return (
    xml.match(new RegExp(`${name}="([^"]*)"`))?.[1] ||
    xml.match(new RegExp(`${name}='([^']*)'`))?.[1] ||
    ''
  )
}

function officeEntryWanted(name: string, ext: string): boolean {
  const n = name.replace(/^\/+/, '')
  if (ext === '.docx') {
    return (
      n === 'word/document.xml' ||
      n === 'word/styles.xml' ||
      n === 'word/_rels/document.xml.rels' ||
      /^word\/theme\//i.test(n) ||
      /^word\/media\//i.test(n)
    )
  }
  if (ext === '.pptx') {
    return (
      n === 'ppt/presentation.xml' ||
      /^ppt\/slides\/slide\d+\.xml$/i.test(n) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(n) ||
      /^ppt\/media\//i.test(n) ||
      /^ppt\/theme\/theme\d+\.xml$/i.test(n)
    )
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    return (
      n === 'xl/workbook.xml' ||
      n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/styles.xml' ||
      n === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)
    )
  }
  return false
}

function entryMap(buf: Buffer, ext: string): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  const entries = unzipBuffer(buf, {
    accept: (name) => officeEntryWanted(name, ext),
    maxEntryBytes: MAX_ENTRY_BYTES
  })
  for (const e of entries) {
    const key = e.name.replace(/^\/+/, '')
    if (/\/media\//i.test(key) && e.data.length > MAX_MEDIA_BYTES) continue
    map.set(key, e.data)
  }
  return map
}

function truncateHtml(html: string): { html: string; truncated: boolean } {
  if (html.length <= MAX_HTML) return { html, truncated: false }
  return { html: `${html.slice(0, MAX_HTML)}…`, truncated: true }
}

function xmlTexts(chunk: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(chunk))) out.push(decodeXmlEntities(m[1] || ''))
  return out
}

function headingLevelFromStyleName(name: string): 1 | 2 | 3 | 0 {
  const s = (name || '').toLowerCase().replace(/\s+/g, '')
  if (/^(heading1|标题1|title)$/i.test(s) || /heading1|标题1/.test(s)) return 1
  if (/^(heading2|标题2)$/i.test(s) || /heading2|标题2/.test(s)) return 2
  if (/^(heading3|标题3)$/i.test(s) || /heading3|标题3/.test(s)) return 3
  return 0
}

/** styles.xml：styleId → 标题级别（中文 Word 常用 1/2/3 而不是 Heading1）。 */
function parseHeadingStyles(stylesXml: string | undefined): Map<string, 1 | 2 | 3> {
  const map = new Map<string, 1 | 2 | 3>()
  if (!stylesXml) return map
  const re = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stylesXml))) {
    const head = m[1] || ''
    const body = m[2] || ''
    if (!/\bw:type="paragraph"/.test(head) && !/\bw:type='paragraph'/.test(head)) continue
    const id = attr(head, 'w:styleId')
    if (!id) continue
    const name = attr(body.match(/<w:name\b[^/]*\/>/)?.[0] || body, 'w:val')
    let lvl = headingLevelFromStyleName(name) || headingLevelFromStyleName(id)
    if (!lvl) {
      const outline = body.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/)?.[1]
      if (outline === '0') lvl = 1
      else if (outline === '1') lvl = 2
      else if (outline === '2') lvl = 3
    }
    if (lvl) map.set(id, lvl)
  }
  return map
}

function halfPointsToPt(val: string): number | null {
  const n = Number(val)
  if (!Number.isFinite(n) || n <= 0) return null
  return n / 2
}

function colorCss(hex: string): string | null {
  let h = (hex || '').replace(/^#/, '').toUpperCase()
  if (h === 'AUTO' || h === 'NONE') return null
  if (h.length === 8) h = h.slice(2)
  if (!/^[0-9A-F]{6}$/.test(h)) return null
  return `#${h}`
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

type Theme = Map<string, string>

function parseThemeColors(xml: string | undefined): Theme {
  const map: Theme = new Map()
  if (!xml) return map
  const names = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink'
  ]
  for (const name of names) {
    const chunk = xml.match(new RegExp(`<a:${name}\\b[\\s\\S]*?</a:${name}>`))?.[0] || ''
    const hex =
      colorCss(attr(chunk.match(/<a:srgbClr\b[^>]*\/?>/)?.[0] || '', 'val') || '') ||
      colorCss(attr(chunk.match(/<a:sysClr\b[^>]*\/?>/)?.[0] || '', 'lastClr') || '')
    if (hex) map.set(name, hex)
  }
  const dk1 = map.get('dk1')
  const lt1 = map.get('lt1')
  const dk2 = map.get('dk2')
  const lt2 = map.get('lt2')
  if (dk1) map.set('tx1', dk1)
  if (lt1) map.set('bg1', lt1)
  if (dk2) map.set('tx2', dk2)
  if (lt2) map.set('bg2', lt2)
  return map
}

function parseFill(xml: string, theme: Theme): string | null {
  const solid =
    xml.match(/<a:solidFill\b[\s\S]*?<\/a:solidFill>/)?.[0] ||
    xml.match(/<a:solidFill\b[^>]*\/>/)?.[0] ||
    ''
  if (!solid) return null
  const srgb = colorCss(attr(solid.match(/<a:srgbClr\b[^>]*\/?>/)?.[0] || '', 'val') || '')
  if (srgb) return srgb
  const scheme = attr(solid.match(/<a:schemeClr\b[^>]*\/?>/)?.[0] || '', 'val')
  return (scheme && theme.get(scheme)) || null
}

function contrastInk(bg: string | null, fg: string | null): string {
  const background = bg || '#FFFFFF'
  const bgL = luminance(background)
  // 深底一律白字：主题金/灰叠在藏青上会发糊，差值够也不等于能读
  if (bgL < 140) return '#FFFFFF'
  if (fg && luminance(fg) < 130 && Math.abs(luminance(fg) - bgL) >= 90) return fg
  return '#1A1A1A'
}

function numAttr(xml: string, name: string): number {
  const n = Number(attr(xml, name))
  return Number.isFinite(n) ? n : 0
}

type EmuBox = { x: number; y: number; cx: number; cy: number }

function parseXfrm(xml: string): EmuBox | null {
  const xfrm = xml.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>/)?.[0]
  if (!xfrm) return null
  const off = xfrm.match(/<a:off\b[^>]*\/?>/)?.[0] || ''
  const ext = xfrm.match(/<a:ext\b[^>]*\/?>/)?.[0] || ''
  const x = numAttr(off, 'x')
  const y = numAttr(off, 'y')
  const cx = numAttr(ext, 'cx')
  const cy = numAttr(ext, 'cy')
  if (cx <= 0 && cy <= 0) return null
  return { x, y, cx: Math.max(cx, 1), cy: Math.max(cy, 1) }
}

function emuPct(n: number, total: number): string {
  if (!total) return '0%'
  return `${Math.max(0, Math.min(100, (n / total) * 100)).toFixed(2)}%`
}

function eachOpenTag(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}\\b`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const start = m.index
    const close = `</${tag}>`
    const end = xml.indexOf(close, start)
    if (end < 0) break
    out.push(xml.slice(start, end + close.length))
    re.lastIndex = end + close.length
  }
  return out
}

function wOnOff(xml: string, tag: string): boolean {
  const m = xml.match(new RegExp(`<w:${tag}\\b([^>/]*)/?>`))
  if (!m) return false
  const val = attr(m[0], 'w:val').toLowerCase()
  return val !== '0' && val !== 'false' && val !== 'off'
}

function runFontPt(run: string): number {
  return (
    halfPointsToPt(attr(run.match(/<w:sz\b[^/]*\/>/)?.[0] || '', 'w:val') || '') ||
    halfPointsToPt(attr(run.match(/<w:szCs\b[^/]*\/>/)?.[0] || '', 'w:val') || '') ||
    0
  )
}

/** 按出现顺序抽出顶层段落/表格；不能用「p|tbl」混正则，否则表格会在内部 `</w:p>` 处被截断。 */
function extractDocxBlocks(xml: string): Array<{ kind: 'p' | 'tbl'; xml: string }> {
  const out: Array<{ kind: 'p' | 'tbl'; xml: string }> = []
  const re = /<w:(tbl|p)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const kind = m[1] as 'p' | 'tbl'
    const start = m.index
    const close = `</w:${kind}>`
    const end = xml.indexOf(close, start)
    if (end < 0) break
    out.push({ kind, xml: xml.slice(start, end + close.length) })
    re.lastIndex = end + close.length
  }
  return out
}

/** Word：段落 / 标题 / 字号颜色 / 粗斜体 / 表格 / 图片 → HTML */
function previewDocxHtml(map: Map<string, Buffer>): string {
  const doc = map.get('word/document.xml')
  if (!doc) throw new Error('不是有效的 Word 文档')
  const xml = doc.toString('utf8')
  const headingStyles = parseHeadingStyles(map.get('word/styles.xml')?.toString('utf8'))
  const theme = parseThemeColors(map.get('word/theme/theme1.xml')?.toString('utf8'))
  const rels = parseRels(
    map.get('word/_rels/document.xml.rels')?.toString('utf8') || '',
    'word/_rels/document.xml.rels'
  )
  const parts: string[] = []
  let firstText = true

  for (const block of extractDocxBlocks(xml)) {
    if (block.kind === 'tbl') {
      parts.push(docxTableHtml(block.xml, theme))
      parts.push(embedDocxDrawings(block.xml, rels, map))
      firstText = false
      continue
    }
    parts.push(docxParagraphHtml(block.xml, headingStyles, rels, map, theme, firstText))
    if (parts[parts.length - 1] && !parts[parts.length - 1]!.includes('office-gap')) firstText = false
  }
  if (!parts.length) {
    const plain = xmlTexts(xml, 'w:t').join('')
    if (plain.trim()) parts.push(`<p>${escapeHtml(plain)}</p>`)
  }
  const html = parts.filter(Boolean).join('\n')
  if (!html.trim()) throw new Error('未能抽出可读内容')
  return `<article class="office-doc">${html}</article>`
}

function mediaImgHtml(
  map: Map<string, Buffer>,
  path: string,
  cls: string,
  widthPx?: number
): string {
  const buf = map.get(path)
  if (!buf || buf.length < 32) return ''
  const mime = mimeForMedia(path)
  if (!mime.startsWith('image/')) return ''
  const st =
    widthPx && widthPx > 8
      ? ` style="width:${Math.min(640, Math.round(widthPx))}px;max-width:100%;height:auto"`
      : ''
  return `<img class="${cls}" alt="" src="data:${mime};base64,${buf.toString('base64')}"${st}/>`
}

function embedDocxDrawings(
  xml: string,
  rels: Map<string, string>,
  map: Map<string, Buffer>
): string {
  const out: string[] = []
  for (const drawing of eachOpenTag(xml, 'w:drawing')) {
    const embed = attr(drawing.match(/<a:blip\b[^>]*>/)?.[0] || '', 'r:embed')
    const target = rels.get(embed)
    if (!target) continue
    const extent = drawing.match(/<wp:extent\b[^>]*\/?>/)?.[0] || ''
    const cx = numAttr(extent, 'cx')
    const widthPx = cx > 0 ? cx / 9525 : undefined
    const img = mediaImgHtml(map, target, 'office-doc-img', widthPx)
    if (img) out.push(img)
  }
  return out.join('')
}

function docxRunHtml(run: string, theme: Theme = new Map()): string {
  const texts = xmlTexts(run, 'w:t')
  const bits: string[] = []
  if (/<w:br\b/.test(run) || /<w:cr\b/.test(run)) bits.push('<br/>')
  if (/<w:tab\b/.test(run)) bits.push('&emsp;')
  let t = escapeHtml(texts.join(''))
  if (!t && !bits.length) return ''
  const bold = wOnOff(run, 'b') || wOnOff(run, 'bCs')
  const italic = wOnOff(run, 'i') || wOnOff(run, 'iCs')
  const underline = /<w:u\b[^>]*/.test(run) && !/\bw:val="(none|0)"/.test(run.match(/<w:u\b[^>]*>/)?.[0] || '')
  const sz = runFontPt(run) || null
  const colorEl = run.match(/<w:color\b[^>]*\/?>/)?.[0] || ''
  const color =
    colorCss(attr(colorEl, 'w:val') || '') ||
    (attr(colorEl, 'w:themeColor') ? theme.get(attr(colorEl, 'w:themeColor')) || null : null)
  const highlight = attr(run.match(/<w:highlight\b[^/]*\/>/)?.[0] || '', 'w:val')
  if (bold) t = `<strong>${t}</strong>`
  if (italic) t = `<em>${t}</em>`
  if (underline) t = `<u>${t}</u>`
  const styles: string[] = []
  if (sz && (sz >= 16 || sz <= 10)) styles.push(`font-size:${sz}pt`)
  if (color && color !== '#000000' && luminance(color) < 210) styles.push(`color:${color}`)
  const shd = attr(run.match(/<w:shd\b[^/]*\/>/)?.[0] || '', 'w:fill')
  const fill = colorCss(shd || '')
  if (highlight && highlight !== 'none') styles.push('background:#dbeafe')
  else if (fill && fill !== '#FFFFFF' && fill !== '#AUTO') styles.push(`background:${fill}`)
  const inner = `${bits.join('')}${t}`
  if (!inner) return ''
  if (styles.length) return `<span style="${styles.join(';')}">${inner}</span>`
  return inner
}

function docxParagraphHtml(
  pXml: string,
  headingStyles: Map<string, 1 | 2 | 3>,
  rels: Map<string, string>,
  map: Map<string, Buffer>,
  theme: Theme = new Map(),
  firstText = false
): string {
  const pPr = pXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || pXml.slice(0, 800)
  const styleId = attr(pPr.match(/<w:pStyle\b[^/]*\/>/)?.[0] || '', 'w:val')
  const outline = attr(pPr.match(/<w:outlineLvl\b[^/]*\/>/)?.[0] || '', 'w:val')
  const align = attr(pPr.match(/<w:jc\b[^/]*\/>/)?.[0] || '', 'w:val')
  const numbered = /<w:numPr\b/.test(pPr)
  const runs: string[] = []
  const runRe = /<w:r\b[\s\S]*?<\/w:r>/g
  let rm: RegExpExecArray | null
  let maxSz = 0
  let anyBold = false
  while ((rm = runRe.exec(pXml))) {
    const run = rm[0]
    const sz = runFontPt(run)
    if (sz > maxSz) maxSz = sz
    if (wOnOff(run, 'b') || wOnOff(run, 'bCs')) anyBold = true
    const html = docxRunHtml(run, theme)
    if (html) runs.push(html)
  }
  const inner = runs.join('')
  const plain = inner.replace(/<[^>]+>/g, '').trim()
  let tag = 'p'
  let lvl =
    headingStyles.get(styleId) ||
    headingLevelFromStyleName(styleId) ||
    (outline === '0' ? 1 : outline === '1' ? 2 : outline === '2' ? 3 : 0)
  if (!lvl && maxSz >= 22) lvl = 1
  else if (!lvl && maxSz >= 16) lvl = 2
  else if (!lvl && maxSz >= 14 && anyBold) lvl = 3
  // 中文报告常用「一、二、」作节标题，即使没套 Heading 样式
  if (!lvl && /^[一二三四五六七八九十百]+[、.．]/.test(plain)) lvl = 2
  if (!lvl && /^[0-9]+[.、．]/.test(plain) && (anyBold || maxSz >= 12)) lvl = 3
  if (
    firstText &&
    !lvl &&
    plain.length > 0 &&
    plain.length < 48
  ) {
    lvl = 1
  }
  const paraFill = colorCss(attr(pPr.match(/<w:shd\b[^/]*\/>/)?.[0] || '', 'w:fill') || '')
  if (lvl === 1) tag = 'h1'
  else if (lvl === 2) tag = 'h2'
  else if (lvl === 3) tag = 'h3'

  const cls: string[] = []
  if (numbered && tag === 'p') cls.push('office-li')
  if (tag === 'p' && paraFill && paraFill !== '#FFFFFF' && luminance(paraFill) > 180) {
    cls.push('office-callout')
  }
  const styles: string[] = []
  if (align === 'center' || align === 'right' || align === 'both') {
    styles.push(`text-align:${align === 'both' ? 'justify' : align}`)
  }
  if (paraFill && paraFill !== '#FFFFFF' && !cls.includes('office-callout')) {
    styles.push(`background:${paraFill}`)
  }
  if (!inner.trim() && !/<w:drawing\b/.test(pXml)) return tag === 'p' ? `<p class="office-gap"><br/></p>` : ''
  const imgs = embedDocxDrawings(pXml, rels, map)
  const classAttr = cls.length ? ` class="${cls.join(' ')}"` : ''
  const styleAttr = styles.length ? ` style="${styles.join(';')}"` : ''
  if (!inner.trim() && imgs) return `<p class="office-img-wrap">${imgs}</p>`
  return `<${tag}${classAttr}${styleAttr}>${inner}${imgs}</${tag}>`
}

function docxCellInner(tcXml: string, theme: Theme): string {
  const paras: string[] = []
  for (const p of eachOpenTag(tcXml, 'w:p')) {
    const runs: string[] = []
    const runRe = /<w:r\b[\s\S]*?<\/w:r>/g
    let rm: RegExpExecArray | null
    while ((rm = runRe.exec(p))) {
      const html = docxRunHtml(rm[0], theme)
      if (html) runs.push(html)
    }
    paras.push(runs.join('') || escapeHtml(xmlTexts(p, 'w:t').join('')))
  }
  return paras.filter(Boolean).join('<br/>') || '&nbsp;'
}

function docxTableHtml(tblXml: string, theme: Theme = new Map()): string {
  const rows: string[] = []
  const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g
  let rm: RegExpExecArray | null
  let rowIdx = 0
  while ((rm = rowRe.exec(tblXml))) {
    const cells: string[] = []
    const header = rowIdx === 0 || /<w:tblHeader\b/.test(rm[0])
    const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rm[0]))) {
      const tcPr = cm[0].match(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/)?.[0] || ''
      if (/<w:vMerge\b/.test(tcPr) && !/w:val="restart"/.test(tcPr)) continue
      const cell = docxCellInner(cm[0], theme)
      const fill = colorCss(attr(cm[0].match(/<w:shd\b[^/]*\/>/)?.[0] || '', 'w:fill') || '')
      const span = Number(attr(cm[0].match(/<w:gridSpan\b[^/]*\/>/)?.[0] || '', 'w:val') || '1')
      const tag = header ? 'th' : 'td'
      const st: string[] = []
      if (fill && fill !== '#FFFFFF') {
        st.push(`background:${fill}`)
        if (header || luminance(fill) < 140) st.push('color:#fff')
      }
      const spanAttr = span > 1 ? ` colspan="${span}"` : ''
      const styleAttr = st.length ? ` style="${st.join(';')}"` : ''
      cells.push(`<${tag}${spanAttr}${styleAttr}>${cell}</${tag}>`)
    }
    if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`)
    rowIdx++
  }
  if (!rows.length) return ''
  return `<div class="office-table-wrap"><table class="office-table"><tbody>${rows.join('')}</tbody></table></div>`
}

function mimeForMedia(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

function resolveRelTarget(fromFile: string, target: string): string {
  const t = target.replace(/\\/g, '/')
  if (t.startsWith('/')) return t.replace(/^\/+/, '')
  const parts = fromFile.split('/')
  parts.pop()
  // OOXML：_rels 旁的 Target 相对的是上一级目录
  if (parts[parts.length - 1] === '_rels') parts.pop()
  for (const part of t.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function parseRels(xml: string, fromFile: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /<Relationship\b([^>]*)\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const chunk = m[1] || ''
    const id = attr(chunk, 'Id')
    const target = attr(chunk, 'Target')
    if (!id || !target) continue
    map.set(id, resolveRelTarget(fromFile, target))
  }
  return map
}

function pptShapeKind(spXml: string): 'title' | 'body' | 'other' {
  const ph = spXml.match(/<p:ph\b[^/]*\/?>/)?.[0] || ''
  const type = attr(ph, 'type').toLowerCase()
  if (type === 'title' || type === 'ctrtitle' || type === 'centertitle') return 'title'
  if (type === 'subtitle') return 'title'
  if (type === 'body' || type === 'obj' || !type) return 'body'
  return 'other'
}

/** DrawingML sz 单位是 1/100 pt（2800 = 28pt），不是 Word 的半磅。 */
function emuSzToPt(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n / 100
}

/** 标准 16:9 宽 13.333in = 960pt；按幻灯片宽度比例，避免估大发糊。 */
function pptFontCqw(pt: number): string {
  const cqw = Math.min(11, Math.max(1.15, (pt / 960) * 100))
  return `${cqw.toFixed(2)}cqw`
}

const PPT_FONT_MAP: Record<string, string> = {
  微软雅黑: '"Microsoft YaHei", "PingFang SC", sans-serif',
  'microsoft yahei': '"Microsoft YaHei", "PingFang SC", sans-serif',
  黑体: '"Heiti SC", "PingFang SC", sans-serif',
  simhei: '"Heiti SC", "PingFang SC", sans-serif',
  宋体: '"Songti SC", SimSun, serif',
  simsun: '"Songti SC", SimSun, serif',
  楷体: '"Kaiti SC", KaiTi, serif',
  arial: 'Arial, "Helvetica Neue", sans-serif',
  calibri: 'Calibri, "PingFang SC", sans-serif',
  'times new roman': '"Times New Roman", "Songti SC", serif'
}

function pptTypefaceCss(xml: string): string | null {
  const ea = attr(xml.match(/<a:ea\b[^/]*\/?>/)?.[0] || '', 'typeface')
  const latin = attr(xml.match(/<a:latin\b[^/]*\/?>/)?.[0] || '', 'typeface')
  const raw = (ea || latin || '').trim()
  if (!raw || raw.startsWith('+')) return null
  return PPT_FONT_MAP[raw.toLowerCase()] || `"${raw.replace(/"/g, '')}", "PingFang SC", sans-serif`
}

function pptSlideSize(map: Map<string, Buffer>): EmuBox {
  const xml = map.get('ppt/presentation.xml')?.toString('utf8') || ''
  const sz = xml.match(/<p:sldSz\b[^>]*\/?>/)?.[0] || ''
  return {
    x: 0,
    y: 0,
    cx: numAttr(sz, 'cx') || 12192000,
    cy: numAttr(sz, 'cy') || 6858000
  }
}

function pptSlideBg(xml: string, theme: Theme): string {
  const bg = xml.match(/<p:bg\b[\s\S]*?<\/p:bg>/)?.[0] || ''
  return parseFill(bg, theme) || theme.get('lt1') || '#FFFFFF'
}

function pptParaHtml(pXml: string, kind: 'title' | 'body' | 'other', boxBg: string | null, theme: Theme): string {
  const texts = xmlTexts(pXml, 'a:t')
  const line = texts.join('')
  if (!line.trim()) return ''
  const rPr = pXml.match(/<a:rPr\b[^>]*>/)?.[0] || pXml.match(/<a:defRPr\b[^>]*>/)?.[0] || ''
  const sz = emuSzToPt(attr(rPr, 'sz'))
  const bold = /\bb="1"/.test(rPr) || /<a:b\b/.test(pXml)
  const rFill = pXml.match(/<a:rPr\b[\s\S]*?<\/a:rPr>/)?.[0] || rPr
  const color = contrastInk(boxBg, parseFill(rFill, theme))
  const algn = attr(pXml.match(/<a:pPr\b[^>]*\/?>/)?.[0] || '', 'algn')
  const bullet =
    kind !== 'title' &&
    (/<a:buChar\b/.test(pXml) || /<a:buAutoNum\b/.test(pXml) || /<a:buFont\b/.test(pXml))
  let t = escapeHtml(line)
  if (bold) t = `<strong>${t}</strong>`
  if (bullet) t = `<span class="office-bu">•</span>${t}`
  const styles: string[] = [`color:${color}`]
  if (sz) styles.push(`font-size:${pptFontCqw(sz)}`)
  const face = pptTypefaceCss(pXml)
  if (face) styles.push(`font-family:${face}`)
  if (algn === 'ctr') styles.push('text-align:center')
  if (algn === 'r') styles.push('text-align:right')
  const tag = kind === 'title' ? 'h2' : 'p'
  const cls = kind === 'title' ? ' class="office-slide-title"' : ''
  return `<${tag}${cls} style="${styles.join(';')}">${t}</${tag}>`
}

function pptBoxStyle(box: EmuBox, slide: EmuBox, fill: string | null): string {
  const st = [
    `left:${emuPct(box.x, slide.cx)}`,
    `top:${emuPct(box.y, slide.cy)}`,
    `width:${emuPct(box.cx, slide.cx)}`,
    `height:${emuPct(box.cy, slide.cy)}`
  ]
  if (fill) st.push(`background:${fill}`)
  return st.join(';')
}

function defaultPptBox(kind: 'title' | 'body' | 'other', slide: EmuBox, bodyIndex: number): EmuBox {
  if (kind === 'title') {
    return { x: slide.cx * 0.06, y: slide.cy * 0.07, cx: slide.cx * 0.88, cy: slide.cy * 0.18 }
  }
  const y = slide.cy * (0.28 + bodyIndex * 0.16)
  return { x: slide.cx * 0.06, y, cx: slide.cx * 0.88, cy: slide.cy * 0.14 }
}

function pptTableHtml(tblXml: string, theme: Theme, boxBg: string | null): string {
  const rows: string[] = []
  const trRe = /<a:tr\b[\s\S]*?<\/a:tr>/g
  let rm: RegExpExecArray | null
  let rIdx = 0
  while ((rm = trRe.exec(tblXml))) {
    const cells: string[] = []
    const tcRe = /<a:tc\b[\s\S]*?<\/a:tc>/g
    let cm: RegExpExecArray | null
    while ((cm = tcRe.exec(rm[0]))) {
      const t = xmlTexts(cm[0], 'a:t').join('').trim()
      const fill = parseFill(cm[0], theme)
      const tag = rIdx === 0 ? 'th' : 'td'
      const ink = contrastInk(fill || boxBg, null)
      const st = fill ? ` style="background:${fill};color:${ink}"` : ''
      cells.push(`<${tag}${st}>${escapeHtml(t) || '&nbsp;'}</${tag}>`)
    }
    if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`)
    rIdx++
  }
  if (!rows.length) return ''
  return `<div class="office-table-wrap"><table class="office-table office-slide-table"><tbody>${rows.join('')}</tbody></table></div>`
}

/** PPT：按 EMU 坐标铺 16:9 画布（形状填充 / 文本框 / 图 / 表）。 */
function previewPptxHtml(map: Map<string, Buffer>): { html: string; truncated: boolean } {
  const allSlides = [...map.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!allSlides.length) throw new Error('演示文稿里没有幻灯片')
  const truncated = allSlides.length > MAX_PPT_SLIDES
  const slides = allSlides.slice(0, MAX_PPT_SLIDES)
  const themeFile = [...map.keys()].find((k) => /^ppt\/theme\/theme\d+\.xml$/i.test(k))
  const theme = parseThemeColors(themeFile ? map.get(themeFile)?.toString('utf8') : undefined)
  const slide = pptSlideSize(map)
  const parts: string[] = []
  let imagesUsed = 0

  for (const key of slides) {
    const n = key.match(/slide(\d+)/i)?.[1] || '?'
    const xml = map.get(key)!.toString('utf8')
    const relsFile = key.replace(/slides\//, 'slides/_rels/') + '.rels'
    const rels = parseRels(map.get(relsFile)?.toString('utf8') || '', relsFile)
    const bg = pptSlideBg(xml, theme)
    const boxes: string[] = []
    let sawTitle = false
    let bodyIndex = 0
    const hasXfrm = /<a:off\b/.test(xml) && /<a:ext\b/.test(xml)

    for (const sp of eachOpenTag(xml, 'p:sp')) {
      const kind = pptShapeKind(sp)
      const spPr = sp.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0] || ''
      const fill = parseFill(spPr, theme)
      const paras: string[] = []
      for (const p of eachOpenTag(sp, 'a:p')) {
        const useKind = kind === 'title' && !sawTitle ? 'title' : kind === 'title' ? 'body' : kind
        const html = pptParaHtml(p, useKind === 'other' ? 'body' : useKind, fill || bg, theme)
        if (html) {
          if (useKind === 'title') sawTitle = true
          paras.push(html)
        }
      }
      if (!paras.length && !fill) continue
      const box =
        parseXfrm(sp) ||
        (hasXfrm ? null : defaultPptBox(kind, slide, kind === 'title' ? 0 : bodyIndex++))
      if (!box) {
        if (paras.length) boxes.push(`<div class="office-sp is-flow">${paras.join('')}</div>`)
        continue
      }
      const cls = kind === 'title' ? 'office-sp is-title' : 'office-sp'
      boxes.push(`<div class="${cls}" style="${pptBoxStyle(box, slide, fill)}">${paras.join('')}</div>`)
    }

    for (const pic of eachOpenTag(xml, 'p:pic')) {
      if (imagesUsed >= MAX_PPT_IMAGES) break
      const embed = attr(pic.match(/<a:blip\b[^>]*>/)?.[0] || '', 'r:embed')
      const target = rels.get(embed)
      if (!target) continue
      const buf = map.get(target)
      if (!buf || buf.length < 32) continue
      const mime = mimeForMedia(target)
      if (!mime.startsWith('image/')) continue
      imagesUsed++
      const box = parseXfrm(pic) || {
        x: slide.cx * 0.12,
        y: slide.cy * 0.32,
        cx: slide.cx * 0.76,
        cy: slide.cy * 0.5
      }
      boxes.push(
        `<div class="office-sp is-pic" style="${pptBoxStyle(box, slide, null)}"><img alt="" src="data:${mime};base64,${buf.toString('base64')}"/></div>`
      )
    }

    for (const gf of eachOpenTag(xml, 'p:graphicFrame')) {
      const tbl = gf.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/)?.[0]
      if (!tbl) continue
      const table = pptTableHtml(tbl, theme, bg)
      if (!table) continue
      const box = parseXfrm(gf) || {
        x: slide.cx * 0.06,
        y: slide.cy * 0.28,
        cx: slide.cx * 0.88,
        cy: slide.cy * 0.6
      }
      boxes.push(`<div class="office-sp is-table" style="${pptBoxStyle(box, slide, null)}">${table}</div>`)
    }

    if (!boxes.length) {
      const all = xmlTexts(xml, 'a:t').join(' ').trim()
      if (all) {
        boxes.push(
          `<div class="office-sp is-flow" style="${pptBoxStyle(defaultPptBox('body', slide, 0), slide, null)}"><p>${escapeHtml(all)}</p></div>`
        )
      }
    }
    if (!boxes.length) continue
    const on = parts.length === 0 ? ' is-on' : ''
    parts.push(
      `<section class="office-slide${on}"><header>幻灯片 ${escapeHtml(n)}</header><div class="office-slide-canvas" style="background:${bg}">${boxes.join('')}</div></section>`
    )
  }
  if (!parts.length) throw new Error('未能抽出可读内容')
  return { html: `<div class="office-deck">${parts.join('\n')}</div>`, truncated }
}

function colLettersToIndex(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') continue
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n
}

function parseA1(ref: string): { c: number; r: number } | null {
  const m = (ref || '').trim().match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return { c: colLettersToIndex(m[1]!), r: Number(m[2]) }
}

function parseA1Range(ref: string): { c1: number; r1: number; c2: number; r2: number } | null {
  const [a, b] = (ref || '').split(':')
  const p1 = parseA1(a || '')
  const p2 = parseA1(b || a || '')
  if (!p1 || !p2) return null
  return {
    c1: Math.min(p1.c, p2.c),
    r1: Math.min(p1.r, p2.r),
    c2: Math.max(p1.c, p2.c),
    r2: Math.max(p1.r, p2.r)
  }
}

type XfStyle = { fill?: string; bold?: boolean; align?: string; numFmt?: number }

function parseXlsxStyles(xml: string | undefined): XfStyle[] {
  const out: XfStyle[] = []
  if (!xml) return out
  const fonts: Array<{ bold?: boolean }> = []
  const fontRe = /<font\b[^>]*>([\s\S]*?)<\/font>/g
  let fm: RegExpExecArray | null
  while ((fm = fontRe.exec(xml))) {
    fonts.push({ bold: /<b\b/.test(fm[1] || '') })
  }
  const fills: string[] = []
  const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>/g
  let fl: RegExpExecArray | null
  while ((fl = fillRe.exec(xml))) {
    const rgb =
      fl[1]?.match(/<fgColor\b[^>]*rgb="([0-9A-Fa-f]{6,8})"/)?.[1] ||
      fl[1]?.match(/<bgColor\b[^>]*rgb="([0-9A-Fa-f]{6,8})"/)?.[1] ||
      ''
    const hex = rgb.length === 8 ? rgb.slice(2) : rgb
    fills.push(colorCss(hex) || '')
  }
  const xfRe = /<xf\b([^>]*)\/?>/g
  let xm: RegExpExecArray | null
  const parts = xml.split(/<cellXfs\b/)
  const cellPart = parts[1] || ''
  if (!cellPart) return out
  while ((xm = xfRe.exec(cellPart))) {
    const a = xm[1] || ''
    const fontId = Number(attr(a, 'fontId') || 0)
    const fillId = Number(attr(a, 'fillId') || 0)
    const numFmt = Number(attr(a, 'numFmtId') || 0)
    out.push({
      fill: fills[fillId] || undefined,
      bold: fonts[fontId]?.bold,
      numFmt: Number.isFinite(numFmt) ? numFmt : 0
    })
  }
  return out
}

function formatExcelValue(raw: string, t: string, strings: string[], numFmt?: number): string {
  if (t === 's' && raw !== '') {
    const idx = Number(raw)
    return Number.isFinite(idx) ? strings[idx] ?? raw : raw
  }
  if (t === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  if (t === 'str' || t === 'inlineStr') return raw
  const n = Number(raw)
  if (raw !== '' && Number.isFinite(n)) {
    if (numFmt === 9) return `${Math.round(n * 100)}%`
    if (numFmt === 10) return `${(n * 100).toFixed(2)}%`
    if (numFmt === 2) return n.toFixed(2)
    if (numFmt === 3) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  return raw
}

function sheetNames(map: Map<string, Buffer>): Map<string, string> {
  const names = new Map<string, string>()
  const wb = map.get('xl/workbook.xml')?.toString('utf8') || ''
  const rels = parseRels(
    map.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '',
    'xl/_rels/workbook.xml.rels'
  )
  const re = /<sheet\b([^>]*)\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(wb))) {
    const a = m[1] || ''
    const name = attr(a, 'name')
    const rid = attr(a, 'r:id') || attr(a, 'r:Id')
    const target = rid ? rels.get(rid) : ''
    if (name && target) names.set(target, name)
  }
  return names
}

const MAX_XLS_ROWS = 120
const MAX_XLS_COLS = 40

/** Excel：按单元格坐标铺网格（合并/空单元格/填充/多表）。 */
function previewXlsxHtml(map: Map<string, Buffer>): string {
  const shared = map.get('xl/sharedStrings.xml')
  const strings: string[] = []
  if (shared) {
    const xml = shared.toString('utf8')
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml))) {
      const chunk = m[1] || ''
      const texts = xmlTexts(chunk, 't')
      strings.push(texts.join('') || decodeXmlEntities(chunk.replace(/<[^>]+>/g, '')))
    }
  }
  const styles = parseXlsxStyles(map.get('xl/styles.xml')?.toString('utf8'))
  const names = sheetNames(map)
  const sheets = [...map.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!sheets.length) throw new Error('表格里没有工作表')

  const tabs: string[] = []
  const bodies: string[] = []
  sheets.forEach((key, i) => {
    const xml = map.get(key)!.toString('utf8')
    const title = names.get(key) || `工作表 ${i + 1}`
    const grid = sheetToGridHtml(xml, strings, styles)
    if (!grid.html) return
    const id = `xls-${i}`
    tabs.push(
      `<button type="button" class="office-sheet-tab${i === 0 ? ' is-on' : ''}" data-sheet="${id}">${escapeHtml(title)}</button>`
    )
    bodies.push(
      `<div class="office-sheet-pane${i === 0 ? ' is-on' : ''}" data-sheet="${id}">${grid.html}</div>`
    )
  })
  if (!bodies.length) throw new Error('未能抽出可读内容')
  return `<div class="office-book">${tabs.length > 1 ? `<nav class="office-sheet-tabs">${tabs.join('')}</nav>` : ''}${bodies.join('')}</div>`
}

function sheetToGridHtml(
  xml: string,
  strings: string[],
  styles: XfStyle[]
): { html: string } {
  type Cell = { text: string; style?: XfStyle }
  const cells = new Map<string, Cell>()
  let minR = Infinity
  let minC = Infinity
  let maxR = 0
  let maxC = 0
  const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
  let cm: RegExpExecArray | null
  while ((cm = cRe.exec(xml))) {
    const a = cm[1] || ''
    const body = cm[2] || ''
    const ref = attr(a, 'r')
    const pos = parseA1(ref)
    if (!pos) continue
    const t = attr(a, 't')
    const sIdx = Number(attr(a, 's') || 0)
    const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]?.trim() ?? ''
    const inline = t === 'inlineStr' ? xmlTexts(body, 't').join('') : ''
    const text = formatExcelValue(inline || v, t, strings, styles[sIdx]?.numFmt)
    cells.set(`${pos.r},${pos.c}`, { text, style: styles[sIdx] })
    minR = Math.min(minR, pos.r)
    minC = Math.min(minC, pos.c)
    maxR = Math.max(maxR, pos.r)
    maxC = Math.max(maxC, pos.c)
  }
  if (!cells.size) return { html: '' }
  maxR = Math.min(maxR, minR + MAX_XLS_ROWS - 1)
  maxC = Math.min(maxC, minC + MAX_XLS_COLS - 1)

  const merges: Array<{ c1: number; r1: number; c2: number; r2: number }> = []
  const covered = new Set<string>()
  const mergeRe = /<mergeCell\b[^>]*ref="([^"]+)"/g
  let mm: RegExpExecArray | null
  while ((mm = mergeRe.exec(xml))) {
    const g = parseA1Range(mm[1] || '')
    if (!g) continue
    merges.push(g)
    for (let r = g.r1; r <= g.r2; r++) {
      for (let c = g.c1; c <= g.c2; c++) {
        if (r === g.r1 && c === g.c1) continue
        covered.add(`${r},${c}`)
      }
    }
  }

  const thead: string[] = ['<th class="office-axis"></th>']
  for (let c = minC; c <= maxC; c++) {
    thead.push(`<th class="office-axis">${escapeHtml(colName(c))}</th>`)
  }
  const rows: string[] = [`<tr>${thead.join('')}</tr>`]
  for (let r = minR; r <= maxR; r++) {
    const tds = [`<th class="office-axis">${r}</th>`]
    for (let c = minC; c <= maxC; c++) {
      const key = `${r},${c}`
      if (covered.has(key)) continue
      const merge = merges.find((g) => g.r1 === r && g.c1 === c)
      const cell = cells.get(key)
      const rs = merge && merge.r2 > merge.r1 ? ` rowspan="${merge.r2 - merge.r1 + 1}"` : ''
      const cs = merge && merge.c2 > merge.c1 ? ` colspan="${merge.c2 - merge.c1 + 1}"` : ''
      const st: string[] = []
      if (cell?.style?.fill) st.push(`background:${cell.style.fill}`)
      if (cell?.style?.bold) st.push('font-weight:700')
      const styleAttr = st.length ? ` style="${st.join(';')}"` : ''
      const tag = r === minR ? 'th' : 'td'
      tds.push(
        `<${tag}${rs}${cs}${styleAttr}>${escapeHtml(cell?.text || '') || '&nbsp;'}</${tag}>`
      )
    }
    rows.push(`<tr>${tds.join('')}</tr>`)
  }
  return {
    html: `<div class="office-table-wrap"><table class="office-table office-grid"><tbody>${rows.join('')}</tbody></table></div>`
  }
}

function colName(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const m = (x - 1) % 26
    s = String.fromCharCode(65 + m) + s
    x = Math.floor((x - 1) / 26)
  }
  return s || 'A'
}

export type OfficeHtmlResult =
  | { ok: true; html: string; truncated: boolean; format: string }
  | { ok: false; error: string }

export function readOfficePreviewText(path: string): OfficeHtmlResult {
  try {
    const ext = extname(path).toLowerCase()
    if (!['.docx', '.pptx', '.xlsx', '.xlsm'].includes(ext)) {
      return { ok: false, error: '暂不支持该 Office 格式的应用内预览（可用系统打开）' }
    }
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, error: '不是文件' }
    if (st.size > MAX_BYTES) {
      return {
        ok: false,
        error: `文件约 ${Math.round(st.size / (1024 * 1024))}MB，超过内嵌预览上限，请用系统打开`
      }
    }
    const map = entryMap(readFileSync(path), ext)
    const format = ext.slice(1)
    let html = ''
    let moreTruncated = false
    if (ext === '.docx') html = previewDocxHtml(map)
    else if (ext === '.pptx') {
      const deck = previewPptxHtml(map)
      html = deck.html
      moreTruncated = deck.truncated
    } else html = previewXlsxHtml(map)
    const cut = truncateHtml(html)
    return {
      ok: true,
      html: cut.html,
      truncated: cut.truncated || moreTruncated,
      format
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/ENOMEM|heap|allocation|out of memory/i.test(msg)) {
      return { ok: false, error: '内存不足，文件过大无法内嵌预览，请用系统打开' }
    }
    return { ok: false, error: msg }
  }
}
