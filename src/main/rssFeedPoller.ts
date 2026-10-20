/**
 * 主进程 RSS 源轮询：CPET 启动即跑，不依赖打开对话窗或进入 RSS 任务。
 */
import { getChatStore, getSettings, saveChatStore } from './store'
import { refreshRssTaskFeeds } from './rssTask'
import { scoreRssEntries } from './rssIntelligence'
import { scanAndEmitRssPetTips } from './rssPetTips'
import {
  applyRssFeedPollToState,
  listDueRssFeedPolls
} from '../shared/rssFeedPoll'
import {
  applyRssBodyPatches,
  applyRssEntryScores,
  entriesNeedingScore,
  normalizeRssScoreMode
} from '../shared/rssTask'
import type { ChatStore } from '../shared/types'

const HEARTBEAT_MS = 60_000
/** 启动后稍等再拉，避开开机抢网；仍远早于必须点进任务。 */
const START_DELAY_MS = 4_000

type StoreEmitter = (store: ChatStore) => void

let heartbeat: ReturnType<typeof setInterval> | null = null
let startTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let emitStore: StoreEmitter | null = null
const lastFetchedAt: Record<string, number> = {}

export function setRssFeedPollEmitter(fn: StoreEmitter | null): void {
  emitStore = fn
}

function globals(): { scoreMode?: unknown; intervalMinutes?: unknown } {
  const s = getSettings()
  return {
    scoreMode: s.rssScoreMode,
    intervalMinutes: s.rssScoreIntervalMinutes
  }
}

function publish(store: ChatStore): void {
  emitStore?.(store)
  scanAndEmitRssPetTips(store)
}

async function refreshOne(conversationId: string, now: number): Promise<void> {
  const store = getChatStore()
  const conv = store?.conversations.find((c) => c.id === conversationId)
  if (!conv || conv.kind !== 'rss' || !conv.rss?.feeds.length) return
  const res = await refreshRssTaskFeeds(conv.rss.feeds)
  const latest = getChatStore()
  if (!latest) return
  const cur = latest.conversations.find((c) => c.id === conversationId)
  if (!cur?.rss) return
  const nextRss = applyRssFeedPollToState(cur.rss, res, now)
  const next: ChatStore = {
    ...latest,
    conversations: latest.conversations.map((c) =>
      c.id === conversationId ? { ...c, rss: nextRss, updatedAt: now } : c
    )
  }
  saveChatStore(next)
  lastFetchedAt[conversationId] = now
  publish(next)

  const mode = normalizeRssScoreMode(cur.rss.scoreMode ?? getSettings().rssScoreMode)
  if (cur.rss.scoreEnabled === false || mode === 'off') return
  const need = entriesNeedingScore(nextRss, 40)
  if (!need.length) return
  const scored = await scoreRssEntries({
    entries: need,
    modelRef: cur.rss.scoreModelRef || getSettings().rssScoreModelRef
  })
  const after = getChatStore()
  if (!after) return
  const live = after.conversations.find((c) => c.id === conversationId)
  if (!live?.rss) return
  let rss = live.rss
  if (scored.bodyPatches?.length) rss = applyRssBodyPatches(rss, scored.bodyPatches)
  rss = applyRssEntryScores(rss, scored.scores)
  const scoredStore: ChatStore = {
    ...after,
    conversations: after.conversations.map((c) =>
      c.id === conversationId ? { ...c, rss, updatedAt: Date.now() } : c
    )
  }
  saveChatStore(scoredStore)
  publish(scoredStore)
}

export async function tickRssFeedPolls(force = false): Promise<void> {
  if (running) return
  running = true
  try {
    const now = Date.now()
    const due = listDueRssFeedPolls(
      getChatStore(),
      force ? {} : lastFetchedAt,
      globals(),
      now
    )
    for (const item of due) {
      try {
        await refreshOne(item.conversationId, Date.now())
      } catch {
        lastFetchedAt[item.conversationId] = Date.now()
      }
    }
  } finally {
    running = false
  }
}

export function startRssFeedPoller(): void {
  if (startTimer) clearTimeout(startTimer)
  if (heartbeat) clearInterval(heartbeat)
  scanAndEmitRssPetTips(getChatStore())
  startTimer = setTimeout(() => {
    startTimer = null
    void tickRssFeedPolls(true)
  }, START_DELAY_MS)
  heartbeat = setInterval(() => void tickRssFeedPolls(false), HEARTBEAT_MS)
}

export function stopRssFeedPoller(): void {
  if (startTimer) {
    clearTimeout(startTimer)
    startTimer = null
  }
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

/** 测试用：清本进程已拉时间。 */
export function resetRssFeedPollerState(): void {
  for (const k of Object.keys(lastFetchedAt)) delete lastFetchedAt[k]
}
