/** RSS 源列表排序：发现（热度/新鲜度）与已订阅（均分/最新/未读）。 */

import type { RssTaskFeed, RssTaskState } from './rssTask'
import { rssTaskFeedUnread } from './rssTask'

export type RssDiscoverSort = 'default' | 'hot' | 'fresh'
export type RssSubscribedSort = 'score' | 'fresh' | 'unread'

export const RSS_DISCOVER_SORTS: ReadonlyArray<{
  id: RssDiscoverSort
  label: string
  /** 按钮上展示的指标名 */
  metric: string
}> = [
  { id: 'default', label: '默认', metric: '推荐序' },
  /** 订阅数来自 Feedly；RSSHub/多数中文源通常没有，空数据时排序近似无效。 */
  { id: 'hot', label: '最火', metric: 'Feedly' },
  { id: 'fresh', label: '最新', metric: '更新时间' }
]

export const RSS_SUBSCRIBED_SORTS: ReadonlyArray<{
  id: RssSubscribedSort
  label: string
  metric: string
}> = [
  { id: 'score', label: '均分', metric: '评分' },
  { id: 'fresh', label: '最新', metric: '更新' },
  { id: 'unread', label: '未读', metric: '条数' }
]

/** 订阅人数展示：12.3k / 1.2M */
export function formatRssSubscribers(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** 相对时间短标签 */
export function formatRssRelativeShort(at: number, now = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  const diff = now - at
  if (diff < 0) return '刚刚'
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  if (diff < 30 * 86400_000) return `${Math.floor(diff / (7 * 86400_000))} 周前`
  return new Date(at).toLocaleDateString()
}

export type RssDiscoverSortable = {
  name: string
  url: string
  source?: 'preset' | 'remote'
  subscribers?: number
  updatedAt?: number
}

export function normalizeRssDiscoverSort(raw: unknown): RssDiscoverSort {
  if (raw === 'hot' || raw === 'fresh' || raw === 'default') return raw
  return 'default'
}

export function normalizeRssSubscribedSort(raw: unknown): RssSubscribedSort {
  if (raw === 'fresh' || raw === 'unread' || raw === 'score') return raw
  return 'score'
}

function nameKey(name: string, url: string): string {
  return (name || url || '').toLocaleLowerCase()
}

/** 发现/目录条目排序。 */
export function sortRssDiscoverItems<T extends RssDiscoverSortable>(
  items: readonly T[],
  mode: RssDiscoverSort
): T[] {
  const list = [...items]
  if (mode === 'hot') {
    return list.sort((a, b) => {
      const as = typeof a.subscribers === 'number' ? a.subscribers : -1
      const bs = typeof b.subscribers === 'number' ? b.subscribers : -1
      if (as !== bs) return bs - as
      // 有订阅数的远程源优先于无数据的本地条目
      const ar = a.source === 'remote' ? 1 : 0
      const br = b.source === 'remote' ? 1 : 0
      if (ar !== br) return br - ar
      return nameKey(a.name, a.url).localeCompare(nameKey(b.name, b.url), 'zh')
    })
  }
  if (mode === 'fresh') {
    return list.sort((a, b) => {
      const at = typeof a.updatedAt === 'number' ? a.updatedAt : 0
      const bt = typeof b.updatedAt === 'number' ? b.updatedAt : 0
      if (at !== bt) return bt - at
      const as = typeof a.subscribers === 'number' ? a.subscribers : -1
      const bs = typeof b.subscribers === 'number' ? b.subscribers : -1
      if (as !== bs) return bs - as
      return nameKey(a.name, a.url).localeCompare(nameKey(b.name, b.url), 'zh')
    })
  }
  // 默认：远程在前（发现合并序），再按名称；调用方若已定序可传 default 保持近似输入序
  return list
}

/** 已订阅源：某 feed 最近一条的时间。 */
export function rssFeedLastActivityAt(
  state: RssTaskState | undefined,
  feedId: string
): number {
  if (!state?.items?.length || !feedId) return 0
  let max = 0
  for (const it of state.items) {
    if (it.feedId !== feedId) continue
    const t = it.publishedAt || it.fetchedAt || 0
    if (t > max) max = t
  }
  return max
}

/** 已订阅列表排序。 */
export function sortRssSubscribedFeeds(
  feeds: readonly RssTaskFeed[],
  state: RssTaskState | undefined,
  mode: RssSubscribedSort
): RssTaskFeed[] {
  const list = [...feeds]
  if (mode === 'unread') {
    return list.sort((a, b) => {
      const au = state ? rssTaskFeedUnread(state, a.id) : 0
      const bu = state ? rssTaskFeedUnread(state, b.id) : 0
      if (au !== bu) return bu - au
      const as = a.avgScore || 0
      const bs = b.avgScore || 0
      if (as !== bs) return bs - as
      return (a.title || a.url || '').localeCompare(b.title || b.url || '', 'zh')
    })
  }
  if (mode === 'fresh') {
    return list.sort((a, b) => {
      const at = rssFeedLastActivityAt(state, a.id)
      const bt = rssFeedLastActivityAt(state, b.id)
      if (at !== bt) return bt - at
      const as = a.avgScore || 0
      const bs = b.avgScore || 0
      if (as !== bs) return bs - as
      return (a.title || a.url || '').localeCompare(b.title || b.url || '', 'zh')
    })
  }
  return list.sort((a, b) => {
    const as = a.avgScore || 0
    const bs = b.avgScore || 0
    if (as !== bs) return bs - as
    return (a.title || a.url || '').localeCompare(b.title || b.url || '', 'zh')
  })
}
