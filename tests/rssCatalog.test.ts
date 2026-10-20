import { describe, expect, it } from 'vitest'
import { filterRssDiscoverFeeds, getRssDiscoverFeeds, rssCatalogCount } from '../src/shared/rssCatalog'

describe('rssCatalog', () => {
  it('ships at least 1000 discoverable feeds', () => {
    expect(rssCatalogCount()).toBeGreaterThanOrEqual(1000)
    expect(getRssDiscoverFeeds().length).toBe(rssCatalogCount())
  })

  it('filters by category and query', () => {
    const ai = filterRssDiscoverFeeds({ category: 'ai' })
    expect(ai.length).toBeGreaterThan(10)
    expect(ai.every((p) => p.category === 'ai')).toBe(true)
    const hot = filterRssDiscoverFeeds({ category: 'hot' })
    expect(hot.length).toBeGreaterThan(5)
    expect(hot.every((p) => p.category === 'hot')).toBe(true)
    for (const cat of ['social', 'media', 'game', 'science', 'blog'] as const) {
      const list = filterRssDiscoverFeeds({ category: cat })
      expect(list.length).toBeGreaterThan(0)
      expect(list.every((p) => p.category === cat)).toBe(true)
    }
    const q = filterRssDiscoverFeeds({ category: 'all', query: 'github' })
    expect(q.some((p) => /github/i.test(p.name + p.url))).toBe(true)
  })

  it('surfaces Folo-style hot feeds near the top', () => {
    const all = getRssDiscoverFeeds()
    const head = all.slice(0, 60).map((p) => p.id)
    expect(head).toContain('folo-weibo-hot')
    expect(head).toContain('folo-toutiao-hot')
    expect(head).toContain('folo-douyin-hot')
    expect(head).toContain('folo-baidu-hot')
    expect(head).toContain('folo-bilibili-rank')
    expect(head).toContain('folo-36kr-hot')
    expect(head).toContain('folo-huxiu')
    expect(head).toContain('folo-gh-trending')
    expect(head).toContain('folo-zhihu-hot')
    expect(head).toContain('folo-ahead-of-ai')
    expect(head).toContain('folo-tw-tw93')
    expect(head).toContain('folo-linuxdo-welfare')
    expect(all.some((p) => p.url.includes('rss.huxiu.com'))).toBe(true)
    expect(all.some((p) => /36kr\/hot-list/.test(p.url))).toBe(true)
    expect(all.some((p) => /zhihu\/hot/.test(p.url))).toBe(true)
    expect(all.some((p) => /twitter\/user\/HiTw93/.test(p.url))).toBe(true)
    expect(all.some((p) => /tophub\/KqndgxeLl9/.test(p.url))).toBe(true)
    expect(all.some((p) => /tophub\/x9ozB4KoXb/.test(p.url))).toBe(true)
  })

  it('includes Folo Discover browse-site RSSHub namespaces', () => {
    const all = getRssDiscoverFeeds()
    const siteIds = all.filter((p) => String(p.id).startsWith('folo-site-'))
    expect(siteIds.length).toBeGreaterThan(500)
    const blob = all.map((p) => `${p.id} ${p.name} ${p.url}`).join('\n')
    expect(blob).toMatch(/github\/trending|folo-site-github/)
    expect(blob).toMatch(/sspai|juejin|v2ex|bilibili|xiaoyuzhou|bloomberg|nytimes/i)
    expect(blob).not.toMatch(/pornhub|javbus|91porn|nhentai/i)
  })
})
