/**
 * CSV/TSV 预览：表格 Markdown（单元格里的 $…$ 可走现有 KaTeX）。
 */

const MAX_ROWS = 200
const MAX_COLS = 24
const MAX_CELL = 400

export function detectCsvDelim(text: string): ',' | '\t' | ';' {
  const first = (text || '').split(/\r?\n/, 3).join('\n')
  const tabs = (first.match(/\t/g) || []).length
  const semis = (first.match(/;/g) || []).length
  const commas = (first.match(/,/g) || []).length
  if (tabs > commas && tabs > semis) return '\t'
  if (semis > commas && semis > tabs) return ';'
  return ','
}

/** 简易 RFC4180：引号字段、换行、分隔符。 */
export function parseCsv(text: string, delim?: ',' | '\t' | ';'): string[][] {
  const src = (text || '').replace(/^\uFEFF/, '')
  if (!src.trim()) return []
  const d = delim || detectCsvDelim(src)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let q = false
  while (i < src.length) {
    const ch = src[i]!
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        q = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      q = true
      i++
      continue
    }
    if (ch === d) {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (ch === '\n' || ch === '\r') {
      row.push(cell)
      cell = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      if (ch === '\r' && src[i + 1] === '\n') i += 2
      else i++
      continue
    }
    cell += ch
    i++
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

function escapeMdCell(s: string): string {
  return (s || '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .slice(0, MAX_CELL)
}

/** 转成 GFM 表，便于 MarkdownHtml / KaTeX 渲染公式。 */
export function csvToMarkdown(text: string, ext?: string): { markdown: string; truncated: boolean } {
  const delim = ext === '.tsv' ? '\t' : detectCsvDelim(text)
  const all = parseCsv(text, delim)
  if (!all.length) return { markdown: '（空表）', truncated: false }
  const truncated = all.length > MAX_ROWS || (all[0]?.length || 0) > MAX_COLS
  const rows = all.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map(escapeMdCell))
  const width = Math.max(1, ...rows.map((r) => r.length))
  const pad = (r: string[]): string[] => {
    const next = r.slice()
    while (next.length < width) next.push('')
    return next
  }
  const head = pad(rows[0] || [])
  const body = rows.slice(1).map(pad)
  const line = (r: string[]): string => `| ${r.join(' | ')} |`
  const sep = `| ${head.map(() => '---').join(' | ')} |`
  const md = [line(head), sep, ...body.map(line)].join('\n')
  return { markdown: md, truncated }
}
