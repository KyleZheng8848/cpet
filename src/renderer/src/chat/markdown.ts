import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import 'katex/dist/katex.min.css'
import { rewriteLocalImageSrc, linkifyBareLocalImagePaths } from '@shared/filePreview'

marked.setOptions({
  breaks: true,
  gfm: true
})

/** $…$ / $$…$$；nonStandard 兼容中文模型常写的无空格公式。 */
marked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
    strict: 'ignore'
  })
)

const DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form']

/**
 * 把 \(…\) / \[…\] 以及 ```math 转成 $ / $$，便于 KaTeX 扩展识别。
 * 跳过普通代码块与行内 code，避免误伤。
 */
function normalizeMathDelimiters(src: string): string {
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts
    .map((part) => {
      if (part.startsWith('```')) {
        const m = part.match(/^```(?:math|latex|tex)\s*\n([\s\S]*?)```$/i)
        if (m) return `\n$$\n${m[1].trim()}\n$$\n`
        return part
      }
      if (part.startsWith('`')) return part
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_all, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_all, body: string) => `$${body}$`)
    })
    .join('')
}

/**
 * 纠正常见「看起来像表、但不是 GFM」的写法，提高表格命中率。
 * - 全角竖线 ｜ → |
 * - 用制表符分列的简易表 → GFM
 */
function normalizeTables(src: string): string {
  const parts = src.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part
      let s = part.replace(/｜/g, '|')
      s = convertTabTables(s)
      return s
    })
    .join('')
}

/** 连续 ≥2 行、且每行都有 tab 分列 → 转成 GFM 表。 */
function convertTabTables(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const row = splitTabRow(lines[i])
    if (!row || row.length < 2) {
      out.push(lines[i])
      i++
      continue
    }
    const block: string[][] = [row]
    let j = i + 1
    while (j < lines.length) {
      const next = splitTabRow(lines[j])
      if (!next || next.length < 2) break
      block.push(next)
      j++
    }
    if (block.length >= 2) {
      const cols = Math.max(...block.map((r) => r.length))
      const pad = (r: string[]): string[] => {
        const x = [...r]
        while (x.length < cols) x.push('')
        return x
      }
      const header = pad(block[0]).map(escCell)
      const sep = header.map(() => '---')
      out.push(`| ${header.join(' | ')} |`)
      out.push(`| ${sep.join(' | ')} |`)
      for (const r of block.slice(1)) {
        out.push(`| ${pad(r).map(escCell).join(' | ')} |`)
      }
      i = j
      continue
    }
    out.push(lines[i])
    i++
  }
  return out.join('\n')
}

function splitTabRow(line: string): string[] | null {
  if (!line.includes('\t')) return null
  const cells = line.split('\t').map((c) => c.trim())
  if (cells.filter(Boolean).length < 2) return null
  return cells
}

function escCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/**
 * 轻量消毒：CSP 已禁用脚本执行，这里再做一层防御——
 * 移除危险标签、on* 事件属性、javascript: 链接，并给外链补上 rel。
 * 保留 KaTeX 的 class / style（公式排版需要）。
 */
function sanitize(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')

    doc.querySelectorAll(DANGEROUS_TAGS.join(',')).forEach((el) => el.remove())

    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        const value = attr.value
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name)
        } else if (
          (name === 'href' || name === 'src' || name === 'xlink:href') &&
          /^\s*javascript:/i.test(value)
        ) {
          el.removeAttribute(attr.name)
        }
      }
      if (el.tagName === 'A') {
        el.setAttribute('rel', 'noreferrer noopener')
        if (!el.getAttribute('target')) el.setAttribute('target', '_blank')
      }
    })

    // 本地绝对路径 / file:// / localhost?path= → cpet-file，否则对话里只剩空白图框
    doc.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src') || ''
      const next = rewriteLocalImageSrc(src)
      if (next) img.setAttribute('src', next)
    })

    // 表格外包一层，便于横向滚动
    doc.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('md-table-wrap')) return
      const wrap = doc.createElement('div')
      wrap.className = 'md-table-wrap'
      table.parentNode?.insertBefore(wrap, table)
      wrap.appendChild(table)
    })

    // 代码块外包一层，附带复制按钮（点击由 MarkdownHtml 事件委托处理）
    doc.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('md-code-wrap')) return
      const wrap = doc.createElement('div')
      wrap.className = 'md-code-wrap'
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'md-code-copy'
      btn.textContent = '复制'
      btn.setAttribute('aria-label', '复制代码')
      pre.parentNode?.insertBefore(wrap, pre)
      wrap.appendChild(btn)
      wrap.appendChild(pre)
    })

    return doc.body.innerHTML
  } catch {
    return html
  }
}

/** 把 Markdown（含 LaTeX 公式）渲染成已消毒的 HTML。 */
export function renderMarkdown(text: string): string {
  const normalized = normalizeTables(
    normalizeMathDelimiters(linkifyBareLocalImagePaths(text))
  )
  return sanitize(marked.parse(normalized, { async: false }) as string)
}
