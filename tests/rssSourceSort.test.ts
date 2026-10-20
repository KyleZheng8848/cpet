import { describe, expect, it } from 'vitest'
import {
  sortRssDiscoverItems,
  sortRssSubscribedFeeds,
  rssFeedLastActivityAt
} from '../src/shared/rssSourceSort'
import { emptyRssTaskState, type RssTaskFeed, type RssTaskState } from '../src/shared/rssTask'

describe('rssSourceSort', () => {
  it('sorts discover by hot subscribers then fresh updatedAt', () => {
    const items = [
      { name: 'A', url: 'https://a.test', source: 'remote' as const, subscribers: 10 },
      { name: 'B', url: 'https://b.test', source: 'remote' as const, subscribers: 99 },
      { name: 'C', url: 'https://c.test', source: 'preset' as const }
    ]
    expect(sortRssDiscoverItems(items, 'hot').map((x) => x.name)).toEqual(['B', 'A', 'C'])

    const timed = [
      { name: 'Old', url: 'https://o.test', source: 'remote' as const, updatedAt: 100 },
      { name: 'New', url: 'https://n.test', source: 'remote' as const, updatedAt: 999 }
    ]
    expect(sortRssDiscoverItems(timed, 'fresh').map((x) => x.name)).toEqual(['New', 'Old'])
  })

  it('sorts subscribed by unread / fresh activity', () => {
    const feeds: RssTaskFeed[] = [
      { id: 'f1', url: 'https://1.test', title: 'One', avgScore: 3 },
      { id: 'f2', url: 'https://2.test', title: 'Two', avgScore: 4.5 }
    ]
    const now = Date.now()
    const state: RssTaskState = {
      ...emptyRssTaskState(feeds),
      items: [
        {
          id: 'e1',
          feedId: 'f1',
          title: 'u1',
          url: 'https://1.test/a',
          publishedAt: now - 60_000,
          fetchedAt: now - 60_000
        },
        {
          id: 'e2',
          feedId: 'f2',
          title: 'u2',
          url: 'https://2.test/a',
          publishedAt: now - 3_600_000,
          fetchedAt: now - 3_600_000,
          readAt: now
        }
      ]
    }
    expect(rssFeedLastActivityAt(state, 'f1')).toBe(now - 60_000)
    expect(sortRssSubscribedFeeds(feeds, state, 'score').map((f) => f.id)).toEqual(['f2', 'f1'])
    expect(sortRssSubscribedFeeds(feeds, state, 'fresh').map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(sortRssSubscribedFeeds(feeds, state, 'unread').map((f) => f.id)).toEqual(['f1', 'f2'])
  })
})
