import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
/**
 * 渲染进程内 Office 排版预览（非抽文本）：
 * - docx → docx-preview
 * - xlsx → SheetJS 表格
 * - pptx 等仍回退主进程 HTML（由外层处理）
 */
import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import * as XLSX from 'xlsx'
import { attachmentExt, attachmentLocalUrl } from '@shared/attachmentMedia'

const MAX_BYTES = 48 * 1024 * 1024
const MAX_SHEET_ROWS = 800
const MAX_SHEET_COLS = 40

type Props = {
  path: string
  className?: string
  onNote?: (note: string) => void
  onError?: (message: string) => void
  onReady?: () => void
}

async function fetchOfficeBuffer(path: string): Promise<ArrayBuffer> {
  const url = attachmentLocalUrl(path)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`读取失败（${res.status}）`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_BYTES) throw new Error(`文件约 ${Math.round(len / 1024 / 1024)}MB，超过预览上限`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`文件约 ${Math.round(buf.byteLength / 1024 / 1024)}MB，超过预览上限`)
  }
  return buf
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sheetToHtml(wb: XLSX.WorkBook): string {
  const names = wb.SheetNames || []
  if (!names.length) throw new Error('表格里没有工作表')
  const tabs: string[] = []
  const panes: string[] = []
  let truncated = false
  names.forEach((name, i) => {
    const id = `s${i}`
    const sheet = wb.Sheets[name]
    if (!sheet) return
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: ''
    }) as unknown as string[][]
    const clipped = rows.slice(0, MAX_SHEET_ROWS).map((r) => r.slice(0, MAX_SHEET_COLS))
    if (rows.length > MAX_SHEET_ROWS || (rows[0] && rows[0].length > MAX_SHEET_COLS)) {
      truncated = true
    }
    if (!clipped.length) return
    tabs.push(
      `<button type="button" class="office-sheet-tab${i === 0 ? ' is-on' : ''}" data-sheet="${id}">${escapeHtml(name)}</button>`
    )
    const body = clipped
      .map((r, ri) => {
        const cells = r
          .map((c) => {
            const t = escapeHtml(String(c ?? ''))
            const tag = ri === 0 ? 'th' : 'td'
            return `<${tag}>${t || '&nbsp;'}</${tag}>`
          })
          .join('')
        return `<tr>${cells}</tr>`
      })
      .join('')
    panes.push(
      `<div class="office-sheet-pane${i === 0 ? ' is-on' : ''}" data-sheet="${id}"><table class="office-table file-preview-sheet"><tbody>${body}</tbody></table></div>`
    )
  })
  if (!panes.length) throw new Error('未能抽出可读内容')
  const note = truncated ? `<p class="file-preview-msg">已截断预览（前 ${MAX_SHEET_ROWS} 行）</p>` : ''
  return `<div class="office-book"><div class="office-sheet-tabs">${tabs.join('')}</div>${panes.join('')}${note}</div>`
}

export function canClientRenderOffice(pathOrName: string): boolean {
  const ext = attachmentExt(pathOrName)
  return ext === '.docx' || ext === '.xlsx' || ext === '.xlsm'
}

export function OfficeVisualHost({ path, className, onNote, onError, onReady }: Props): JSX.Element {
  useUiLocale()
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [xlsxHtml, setXlsxHtml] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let cancelled = false
    const ext = attachmentExt(path)
    setBusy(true)
    setXlsxHtml(null)
    if (bodyRef.current) bodyRef.current.innerHTML = ''
    if (styleRef.current) styleRef.current.innerHTML = ''

    void (async () => {
      try {
        const buf = await fetchOfficeBuffer(path)
        if (cancelled) return
        if (ext === '.docx') {
          const body = bodyRef.current
          const style = styleRef.current
          if (!body) return
          await renderAsync(buf, body, style || undefined, {
            className: 'cpet-docx',
            inWrapper: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            renderHeaders: true,
            renderFooters: true,
            useBase64URL: true
          })
          if (cancelled) return
          onNote?.('DOCX · 排版预览')
          onReady?.()
        } else if (ext === '.xlsx' || ext === '.xlsm') {
          const wb = XLSX.read(buf, { type: 'array' })
          if (cancelled) return
          setXlsxHtml(sheetToHtml(wb))
          onNote?.(`${ext.slice(1).toUpperCase()} · 表格预览`)
          onReady?.()
        } else {
          throw new Error('此格式请用系统打开或等待 PDF 转换')
        }
      } catch (err) {
        if (cancelled) return
        onError?.(err instanceof Error ? err.message : String(err || '预览失败'))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [path, onNote, onError, onReady])

  useEffect(() => {
    const root = bodyRef.current
    if (!root || !xlsxHtml) return
    const onClick = (e: MouseEvent): void => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.office-sheet-tab') as
        | HTMLElement
        | null
      if (!btn || !root.contains(btn)) return
      const id = btn.getAttribute('data-sheet')
      root.querySelectorAll('.office-sheet-tab').forEach((el) => {
        el.classList.toggle('is-on', el === btn)
      })
      root.querySelectorAll('.office-sheet-pane').forEach((el) => {
        el.classList.toggle('is-on', el.getAttribute('data-sheet') === id)
      })
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [xlsxHtml])

  return (
    <div className={className || 'file-preview-office-visual'}>
      <div ref={styleRef} hidden />
      {busy ? <p className="file-preview-msg">{uiText("正在排版渲染…")}</p> : null}
      {xlsxHtml ? (
        <div
          ref={bodyRef}
          className="file-preview-office-host"
          dangerouslySetInnerHTML={{ __html: xlsxHtml }}
        />
      ) : (
        <div ref={bodyRef} className="file-preview-office-host" hidden={busy} />
      )}
    </div>
  )
}
