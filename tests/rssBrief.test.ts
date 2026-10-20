import { describe, expect, it } from 'vitest'
import {
  BRIEF_RSS_PRESETS,
  RSS_FEED_PRESETS,
  briefRssItemMatchesFeeds,
  collectRssTaskFeedUrls,
  filterRssPresets,
  mergeRssFeedUrls,
  normalizeRssFeedUrls,
  parseFeedXml,
  resolvePetBriefFeedUrls,
  rssDraftHasUrl,
  rssSourceLabel,
  toggleUrlInRssDraft
} from '../src/shared/rssBrief'

describe('rssBrief', () => {
  it('normalizes urls and drops junk', () => {
    const urls = normalizeRssFeedUrls([
      'https://a.com/feed.xml',
      'ftp://bad',
      'not-a-url',
      'https://a.com/feed.xml',
      '# comment',
      'https://b.org/atom.xml'
    ])
    expect(urls).toEqual(['https://a.com/feed.xml', 'https://b.org/atom.xml'])
  })

  it('parses rss items with snippet', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <title>Demo Feed</title>
        <item>
          <title>Hello</title>
          <link>https://example.com/1</link>
          <guid>g1</guid>
          <description>Short blurb about hello</description>
        </item>
      </channel></rss>`
    const { feedTitle, entries } = parseFeedXml(xml, 'https://example.com/feed.xml')
    expect(feedTitle).toBe('Demo Feed')
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('Hello')
    expect(entries[0].url).toBe('https://example.com/1')
    expect(entries[0].snippet).toContain('Short blurb')
    expect(entries[0].id.startsWith('rss:')).toBe(true)
  })

  it('decodes nbsp in titles instead of gluing words', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <title>Demo</title>
        <item>
          <title>OpenAI&nbsp;buys&nbsp;Glass</title>
          <link>https://example.com/2</link>
        </item>
      </channel></rss>`
    const { entries } = parseFeedXml(xml, 'https://example.com/feed.xml')
    expect(entries[0].title).toBe('OpenAI buys Glass')
  })

  it('picks enclosure and media thumbnail as imageUrl', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <title>Pics</title>
        <item>
          <title>Photo</title>
          <link>https://example.com/p</link>
          <enclosure url="https://cdn.example.com/cover.jpg" type="image/jpeg" length="12"/>
        </item>
        <item>
          <title>Media</title>
          <link>https://example.com/m</link>
          <media:thumbnail url="https://cdn.example.com/thumb.png"/>
        </item>
      </channel></rss>`
    const { entries } = parseFeedXml(xml, 'https://example.com/feed.xml')
    expect(entries[0].imageUrl).toBe('https://cdn.example.com/cover.jpg')
    expect(entries[1].imageUrl).toBe('https://cdn.example.com/thumb.png')
  })

  it('parses atom entries via link href', () => {
    const xml = `<?xml version="1.0"?>
      <feed>
        <title>Atom</title>
        <entry>
          <title>E1</title>
          <link href="https://example.com/e1"/>
          <id>tag:e1</id>
          <summary>Atom summary</summary>
        </entry>
      </feed>`
    const { entries } = parseFeedXml(xml, 'https://example.com/atom.xml')
    expect(entries[0].url).toBe('https://example.com/e1')
    expect(entries[0].snippet).toBe('Atom summary')
  })

  it('labels feed from title or host', () => {
    expect(rssSourceLabel('https://news.ycombinator.com/rss', 'HN')).toBe('HN')
    expect(rssSourceLabel('https://www.example.com/feed')).toBe('example.com')
  })

  it('presets are https and mergeable', () => {
    expect(BRIEF_RSS_PRESETS.length).toBeGreaterThanOrEqual(3)
    for (const p of BRIEF_RSS_PRESETS) {
      expect(p.url.startsWith('https://')).toBe(true)
    }
    const merged = mergeRssFeedUrls(['https://a.com/f'], BRIEF_RSS_PRESETS[0].url)
    expect(merged).toContain(BRIEF_RSS_PRESETS[0].url)
    expect(merged[0]).toBe('https://a.com/f')
  })

  it('toggles and filters categorized presets', () => {
    const tech = filterRssPresets(RSS_FEED_PRESETS, { category: 'tech' })
    expect(tech.length).toBeGreaterThan(0)
    expect(tech.every((p) => p.category === 'tech')).toBe(true)
    const url = tech[0].url
    let draft = ''
    draft = toggleUrlInRssDraft(draft, url)
    expect(rssDraftHasUrl(draft, url)).toBe(true)
    draft = toggleUrlInRssDraft(draft, url)
    expect(rssDraftHasUrl(draft, url)).toBe(false)
  })

  it('pet brief feeds only come from RSS task subscriptions', () => {
    const store = {
      conversations: [
        {
          kind: 'rss',
          rss: { feeds: [{ url: 'https://news.ycombinator.com/rss' }] }
        }
      ]
    }
    expect(collectRssTaskFeedUrls(store)).toEqual(['https://news.ycombinator.com/rss'])
    expect(resolvePetBriefFeedUrls(store)).toEqual(['https://news.ycombinator.com/rss'])
    // 无任务 → 空（不再回退 HN/V2EX）
    expect(resolvePetBriefFeedUrls({ conversations: [] })).toEqual([])
    // 有任务但源为空 → 空
    expect(
      resolvePetBriefFeedUrls({
        conversations: [{ kind: 'rss', rss: { feeds: [] } }]
      })
    ).toEqual([])
    expect(
      briefRssItemMatchesFeeds(
        { source: 'rss', url: 'https://www.qbitai.com/2026/07/1.html' },
        ['https://news.ycombinator.com/rss']
      )
    ).toBe(false)
    expect(
      briefRssItemMatchesFeeds(
        { source: 'rss', url: 'https://news.ycombinator.com/item?id=1' },
        ['https://news.ycombinator.com/rss']
      )
    ).toBe(true)
  })
})
