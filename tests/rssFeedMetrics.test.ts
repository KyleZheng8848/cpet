import { describe, expect, it } from 'vitest'
import {
  mergeRssFeedMetric,
  rssFeedMetricKey,
  rssMetricNeedsFreshness,
  rssMetricNeedsSubscribers
} from '../src/shared/rssFeedMetrics'

describe('rssFeedMetrics', () => {
  it('normalizes feed url keys', () => {
    expect(rssFeedMetricKey('https://Example.com/feed/')).toBe('https://example.com/feed')
    expect(rssFeedMetricKey('https://a.test/x#frag')).toBe('https://a.test/x')
  })

  it('merges subscribers and keeps newer freshness', () => {
    const a = mergeRssFeedMetric(undefined, { subscribers: 10, updatedAt: 100, fetchedAt: 1 })
    const b = mergeRssFeedMetric(a, { updatedAt: 50, fetchedAt: 2 })
    expect(b.subscribers).toBe(10)
    expect(b.updatedAt).toBe(100)
    const c = mergeRssFeedMetric(b, { updatedAt: 200, subscribers: 99, fetchedAt: 3 })
    expect(c.updatedAt).toBe(200)
    expect(c.subscribers).toBe(99)
  })

  it('ttl helpers detect missing / stale metrics', () => {
    expect(rssMetricNeedsSubscribers(undefined)).toBe(true)
    expect(rssMetricNeedsFreshness(undefined)).toBe(true)
    const now = Date.now()
    expect(
      rssMetricNeedsSubscribers({ subscribers: 1, fetchedAt: now - 1000 }, now)
    ).toBe(false)
    expect(
      rssMetricNeedsFreshness({ updatedAt: now - 1000, fetchedAt: now - 1000 }, now)
    ).toBe(false)
  })

  it('miss cache cools empty lookups instead of infinite refetch', () => {
    const now = Date.now()
    const miss = { fetchedAt: now - 1000 }
    expect(rssMetricNeedsSubscribers(miss, now)).toBe(false)
    expect(rssMetricNeedsFreshness(miss, now)).toBe(false)
    expect(
      rssMetricNeedsSubscribers({ fetchedAt: now - 25 * 3600_000 }, now)
    ).toBe(true)
    expect(
      rssMetricNeedsFreshness({ fetchedAt: now - 3 * 3600_000 }, now)
    ).toBe(true)
  })
})
