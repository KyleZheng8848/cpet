import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import {
  formatDayCaption,
  formatMonthLabel,
  formatTodayStamp,
  isValidDateKey,
  listMonthGrid,
  listWeekDays,
  localDateKey,
  localDayBounds,
  shiftDateKey,
  shiftMonthKey
} from '@shared/todayHome'

export function DateTimeline({
  dateKey,
  now = Date.now(),
  onChange,
  markedDays,
  subtitle,
  compact
}: {
  dateKey: string
  now?: number
  onChange: (key: string) => void
  markedDays?: ReadonlyMap<string, number>
  subtitle?: string
  compact?: boolean
}): JSX.Element {
  useUiLocale()
  const safeNow = Number.isFinite(now) ? now : Date.now()
  const safeKey = isValidDateKey(dateKey) ? dateKey : localDateKey(safeNow)
  const todayKey = localDateKey(safeNow)
  const viewingToday = safeKey === todayKey
  const weekAnchor = localDayBounds(safeKey).start + 12 * 60 * 60 * 1000
  const week = useMemo(() => listWeekDays(weekAnchor, safeNow), [weekAnchor, safeNow])
  const monthDays = useMemo(() => listMonthGrid(safeKey, safeNow), [safeKey, safeNow])
  const [calOpen, setCalOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!calOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setCalOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [calOpen])

  function shiftWeek(dir: -1 | 1): void {
    onChange(shiftDateKey(safeKey, dir * 7))
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    swipeRef.current = { x: e.clientX, y: e.clientY }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>): void {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return
    shiftWeek(dx > 0 ? -1 : 1)
  }

  function onWheel(e: WheelEvent<HTMLDivElement>): void {
    if (Math.abs(e.deltaX) < 28 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    shiftWeek(e.deltaX > 0 ? 1 : -1)
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onChange(shiftDateKey(safeKey, -1))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(shiftDateKey(safeKey, 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(todayKey)
    } else if (e.key === 'Escape') {
      setCalOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`date-timeline${compact ? ' is-compact' : ''}${calOpen ? ' is-cal-open' : ''}`}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipeRef.current = null
      }}
      onWheel={onWheel}
    >
      <div className="today-head-date">
        <button
          type="button"
          className="today-head-copy"
          aria-expanded={calOpen}
          aria-haspopup="dialog"
          onClick={() => setCalOpen((v) => !v)}
        >
          <h1 className="today-title">{formatDayCaption(safeKey, safeNow)}</h1>
          <p className="today-kicker">{subtitle || `${formatTodayStamp(safeNow)} ▾`}</p>
        </button>
      </div>
      <div className="today-week" role="tablist" aria-label={uiText("本周")}>
        <button type="button" className="today-cal-nav" aria-label={uiText("上一周")} onClick={() => shiftWeek(-1)}>
          ‹
        </button>
        {week.filter((d) => Number.isFinite(d.date) && d.dow).map((d, i) => {
          const mark = markedDays?.get(d.key) || 0
          return (
            <button
              key={`${d.key}:${i}`}
              type="button"
              role="tab"
              aria-selected={d.key === safeKey}
              title={mark ? uiText("周{0} · {1} 件", [d.dow, mark]) : uiText("周{0}", [d.dow])}
              className={`today-week-day${d.key === safeKey ? ' on' : ''}${d.isToday ? ' is-today' : ''}${
                mark ? ' has-mark' : ''
              }`}
              onClick={() => onChange(d.key)}
            >
              <span className="today-week-dow">{uiText("周")}{d.dow}</span>
              <span className="today-week-num">{Number.isFinite(d.date) ? d.date : ''}</span>
            </button>
          )
        })}
        <button type="button" className="today-cal-nav" aria-label={uiText("下一周")} onClick={() => shiftWeek(1)}>
          ›
        </button>
      </div>
      {!viewingToday ? (
        <button type="button" className="today-text-btn" onClick={() => onChange(todayKey)}>
          {uiText("回今天")}</button>
      ) : null}
      {calOpen ? (
        <div className="today-month" role="dialog" aria-label={uiText("选日期")}>
          <div className="today-month-bar">
            <button
              type="button"
              className="today-cal-nav"
              aria-label={uiText("上个月")}
              onClick={() => onChange(shiftMonthKey(safeKey, -1))}
            >
              ‹
            </button>
            <span className="today-month-label">{formatMonthLabel(safeKey)}</span>
            <button
              type="button"
              className="today-cal-nav"
              aria-label={uiText("下个月")}
              onClick={() => onChange(shiftMonthKey(safeKey, 1))}
            >
              ›
            </button>
          </div>
          <div className="today-month-dows">
            {[uiText("一"), uiText("二"), uiText("三"), uiText("四"), uiText("五"), uiText("六"), uiText("日")].map((d) => (
              <span key={d}>{uiText("周")}{d}</span>
            ))}
          </div>
          <div className="today-month-grid">
            {monthDays.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`today-month-day${d.key === safeKey ? ' on' : ''}${d.isToday ? ' is-today' : ''}${
                  d.inMonth ? '' : ' is-other'
                }`}
                onClick={() => {
                  onChange(d.key)
                  setCalOpen(false)
                }}
              >
                {d.date}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
