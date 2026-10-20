import { describe, expect, it } from 'vitest'
import {
  rssHostPrefersExtract,
  rssWebviewIsShellOnly
} from '../src/shared/rssWebview'

describe('rssWebview', () => {
  it('flags ithome / 36kr for extract-only', () => {
    expect(rssHostPrefersExtract('https://www.ithome.com/0/123/456.htm')).toBe(true)
    expect(rssHostPrefersExtract('https://36kr.com/p/123')).toBe(true)
    expect(rssHostPrefersExtract('https://9to5mac.com/foo')).toBe(false)
  })

  it('detects shell-only pages (nav without article)', () => {
    expect(rssWebviewIsShellOnly({ total: 400, article: 20, paras: 0 })).toBe(true)
    expect(rssWebviewIsShellOnly({ total: 40, article: 0, paras: 0 })).toBe(true)
    expect(rssWebviewIsShellOnly({ total: 800, article: 600, paras: 5 })).toBe(false)
  })
})
