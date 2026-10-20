import { describe, expect, it } from 'vitest'
import {
  activityTrackKey,
  arbitratePetPresence,
  idePresenceTrackId,
  isIdePresenceTrackId,
  presenceStateFromAgentEvent,
  presenceToOpsKind,
  sessionIdFromIdeTrack,
  type PresenceEntry
} from '../src/shared/petPresence'

describe('petPresence', () => {
  it('error beats tool and thinking', () => {
    const m = new Map<string, PresenceEntry>([
      ['a', { state: 'thinking', updatedAt: 1 }],
      ['b', { state: 'tool', updatedAt: 2 }],
      ['c', { state: 'error', updatedAt: 3 }]
    ])
    const r = arbitratePetPresence(m, 10)
    expect(r.state).toBe('error')
    expect(r.conversationId).toBe('c')
  })

  it('角标终态不跟动画一起过期', () => {
    const done: PresenceEntry = { state: 'done', updatedAt: 1, origin: 'cpet' }
    const waiting: PresenceEntry = { state: 'waiting', updatedAt: 1, origin: 'ide' }
    const thinking: PresenceEntry = { state: 'thinking', updatedAt: 1 }
    expect(presenceToOpsKind(done)).toBe('done')
    expect(presenceToOpsKind(waiting)).toBe('waiting')
    expect(presenceToOpsKind(thinking)).toBeNull()
  })

  it('done ages out to idle', () => {
    const m = new Map<string, PresenceEntry>([['a', { state: 'done', updatedAt: 1 }]])
    expect(arbitratePetPresence(m, 9000).state).toBe('idle')
    expect(arbitratePetPresence(m, 1000).state).toBe('done')
  })

  it('error ages out to idle so it cannot occupy the pet forever', () => {
    const m = new Map<string, PresenceEntry>([['a', { state: 'error', updatedAt: 1 }]])
    expect(arbitratePetPresence(m, 1000).state).toBe('error')
    expect(arbitratePetPresence(m, 9000).state).toBe('idle')
  })

  it('stale error loses to a fresh thinking session', () => {
    const m = new Map<string, PresenceEntry>([
      ['old', { state: 'error', updatedAt: 1 }],
      ['new', { state: 'thinking', updatedAt: 9000 }]
    ])
    const r = arbitratePetPresence(m, 9000)
    expect(r.state).toBe('thinking')
    expect(r.conversationId).toBe('new')
  })

  it('presenceStateFromAgentEvent maps tool running', () => {
    expect(presenceStateFromAgentEvent({ type: 'tool', status: 'running' })).toBe('tool')
    expect(presenceStateFromAgentEvent({ type: 'assistant-delta' })).toBeNull()
  })

  it('same rank prefers ide (监听) over cpet', () => {
    const m = new Map<string, PresenceEntry>([
      ['cpet', { state: 'thinking', updatedAt: 10, origin: 'cpet' }],
      ['ide:sess-a', { state: 'thinking', updatedAt: 5, origin: 'ide', ideApp: 'Cursor' }]
    ])
    const r = arbitratePetPresence(m, 20)
    expect(r.conversationId).toBe('ide:sess-a')
    expect(r.origin).toBe('ide')
    expect(r.ideApp).toBe('Cursor')
  })

  it('two IDE tracks: higher rank wins, then newer updatedAt', () => {
    const m = new Map<string, PresenceEntry>([
      ['ide:a', { state: 'thinking', updatedAt: 10, origin: 'ide' }],
      ['ide:b', { state: 'waiting', updatedAt: 5, origin: 'ide' }]
    ])
    expect(arbitratePetPresence(m, 20).conversationId).toBe('ide:b')

    const m2 = new Map<string, PresenceEntry>([
      ['ide:a', { state: 'tool', updatedAt: 10, origin: 'ide' }],
      ['ide:b', { state: 'tool', updatedAt: 20, origin: 'ide' }]
    ])
    expect(arbitratePetPresence(m2, 30).conversationId).toBe('ide:b')
  })

  it('idePresenceTrackId is stable; default session includes ideApp', () => {
    expect(idePresenceTrackId('abc123')).toBe('ide:abc123')
    expect(idePresenceTrackId('default', 'Claude')).toBe('ide:default:Claude')
    expect(isIdePresenceTrackId('ide:abc')).toBe(true)
    expect(isIdePresenceTrackId('conv-1')).toBe(false)
    expect(sessionIdFromIdeTrack('ide:abc123')).toBe('abc123')
    expect(sessionIdFromIdeTrack('ide:default:Cursor')).toBe('default')
  })

  it('activityTrackKey prefers real sessionId', () => {
    expect(
      activityTrackKey({ sessionId: 'sess-1', emoji: '🟣', label: 'proj' })
    ).toBe('s:sess-1')
    expect(
      activityTrackKey({ sessionId: 'default', emoji: '🟣', label: 'proj' })
    ).toBe('t:🟣proj')
    expect(activityTrackKey({ emoji: '🟣', label: 'proj' })).toBe('t:🟣proj')
  })
})
