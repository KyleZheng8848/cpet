import { describe, expect, it } from 'vitest'
import {
  mergeOpsBoard,
  opsBoardAckOnOpen,
  opsBoardKindLabel,
  opsBoardNeedsAttention,
  type OpsBoardItem
} from '../src/shared/opsBoard'

function item(partial: Partial<OpsBoardItem> & Pick<OpsBoardItem, 'id' | 'kind'>): OpsBoardItem {
  return {
    title: partial.title || partial.id,
    detail: partial.detail || '',
    updatedAt: partial.updatedAt ?? 1,
    conversationId: partial.conversationId,
    panel: partial.panel,
    id: partial.id,
    kind: partial.kind
  }
}

describe('opsBoard', () => {
  it('merges by id keeping newer updatedAt', () => {
    const snap = mergeOpsBoard([
      item({ id: 'a', kind: 'running', updatedAt: 1, title: '旧' }),
      item({ id: 'a', kind: 'error', updatedAt: 2, title: '新' })
    ])
    expect(snap.items).toHaveLength(1)
    expect(snap.items[0].kind).toBe('error')
    expect(snap.items[0].title).toBe('新')
  })

  it('sorts error > waiting > done > schedule > running', () => {
    const snap = mergeOpsBoard([
      item({ id: 'r', kind: 'running', updatedAt: 10 }),
      item({ id: 's', kind: 'schedule', updatedAt: 9 }),
      item({ id: 'd', kind: 'done', updatedAt: 8 }),
      item({ id: 'w', kind: 'waiting', updatedAt: 7 }),
      item({ id: 'e', kind: 'error', updatedAt: 6 })
    ])
    expect(snap.items.map((x) => x.kind)).toEqual([
      'error',
      'waiting',
      'done',
      'schedule',
      'running'
    ])
  })

  it('caps at limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item({ id: `i${i}`, kind: 'running', updatedAt: i })
    )
    expect(mergeOpsBoard(many, 5).items).toHaveLength(5)
  })

  it('labels kinds in Chinese', () => {
    expect(opsBoardKindLabel('error')).toBe('出错')
    expect(opsBoardKindLabel('waiting')).toBe('等你')
    expect(opsBoardKindLabel('done')).toBe('完成')
  })

  it('attention kinds exclude running', () => {
    expect(opsBoardNeedsAttention('error')).toBe(true)
    expect(opsBoardNeedsAttention('waiting')).toBe(true)
    expect(opsBoardNeedsAttention('done')).toBe(true)
    expect(opsBoardNeedsAttention('schedule')).toBe(true)
    expect(opsBoardNeedsAttention('running')).toBe(false)
  })

  it('ack-on-open for all attention kinds', () => {
    expect(opsBoardAckOnOpen('done')).toBe(true)
    expect(opsBoardAckOnOpen('schedule')).toBe(true)
    expect(opsBoardAckOnOpen('error')).toBe(true)
    expect(opsBoardAckOnOpen('waiting')).toBe(true)
    expect(opsBoardAckOnOpen('running')).toBe(false)
  })
})
