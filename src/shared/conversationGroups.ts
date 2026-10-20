/** 任务侧栏自定义分组：normalize / 分区 / 增删改移（纯函数）。 */

import type {
  ChatStore,
  Conversation,
  ConversationGroup,
  TodayHeldDone,
  TodayMemo
} from './types'

const MAX_GROUPS = 40
const MAX_GROUP_NAME = 40

/** 侧栏默认任务区编辑用伪 id（非真实 ConversationGroup）。 */
export const UNGROUPED_SECTION_ID = '__ungrouped__'
/** 无自定义分组时的默认区名（可点改；旧档未存标签会落到此名）。 */
export const DEFAULT_UNGROUPED_LABEL = '日常'

export type ConversationGroupSection = {
  group: ConversationGroup
  conversations: Conversation[]
}

export type ConversationPartition = {
  /** 置顶任务（按最近活动排序）。 */
  pinned: Conversation[]
  ungrouped: Conversation[]
  sections: ConversationGroupSection[]
}

/** 同组内：越晚越前。 */
export function sortConversationsByRecent(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const du = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (du !== 0) return du
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
}

/**
 * 距现在的短时间戳：12s / 5m / 3h / 2d（再久用 d）。
 */
export function formatConversationAge(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const sec = Math.max(0, Math.floor((now - ts) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

export function setConversationPinned(
  conversations: Conversation[],
  conversationId: string,
  pinned: boolean,
  at = Date.now()
): Conversation[] {
  return conversations.map((c) => {
    if (c.id !== conversationId) return c
    if (pinned) {
      if (c.pinnedAt) return c
      return { ...c, pinnedAt: at, updatedAt: Math.max(c.updatedAt || 0, at) }
    }
    if (!c.pinnedAt) return c
    const { pinnedAt: _drop, ...rest } = c
    return rest
  })
}

function asTrimmedName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, MAX_GROUP_NAME)
}

/** 规范化未分组区显示名。 */
export function normalizeUngroupedLabel(raw: unknown): string {
  return asTrimmedName(raw) || DEFAULT_UNGROUPED_LABEL
}

/** 规范化分组列表：去重、裁剪名称、按 order 排序。旧存档无字段 → []。 */
export function normalizeConversationGroups(raw: unknown): ConversationGroup[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ConversationGroup[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!id || seen.has(id)) continue
    const name = asTrimmedName(rec.name) || '未命名分组'
    const orderRaw = rec.order
    const order =
      typeof orderRaw === 'number' && Number.isFinite(orderRaw)
        ? orderRaw
        : out.length
    seen.add(id)
    out.push({ id, name, order })
    if (out.length >= MAX_GROUPS) break
  }
  out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return out.map((g, i) => ({ ...g, order: i }))
}

/** 清掉指向已删分组的 groupId；空串视为未分组。 */
export function sanitizeConversationGroupId(
  c: Conversation,
  validGroupIds: ReadonlySet<string>
): Conversation {
  const gid = typeof c.groupId === 'string' ? c.groupId.trim() : ''
  if (gid && validGroupIds.has(gid)) {
    return c.groupId === gid ? c : { ...c, groupId: gid }
  }
  if (c.groupId === undefined) return c
  const { groupId: _drop, ...rest } = c
  return rest
}

/**
 * 兼容旧 chat-store：无 groups / 无 groupId 也能加载。
 * 返回的 groups 恒为数组（可空）。
 */
function finiteTs(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined
}

function readTodayMemos(raw: unknown): TodayMemo[] {
  if (!Array.isArray(raw)) return []
  const out: TodayMemo[] = []
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
      title: (title || body.slice(0, 24)).slice(0, 80),
      body: body.slice(0, 600),
      createdAt
    }
    if (o.kind === 'log' || o.kind === 'remind') memo.kind = o.kind
    const remindAt = finiteTs(o.remindAt)
    const completedAt = finiteTs(o.completedAt)
    const durationMs = finiteTs(o.durationMs)
    const firedAt = finiteTs(o.firedAt)
    if (remindAt) memo.remindAt = remindAt
    if (completedAt) memo.completedAt = completedAt
    if (durationMs) memo.durationMs = durationMs
    if (firedAt) memo.firedAt = firedAt
    out.push(memo)
    if (out.length >= 120) break
  }
  return out
}

function readLaneOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const it of raw) {
    if (typeof it !== 'string') continue
    const id = it.trim()
    if (!id || id === 'all' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function readHeldDones(raw: unknown): TodayHeldDone[] {
  if (!Array.isArray(raw)) return []
  const out: TodayHeldDone[] = []
  const seen = new Set<string>()
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const conversationId = typeof o.conversationId === 'string' ? o.conversationId.trim() : ''
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!conversationId || !title || seen.has(conversationId)) continue
    seen.add(conversationId)
    out.push({
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `held:${conversationId}`,
      conversationId,
      title,
      detail: typeof o.detail === 'string' ? o.detail : '',
      updatedAt: finiteTs(o.updatedAt) || 0
    })
    if (out.length >= 12) break
  }
  return out
}

export function normalizeChatStore(raw: unknown): ChatStore | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (!Array.isArray(rec.conversations)) return null
  const groups = normalizeConversationGroups(rec.groups)
  const valid = new Set(groups.map((g) => g.id))
  const conversations = (rec.conversations as Conversation[]).map((c) => {
    if (!c || typeof c !== 'object') return c
    let next = sanitizeConversationGroupId(c, valid)
    const pin = next.pinnedAt
    if (typeof pin === 'number' && Number.isFinite(pin) && pin > 0) {
      if (next.pinnedAt !== Math.floor(pin)) next = { ...next, pinnedAt: Math.floor(pin) }
    } else if (next.pinnedAt !== undefined) {
      const { pinnedAt: _drop, ...rest } = next
      next = rest
    }
    return next
  })
  const activeId = typeof rec.activeId === 'string' ? rec.activeId : ''
  const ungroupedLabel = normalizeUngroupedLabel(rec.ungroupedLabel)
  const lastChatInteractedId =
    typeof rec.lastChatInteractedId === 'string' && rec.lastChatInteractedId.trim()
      ? rec.lastChatInteractedId.trim()
      : undefined
  const todayMemos = readTodayMemos(rec.todayMemos)
  const todayReadLaneOrder = readLaneOrder(rec.todayReadLaneOrder)
  const todayHeldDones = readHeldDones(rec.todayHeldDones)
  return {
    conversations,
    activeId,
    groups,
    ungroupedLabel:
      ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? undefined : ungroupedLabel,
    ...(lastChatInteractedId ? { lastChatInteractedId } : {}),
    ...(todayMemos.length ? { todayMemos } : {}),
    ...(todayReadLaneOrder.length ? { todayReadLaneOrder } : {}),
    ...(todayHeldDones.length ? { todayHeldDones } : {})
  }
}

/** 侧栏分区：置顶 → 未分组 → 自定义组；各组内按最近活动排序。置顶项不重复出现在下方。 */
export function partitionConversationsByGroup(
  conversations: Conversation[],
  groups: ConversationGroup[]
): ConversationPartition {
  const ordered = normalizeConversationGroups(groups)
  const valid = new Set(ordered.map((g) => g.id))
  const buckets = new Map<string, Conversation[]>()
  for (const g of ordered) buckets.set(g.id, [])
  const pinned: Conversation[] = []
  const ungrouped: Conversation[] = []
  for (const c of conversations) {
    if (typeof c.pinnedAt === 'number' && Number.isFinite(c.pinnedAt) && c.pinnedAt > 0) {
      pinned.push(c)
      continue
    }
    const gid = typeof c.groupId === 'string' ? c.groupId.trim() : ''
    if (gid && valid.has(gid)) {
      buckets.get(gid)!.push(c)
    } else {
      ungrouped.push(c)
    }
  }
  return {
    pinned: sortConversationsByRecent(pinned),
    ungrouped: sortConversationsByRecent(ungrouped),
    sections: ordered.map((group) => ({
      group,
      conversations: sortConversationsByRecent(buckets.get(group.id) || [])
    }))
  }
}

export function newConversationGroup(
  name: string,
  existing: ConversationGroup[] = []
): ConversationGroup {
  const groups = normalizeConversationGroups(existing)
  const now = Date.now()
  const label = asTrimmedName(name) || `分组 ${groups.length + 1}`
  return {
    id: 'g' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    name: label,
    order: groups.length
  }
}

export function renameConversationGroup(
  groups: ConversationGroup[],
  groupId: string,
  name: string
): ConversationGroup[] {
  const label = asTrimmedName(name)
  if (!label) return normalizeConversationGroups(groups)
  return normalizeConversationGroups(
    groups.map((g) => (g.id === groupId ? { ...g, name: label } : g))
  )
}

/** 删除分组：任务回到未分组（清 groupId），不丢任务。 */
export function deleteConversationGroup(
  groups: ConversationGroup[],
  conversations: Conversation[],
  groupId: string
): { groups: ConversationGroup[]; conversations: Conversation[] } {
  const nextGroups = normalizeConversationGroups(groups.filter((g) => g.id !== groupId))
  const nextConvs = conversations.map((c) => {
    if (c.groupId !== groupId) return c
    const { groupId: _drop, ...rest } = c
    return rest
  })
  return { groups: nextGroups, conversations: nextConvs }
}

/** 把任务移入分组；groupId 缺省/空 = 未分组。移入时取消置顶，以便出现在目标组。 */
export function moveConversationToGroup(
  conversations: Conversation[],
  conversationId: string,
  groupId: string | undefined,
  validGroupIds?: ReadonlySet<string>
): Conversation[] {
  const target =
    typeof groupId === 'string' && groupId.trim() ? groupId.trim() : undefined
  if (target && validGroupIds && !validGroupIds.has(target)) {
    return conversations
  }
  return conversations.map((c) => {
    if (c.id !== conversationId) return c
    const { pinnedAt: _pin, ...base } = c
    if (!target) {
      if (c.groupId === undefined && !c.pinnedAt) return c
      const { groupId: _drop, ...rest } = base
      return rest
    }
    if (c.groupId === target && !c.pinnedAt) return c
    return { ...base, groupId: target }
  })
}
