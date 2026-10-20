import { describe, expect, it } from 'vitest'
import type { Conversation, ConversationGroup } from '../src/shared/types'
import {
  DEFAULT_UNGROUPED_LABEL,
  deleteConversationGroup,
  formatConversationAge,
  moveConversationToGroup,
  normalizeChatStore,
  normalizeConversationGroups,
  normalizeUngroupedLabel,
  partitionConversationsByGroup,
  renameConversationGroup,
  setConversationPinned
} from '../src/shared/conversationGroups'

function conv(
  partial: Partial<Conversation> & Pick<Conversation, 'id'>
): Conversation {
  const now = 1
  return {
    title: partial.title || partial.id,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

describe('normalizeConversationGroups', () => {
  it('returns [] for missing / invalid', () => {
    expect(normalizeConversationGroups(undefined)).toEqual([])
    expect(normalizeConversationGroups(null)).toEqual([])
    expect(normalizeConversationGroups('x')).toEqual([])
  })

  it('dedupes, trims, sorts by order, reindexes', () => {
    const groups = normalizeConversationGroups([
      { id: 'b', name: ' 乙 ', order: 2 },
      { id: 'a', name: '甲', order: 0 },
      { id: 'a', name: '重复', order: 9 },
      { id: '  ', name: '空', order: 1 },
      { id: 'c', name: '', order: 1 }
    ])
    expect(groups.map((g) => g.id)).toEqual(['a', 'c', 'b'])
    expect(groups.map((g) => g.order)).toEqual([0, 1, 2])
    expect(groups[1].name).toBe('未命名分组')
    expect(groups[0].name).toBe('甲')
  })
})

describe('normalizeChatStore', () => {
  it('loads legacy store without groups', () => {
    const store = normalizeChatStore({
      conversations: [conv({ id: 'c1' })],
      activeId: 'c1'
    })
    expect(store?.groups).toEqual([])
    expect(store?.conversations[0].groupId).toBeUndefined()
    expect(store?.activeId).toBe('c1')
  })

  it('strips invalid groupId', () => {
    const store = normalizeChatStore({
      conversations: [
        conv({ id: 'c1', groupId: 'gone' }),
        conv({ id: 'c2', groupId: 'g1' }),
        conv({ id: 'c3', groupId: '  ' })
      ],
      activeId: 'c1',
      groups: [{ id: 'g1', name: '工作', order: 0 }]
    })
    expect(store?.conversations.map((c) => c.groupId)).toEqual([
      undefined,
      'g1',
      undefined
    ])
  })

  it('returns null when conversations missing', () => {
    expect(normalizeChatStore({ activeId: 'x' })).toBeNull()
  })

  it('keeps custom ungrouped label', () => {
    const store = normalizeChatStore({
      conversations: [conv({ id: 'c1' })],
      activeId: 'c1',
      ungroupedLabel: '  工作台  '
    })
    expect(store?.ungroupedLabel).toBe('工作台')
    expect(normalizeUngroupedLabel('')).toBe(DEFAULT_UNGROUPED_LABEL)
    // 与默认同名则不落库
    expect(
      normalizeChatStore({
        conversations: [],
        activeId: '',
        ungroupedLabel: DEFAULT_UNGROUPED_LABEL
      })?.ungroupedLabel
    ).toBeUndefined()
  })
})

describe('partitionConversationsByGroup', () => {
  it('puts pinned first, then ungrouped, then ordered groups', () => {
    const groups: ConversationGroup[] = [
      { id: 'g2', name: '乙', order: 1 },
      { id: 'g1', name: '甲', order: 0 }
    ]
    const conversations = [
      conv({ id: 'u1', updatedAt: 10 }),
      conv({ id: 'a1', groupId: 'g1', updatedAt: 20 }),
      conv({ id: 'pin', groupId: 'g1', pinnedAt: 5, updatedAt: 30 }),
      conv({ id: 'b1', groupId: 'g2', updatedAt: 15 }),
      conv({ id: 'u2', updatedAt: 40 }),
      conv({ id: 'orphan', groupId: 'missing', updatedAt: 5 })
    ]
    const part = partitionConversationsByGroup(conversations, groups)
    expect(part.pinned.map((c) => c.id)).toEqual(['pin'])
    expect(part.ungrouped.map((c) => c.id)).toEqual(['u2', 'u1', 'orphan'])
    expect(part.sections.map((s) => s.group.id)).toEqual(['g1', 'g2'])
    expect(part.sections[0].conversations.map((c) => c.id)).toEqual(['a1'])
    expect(part.sections[1].conversations.map((c) => c.id)).toEqual(['b1'])
  })

  it('sorts within a bucket by updatedAt desc', () => {
    const groups = [{ id: 'g', name: 'G', order: 0 }]
    const conversations = [
      conv({ id: 'old', groupId: 'g', updatedAt: 1 }),
      conv({ id: 'new', groupId: 'g', updatedAt: 9 }),
      conv({ id: 'mid', groupId: 'g', updatedAt: 5 })
    ]
    expect(
      partitionConversationsByGroup(conversations, groups).sections[0].conversations.map(
        (c) => c.id
      )
    ).toEqual(['new', 'mid', 'old'])
  })
})

describe('formatConversationAge', () => {
  const now = 1_000_000_000_000
  it('formats s/m/h/d', () => {
    expect(formatConversationAge(now - 12_000, now)).toBe('12s')
    expect(formatConversationAge(now - 5 * 60_000, now)).toBe('5m')
    expect(formatConversationAge(now - 3 * 3600_000, now)).toBe('3h')
    expect(formatConversationAge(now - 2 * 86400_000, now)).toBe('2d')
  })
})

describe('group mutations', () => {
  it('rename / move / delete (delete returns tasks to ungrouped)', () => {
    let groups = normalizeConversationGroups([
      { id: 'g1', name: '旧名', order: 0 },
      { id: 'g2', name: '保留', order: 1 }
    ])
    groups = renameConversationGroup(groups, 'g1', ' 新名 ')
    expect(groups.find((g) => g.id === 'g1')?.name).toBe('新名')

    let conversations = [
      conv({ id: 'c1' }),
      conv({ id: 'c2', groupId: 'g1' })
    ]
    conversations = moveConversationToGroup(conversations, 'c1', 'g1', new Set(['g1', 'g2']))
    expect(conversations.find((c) => c.id === 'c1')?.groupId).toBe('g1')

    conversations = moveConversationToGroup(conversations, 'c1', undefined)
    expect(conversations.find((c) => c.id === 'c1')?.groupId).toBeUndefined()

    const deleted = deleteConversationGroup(groups, [
      conv({ id: 'c1', groupId: 'g1' }),
      conv({ id: 'c2', groupId: 'g2' })
    ], 'g1')
    expect(deleted.groups.map((g) => g.id)).toEqual(['g2'])
    expect(deleted.conversations.map((c) => c.groupId)).toEqual([undefined, 'g2'])
  })

  it('pin / unpin; move clears pin', () => {
    let conversations = [conv({ id: 'c1', groupId: 'g1' })]
    conversations = setConversationPinned(conversations, 'c1', true, 99)
    expect(conversations[0].pinnedAt).toBe(99)
    conversations = moveConversationToGroup(conversations, 'c1', 'g1', new Set(['g1']))
    expect(conversations[0].pinnedAt).toBeUndefined()
    expect(conversations[0].groupId).toBe('g1')
  })
})
