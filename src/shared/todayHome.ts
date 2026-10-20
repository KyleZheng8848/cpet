import { UNGROUPED_SECTION_ID, type ConversationPartition } from './conversationGroups'
import { opsBoardKindLabel, type OpsBoardItem } from './opsBoard'
import { rssEntryDisplayTitle } from './rssLang'
import { rssEntryTagList, stripRssChromePlain } from './rssTags'
import {
  articlePlainExcerpt,
  isEntryValuable,
  rssEntryImageUrl,
  rssEntryIsUnread,
  type RssValueScore
} from './rssTask'
import type { Conversation, ScheduledTask, TodayHeldDone, TodayMemo } from './types'

export type TodayNeedKind = OpsBoardItem['kind'] | 'remind'

export interface TodayNeedItem {
  id: string
  kind: TodayNeedKind
  title: string
  detail: string
  conversationId?: string
  memoId?: string
  panel?: 'chat' | 'schedules' | 'monitor'
  updatedAt: number
}

export interface TodayReadItem {
  conversationId: string
  entryId: string
  title: string
  source: string
  taskTitle: string
  score?: RssValueScore
  publishedAt: number
  imageUrl?: string
  tags?: string[]
  excerpt?: string
}

export const TODAY_READS_ALL = 'all'

export interface TodayReadLane {
  id: string
  label: string
  items: TodayReadItem[]
}

export interface TodayRecentItem {
  conversationId: string
  title: string
  kind: NonNullable<Conversation['kind']>
  updatedAt: number
}

const NEED_LIMIT = 8
const HELD_DONE_LIMIT = 12
const READ_LIMIT = 8
/** 「全部」当天值得看+ 的硬顶，按重要性+时效排。 */
export const TODAY_READ_ALL_LIMIT = 36
export const TODAY_READ_TASK_LIMIT = 16
const READ_ALL_LIMIT = TODAY_READ_ALL_LIMIT
const READ_TASK_LIMIT = TODAY_READ_TASK_LIMIT
const RECENT_LIMIT = 5
const VALUABLE_MIN = 4 as const

export const TODAY_READ_PAGE = 3
export const TODAY_READ_TICK_MS = 6500
export const TODAY_MAP_W_MIN = 220
export const TODAY_MAP_W_MAX = 560
export const TODAY_MAP_W_DEFAULT = 340
export const TODAY_MAP_W_KEY = 'cpet.todayMapWidth'
export const TODAY_ASK_PCT_MIN = 22
export const TODAY_ASK_PCT_MAX = 48
export const TODAY_ASK_PCT_DEFAULT = 33
export const TODAY_ASK_PCT_KEY = 'cpet.todayAskPct'
export const TODAY_DOCK_PCT_MIN = 24
export const TODAY_DOCK_PCT_MAX = 62
export const TODAY_DOCK_PCT_DEFAULT = 38
export const TODAY_DOCK_PCT_KEY = 'cpet.todayDockPct'
export const TODAY_MEMO_PCT_MIN = 28
export const TODAY_MEMO_PCT_MAX = 72
export const TODAY_MEMO_PCT_DEFAULT = 54
export const TODAY_MEMO_PCT_KEY = 'cpet.todayMemoPct'
const MEMO_OPEN_LIMIT = 40
const MEMO_DONE_LIMIT = 80
const MEMO_TITLE = 80
const MEMO_BODY = 600

export type TodayQuickRef = {
  id: string
  kind: 'memo' | 'news'
  title: string
  text: string
}

export function clampTodayMapWidth(n: number): number {
  if (!Number.isFinite(n)) return TODAY_MAP_W_DEFAULT
  return Math.max(TODAY_MAP_W_MIN, Math.min(TODAY_MAP_W_MAX, Math.round(n)))
}

export function clampTodayLayoutPct(
  n: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function clampTodayAskPct(n: number): number {
  return clampTodayLayoutPct(n, TODAY_ASK_PCT_MIN, TODAY_ASK_PCT_MAX, TODAY_ASK_PCT_DEFAULT)
}

export function clampTodayDockPct(n: number): number {
  return clampTodayLayoutPct(n, TODAY_DOCK_PCT_MIN, TODAY_DOCK_PCT_MAX, TODAY_DOCK_PCT_DEFAULT)
}

export function clampTodayMemoPct(n: number): number {
  return clampTodayLayoutPct(n, TODAY_MEMO_PCT_MIN, TODAY_MEMO_PCT_MAX, TODAY_MEMO_PCT_DEFAULT)
}

/** 没图时占位：核心 tag 1–2 字，保证和有图行平齐。 */
export function todayThumbLabel(item: Pick<TodayReadItem, 'tags' | 'title'>): string {
  const tag = (item.tags?.[0] || '').trim()
  const src = tag || (item.title || '').trim()
  if (!src) return '讯'
  const ch = src[0] || ''
  if (/[\u4e00-\u9fff]/.test(ch)) return src.slice(0, 2)
  return src.slice(0, 2).toUpperCase()
}

export function todayThumbTone(label: string): number {
  let h = 0
  for (const c of label) h = (h * 31 + (c.codePointAt(0) || 0)) >>> 0
  return h % 6
}

export function todayReadExcerpt(entry: {
  snippet?: string
  extractHtml?: string
  contentHtml?: string
}): string {
  const snip = stripRssChromePlain(entry.snippet || '')
    .replace(/\s+/g, ' ')
    .trim()
  const body = stripRssChromePlain(
    articlePlainExcerpt(entry.extractHtml || entry.contentHtml, 20000)
  )
    .replace(/\s+/g, ' ')
    .trim()
  if (body && (body.length >= snip.length || snip.length < 24)) return body
  return (snip || body).trim()
}

export function fitReadPageSize(
  heightPx: number,
  rowPx = 64,
  min = 3,
  max = 12,
  current?: number
): number {
  if (!(heightPx > 0) || !(rowPx > 0)) {
    return typeof current === 'number' && current >= min ? Math.min(current, max) : min
  }
  const fitted = Math.max(min, Math.min(max, Math.floor(heightPx / rowPx)))
  if (
    typeof current === 'number' &&
    current >= min &&
    current <= max &&
    current !== fitted
  ) {
    if (fitted > current && heightPx < (current + 1) * rowPx + 8) return current
    if (fitted < current && heightPx > current * rowPx - 8) return current
  }
  return fitted
}

function finiteTs(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined
}

export function memoTitleOf(m: Pick<TodayMemo, 'title' | 'body'>): string {
  return (m.title || m.body || '').trim() || '未命名'
}

/** 备忘录：首行标题，其余正文。 */
export function splitMemoNote(text: string): { title: string; body: string } {
  const raw = (text || '').replace(/\r\n/g, '\n')
  const nl = raw.indexOf('\n')
  const first = (nl < 0 ? raw : raw.slice(0, nl)).trim()
  const rest = nl < 0 ? '' : raw.slice(nl + 1).replace(/^\n+/, '').trimEnd()
  return {
    title: first.slice(0, MEMO_TITLE),
    body: rest.slice(0, MEMO_BODY)
  }
}

export function joinMemoNote(m: Pick<TodayMemo, 'title' | 'body'>): string {
  const title = (m.title || '').trim()
  const body = (m.body || '').trim()
  if (title && body) return `${title}\n${body}`
  return title || body
}

export function memoPreviewOf(m: Pick<TodayMemo, 'title' | 'body'>): string {
  const body = (m.body || '').replace(/\s+/g, ' ').trim()
  if (body) return body
  return ''
}

export function normalizeTodayMemos(raw: unknown): TodayMemo[] {
  if (!Array.isArray(raw)) return []
  const open: TodayMemo[] = []
  const done: TodayMemo[] = []
  const seen = new Set<string>()
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const legacy = typeof o.text === 'string' ? o.text.trim() : ''
    const title = (typeof o.title === 'string' ? o.title : legacy).trim()
    const body = (typeof o.body === 'string' ? o.body : title === legacy ? '' : legacy).trim()
    const createdAt = finiteTs(o.createdAt) || 0
    if (!id || (!title && !body) || seen.has(id)) continue
    seen.add(id)
    const memo: TodayMemo = {
      id,
      title: (title || body.slice(0, 24)).slice(0, MEMO_TITLE),
      body: body.slice(0, MEMO_BODY),
      createdAt
    }
    const remindAt = finiteTs(o.remindAt)
    const completedAt = finiteTs(o.completedAt)
    const durationMs = finiteTs(o.durationMs)
    const firedAt = finiteTs(o.firedAt)
    const updatedAt = finiteTs(o.updatedAt)
    if (o.kind === 'log' || o.kind === 'remind') memo.kind = o.kind
    if (remindAt) memo.remindAt = remindAt
    if (completedAt) memo.completedAt = completedAt
    if (durationMs) memo.durationMs = durationMs
    if (firedAt) memo.firedAt = firedAt
    if (updatedAt) memo.updatedAt = updatedAt
    if (completedAt) done.push(memo)
    else open.push(memo)
  }
  return [...open.slice(0, MEMO_OPEN_LIMIT), ...done.slice(0, MEMO_DONE_LIMIT)]
}

export function normalizeTodayHeldDones(raw: unknown): TodayHeldDone[] {
  if (!Array.isArray(raw)) return []
  const out: TodayHeldDone[] = []
  const seen = new Set<string>()
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const conversationId = typeof o.conversationId === 'string' ? o.conversationId.trim() : ''
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `held:${conversationId}`
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!conversationId || !title || seen.has(conversationId)) continue
    seen.add(conversationId)
    out.push({
      id,
      conversationId,
      title,
      detail: typeof o.detail === 'string' ? o.detail : '刚完成，还没看',
      updatedAt: finiteTs(o.updatedAt) || 0
    })
    if (out.length >= HELD_DONE_LIMIT) break
  }
  return out
}

export function normalizeLaneOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const it of raw) {
    if (typeof it !== 'string') continue
    const id = it.trim()
    if (!id || id === TODAY_READS_ALL || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function orderReadLanes(
  lanes: readonly TodayReadLane[],
  order: readonly string[]
): TodayReadLane[] {
  if (lanes.length <= 1) return [...lanes]
  const all = lanes.find((l) => l.id === TODAY_READS_ALL)
  const rest = lanes.filter((l) => l.id !== TODAY_READS_ALL)
  const byId = new Map(rest.map((l) => [l.id, l]))
  const next: TodayReadLane[] = []
  for (const id of order) {
    const hit = byId.get(id)
    if (!hit) continue
    next.push(hit)
    byId.delete(id)
  }
  for (const l of rest) {
    if (byId.has(l.id)) next.push(l)
  }
  return all ? [all, ...next] : next
}

export function mergeHeldDones(
  held: readonly TodayHeldDone[],
  ops: readonly OpsBoardItem[]
): TodayHeldDone[] {
  const byConv = new Map(held.map((h) => [h.conversationId, h]))
  for (const it of ops) {
    if (it.kind !== 'done' || !it.conversationId) continue
    const prev = byConv.get(it.conversationId)
    if (!prev || it.updatedAt >= prev.updatedAt) {
      byConv.set(it.conversationId, {
        id: it.id,
        conversationId: it.conversationId,
        title: it.title,
        detail: it.detail || '刚完成，还没看',
        updatedAt: it.updatedAt
      })
    }
  }
  return [...byConv.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, HELD_DONE_LIMIT)
}

export function releaseHeldDone(
  held: readonly TodayHeldDone[],
  conversationId: string
): TodayHeldDone[] {
  return held.filter((h) => h.conversationId !== conversationId)
}

export function isTodoMemo(m: TodayMemo): boolean {
  return !m.completedAt && m.kind !== 'log'
}

export function isRecordMemo(m: TodayMemo): boolean {
  return m.kind === 'log' || !!m.completedAt
}

export function openReminders(memos: readonly TodayMemo[]): TodayMemo[] {
  return memos.filter(isTodoMemo)
}

export function doneReminders(memos: readonly TodayMemo[]): TodayMemo[] {
  return memos.filter(isRecordMemo)
}

export function memoStamp(m: Pick<TodayMemo, 'updatedAt' | 'completedAt' | 'createdAt'>): number {
  return m.updatedAt || m.completedAt || m.createdAt || 0
}

/** 记录列表：最近改过的在上。 */
export function listRecordNotes(memos: readonly TodayMemo[]): TodayMemo[] {
  return doneReminders(memos).sort((a, b) => memoStamp(b) - memoStamp(a) || a.id.localeCompare(b.id))
}

export function completeTodayMemo(m: TodayMemo, now = Date.now()): TodayMemo {
  if (m.completedAt) return m
  return {
    ...m,
    completedAt: now,
    durationMs: Math.max(0, now - (m.createdAt || now))
  }
}

export function reopenTodayMemo(m: TodayMemo): TodayMemo {
  const { completedAt: _c, durationMs: _d, ...rest } = m
  return rest
}

export function takeDueReminders(
  memos: readonly TodayMemo[],
  now = Date.now()
): { next: TodayMemo[]; due: TodayMemo[] } {
  const due: TodayMemo[] = []
  const next = memos.map((m) => {
    if (m.kind === 'log' || m.completedAt || m.firedAt || !m.remindAt || m.remindAt > now) return m
    const fired = { ...m, firedAt: now }
    due.push(fired)
    return fired
  })
  return { next, due }
}

export function formatTodayQuickContext(refs: readonly TodayQuickRef[]): string {
  if (!refs.length) return ''
  const lines = refs.map((r) => {
    if (r.kind === 'memo') return `【记录】${r.title}${r.text ? `\n${r.text}` : ''}`
    return `【资讯】${r.title}${r.text ? `\n${r.text}` : ''}`
  })
  return `工作台引用：\n${lines.join('\n\n')}`
}

export function formatMemoNote(m: TodayMemo): string {
  const bits = [memoTitleOf(m)]
  if (m.body && m.body !== m.title) bits.push(m.body)
  if (m.completedAt) {
    const mins = Math.max(1, Math.round((m.durationMs || 0) / 60000))
    bits.push(`已完成 · 用了 ${mins} 分钟`)
  }
  return bits.join('\n')
}

const ATTENTION_KINDS = new Set<TodayNeedKind>(['waiting', 'error', 'done', 'schedule'])

function isStreaming(keys: ReadonlySet<string>, conversationId: string): boolean {
  for (const k of keys) {
    if (k === conversationId || k.startsWith(`${conversationId}::`)) return true
  }
  return false
}

function toNeed(it: OpsBoardItem): TodayNeedItem {
  return {
    id: it.id,
    kind: it.kind,
    title: it.title,
    detail: it.detail,
    conversationId: it.conversationId,
    panel: it.panel,
    updatedAt: it.updatedAt
  }
}

function clockLabel(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function upcomingScheduleSlot(
  t: ScheduledTask,
  start: number,
  end: number,
  now: number
): number | null {
  if (!t.enabled) return null
  if (t.kind === 'daily') {
    const at = new Date(start)
    at.setHours(t.hour ?? 9, t.minute ?? 0, 0, 0)
    const ts = at.getTime()
    if (ts >= start && ts < end && ts >= now - 60_000) return ts
    return null
  }
  if (t.kind === 'once' && t.runAt && t.runAt >= start && t.runAt < end && t.runAt >= now) {
    return t.runAt
  }
  if (t.nextRunAt && t.nextRunAt >= start && t.nextRunAt < end && t.nextRunAt >= now) {
    return t.nextRunAt
  }
  return null
}

function upcomingScheduleNeeds(schedules: readonly ScheduledTask[], now: number): TodayNeedItem[] {
  const { start, end } = localDayBounds(localDateKey(now))
  const out: TodayNeedItem[] = []
  for (const t of schedules) {
    const slot = upcomingScheduleSlot(t, start, end, now)
    if (slot == null) continue
    out.push({
      id: `up:${t.id}:${slot}`,
      kind: 'schedule',
      title: t.name,
      detail: `${clockLabel(slot)} · ${t.job === 'rss-digest' ? '简报' : '将跑'}`,
      conversationId: t.conversationId || t.rssConversationId,
      panel: 'schedules',
      updatedAt: slot
    })
  }
  return out.sort((a, b) => a.updatedAt - b.updatedAt)
}

function reminderNeeds(memos: readonly TodayMemo[], now: number): TodayNeedItem[] {
  return openReminders(memos)
    .sort((a, b) => (a.remindAt || a.createdAt) - (b.remindAt || b.createdAt))
    .map((m) => ({
      id: `remind:${m.id}`,
      kind: 'remind' as const,
      title: memoTitleOf(m),
      detail:
        m.remindAt && m.remindAt <= now
          ? '到点了'
          : m.remindAt
            ? clockLabel(m.remindAt)
            : '随时',
      memoId: m.id,
      updatedAt: m.remindAt || m.createdAt
    }))
}

/** 没打开的完成对话钉住；未完成提醒进待办；其余最多几条。 */
export function pickTodayNeeds(
  ops: readonly OpsBoardItem[],
  conversations: readonly Pick<Conversation, 'id' | 'title'>[],
  streamingIds: ReadonlySet<string>,
  limit = NEED_LIMIT,
  schedules: readonly ScheduledTask[] = [],
  now = Date.now(),
  heldDones: readonly TodayHeldDone[] = [],
  memos: readonly TodayMemo[] = []
): TodayNeedItem[] {
  const out: TodayNeedItem[] = []
  const seenId = new Set<string>()
  const seenConv = new Set<string>()

  const push = (item: TodayNeedItem, ignoreLimit = false): boolean => {
    if (!ignoreLimit && out.length >= limit) return false
    if (seenId.has(item.id)) return false
    if (item.conversationId && seenConv.has(item.conversationId) && item.kind !== 'remind') {
      return false
    }
    seenId.add(item.id)
    if (item.conversationId) seenConv.add(item.conversationId)
    out.push(item)
    return true
  }

  for (const h of heldDones) {
    push(
      {
        id: h.id,
        kind: 'done',
        title: h.title,
        detail: h.detail,
        conversationId: h.conversationId,
        panel: 'chat',
        updatedAt: h.updatedAt
      },
      true
    )
  }
  for (const it of reminderNeeds(memos, now)) push(it, true)
  for (const it of ops) {
    if (!ATTENTION_KINDS.has(it.kind)) continue
    push(toNeed(it))
  }
  for (const it of ops) {
    if (it.kind !== 'running') continue
    push(toNeed(it))
  }
  for (const c of conversations) {
    if (out.length >= limit) break
    if (!isStreaming(streamingIds, c.id) || seenConv.has(c.id)) continue
    push({
      id: `stream:${c.id}`,
      kind: 'running',
      title: c.title || '对话',
      detail: '正在回复',
      conversationId: c.id,
      panel: 'chat',
      updatedAt: Date.now()
    })
  }
  for (const it of upcomingScheduleNeeds(schedules, now)) {
    if (out.length >= limit) break
    push(it)
  }
  return out
}

export function todayNeedKindLabel(kind: TodayNeedKind): string {
  if (kind === 'remind') return '提醒'
  return opsBoardKindLabel(kind)
}

export interface TodayMonthDay {
  key: string
  date: number
  inMonth: boolean
  isToday: boolean
}

export function shiftMonthKey(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m) return dateKey
  const next = new Date(y, m - 1 + months, 1)
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  const day = Math.min(d || 1, last)
  return localDateKey(new Date(next.getFullYear(), next.getMonth(), day, 12).getTime())
}

/** 含锚点月的周一开头 6 周格子。 */
export function listMonthGrid(dateKey: string, now = Date.now()): TodayMonthDay[] {
  const [y, m] = dateKey.split('-').map(Number)
  if (!y || !m) return []
  const first = new Date(y, m - 1, 1, 12).getTime()
  const monday = startOfWeekMonday(first)
  const todayKey = localDateKey(now)
  const prefix = `${y}-${String(m).padStart(2, '0')}`
  const out: TodayMonthDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    const key = localDateKey(d.getTime())
    out.push({
      key,
      date: d.getDate(),
      inMonth: key.startsWith(prefix),
      isToday: key === todayKey
    })
  }
  return out
}

/** 资讯轮播：每次几条，按页循环。条目够时末页也铺满，避免只剩 2～3 条空一大截。 */
export function sliceReadPage(
  items: readonly TodayReadItem[],
  page: number,
  size = TODAY_READ_PAGE
): TodayReadItem[] {
  if (!items.length || size < 1) return []
  const n = items.length
  if (n <= size) return items.slice()
  const pages = Math.ceil(n / size)
  const i = ((page % pages) + pages) % pages
  const start = Math.min(i * size, n - size)
  return items.slice(start, start + size)
}

function liveFeedIds(feeds: { id?: string }[] | undefined): Set<string> {
  return new Set((feeds || []).map((f) => f.id).filter((id): id is string => Boolean(id)))
}

function readSource(c: Conversation, feedId: string, feedTitle?: string): string {
  const named = (feedTitle || '').trim()
  if (named) return named
  const hit = (c.rss?.feeds || []).find((f) => f.id === feedId)
  const title = (hit?.title || '').trim()
  if (title) return title
  return (c.title || '').trim() || 'RSS'
}

function entryStamp(it: { publishedAt?: number; fetchedAt?: number }): number {
  return it.publishedAt || it.fetchedAt || 0
}

/** 时效分：越新越高，跟价值分一起排。 */
export function readFreshnessScore(publishedAt: number, now: number): number {
  const ageH = Math.max(0, (now - publishedAt) / 3600_000)
  if (ageH < 4) return 5
  if (ageH < 10) return 4
  if (ageH < 20) return 3
  if (ageH < 36) return 2
  return 1
}

export function readRank(item: Pick<TodayReadItem, 'score' | 'publishedAt'>, now: number): number {
  return (item.score || 0) * 2 + readFreshnessScore(item.publishedAt, now)
}

function collectReads(
  c: Conversation,
  now: number,
  opts?: { dateKey?: string; unreadOnly?: boolean; valuableOnly?: boolean }
): TodayReadItem[] {
  if (c.kind !== 'rss' || !c.rss) return []
  const live = liveFeedIds(c.rss.feeds)
  const taskTitle = (c.title || '').trim() || '资讯'
  const day = opts?.dateKey ? localDayBounds(opts.dateKey) : null
  const unreadOnly = opts?.unreadOnly !== false && !opts?.dateKey
  const valuableOnly = opts?.valuableOnly !== false
  const scored: TodayReadItem[] = []
  for (const it of c.rss.items || []) {
    if (!it?.id) continue
    if (it.feedId && live.size && !live.has(it.feedId)) continue
    if (unreadOnly && !rssEntryIsUnread(it, now)) continue
    const at = entryStamp(it)
    if (day && (at < day.start || at >= day.end)) continue
    if (valuableOnly && !isEntryValuable(it, VALUABLE_MIN)) continue
    const tags = rssEntryTagList(it)
    scored.push({
      conversationId: c.id,
      entryId: it.id,
      title: rssEntryDisplayTitle(it),
      source: readSource(c, it.feedId, it.feedTitle),
      taskTitle,
      score: it.valueScore,
      publishedAt: at,
      imageUrl: rssEntryImageUrl(it),
      excerpt: todayReadExcerpt(it),
      ...(tags.length ? { tags } : {})
    })
  }
  return sortReads(scored, now)
}

function collectUnreadReads(c: Conversation, now: number): TodayReadItem[] {
  return collectReads(c, now, { unreadOnly: true })
}

function sortReads(list: TodayReadItem[], now: number): TodayReadItem[] {
  return [...list].sort(
    (a, b) => readRank(b, now) - readRank(a, now) || b.publishedAt - a.publishedAt
  )
}

/** 未读里先高分，再按时间补满；只看仍在订阅的源。 */
export function filterReadsByTag(items: readonly TodayReadItem[], tag: string): TodayReadItem[] {
  const key = tag.trim().toLowerCase()
  if (!key) return [...items]
  return items.filter((it) => (it.tags || []).some((t) => t.toLowerCase() === key))
}

/** 图谱 / 筛选池：该栏下当天全部消息（含已读、含低分），换日期就换图。 */
export function collectRssTagPool(
  conversations: readonly Conversation[],
  laneId: string,
  now = Date.now(),
  dateKey?: string
): TodayReadItem[] {
  const convs =
    !laneId || laneId === TODAY_READS_ALL
      ? conversations.filter((c) => c.kind === 'rss')
      : conversations.filter((c) => c.id === laneId && c.kind === 'rss')
  const day = dateKey || localDateKey(now)
  return sortReads(
    convs.flatMap((c) =>
      collectReads(c, now, { dateKey: day, unreadOnly: false, valuableOnly: false })
    ),
    now
  )
}

/** 点主题后按重要度 + 时效排，只留真正带这个实体的条目。 */
export function pickReadsByTag(
  items: readonly TodayReadItem[],
  tag: string,
  now: number,
  limit = TODAY_READ_ALL_LIMIT
): TodayReadItem[] {
  const key = tag.trim()
  if (!key) return sortReads([...items], now).slice(0, Math.max(1, limit))
  return sortReads(filterReadsByTag(items, key), now).slice(0, Math.max(1, limit))
}

export function pickTodayReads(
  conversations: readonly Conversation[],
  now = Date.now(),
  limit = READ_LIMIT
): TodayReadItem[] {
  return sortReads(conversations.flatMap((c) => collectUnreadReads(c, now)), now).slice(0, limit)
}

/** 「全部」+ 每个 RSS 任务一栏；只收值得看及以上。传入 dateKey 时只收当天（含已读）。 */
export function pickTodayReadLanes(
  conversations: readonly Conversation[],
  now = Date.now(),
  allLimit = READ_ALL_LIMIT,
  perTaskLimit = READ_TASK_LIMIT,
  dateKey?: string
): TodayReadLane[] {
  const taskLanes: TodayReadLane[] = []
  for (const c of conversations) {
    if (c.kind !== 'rss' || !c.rss) continue
    taskLanes.push({
      id: c.id,
      label: (c.title || '').trim() || '资讯',
      items: collectReads(c, now, dateKey ? { dateKey, unreadOnly: false } : { unreadOnly: true }).slice(
        0,
        perTaskLimit
      )
    })
  }
  if (!taskLanes.length) return []
  const allOpts = dateKey ? { dateKey, unreadOnly: false } : { unreadOnly: true }
  return [
    {
      id: TODAY_READS_ALL,
      label: '全部',
      items: sortReads(conversations.flatMap((c) => collectReads(c, now, allOpts)), now).slice(
        0,
        allLimit
      )
    },
    ...taskLanes
  ]
}

/** 某日有多少条资讯（含已读），给日历打点。 */
export function countReadsOnDay(
  conversations: readonly Conversation[],
  dateKey: string,
  now = Date.now()
): number {
  let n = 0
  for (const c of conversations) n += collectReads(c, now, { dateKey, unreadOnly: false }).length
  return n
}

export function todayHasRssTask(conversations: readonly Pick<Conversation, 'kind' | 'rss'>[]): boolean {
  return conversations.some((c) => c.kind === 'rss' && !!c.rss)
}

/** 最近动过的任务，去掉已经出现在「要你看一眼」里的。 */
export function pickTodayRecent(
  conversations: readonly Conversation[],
  excludeIds: ReadonlySet<string>,
  limit = RECENT_LIMIT
): TodayRecentItem[] {
  return [...conversations]
    .filter((c) => c.id && !excludeIds.has(c.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit)
    .map((c) => ({
      conversationId: c.id,
      title: (c.title || '').trim() || (c.kind === 'rss' ? '资讯' : '对话'),
      kind: c.kind || 'chat',
      updatedAt: c.updatedAt || c.createdAt || 0
    }))
}

export function formatTodayStamp(now = Date.now()): string {
  const d = new Date(safeTime(now))
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] || ''
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`
}

export interface TodayTaskItem {
  conversationId: string
  title: string
  kind: NonNullable<Conversation['kind']>
  updatedAt: number
}

export interface TodayTaskGroupView {
  id: string
  label: string
  items: TodayTaskItem[]
}

export type TodayDayItemKind = 'schedule-upcoming' | 'schedule-ran' | 'rss-digest' | 'ops'

export interface TodayDayItem {
  id: string
  kind: TodayDayItemKind
  at: number
  title: string
  detail?: string
  conversationId?: string
  taskId?: string
  digestId?: string
  ok?: boolean
  panel?: 'chat' | 'schedules' | 'monitor'
}

export interface TodayWeekDay {
  key: string
  date: number
  dow: string
  isToday: boolean
}

const TASK_PER_GROUP = 4

function toTaskItem(c: Conversation): TodayTaskItem {
  return {
    conversationId: c.id,
    title: (c.title || '').trim() || (c.kind === 'rss' ? '资讯' : '对话'),
    kind: c.kind || 'chat',
    updatedAt: c.updatedAt || c.createdAt || 0
  }
}

/** 置顶 / 日常 / 自定义分组，每组只取最近几条。 */
export function pickTodayTaskGroups(
  partition: ConversationPartition,
  ungroupedLabel: string,
  perGroup = TASK_PER_GROUP
): TodayTaskGroupView[] {
  const out: TodayTaskGroupView[] = []
  if (partition.pinned.length) {
    out.push({
      id: 'pinned',
      label: '置顶',
      items: partition.pinned.slice(0, perGroup).map(toTaskItem)
    })
  }
  if (partition.ungrouped.length) {
    out.push({
      id: UNGROUPED_SECTION_ID,
      label: ungroupedLabel || '日常',
      items: partition.ungrouped.slice(0, perGroup).map(toTaskItem)
    })
  }
  for (const s of partition.sections) {
    if (!s.conversations.length) continue
    out.push({
      id: s.group.id,
      label: s.group.name,
      items: s.conversations.slice(0, perGroup).map(toTaskItem)
    })
  }
  return out
}

export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return false
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function safeTime(ts: unknown, fallback = Date.now()): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  if (ts instanceof Date) {
    const n = ts.getTime()
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(safeTime(ts))
  if (Number.isNaN(d.getTime())) {
    const f = new Date()
    const y = f.getFullYear()
    const m = String(f.getMonth() + 1).padStart(2, '0')
    const day = String(f.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function localDayBounds(dateKey: string): { start: number; end: number } {
  const key = isValidDateKey(dateKey) ? dateKey : localDateKey()
  const [y, mo, d] = key.split('-').map(Number)
  const start = new Date(y, mo - 1, d).getTime()
  const end = new Date(y, mo - 1, d + 1).getTime()
  return { start, end }
}

/** 含该日的周一 12:00（避开夏令时午夜错位）。 */
export function startOfWeekMonday(ts: number): number {
  const d = new Date(safeTime(ts))
  d.setHours(12, 0, 0, 0)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.getTime()
}

export function shiftDateKey(dateKey: string, days: number): string {
  const { start } = localDayBounds(dateKey)
  const d = new Date(start)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return localDateKey(d.getTime())
}

export function formatMonthLabel(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number)
  if (!y || !m) return ''
  return `${y}年${m}月`
}

export function formatDayCaption(dateKey: string, now = Date.now()): string {
  const key = isValidDateKey(dateKey) ? dateKey : localDateKey(now)
  if (key === localDateKey(now)) return '今天'
  const [y, m, d] = key.split('-').map(Number)
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()]
  return `${m}月${d}日 周${week}`
}

/** 本周跨度：同月写「9月14日–20日」，跨月写「8月31日–9月6日」。 */
export function formatWeekSpan(week: readonly Pick<TodayWeekDay, 'key'>[]): string {
  if (!week.length) return ''
  const a = week[0].key.split('-').map(Number)
  const b = week[week.length - 1].key.split('-').map(Number)
  if (!a[1] || !b[1]) return ''
  if (a[1] === b[1]) return `${a[1]}月${a[2]}日–${b[2]}日`
  return `${a[1]}月${a[2]}日–${b[1]}月${b[2]}日`
}

/** 含锚点日的周一到周日。 */
export function listWeekDays(anchor = Date.now(), now = Date.now()): TodayWeekDay[] {
  const todayKey = localDateKey(now)
  const monday = new Date(startOfWeekMonday(Number.isFinite(anchor) ? anchor : Date.now()))
  const out: TodayWeekDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = localDateKey(d.getTime())
    out.push({
      key,
      date: d.getDate(),
      dow: ['一', '二', '三', '四', '五', '六', '日'][i],
      isToday: key === todayKey
    })
  }
  return out
}

/** 工作台里嵌着的快问任务（侧栏也看得到，点进去才是完整对话）。 */
export const TODAY_QUICK_TEMPLATE = 'today-quick'

export function isTodayQuickTask(
  c: Pick<Conversation, 'kind' | 'promptTemplateId'>
): boolean {
  return c.promptTemplateId === TODAY_QUICK_TEMPLATE && (!c.kind || c.kind === 'chat')
}

/** 某日：将跑 / 已跑 / 简报 / 作战板（回看日才带作战板，避免和「要你看一眼」重复）。 */
export function buildDayReview(
  dateKey: string,
  schedules: readonly ScheduledTask[],
  conversations: readonly Conversation[],
  ops: readonly OpsBoardItem[],
  now = Date.now()
): TodayDayItem[] {
  const { start, end } = localDayBounds(dateKey)
  const items: TodayDayItem[] = []
  const todayKey = localDateKey(now)

  for (const t of schedules) {
    if (t.lastRunAt && t.lastRunAt >= start && t.lastRunAt < end) {
      items.push({
        id: `ran:${t.id}:${t.lastRunAt}`,
        kind: 'schedule-ran',
        at: t.lastRunAt,
        title: t.name,
        detail: t.lastRunSummary || (t.lastRunOk === false ? '没跑成' : '已跑完'),
        conversationId: t.conversationId || t.rssConversationId,
        taskId: t.id,
        ok: t.lastRunOk !== false,
        panel: t.job === 'rss-digest' ? 'chat' : 'schedules'
      })
    }
    const slot = upcomingScheduleSlot(t, start, end, now)
    if (slot != null) {
      items.push({
        id: `up:${t.id}:${slot}`,
        kind: 'schedule-upcoming',
        at: slot,
        title: t.name,
        detail: `${clockLabel(slot)} · ${t.job === 'rss-digest' ? '简报' : '任务'}`,
        conversationId: t.conversationId || t.rssConversationId,
        taskId: t.id,
        panel: 'schedules'
      })
    }
  }

  for (const c of conversations) {
    if (c.kind !== 'rss' || !c.rss) continue
    for (const d of c.rss.digests || []) {
      if (!d?.id || !d.createdAt) continue
      if (d.createdAt < start || d.createdAt >= end) continue
      items.push({
        id: `digest:${c.id}:${d.id}`,
        kind: 'rss-digest',
        at: d.createdAt,
        title: (d.title || '').trim() || '简报',
        detail: (c.title || '').trim() || 'RSS',
        conversationId: c.id,
        digestId: d.id,
        panel: 'chat'
      })
    }
  }

  if (dateKey !== todayKey) {
    for (const it of ops) {
      if (it.updatedAt < start || it.updatedAt >= end) continue
      items.push({
        id: `ops:${it.id}`,
        kind: 'ops',
        at: it.updatedAt,
        title: it.title,
        detail: it.detail,
        conversationId: it.conversationId,
        panel: it.panel
      })
    }
  }

  return items.sort((a, b) => a.at - b.at)
}

export function todayDayKindLabel(kind: TodayDayItemKind): string {
  switch (kind) {
    case 'schedule-upcoming':
      return '将跑'
    case 'schedule-ran':
      return '已跑'
    case 'rss-digest':
      return '简报'
    case 'ops':
      return '当时'
  }
}
