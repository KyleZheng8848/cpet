import { describe, expect, it } from 'vitest'
import { emptyRssTaskState } from '../src/shared/rssTask'
import { resolveConversationThreadId, rssDiscussionThreadId } from '../src/shared/conversationThreadId'

describe('对话轮次标识', () => {
  it('显式发送的 thread 优先，否则采用对话当前轮次', () => {
    const conv = { id: 'c1', activeThreadId: 'current' }
    expect(resolveConversationThreadId({ threadId: 'sent' }, conv)).toBe('sent')
    expect(resolveConversationThreadId({ conversationId: 'c1' }, conv)).toBe('current')
    expect(resolveConversationThreadId({ conversationId: 'c1' })).toBe('c1')
  })

  it('RSS 清空后用新 epoch 隔离旧讨论，同一条目的新旧轮次不同', () => {
    const rss = { ...emptyRssTaskState(), selectedId: 'article-1' }
    const before = { id: 'rss-chat', kind: 'rss' as const, rss }
    const after = { ...before, rssDiscussionEpochs: { 'article-1': 'new-round' } }
    expect(rssDiscussionThreadId(before)).toBe('article-1')
    expect(resolveConversationThreadId({}, after)).toBe('new-round')
  })
})
