import { describe, expect, it } from 'vitest'
import {
  applyRssFeedPollToState,
  listDueRssFeedPolls,
  mergeRssFeedPollConversations,
  reconcileRssOnChatStoreSave,
  resolveRssFeedPollIntervalMs,
  rssFeedPollIsDue
} from '../src/shared/rssFeedPoll'
import { RSS_REALTIME_FETCH_MS } from '../src/shared/rssTask'
import type { ChatStore, Conversation } from '../src/shared/types'
import type { RssTaskState } from '../src/shared/rssTask'

function rssConv(id: string, rss: Partial<RssTaskState>): Conversation {
  const now = Date.now()
  return {
    id,
    title: id,
    kind: 'rss',
    messages: [],
    createdAt: now,
    updatedAt: now,
    rss: {
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Ex' }],
      items: [],
      filter: 'all',
      readerMode: 'extract',
      updatedAt: now,
      ...rss
    }
  }
}

describe('rssFeedPoll', () => {
  it('realtime and off use 8min; interval uses minutes', () => {
    expect(resolveRssFeedPollIntervalMs({ globalScoreMode: 'realtime' })).toBe(
      RSS_REALTIME_FETCH_MS
    )
    expect(
      resolveRssFeedPollIntervalMs({
        globalScoreMode: 'interval',
        globalIntervalMinutes: 15
      })
    ).toBe(15 * 60_000)
    expect(resolveRssFeedPollIntervalMs({ globalScoreMode: 'off' })).toBe(
      RSS_REALTIME_FETCH_MS
    )
    expect(
      resolveRssFeedPollIntervalMs({
        taskScoreMode: 'off',
        globalScoreMode: 'realtime'
      })
    ).toBe(RSS_REALTIME_FETCH_MS)
  })

  it('due when never fetched or interval elapsed', () => {
    expect(rssFeedPollIsDue(undefined, 8 * 60_000, 1000)).toBe(true)
    expect(rssFeedPollIsDue(1000, 8 * 60_000, 1000 + 8 * 60_000 - 1)).toBe(false)
    expect(rssFeedPollIsDue(1000, 8 * 60_000, 1000 + 8 * 60_000)).toBe(true)
  })

  it('lists only rss tasks with feeds that are due', () => {
    const store: ChatStore = {
      activeId: 'a',
      conversations: [
        rssConv('a', {}),
        rssConv('b', { feeds: [] }),
        {
          id: 'chat',
          title: 'chat',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        rssConv('c', { scoreMode: 'off' })
      ]
    }
    const due = listDueRssFeedPolls(store, { a: Date.now() }, { scoreMode: 'realtime' }, Date.now())
    expect(due.map((d) => d.conversationId)).toEqual(['c'])
    const first = listDueRssFeedPolls(store, {}, { scoreMode: 'realtime' }, Date.now())
    expect(first.map((d) => d.conversationId).sort()).toEqual(['a', 'c'])
  })

  it('merges new items and keeps reading selection', () => {
    const rss: RssTaskState = {
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Ex' }],
      items: [
        {
          id: 'old',
          feedId: 'f1',
          title: 'old',
          url: 'https://example.com/old',
          fetchedAt: 1
        }
      ],
      filter: 'all',
      readerMode: 'extract',
      selectedId: 'old',
      updatedAt: 1
    }
    const next = applyRssFeedPollToState(rss, {
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Example' }],
      items: [
        {
          id: 'new',
          feedId: 'f1',
          title: 'new',
          url: 'https://example.com/new',
          fetchedAt: 2
        }
      ],
      errors: []
    }, 99)
    expect(next.items.some((i) => i.id === 'new')).toBe(true)
    expect(next.items.some((i) => i.id === 'old')).toBe(true)
    expect(next.selectedId).toBe('old')
    expect(next.feeds[0].title).toBe('Example')
    expect(next.lastError).toBeUndefined()
  })

  it('renderer merge keeps UI fields', () => {
    const current = [
      rssConv('a', {
        selectedId: 'keep-me',
        readerMode: 'digest',
        items: [{ id: 'old', feedId: 'f1', title: 'old', url: 'https://e/o', fetchedAt: 1 }]
      })
    ]
    const incoming = [
      rssConv('a', {
        selectedId: 'other',
        readerMode: 'extract',
        updatedAt: 50,
        items: [{ id: 'new', feedId: 'f1', title: 'new', url: 'https://e/n', fetchedAt: 2 }]
      })
    ]
    const merged = mergeRssFeedPollConversations(current, incoming)
    expect(merged[0].rss?.selectedId).toBe('keep-me')
    expect(merged[0].rss?.readerMode).toBe('digest')
    expect(merged[0].rss?.items.map((i) => i.id)).toEqual(['new'])
  })

  it('save reconcile keeps disk-only new items', () => {
    const incoming: ChatStore = {
      activeId: 'a',
      conversations: [
        rssConv('a', {
          selectedId: 'keep',
          items: [{ id: 'old', feedId: 'f1', title: 'old', url: 'https://e/o', fetchedAt: 1 }]
        })
      ]
    }
    const disk: ChatStore = {
      activeId: 'a',
      conversations: [
        rssConv('a', {
          items: [
            { id: 'old', feedId: 'f1', title: 'old', url: 'https://e/o', fetchedAt: 1 },
            { id: 'fresh', feedId: 'f1', title: 'fresh', url: 'https://e/n', fetchedAt: 2 }
          ]
        })
      ]
    }
    const next = reconcileRssOnChatStoreSave(incoming, disk)
    expect(next.conversations[0].rss?.selectedId).toBe('keep')
    expect(next.conversations[0].rss?.items.map((i) => i.id).sort()).toEqual(['fresh', 'old'])
  })
})
