/**
 * RSS 源后台轮询：跟「有没有打开 RSS 任务页」无关。
 * 主进程按此决定何时拉源；渲染层只负责把结果合进当前会话，不抢选中条目。
 */
import type { ChatStore, Conversation } from './types'
import {
  joinRssFeedErrors,
  mergeRssTaskItems,
  normalizeRssScoreIntervalMinutes,
  normalizeRssScoreMode,
  reconcileRssEntrySources,
  RSS_REALTIME_FETCH_MS,
  type RssTaskEntry,
  type RssTaskFeed,
  type RssTaskState
} from './rssTask'

export type RssFeedPollGlobals = {
  scoreMode?: unknown
  intervalMinutes?: unknown
}

/** 关闭评分仍按实时节奏拉源（只是不打分）；定时跟评分间隔。 */
export function resolveRssFeedPollIntervalMs(
  opts: {
    taskScoreMode?: unknown
    taskIntervalMinutes?: unknown
    globalScoreMode?: unknown
    globalIntervalMinutes?: unknown
  }
): number | null {
  const mode = normalizeRssScoreMode(opts.taskScoreMode ?? opts.globalScoreMode)
  if (mode === 'interval') {
    const mins = normalizeRssScoreIntervalMinutes(
      opts.taskIntervalMinutes ?? opts.globalIntervalMinutes
    )
    return Math.max(60_000, mins * 60_000)
  }
  return RSS_REALTIME_FETCH_MS
}

export function rssFeedPollIsDue(
  lastFetchedAt: number | undefined,
  intervalMs: number,
  now = Date.now()
): boolean {
  if (lastFetchedAt == null || !Number.isFinite(lastFetchedAt)) return true
  return now - lastFetchedAt >= intervalMs
}

export function listDueRssFeedPolls(
  store: ChatStore | null | undefined,
  lastFetchedAt: Record<string, number>,
  globals: RssFeedPollGlobals,
  now = Date.now()
): { conversationId: string; intervalMs: number }[] {
  const out: { conversationId: string; intervalMs: number }[] = []
  if (!store?.conversations?.length) return out
  for (const c of store.conversations) {
    if (c.kind !== 'rss' || !c.rss?.feeds?.length) continue
    const intervalMs = resolveRssFeedPollIntervalMs({
      taskScoreMode: c.rss.scoreMode,
      taskIntervalMinutes: c.rss.scoreIntervalMinutes,
      globalScoreMode: globals.scoreMode,
      globalIntervalMinutes: globals.intervalMinutes
    })
    if (intervalMs == null || !rssFeedPollIsDue(lastFetchedAt[c.id], intervalMs, now)) continue
    out.push({ conversationId: c.id, intervalMs })
  }
  return out
}

export function applyRssFeedPollToState(
  rss: RssTaskState,
  res: { feeds: RssTaskFeed[]; items: RssTaskEntry[]; errors: string[] },
  now = Date.now()
): RssTaskState {
  const feeds = res.feeds.length ? res.feeds : rss.feeds
  return reconcileRssEntrySources({
    ...rss,
    feeds,
    items: mergeRssTaskItems(rss.items, res.items),
    updatedAt: now,
    lastError: res.errors.length ? joinRssFeedErrors(res.errors) : undefined
  })
}

/**
 * 对话窗 500ms 整包落盘时：条目与磁盘并集，避免刚后台拉到的新条目被旧内存盖掉。
 * 源列表、选中条、简报仍跟渲染层（用户正在改这些）。
 */
export function reconcileRssOnChatStoreSave(
  incoming: ChatStore,
  disk: ChatStore | null | undefined
): ChatStore {
  if (!disk?.conversations?.length || !incoming?.conversations?.length) return incoming
  const diskById = new Map(disk.conversations.map((c) => [c.id, c]))
  let changed = false
  const conversations = incoming.conversations.map((c) => {
    const d = diskById.get(c.id)
    if (c.kind !== 'rss' || !c.rss || !d?.rss) return c
    const items = mergeRssTaskItems(c.rss.items, d.rss.items)
    const incomingIds = new Set(c.rss.items.map((i) => i.id))
    const gained = items.some((i) => !incomingIds.has(i.id))
    if (!gained && items.length === c.rss.items.length) return c
    changed = true
    return {
      ...c,
      rss: {
        ...c.rss,
        items,
        updatedAt: Math.max(c.rss.updatedAt || 0, d.rss.updatedAt || 0)
      }
    }
  })
  return changed ? { ...incoming, conversations } : incoming
}

/** 只覆盖源/条目，保留阅读位置、简报、讨论等 UI 状态。 */
export function mergeRssFeedPollConversations(
  current: Conversation[],
  incoming: Conversation[]
): Conversation[] {
  const patch = new Map<string, Conversation>()
  for (const c of incoming) {
    if (c.kind === 'rss' && c.rss) patch.set(c.id, c)
  }
  if (!patch.size) return current
  let changed = false
  const next = current.map((c) => {
    const src = patch.get(c.id)
    if (!src?.rss || c.kind !== 'rss' || !c.rss) return c
    if (
      c.rss.updatedAt === src.rss.updatedAt &&
      c.rss.items === src.rss.items &&
      c.rss.feeds === src.rss.feeds &&
      c.rss.lastError === src.rss.lastError
    ) {
      return c
    }
    changed = true
    return {
      ...c,
      rss: {
        ...c.rss,
        feeds: src.rss.feeds,
        items: src.rss.items,
        lastError: src.rss.lastError,
        updatedAt: src.rss.updatedAt
      },
      updatedAt: src.updatedAt
    }
  })
  return changed ? next : current
}
