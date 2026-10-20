import { describe, expect, it } from 'vitest'
import {
  applyRssEntryScores,
  clampRssAiPct,
  clampRssListPct,
  emptyRssTaskState,
  entriesInDigestWindow,
  entriesInTimeBounds,
  filterEntriesByDigestScoreMin,
  normalizeRssDigestScoreMin,
  formatDigestRangeLabel,
  formatRssDigestHoursLabel,
  listDigestTimeChunks,
  normalizeRssDigestHours,
  resolveAutoDigestTimeBounds,
  resolveDigestTimeBounds,
  toLocalYmd,
  toggleRssDigestHour,
  feedIdFromUrl,
  feedsMatchingOneRssFeedError,
  feedsMatchingRssFeedError,
  filterRssTaskItems,
  hostsFromRssFeedError,
  isRssFeedEmptyPullNotice,
  joinRssFeedErrors,
  splitRssFeedActionableErrors,
  splitRssFeedErrors,
  summarizeRssFeedErrors,
  formatRssFeedPullError,
  rssFeedPullErrorLabel,
  heuristicScoreEntry,
  expireStaleRssUnread,
  isRssDigestThreadId,
  markRssDigestRead,
  markRssEntryRead,
  markAllRssRead,
  rssDigestIsUnread,
  mergeRssTaskItems,
  rssEntryHasDisplayableBody,
  rssEntryHasUsableBody,
  rssEntryIsUnread,
  rssEntryNeedsModelBody,
  RSS_UNREAD_TTL_MS,
  normalizeRssPaneWidths,
  normalizeRssTaskFeeds,
  normalizeRssTaskState,
  prependRssDigest,
  removeRssDigest,
  rssDigestThreadId,
  rssEntryHasDiscussion,
  rssEntrySourceLabel,
  rssShortSourceLabel,
  rssScoreLabel,
  buildRssDigestTitle,
  formatRssDayLabel,
  groupRssEntriesByDay,
  rssDayKey,
  rssDigestDisplayTitle,
  rssValuableCountsByMin,
  rssValuableFilterLabel,
  reconcileRssEntrySources,
  rssTaskUnreadCount,
  selectedRssDigest,
  setRssFeedRating,
  stripRssAskPreamble,
  articlePlainExcerpt,
  buildRssAskContext,
  relatedRssForEntry,
  rssDiscussionBasisLabel,
  rssEntryHasModelBody,
  withRssExtractHtml,
  withRssExtractPane,
  withRssModelHtml,
  buildRssQuickInterpretUserPrompt,
  formatArticleMediaInventory,
  listArticleMediaForPrompt,
  rssAskRemoteImageUrls,
  rssEntryImageUrl,
  type RssTaskEntry
} from '../src/shared/rssTask'
import { migrateRssThreads, switchRssEntry } from '../src/shared/models'
import type { Conversation } from '../src/shared/types'

function entry(partial: Partial<RssTaskEntry> & Pick<RssTaskEntry, 'id' | 'title'>): RssTaskEntry {
  return {
    feedId: 'f1',
    url: `https://example.com/${partial.id}`,
    fetchedAt: Date.now(),
    ...partial
  }
}

describe('rssTask', () => {
  it('normalizes more than 6 feeds for a task', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://ex.com/f${i}.xml`)
    const feeds = normalizeRssTaskFeeds(urls)
    expect(feeds).toHaveLength(10)
    expect(feeds[0].id).toBe(feedIdFromUrl(feeds[0].url))
  })

  it('merges and keeps read items (long archive)', () => {
    const prev = [
      entry({ id: 'a', title: 'A', readAt: 1 }),
      entry({ id: 'b', title: 'B' })
    ]
    const incoming = [entry({ id: 'c', title: 'C', fetchedAt: Date.now() + 10 })]
    const merged = mergeRssTaskItems(prev, incoming)
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
    expect(merged.find((x) => x.id === 'a')?.readAt).toBe(1)
  })

  it('strips RSS ask preamble for bubble display', () => {
    const full =
      '【RSS 条目】\n标题：Hello\n来源：HN\n链接：https://x.test\n\n请基于以上条目回答用户问题（不要编造未给出的事实）。\n\n【用户】\n帮我总结'
    expect(stripRssAskPreamble(full)).toBe('帮我总结')
    expect(stripRssAskPreamble('普通话')).toBe('普通话')
  })

  it('quick interpret prompts differ for digest vs entry', () => {
    expect(buildRssQuickInterpretUserPrompt('digest')).toContain('本份简报')
    expect(buildRssQuickInterpretUserPrompt('extract')).toContain('关键事实与数字')
    expect(buildRssQuickInterpretUserPrompt('web')).toContain('不要压成三五句空话')
  })

  it('keeps extract and model bodies as separate panes', () => {
    const source =
      '<p>据报道苹果测试长鑫存储芯片，用于部分中国市场设备，并考虑扩建产能以缓解短缺。（中新经纬）</p>'
    const model =
      '<p><strong>要点</strong></p><p>据整理：苹果正在 iPhone 与 MacBook 产品线测试长鑫存储芯片，以缓解内存短缺；并与长鑫就中国市场供应展开洽谈。惠普与宏碁已在部分非美市场采用相关芯片。路透社称长鑫正考虑在北京建设第二座存储工厂以提高产能。</p><p>原文：https://example.com/1</p>'
    let e = entry({ id: '1', title: '芯片', contentHtml: source, contentSource: 'extract' })
    e = withRssExtractHtml(e, source, 'extract')
    expect(e.extractHtml).toContain('长鑫')
    expect(e.extractPane).toBe('source')
    e = withRssModelHtml(e, model)
    expect(rssEntryHasModelBody(e)).toBe(true)
    expect(e.extractHtml).toContain('长鑫')
    expect(e.modelHtml).toContain('要点')
    expect(e.extractPane).toBe('model')
    e = withRssExtractPane(e, 'source')
    expect(e.extractPane).toBe('source')
    expect(e.contentHtml).toContain('长鑫')
    e = withRssExtractPane(e, 'model')
    expect(e.contentHtml).toContain('要点')
  })

  it('ask context includes plain excerpt from contentHtml', () => {
    const state = emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }])
    state.selectedId = '1'
    state.items = [
      entry({
        id: '1',
        title: 'Hello',
        feedId: 'f1',
        snippet: '短摘要',
        contentSource: 'extract',
        contentHtml:
          '<p>正文第一段有足够细节。</p><script>x()</script><p>第二段继续。</p>' +
          '<p><img src="https://cdn.example.com/a.png" alt="配图A"></p>' +
          '<video src="https://cdn.example.com/v.mp4"></video>'
      })
    ]
    const ctx = buildRssAskContext(state)
    expect(ctx).toContain('页面正文')
    expect(ctx).toMatch(/约 \d+ 字/)
    expect(ctx).toContain('不要只复述标题导语')
    expect(ctx).not.toContain('订阅摘要')
    expect(ctx).toContain('正文第一段有足够细节')
    expect(ctx).toContain('第二段继续')
    expect(ctx).toContain('媒体清单')
    expect(ctx).toContain('https://cdn.example.com/a.png')
    expect(ctx).toContain('配图A')
    expect(ctx).toContain('https://cdn.example.com/v.mp4')
    expect(ctx).not.toContain('<script')
    expect(rssDiscussionBasisLabel(state.items[0])).toMatch(/依据页面正文 \d+ 字/)
    expect(articlePlainExcerpt('<p>hi</p>', 10)).toBe('hi')
  })

  it('讨论上下文带上同标签相关新闻', () => {
    const state = emptyRssTaskState()
    state.selectedId = 'a'
    state.items = [
      entry({ id: 'a', title: '甲', tags: ['OpenAI', 'GPT-5'], valueScore: 5, contentHtml: '<p>本篇正文足够长用来讨论。</p>' }),
      entry({
        id: 'b',
        title: '乙也谈 GPT-5',
        tags: ['OpenAI', 'GPT-5'],
        valueScore: 4,
        url: 'https://example.com/b',
        snippet: '相关稿说模型发布节奏加快。'
      }),
      entry({ id: 'c', title: '无关', tags: ['DeepSeek'], valueScore: 5 }),
      entry({
        id: 'd',
        title: '低分同题',
        tags: ['OpenAI'],
        valueScore: 1,
        snippet: '也在说模型。'
      })
    ]
    expect(relatedRssForEntry(state).map((e) => e.id)).toEqual(['b', 'd'])
    const ctx = buildRssAskContext(state)
    expect(ctx).toContain('相关新闻')
    expect(ctx).toContain('乙也谈 GPT-5')
    expect(ctx).toContain('https://example.com/b')
    expect(ctx).toContain('模型发布节奏加快')
    expect(ctx).not.toContain('无关')
  })

  it('lists article media for prompts', () => {
    const html =
      '<p>x</p><img src="https://i.example/1.jpg" alt="图一">' +
      '<audio src="https://a.example/t.mp3"></audio>' +
      '<img src="data:image/png;base64,xx">'
    const list = listArticleMediaForPrompt(html, 8)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ kind: 'image', url: 'https://i.example/1.jpg', caption: '图一' })
    expect(list[1]).toMatchObject({ kind: 'audio', url: 'https://a.example/t.mp3' })
    expect(formatArticleMediaInventory(html)).toContain('[image]')
    expect(formatArticleMediaInventory(html)).toContain('[audio]')
    expect(
      rssEntryImageUrl(
        entry({
          id: 'img',
          title: '图',
          url: 'https://news.example/p',
          contentHtml: '<p><img src="/rel.jpg"></p>'
        })
      )
    ).toBe('https://news.example/rel.jpg')
    expect(
      rssEntryImageUrl(
        entry({
          id: 'enc',
          title: '封面',
          imageUrl: 'https://cdn.example.com/c.webp',
          contentHtml: '<p><img src="https://cdn.example.com/other.jpg"></p>'
        })
      )
    ).toBe('https://cdn.example.com/c.webp')
  })

  it('collects absolute article images for direct-api vision', () => {
    const state = emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }])
    state.selectedId = '1'
    state.items = [
      entry({
        id: '1',
        title: 'Hello',
        feedId: 'f1',
        url: 'https://news.example/p',
        imageUrl: 'https://cdn.example.com/cover.webp',
        contentHtml:
          '<p>正文</p><img src="/rel.jpg"><img src="https://cdn.example.com/cover.webp">'
      })
    ]
    expect(rssAskRemoteImageUrls(state)).toEqual([
      'https://cdn.example.com/cover.webp',
      'https://news.example/rel.jpg'
    ])
    state.readerMode = 'digest'
    expect(rssAskRemoteImageUrls(state)).toEqual([])
  })

  it('counts unread and filters', () => {
    const state = emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }])
    state.items = [
      entry({ id: '1', title: 'u', feedId: 'f1' }),
      entry({ id: '2', title: 'r', feedId: 'f1', readAt: 9 })
    ]
    expect(rssTaskUnreadCount(state)).toBe(1)
    state.filter = 'unread'
    expect(filterRssTaskItems(state)).toHaveLength(1)
    const read = markRssEntryRead(state, '1')
    expect(rssTaskUnreadCount(read)).toBe(0)
  })

  it('marks digest read so pet tips can skip it', () => {
    const state = emptyRssTaskState()
    state.digests = [
      {
        id: 'd1',
        createdAt: Date.now(),
        windowHours: 24,
        template: 'full',
        markdown: '# hi',
        mode: 'heuristic',
        entryCount: 1,
        title: '周报'
      }
    ]
    expect(rssDigestIsUnread(state.digests[0]!)).toBe(true)
    const marked = markRssDigestRead(state, 'd1')
    expect(rssDigestIsUnread(marked.digests![0]!)).toBe(false)
    expect(markRssDigestRead(marked, 'digest:d1')).toBe(marked)
    const all = markAllRssRead(state)
    expect(all.digests![0]!.readAt).toBeTruthy()
  })

  it('model body cache: needs once, then skip', () => {
    const empty = entry({ id: 'e1', title: 't', feedId: 'f1' })
    expect(rssEntryHasUsableBody(empty)).toBe(false)
    expect(rssEntryNeedsModelBody(empty)).toBe(true)

    const withSnippet = entry({
      id: 'e1b',
      title: 't',
      feedId: 'f1',
      snippet:
        '日本财务省官员表示已与美国财政部部长耶伦就汇市进行沟通，双方同意协同干预，市场情绪回暖。'
    })
    expect(rssEntryHasDisplayableBody(withSnippet)).toBe(true)
    expect(rssEntryHasUsableBody(withSnippet)).toBe(false)

    const cached = entry({
      id: 'e2',
      title: 't',
      feedId: 'f1',
      contentSource: 'model',
      contentHtml: `<p>${'这篇模型生成的正文需要足够长才能通过可用性检查。'.repeat(20)}</p>`
    })
    expect(rssEntryHasUsableBody(cached)).toBe(true)
    expect(rssEntryNeedsModelBody(cached)).toBe(false)

    const failed = entry({
      id: 'e3',
      title: 't',
      feedId: 'f1',
      modelContentFailedAt: Date.now()
    })
    expect(rssEntryNeedsModelBody(failed)).toBe(false)

    const merged = mergeRssTaskItems(
      [cached],
      [entry({ id: 'e2', title: 't2', feedId: 'f1', snippet: 'x' })]
    )
    expect(merged[0]?.contentSource).toBe('model')
    expect(merged[0]?.contentHtml).toContain('模型生成')
  })

  it('auto-reads unread older than 24h (keeps pinned)', () => {
    const now = Date.now()
    const fresh = entry({
      id: 'fresh',
      title: 'fresh',
      publishedAt: now - 2 * 3600_000,
      fetchedAt: now
    })
    const stale = entry({
      id: 'stale',
      title: 'stale',
      publishedAt: now - RSS_UNREAD_TTL_MS - 60_000,
      fetchedAt: now - RSS_UNREAD_TTL_MS - 60_000
    })
    const pinnedOld = entry({
      id: 'pin',
      title: 'pin',
      publishedAt: now - RSS_UNREAD_TTL_MS - 60_000,
      fetchedAt: now - RSS_UNREAD_TTL_MS - 60_000,
      pinnedAt: now
    })
    expect(rssEntryIsUnread(fresh, now)).toBe(true)
    expect(rssEntryIsUnread(stale, now)).toBe(false)
    expect(rssEntryIsUnread(pinnedOld, now)).toBe(true)

    const expired = expireStaleRssUnread([fresh, stale, pinnedOld], now)
    expect(expired.find((x) => x.id === 'stale')?.readAt).toBe(now)
    expect(expired.find((x) => x.id === 'fresh')?.readAt).toBeUndefined()
    expect(expired.find((x) => x.id === 'pin')?.readAt).toBeUndefined()

    const state = emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }])
    state.items = [fresh, stale, pinnedOld]
    state.filter = 'unread'
    expect(rssTaskUnreadCount(state, now)).toBe(2)
    expect(filterRssTaskItems(state, now).map((x) => x.id).sort()).toEqual(['fresh', 'pin'])

    const merged = mergeRssTaskItems([], [stale], 1000)
    expect(merged[0]?.readAt).toBeTruthy()
  })

  it('tracks per-entry discussion presence', () => {
    expect(rssEntryHasDiscussion({ a: [{ id: '1' } as never] }, 'a')).toBe(true)
    expect(rssEntryHasDiscussion({ a: [] }, 'a')).toBe(false)
    expect(rssEntryHasDiscussion({}, 'a')).toBe(false)
  })

  it('switches rss threads per entry', () => {
    const base: Conversation = {
      id: 'c1',
      title: 'RSS',
      kind: 'rss',
      messages: [{ id: 'm1', role: 'user', blocks: [{ kind: 'text', text: '关于 A' }], createdAt: 1 }],
      modelRef: 'cursor:auto',
      agentAutonomy: 'agent',
      rssDefaultModelRef: 'cursor:auto',
      rssDefaultAutonomy: 'agent',
      rss: {
        ...emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }]),
        items: [entry({ id: 'a', title: 'A' }), entry({ id: 'b', title: 'B' })],
        selectedId: 'a'
      },
      rssThreads: {
        a: [{ id: 'm1', role: 'user', blocks: [{ kind: 'text', text: '关于 A' }], createdAt: 1 }]
      },
      rssModelRefs: { a: 'cursor:auto' },
      rssAutonomies: { a: 'agent' },
      createdAt: 1,
      updatedAt: 1
    }
    const toB = switchRssEntry(base, 'b')
    expect(toB.messages).toEqual([])
    expect(toB.rss?.selectedId).toBe('b')
    expect(toB.rssThreads?.a?.[0]?.id).toBe('m1')
    expect(rssEntryHasDiscussion(toB.rssThreads, 'b')).toBe(false)
    // 新条回落任务默认，不被 A 的后续改模型污染
    expect(toB.modelRef).toBe('cursor:auto')
    expect(toB.agentAutonomy).toBe('agent')

    const back = switchRssEntry(
      {
        ...toB,
        messages: [{ id: 'm2', role: 'user', blocks: [{ kind: 'text', text: '关于 B' }], createdAt: 2 }],
        modelRef: 'openai:gpt-4o',
        agentAutonomy: 'ask',
        rssModelRefs: { ...(toB.rssModelRefs || {}), b: 'openai:gpt-4o' },
        rssAutonomies: { ...(toB.rssAutonomies || {}), b: 'ask' }
      },
      'a'
    )
    expect(back.messages[0]?.id).toBe('m1')
    expect(back.rssThreads?.b?.[0]?.id).toBe('m2')
    expect(back.modelRef).toBe('cursor:auto')
    expect(back.agentAutonomy).toBe('agent')
    expect(back.rssModelRefs?.b).toBe('openai:gpt-4o')
    expect(back.rssAutonomies?.b).toBe('ask')
  })

  it('keeps per-entry model/agent independent across switches', () => {
    let c: Conversation = {
      id: 'c2',
      title: 'RSS',
      kind: 'rss',
      messages: [],
      modelRef: 'cursor:auto',
      agentAutonomy: 'agent',
      rssDefaultModelRef: 'cursor:auto',
      rssDefaultAutonomy: 'agent',
      rss: {
        ...emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }]),
        items: [entry({ id: 'a', title: 'A' }), entry({ id: 'b', title: 'B' })],
        selectedId: 'a'
      },
      createdAt: 1,
      updatedAt: 1
    }
    c = switchRssEntry(
      { ...c, modelRef: 'anthropic:claude', agentAutonomy: 'plan' },
      'a'
    )
    // sync via switch from a (already a) still stamps
    c = {
      ...c,
      modelRef: 'anthropic:claude',
      agentAutonomy: 'plan',
      rssModelRefs: { a: 'anthropic:claude' },
      rssAutonomies: { a: 'plan' }
    }
    const onB = switchRssEntry(c, 'b')
    expect(onB.modelRef).toBe('cursor:auto')
    expect(onB.agentAutonomy).toBe('agent')
    expect(onB.rssModelRefs?.a).toBe('anthropic:claude')
    const backA = switchRssEntry(
      { ...onB, modelRef: 'openai:o3', agentAutonomy: 'ask', rssModelRefs: { ...onB.rssModelRefs, b: 'openai:o3' } },
      'a'
    )
    expect(backA.modelRef).toBe('anthropic:claude')
    expect(backA.agentAutonomy).toBe('plan')
    expect(backA.rssModelRefs?.b).toBe('openai:o3')
  })

  it('resolves source label when feedId drifts', () => {
    const state = emptyRssTaskState([{ id: 'f_new', url: 'https://www.ithome.com/rss/', title: 'IT之家' }])
    state.items = [
      entry({
        id: '1',
        title: '浏览器排行',
        feedId: 'f_old',
        url: 'https://www.ithome.com/0/123.htm'
      })
    ]
    expect(rssEntrySourceLabel(state, state.items[0])).toBe('IT之家')
    const fixed = reconcileRssEntrySources(state)
    expect(fixed.items[0].feedId).toBe('f_new')
    expect(fixed.items[0].feedTitle).toBe('IT之家')
  })

  it('preserves value scores on merge and filters valuable', () => {
    const prev = [entry({ id: 'a', title: 'A', valueScore: 5, scoreReason: '重要', scoredAt: 1 })]
    const incoming = [entry({ id: 'a', title: 'A2', snippet: 'x' })]
    const merged = mergeRssTaskItems(prev, incoming)
    expect(merged[0].valueScore).toBe(5)
    expect(merged[0].scoreReason).toBe('重要')
    expect(merged[0].title).toBe('A2')

    const state = emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }])
    const t = 1_700_000_000_000
    // 列表已按时间新→旧；重点只过滤、不按评分重排
    state.items = [
      entry({ id: '1', title: 'hi', valueScore: 4, publishedAt: t }),
      entry({ id: '2', title: 'lo', valueScore: 2, publishedAt: t - 1000 }),
      entry({ id: '3', title: 'mid', valueScore: 5, publishedAt: t - 2000 })
    ]
    state.filter = 'valuable'
    expect(filterRssTaskItems(state).map((x) => x.id)).toEqual(['1', '3'])
    state.filter = 'score:4'
    expect(filterRssTaskItems(state).map((x) => x.id)).toEqual(['1', '3'])
    state.filter = 'valuable'
    state.scoreMinForValuable = 5
    expect(filterRssTaskItems(state).map((x) => x.id)).toEqual(['3'])
    expect(rssScoreLabel(5)).toBe('必读')
    expect(rssValuableFilterLabel(4)).toBe('值得看+')
    expect(normalizeRssDigestScoreMin(4)).toBe(4)
    expect(normalizeRssDigestScoreMin(0)).toBe(0)
    expect(
      filterEntriesByDigestScoreMin(state.items, 4).map((x) => x.id)
    ).toEqual(['1', '3'])
    expect(filterEntriesByDigestScoreMin(state.items, 0)).toHaveLength(3)
    expect(rssShortSourceLabel("Hacker News - Newest: 'A'")).toBe('HN')
    expect(rssShortSourceLabel('36氪')).toBe('36氪')
    expect(rssShortSourceLabel('很长的来源名字再加一截尾巴')).toBe('很长的来源名字再加一截…')
    const noise = heuristicScoreEntry(entry({ id: 'n', title: '限时优惠促销招聘' }))
    expect(noise.valueScore).toBe(1)
    const interest = heuristicScoreEntry(entry({ id: 'i', title: 'Hello Rust world' }), {
      interestKeywords: ['Rust']
    })
    expect(interest.valueScore).toBeGreaterThanOrEqual(4)
    expect(interest.scoreReason).toContain('兴趣')
    expect(interest.tags).toContain('Rust')
    const muted = heuristicScoreEntry(entry({ id: 'm', title: 'AI 融资快讯' }), {
      interestKeywords: ['AI'],
      muteKeywords: ['融资']
    })
    expect(muted.valueScore).toBe(1)
  })

  it('applies scores and aggregates feed stats', () => {
    let state = emptyRssTaskState([{ id: 'f1', url: 'https://a.com/x', title: 'A' }])
    state.items = [entry({ id: '1', title: 'a' }), entry({ id: '2', title: 'b' })]
    state = applyRssEntryScores(state, [
      { id: '1', valueScore: 4, scoreReason: '有料' },
      { id: '2', valueScore: 2, scoreReason: '一般' }
    ])
    expect(state.items[0].valueScore).toBe(4)
    expect(state.feeds[0].avgScore).toBe(3)
    expect(state.feeds[0].scoredCount).toBe(2)
    expect(state.items[0].tags).toBeUndefined()
    state = applyRssEntryScores(state, [
      { id: '1', valueScore: 5, scoreReason: '偏好', tags: ['OpenAI', '科技', 'GPT-5'] }
    ])
    expect(state.items[0].tags).toEqual(['OpenAI', 'GPT-5'])
    state = setRssFeedRating(state, 'f1', 5)
    expect(state.feeds[0].rating).toBe(5)
  })

  it('filters digest window and normalizes digest fields', () => {
    const now = Date.now()
    const state = emptyRssTaskState()
    state.digestWindowHours = 24
    state.items = [
      entry({ id: 'new', title: 'n', publishedAt: now - 1000 }),
      entry({ id: 'old', title: 'o', publishedAt: now - 48 * 3600_000 })
    ]
    expect(entriesInDigestWindow(state, now).map((x) => x.id)).toEqual(['new'])
    const h = heuristicScoreEntry(entry({ id: 'x', title: 'OpenAI GPT launch funding', snippet: 'x'.repeat(90) }))
    expect(h.valueScore).toBeGreaterThanOrEqual(4)
    expect(h.scoreReason).toContain('规则')

    const day = 86_400_000
    const customState = {
      ...state,
      digestRangeFrom: toLocalYmd(now - 3 * day),
      digestRangeTo: toLocalYmd(now - day)
    }
    const bounds = resolveDigestTimeBounds(customState, now)
    expect(bounds.rangeFrom).toBe(customState.digestRangeFrom)
    expect(bounds.rangeTo).toBe(customState.digestRangeTo)
    expect(formatDigestRangeLabel(customState)).toContain('~')
    customState.items = [
      entry({ id: 'in', title: 'in', publishedAt: now - 2 * day }),
      entry({ id: 'out', title: 'out', publishedAt: now - 1000 })
    ]
    expect(entriesInDigestWindow(customState, now).map((x) => x.id)).toEqual(['in'])

    const autoDaily = resolveAutoDigestTimeBounds(
      { digestHours: [9], digestIntervalHours: undefined },
      now
    )
    expect(autoDaily.windowHours).toBe(24)
    expect(autoDaily.rangeFrom).toBeUndefined()
    const autoIv = resolveAutoDigestTimeBounds(
      { digestHours: undefined, digestIntervalHours: 6 },
      now
    )
    expect(autoIv.label).toContain('6')
    expect(now - autoIv.fromAt).toBe(6 * 3600_000)

    const multi = resolveDigestTimeBounds(
      {
        digestWindowHours: 24,
        digestRangeFrom: toLocalYmd(now - 3 * day),
        digestRangeTo: toLocalYmd(now)
      },
      now
    )
    const days = listDigestTimeChunks(multi, 7)
    expect(days.length).toBeGreaterThanOrEqual(4)
    expect(days[0]!.rangeFrom).toBe(toLocalYmd(now))
    expect(days.every((d) => d.rangeFrom === d.rangeTo)).toBe(true)
    expect(
      entriesInTimeBounds(
        { ...customState, items: customState.items },
        days[0]!
      ).length
    ).toBeGreaterThanOrEqual(0)

    const norm = normalizeRssTaskState({
      feeds: [{ url: 'https://a.com/f.xml', title: 'A', rating: 4 }],
      items: [{ id: 'i', feedId: 'f', title: 't', url: 'https://a.com/1', fetchedAt: 1, valueScore: 5 }],
      filter: 'valuable',
      readerMode: 'digest',
      digestWindowHours: 48,
      digestRangeFrom: '2026-07-01',
      digestRangeTo: '2026-07-07',
      lastDigestMarkdown: '# hi'
    })
    expect(norm?.filter).toBe('valuable')
    expect(norm?.readerMode).toBe('digest')
    expect(norm?.digestWindowHours).toBe(48)
    expect(norm?.digestRangeFrom).toBe('2026-07-01')
    expect(norm?.digestRangeTo).toBe('2026-07-07')
    expect(norm?.feeds[0].rating).toBe(4)

    expect(normalizeRssDigestHours([9, 18, 9, 25])).toEqual([9, 18])
    expect(normalizeRssDigestHours(undefined, 8)).toEqual([8])
    expect(toggleRssDigestHour([9, 18], 12)).toEqual([9, 12, 18])
    expect(toggleRssDigestHour([9, 18], 9)).toEqual([18])
    expect(formatRssDigestHoursLabel([9, 18])).toBe('09:00、18:00')

    const migrated = normalizeRssTaskState({
      feeds: [],
      items: [],
      digestHour: 7
    })
    expect(migrated?.digestHours).toEqual([7])
    expect(norm?.items[0].valueScore).toBe(5)
    expect(norm?.digests?.length).toBe(1)
    expect(norm?.digests?.[0].markdown).toBe('# hi')
    expect(norm?.selectedDigestId).toBe(norm?.digests?.[0].id)
  })

  it('prepends digest history and wires digest thread ids', () => {
    let state = emptyRssTaskState()
    const a = {
      id: 'd1',
      createdAt: 100,
      windowHours: 24 as const,
      template: 'full' as const,
      markdown: '## A',
      mode: 'heuristic' as const,
      entryCount: 3
    }
    const b = {
      id: 'd2',
      createdAt: 200,
      windowHours: 48 as const,
      template: 'brief' as const,
      markdown: '## B',
      mode: 'model' as const,
      entryCount: 5
    }
    state = prependRssDigest(state, a)
    state = prependRssDigest(state, b)
    expect(state.digests?.map((d) => d.id)).toEqual(['d2', 'd1'])
    expect(selectedRssDigest(state)?.id).toBe('d2')
    // prepend 会补短 # 标题
    expect(state.lastDigestMarkdown).toMatch(/^#\s+.+\n## B$/)
    expect(state.digests?.[0]?.title).toBeTruthy()
    expect((state.digests?.[0]?.title || '').length).toBeLessThanOrEqual(28)
    expect(rssDigestThreadId('d2')).toBe('digest:d2')
    expect(isRssDigestThreadId('digest:d2')).toBe(true)
    expect(isRssDigestThreadId('entry-1')).toBe(false)

    const conv: Conversation = {
      id: 'c-digest',
      title: 'RSS',
      kind: 'rss',
      messages: [],
      rss: state,
      createdAt: 1,
      updatedAt: 1
    }
    const switched = switchRssEntry(conv, rssDigestThreadId('d2'))
    expect(switched.rss?.selectedId).toBe('digest:d2')

    state = removeRssDigest(state, 'd2')
    expect(state.digests?.map((d) => d.id)).toEqual(['d1'])
    expect(selectedRssDigest(state)?.id).toBe('d1')
    expect(state.lastDigestMarkdown).toMatch(/^#\s+.+\n## A$/)
    state = removeRssDigest(state, 'd1')
    expect(state.digests).toEqual([])
    expect(state.selectedDigestId).toBeUndefined()
    expect(state.lastDigestMarkdown).toBeUndefined()
  })

  it('migrates legacy flat rss messages onto selected entry', () => {
    const legacy: Conversation = {
      id: 'c2',
      title: 'RSS',
      kind: 'rss',
      messages: [{ id: 'm9', role: 'user', blocks: [{ kind: 'text', text: '旧' }], createdAt: 1 }],
      rss: {
        ...emptyRssTaskState(),
        selectedId: 'x'
      },
      createdAt: 1,
      updatedAt: 1
    }
    const m = migrateRssThreads(legacy)
    expect(m.rssThreads?.x?.[0]?.id).toBe('m9')
  })

  it('normalizes and clamps global RSS pane widths', () => {
    expect(normalizeRssPaneWidths(undefined)).toEqual({ listPct: 22, aiPct: 32 })
    expect(normalizeRssPaneWidths({ listPct: 30, aiPct: 28 })).toEqual({ listPct: 30, aiPct: 28 })
    expect(normalizeRssPaneWidths({ listPct: 5, aiPct: 90 }).listPct).toBeGreaterThanOrEqual(16)
    expect(normalizeRssPaneWidths({ listPct: 50, aiPct: 50 }).listPct + normalizeRssPaneWidths({ listPct: 50, aiPct: 50 }).aiPct).toBeLessThanOrEqual(78)
    expect(clampRssListPct(50, 32)).toBeLessThanOrEqual(40)
    expect(clampRssAiPct(10, 22)).toBeGreaterThanOrEqual(20)
  })

  it('lists valuable counts by threshold', () => {
    const state = {
      ...emptyRssTaskState(),
      items: [
        entry({ id: 'a', title: 'a', valueScore: 3 }),
        entry({ id: 'b', title: 'b', valueScore: 4 }),
        entry({ id: 'c', title: 'c', valueScore: 5 }),
        entry({ id: 'd', title: 'd', valueScore: 2 })
      ]
    }
    expect(rssValuableCountsByMin(state)).toEqual({ 3: 3, 4: 2, 5: 1 })
  })

  it('builds short digest titles (not long joined strings)', () => {
    const at = new Date('2026-08-01T08:30:00').getTime()
    expect(
      buildRssDigestTitle({
        markdown: '# 今日要闻\n\n内容',
        windowHours: 24,
        createdAt: at
      })
    ).toBe('今日要闻')
    // 体例固定章节不能当题目 → 取要点
    expect(
      buildRssDigestTitle({
        markdown: '信息窗口：x\n\n## 本期概览\n\n● Alpha 发布\n\n## 资料来源\n',
        windowHours: 24,
        createdAt: at
      })
    ).toBe('Alpha 发布')
    // 多条目回落题名：首题等 N 则；禁止「A与B」硬拼无关新闻
    expect(
      buildRssDigestTitle({
        windowHours: 24,
        createdAt: at,
        entries: [{ title: 'Alpha launch' }, { title: 'Beta note' }]
      })
    ).toBe('Alpha launch等2则')
    expect(
      buildRssDigestTitle({
        markdown: '# 时段概述\n\n● https://example.com/a\n● 国务院通过核电项目\n',
        windowHours: 168,
        createdAt: at,
        entries: [{ title: '美股收高' }, { title: '库克交接' }]
      })
    ).toBe('国务院通过核电项目')
    // 长串存储题名 → 展示时收短
    expect(
      rssDigestDisplayTitle({
        id: 'd1',
        title: '美股收高 · 库克交接 · 核电审批与一长串后缀说明文字继续写',
        createdAt: at,
        windowHours: 24,
        template: 'full',
        markdown: '## 本期概览\n● 美股收高\n',
        mode: 'heuristic',
        entryCount: 1
      })
    ).toBe('美股收高')
    expect(
      rssDigestDisplayTitle({
        id: 'd2',
        title: '自定义标题',
        createdAt: at,
        windowHours: 24,
        template: 'full',
        markdown: '# x',
        mode: 'heuristic',
        entryCount: 1
      })
    ).toBe('自定义标题')
  })

  it('groups entries by local calendar day', () => {
    const now = new Date('2026-08-01T15:00:00').getTime()
    const today = now - 3600_000
    const yest = now - 30 * 3600_000
    const older = new Date('2025-12-20T10:00:00').getTime()
    const groups = groupRssEntriesByDay(
      [
        entry({ id: 'a', title: 'A', publishedAt: today, fetchedAt: today }),
        entry({ id: 'b', title: 'B', publishedAt: yest, fetchedAt: yest }),
        entry({ id: 'c', title: 'C', publishedAt: older, fetchedAt: older }),
        entry({ id: 'd', title: 'D', publishedAt: today - 1000, fetchedAt: today })
      ],
      now
    )
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '2025年12月20日'])
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a', 'd'])
    expect(formatRssDayLabel(rssDayKey(today), now)).toBe('今天')
  })

  it('parses failed hosts from pull-error copy (strips www.)', () => {
    expect(hostsFromRssFeedError('无法访问 www.qbitai.com')).toEqual(['qbitai.com'])
    expect(hostsFromRssFeedError('解析失败 example.com；无法访问 www.foo.io')).toEqual([
      'example.com',
      'foo.io'
    ])
    // 与主进程 join('；') 一致：两侧无空格
    expect(hostsFromRssFeedError('无法访问 www.qbitai.com；解析失败 news.ycombinator.com')).toEqual([
      'qbitai.com',
      'news.ycombinator.com'
    ])
    expect(hostsFromRssFeedError('刷新失败')).toEqual([])
    expect(hostsFromRssFeedError('')).toEqual([])
  })

  it('matches feeds to lastError by per-feed label (no same-host mass delete)', () => {
    const feeds = normalizeRssTaskFeeds([
      { url: 'https://rsshub.app-neuer.com/a/x', title: '路由A' },
      { url: 'https://rsshub.app-neuer.com/b/y', title: '路由B' },
      { url: 'https://www.qbitai.com/feed', title: '量子位' }
    ])
    expect(
      feedsMatchingOneRssFeedError(feeds, formatRssFeedPullError('access', feeds[0]!)).map(
        (f) => f.title
      )
    ).toEqual(['路由A'])
    expect(
      feedsMatchingOneRssFeedError(feeds, '无法访问 路由B').map((f) => f.title)
    ).toEqual(['路由B'])
    // 旧版纯主机：同主机多源 → 不匹配，避免连坐
    expect(feedsMatchingOneRssFeedError(feeds, '无法访问 rsshub.app-neuer.com')).toEqual([])
    // 旧版纯主机：仅一源时可删
    const one = normalizeRssTaskFeeds(['https://news.ycombinator.com/rss'])
    expect(feedsMatchingOneRssFeedError(one, '无法访问 news.ycombinator.com').map((f) => f.url)).toEqual([
      'https://news.ycombinator.com/rss'
    ])
    expect(feedsMatchingRssFeedError(feeds, '刷新失败')).toEqual([])
  })

  it('splits joinRssFeedErrors for per-source alerts', () => {
    expect(splitRssFeedErrors('机器之心 无条目；BAAI智源研究院 无条目')).toEqual([
      '机器之心 无条目',
      'BAAI智源研究院 无条目'
    ])
    expect(joinRssFeedErrors(['机器之心 无条目', 'BAAI智源研究院 无条目'])).toBe(
      '机器之心 无条目；BAAI智源研究院 无条目'
    )
    expect(joinRssFeedErrors([])).toBeUndefined()
  })

  it('dedupes identical lines only; same-host different feeds stay distinct', () => {
    const a = { url: 'https://rsshub.app-neuer.com/twitter/u1', title: '推A' }
    const b = { url: 'https://rsshub.app-neuer.com/twitter/u2', title: '推B' }
    const dup = [
      formatRssFeedPullError('access', a),
      formatRssFeedPullError('access', a),
      formatRssFeedPullError('access', b),
      '机器之心 无条目',
      '机器之心 无条目'
    ]
    expect(joinRssFeedErrors(dup)).toBe('无法访问 推A；无法访问 推B；机器之心 无条目')
    expect(rssFeedPullErrorLabel(a)).toBe('推A')
    expect(summarizeRssFeedErrors(dup)).toBe(
      '3 个源异常：无法访问 推A；无法访问 推B 等 3 个'
    )
  })

  it('empty-feed notices are not actionable for per-source delete', () => {
    const feeds = normalizeRssTaskFeeds([
      { url: 'https://www.jiqizhixin.com/rss', title: '机器之心' },
      { url: 'https://www.baai.ac.cn/rss', title: 'BAAI智源研究院' },
      { url: 'https://36kr.com/feed', title: '36氪' }
    ])
    const withPipe = normalizeRssTaskFeeds([
      { url: 'https://www.jiqizhixin.com/rss', title: '数据服务 | 机器之心' },
      { url: 'https://www.baai.ac.cn/rss', title: 'BAAI智源研究院' }
    ])
    expect(isRssFeedEmptyPullNotice('机器之心 无条目')).toBe(true)
    expect(isRssFeedEmptyPullNotice('无法访问 机器之心')).toBe(false)
    expect(feedsMatchingOneRssFeedError(withPipe, '数据服务 | 机器之心 无条目')).toEqual([])
    expect(feedsMatchingOneRssFeedError(feeds, 'BAAI智源研究院 无条目')).toEqual([])
    expect(feedsMatchingOneRssFeedError(feeds, '机器之心 无条目')).toEqual([])
    expect(feedsMatchingRssFeedError(feeds, '机器之心 无条目；BAAI智源研究院 无条目')).toEqual([])
    expect(
      feedsMatchingRssFeedError(feeds, '机器之心 无条目；无法访问 36氪').map((f) => f.title)
    ).toEqual(['36氪'])
    expect(
      splitRssFeedActionableErrors(
        '机器之心 无条目；无法访问 36氪；BAAI智源研究院 无条目；解析失败 量子位'
      )
    ).toEqual(['无法访问 36氪', '解析失败 量子位'])
    expect(splitRssFeedActionableErrors('机器之心 无条目；BAAI智源研究院 无条目')).toEqual([])
  })
})
