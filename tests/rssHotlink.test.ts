import { describe, expect, it } from 'vitest'
import { inferHotlinkReferer, refererLooksLikeAppShell } from '../src/shared/rssHotlink'

describe('rss hotlink referer', () => {
  it('maps i.qbitai.com to www.qbitai.com', () => {
    expect(
      inferHotlinkReferer(
        'https://i.qbitai.com/wp-content/uploads/2026/07/bee238d5bc186678137d6a5d4665e9ba.webp'
      )
    ).toBe('https://www.qbitai.com/')
  })

  it('maps wechat CDN to mp.weixin.qq.com', () => {
    expect(inferHotlinkReferer('https://mmbiz.qpic.cn/mmbiz_png/x/0?wx_fmt=png')).toBe(
      'https://mp.weixin.qq.com/'
    )
  })

  it('treats localhost / empty as app shell referer', () => {
    expect(refererLooksLikeAppShell('')).toBe(true)
    expect(refererLooksLikeAppShell('http://localhost:5173/')).toBe(true)
    expect(refererLooksLikeAppShell('https://www.qbitai.com/')).toBe(false)
  })
})
