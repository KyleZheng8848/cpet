import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type CSSProperties
} from 'react'
import type { ImageSendMode } from '@shared/multimodal'
import type { FilePreviewTarget } from '@shared/filePreview'
import { formatConversationAge } from '@shared/conversationGroups'
import { rssScoreLabel } from '@shared/rssTask'
import { DateTimeline } from './DateTimeline'
import { RssTagMap } from './RssTagMap'
import {
  buildDayReview,
  countReadsOnDay,
  collectRssTagPool,
  pickReadsByTag,
  fitReadPageSize,
  formatDayCaption,
  formatTodayStamp,
  listWeekDays,
  listRecordNotes,
  formatMemoNote,
  joinMemoNote,
  memoTitleOf,
  splitMemoNote,
  orderReadLanes,
  pickTodayReadLanes,
  todayNeedKindLabel,
  localDateKey,
  localDayBounds,
  sliceReadPage,
  clampTodayAskPct,
  clampTodayDockPct,
  clampTodayMapWidth,
  clampTodayMemoPct,
  todayThumbLabel,
  todayThumbTone,
  TODAY_ASK_PCT_DEFAULT,
  TODAY_ASK_PCT_KEY,
  TODAY_DOCK_PCT_DEFAULT,
  TODAY_DOCK_PCT_KEY,
  TODAY_MAP_W_DEFAULT,
  TODAY_MAP_W_KEY,
  TODAY_MEMO_PCT_DEFAULT,
  TODAY_MEMO_PCT_KEY,
  TODAY_READ_PAGE,
  TODAY_READ_TICK_MS,
  TODAY_READS_ALL,
  todayDayKindLabel,
  type TodayDayItem,
  type TodayNeedItem,
  type TodayQuickRef,
  type TodayReadItem,
  type TodayReadLane
} from '@shared/todayHome'
import type { ChatAttachment, ChatMessage, Conversation, ScheduledTask, TodayMemo } from '@shared/types'
import type { OpsBoardItem } from '@shared/opsBoard'
import { Block } from './Blocks'
import { Composer, type ComposerDraft } from './Composer'

function clockLabel(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type RemindPreset = '' | '1h' | 'tonight' | 'tomorrow' | 'pick'

function atHourToday(hour: number, now: number): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function remindAtFromPreset(preset: RemindPreset, custom: string, now: number): number | undefined {
  if (preset === '1h') return now + 3600_000
  if (preset === 'tonight') return atHourToday(20, now)
  if (preset === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }
  if (preset === 'pick' && custom) {
    const t = new Date(custom).getTime()
    return Number.isFinite(t) ? t : undefined
  }
  return undefined
}

function chatMessageText(m: ChatMessage): string {
  return (m.blocks || [])
    .filter((b) => b.kind === 'text' || b.kind === 'status')
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .trim()
}

function newsRef(it: TodayReadItem): TodayQuickRef {
  return {
    id: `news:${it.conversationId}:${it.entryId}`,
    kind: 'news',
    title: it.title,
    text: it.excerpt || [it.taskTitle, it.source].filter(Boolean).join(' · ')
  }
}

function memoRef(m: TodayMemo): TodayQuickRef {
  return {
    id: `memo:${m.id}`,
    kind: 'memo',
    title: memoTitleOf(m),
    text: formatMemoNote(m)
  }
}


function readStoredMapWidth(): number {
  try {
    const raw = localStorage.getItem(TODAY_MAP_W_KEY)
    const n = Number(raw)
    // 旧默认 240 太窄，没被用户特意拖过就跟新默认
    if (raw != null && Number.isFinite(n) && n !== 240) return clampTodayMapWidth(n)
  } catch {
    /* ignore */
  }
  return TODAY_MAP_W_DEFAULT
}

function writeStoredMapWidth(n: number): void {
  try {
    localStorage.setItem(TODAY_MAP_W_KEY, String(clampTodayMapWidth(n)))
  } catch {
    /* ignore */
  }
}

function readStoredAskPct(): number {
  try {
    const n = Number(localStorage.getItem(TODAY_ASK_PCT_KEY))
    if (Number.isFinite(n)) return clampTodayAskPct(n)
  } catch {
    /* ignore */
  }
  return TODAY_ASK_PCT_DEFAULT
}

function writeStoredAskPct(n: number): void {
  try {
    localStorage.setItem(TODAY_ASK_PCT_KEY, String(clampTodayAskPct(n)))
  } catch {
    /* ignore */
  }
}

function readStoredDockPct(): number {
  try {
    const n = Number(localStorage.getItem(TODAY_DOCK_PCT_KEY))
    if (Number.isFinite(n)) return clampTodayDockPct(n)
  } catch {
    /* ignore */
  }
  return TODAY_DOCK_PCT_DEFAULT
}

function writeStoredDockPct(n: number): void {
  try {
    localStorage.setItem(TODAY_DOCK_PCT_KEY, String(clampTodayDockPct(n)))
  } catch {
    /* ignore */
  }
}

function readStoredMemoPct(): number {
  try {
    const n = Number(localStorage.getItem(TODAY_MEMO_PCT_KEY))
    if (Number.isFinite(n)) return clampTodayMemoPct(n)
  } catch {
    /* ignore */
  }
  return TODAY_MEMO_PCT_DEFAULT
}

function writeStoredMemoPct(n: number): void {
  try {
    localStorage.setItem(TODAY_MEMO_PCT_KEY, String(clampTodayMemoPct(n)))
  } catch {
    /* ignore */
  }
}

function ReadThumb({ src, label }: { src?: string; label: string }): JSX.Element {
  useUiLocale()
  const [ok, setOk] = useState(Boolean(src))
  const tone = todayThumbTone(label)
  if (src && ok) {
    return (
      <span className={`today-read-thumb t${tone}`} aria-hidden>
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setOk(false)} />
      </span>
    )
  }
  return (
    <span className={`today-read-thumb is-preset t${tone}`} aria-hidden>
      <svg viewBox="0 0 16 16" width="11" height="11">
        <path
          fill="currentColor"
          d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM3.5 3a.5.5 0 0 0-.5.5V5h10V3.5a.5.5 0 0 0-.5-.5h-9ZM13 6H3v6.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V6Z"
        />
      </svg>
      <b>{label}</b>
    </span>
  )
}

function readKey(it: TodayReadItem): string {
  return `${it.conversationId}:${it.entryId}`
}

function TodayReadList({
  items,
  now,
  showTask,
  citedIds,
  peekId,
  onOpen,
  onCite
}: {
  items: TodayReadItem[]
  now: number
  showTask: boolean
  citedIds: ReadonlySet<string>
  peekId?: string
  onOpen: (item: TodayReadItem) => void
  onCite: (item: TodayReadItem) => void
}): JSX.Element {
  useUiLocale()
  return (
    <ul className="today-read-cycle">
      {items.map((it) => {
        const age = formatConversationAge(it.publishedAt, now)
        const source = it.source
        const task = showTask && it.taskTitle && it.taskTitle !== it.source ? it.taskTitle : ''
        const cited = citedIds.has(newsRef(it).id)
        const score = it.score
        return (
          <li key={`${it.conversationId}:${it.entryId}`}>
            <div className={`today-read${cited ? ' is-cited' : ''}${peekId === readKey(it) ? ' is-peek' : ''}`}>
              <ReadThumb src={it.imageUrl} label={todayThumbLabel(it)} />
              <button type="button" className="today-read-main" onClick={() => onOpen(it)}>
                <span className="today-read-title">{it.title}</span>
                <span className="today-read-tags">
                  {score ? (
                    <span className={`rss-score-chip s${score}`} title={`${score} ${rssScoreLabel(score)}`}>
                      {rssScoreLabel(score)}
                    </span>
                  ) : null}
                  {task ? <span className="today-read-tag">{task}</span> : null}
                  {source ? <span className="today-read-tag">{source}</span> : null}
                  {age ? <span className="today-read-tag is-time">{age}</span> : null}
                  {(it.tags || []).slice(0, 2).map((tag) => (
                    <span key={tag} className="today-read-tag is-topic">
                      {tag}
                    </span>
                  ))}
                </span>
              </button>
              <button type="button" className="today-cite-btn" onClick={() => onCite(it)}>
                {cited ? uiText("已引") : uiText("引用")}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function TodayReadPeek({
  item,
  onClose,
  onAnalyze
}: {
  item: TodayReadItem
  onClose: () => void
  onAnalyze: () => void
}): JSX.Element {
  useUiLocale()
  return (
    <aside className="today-read-peek" aria-label={uiText("资讯速览")}>
      <div className="today-read-peek-h">
        <strong>{uiText("速览")}</strong>
        <button type="button" className="today-text-btn" onClick={onClose}>
          {uiText("回图谱")}</button>
      </div>
      <h3>{item.title}</h3>
      <p className="today-read-peek-meta">
        {[item.source, item.taskTitle !== item.source ? item.taskTitle : '', (item.tags || []).slice(0, 2).join(' · ')]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="today-read-peek-body">
        {item.excerpt || uiText("这篇还没有抓到正文。去详细分析里看原文。")}
      </p>
      <button type="button" className="settings-btn tiny" onClick={onAnalyze}>
        {uiText("详细分析")}</button>
    </aside>
  )
}

function TodayReadCycle({
  items,
  page,
  pageSize,
  laneId,
  now,
  showTask,
  citedIds,
  peekId,
  onOpen,
  onCite
}: {
  items: TodayReadItem[]
  page: number
  pageSize: number
  laneId: string
  now: number
  showTask: boolean
  citedIds: ReadonlySet<string>
  peekId?: string
  onOpen: (item: TodayReadItem) => void
  onCite: (item: TodayReadItem) => void
}): JSX.Element {
  useUiLocale()
  const pages = Math.max(1, Math.ceil(items.length / pageSize) || 1)
  const logical = ((page % pages) + pages) % pages
  const [pos, setPos] = useState(logical)
  const [instant, setInstant] = useState(false)
  const prev = useRef(logical)
  const laneRef = useRef(laneId)

  const pagesRef = useRef(pages)
  useEffect(() => {
    if (laneRef.current !== laneId || pagesRef.current !== pages) {
      laneRef.current = laneId
      pagesRef.current = pages
      prev.current = logical
      setInstant(true)
      setPos(logical)
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
      return
    }
    const from = prev.current
    if (from === logical) return
    if (pages > 1 && from === pages - 1 && logical === 0) setPos(pages)
    else if (pages > 1 && from === 0 && logical === pages - 1) setPos(-1)
    else setPos(logical)
    prev.current = logical
    setInstant(false)
  }, [logical, pages, laneId])

  const pageItems = (i: number): TodayReadItem[] => sliceReadPage(items, ((i % pages) + pages) % pages, pageSize)
  const slides = pages > 1 ? [pageItems(pages - 1), ...Array.from({ length: pages }, (_, i) => pageItems(i)), pageItems(0)] : [pageItems(0)]
  const shift = pages > 1 ? pos + 1 : 0

  return (
    <div className="today-read-stage">
      <div
        className={`today-read-track${instant ? ' is-instant' : ''}`}
        style={{ transform: `translate3d(${-shift * 100}%, 0, 0)` }}
        onTransitionEnd={() => {
          if (pos === pages) {
            setInstant(true)
            setPos(0)
            requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
          } else if (pos === -1) {
            setInstant(true)
            setPos(pages - 1)
            requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
          }
        }}
      >
        {slides.map((list, i) => (
          <div key={`${laneId}:${i}`} className="today-read-page">
            <TodayReadList
              items={list}
              now={now}
              showTask={showTask}
              citedIds={citedIds}
              peekId={peekId}
              onOpen={onOpen}
              onCite={onCite}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function TodayHome({
  needs = [],
  readLanes: _readLanes = [],
  schedules = [],
  conversations = [],
  ops = [],
  hasRssTask,
  now,
  memos = [],
  quickMessages = [],
  quickBusy,
  quickCwd,
  quickDraft,
  onQuickDraftChange,
  onQuickSend,
  onQuickStop,
  toolsHidden,
  onToggleTools,
  askBarHostRef,
  askThread,
  askFooter,
  askAside,
  composerInputRef,
  onPreviewFile,
  imageSendMode,
  thinking,
  laneOrder = [],
  onLaneOrder,
  focusMemoId,
  onAddMemo,
  onUpsertMemo,
  onCompleteMemo,
  onRemoveMemo,
  onOpenNeed,
  onOpenRead,
  onOpenDayItem,
  onOpenSchedules,
  onNewRss
}: {
  needs: TodayNeedItem[]
  readLanes: TodayReadLane[]
  schedules: ScheduledTask[]
  conversations: Conversation[]
  ops: OpsBoardItem[]
  hasRssTask: boolean
  now: number
  memos: TodayMemo[]
  quickMessages: ChatMessage[]
  quickBusy: boolean
  quickCwd?: string
  quickDraft?: ComposerDraft | null
  onQuickDraftChange: (draft: Omit<ComposerDraft, 'nonce'>) => void
  onQuickSend: (
    text: string,
    refs?: TodayQuickRef[],
    attachments?: ChatAttachment[],
    skills?: string[]
  ) => void
  onQuickStop: () => void
  toolsHidden: boolean
  onToggleTools: () => void
  askBarHostRef: (el: HTMLDivElement | null) => void
  askThread?: ReactNode
  askFooter?: ReactNode
  askAside?: ReactNode
  composerInputRef?: RefObject<HTMLTextAreaElement>
  onPreviewFile?: (target: FilePreviewTarget) => void
  imageSendMode?: ImageSendMode
  thinking?: {
    on: boolean
    disabled?: boolean
    onChange: (next: boolean) => void
  } | null
  laneOrder: string[]
  onLaneOrder: (ids: string[]) => void
  focusMemoId?: string | null
  onAddMemo: (text: string) => void
  onUpsertMemo: (memo: TodayMemo) => void
  onCompleteMemo: (id: string, done: boolean) => void
  onRemoveMemo: (id: string) => void
  onOpenNeed: (item: TodayNeedItem) => void
  onOpenRead: (item: TodayReadItem) => void
  onOpenDayItem: (item: TodayDayItem) => void
  onOpenSchedules: () => void
  onNewRss: () => void
}): JSX.Element {
  useUiLocale()
  const todayKey = localDateKey(now)
  const [dateKey, setDateKey] = useState(todayKey)
  const [readLaneId, setReadLaneId] = useState(TODAY_READS_ALL)
  const [readPage, setReadPage] = useState(0)
  const [readPaused, setReadPaused] = useState(false)
  const [pageSize, setPageSize] = useState(TODAY_READ_PAGE)
  const [readTag, setReadTag] = useState('')
  const [mapWidth, setMapWidth] = useState(readStoredMapWidth)
  const [mapResizing, setMapResizing] = useState(false)
  const [askPct, setAskPct] = useState(readStoredAskPct)
  const [askResizing, setAskResizing] = useState(false)
  const [dockPct, setDockPct] = useState(readStoredDockPct)
  const [memoPct, setMemoPct] = useState(readStoredMemoPct)
  const [splitKind, setSplitKind] = useState<'map' | 'ask' | 'dock' | 'memo' | ''>('')
  const [peek, setPeek] = useState<TodayReadItem | null>(null)
  const [noteId, setNoteId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteQuery, setNoteQuery] = useState('')
  const [notePinOpen, setNotePinOpen] = useState(false)
  const [memoWhen, setMemoWhen] = useState('')
  const [remindPreset, setRemindPreset] = useState<RemindPreset>('')
  const [noteSaved, setNoteSaved] = useState(true)
  const [refs, setRefs] = useState<TodayQuickRef[]>([])
  const noteSaveRef = useRef<number | null>(null)
  const noteStateRef = useRef({ noteId, noteText })
  noteStateRef.current = { noteId, noteText }
  const dragLane = useRef<string | null>(null)
  const weekAnchor = localDayBounds(dateKey).start + 12 * 60 * 60 * 1000
  const week = useMemo(() => listWeekDays(weekAnchor, now), [weekAnchor, now])
  const viewingToday = dateKey === todayKey
  const dayItems = useMemo(
    () => buildDayReview(dateKey, schedules, conversations, ops, now),
    [dateKey, schedules, conversations, ops, now]
  )
  const markedDays = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of week) {
      const n =
        buildDayReview(d.key, schedules, conversations, ops, now).length +
        countReadsOnDay(conversations, d.key, now)
      if (n) counts.set(d.key, n)
    }
    return counts
  }, [week, schedules, conversations, ops, now])
  const watchItems = viewingToday ? needs : dayItems
  const dayReadLanes = useMemo(
    () =>
      orderReadLanes(pickTodayReadLanes(conversations, now, undefined, undefined, dateKey), laneOrder),
    [conversations, now, dateKey, laneOrder]
  )
  const archivedMemos = useMemo(() => listRecordNotes(memos), [memos])
  const visibleNotes = useMemo(() => {
    const q = noteQuery.trim().toLowerCase()
    if (!q) return archivedMemos
    return archivedMemos.filter((m) => {
      const title = memoTitleOf(m).toLowerCase()
      const body = (m.body || '').toLowerCase()
      return title.includes(q) || body.includes(q)
    })
  }, [archivedMemos, noteQuery])
  const activeLane = dayReadLanes.find((l) => l.id === readLaneId) || dayReadLanes[0]
  const lanePool = useMemo(
    () => collectRssTagPool(conversations, activeLane?.id || TODAY_READS_ALL, now, dateKey),
    [conversations, activeLane?.id, now, dateKey]
  )
  const reads = useMemo(
    () => (readTag ? pickReadsByTag(lanePool, readTag, now) : activeLane?.items || []),
    [lanePool, activeLane?.items, readTag, now]
  )
  const readPages = Math.max(1, Math.ceil(reads.length / pageSize))
  const citedIds = useMemo(() => new Set(refs.map((r) => r.id)), [refs])
  const threadRef = useRef<HTMLDivElement>(null)
  const readHostRef = useRef<HTMLDivElement | null>(null)
  const shownQuick = quickMessages.slice(-36)
  const lastQuickId = shownQuick[shownQuick.length - 1]?.id
  const lastAskText = [...shownQuick].reverse().map(chatMessageText).find((t) => t) || ''

  useEffect(() => {
    if (!dayReadLanes.some((l) => l.id === readLaneId)) setReadLaneId(TODAY_READS_ALL)
  }, [dayReadLanes, readLaneId])

  useEffect(() => {
    setReadPage(0)
  }, [readLaneId, dateKey, readTag])

  useEffect(() => {
    setReadPage((p) => Math.min(p, Math.max(0, readPages - 1)))
  }, [readPages])

  useEffect(() => {
    if (!readTag) return
    const key = readTag.trim().toLowerCase()
    if (!lanePool.some((it) => (it.tags || []).some((t) => t.toLowerCase() === key))) {
      setReadTag('')
    }
  }, [readLaneId, lanePool, readTag])

  const readHostRo = useRef<ResizeObserver | null>(null)
  const readMeasureRaf = useRef(0)
  const measureReadHost = useCallback(() => {
    const el = readHostRef.current
    if (!el) return
    const row = el.querySelector('.today-read')
    const raw = row instanceof HTMLElement ? row.getBoundingClientRect().height : 0
    const rowPx = raw > 32 ? raw : 62
    setPageSize((cur) => fitReadPageSize(el.clientHeight, rowPx, 2, 12, cur))
  }, [])
  const scheduleReadMeasure = useCallback(() => {
    if (readMeasureRaf.current) return
    readMeasureRaf.current = requestAnimationFrame(() => {
      readMeasureRaf.current = 0
      measureReadHost()
    })
  }, [measureReadHost])
  const bindReadHost = useCallback(
    (el: HTMLDivElement | null) => {
      readHostRef.current = el
      readHostRo.current?.disconnect()
      readHostRo.current = null
      if (!el) return
      const ro = new ResizeObserver(scheduleReadMeasure)
      readHostRo.current = ro
      ro.observe(el)
      measureReadHost()
    },
    [measureReadHost, scheduleReadMeasure]
  )

  useEffect(() => {
    const ro = new ResizeObserver(scheduleReadMeasure)
    for (const n of [deskRef.current, briefRef.current, dockRef.current, readHostRef.current]) {
      if (n) ro.observe(n)
    }
    window.addEventListener('resize', scheduleReadMeasure)
    window.visualViewport?.addEventListener('resize', scheduleReadMeasure)
    scheduleReadMeasure()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', scheduleReadMeasure)
      window.visualViewport?.removeEventListener('resize', scheduleReadMeasure)
      if (readMeasureRaf.current) cancelAnimationFrame(readMeasureRaf.current)
      readHostRo.current?.disconnect()
    }
  }, [scheduleReadMeasure, hasRssTask, reads.length, dockPct, askPct, mapWidth])

  useEffect(() => {
    if (readPaused || splitKind || reads.length <= pageSize) return
    const t = window.setInterval(() => {
      setReadPage((p) => (p + 1) % readPages)
    }, TODAY_READ_TICK_MS)
    return () => window.clearInterval(t)
  }, [readPaused, splitKind, reads.length, readPages, pageSize])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [shownQuick.length, quickBusy, lastQuickId])

  function toggleRef(next: TodayQuickRef): void {
    setRefs((prev) => (prev.some((r) => r.id === next.id) ? prev.filter((r) => r.id !== next.id) : [...prev, next]))
  }

  function persistNote(next = noteStateRef.current): string | null {
    const { title, body } = splitMemoNote(next.noteText)
    if (!title && !body) return next.noteId
    const existing = next.noteId ? memos.find((m) => m.id === next.noteId) : undefined
    const id = existing?.id || `memo-${Date.now().toString(36)}`
    const memo: TodayMemo = {
      id,
      title: title || '未命名',
      body,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      kind: existing?.kind === 'remind' && existing.completedAt ? existing.kind : 'log'
    }
    if (existing?.completedAt) {
      memo.completedAt = existing.completedAt
      if (existing.durationMs) memo.durationMs = existing.durationMs
      if (existing.firedAt) memo.firedAt = existing.firedAt
      if (existing.remindAt) memo.remindAt = existing.remindAt
    }
    onUpsertMemo(memo)
    if (!next.noteId) setNoteId(id)
    setNoteSaved(true)
    return id
  }

  function scheduleNoteSave(): void {
    setNoteSaved(false)
    if (noteSaveRef.current) window.clearTimeout(noteSaveRef.current)
    noteSaveRef.current = window.setTimeout(() => {
      noteSaveRef.current = null
      persistNote()
    }, 360)
  }

  function flushNote(): void {
    if (noteSaveRef.current) {
      window.clearTimeout(noteSaveRef.current)
      noteSaveRef.current = null
    }
    persistNote()
  }

  function openNote(m: TodayMemo): void {
    flushNote()
    setNoteId(m.id)
    setNoteText(joinMemoNote(m))
    setNotePinOpen(false)
    setRemindPreset('')
    setMemoWhen('')
    setNoteSaved(true)
  }

  function startNewNote(): void {
    flushNote()
    setNoteId(null)
    setNoteText('')
    setNotePinOpen(false)
    setRemindPreset('')
    setMemoWhen('')
    setNoteSaved(true)
  }

  function pinCurrentNote(preset: RemindPreset): void {
    const { title, body } = splitMemoNote(noteText)
    if (!title && !body) return
    if (noteSaveRef.current) {
      window.clearTimeout(noteSaveRef.current)
      noteSaveRef.current = null
    }
    const existing = noteId ? memos.find((m) => m.id === noteId) : undefined
    const remindAt = remindAtFromPreset(preset, memoWhen, now)
    const id = existing?.id || noteId || `memo-${Date.now().toString(36)}`
    onUpsertMemo({
      id,
      title: title || '未命名',
      body,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      kind: 'remind',
      ...(remindAt ? { remindAt } : {})
    })
    setNoteId(id)
    setNotePinOpen(false)
    setNoteSaved(true)
  }

  function removeCurrentNote(): void {
    const id = noteId
    if (noteSaveRef.current) {
      window.clearTimeout(noteSaveRef.current)
      noteSaveRef.current = null
    }
    setNoteId(null)
    setNoteText('')
    setNotePinOpen(false)
    setRemindPreset('')
    setMemoWhen('')
    if (id) onRemoveMemo(id)
  }

  const readSwipe = useRef<{ x: number; y: number } | null>(null)
  const mapSplit = useRef<{ x: number; w: number } | null>(null)
  const askSplit = useRef<{ x: number; pct: number; desk: number } | null>(null)
  const dockSplit = useRef<{ y: number; pct: number; box: number } | null>(null)
  const memoSplit = useRef<{ x: number; pct: number; box: number } | null>(null)
  const deskRef = useRef<HTMLDivElement>(null)
  const briefRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)

  function onMapSplitDown(e: PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    mapSplit.current = { x: e.clientX, w: mapWidth }
    setMapResizing(true)
    setSplitKind('map')
  }

  function onMapSplitMove(e: PointerEvent<HTMLDivElement>): void {
    const start = mapSplit.current
    if (!start) return
    const next = clampTodayMapWidth(start.w - (e.clientX - start.x))
    setMapWidth(next)
  }

  function onMapSplitUp(): void {
    mapSplit.current = null
    setMapResizing(false)
    setSplitKind('')
    writeStoredMapWidth(mapWidth)
  }

  function onAskSplitDown(e: PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const desk = deskRef.current?.clientWidth || 0
    askSplit.current = { x: e.clientX, pct: askPct, desk }
    setAskResizing(true)
    setSplitKind('ask')
  }

  function onAskSplitMove(e: PointerEvent<HTMLDivElement>): void {
    const start = askSplit.current
    if (!start || start.desk < 80) return
    const next = clampTodayAskPct(start.pct - ((e.clientX - start.x) / start.desk) * 100)
    setAskPct(next)
  }

  function onAskSplitUp(): void {
    askSplit.current = null
    setAskResizing(false)
    setSplitKind('')
    writeStoredAskPct(askPct)
  }

  function onDockSplitDown(e: PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dockSplit.current = { y: e.clientY, pct: dockPct, box: briefRef.current?.clientHeight || 0 }
    setSplitKind('dock')
  }

  function onDockSplitMove(e: PointerEvent<HTMLDivElement>): void {
    const start = dockSplit.current
    if (!start || start.box < 80) return
    setDockPct(clampTodayDockPct(start.pct - ((e.clientY - start.y) / start.box) * 100))
  }

  function onDockSplitUp(): void {
    dockSplit.current = null
    setSplitKind('')
    writeStoredDockPct(dockPct)
  }

  function onMemoSplitDown(e: PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    memoSplit.current = { x: e.clientX, pct: memoPct, box: dockRef.current?.clientWidth || 0 }
    setSplitKind('memo')
  }

  function onMemoSplitMove(e: PointerEvent<HTMLDivElement>): void {
    const start = memoSplit.current
    if (!start || start.box < 80) return
    setMemoPct(clampTodayMemoPct(start.pct - ((e.clientX - start.x) / start.box) * 100))
  }

  function onMemoSplitUp(): void {
    memoSplit.current = null
    setSplitKind('')
    writeStoredMemoPct(memoPct)
  }

  function onReadPointerDown(e: PointerEvent<HTMLDivElement>): void {
    readSwipe.current = { x: e.clientX, y: e.clientY }
  }

  function onReadPointerUp(e: PointerEvent<HTMLDivElement>): void {
    const start = readSwipe.current
    readSwipe.current = null
    if (!start || readPages <= 1) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    setReadPage((p) => p + (dx < 0 ? 1 : -1))
  }

  function dropLane(onto: string): void {
    const from = dragLane.current
    dragLane.current = null
    if (!from || from === onto || onto === TODAY_READS_ALL || from === TODAY_READS_ALL) return
    const ids = dayReadLanes.filter((l) => l.id !== TODAY_READS_ALL).map((l) => l.id)
    const next = ids.filter((id) => id !== from)
    const at = next.indexOf(onto)
    if (at < 0) next.push(from)
    else next.splice(at, 0, from)
    onLaneOrder(next)
  }

  return (
    <div
      className={`today-home${mapResizing ? ' is-map-resizing' : ''}${askResizing ? ' is-ask-resizing' : ''}${splitKind === 'dock' ? ' is-dock-resizing' : ''}${splitKind === 'memo' ? ' is-memo-resizing' : ''}`}
      role="region"
      aria-label={uiText("工作台")}
    >
      <header className="today-head">
        <DateTimeline
          dateKey={dateKey}
          now={now}
          onChange={setDateKey}
          markedDays={markedDays}
          subtitle={`${formatTodayStamp(now)} ▾`}
        />
      </header>

      <div
        ref={deskRef}
        className="today-desk"
        style={{ '--today-ask-w': `${askPct}%` } as CSSProperties}
      >
        <div
          ref={briefRef}
          className="today-pane today-pane-brief"
          style={{ '--today-dock-h': `${dockPct}%` } as CSSProperties}
        >
          <section
            className="today-reads"
            aria-labelledby="today-reads-h"
            onMouseEnter={() => setReadPaused(true)}
            onMouseLeave={() => setReadPaused(false)}
          >
            <div className="today-pane-label">
              <h2 id="today-reads-h">{uiText("资讯")}</h2>
              {reads.length ? <span className="today-count">{reads.length}</span> : null}
              {readTag ? (
                <button type="button" className="today-text-btn" onClick={() => setReadTag('')}>
                  {readTag} ×
                </button>
              ) : null}
            </div>
            {dayReadLanes.length > 1 ? (
              <div className="today-read-tabs" role="tablist" aria-label={uiText("资讯任务")}>
                {dayReadLanes.map((lane) => (
                  <button
                    key={lane.id}
                    type="button"
                    role="tab"
                    aria-selected={lane.id === activeLane?.id}
                    className={`today-read-tab${lane.id === activeLane?.id ? ' on' : ''}`}
                    draggable={lane.id !== TODAY_READS_ALL}
                    title={lane.id === TODAY_READS_ALL ? undefined : uiText("拖动调整栏目顺序")}
                    onDragStart={() => {
                      dragLane.current = lane.id
                    }}
                    onDragOver={(e) => {
                      if (lane.id === TODAY_READS_ALL) return
                      e.preventDefault()
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      dropLane(lane.id)
                    }}
                    onClick={() => setReadLaneId(lane.id)}
                  >
                    {lane.label}
                  </button>
                ))}
              </div>
            ) : null}
            {hasRssTask || reads.length ? (
              <div
                className="today-read-split"
                style={
                  hasRssTask ? ({ '--today-map-w': `${mapWidth}px` } as CSSProperties) : undefined
                }
              >
                <div className="today-read-maincol">
                  {reads.length ? (
                    <>
                      <div
                        className="today-read-host"
                        ref={bindReadHost}
                        onPointerDown={onReadPointerDown}
                        onPointerUp={onReadPointerUp}
                      >
                        <TodayReadCycle
                          items={reads}
                          page={readPage}
                          pageSize={pageSize}
                          laneId={activeLane?.id || TODAY_READS_ALL}
                          now={now}
                          showTask={activeLane?.id === TODAY_READS_ALL}
                          citedIds={citedIds}
                          peekId={peek ? readKey(peek) : ''}
                          onOpen={(it) => setPeek((cur) => (cur && readKey(cur) === readKey(it) ? null : it))}
                          onCite={(it) => toggleRef(newsRef(it))}
                        />
                      </div>
                      {readPages > 1 ? (
                        <div className="today-read-pager" role="tablist" aria-label={uiText("资讯翻页")}>
                          {Array.from({ length: readPages }, (_, i) => (
                            <button
                              key={i}
                              type="button"
                              role="tab"
                              aria-selected={i === readPage % readPages}
                              className={`today-read-dot${i === readPage % readPages ? ' on' : ''}`}
                              onClick={() => setReadPage(i)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="today-empty">
                      {readTag
                        ? uiText("「{0}」下暂时没有条目。点图谱里别的实体，或点清除。", [readTag])
                        : viewingToday
                          ? uiText("今天还没有资讯。")
                          : uiText("{0}没有资讯。", [formatDayCaption(dateKey, now)])}
                    </p>
                  )}
                </div>
                {hasRssTask ? (
                  <>
                    <div
                      className="today-tag-split"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={uiText("调整图谱宽度")}
                      title={uiText("拖动调整宽度")}
                      onPointerDown={onMapSplitDown}
                      onPointerMove={onMapSplitMove}
                      onPointerUp={onMapSplitUp}
                      onPointerCancel={onMapSplitUp}
                    />
                    {peek ? (
                      <TodayReadPeek
                        item={peek}
                        onClose={() => setPeek(null)}
                        onAnalyze={() => onOpenRead(peek)}
                      />
                    ) : (
                      <RssTagMap
                        key={`${activeLane?.id || TODAY_READS_ALL}:${dateKey}`}
                        items={lanePool}
                        selected={readTag}
                        onPick={setReadTag}
                      />
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="today-empty today-empty-action">
                <p>{uiText("还没有资讯任务。")}</p>
                <button type="button" className="settings-btn" onClick={onNewRss}>
                  {uiText("新建 RSS")}</button>
              </div>
            )}
          </section>

          <div
            className="today-row-split"
            role="separator"
            aria-orientation="horizontal"
            aria-label={uiText("调整待办记录高度")}
            title={uiText("拖动调整高度")}
            onPointerDown={onDockSplitDown}
            onPointerMove={onDockSplitMove}
            onPointerUp={onDockSplitUp}
            onPointerCancel={onDockSplitUp}
          />

          <div
            ref={dockRef}
            className="today-dock"
            style={{ '--today-memo-w': `${memoPct}%` } as CSSProperties}
          >
            <section className="today-watch" aria-label={viewingToday ? uiText("待办") : formatDayCaption(dateKey, now)}>
              <div className="today-pane-label">
                <h2>{viewingToday ? uiText("待办") : formatDayCaption(dateKey, now)}</h2>
                {watchItems.length ? <span className="today-count">{watchItems.length}</span> : null}
                <button type="button" className="today-text-btn" onClick={onOpenSchedules}>
                  {uiText("定时")}</button>
              </div>
              {watchItems.length ? (
                <ul className="today-watch-list">
                  {viewingToday
                    ? needs.map((it) => (
                        <li key={it.id}>
                          <div
                            className={`today-watch-row${it.memoId && it.memoId === focusMemoId ? ' is-focus' : ''}`}
                          >
                            {it.kind === 'remind' && it.memoId ? (
                              <button
                                type="button"
                                className="today-memo-check"
                                aria-label={uiText("完成这条提醒")}
                                onClick={() => onCompleteMemo(it.memoId!, true)}
                              />
                            ) : null}
                            <button
                              type="button"
                              className={`today-watch-item kind-${it.kind}`}
                              onClick={() =>
                                it.kind === 'remind' && it.memoId
                                  ? toggleRef(memoRef({ id: it.memoId, title: it.title, body: it.detail, createdAt: it.updatedAt }))
                                  : onOpenNeed(it)
                              }
                            >
                              <span className="today-watch-kind">{todayNeedKindLabel(it.kind)}</span>
                              <span className="today-watch-title">{it.title}</span>
                              {it.detail ? <span className="today-watch-detail">{it.detail}</span> : null}
                            </button>
                          </div>
                        </li>
                      ))
                    : dayItems.map((it) => (
                        <li key={it.id}>
                          <button
                            type="button"
                            className={`today-watch-item kind-${it.kind}${it.ok === false ? ' is-bad' : ''}`}
                            onClick={() => onOpenDayItem(it)}
                          >
                            <span className="today-watch-kind">{todayDayKindLabel(it.kind)}</span>
                            <span className="today-watch-title">{it.title}</span>
                            <span className="today-watch-detail">{clockLabel(it.at)}</span>
                          </button>
                        </li>
                      ))}
                </ul>
              ) : (
                <p className="today-empty tight">{uiText("这一栏还空着。提醒钉过来就会出现。")}</p>
              )}
            </section>

            <div
              className="today-col-split"
              role="separator"
              aria-orientation="vertical"
              aria-label={uiText("调整记录宽度")}
              title={uiText("拖动调整宽度")}
              onPointerDown={onMemoSplitDown}
              onPointerMove={onMemoSplitMove}
              onPointerUp={onMemoSplitUp}
              onPointerCancel={onMemoSplitUp}
            />

            <section
              className={`today-memos${archivedMemos.length ? '' : ' is-blank'}`}
              aria-label={uiText("记录")}
            >
              <div className="today-pane-label">
                <h2>{uiText("记录")}</h2>
                {archivedMemos.length ? <span className="today-count">{archivedMemos.length}</span> : null}
                {noteText.trim() ? (
                  <span className="today-count">{noteSaved ? uiText("已存") : '…'}</span>
                ) : null}
                <button type="button" className="today-text-btn" onClick={startNewNote}>
                  {uiText("新建")}</button>
                {noteId ? (
                  <button type="button" className="today-text-btn" onClick={removeCurrentNote}>
                    {uiText("删除")}</button>
                ) : null}
              </div>
              {archivedMemos.length > 3 ? (
                <input
                  className="today-note-search"
                  value={noteQuery}
                  onChange={(e) => setNoteQuery(e.target.value)}
                  placeholder={uiText("搜索")}
                  aria-label={uiText("搜索记录")}
                />
              ) : null}
              {visibleNotes.length ? (
                <ul className="today-memo-list is-sidebar">
                  {visibleNotes.map((m) => {
                    const cited = refs.some((r) => r.id === memoRef(m).id)
                    return (
                      <li
                        key={m.id}
                        id={`today-memo-${m.id}`}
                        className={`today-memo-row${m.id === noteId || m.id === focusMemoId ? ' is-focus' : ''}${
                          m.completedAt ? ' is-done' : ''
                        }`}
                      >
                        <button
                          type="button"
                          className={`today-memo-item is-compact${cited ? ' is-cited' : ''}`}
                          onClick={() => openNote(m)}
                        >
                          <span className="today-memo-title">{memoTitleOf(m)}</span>
                          <span className="today-memo-when">{clockLabel(m.updatedAt || m.createdAt)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : archivedMemos.length ? (
                <p className="today-empty tight">{uiText("没有匹配的记录。")}</p>
              ) : null}
              <div className="today-journal">
                <textarea
                  className="today-note-pad"
                  value={noteText}
                  onChange={(e) => {
                    setNoteText(e.target.value)
                    scheduleNoteSave()
                  }}
                  onBlur={flushNote}
                  placeholder={uiText("点上面一条，或直接写：第一行是标题")}
                  aria-label={uiText("备忘录")}
                />
                <div className="today-journal-bar" role="group" aria-label={uiText("记录操作")}>
                  <button
                    type="button"
                    className={`today-when-chip${notePinOpen || remindPreset ? ' on' : ''}`}
                    onClick={() => setNotePinOpen((on) => !on)}
                  >
                    {uiText("提醒")}</button>
                  {notePinOpen ? (
                    <>
                      {(
                        [
                          ['', uiText("不定时")],
                          ['1h', uiText("一小时后")],
                          ['tonight', uiText("今晚")],
                          ['tomorrow', uiText("明天")],
                          ['pick', uiText("自选")]
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id || 'none'}
                          type="button"
                          className={`today-when-chip${remindPreset === id ? ' on' : ''}`}
                          onClick={() => {
                            setRemindPreset(id)
                            if (id !== 'pick') pinCurrentNote(id)
                          }}
                        >
                          {label}
                        </button>
                      ))}
                      {remindPreset === 'pick' ? (
                        <>
                          <input
                            className="today-journal-pick"
                            type="datetime-local"
                            value={memoWhen}
                            onChange={(e) => setMemoWhen(e.target.value)}
                            aria-label={uiText("自选时间")}
                          />
                          <button
                            type="button"
                            className="today-text-btn"
                            onClick={() => pinCurrentNote('pick')}
                            disabled={!memoWhen}
                          >
                            {uiText("钉上")}</button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  {noteText.trim() ? (
                    <button
                      type="button"
                      className="today-text-btn today-journal-cite"
                      onClick={() => {
                        const { title, body } = splitMemoNote(noteText)
                        toggleRef({
                          id: `memo:${noteId || 'draft'}`,
                          kind: 'memo',
                          title: title || '未命名',
                          text: body || title
                        })
                      }}
                    >
                      {uiText("引用")}</button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>
        <div
          className="today-ask-split"
          role="separator"
          aria-orientation="vertical"
          aria-label={uiText("调整快问宽度")}
          title={uiText("拖动调整快问宽度")}
          onPointerDown={onAskSplitDown}
          onPointerMove={onAskSplitMove}
          onPointerUp={onAskSplitUp}
          onPointerCancel={onAskSplitUp}
        />
        <section className={`today-pane today-pane-ask${askAside ? ' has-aside' : ''}`} aria-label={uiText("快速对话")}>
          <div className="today-pane-label">
            <h2>{uiText("快问")}</h2>
            {lastAskText ? (
              <button type="button" className="today-text-btn" onClick={() => onAddMemo(lastAskText)}>
                {uiText("记下")}</button>
            ) : null}
            <button type="button" className="today-text-btn" onClick={onToggleTools}>
              {toolsHidden ? uiText("工具") : uiText("收起工具")}
            </button>
          </div>
          <div className={`today-ask-bar-host${toolsHidden ? ' is-hidden' : ''}`} ref={askBarHostRef} />
          <div className="today-ask-body">
            <div className="today-ask-main">
              <div className="today-ask-thread" ref={threadRef}>
            {askThread && (shownQuick.length || quickBusy) ? (
              askThread
            ) : shownQuick.length || quickBusy ? (
              <>
                {shownQuick.map((m) => {
                  const text = chatMessageText(m)
                  if (!text && m.role !== 'assistant' && !(m.blocks || []).some((b) => b.kind === 'attachment')) {
                    return null
                  }
                  return (
                    <div key={m.id} className={`today-ask-turn is-${m.role}`}>
                      <div className="today-ask-bubble">
                        {(m.blocks || []).map((b, i) => (
                          <Block key={`${m.id}:${i}`} block={b} streaming={quickBusy && m.role === 'assistant'} />
                        ))}
                        {!text && quickBusy && m.role === 'assistant' ? (
                          <span className="today-ask-pending">…</span>
                        ) : null}
                      </div>
                      {text ? (
                        <div className="today-ask-acts">
                          <button type="button" className="today-text-btn" onClick={() => void navigator.clipboard.writeText(text)}>
                            {uiText("复制")}</button>
                          <button type="button" className="today-text-btn" onClick={() => onAddMemo(text)}>
                            {uiText("记下")}</button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {quickBusy && shownQuick[shownQuick.length - 1]?.role !== 'assistant' ? (
                  <div className="today-ask-turn is-assistant">
                    <div className="today-ask-bubble is-pending">{uiText("正在想…")}</div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="today-empty today-ask-hint">{uiText("点资讯或记录，再问。")}</p>
            )}
          </div>
          {refs.length ? (
            <div className="today-ref-chips">
              {refs.map((r) => (
                <button key={r.id} type="button" className="today-ref-chip" onClick={() => toggleRef(r)}>
                  {r.kind === 'memo' ? uiText("记录") : uiText("资讯")} · {r.title}
                  <span aria-hidden> ×</span>
                </button>
              ))}
            </div>
          ) : null}
          {askFooter}
          <Composer
            busy={quickBusy}
            draft={quickDraft}
            onDraftChange={onQuickDraftChange}
            cwd={quickCwd}
            toolsHidden={toolsHidden}
            inputRef={composerInputRef}
            onPreviewFile={onPreviewFile}
            imageSendMode={imageSendMode}
            thinking={thinking}
            placeholder={refs.length ? uiText("带着这页上的东西问…") : uiText("写在页边，Enter 发出去")}
            onSend={(text, attachments, skills) => {
              const cited = refs
              setRefs([])
              onQuickSend(text, cited, attachments, skills)
            }}
            onStop={onQuickStop}
          />
            </div>
          {askAside}
          </div>
        </section>
      </div>
    </div>
  )
}
