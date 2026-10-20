import { describe, expect, it } from 'vitest'
import {
  agentEventShouldClearIdleChatter,
  canReplaceIdleBubble,
  findRssEntryByUrl,
  IDLE_RANK,
  isSamePetAgentTarget,
  normalizeRssPetPushMinScore,
  pickRssPetTip,
  buildRssEntryPetTip,
  resolveNewsBubbleOpenTarget,
  shouldApplyPetStateNow,
  trailingPetAgentTarget
} from '../src/shared/petBubblePolicy'
import type { BriefInbox } from '../src/shared/briefInbox'
import type { ChatStore } from '../src/shared/types'
import type { RssTaskEntry, RssTaskState } from '../src/shared/rssTask'

function entry(partial: Partial<RssTaskEntry> & { id: string; title: string }): RssTaskEntry {
  return {
    feedId: 'f1',
    url: `https://example.com/${partial.id}`,
    publishedAt: Date.now(),
    fetchedAt: Date.now(),
    ...partial
  }
}

function storeWith(items: RssTaskEntry[], digests: RssTaskState['digests'] = []): ChatStore {
  return {
    activeId: 'rss1',
    conversations: [
      {
        id: 'rss1',
        title: 'RSS',
        kind: 'rss',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rss: {
          feeds: [],
          items,
          digests,
          updatedAt: Date.now()
        } as RssTaskState
      }
    ]
  }
}

describe('petBubblePolicy', () => {
  it('defaults push min to 必读(5)', () => {
    expect(normalizeRssPetPushMinScore(undefined)).toBe(5)
    expect(normalizeRssPetPushMinScore(4)).toBe(4)
  })

  it('higher rank can replace immediately; same rank waits dwell', () => {
    expect(
      canReplaceIdleBubble({
        currentRank: IDLE_RANK.weather,
        currentShownAt: Date.now() - 100,
        nextRank: IDLE_RANK.rssEntry
      })
    ).toBe(true)
    expect(
      canReplaceIdleBubble({
        currentRank: IDLE_RANK.rssEntry,
        currentShownAt: Date.now() - 100,
        nextRank: IDLE_RANK.weather
      })
    ).toBe(false)
    expect(
      canReplaceIdleBubble({
        currentRank: IDLE_RANK.chatter,
        currentShownAt: Date.now() - 6000,
        nextRank: IDLE_RANK.chatter
      })
    ).toBe(true)
  })

  it('ignores streaming deltas for clearing idle chatter', () => {
    expect(agentEventShouldClearIdleChatter({ type: 'assistant-delta' })).toBe(false)
    expect(agentEventShouldClearIdleChatter({ type: 'state', state: 'thinking' })).toBe(true)
    expect(agentEventShouldClearIdleChatter({ type: 'state', state: 'idle' })).toBe(false)
  })

  it('waiting/error/done apply immediately; busy states debounce', () => {
    expect(shouldApplyPetStateNow('waiting')).toBe(true)
    expect(shouldApplyPetStateNow('error')).toBe(true)
    expect(shouldApplyPetStateNow('done')).toBe(true)
    expect(shouldApplyPetStateNow('thinking')).toBe(false)
    expect(shouldApplyPetStateNow('tool')).toBe(false)
    expect(shouldApplyPetStateNow('talking')).toBe(false)
    expect(shouldApplyPetStateNow('idle')).toBe(false)
  })

  it('trailing debounce keeps only the latest agent target', () => {
    expect(
      trailingPetAgentTarget([
        { state: 'thinking' },
        { state: 'tool', toolLabel: 'Read' },
        { state: 'talking' }
      ])
    ).toEqual({ state: 'talking' })
    expect(
      isSamePetAgentTarget({ state: 'tool', toolLabel: 'A' }, { state: 'tool', toolLabel: 'A' })
    ).toBe(true)
    expect(
      isSamePetAgentTarget({ state: 'tool', toolLabel: 'A' }, { state: 'tool', toolLabel: 'B' })
    ).toBe(false)
  })

  it('falls back to newest unscored unread when nothing meets min', () => {
    const now = Date.now()
    const s = storeWith([
      entry({ id: 'old', title: 'old unscored', publishedAt: now - 4_000 }),
      entry({ id: 'low', title: 'low', valueScore: 3, publishedAt: now }),
      entry({ id: 'fresh', title: 'fresh unscored', publishedAt: now - 100 })
    ])
    const tip = pickRssPetTip(s, 5, new Set(), now)
    expect(tip?.entryId).toBe('fresh')
    expect(tip?.text).toContain('未评')
  })

  it('picks unread entry at or above min score', () => {
    const s = storeWith([
      entry({ id: 'a', title: 'noise', valueScore: 3 }),
      entry({ id: 'b', title: 'must', valueScore: 5, feedTitle: 'HN' })
    ])
    const tip = pickRssPetTip(s, 5, new Set())
    expect(tip?.entryId).toBe('b')
    expect(tip?.text).toContain('必读')
  })

  it('skips already tipped keys and falls back to recent digest', () => {
    const now = Date.now()
    const s = storeWith(
      [entry({ id: 'a', title: 'must', valueScore: 5 })],
      [{ id: 'd1', createdAt: now, windowHours: 24, template: 'full', markdown: '# hi', mode: 'heuristic', entryCount: 1, title: '周报' }]
    )
    const tipped = new Set(['entry:rss1:a'])
    const tip = pickRssPetTip(s, 5, tipped, now)
    expect(tip?.digestId).toBe('d1')
    expect(tip?.text).toContain('简报')
  })

  it('skips read digests and read entries for pet tips', () => {
    const now = Date.now()
    const s = storeWith(
      [
        entry({ id: 'a', title: 'must', valueScore: 5, readAt: now }),
        entry({ id: 'b', title: 'also', valueScore: 5 })
      ],
      [
        {
          id: 'd1',
          createdAt: now,
          windowHours: 24,
          template: 'full',
          markdown: '# hi',
          mode: 'heuristic',
          entryCount: 1,
          title: '已读简报',
          readAt: now
        },
        {
          id: 'd2',
          createdAt: now - 1000,
          windowHours: 24,
          template: 'full',
          markdown: '# hi2',
          mode: 'heuristic',
          entryCount: 1,
          title: '未读简报'
        }
      ]
    )
    expect(pickRssPetTip(s, 5, new Set(), now)?.entryId).toBe('b')
    const onlyReadEntry = storeWith(
      [entry({ id: 'a', title: 'must', valueScore: 5, readAt: now })],
      [
        {
          id: 'd1',
          createdAt: now,
          windowHours: 24,
          template: 'full',
          markdown: '# hi',
          mode: 'heuristic',
          entryCount: 1,
          title: '已读简报',
          readAt: now
        },
        {
          id: 'd2',
          createdAt: now - 1000,
          windowHours: 24,
          template: 'full',
          markdown: '# hi2',
          mode: 'heuristic',
          entryCount: 1,
          title: '未读简报'
        }
      ]
    )
    expect(pickRssPetTip(onlyReadEntry, 5, new Set(), now)?.digestId).toBe('d2')
    const allRead = storeWith(
      [entry({ id: 'a', title: 'must', valueScore: 5, readAt: now })],
      [
        {
          id: 'd1',
          createdAt: now,
          windowHours: 24,
          template: 'full',
          markdown: '# hi',
          mode: 'heuristic',
          entryCount: 1,
          title: '已读',
          readAt: now
        }
      ]
    )
    expect(pickRssPetTip(allRead, 5, new Set(), now)).toBeNull()
  })

  it('buildRssEntryPetTip carries deep-link ids', () => {
    const tip = buildRssEntryPetTip(
      'c1',
      entry({ id: 'e1', title: 'Hello world', valueScore: 5, feedTitle: 'Blog' }),
      5
    )
    expect(tip.conversationId).toBe('c1')
    expect(tip.entryId).toBe('e1')
    expect(tip.key).toBe('entry:c1:e1')
  })

  it('resolves brief bubble click to RSS news entry, never digest page', () => {
    const now = Date.now()
    const s = storeWith(
      [entry({ id: 'e1', title: 'Hello', url: 'https://ex.com/a/', valueScore: 5 })],
      [{ id: 'd1', createdAt: now, windowHours: 24, template: 'full', markdown: '# hi', mode: 'heuristic', entryCount: 1, title: '周报' }]
    )
    expect(findRssEntryByUrl(s, 'https://ex.com/a')).toEqual({
      conversationId: 'rss1',
      entryId: 'e1'
    })
    const inbox: BriefInbox = {
      items: [
        {
          id: 'b1',
          title: 'Hello',
          url: 'https://ex.com/a',
          source: 'rss',
          fetchedAt: now
        }
      ],
      updatedAt: now,
      status: 'ok'
    }
    expect(resolveNewsBubbleOpenTarget({ store: s, inbox, briefId: 'b1' })).toEqual({
      panel: 'chat',
      conversationId: 'rss1',
      rssEntryId: 'e1'
    })
    // 即使有简报记录，资讯气泡也只打开新闻条目，不进简报页
    expect(resolveNewsBubbleOpenTarget({ store: s, inbox: { ...inbox, items: [] } })).toEqual({
      panel: 'chat',
      conversationId: 'rss1',
      rssEntryId: 'e1'
    })
    const emptyNews = storeWith(
      [],
      [{ id: 'd1', createdAt: now, windowHours: 24, template: 'full', markdown: '# hi', mode: 'heuristic', entryCount: 1, title: '周报' }]
    )
    expect(resolveNewsBubbleOpenTarget({ store: emptyNews, inbox: { ...inbox, items: [] } })).toEqual({
      panel: 'chat',
      conversationId: 'rss1',
      rssExitDigest: true
    })
  })
})
