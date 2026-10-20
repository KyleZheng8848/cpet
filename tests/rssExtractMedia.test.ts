import { describe, expect, it } from 'vitest'
import { scoreArticleCandidate } from '../src/main/rssTask'
import {
  articleHasMedia,
  articleMissingExpectedMedia
} from '../src/shared/rssTask'

describe('rss extract prefers media-rich body', () => {
  it('scores html with images above text-only soup', () => {
    const textOnly = Array.from({ length: 8 }, () => `<p>${'降价幅度说明。'.repeat(12)}</p>`).join(
      '\n'
    )
    const withMedia =
      textOnly +
      '<p><img src="https://cdn.example.com/chart.webp" referrerpolicy="no-referrer"></p>' +
      '<p><img src="https://cdn.example.com/price.png"></p>'
    expect(scoreArticleCandidate(withMedia)).toBeGreaterThan(scoreArticleCandidate(textOnly))
    expect(articleHasMedia(withMedia)).toBe(true)
    expect(articleMissingExpectedMedia(textOnly)).toBe(true)
    expect(articleMissingExpectedMedia(withMedia)).toBe(false)
  })
})
