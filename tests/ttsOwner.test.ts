import { describe, expect, it, beforeEach } from 'vitest'
import { claimTtsOwner, isTtsOwner, releaseTtsOwner } from '../src/main/ttsOwner'

describe('ttsOwner', () => {
  beforeEach(() => {
    releaseTtsOwner(1)
    releaseTtsOwner(2)
    releaseTtsOwner(3)
  })

  it('chat claim blocks pet on same stream', () => {
    expect(claimTtsOwner(1, 'chat', 'c1').ok).toBe(true)
    expect(claimTtsOwner(2, 'pet', 'c1').ok).toBe(false)
    expect(isTtsOwner(1)).toBe(true)
    expect(isTtsOwner(2)).toBe(false)
  })

  it('chat can steal from pet', () => {
    expect(claimTtsOwner(2, 'pet', 'c1').ok).toBe(true)
    expect(claimTtsOwner(1, 'chat', 'c1').ok).toBe(true)
    expect(isTtsOwner(1)).toBe(true)
    expect(isTtsOwner(2)).toBe(false)
  })

  it('release only clears matching window', () => {
    claimTtsOwner(1, 'chat', 'c1')
    releaseTtsOwner(2)
    expect(isTtsOwner(1)).toBe(true)
    releaseTtsOwner(1)
    expect(isTtsOwner(2)).toBe(true) // no session → anyone allowed
  })
})
