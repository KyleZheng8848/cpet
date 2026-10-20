/**
 * 消息处置流水线：阶段、空窗失败、截取 N/M、骨架透传、正文补丁。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RssTaskEntry, RssTaskFeed } from '../src/shared/rssTask'
import {
  applyRssBodyPatches,
  dispositionLabel,
  withRssExtractHtml
} from '../src/shared/rssTask'

vi.mock('../src/main/store', () => ({
  getSettings: () => ({
    modelProviders: [],
    rssScoreModelRef: ''
  })
}))

vi.mock('../src/main/rssTask', () => ({
  refreshRssTaskFeeds: vi.fn(async (feeds: RssTaskFeed[]) => ({
    items: [
      entry({ id: 'new1', title: 'Fresh A', valueScore: undefined, publishedAt: Date.now() - 1000 }),
      entry({ id: 'new2', title: 'Fresh B', valueScore: undefined, publishedAt: Date.now() - 2000 })
    ],
    feeds,
    errors: []
  })),
  fetchRssArticle: vi.fn(async () => ({ ok: false }))
}))

const buildRssDigestReport = vi.fn()
const scoreRssEntries = vi.fn()
const pickDigestEntries = vi.fn((entries: RssTaskEntry[], limit: number) =>
  [...entries]
    .sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0))
    .slice(0, limit)
)

vi.mock('../src/main/rssIntelligence', async () => {
  const actual = await vi.importActual<typeof import('../src/main/rssIntelligence')>(
    '../src/main/rssIntelligence'
  )
  return {
    ...actual,
    buildRssDigestReport: (...args: unknown[]) => buildRssDigestReport(...args),
    scoreRssEntries: (...args: unknown[]) => scoreRssEntries(...args),
    pickDigestEntries: (entries: RssTaskEntry[], limit?: number) =>
      pickDigestEntries(entries, limit ?? 40),
    DIGEST_MAX_ENTRIES: 40
  }
})

import { runRssDispositionPipeline } from '../src/main/rssDisposition'

function entry(
  partial: Partial<RssTaskEntry> & Pick<RssTaskEntry, 'id' | 'title'>
): RssTaskEntry {
  return {
    feedId: 'f1',
    url: `https://example.com/${partial.id}`,
    fetchedAt: Date.now(),
    feedTitle: 'Demo',
    ...partial
  }
}

function bounds(hours = 24) {
  const toAt = Date.now()
  const fromAt = toAt - hours * 3600_000
  return {
    fromAt,
    toAt,
    windowHours: hours as 24,
    label: `近 ${hours} 小时`,
    infoWindow: `近 ${hours} 小时`
  }
}

describe('dispositionLabel', () => {
  it('maps stages to Chinese', () => {
    expect(dispositionLabel('fetching')).toMatch(/拉取/)
    expect(dispositionLabel('scoring')).toMatch(/评分/)
    expect(dispositionLabel('skeleton')).toMatch(/简版|骨架/)
  })
})

describe('applyRssBodyPatches', () => {
  it('writes extractHtml without dropping unrelated items', () => {
    const state = {
      feeds: [] as RssTaskFeed[],
      items: [
        entry({ id: 'a', title: 'A' }),
        entry({ id: 'b', title: 'B', contentHtml: '<p>old</p>' })
      ],
      filter: 'all' as const,
      readerMode: 'extract' as const,
      updatedAt: 1
    }
    const next = applyRssBodyPatches(state, [
      { id: 'a', extractHtml: '<p>full body text for article a with enough chars</p>', contentSource: 'extract' }
    ])
    expect(next.items[0]?.extractHtml).toContain('full body')
    expect(next.items[1]?.contentHtml).toContain('old')
    expect(withRssExtractHtml(state.items[0]!, '<p>x</p>').contentSource).toBe('extract')
  })
})

describe('runRssDispositionPipeline', () => {
  beforeEach(() => {
    buildRssDigestReport.mockReset()
    scoreRssEntries.mockReset()
    scoreRssEntries.mockResolvedValue({
      ok: true,
      scores: [
        { id: 'new1', valueScore: 5, scoreReason: '必读' },
        { id: 'new2', valueScore: 2, scoreReason: '可略' }
      ],
      mode: 'heuristic',
      bodyPatches: [
        {
          id: 'new1',
          extractHtml: '<p>persisted body for new1 with enough readable text content here</p>',
          contentSource: 'extract'
        }
      ]
    })
    buildRssDigestReport.mockResolvedValue({
      ok: true,
      title: '测试简报等2则',
      markdown: '# 测试简报等2则\n信息窗口：x\n\n## 本期概览\n\n● A\n\n## 资料来源\n\n● [x](https://example.com/1)',
      mode: 'heuristic',
      template: 'full',
      includedCount: 2,
      windowCount: 2,
      error: 'Agent 未完成',
      bodyPatches: []
    })
  })

  it('emits fetch→score→pick→digest stages and returns skeleton', async () => {
    const stages: string[] = []
    const res = await runRssDispositionPipeline({
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Demo' }],
      items: [],
      bounds: bounds(24),
      refresh: true,
      scoreUnscored: true,
      onStage: (s) => stages.push(s)
    })
    expect(res.ok).toBe(true)
    expect(res.stage).toBe('skeleton')
    expect(res.error).toMatch(/Agent 未完成/)
    expect(res.includedCount).toBe(2)
    expect(res.windowCount).toBe(2)
    expect(res.unscoredBefore).toBeGreaterThan(0)
    expect(stages).toEqual(
      expect.arrayContaining(['fetching', 'scoring', 'picking', 'digesting', 'skeleton'])
    )
    // 评分补抓正文已写回 items
    expect(res.items.find((x) => x.id === 'new1')?.extractHtml).toContain('persisted body')
    expect(res.record?.title).not.toContain('与')
  })

  it('fails closed on empty window without writing a skeleton record', async () => {
    const { refreshRssTaskFeeds } = await import('../src/main/rssTask')
    vi.mocked(refreshRssTaskFeeds).mockResolvedValueOnce({
      items: [],
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Demo' }],
      errors: []
    })
    const res = await runRssDispositionPipeline({
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Demo' }],
      items: [],
      bounds: bounds(24),
      refresh: true,
      scoreUnscored: true
    })
    expect(res.ok).toBe(false)
    expect(res.record).toBeUndefined()
    expect(res.error).toMatch(/没有消息/)
    expect(buildRssDigestReport).not.toHaveBeenCalled()
  })

  it('reports N/M when window larger than digest cap', async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      entry({
        id: `e${i}`,
        title: `Item ${i}`,
        valueScore: (i < 5 ? 5 : 3) as 3 | 5,
        publishedAt: Date.now() - i * 1000
      })
    )
    buildRssDigestReport.mockResolvedValueOnce({
      ok: true,
      title: 'Item 0等40则',
      markdown: '# t\n信息窗口：x\n\n## 本期概览\n\n● A\n\n## 资料来源\n\n● [x](https://example.com/1)',
      mode: 'model',
      template: 'full',
      includedCount: 40,
      windowCount: 50,
      bodyPatches: []
    })
    const res = await runRssDispositionPipeline({
      feeds: [{ id: 'f1', url: 'https://example.com/feed.xml', title: 'Demo' }],
      items: many,
      bounds: bounds(168),
      refresh: false,
      scoreUnscored: false
    })
    expect(res.ok).toBe(true)
    expect(res.stage).toBe('done')
    expect(res.windowCount).toBe(50)
    expect(res.includedCount).toBe(40)
    expect(res.detail).toMatch(/40\/50/)
  })
})
