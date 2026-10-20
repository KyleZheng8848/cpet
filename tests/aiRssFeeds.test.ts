import { describe, expect, it } from 'vitest'
import {
  AI_RSS_CURATED_FEEDS,
  AI_RSS_TASK_ID,
  AI_RSS_TASK_TITLE,
  aiRssCuratedUrls
} from '../src/shared/aiRssFeeds'

describe('aiRssFeeds', () => {
  it('has unique HTTPS urls', () => {
    const urls = aiRssCuratedUrls()
    expect(urls.length).toBeGreaterThan(15)
    expect(new Set(urls).size).toBe(urls.length)
    for (const u of urls) {
      expect(u.startsWith('https://')).toBe(true)
    }
  })

  it('excludes known bad patterns', () => {
    const blob = AI_RSS_CURATED_FEEDS.map((f) => f.url).join('\n')
    expect(blob).not.toMatch(/rsshub\.app\//)
    expect(blob).not.toMatch(/distill\.pub/)
    expect(blob).not.toMatch(/arxiv\.org\/rss\/cs[^.]/)
  })

  it('stable task identifiers', () => {
    expect(AI_RSS_TASK_TITLE).toBe('AI')
    expect(AI_RSS_TASK_ID).toBe('cms9pk57c7h8')
  })
})
