import { t as uiText } from './i18n'
/**
 * 桌宠空闲气泡策略：防抽搐 + 固定优先级（非概率混抽）。
 *
 * 活跃层（ThoughtBubble）仍由 petPresence 仲裁：监听(IDE) > CPET 对话/对比。
 * 空闲层：RSS 条目/任务简报 > 天气 > 碎碎念（不再用 HN/V2EX 兜底）。
 */

import type { BriefInbox } from './briefInbox'
import { topUnreadBrief } from './briefInbox'
import type { BubbleAction, ChatStore, OpenPanelTarget, PetState, Settings } from './types'
import {
  isEntryValuable,
  rssDigestIsUnread,
  rssDigestThreadId,
  rssEntryIsUnread,
  rssScoreLabel,
  type RssDigestRecord,
  type RssTaskEntry,
  type RssValueScore
} from './rssTask'

/** 回到 idle 后至少静默这么久才播空闲气泡，避免 agent 刚结束就抽一下。 */
export const IDLE_SETTLE_MS = 4_000
/** 同类/更低优先级气泡最短展示，避免连播抽搐。 */
export const CHATTER_MIN_DWELL_MS = 5_000
/** 推送型气泡（RSS/简报 digest）展示多久。 */
export const PUSH_BUBBLE_MS = 9_000
/** 碎碎念/天气展示多久。 */
export const SOFT_BUBBLE_MS = 6_500
/** 状态气泡（思考/完成/等你等）自动收起，角标仍在。 */
export const THOUGHT_AUTO_HIDE_MS = 8_000
/** 待办列表面板自动收起，角标仍在。 */
export const ATTN_AUTO_CLOSE_MS = 6_000
/** 推送落场前短防抖（合并连发评分）。 */
export const PUSH_SHOW_DEBOUNCE_MS = 700
/** RSS 任务推送冷却（同会话内）。 */
export const RSS_PET_TIP_COOLDOWN_MS = 90_000
/** 活跃态势尾随防抖：连发后安静这么久再切到最新动作。 */
export const STATE_DEBOUNCE_MS = 2_500

export type PendingPetAgent = {
  state: PetState
  toolLabel?: string
}

/** waiting / error / done 立即落地；其余走尾随防抖。 */
export function shouldApplyPetStateNow(state: PetState): boolean {
  return state === 'waiting' || state === 'error' || state === 'done'
}

/** 与当前已展示或已 pending 同目标时，不重置防抖计时。 */
export function isSamePetAgentTarget(
  a: PendingPetAgent | null | undefined,
  b: PendingPetAgent | null | undefined
): boolean {
  if (!a || !b) return false
  if (a.state !== b.state) return false
  if (a.state === 'tool') return (a.toolLabel || '') === (b.toolLabel || '')
  return true
}

/**
 * 尾随防抖语义：一串连发态势在安静后只保留最后一条。
 * （供测试/文档；运行时由 timer + pending 实现。）
 */
export function trailingPetAgentTarget(
  events: ReadonlyArray<PendingPetAgent>
): PendingPetAgent | null {
  if (!events.length) return null
  return events[events.length - 1]
}

export type IdleBubbleRank = 10 | 20 | 35 | 38 | 40

export const IDLE_RANK = {
  chatter: 10 as IdleBubbleRank,
  weather: 20 as IdleBubbleRank,
  brief: 35 as IdleBubbleRank,
  rssDigest: 38 as IdleBubbleRank,
  rssEntry: 40 as IdleBubbleRank
}

export type RssPetPushMinScore = 3 | 4 | 5

/** 默认「必读」才推宠物气泡。 */
export function normalizeRssPetPushMinScore(raw: unknown): RssPetPushMinScore {
  if (raw === 3 || raw === 4 || raw === 5) return raw
  if (raw === '3' || raw === '4' || raw === '5') return Number(raw) as RssPetPushMinScore
  return 5
}

export function rssPetPushMinScoreLabel(min: RssPetPushMinScore): string {
  if (min === 5) return uiText("必读")
  if (min === 3) return uiText("一般+")
  return uiText("值得看+")
}

export interface IdleChatterCandidate {
  text: string
  hint: string
  action?: BubbleAction
  rank: IdleBubbleRank
  /** 去重键：entry/digest/brief id */
  key?: string
}

export interface RssPetTipPayload {
  text: string
  hint: string
  conversationId: string
  entryId?: string
  digestId?: string
  rank: IdleBubbleRank
  key: string
}

/** 是否允许用 next 替换当前空闲气泡（防抽搐）。 */
export function canReplaceIdleBubble(opts: {
  now?: number
  currentRank: number
  currentShownAt: number
  nextRank: number
  force?: boolean
  minDwellMs?: number
}): boolean {
  if (opts.force) return true
  const now = opts.now ?? Date.now()
  const dwell = opts.minDwellMs ?? CHATTER_MIN_DWELL_MS
  if (opts.nextRank > opts.currentRank) return true
  if (opts.nextRank < opts.currentRank) return false
  return now - opts.currentShownAt >= dwell
}

/** agent 事件是否应清掉空闲碎碎念（忽略流式 delta，避免抽搐）。 */
export function agentEventShouldClearIdleChatter(event: {
  type: string
  state?: string
}): boolean {
  switch (event.type) {
    case 'state':
      return !!event.state && event.state !== 'idle'
    case 'tool':
    case 'command':
    case 'done':
    case 'error':
    case 'aborted':
      return true
    default:
      return false
  }
}

function compactTitle(title: string, max = 42): string {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function buildRssEntryPetTip(
  conversationId: string,
  entry: RssTaskEntry,
  score?: RssValueScore | null
): RssPetTipPayload {
  const label = rssScoreLabel(score)
  const src = (entry.feedTitle || 'RSS').trim().slice(0, 16)
  return {
    text: `📌 ${label} · ${src}：${compactTitle(entry.title || '无标题')}`,
    hint: uiText("点击打开这条资讯"),
    conversationId,
    entryId: entry.id,
    rank: IDLE_RANK.rssEntry,
    key: `entry:${conversationId}:${entry.id}`
  }
}

export function buildRssDigestPetTip(
  conversationId: string,
  digest: RssDigestRecord
): RssPetTipPayload {
  const title = compactTitle(digest.title || '新简报', 36)
  return {
    text: `📰 简报就绪：${title}`,
    hint: uiText("点击阅读简报"),
    conversationId,
    digestId: digest.id,
    rank: IDLE_RANK.rssDigest,
    key: `digest:${conversationId}:${digest.id}`
  }
}

function rssTipLiveFeeds(rss: { feeds?: { id?: string }[] }): Set<string> {
  return new Set((rss.feeds || []).map((f) => f.id).filter((id): id is string => Boolean(id)))
}

function rssTipEntryAllowed(
  it: RssTaskEntry,
  liveFeedIds: Set<string>,
  alreadyTipped: ReadonlySet<string>,
  conversationId: string,
  now: number
): boolean {
  if (!it?.id || !rssEntryIsUnread(it, now)) return false
  if (it.feedId && liveFeedIds.size && !liveFeedIds.has(it.feedId)) return false
  return !alreadyTipped.has(`entry:${conversationId}:${it.id}`)
}

/**
 * 从聊天存档挑一条尚未 tip 过的未读 / 新简报。
 * 优先达到阈值的评分条目；评分未出或关闭时推最近未评未读，避免整路哑掉。
 */
export function pickRssPetTip(
  store: ChatStore | null | undefined,
  minScore: RssPetPushMinScore,
  alreadyTipped: ReadonlySet<string>,
  now = Date.now()
): RssPetTipPayload | null {
  if (!store?.conversations?.length) return null

  let bestEntry: RssPetTipPayload | null = null
  let bestScore = 0
  let bestAt = 0

  for (const c of store.conversations) {
    if (c.kind !== 'rss' || !c.rss) continue
    const liveFeedIds = rssTipLiveFeeds(c.rss)
    for (const it of c.rss.items || []) {
      if (!rssTipEntryAllowed(it, liveFeedIds, alreadyTipped, c.id, now)) continue
      if (!isEntryValuable(it, minScore)) continue
      const score = (it.valueScore || 0) as RssValueScore
      const at = it.publishedAt || it.fetchedAt || 0
      if (
        !bestEntry ||
        score > bestScore ||
        (score === bestScore && at >= bestAt)
      ) {
        bestEntry = buildRssEntryPetTip(c.id, it, score)
        bestScore = score
        bestAt = at
      }
    }
  }
  if (bestEntry) return bestEntry

  let unscored: RssPetTipPayload | null = null
  let unscoredAt = 0
  for (const c of store.conversations) {
    if (c.kind !== 'rss' || !c.rss) continue
    const liveFeedIds = rssTipLiveFeeds(c.rss)
    for (const it of c.rss.items || []) {
      if (!rssTipEntryAllowed(it, liveFeedIds, alreadyTipped, c.id, now)) continue
      if ((it.valueScore || 0) > 0) continue
      const at = it.publishedAt || it.fetchedAt || 0
      if (!unscored || at >= unscoredAt) {
        unscored = buildRssEntryPetTip(c.id, it, it.valueScore)
        unscoredAt = at
      }
    }
  }
  if (unscored) return unscored

  let bestDigest: RssPetTipPayload | null = null
  let digestAt = 0
  for (const c of store.conversations) {
    if (c.kind !== 'rss' || !c.rss) continue
    for (const d of c.rss.digests || []) {
      if (!d?.id || !rssDigestIsUnread(d)) continue
      const key = `digest:${c.id}:${d.id}`
      if (alreadyTipped.has(key)) continue
      // 只推近 2 小时内生成的，避免历史简报刷屏
      if (now - d.createdAt > 2 * 60 * 60 * 1000) continue
      if (!bestDigest || d.createdAt >= digestAt) {
        bestDigest = buildRssDigestPetTip(c.id, d)
        digestAt = d.createdAt
      }
    }
  }
  return bestDigest
}

/** 气泡 action → 打开面板目标（供 Pet / 测试共用）。 */
export function rssPetTipToBubbleAction(tip: RssPetTipPayload): BubbleAction {
  return {
    kind: 'rss',
    conversationId: tip.conversationId,
    entryId: tip.entryId,
    digestId: tip.digestId
  }
}

export function rssTipOpenTarget(tip: Pick<RssPetTipPayload, 'conversationId' | 'entryId' | 'digestId'>): {
  panel: 'chat'
  conversationId: string
  rssEntryId?: string
  rssDigestId?: string
} {
  return {
    panel: 'chat',
    conversationId: tip.conversationId,
    rssEntryId: tip.entryId,
    rssDigestId: tip.digestId
  }
}

/** 对齐资讯 URL（去 hash、尾斜杠，host 小写）。 */
export function normalizeNewsUrl(url: string): string {
  const raw = url.trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase()
  }
}

export function findRssEntryByUrl(
  store: ChatStore | null | undefined,
  url: string
): { conversationId: string; entryId: string } | null {
  const key = normalizeNewsUrl(url)
  if (!key) return null
  let best: { conversationId: string; entryId: string; at: number } | null = null
  for (const c of store?.conversations || []) {
    if (c.kind !== 'rss' || !c.rss?.items?.length) continue
    for (const it of c.rss.items) {
      if (!it?.id || !it.url) continue
      if (normalizeNewsUrl(it.url) !== key) continue
      const at = it.publishedAt || it.fetchedAt || 0
      if (!best || at >= best.at) best = { conversationId: c.id, entryId: it.id, at }
    }
  }
  return best ? { conversationId: best.conversationId, entryId: best.entryId } : null
}

export function findLatestRssDigest(
  store: ChatStore | null | undefined,
  withinMs = 48 * 60 * 60 * 1000,
  now = Date.now()
): { conversationId: string; digestId: string } | null {
  let best: { conversationId: string; digestId: string; at: number } | null = null
  for (const c of store?.conversations || []) {
    if (c.kind !== 'rss' || !c.rss?.digests?.length) continue
    for (const d of c.rss.digests) {
      if (!d?.id) continue
      if (withinMs > 0 && now - d.createdAt > withinMs) continue
      if (!best || d.createdAt >= best.at) {
        best = { conversationId: c.id, digestId: d.id, at: d.createdAt }
      }
    }
  }
  return best ? { conversationId: best.conversationId, digestId: best.digestId } : null
}

function findLatestRssConversationId(store: ChatStore | null | undefined): string | undefined {
  let bestId: string | undefined
  let bestAt = 0
  for (const c of store?.conversations || []) {
    if (c.kind !== 'rss') continue
    const at = c.updatedAt || c.rss?.updatedAt || 0
    if (!bestId || at >= bestAt) {
      bestId = c.id
      bestAt = at
    }
  }
  return bestId
}

/** 最近一条未读 RSS 新闻（资讯气泡点进去应对齐新闻，不是简报页）。 */
export function findLatestUnreadRssEntry(
  store: ChatStore | null | undefined,
  now = Date.now()
): { conversationId: string; entryId: string } | null {
  let best: { conversationId: string; entryId: string; at: number } | null = null
  for (const c of store?.conversations || []) {
    if (c.kind !== 'rss' || !c.rss?.items?.length) continue
    for (const it of c.rss.items) {
      if (!it?.id || !rssEntryIsUnread(it, now)) continue
      const at = it.publishedAt || it.fetchedAt || 0
      if (!best || at >= best.at) best = { conversationId: c.id, entryId: it.id, at }
    }
  }
  return best ? { conversationId: best.conversationId, entryId: best.entryId } : null
}

/**
 * 资讯气泡点击目标：对齐 RSS **新闻**条目 / 新闻列表。
 * 有 briefId 或收件箱顶条时按 URL 对齐条目；绝不因为「有简报记录」就落到简报页
 * （简报气泡走 kind:'rss' + digestId）。
 */
export function resolveNewsBubbleOpenTarget(opts: {
  store: ChatStore | null | undefined
  inbox?: BriefInbox | null
  briefId?: string
  now?: number
}): OpenPanelTarget {
  const store = opts.store
  const inbox = opts.inbox
  const briefId = opts.briefId?.trim()
  const now = opts.now ?? Date.now()

  if (briefId && inbox?.items?.length) {
    const item = inbox.items.find((x) => x.id === briefId)
    if (item?.url) {
      const hit = findRssEntryByUrl(store, item.url)
      if (hit) {
        return {
          panel: 'chat',
          conversationId: hit.conversationId,
          rssEntryId: hit.entryId
        }
      }
    }
  }

  if (inbox) {
    const top = topUnreadBrief(inbox)
    if (top?.url) {
      const hit = findRssEntryByUrl(store, top.url)
      if (hit) {
        return {
          panel: 'chat',
          conversationId: hit.conversationId,
          rssEntryId: hit.entryId
        }
      }
    }
  }

  const unread = findLatestUnreadRssEntry(store, now)
  if (unread) {
    return {
      panel: 'chat',
      conversationId: unread.conversationId,
      rssEntryId: unread.entryId
    }
  }

  const rssId = findLatestRssConversationId(store)
  if (rssId) {
    return { panel: 'chat', conversationId: rssId, rssExitDigest: true }
  }

  return { panel: 'chat', section: 'new-rss' }
}

export function resolveRssPetPushMin(settings: Pick<Settings, 'rssPetPushMinScore'>): RssPetPushMinScore {
  return normalizeRssPetPushMinScore(settings.rssPetPushMinScore)
}

/** 选中简报时写入的 selectedId。 */
export function rssDigestSelectedId(digestId: string): string {
  return rssDigestThreadId(digestId)
}
