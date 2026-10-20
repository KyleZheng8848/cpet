/**
 * 资讯简报收件箱：主进程定时拉取浅条目，推给宠物；
 * 升级进对话由 IPC 触发，不在此自动发 Agent。
 */

import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMPTY_BRIEF_INBOX,
  applyInterestAutoRead,
  briefDigestScheduleKey,
  briefItemKey,
  briefIsActionable,
  buildBriefDigestBubble,
  dismissBriefItem,
  listActionableUnread,
  markAllBriefRead,
  markBriefRead,
  mergeBriefItems,
  normalizeInterestKeywords,
  reapplyBriefFilters,
  toggleBriefPin,
  visibleBriefItems,
  type BriefInbox,
  type BriefItem,
  type BriefSource
} from '../shared/briefInbox'
import {
  briefRssItemMatchesFeeds,
  hasRssTaskConversation,
  resolvePetBriefFeedUrls
} from '../shared/rssBrief'
import { listRssBrief } from './feeds'
import { getChatStore, getSettings } from './store'
import type { NewsItem } from '../shared/types'

const FILE = 'brief-inbox.json'
const REFRESH_MS = 30 * 60 * 1000
const STALE_MS = 25 * 60 * 1000

let inbox: BriefInbox = { ...EMPTY_BRIEF_INBOX }
let refreshTimer: ReturnType<typeof setInterval> | null = null
let scheduleTimer: ReturnType<typeof setInterval> | null = null
let refreshing = false
let emit: ((snap: BriefInbox) => void) | null = null
let emitDigest: ((payload: { text: string; hint: string; briefId?: string }) => void) | null = null
/** 同一轮新料 digest 最短间隔，避免刷屏。 */
let lastDigestAt = 0
const DIGEST_COOLDOWN_MS = 10 * 60 * 1000
/** 每日定时 digest 已触发的「日@小时」键（当天每个选中整点各一次）。 */
let lastScheduledDigestKey = ''

function dir(): string {
  const d = app.getPath('userData')
  try {
    mkdirSync(d, { recursive: true })
  } catch {
    // ignore
  }
  return d
}

function load(): BriefInbox {
  try {
    const raw = JSON.parse(readFileSync(join(dir(), FILE), 'utf8')) as BriefInbox
    if (raw && Array.isArray(raw.items)) {
      return {
        items: raw.items.filter((x) => x && typeof x.id === 'string' && typeof x.title === 'string'),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
        status: raw.status === 'ok' || raw.status === 'empty' || raw.status === 'error' ? raw.status : 'idle',
        lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined
      }
    }
  } catch {
    // first run
  }
  return { ...EMPTY_BRIEF_INBOX }
}

function persist(): void {
  try {
    // 不持久化过滤词（来自 settings）
    const { interestKeywords: _k, muteKeywords: _m, ...rest } = inbox
    writeFileSync(join(dir(), FILE), JSON.stringify(rest, null, 2))
  } catch (err) {
    console.error('[cursor-pet] brief-inbox 写入失败', err)
  }
}

function currentInterest(): string[] {
  return normalizeInterestKeywords(getSettings().briefInterestKeywords)
}

function currentMute(): string[] {
  return normalizeInterestKeywords(getSettings().briefMuteKeywords)
}

function withMeta(snap: BriefInbox): BriefInbox {
  return {
    ...snap,
    interestKeywords: currentInterest(),
    muteKeywords: currentMute()
  }
}

function publish(): void {
  emit?.(withMeta(inbox))
}

function setInbox(next: BriefInbox, save = true): void {
  inbox = next
  if (save) persist()
  publish()
}

export function getBriefInbox(): BriefInbox {
  return withMeta(inbox)
}

export function setBriefInboxEmitter(fn: (snap: BriefInbox) => void): void {
  emit = fn
}

export function setBriefDigestEmitter(
  fn: (payload: { text: string; hint: string; briefId?: string }) => void
): void {
  emitDigest = fn
}

function localDayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 强制播报当前未读 digest（定时用；可绕过冷却）。 */
export function emitCurrentBriefDigest(force = false): void {
  if (!emitDigest) return
  if (!force && Date.now() - lastDigestAt < DIGEST_COOLDOWN_MS) return
  const bubble = buildBriefDigestBubble(withMeta(inbox), currentInterest(), currentMute())
  lastDigestAt = Date.now()
  if (bubble) {
    emitDigest(bubble)
    return
  }
  const top = listActionableUnread(withMeta(inbox), 1, currentInterest(), currentMute())[0]
  emitDigest({
    text: '🗞 今日简报：暂无匹配未读',
    hint: '点击打开资讯任务，或去设置写兴趣词',
    briefId: top?.id
  })
}

export async function tickDailyDigest(): Promise<void> {
  const settings = getSettings()
  const intervalH =
    typeof settings.briefDigestIntervalHours === 'number' &&
    Number.isFinite(settings.briefDigestIntervalHours)
      ? Math.round(settings.briefDigestIntervalHours)
      : undefined
  if (intervalH != null && intervalH >= 1 && intervalH <= 168) {
    if (lastDigestAt > 0 && Date.now() - lastDigestAt < intervalH * 3600_000) return
    const key = `i:${intervalH}@${Math.floor(Date.now() / (intervalH * 3600_000))}`
    if (lastScheduledDigestKey === key) return
    lastScheduledDigestKey = key
    await refreshBriefInbox(true)
    emitCurrentBriefDigest(true)
    return
  }
  const hours = settings.briefDailyDigestHours?.length
    ? settings.briefDailyDigestHours.filter(
        (h) => typeof h === 'number' && h >= 0 && h <= 23
      )
    : typeof settings.briefDailyDigestHour === 'number'
      ? [settings.briefDailyDigestHour]
      : []
  if (!hours.length) return
  const now = new Date()
  const hour = now.getHours()
  if (!hours.includes(hour)) return
  // 该小时前 20 分钟内触发一次，避免整点错过
  if (now.getMinutes() > 20) return
  const key = briefDigestScheduleKey(localDayKey(now), hour)
  if (lastScheduledDigestKey === key) return
  lastScheduledDigestKey = key
  await refreshBriefInbox(true)
  emitCurrentBriefDigest(true)
}

export function initBriefInbox(): void {
  inbox = load()
  publish()
  void refreshBriefInbox(false)
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = setInterval(() => void refreshBriefInbox(false), REFRESH_MS)
  if (scheduleTimer) clearInterval(scheduleTimer)
  scheduleTimer = setInterval(() => void tickDailyDigest(), 60_000)
  // 启动后稍等再扫一次，避免刚开机错过整点窗口
  setTimeout(() => void tickDailyDigest(), 15_000)
}

export function stopBriefInbox(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (scheduleTimer) {
    clearInterval(scheduleTimer)
    scheduleTimer = null
  }
}

function newsToBrief(n: NewsItem, now: number): BriefItem | null {
  const src = n.source
  if (src !== 'hn' && src !== 'v2ex' && src !== 'rss') return null
  const id =
    src === 'rss' && typeof n.id === 'string'
      ? briefItemKey('rss', n.id)
      : briefItemKey(src as BriefSource, n.id)
  return {
    id,
    title: n.title,
    url: n.url,
    source: src,
    snippet: n.snippet,
    sourceLabel: n.sourceLabel,
    fetchedAt: now
  }
}

function maybeEmitDigest(prevItems: BriefItem[], next: BriefInbox, incoming: BriefItem[]): void {
  const interest = currentInterest()
  const mute = currentMute()
  const prevIds = new Set(prevItems.map((x) => x.id))
  const hits = incoming.filter(
    (x) => !prevIds.has(x.id) && briefIsActionable(x, interest, mute)
  )
  if (!hits.length) return
  if (Date.now() - lastDigestAt < DIGEST_COOLDOWN_MS) return
  const bubble = buildBriefDigestBubble(withMeta(next), interest, mute)
  if (!bubble) return
  lastDigestAt = Date.now()
  emitDigest?.(bubble)
}

export async function refreshBriefInbox(force = false): Promise<BriefInbox> {
  if (refreshing) return withMeta(inbox)
  if (!force && inbox.updatedAt && Date.now() - inbox.updatedAt < STALE_MS && inbox.status === 'ok') {
    return withMeta(inbox)
  }
  refreshing = true
  const prevItems = inbox.items
  setInbox({ ...inbox, status: 'loading', lastError: undefined }, false)
  try {
    const settings = getSettings()
    const chatStore = getChatStore()
    const hasRssTask = hasRssTaskConversation(chatStore)
    const rssUrls = resolvePetBriefFeedUrls(chatStore)
    const interest = normalizeInterestKeywords(settings.briefInterestKeywords)
    const mute = normalizeInterestKeywords(settings.briefMuteKeywords)

    const rss = rssUrls.length
      ? await listRssBrief(rssUrls, 5)
      : { items: [] as NewsItem[], errors: [] as string[] }

    const now = Date.now()
    const incoming: BriefItem[] = []
    for (const n of rss.items) {
      const b = newsToBrief(n, now)
      if (b) incoming.push(b)
    }

    const errParts = [...rss.errors]
    if (hasRssTask && !rssUrls.length) {
      errParts.push('RSS 任务里还没订阅源')
    } else if (rssUrls.length && !rss.items.length) {
      errParts.push(rss.errors.length ? 'RSS 拉取失败' : 'RSS 暂无新条目')
    }

    let merged = mergeBriefItems(prevItems, incoming)
    // 内置 HN/V2EX 与已从任务去掉的源：一律收掉，不再进宠物气泡
    merged = merged.map((it) => {
      const builtin = it.source === 'hn' || it.source === 'v2ex'
      const staleRss =
        it.source === 'rss' &&
        (!rssUrls.length || !briefRssItemMatchesFeeds(it, rssUrls))
      if (!builtin && !staleRss) return it
      if (it.dismissedAt && it.readAt) return it
      return {
        ...it,
        readAt: it.readAt || now,
        dismissedAt: it.dismissedAt || now
      }
    })
    merged = applyInterestAutoRead(prevItems, merged, interest, now, mute)
    const visible = visibleBriefItems({ ...inbox, items: merged }, 1)
    const lastError = errParts.length ? errParts.slice(0, 3).join('；') : undefined

    let next: BriefInbox
    if (incoming.length || visible.length) {
      next = {
        items: merged,
        updatedAt: now,
        status: 'ok',
        lastError: incoming.length ? (rss.errors.length ? lastError : undefined) : lastError
      }
    } else {
      next = {
        items: merged,
        updatedAt: now,
        status: lastError ? 'error' : 'empty',
        lastError
      }
    }
    setInbox(next)
    maybeEmitDigest(prevItems, next, incoming)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '拉取异常'
    const has = visibleBriefItems(inbox, 1).length > 0
    setInbox({
      ...inbox,
      updatedAt: Date.now(),
      status: has ? 'ok' : 'error',
      lastError: msg
    })
  } finally {
    refreshing = false
  }
  return withMeta(inbox)
}

export function briefMarkRead(id: string): BriefInbox {
  setInbox(markBriefRead(inbox, id))
  return withMeta(inbox)
}

export function briefMarkAllRead(): BriefInbox {
  setInbox(markAllBriefRead(inbox))
  return withMeta(inbox)
}

export function briefDismiss(id: string): BriefInbox {
  setInbox(dismissBriefItem(inbox, id))
  return withMeta(inbox)
}

export function briefTogglePin(id: string): BriefInbox {
  setInbox(toggleBriefPin(inbox, id))
  return withMeta(inbox)
}

export function findBriefItem(id: string): BriefItem | null {
  return inbox.items.find((x) => x.id === id && !x.dismissedAt) || null
}

/** 取可行动未读（供批量升级）。 */
export function takeActionableUnread(limit = 5): BriefItem[] {
  return listActionableUnread(withMeta(inbox), limit)
}

/** 兴趣/屏蔽词变更后立刻重算未读。 */
export function briefReapplyFilters(): BriefInbox {
  const next = reapplyBriefFilters(inbox, currentInterest(), currentMute())
  setInbox(next)
  return withMeta(inbox)
}
