/** 桌宠资讯收件箱：自动拉取浅条目，轻打扰；升级才进对话。 */

export type BriefSource = 'hn' | 'v2ex' | 'rss'

export type BriefFetchStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error'

export interface BriefItem {
  id: string
  title: string
  url: string
  source: BriefSource
  fetchedAt: number
  /** 源站浅摘要（RSS description 等），不是全文。 */
  snippet?: string
  /** RSS 等自定义源的展示名。 */
  sourceLabel?: string
  readAt?: number
  dismissedAt?: number
  /** 钉住：置顶，且「清」未读时保留未读感（不强制已读）。 */
  pinnedAt?: number
}

export interface BriefInbox {
  items: BriefItem[]
  updatedAt: number
  status: BriefFetchStatus
  /** 最近一次拉取失败原因（有缓存条目时也可能带上）。 */
  lastError?: string
  /** 当前兴趣词（主进程回显，供角标/digest 过滤）。 */
  interestKeywords?: string[]
  /** 屏蔽词：命中则不进未读/digest。 */
  muteKeywords?: string[]
}

export const EMPTY_BRIEF_INBOX: BriefInbox = { items: [], updatedAt: 0, status: 'idle' }

/** 规范化单个每日 digest 小时；非法则关闭。 */
export function normalizeBriefDailyDigestHour(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 23) return null
  return n
}

/**
 * 规范化每日多选整点（0–23，升序去重）。
 * 空数组 / 全非法 → null（关闭）。
 * 兼容旧字段 briefDailyDigestHour（单点）。
 */
export function normalizeBriefDailyDigestHours(
  raw: unknown,
  legacyHour?: unknown
): number[] | null {
  if (Array.isArray(raw)) {
    const unique = [
      ...new Set(
        raw
          .map((x) => normalizeBriefDailyDigestHour(x))
          .filter((x): x is number => x != null)
      )
    ].sort((a, b) => a - b)
    return unique.length ? unique : null
  }
  if (raw === null) return null
  const one = normalizeBriefDailyDigestHour(raw ?? legacyHour)
  if (one != null) return [one]
  const legacy = normalizeBriefDailyDigestHour(legacyHour)
  return legacy != null ? [legacy] : null
}

export function formatBriefDailyDigestHoursLabel(hours: number[] | null | undefined): string {
  if (!hours?.length) return '关'
  return hours.map((h) => `${h}:00`).join('、')
}

export function toggleBriefDailyDigestHour(
  hours: number[] | null | undefined,
  hour: number
): number[] | null {
  const h = normalizeBriefDailyDigestHour(hour)
  if (h == null) return normalizeBriefDailyDigestHours(hours)
  const cur = new Set(normalizeBriefDailyDigestHours(hours) || [])
  if (cur.has(h)) cur.delete(h)
  else cur.add(h)
  const next = [...cur].sort((a, b) => a - b)
  return next.length ? next : null
}

/** 调度键：本地日 + 小时，用于「当天每个选中整点各播一次」。 */
export function briefDigestScheduleKey(day: string, hour: number): string {
  return `${day}@${hour}`
}

const MAX_ITEMS = 24
const MAX_KEYWORDS = 12

/** 规范化兴趣/屏蔽词：逗号/换行分隔，小写去重。 */
export function normalizeInterestKeywords(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map((x) => (typeof x === 'string' ? x : ''))
    : typeof raw === 'string'
      ? raw.split(/[,，\n]/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const k = p.trim()
    if (k.length < 2 || k.length > 32) continue
    const key = k.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
    if (out.length >= MAX_KEYWORDS) break
  }
  return out
}

/** @deprecated 与 normalizeInterestKeywords 相同，留给屏蔽词语义。 */
export const normalizeMuteKeywords = normalizeInterestKeywords

export function briefItemKey(source: BriefSource, rawId: string | number): string {
  if (source === 'rss' && typeof rawId === 'string' && rawId.startsWith('rss:')) return rawId
  return `${source}:${rawId}`
}

export function briefMatchesInterest(item: BriefItem, keywords: string[]): boolean {
  if (!keywords.length) return true
  const hay = `${item.title}\n${item.snippet || ''}\n${item.sourceLabel || ''}`.toLowerCase()
  return keywords.some((k) => hay.includes(k.toLowerCase()))
}

/** 是否计入未读/digest：未命中屏蔽，且（无兴趣词或命中兴趣）。 */
export function briefIsActionable(
  item: BriefItem,
  interest: string[] = [],
  mute: string[] = []
): boolean {
  if (mute.length && briefMatchesInterest(item, mute)) return false
  if (interest.length && !briefMatchesInterest(item, interest)) return false
  return true
}

/** 合并新拉取条目；保留已有 read/dismiss/pin；按 pin+fetchedAt。 */
export function mergeBriefItems(prev: BriefItem[], incoming: BriefItem[], limit = MAX_ITEMS): BriefItem[] {
  const byId = new Map<string, BriefItem>()
  for (const it of prev) {
    if (it?.id) byId.set(it.id, it)
  }
  for (const it of incoming) {
    if (!it?.id) continue
    const old = byId.get(it.id)
    if (old) {
      byId.set(it.id, {
        ...old,
        title: it.title || old.title,
        url: it.url || old.url,
        snippet: it.snippet || old.snippet,
        sourceLabel: it.sourceLabel || old.sourceLabel,
        source: it.source || old.source,
        fetchedAt: Math.max(old.fetchedAt, it.fetchedAt)
      })
    } else {
      byId.set(it.id, it)
    }
  }
  return [...byId.values()]
    .sort((a, b) => {
      const ap = a.pinnedAt ? 1 : 0
      const bp = b.pinnedAt ? 1 : 0
      if (ap !== bp) return bp - ap
      return b.fetchedAt - a.fetchedAt
    })
    .slice(0, limit)
}

/**
 * 全新且不可行动（不匹配兴趣 / 命中屏蔽）的条目自动标已读。
 * 钉住的不自动已读；已有条目状态不动。
 */
export function applyInterestAutoRead(
  prev: BriefItem[],
  merged: BriefItem[],
  interest: string[],
  at = Date.now(),
  mute: string[] = []
): BriefItem[] {
  if (!interest.length && !mute.length) return merged
  const prevIds = new Set(prev.map((x) => x.id))
  return merged.map((it) => {
    if (prevIds.has(it.id) || it.readAt || it.dismissedAt || it.pinnedAt) return it
    if (briefIsActionable(it, interest, mute)) return it
    return { ...it, readAt: at }
  })
}

/** 设置兴趣/屏蔽词后：把当前不可行动的未读标已读（钉住除外）。 */
export function reapplyBriefFilters(
  inbox: BriefInbox,
  interest: string[],
  mute: string[],
  at = Date.now()
): BriefInbox {
  if (!interest.length && !mute.length) {
    return { ...inbox, interestKeywords: interest, muteKeywords: mute }
  }
  return {
    ...inbox,
    interestKeywords: interest,
    muteKeywords: mute,
    updatedAt: at,
    items: inbox.items.map((it) => {
      if (it.readAt || it.dismissedAt || it.pinnedAt) return it
      if (briefIsActionable(it, interest, mute)) return it
      return { ...it, readAt: at }
    })
  }
}

export function briefUnreadCount(
  inbox: BriefInbox,
  interest = inbox.interestKeywords || [],
  mute = inbox.muteKeywords || []
): number {
  return inbox.items.filter((x) => {
    if (x.readAt || x.dismissedAt) return false
    return briefIsActionable(x, interest, mute)
  }).length
}

export function markBriefRead(inbox: BriefInbox, id: string, at = Date.now()): BriefInbox {
  return {
    ...inbox,
    updatedAt: at,
    items: inbox.items.map((x) => (x.id === id ? { ...x, readAt: x.readAt || at } : x))
  }
}

export function markAllBriefRead(inbox: BriefInbox, at = Date.now()): BriefInbox {
  // 钉住的条目不清成已读，避免「重要跟进」被一键清掉
  return {
    ...inbox,
    updatedAt: at,
    items: inbox.items.map((x) => (x.readAt || x.pinnedAt ? x : { ...x, readAt: at }))
  }
}

export function dismissBriefItem(inbox: BriefInbox, id: string, at = Date.now()): BriefInbox {
  return {
    ...inbox,
    updatedAt: at,
    items: inbox.items.map((x) =>
      x.id === id ? { ...x, dismissedAt: at, pinnedAt: undefined } : x
    )
  }
}

export function toggleBriefPin(inbox: BriefInbox, id: string, at = Date.now()): BriefInbox {
  return {
    ...inbox,
    updatedAt: at,
    items: inbox.items.map((x) => {
      if (x.id !== id) return x
      if (x.pinnedAt) return { ...x, pinnedAt: undefined }
      return { ...x, pinnedAt: at, dismissedAt: undefined, readAt: undefined }
    })
  }
}

/** UI 可见条目：钉住优先。 */
export function visibleBriefItems(inbox: BriefInbox, limit = 8): BriefItem[] {
  return inbox.items
    .filter((x) => !x.dismissedAt)
    .sort((a, b) => {
      const ap = a.pinnedAt ? 1 : 0
      const bp = b.pinnedAt ? 1 : 0
      if (ap !== bp) return bp - ap
      return b.fetchedAt - a.fetchedAt
    })
    .slice(0, limit)
}

/**
 * 面板列表：默认只展示未读+钉住（小窗降噪）；
 * 若没有可跟进项则回退到最近条目，避免空面板误导。
 */
export function panelBriefItems(inbox: BriefInbox, showAll: boolean, limit = 6): BriefItem[] {
  const all = visibleBriefItems(inbox, 24)
  if (showAll) return all.slice(0, limit)
  const focus = all.filter((x) => !x.readAt || x.pinnedAt)
  return (focus.length ? focus : all).slice(0, limit)
}

export function briefSourceLabel(item: BriefItem | BriefSource, sourceLabel?: string): string {
  if (typeof item === 'string') {
    if (item === 'v2ex') return 'V2EX'
    if (item === 'rss') return sourceLabel?.trim() || 'RSS'
    return 'HN'
  }
  if (item.source === 'v2ex') return 'V2EX'
  if (item.source === 'rss') return item.sourceLabel?.trim() || 'RSS'
  return 'HN'
}

export function buildBriefEscalatePrompt(item: BriefItem): string {
  const tag = briefSourceLabel(item)
  const snip = item.snippet?.trim()
    ? `\n摘要：${item.snippet.trim().slice(0, 200)}\n`
    : '\n'
  return (
    `【资讯 · ${tag}】\n` +
    `标题：${item.title}\n` +
    `链接：${item.url}` +
    snip +
    `\n请用三句话总结要点，并说明是否值得我跟进；不要编造链接/摘要里没有的事实。`
  )
}

export function buildBriefCompareFallbackNote(): string {
  return (
    '【未能开对比】当前启用的模型不足 2 个，已改为普通对话。' +
    '请到「设置 → 模型」至少启用两个模型后，再从简报点「比」。\n\n'
  )
}

export function listActionableUnread(
  inbox: BriefInbox,
  limit = 5,
  interest = inbox.interestKeywords || [],
  mute = inbox.muteKeywords || []
): BriefItem[] {
  return inbox.items
    .filter((x) => !x.readAt && !x.dismissedAt && briefIsActionable(x, interest, mute))
    .sort((a, b) => {
      const ap = a.pinnedAt ? 1 : 0
      const bp = b.pinnedAt ? 1 : 0
      if (ap !== bp) return bp - ap
      return b.fetchedAt - a.fetchedAt
    })
    .slice(0, limit)
}

export function topUnreadBrief(
  inbox: BriefInbox,
  interest = inbox.interestKeywords || [],
  mute = inbox.muteKeywords || []
): BriefItem | null {
  return listActionableUnread(inbox, 1, interest, mute)[0] || null
}

/** 拉取后轻气泡：条数 + 最多两条标题，不进对话。 */
export function buildBriefDigestBubble(
  inbox: BriefInbox,
  interest = inbox.interestKeywords || [],
  mute = inbox.muteKeywords || []
): { text: string; hint: string; briefId?: string } | null {
  const unread = listActionableUnread(inbox, 8, interest, mute)
  if (!unread.length) return null
  const tops = unread.slice(0, 2).map((x) => `· ${x.title.slice(0, 36)}`)
  const filterNote = interest.length ? `（兴趣：${interest.slice(0, 3).join('·')}）` : ''
  return {
    text: `🗞 ${unread.length} 条新简报${filterNote}\n${tops.join('\n')}`,
    hint: '点击打开对应资讯 / 简报页',
    briefId: unread[0]?.id
  }
}

/** 多条未读合成一条升级草稿。 */
export function buildBriefBatchEscalatePrompt(items: BriefItem[]): string {
  if (!items.length) return ''
  if (items.length === 1) return buildBriefEscalatePrompt(items[0])
  const blocks = items.map((it, i) => {
    const tag = briefSourceLabel(it)
    const snip = it.snippet?.trim() ? `\n  摘要：${it.snippet.trim().slice(0, 120)}` : ''
    return `${i + 1}. 【${tag}】${it.title}\n  链接：${it.url}${snip}`
  })
  return (
    `【资讯简报 · ${items.length} 条】\n` +
    blocks.join('\n') +
    `\n\n请逐条用一两句话点评是否值得跟进，最后给一个「今天优先看哪 1～2 条」的建议；不要编造链接/摘要里没有的事实。`
  )
}

export function formatBriefUpdatedAt(at: number): string {
  if (!at) return ''
  try {
    return new Date(at).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch {
    return ''
  }
}

export function briefStatusLine(inbox: BriefInbox): string {
  const when = formatBriefUpdatedAt(inbox.updatedAt)
  const tail = when ? ` · ${when}` : ''
  switch (inbox.status) {
    case 'loading':
      return '正在拉取简报…'
    case 'error':
      return (inbox.lastError?.trim() || '拉取失败：网络不通或源不可用') + tail
    case 'empty':
      return '暂无新条目。可换新闻源、加 RSS，或设兴趣词' + tail
    case 'ok': {
      const kw = inbox.interestKeywords?.length
        ? ` · 兴趣 ${inbox.interestKeywords.slice(0, 3).join('/')}`
        : ''
      return inbox.lastError?.trim()
        ? `部分源失败：${inbox.lastError}${tail}`
        : `浅条目 · 问/比进 Agent${kw}${tail}`
    }
    default:
      return '简报尚未刷新'
  }
}
