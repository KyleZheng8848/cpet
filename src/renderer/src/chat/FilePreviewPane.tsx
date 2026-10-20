import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  attachmentExt,
  attachmentKindIcon,
  attachmentKindLabel,
  attachmentLocalUrl,
  classifyAttachmentMedia
} from '@shared/attachmentMedia'
import type { FilePreviewTarget } from '@shared/filePreview'
import { canonicalLocalPath, formatFileAddedAt, isRemotePreviewUrl } from '@shared/filePreview'
import { csvToMarkdown } from '@shared/csvPreview'
import { MarkdownHtml } from './MarkdownHtml'
import { IconClear } from './icons'

/** 避免 docx-preview/xlsx 进 Chat 首包；挂载失败会整窗空白。 */
const OfficeVisualHost = lazy(async () => {
  const m = await import('./OfficeVisualHost')
  return { default: m.OfficeVisualHost }
})

function canClientRenderOffice(pathOrName: string): boolean {
  const ext = attachmentExt(pathOrName)
  return ext === '.docx' || ext === '.xlsx' || ext === '.xlsm'
}

function fileThumbSrc(f: FilePreviewTarget): string {
  if (f.remoteUrl && isRemotePreviewUrl(f.remoteUrl)) return f.remoteUrl
  if (isRemotePreviewUrl(f.path)) return f.path
  if (f.path && !/^https?:\/\//i.test(f.path)) return attachmentLocalUrl(f.path)
  return ''
}

/** 本对话文件列表左侧：图/视频用缩略图，其它用类型图标。 */
function FilePanelThumb({
  file,
  kind
}: {
  file: FilePreviewTarget
  kind: ReturnType<typeof classifyAttachmentMedia>
}): JSX.Element {
  useUiLocale()
  const [broken, setBroken] = useState(false)
  const src = fileThumbSrc(file)

  useEffect(() => {
    setBroken(false)
  }, [src])

  if (kind === 'image' && src && !broken) {
    return (
      <span className="file-panel-thumb is-image" aria-hidden>
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      </span>
    )
  }
  if (kind === 'video' && src && !broken) {
    return (
      <span className="file-panel-thumb is-video" aria-hidden>
        <video src={src} muted preload="metadata" onError={() => setBroken(true)} />
        <span className="file-panel-thumb-badge">▶</span>
      </span>
    )
  }
  return (
    <span className={`file-panel-thumb is-icon is-${kind}`} aria-hidden>
      {attachmentKindIcon(kind)}
    </span>
  )
}

type Props = {
  target: FilePreviewTarget | null
  files?: FilePreviewTarget[]
  attachedPaths?: string[]
  onSelect?: (target: FilePreviewTarget) => void
  onAttach?: (target: FilePreviewTarget) => void
  onDetach?: (target: FilePreviewTarget) => void
  onRemoveFromList?: (target: FilePreviewTarget) => void
  onClearList?: () => void
  onTogglePin?: (target: FilePreviewTarget) => void
  onShowList?: () => void
  now?: number
  onClose: () => void
  /** 嵌在快问等窄栏里：不要撑满、也不用对话页那套宽预览。 */
  embed?: boolean
}

const OFFICE_EXT = ['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.xlsm']
const CSV_EXT = ['.csv', '.tsv']
const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const WIDTH_KEY = 'cpet.filePreviewWidth'
const WIDTH_MIN = 260
const WIDTH_MAX = 820
const WIDTH_DEFAULT = 480

function clampZoom(n: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n / ZOOM_STEP) * ZOOM_STEP))
}

function clampWidth(n: number): number {
  const max = Math.min(WIDTH_MAX, Math.floor(window.innerWidth * 0.72))
  return Math.min(max, Math.max(WIDTH_MIN, Math.round(n)))
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n)) return clampWidth(n)
  } catch {
    /* ignore */
  }
  return WIDTH_DEFAULT
}

function samePath(a: string, b: string): boolean {
  return canonicalLocalPath(a) === canonicalLocalPath(b)
}

export function FilePreviewPane({
  target,
  files,
  attachedPaths,
  onSelect,
  onAttach,
  onDetach,
  onRemoveFromList,
  onClearList,
  onTogglePin,
  onShowList,
  now,
  onClose,
  embed
}: Props): JSX.Element {
  useUiLocale()
  const remoteSrc =
    (target?.remoteUrl && /^https:\/\//i.test(target.remoteUrl) ? target.remoteUrl : '') ||
    (/^https:\/\//i.test(target?.path || '') ? target!.path : '')
  const kind = remoteSrc
    ? 'image'
    : classifyAttachmentMedia(target?.path || target?.name || '', target?.mime)
  const ext = attachmentExt(target?.path || target?.name || '')
  const isOffice = !remoteSrc && OFFICE_EXT.includes(ext)
  const isPptx = ext === '.pptx' || ext === '.ppt'
  const isCsv = CSV_EXT.includes(ext)
  const useClientOffice = Boolean(
    !remoteSrc && target?.path && canClientRenderOffice(target.path || target.name || '')
  )
  const isMedia = kind === 'image' || kind === 'video'
  const mediaSrc = remoteSrc || (target?.path ? attachmentLocalUrl(target.path) : '')
  const isRemoteOnly = Boolean(remoteSrc)
  const [text, setText] = useState<string | null>(null)
  const [officeHtml, setOfficeHtml] = useState<string | null>(null)
  const [officePdf, setOfficePdf] = useState<string | null>(null)
  const officeHtmlRef = useRef<HTMLDivElement>(null)
  const [textErr, setTextErr] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [officeNote, setOfficeNote] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const panDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [width, setWidth] = useState(() => readStoredWidth())
  const [resizing, setResizing] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  const list = useMemo(() => {
    const raw = files && files.length ? files : target ? [target] : []
    const seen = new Set<string>()
    const out: FilePreviewTarget[] = []
    for (const f of raw) {
      const key = canonicalLocalPath(f.path)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(f)
    }
    if (target?.path && !seen.has(canonicalLocalPath(target.path))) out.push(target)
    return out
  }, [files, target])

  const fileIndex = target
    ? Math.max(
        0,
        list.findIndex((f) => samePath(f.path, target.path))
      )
    : -1
  const attached = new Set((attachedPaths || []).map((p) => canonicalLocalPath(p)))
  const alreadyAttached = target ? attached.has(canonicalLocalPath(target.path)) : false
  const targetPinned = Boolean(
    (target && list.find((f) => samePath(f.path, target.path))?.pinnedAt) || target?.pinnedAt
  )

  function selectAt(i: number): void {
    if (!onSelect || !list.length) return
    const next = list[(i + list.length) % list.length]
    if (next) onSelect(next)
  }

  useEffect(() => {
    setText(null)
    setOfficeHtml(null)
    setOfficePdf(null)
    setTextErr(null)
    setTruncated(false)
    setActionErr(null)
    setOfficeNote(null)
    setZoom(100)
    setPan({ x: 0, y: 0 })
    setPanning(false)
    panDragRef.current = null
    setSlideIndex(0)
    setSlideCount(0)
    let cancelled = false
    const path = target?.path
    if (!path) {
      return () => {
        cancelled = true
      }
    }

    // 在线图：直接用 <img src=https>，不要当本地路径去读
    if (remoteSrc) {
      setTextErr(null)
      return () => {
        cancelled = true
      }
    }

    if (kind === 'folder') {
      setTextErr(null)
      return () => {
        cancelled = true
      }
    }

    if (isOffice) {
      // docx/xlsx：渲染进程排版预览；pptx/旧版仍走主进程（LibreOffice PDF 或结构化 HTML）
      if (useClientOffice) {
        setOfficeNote(null)
        return () => {
          cancelled = true
        }
      }
      void window.petApi
        .readOfficePreviewText(path)
        .then((r) => {
          if (cancelled) return
          if (!r.ok) {
            setTextErr(r.error || '预览失败')
            return
          }
          if (r.pdfPath) {
            setOfficePdf(r.pdfPath)
            setTruncated(false)
            setOfficeNote(
              `${(r.format || ext.replace(/^\./, '') || 'office').toUpperCase()} · 原版式`
            )
            return
          }
          const html = typeof r.html === 'string' ? r.html.trim() : ''
          if (!html) {
            setTextErr('预览结果为空，请用系统打开或重启应用后再试')
            return
          }
          setOfficeHtml(r.html)
          setTruncated(r.truncated)
          setOfficeNote(
            `${(r.format || ext.replace(/^\./, '') || 'office').toUpperCase()} · 适应窗口`
          )
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setTextErr(err instanceof Error ? err.message : String(err || '预览失败'))
        })
      return () => {
        cancelled = true
      }
    }

    if (kind === 'text') {
      void window.petApi.readAttachmentText(path).then((r) => {
        if (cancelled) return
        if (r.ok) {
          if (CSV_EXT.includes(attachmentExt(path))) {
            const conv = csvToMarkdown(r.text, attachmentExt(path))
            setText(conv.markdown)
            setTruncated(r.truncated || conv.truncated)
          } else {
            setText(r.text)
            setTruncated(r.truncated)
          }
        } else setTextErr(r.error)
      })
      return () => {
        cancelled = true
      }
    }

    return () => {
      cancelled = true
    }
  }, [target?.path, kind, isOffice, ext, useClientOffice, remoteSrc])

  useEffect(() => {
    const root = officeHtmlRef.current
    if (!root || !officeHtml) return
    const slides = [...root.querySelectorAll('.office-slide')]
    setSlideCount(slides.length)
    const idx = Math.min(slideIndex, Math.max(0, slides.length - 1))
    slides.forEach((el, i) => el.classList.toggle('is-on', i === idx))
  }, [officeHtml, slideIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest?.('textarea, input, [contenteditable="true"]')) return
      if (e.key === 'Escape') {
        if (target && onShowList) {
          onShowList()
          return
        }
        onClose()
        return
      }
      if (!target) return
      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        if (isPptx && slideCount > 1) {
          setSlideIndex((i) => Math.max(0, i - 1))
        } else selectAt(fileIndex - 1)
        return
      }
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        if (isPptx && slideCount > 1) {
          setSlideIndex((i) => Math.min(slideCount - 1, i + 1))
        } else selectAt(fileIndex + 1)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        applyZoom((z) => z + ZOOM_STEP)
      } else if (e.key === '-') {
        e.preventDefault()
        applyZoom((z) => z - ZOOM_STEP)
      } else if (e.key === '0') {
        e.preventDefault()
        applyZoom(100)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selectAt 随 list 变；依赖 fileIndex/list.length 已足够
  }, [onClose, onShowList, target, isPptx, slideCount, list.length, fileIndex])

  useEffect(() => {
    const root = officeHtmlRef.current
    if (!root) return
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
  }, [officeHtml])

  async function systemOpen(): Promise<void> {
    if (isRemoteOnly && remoteSrc) {
      window.open(remoteSrc, '_blank', 'noopener,noreferrer')
      return
    }
    if (!target?.path) return
    setActionErr(null)
    const r = await window.petApi.openAttachmentPath(target.path)
    if (!r.ok) setActionErr(r.error || '打开失败')
  }

  async function reveal(): Promise<void> {
    if (isRemoteOnly) {
      setActionErr('在线图无法在访达中显示')
      return
    }
    if (!target?.path) return
    setActionErr(null)
    const r = await window.petApi.revealAttachmentPath(target.path)
    if (!r.ok) setActionErr(r.error || '定位失败')
  }

  const showText = kind === 'text' && !isOffice
  const isMd = /\.(md|markdown)$/i.test(target?.name || target?.path || '')
  const renderAsMarkdown = isMd || isCsv
  const canZoom = (isOffice && !officePdf && !isPptx) || showText || isMedia || useClientOffice

  function beginResize(e: ReactPointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    setResizing(true)
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      const next = clampWidth(startW + (startX - ev.clientX))
      widthRef.current = next
      setWidth(next)
    }
    const onUp = (): void => {
      setResizing(false)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current))
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const mediaFitStyle: CSSProperties = {
    maxWidth: '100%',
    maxHeight: '100%',
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    transform:
      zoom === 100 && pan.x === 0 && pan.y === 0
        ? undefined
        : `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`
  }

  function applyZoom(next: number | ((z: number) => number)): void {
    setZoom((prev) => {
      const z = clampZoom(typeof next === 'function' ? next(prev) : next)
      if (z <= 100) {
        setPan({ x: 0, y: 0 })
        setPanning(false)
        panDragRef.current = null
      }
      return z
    })
  }

  function beginMediaPan(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!isMedia || kind !== 'image' || zoom <= 100) return
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y
    }
    setPanning(true)
  }

  function moveMediaPan(e: ReactPointerEvent<HTMLDivElement>): void {
    const drag = panDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    setPan({
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY)
    })
  }

  function endMediaPan(e: ReactPointerEvent<HTMLDivElement>): void {
    const drag = panDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    panDragRef.current = null
    setPanning(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const listRows = (
    <ul className="file-panel-list">
      {list.map((f) => {
        const k = classifyAttachmentMedia(f.path || f.name, f.mime)
        const inConv = attached.has(canonicalLocalPath(f.path))
        const pinned = Boolean(f.pinnedAt)
        return (
          <li
            key={f.path}
            className={`file-panel-row${inConv ? ' is-in' : ''}${pinned ? ' is-pinned' : ''}`}
          >
            <button
              type="button"
              className="file-panel-main"
              title={f.path}
              onClick={() => onSelect?.(f)}
            >
              <span className="file-panel-icon" aria-hidden>
                <FilePanelThumb file={f} kind={k} />
              </span>
              <span className="file-panel-meta">
                <span className="file-panel-name">{f.name}</span>
                <span className="file-panel-sub">
                  {attachmentKindLabel(k)}
                  {pinned ? uiText(" · 置顶") : ''}
                  {inConv ? uiText(" · 已加入对话") : ''}
                  {f.addedAt ? (
                    <span className="file-panel-tag">{formatFileAddedAt(f.addedAt, now)}</span>
                  ) : null}
                </span>
              </span>
            </button>
            <div className="file-panel-acts">
              {inConv
                ? onDetach && (
                    <button
                      type="button"
                      className="file-panel-act is-out"
                      title={uiText("从输入栏附件中去掉")}
                      onClick={() => onDetach(f)}
                    >
                      {uiText("取消附件")}</button>
                  )
                : onAttach &&
                  k !== 'folder' && (
                    <button
                      type="button"
                      className="file-panel-act"
                      title={uiText("加入输入栏，随下一条消息发送")}
                      onClick={() => onAttach(f)}
                    >
                      {uiText("加入输入栏")}</button>
                  )}
              {onTogglePin ? (
                <button
                  type="button"
                  className={`file-panel-act is-pin${pinned ? ' on' : ''}`}
                  title={pinned ? uiText("取消置顶") : uiText("置顶")}
                  aria-label={pinned ? uiText("取消置顶 {0}", [f.name]) : uiText("置顶 {0}", [f.name])}
                  onClick={() => onTogglePin(f)}
                >
                  {pinned ? uiText("取消置顶") : uiText("置顶")}
                </button>
              ) : null}
              {onRemoveFromList ? (
                <button
                  type="button"
                  className="file-panel-act is-remove"
                  title={uiText("从本对话列表移出（不删除磁盘文件）")}
                  aria-label={uiText("从列表移出 {0}", [f.name])}
                  onClick={() => onRemoveFromList(f)}
                >
                  {uiText("移出列表")}</button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <aside
      className={`file-preview-pane${resizing ? ' is-resizing' : ''}${target ? '' : ' is-list'}${embed ? ' is-embed' : ''}`}
      aria-label={target ? uiText("文件预览") : uiText("本对话文件")}
      style={embed ? undefined : { flex: `0 0 ${width}px`, width }}
    >
      <div
        className="file-preview-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label={uiText("拖动调整预览宽度")}
        title={uiText("拖动调整宽度")}
        onPointerDown={beginResize}
      />
      {!target ? (
        <>
          <header className="file-preview-bar">
            <div className="file-preview-title">
              <div className="file-preview-title-text">
                <strong>{uiText("本对话文件")}</strong>
                <span>{list.length ? uiText("{0} 个", [list.length]) : uiText("从输入栏回形针添加")}</span>
              </div>
            </div>
            <div className="file-preview-actions">
              {list.length > 0 && onClearList ? (
                <button
                  type="button"
                  className="file-preview-btn"
                  title={uiText("清空本对话列表（不删除磁盘文件）")}
                  aria-label={uiText("清空本对话文件列表")}
                  onClick={onClearList}
                >
                  <IconClear size={14} />
                  {uiText("清空")}</button>
              ) : null}
              <button
                type="button"
                className="file-preview-btn is-close"
                onClick={onClose}
                aria-label={uiText("关闭文件列表")}
                title={uiText("关闭 Esc")}
              >
                ×
              </button>
            </div>
          </header>
          {list.length === 0 ? (
            <div className="file-panel-empty">{uiText("还没有文件。用输入栏回形针添加，或拖进对话。")}</div>
          ) : (
            listRows
          )}
        </>
      ) : (
        <>
      <header className="file-preview-bar is-preview">
        <div className="file-preview-head">
          <div className="file-preview-title" title={target.path}>
            <span className="file-preview-icon" aria-hidden>
              {attachmentKindIcon(kind)}
            </span>
            <div className="file-preview-title-text">
              <strong>{target.name}</strong>
              <span>
                {isOffice
                  ? (ext.replace(/^\./, '') || 'Office').toUpperCase()
                  : attachmentKindLabel(kind)}
                {list.length > 1 ? ` · ${fileIndex + 1}/${list.length}` : ''}
                {officeNote && !/适应窗口/.test(officeNote) ? ` · ${officeNote}` : ''}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="file-preview-btn is-close"
            onClick={() => (onShowList ? onShowList() : onClose())}
            aria-label={onShowList ? uiText("返回文件列表") : uiText("关闭预览")}
            title={onShowList ? uiText("返回列表 Esc") : uiText("关闭 Esc")}
          >
            ×
          </button>
        </div>

        <div className="file-preview-toolbar">
          {list.length > 1 ? (
            <div className="file-preview-group" role="group" aria-label={uiText("切换文件")}>
              <span className="file-preview-group-label">{uiText("切换")}</span>
              <button
                type="button"
                className="file-preview-btn"
                title={uiText("上一个文件 ←")}
                disabled={fileIndex <= 0}
                onClick={() => selectAt(fileIndex - 1)}
              >
                ‹
              </button>
              <span className="file-preview-zoom-pct">
                {fileIndex + 1}/{list.length}
              </span>
              <button
                type="button"
                className="file-preview-btn"
                title={uiText("下一个文件 →")}
                disabled={fileIndex >= list.length - 1}
                onClick={() => selectAt(fileIndex + 1)}
              >
                ›
              </button>
            </div>
          ) : null}

          {canZoom ? (
            <div
              className="file-preview-group"
              role="group"
              aria-label={uiText("缩放")}
              title={isMedia ? uiText("滚轮缩放") : uiText("滚轮上下滚动 · ⌘/Ctrl + 滚轮缩放")}
            >
              <span className="file-preview-group-label">{uiText("缩放")}</span>
              <button
                type="button"
                className="file-preview-btn"
                title={uiText("缩小 ⌘-")}
                disabled={zoom <= ZOOM_MIN}
                onClick={() => applyZoom((z) => z - ZOOM_STEP)}
              >
                −
              </button>
              <button
                type="button"
                className="file-preview-btn file-preview-zoom-pct"
                title={uiText("适应窗口")}
                onClick={() => applyZoom(100)}
              >
                {zoom === 100 ? uiText("适应") : `${zoom}%`}
              </button>
              <button
                type="button"
                className="file-preview-btn"
                title={uiText("放大 ⌘+")}
                disabled={zoom >= ZOOM_MAX}
                onClick={() => applyZoom((z) => z + ZOOM_STEP)}
              >
                +
              </button>
            </div>
          ) : null}

          <div className="file-preview-toolbar-spacer" aria-hidden />

          {(onTogglePin || onRemoveFromList) && (
            <div className="file-preview-group" role="group" aria-label={uiText("列表操作")}>
              <span className="file-preview-group-label">{uiText("列表")}</span>
              {onTogglePin ? (
                <button
                  type="button"
                  className={`file-preview-btn${targetPinned ? ' is-pin-on' : ''}`}
                  title={targetPinned ? uiText("取消置顶") : uiText("置顶到列表顶部")}
                  onClick={() => onTogglePin(target)}
                >
                  {targetPinned ? uiText("取消置顶") : uiText("置顶")}
                </button>
              ) : null}
              {onRemoveFromList ? (
                <button
                  type="button"
                  className="file-preview-btn is-muted"
                  title={uiText("从本对话文件列表移出（不删除磁盘文件）")}
                  onClick={() => onRemoveFromList(target)}
                >
                  {uiText("移出列表")}</button>
              ) : null}
            </div>
          )}

          <div className="file-preview-group" role="group" aria-label={uiText("系统打开")}>
            <span className="file-preview-group-label">{uiText("打开")}</span>
            <button
              type="button"
              className="file-preview-btn"
              title={isRemoteOnly ? uiText("在浏览器打开") : uiText("用系统应用打开")}
              onClick={() => void systemOpen()}
            >
              {isRemoteOnly ? uiText("浏览器") : uiText("应用")}
            </button>
            {!isRemoteOnly ? (
              <button
                type="button"
                className="file-preview-btn"
                title={uiText("在访达中显示")}
                onClick={() => void reveal()}
              >
                {uiText("访达")}</button>
            ) : null}
          </div>

          {onAttach && !alreadyAttached && kind !== 'folder' && !isRemoteOnly ? (
            <div className="file-preview-group" role="group" aria-label={uiText("输入栏附件")}>
              <span className="file-preview-group-label">{uiText("附件")}</span>
              <button
                type="button"
                className="file-preview-btn"
                title={uiText("加入输入栏，随下一条消息发送")}
                onClick={() => onAttach(target)}
              >
                {uiText("加入输入栏")}</button>
            </div>
          ) : null}
          {onDetach && alreadyAttached ? (
            <div className="file-preview-group" role="group" aria-label={uiText("输入栏附件")}>
              <span className="file-preview-group-label">{uiText("附件")}</span>
              <button
                type="button"
                className="file-preview-btn is-muted"
                title={uiText("从输入栏附件中去掉")}
                onClick={() => onDetach(target)}
              >
                {uiText("取消附件")}</button>
            </div>
          ) : null}
        </div>
      </header>

      <div
        className={
          'file-preview-body' +
          (isOffice && !officePdf ? ' is-office' : '') +
          (isPptx && officeHtml ? ' is-pptx' : '') +
          (isMedia ? ' is-media' : '') +
          (kind === 'pdf' || officePdf ? ' is-pdf' : '')
        }
        onWheel={(e) => {
          if (!canZoom) return
          if (e.shiftKey) return
          // 文档/表格滚轮用来翻阅，缩放要按 ⌘/Ctrl；图片视频保持裸滚轮缩放
          if (!isMedia && !(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          applyZoom((z) => z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
        }}
      >
        {(kind === 'pdf' && mediaSrc) || officePdf ? (
          <iframe
            className="file-preview-pdf"
            src={`${attachmentLocalUrl(officePdf || target.path)}#view=FitH`}
            title={target.name}
          />
        ) : isMedia && mediaSrc ? (
          kind === 'image' ? (
            <div
              className={`file-preview-media-stage${zoom > 100 ? ' is-zoomed' : ''}${
                panning ? ' is-panning' : ''
              }`}
              title={zoom > 100 ? uiText("拖动查看") : undefined}
              onPointerDown={beginMediaPan}
              onPointerMove={moveMediaPan}
              onPointerUp={endMediaPan}
              onPointerCancel={endMediaPan}
            >
              <img
                className="file-preview-media"
                src={mediaSrc}
                alt={target.name}
                draggable={false}
                style={mediaFitStyle}
              />
            </div>
          ) : (
            <video
              className="file-preview-media"
              src={mediaSrc}
              controls
              autoPlay
              style={mediaFitStyle}
            />
          )
        ) : (
          <div
            className="file-preview-zoom-surface"
            style={
              canZoom && !isMedia ? ({ zoom: zoom / 100 } as CSSProperties) : undefined
            }
          >
            {kind === 'audio' && mediaSrc ? (
              <audio className="file-preview-audio" src={mediaSrc} controls autoPlay />
            ) : null}

            {isOffice ? (
              textErr ? (
                <div className="file-preview-fallback">
                  <p>{textErr}</p>
                  <button type="button" className="settings-btn" onClick={() => void systemOpen()}>
                    {uiText("系统打开")}</button>
                </div>
              ) : useClientOffice && target?.path ? (
                <Suspense fallback={<p className="file-preview-msg">{uiText("正在排版渲染…")}</p>}>
                  <OfficeVisualHost
                    path={target.path}
                    className="file-preview-office-visual"
                    onNote={(note) => setOfficeNote(note)}
                    onError={(message) => setTextErr(message)}
                  />
                </Suspense>
              ) : officeHtml == null ? (
                <p className="file-preview-msg">{uiText("正在按原版式渲染…")}</p>
              ) : (
                <div
                  ref={officeHtmlRef}
                  className={`file-preview-office${isPptx ? ' is-pptx-fit' : ''}`}
                  dangerouslySetInnerHTML={{ __html: officeHtml }}
                />
              )
            ) : null}

            {showText ? (
              textErr ? (
                <div className="file-preview-fallback">
                  <p>{textErr}</p>
                  <button type="button" className="settings-btn" onClick={() => void systemOpen()}>
                    {uiText("系统打开")}</button>
                </div>
              ) : text == null ? (
                <p className="file-preview-msg">{uiText("读取中…")}</p>
              ) : renderAsMarkdown ? (
                <MarkdownHtml
                  text={text}
                  className={`file-preview-md md${isCsv ? ' file-preview-csv' : ''}`}
                />
              ) : (
                <pre className="file-preview-text">{text}</pre>
              )
            ) : null}

            {kind === 'folder' ? (
              <div className="file-preview-fallback">
                <p>{uiText("文件夹链接。可直接打开，或在访达中显示。")}</p>
                <button type="button" className="settings-btn" onClick={() => void systemOpen()}>
                  {uiText("打开文件夹")}</button>
                <button type="button" className="settings-btn" onClick={() => void reveal()}>
                  {uiText("访达显示")}</button>
                <p className="file-preview-path">{target.path}</p>
              </div>
            ) : null}

            {!showText && !isOffice && !isMedia && kind === 'file' ? (
              <div className="file-preview-fallback">
                <p>{uiText("此格式暂无内嵌预览，可用系统应用打开。")}</p>
                <button type="button" className="settings-btn" onClick={() => void systemOpen()}>
                  {uiText("系统打开")}</button>
                <p className="file-preview-path">{target.path}</p>
              </div>
            ) : null}
          </div>
        )}
        {isPptx && slideCount > 1 ? (
          <div className="file-preview-slide-nav" role="group" aria-label={uiText("切换幻灯片")}>
            <button
              type="button"
              className="file-preview-btn"
              title={uiText("上一张")}
              disabled={slideIndex <= 0}
              onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
            >
              ‹
            </button>
            <span>
              {slideIndex + 1} / {slideCount}
            </span>
            <button
              type="button"
              className="file-preview-btn"
              title={uiText("下一张")}
              disabled={slideIndex >= slideCount - 1}
              onClick={() => setSlideIndex((i) => Math.min(slideCount - 1, i + 1))}
            >
              ›
            </button>
          </div>
        ) : null}
        {truncated ? <p className="file-preview-msg">{uiText("已截断预览；完整排版请系统打开")}</p> : null}
        {actionErr ? <p className="file-preview-msg is-error">{actionErr}</p> : null}
      </div>
        </>
      )}
    </aside>
  )
}
