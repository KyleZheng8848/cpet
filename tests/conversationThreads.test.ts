import { describe, expect, it } from 'vitest'
import {
  clearAllTaskThreads,
  deleteTaskThread,
  listTaskThreads,
  newTaskThread,
  switchTaskThread,
  syncActiveThread
} from '../src/shared/conversationThreads'
import type { Conversation } from '../src/shared/types'

function chat(partial: Partial<Conversation> = {}): Conversation {
  const now = Date.now()
  return {
    id: 'c1',
    title: '任务A',
    messages: [],
    kind: 'chat',
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

function userMsg(text: string) {
  return {
    id: 'm' + Math.random().toString(36).slice(2, 6),
    role: 'user' as const,
    blocks: [{ kind: 'text' as const, text }],
    createdAt: Date.now()
  }
}

describe('conversationThreads', () => {
  it('new thread archives current messages inside same task', () => {
    const c0 = chat({ messages: [userMsg('你好')] })
    const c1 = newTaskThread(c0)
    expect(c1.id).toBe('c1')
    expect(c1.messages).toEqual([])
    expect(c1.sessionId).toBeUndefined()
    const threads = listTaskThreads(c1)
    expect(threads.length).toBe(2)
    expect(threads.some((t) => t.title.includes('你好'))).toBe(true)
    expect(threads.some((t) => t.messages.length === 0)).toBe(true)
  })

  it('switch restores archived messages', () => {
    const c0 = chat({ messages: [userMsg('第一轮')] })
    const c1 = newTaskThread(c0)
    const oldId = (c1.threads || []).find((t) => t.messages.length > 0)!.id
    const c2 = {
      ...c1,
      messages: [userMsg('第二轮')]
    }
    const c3 = switchTaskThread(syncActiveThread(c2), oldId)
    expect(c3.messages[0]?.blocks[0]).toMatchObject({ kind: 'text', text: '第一轮' })
  })

  it('empty current does not spawn duplicate thread', () => {
    const c0 = chat()
    const c1 = newTaskThread(c0)
    expect(listTaskThreads(c1).length).toBe(1)
  })

  it('delete archived thread keeps active', () => {
    const c0 = chat({ messages: [userMsg('旧轮')] })
    const c1 = newTaskThread(c0)
    const oldId = (c1.threads || []).find((t) => t.messages.length > 0)!.id
    const c2 = deleteTaskThread(c1, oldId)
    expect(listTaskThreads(c2).length).toBe(1)
    expect(c2.messages).toEqual([])
    expect(c2.activeThreadId).not.toBe(oldId)
  })

  it('delete active switches to remaining thread', () => {
    const c0 = chat({ messages: [userMsg('保留')] })
    const c1 = newTaskThread(c0)
    const keepId = (c1.threads || []).find((t) => t.messages.length > 0)!.id
    const activeId = c1.activeThreadId!
    const c2 = {
      ...c1,
      messages: [userMsg('将删')]
    }
    const c3 = deleteTaskThread(syncActiveThread(c2), activeId)
    expect(c3.activeThreadId).toBe(keepId)
    expect(c3.messages[0]?.blocks[0]).toMatchObject({ kind: 'text', text: '保留' })
  })

  it('delete last thread leaves empty conversation', () => {
    const c0 = syncActiveThread(chat({ messages: [userMsg('仅此')] }))
    const id = c0.activeThreadId!
    const c1 = deleteTaskThread(c0, id)
    expect(listTaskThreads(c1).length).toBe(1)
    expect(c1.messages).toEqual([])
    expect(c1.activeThreadId).toBeTruthy()
    expect(c1.activeThreadId).not.toBe(id)
  })

  it('clear all threads replaces the thread id so daemon sessions cannot resume', () => {
    const c0 = syncActiveThread(chat({ messages: [userMsg('旧上下文')], sessionId: 'sess-old' }))
    const oldId = c0.activeThreadId!
    const c1 = clearAllTaskThreads(c0)
    expect(c1.messages).toEqual([])
    expect(c1.sessionId).toBeUndefined()
    expect(c1.activeThreadId).toBeTruthy()
    expect(c1.activeThreadId).not.toBe(oldId)
    expect(listTaskThreads(c1)).toHaveLength(1)
    expect(c1.threads?.[0]?.messages).toEqual([])
  })

  it('clear RSS discussion rotates epoch and drops that entry session', () => {
    const c0 = chat({
      kind: 'rss',
      rss: { feeds: [], items: [], selectedId: 'e1', updatedAt: Date.now() },
      messages: [userMsg('旧讨论')],
      sessionId: 'cli:old',
      rssSessions: { e1: 'cli:old' },
      rssThreads: { e1: [userMsg('旧讨论')] }
    })
    const c1 = clearAllTaskThreads(c0)
    expect(c1.messages).toEqual([])
    expect(c1.sessionId).toBeUndefined()
    expect(c1.rssSessions?.e1).toBeUndefined()
    expect(c1.rssThreads?.e1).toEqual([])
    expect(c1.rssDiscussionEpochs?.e1).toBeTruthy()
    expect(c1.rssDiscussionEpochs?.e1).not.toBe('e1')
  })

  it('clear compare conversation keeps lane models but drops messages', () => {
    const c0 = chat({
      kind: 'compare',
      compareLanes: [{ id: 'l1', modelId: 'opencode:default' }],
      lanes: { l1: { modelId: 'opencode:default', messages: [userMsg('列里的话')] } },
      messages: [userMsg('共享用户轮')]
    })
    const c1 = clearAllTaskThreads(c0)
    expect(c1.messages).toEqual([])
    expect(c1.lanes?.l1?.modelId).toBe('opencode:default')
    expect(c1.lanes?.l1?.messages).toEqual([])
    expect(c1.compareLanes).toEqual([{ id: 'l1', modelId: 'opencode:default' }])
  })
})
