import { describe, expect, it } from 'vitest'
import {
  applyInterestAutoRead,
  briefIsActionable,
  briefMatchesInterest,
  briefUnreadCount,
  buildBriefBatchEscalatePrompt,
  buildBriefCompareFallbackNote,
  buildBriefDigestBubble,
  buildBriefEscalatePrompt,
  briefStatusLine,
  dismissBriefItem,
  markAllBriefRead,
  markBriefRead,
  mergeBriefItems,
  briefDigestScheduleKey,
  formatBriefDailyDigestHoursLabel,
  normalizeBriefDailyDigestHour,
  normalizeBriefDailyDigestHours,
  normalizeInterestKeywords,
  toggleBriefDailyDigestHour,
  panelBriefItems,
  reapplyBriefFilters,
  toggleBriefPin,
  topUnreadBrief,
  visibleBriefItems,
  type BriefItem
} from '../src/shared/briefInbox'

function item(partial: Partial<BriefItem> & Pick<BriefItem, 'id' | 'title'>): BriefItem {
  return {
    url: partial.url || `https://example.com/${partial.id}`,
    source: partial.source || 'hn',
    fetchedAt: partial.fetchedAt ?? 1,
    snippet: partial.snippet,
    sourceLabel: partial.sourceLabel,
    readAt: partial.readAt,
    dismissedAt: partial.dismissedAt,
    pinnedAt: partial.pinnedAt,
    id: partial.id,
    title: partial.title
  }
}

describe('briefInbox', () => {
  it('normalizes interest keywords', () => {
    expect(normalizeInterestKeywords('AI，rust, AI\n本地模型')).toEqual(['AI', 'rust', '本地模型'])
  })

  it('normalizes daily digest hour', () => {
    expect(normalizeBriefDailyDigestHour(9)).toBe(9)
    expect(normalizeBriefDailyDigestHour(24)).toBeNull()
    expect(normalizeBriefDailyDigestHour(null)).toBeNull()
  })

  it('normalizes multi daily digest hours and migrates legacy', () => {
    expect(normalizeBriefDailyDigestHours([9, 18, 9, 25])).toEqual([9, 18])
    expect(normalizeBriefDailyDigestHours([], 8)).toBeNull()
    expect(normalizeBriefDailyDigestHours(undefined, 8)).toEqual([8])
    expect(normalizeBriefDailyDigestHours(null)).toBeNull()
    expect(toggleBriefDailyDigestHour([9, 18], 12)).toEqual([9, 12, 18])
    expect(toggleBriefDailyDigestHour([9, 18], 9)).toEqual([18])
    expect(toggleBriefDailyDigestHour([9], 9)).toBeNull()
    expect(formatBriefDailyDigestHoursLabel([8, 18])).toBe('8:00、18:00')
    expect(formatBriefDailyDigestHoursLabel(null)).toBe('关')
    expect(briefDigestScheduleKey('2026-8-1', 9)).toBe('2026-8-1@9')
  })

  it('matches interest on title/snippet', () => {
    const it = item({ id: '1', title: 'Hello Rust', snippet: 'systems' })
    expect(briefMatchesInterest(it, ['rust'])).toBe(true)
    expect(briefMatchesInterest(it, ['python'])).toBe(false)
    expect(briefMatchesInterest(it, [])).toBe(true)
  })

  it('auto-reads new non-matching or muted items', () => {
    const prev = [item({ id: 'old', title: 'noise', fetchedAt: 1 })]
    const merged = [
      item({ id: 'old', title: 'noise', fetchedAt: 1 }),
      item({ id: 'hit', title: 'AI news', fetchedAt: 2 }),
      item({ id: 'miss', title: 'sports', fetchedAt: 3 }),
      item({ id: 'ad', title: 'AI 招聘', fetchedAt: 4 })
    ]
    const next = applyInterestAutoRead(prev, merged, ['AI'], 9, ['招聘'])
    expect(next.find((x) => x.id === 'hit')?.readAt).toBeUndefined()
    expect(next.find((x) => x.id === 'miss')?.readAt).toBe(9)
    expect(next.find((x) => x.id === 'ad')?.readAt).toBe(9)
    expect(briefIsActionable(item({ id: 'ad', title: 'AI 招聘' }), ['AI'], ['招聘'])).toBe(false)
  })

  it('panel list defaults to unread+pinned then falls back', () => {
    const inbox = {
      updatedAt: 1,
      status: 'ok' as const,
      items: [
        item({ id: 'r', title: 'read', readAt: 1, fetchedAt: 3 }),
        item({ id: 'u', title: 'unread', fetchedAt: 2 }),
        item({ id: 'p', title: 'pin read', readAt: 1, pinnedAt: 9, fetchedAt: 1 })
      ]
    }
    expect(panelBriefItems(inbox, false, 6).map((x) => x.id)).toEqual(['p', 'u'])
    expect(panelBriefItems(inbox, true, 6).map((x) => x.id)).toEqual(['p', 'r', 'u'])
    const allRead = {
      updatedAt: 1,
      status: 'ok' as const,
      items: [item({ id: 'a', title: 'a', readAt: 1, fetchedAt: 2 })]
    }
    expect(panelBriefItems(allRead, false, 6).map((x) => x.id)).toEqual(['a'])
  })

  it('unread count respects keywords; pin sorts first', () => {
    const inbox = {
      updatedAt: 1,
      status: 'ok' as const,
      interestKeywords: ['AI'],
      items: [
        item({ id: 'a', title: 'sports', fetchedAt: 3 }),
        item({ id: 'b', title: 'AI chip', fetchedAt: 2 }),
        item({ id: 'c', title: 'pinned noise', fetchedAt: 1, pinnedAt: 5 })
      ]
    }
    expect(briefUnreadCount(inbox)).toBe(1)
    expect(topUnreadBrief(inbox)?.id).toBe('b')
    expect(visibleBriefItems(inbox, 3).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('mark all read keeps pinned unread', () => {
    const inbox = {
      updatedAt: 0,
      status: 'ok' as const,
      items: [
        item({ id: 'p', title: 'keep', pinnedAt: 1 }),
        item({ id: 'x', title: 'clear' })
      ]
    }
    const next = markAllBriefRead(inbox, 10)
    expect(next.items.find((x) => x.id === 'p')?.readAt).toBeUndefined()
    expect(next.items.find((x) => x.id === 'x')?.readAt).toBe(10)
  })

  it('toggle pin clears dismiss/read', () => {
    const inbox = {
      updatedAt: 0,
      status: 'ok' as const,
      items: [item({ id: 'x', title: 't', readAt: 1 })]
    }
    const pinned = toggleBriefPin(inbox, 'x', 2)
    expect(pinned.items[0].pinnedAt).toBe(2)
    expect(pinned.items[0].readAt).toBeUndefined()
    const unpinned = toggleBriefPin(pinned, 'x', 3)
    expect(unpinned.items[0].pinnedAt).toBeUndefined()
  })

  it('digest bubble lists count and titles', () => {
    const bubble = buildBriefDigestBubble({
      updatedAt: 1,
      status: 'ok',
      interestKeywords: ['AI'],
      items: [
        item({ id: '1', title: 'AI one' }),
        item({ id: '2', title: 'AI two' }),
        item({ id: '3', title: 'other' })
      ]
    })
    expect(bubble?.text).toContain('2 条')
    expect(bubble?.text).toContain('AI one')
    expect(bubble?.hint).toContain('简报')
  })

  it('escalate / batch / fallback / status still honest', () => {
    expect(buildBriefEscalatePrompt(item({ id: '1', title: 'T', url: 'https://x', snippet: 'S' }))).toContain(
      '不要编造'
    )
    const batch = buildBriefBatchEscalatePrompt([
      item({ id: '1', title: 'A', url: 'https://a' }),
      item({ id: '2', title: 'B', url: 'https://b' })
    ])
    expect(batch).toContain('2 条')
    expect(batch).toContain('优先看')
    expect(buildBriefCompareFallbackNote()).toContain('未能开对比')
    expect(briefStatusLine({ items: [], updatedAt: 1, status: 'empty' })).toContain('兴趣词')
  })

  it('dismiss clears pin', () => {
    const inbox = {
      updatedAt: 0,
      status: 'ok' as const,
      items: [item({ id: 'x', title: 't', pinnedAt: 1 })]
    }
    const next = dismissBriefItem(inbox, 'x', 2)
    expect(next.items[0].dismissedAt).toBe(2)
    expect(next.items[0].pinnedAt).toBeUndefined()
  })

  it('mark read works', () => {
    const read = markBriefRead(
      { updatedAt: 0, status: 'ok', items: [item({ id: 'x', title: 't' })] },
      'x',
      10
    )
    expect(read.items[0].readAt).toBe(10)
  })

  it('reapply filters clears existing non-actionable unread', () => {
    const inbox = {
      updatedAt: 0,
      status: 'ok' as const,
      items: [
        item({ id: 'a', title: 'AI hit' }),
        item({ id: 'b', title: 'sports' }),
        item({ id: 'c', title: 'noise', pinnedAt: 1 })
      ]
    }
    const next = reapplyBriefFilters(inbox, ['AI'], [], 9)
    expect(next.items.find((x) => x.id === 'a')?.readAt).toBeUndefined()
    expect(next.items.find((x) => x.id === 'b')?.readAt).toBe(9)
    expect(next.items.find((x) => x.id === 'c')?.readAt).toBeUndefined()
  })

  it('merge keeps pin and snippet', () => {
    const merged = mergeBriefItems(
      [item({ id: 'hn:1', title: '旧', fetchedAt: 1, pinnedAt: 5 })],
      [item({ id: 'hn:1', title: '新', fetchedAt: 9, snippet: 's' })]
    )
    expect(merged[0].pinnedAt).toBe(5)
    expect(merged[0].snippet).toBe('s')
    expect(merged[0].title).toBe('新')
  })
})
