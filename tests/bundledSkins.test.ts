import { describe, expect, it } from 'vitest'
import { BUNDLED_IMAGE_SKIN_IDS, isBundledImageSkinId } from '../src/shared/bundledSkins'

describe('bundledSkins', () => {
  it('默认内置只有赛博幽灵与数字佳人', () => {
    expect([...BUNDLED_IMAGE_SKIN_IDS]).toEqual(['赛博幽灵', '数字佳人'])
    expect(isBundledImageSkinId('赛博幽灵')).toBe(true)
    expect(isBundledImageSkinId('数字佳人')).toBe(true)
    expect(isBundledImageSkinId('布布嘟嘟')).toBe(false)
  })
})
