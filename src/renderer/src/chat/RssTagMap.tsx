import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { buildRssTagGraph } from '@shared/rssTags'
import type { RssValueScore } from '@shared/rssTask'

type MapItem = {
  tags?: string[]
  title?: string
  titleLocal?: string
  excerpt?: string
  snippet?: string
  score?: RssValueScore
}

const TAG_MAP_ZOOM_MIN = 0.7
const TAG_MAP_ZOOM_MAX = 3.2

function clipTag(tag: string, n = 7): string {
  const t = tag.trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}

export function RssTagMap({
  items,
  selected,
  onPick,
  compact,
  emptyText = '这天还没有实体',
  hint,
  extra
}: {
  items: readonly MapItem[]
  selected: string
  onPick: (tag: string) => void
  compact?: boolean
  emptyText?: string
  hint?: string
  extra?: ReactNode
}): JSX.Element {
  useUiLocale()
  const graph = useMemo(
    () =>
      buildRssTagGraph(
        items.map((it) => ({
          tags: it.tags,
          title: it.title,
          titleLocal: it.titleLocal,
          snippet: it.excerpt || it.snippet,
          score: it.score
        })),
        compact ? 18 : 24
      ),
    [items, compact]
  )
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState('')
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onNativeWheel = (e: globalThis.WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const factor = e.deltaY > 0 ? 0.9 : 1.12
      setCam((c) => ({
        ...c,
        k: Math.min(TAG_MAP_ZOOM_MAX, Math.max(TAG_MAP_ZOOM_MIN, c.k * factor))
      }))
    }
    el.addEventListener('wheel', onNativeWheel, { passive: false })
    return () => el.removeEventListener('wheel', onNativeWheel)
  }, [graph.nodes.length])
  const empty = !graph.nodes.length
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const sel = selected.trim().toLowerCase()
  const hotIds = new Set<string>()
  const focus = hover || sel
  if (focus) {
    hotIds.add(focus)
    for (const e of graph.edges) {
      if (e.a === focus) hotIds.add(e.b)
      if (e.b === focus) hotIds.add(e.a)
    }
  }
  const size = 100 / cam.k
  const viewBox = `${50 + cam.x - size / 2} ${50 + cam.y - size / 2} ${size} ${size}`

  function zoomBy(factor: number): void {
    setCam((c) => ({ ...c, k: Math.min(TAG_MAP_ZOOM_MAX, Math.max(TAG_MAP_ZOOM_MIN, c.k * factor)) }))
  }

  function resetCam(): void {
    setCam({ x: 0, y: 0, k: 1 })
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>): void {
    if ((e.target as Element | null)?.closest?.('.today-tag-node')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>): void {
    const start = drag.current
    const svg = svgRef.current
    if (!start || !svg) return
    const unit = size / Math.max(1, svg.clientWidth)
    setCam({
      x: start.cx - (e.clientX - start.x) * unit,
      y: start.cy - (e.clientY - start.y) * unit,
      k: cam.k
    })
  }

  return (
    <aside className={`today-tag-map${compact ? ' is-compact' : ''}`} aria-label={uiText("主题知识图谱")}>
      <div className="today-tag-map-h">
        <strong>{uiText("主题知识图谱")}</strong>
        <div className="today-tag-map-tools">
          {extra}
          <button type="button" className="today-text-btn" onClick={() => zoomBy(0.88)} title={uiText("缩小")}>
            −
          </button>
          <button type="button" className="today-text-btn" onClick={() => zoomBy(1.14)} title={uiText("放大")}>
            +
          </button>
          <button type="button" className="today-text-btn" onClick={resetCam} title={uiText("复位")}>
            {uiText("复位")}</button>
          {sel ? (
            <button type="button" className="today-text-btn" onClick={() => onPick('')}>
              {uiText("清除")}</button>
          ) : null}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="today-tag-map-svg"
        role="img"
        aria-label={uiText("主题知识图谱")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onDoubleClick={resetCam}
      >
        {graph.edges.map((e) => {
          const a = byId.get(e.a)
          const b = byId.get(e.b)
          if (!a || !b) return null
          const hot = focus && (e.a === focus || e.b === focus)
          return (
            <line
              key={`${e.a}-${e.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`today-tag-edge${hot ? ' on' : ''}`}
              style={{ strokeWidth: 0.32 + Math.min(1.05, e.n * 0.14) }}
            />
          )
        })}
        {empty ? (
          <text x="50" y="48" className="today-tag-empty">
            {emptyText}
          </text>
        ) : null}
        {graph.nodes.map((n) => {
          const on = n.id === sel
          const dim = Boolean(focus) && !hotIds.has(n.id)
          return (
            <g
              key={n.id}
              className={`today-tag-node kind-${n.kind}${on ? ' on' : ''}${dim ? ' dim' : ''}`}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover('')}
              onClick={() => onPick(on ? '' : n.tag)}
            >
              <circle cx={n.x} cy={n.y} r={on ? n.r + 0.8 : n.r} />
              <text x={n.lx} y={n.ly} textAnchor={n.anchor}>
                {clipTag(n.tag, cam.k > 1.35 ? 12 : 7)}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="today-tag-map-hint">
        {hint ||
          (empty
            ? uiText("换一天或换栏目，图谱会跟着消息变")
            : sel
              ? uiText("按重要度、时效排「{0}」", [selected])
              : uiText("点节点筛选 · 机构蓝 · 地名绿 · 产品紫 · 法案橙"))}
      </p>
    </aside>
  )
}
