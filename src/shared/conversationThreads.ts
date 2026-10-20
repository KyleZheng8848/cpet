import type { ChatMessage, Conversation, TaskThread } from './types'
import { conversationHasContent } from './conversationContent'

export type { TaskThread }

export function newThreadId(): string {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function firstUserText(messages: ChatMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const b of m.blocks) {
      if (b.kind === 'text' && b.text.trim()) return b.text.trim()
    }
  }
  return ''
}

export function threadTitleFromMessages(messages: ChatMessage[], fallback = '新对话'): string {
  const t = firstUserText(messages)
  if (!t) return fallback
  const one = t.replace(/\s+/g, ' ')
  return one.length > 28 ? `${one.slice(0, 28)}…` : one
}

function snapshotActive(c: Conversation): TaskThread {
  const now = Date.now()
  const id = c.activeThreadId || newThreadId()
  const existing = (c.threads || []).find((t) => t.id === id)
  return {
    id,
    title: threadTitleFromMessages(c.messages, existing?.title || '新对话'),
    messages: c.messages,
    sessionId: c.sessionId,
    lanes: c.kind === 'compare' ? c.lanes : undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

/** 保证任务有 threads / activeThreadId；旧存档从 messages 懒生成。 */
export function ensureTaskThreads(c: Conversation): Conversation {
  if (c.kind === 'rss') return c
  const threads = Array.isArray(c.threads) ? c.threads : []
  if (threads.length > 0 && c.activeThreadId && threads.some((t) => t.id === c.activeThreadId)) {
    return c.threads === threads ? c : { ...c, threads }
  }
  const snap = snapshotActive({ ...c, threads, activeThreadId: c.activeThreadId })
  return {
    ...c,
    threads: [snap],
    activeThreadId: snap.id
  }
}

/** 把当前 messages 写回 active 线程（切换 / 新建 / 落盘前调用）。 */
export function syncActiveThread(c: Conversation): Conversation {
  if (c.kind === 'rss') return c
  const base = ensureTaskThreads(c)
  const snap = snapshotActive(base)
  const threads = (base.threads || []).map((t) => (t.id === snap.id ? snap : t))
  if (!threads.some((t) => t.id === snap.id)) threads.unshift(snap)
  return { ...base, threads, activeThreadId: snap.id }
}

function applyThread(c: Conversation, thread: TaskThread): Conversation {
  return {
    ...c,
    activeThreadId: thread.id,
    messages: thread.messages || [],
    sessionId: thread.sessionId,
    lanes: c.kind === 'compare' ? thread.lanes || {} : c.lanes,
    updatedAt: Date.now()
  }
}

/** 切换到任务内另一轮对话。 */
export function switchTaskThread(c: Conversation, threadId: string): Conversation {
  if (c.kind === 'rss') return c
  const synced = syncActiveThread(c)
  const thread = (synced.threads || []).find((t) => t.id === threadId)
  if (!thread || thread.id === synced.activeThreadId) return synced
  return applyThread(synced, thread)
}

/**
 * 在当前任务内开新对话：归档当前（若非空），清空 messages / session。
 * 当前已是空对话则不变。
 */
export function newTaskThread(c: Conversation): Conversation {
  if (c.kind === 'rss') return c
  if (!conversationHasContent(c)) {
    return ensureTaskThreads(c)
  }
  const synced = syncActiveThread(c)
  const now = Date.now()
  const empty: TaskThread = {
    id: newThreadId(),
    title: '新对话',
    messages: [],
    sessionId: undefined,
    lanes:
      c.kind === 'compare'
        ? Object.fromEntries(
            Object.entries(c.lanes || {}).map(([id, lane]) => [
              id,
              { modelId: lane.modelId, messages: [] as ChatMessage[] }
            ])
          )
        : undefined,
    createdAt: now,
    updatedAt: now
  }
  return {
    ...applyThread(synced, empty),
    threads: [empty, ...(synced.threads || [])]
  }
}

function emptyCompareLanes(c: Conversation): Conversation['lanes'] | undefined {
  if (c.kind !== 'compare') return undefined
  return Object.fromEntries(
    Object.entries(c.lanes || {}).map(([laneId, lane]) => [
      laneId,
      { modelId: lane.modelId, messages: [] as ChatMessage[] }
    ])
  )
}

/**
 * 清空任务里所有轮次，并换一个新的 thread id。
 * 部分引擎后台会话按 thread 绑定：只清气泡、不换 id，daemon 还会续上旧上下文。
 */
export function clearAllTaskThreads(c: Conversation): Conversation {
  if (c.kind === 'rss') {
    const entryId = c.rss?.selectedId?.trim()
    const now = Date.now()
    const sessions = { ...(c.rssSessions || {}) }
    const threads = { ...(c.rssThreads || {}) }
    const epochs = { ...(c.rssDiscussionEpochs || {}) }
    if (entryId) {
      delete sessions[entryId]
      threads[entryId] = []
      epochs[entryId] = newThreadId()
    }
    return {
      ...c,
      messages: [],
      sessionId: undefined,
      rssSessions: sessions,
      rssThreads: threads,
      rssDiscussionEpochs: epochs,
      updatedAt: now
    }
  }
  const now = Date.now()
  const empty: TaskThread = {
    id: newThreadId(),
    title: '新对话',
    messages: [],
    sessionId: undefined,
    lanes: emptyCompareLanes(c),
    createdAt: now,
    updatedAt: now
  }
  const compareLanes =
    c.kind === 'compare'
      ? (c.compareLanes || []).map((ref) => ({ id: ref.id, modelId: ref.modelId }))
      : c.compareLanes
  return {
    ...applyThread(c, empty),
    threads: [empty],
    compareLanes,
    lanes: empty.lanes,
    sessionId: undefined,
    messages: [],
    updatedAt: now
  }
}

export function listTaskThreads(c: Conversation | null | undefined): TaskThread[] {
  if (!c || c.kind === 'rss') return []
  const ensured = ensureTaskThreads(c)
  const synced = syncActiveThread(ensured)
  return [...(synced.threads || [])].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 删除任务内某一轮对话。
 * - 删的是当前轮且还有其它轮 → 切到最近的一轮
 * - 删到只剩 0 轮 → 留下一条空的「新对话」
 */
export function deleteTaskThread(c: Conversation, threadId: string): Conversation {
  if (c.kind === 'rss') return c
  const synced = syncActiveThread(c)
  const asked = String(threadId || '').trim()
  if (!asked) return synced
  const before = synced.threads || []
  // 旧存档可能尚未落 threads：UI 列表与本次 sync 会生成不同临时 id。
  // 仅一轮时按「清空当前」处理，避免删不掉。
  const id = before.some((t) => t.id === asked)
    ? asked
    : before.length === 1
      ? before[0]!.id
      : ''
  if (!id) return synced

  const remaining = before.filter((t) => t.id !== id)
  if (remaining.length === 0) {
    const now = Date.now()
    const empty: TaskThread = {
      id: newThreadId(),
      title: '新对话',
      messages: [],
      sessionId: undefined,
      lanes:
        c.kind === 'compare'
          ? Object.fromEntries(
              Object.entries(c.lanes || {}).map(([laneId, lane]) => [
                laneId,
                { modelId: lane.modelId, messages: [] as ChatMessage[] }
              ])
            )
          : undefined,
      createdAt: now,
      updatedAt: now
    }
    return {
      ...applyThread(synced, empty),
      threads: [empty],
      updatedAt: now
    }
  }

  const deletingActive = synced.activeThreadId === id
  if (!deletingActive) {
    return {
      ...synced,
      threads: remaining,
      updatedAt: Date.now()
    }
  }

  const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0]!
  return {
    ...applyThread(synced, next),
    threads: remaining,
    updatedAt: Date.now()
  }
}
