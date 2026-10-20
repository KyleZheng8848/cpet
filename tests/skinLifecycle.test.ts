import { describe, expect, it } from 'vitest'
import { checkSkinStemCoverage, REQUIRED_LIFECYCLE_STEMS } from '../src/shared/skinLifecycle'

describe('skinLifecycle', () => {
  it('fails closed when core stems missing', () => {
    const r = checkSkinStemCoverage(['idle', 'thinking'])
    expect(r.ok).toBe(false)
    expect(r.missingRequired).toContain('tool')
    expect(r.missingRequired).toContain('error')
  })

  it('passes when all required present', () => {
    const r = checkSkinStemCoverage([...REQUIRED_LIFECYCLE_STEMS, 'sleeping'])
    expect(r.ok).toBe(true)
    expect(r.missingRequired).toEqual([])
    expect(r.missingRecommended).not.toContain('sleeping')
  })
})
