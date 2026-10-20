import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const MIN_QUOTE_LEN = 8
const MAX_QUOTE_LEN = 2000

type SelBox = { top: number; left: number; width: number; height: number }

function clampQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_LEN)
}

/**
 * 资讯正文划词：选中后黄底高亮框 + 浮动「讨论此段」；
 * 松手即把选区记为分析依赖（onQuote）。
 */
export function RssSelectableContent({
  children,
  className,
  onQuote,
  onDiscuss
}: {
  children: ReactNode
  className?: string
  /** 松手即写入分析依赖 */
  onQuote: (text: string) => void
  /** 点「讨论此段」：打开讨论并聚焦 */
  onDiscuss: (text: string) => void
}): JSX.Element {
  useUiLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<SelBox[]>([])
  const [toolbar, setToolbar] = useState<{ top: number; left: number; text: string } | null>(
    null
  )

  const clearChrome = useCallback((): void => {
    setBoxes([])
    setToolbar(null)
  }, [])

  const captureSelection = useCallback((): void => {
    const host = hostRef.current
    if (!host) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount < 1) {
      clearChrome()
      return
    }
    const range = sel.getRangeAt(0)
    if (!host.contains(range.commonAncestorContainer)) {
      clearChrome()
      return
    }
    const text = clampQuote(sel.toString())
    if (text.length < MIN_QUOTE_LEN) {
      clearChrome()
      return
    }

    const hostRect = host.getBoundingClientRect()
    const nextBoxes: SelBox[] = []
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 2 || r.height < 2) continue
      nextBoxes.push({
        top: r.top - hostRect.top + host.scrollTop,
        left: r.left - hostRect.left + host.scrollLeft,
        width: r.width,
        height: r.height
      })
    }
    if (!nextBoxes.length) {
      clearChrome()
      return
    }

    const last = nextBoxes[nextBoxes.length - 1]
    const toolbarLeft = Math.min(
      Math.max(8, last.left),
      Math.max(8, host.clientWidth - 168)
    )
    setBoxes(nextBoxes)
    setToolbar({
      top: last.top + last.height + 6,
      left: toolbarLeft,
      text
    })
    onQuote(text)
  }, [clearChrome, onQuote])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const onMouseUp = (): void => {
      // 等浏览器落定选区
      window.requestAnimationFrame(() => captureSelection())
    }
    const onScroll = (): void => clearChrome()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges()
        clearChrome()
      }
    }

    host.addEventListener('mouseup', onMouseUp)
    host.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => {
      host.removeEventListener('mouseup', onMouseUp)
      host.removeEventListener('scroll', onScroll)
      document.removeEventListener('keydown', onKey)
    }
  }, [captureSelection, clearChrome])

  return (
    <div ref={hostRef} className={`rss-selectable${className ? ` ${className}` : ''}`}>
      {children}
      {boxes.map((b, i) => (
        <span
          key={i}
          className="rss-sel-box"
          style={{
            top: b.top,
            left: b.left,
            width: b.width,
            height: b.height
          }}
          aria-hidden
        />
      ))}
      {toolbar ? (
        <div
          className="rss-sel-toolbar"
          style={{ top: toolbar.top, left: toolbar.left }}
          role="toolbar"
          aria-label={uiText("划词讨论")}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="rss-sel-toolbar-dot" aria-hidden />
          <button
            type="button"
            className="rss-sel-toolbar-btn"
            onClick={() => {
              onDiscuss(toolbar.text)
              window.getSelection()?.removeAllRanges()
              clearChrome()
            }}
          >
            {uiText("加入并讨论")}</button>
        </div>
      ) : null}
    </div>
  )
}
