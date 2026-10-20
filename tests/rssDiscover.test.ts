import { describe, expect, it } from 'vitest'
import { discoverRssFeeds, discoverRssFeedsLocal } from '../src/main/rssDiscover'

describe('rssDiscover', () => {
  it('local discover returns presets without waiting on network', async () => {
    const local = discoverRssFeedsLocal({ query: '', limit: 20 })
    expect(local.ok).toBe(true)
    expect(local.remote).toBe(false)
    expect(local.items.length).toBeGreaterThan(0)
    expect(local.items.every((it) => it.source === 'preset')).toBe(true)

    const viaFlag = await discoverRssFeeds({ query: 'openai', limit: 20, localOnly: true })
    expect(viaFlag.remote).toBe(false)
    expect(viaFlag.items.length).toBeGreaterThan(0)
  })

  it('full discover falls back to local when Feedly is unreachable', async () => {
    const res = await discoverRssFeeds({ query: '', limit: 12 })
    expect(res.ok).toBe(true)
    expect(res.items.length).toBeGreaterThan(0)
    // 网络不通时应带提示，且仍有精选
    if (!res.remote) {
      expect(res.error || '').toMatch(/精选|不可用/)
    }
  }, 15_000)
})
