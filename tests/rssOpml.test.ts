import { describe, expect, it } from 'vitest'
import { buildOpml, mergeOpmlIntoDraft, parseOpml } from '../src/shared/rssOpml'

describe('rssOpml', () => {
  it('parses nested outlines with xmlUrl', () => {
    const xml = `<?xml version="1.0"?>
      <opml version="2.0"><body>
        <outline text="Tech">
          <outline type="rss" text="HN" title="HN" xmlUrl="https://hnrss.org/frontpage" />
          <outline type="rss" text="Verge" xmlUrl="https://www.theverge.com/rss/index.xml" htmlUrl="https://www.theverge.com/" />
        </outline>
        <outline text="skip folder" />
      </body></opml>`
    const feeds = parseOpml(xml)
    expect(feeds).toHaveLength(2)
    expect(feeds[0].url).toContain('hnrss.org')
    expect(feeds[0].title).toBe('HN')
    expect(feeds[0].category).toBe('Tech')
    expect(feeds[1].htmlUrl).toContain('theverge.com')
  })

  it('round-trips build → parse', () => {
    const opml = buildOpml([
      { title: 'A & B', url: 'https://example.com/feed.xml' },
      { title: 'C', url: 'https://example.org/atom.xml', htmlUrl: 'https://example.org/' }
    ])
    expect(opml).toContain('opml version="2.0"')
    const feeds = parseOpml(opml)
    expect(feeds.map((f) => f.url)).toEqual([
      'https://example.com/feed.xml',
      'https://example.org/atom.xml'
    ])
    expect(feeds[0].title).toContain('A')
  })

  it('merges into draft without dupes', () => {
    const draft = 'https://example.com/feed.xml\n'
    const { draft: next, added, truncated } = mergeOpmlIntoDraft(draft, [
      { title: 'A', url: 'https://example.com/feed.xml' },
      { title: 'B', url: 'https://b.test/rss' }
    ])
    expect(next.split(/\n/).filter(Boolean)).toHaveLength(2)
    expect(next).toContain('b.test')
    expect(added).toBe(1)
    expect(truncated).toBe(0)
  })

  it('truncates when over max', () => {
    const { draft, added, truncated } = mergeOpmlIntoDraft(
      'https://a.test/f',
      [
        { title: 'B', url: 'https://b.test/rss' },
        { title: 'C', url: 'https://c.test/rss' }
      ],
      2
    )
    expect(draft.split(/\n/).filter(Boolean)).toHaveLength(2)
    expect(added).toBe(1)
    expect(truncated).toBe(1)
  })
})
