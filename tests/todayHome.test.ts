import { describe, expect, it } from 'vitest'
import type { OpsBoardItem } from '../src/shared/opsBoard'
import type { Conversation } from '../src/shared/types'
import type { RssTaskEntry, RssTaskState } from '../src/shared/rssTask'
import {
  formatDayCaption,
  formatTodayStamp,
  formatWeekSpan,
  isTodayQuickTask,
  listWeekDays,
  shiftDateKey,
  fitReadPageSize,
  formatTodayQuickContext,
  listMonthGrid,
  shiftMonthKey,
  sliceReadPage,
  TODAY_QUICK_TEMPLATE,
  TODAY_READS_ALL,
  pickTodayNeeds,
  countReadsOnDay,
  collectRssTagPool,
  filterReadsByTag,
  pickReadsByTag,
  pickTodayReadLanes,
  readFreshnessScore,
  readRank,
  TODAY_READ_ALL_LIMIT,
  pickTodayReads,
  pickTodayRecent,
  todayHasRssTask,
  normalizeTodayMemos,
  doneReminders,
  joinMemoNote,
  splitMemoNote,
  takeDueReminders,
  orderReadLanes,
  completeTodayMemo,
  clampTodayAskPct,
  clampTodayDockPct,
  clampTodayMapWidth,
  clampTodayMemoPct,
  todayReadExcerpt,
  todayThumbLabel,
  TODAY_MAP_W_DEFAULT,
  localDateKey
} from '../src/shared/todayHome'
import type { ScheduledTask } from '../src/shared/types'

const now = 1_700_000_000_000

function conv(partial: Partial<Conversation> & { id: string }): Conversation {
  return {
    title: partial.title || '任务',
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

function rssConv(
  id: string,
  items: Array<Partial<RssTaskEntry> & { id: string; title: string }>,
  feeds: RssTaskState['feeds'] = [{ id: 'f1', url: 'https://example.com/feed' }]
): Conversation {
  return conv({
    id,
    title: '资讯',
    kind: 'rss',
    rss: {
      feeds,
      items: items.map((it) => ({
        feedId: 'f1',
        url: `https://example.com/${it.id}`,
        fetchedAt: now - 60_000,
        publishedAt: now - 60_000,
        ...it
      })),
      digests: [],
      updatedAt: now
    } as RssTaskState
  })
}

function op(partial: Partial<OpsBoardItem> & { id: string; kind: OpsBoardItem['kind'] }): OpsBoardItem {
  return {
    title: partial.title || partial.kind,
    detail: partial.detail || '',
    updatedAt: now,
    ...partial
  }
}

describe('pickTodayNeeds', () => {
  it('等你优先于在跑，且同一对话不重复', () => {
    const ops: OpsBoardItem[] = [
      op({ id: 'run-a', kind: 'running', title: '在写', conversationId: 'a' }),
      op({ id: 'wait-a', kind: 'waiting', title: '等你回', conversationId: 'a' }),
      op({ id: 'err-b', kind: 'error', title: '出错了', conversationId: 'b' })
    ]
    const picked = pickTodayNeeds(ops, [conv({ id: 'a', title: 'A' })], new Set(['a']))
    expect(picked.map((x) => x.id)).toEqual(['wait-a', 'err-b'])
    expect(picked[0].kind).toBe('waiting')
  })

  it('作战板没有在跑时，用流式任务补上', () => {
    const picked = pickTodayNeeds(
      [],
      [conv({ id: 'c1', title: '写稿' }), conv({ id: 'c2', title: '闲聊' })],
      new Set(['c1'])
    )
    expect(picked).toEqual([
      expect.objectContaining({
        id: 'stream:c1',
        kind: 'running',
        title: '写稿',
        conversationId: 'c1'
      })
    ])
  })

  it('默认最多 8 条，不罗列全部任务', () => {
    const ops = Array.from({ length: 12 }, (_, i) =>
      op({ id: `w${i}`, kind: 'waiting', title: `等${i}`, conversationId: `c${i}` })
    )
    expect(pickTodayNeeds(ops, [], new Set()).length).toBe(8)
    expect(pickTodayNeeds(ops, [], new Set(), 6).length).toBe(6)
  })

  it('完成但没打开的对话钉在待看，态势没了也还在', () => {
    const held = [
      {
        id: 'pres-c9',
        conversationId: 'c9',
        title: '写完的稿',
        detail: '刚完成，还没看',
        updatedAt: now
      }
    ]
    const picked = pickTodayNeeds([], [], new Set(), 3, [], now, held)
    expect(picked[0]).toEqual(
      expect.objectContaining({ kind: 'done', conversationId: 'c9', title: '写完的稿' })
    )
  })

  it('未完成提醒都进待办，不论有没有时间', () => {
    const picked = pickTodayNeeds([], [], new Set(), 8, [], now, [], [
      {
        id: 'm1',
        title: '交周报',
        body: '',
        createdAt: now,
        remindAt: now + 3600_000
      },
      { id: 'm2', title: '回个电话', body: '', createdAt: now, kind: 'remind' }
    ])
    expect(picked.map((x) => x.memoId).sort()).toEqual(['m1', 'm2'])
  })

  it('日志不进待办', () => {
    const picked = pickTodayNeeds([], [], new Set(), 3, [], now, [], [
      { id: 'log1', title: '随手记', body: '看了篇稿', createdAt: now, kind: 'log' }
    ])
    expect(picked.some((x) => x.memoId === 'log1')).toBe(false)
  })

  it('空位时补上今天将跑的定时', () => {
    const later = now + 60 * 60 * 1000
    const schedules: ScheduledTask[] = [
      {
        id: 's1',
        name: '晚间简报',
        prompt: '',
        kind: 'once',
        runAt: later,
        enabled: true,
        job: 'rss-digest',
        createdAt: now,
        updatedAt: now
      }
    ]
    const picked = pickTodayNeeds([], [], new Set(), 3, schedules, now)
    expect(picked).toEqual([
      expect.objectContaining({
        id: `up:s1:${later}`,
        kind: 'schedule',
        title: '晚间简报'
      })
    ])
  })
})

describe('pickTodayReads', () => {
  it('高分未读排在普通未读前面', () => {
    const list = pickTodayReads(
      [
        rssConv('rss1', [
          { id: 'low', title: '普通新闻', valueScore: 2, publishedAt: now },
          { id: 'high', title: 'OpenAI 买了相机公司', valueScore: 5, publishedAt: now - 10_000 }
        ])
      ],
      now
    )
    expect(list.map((x) => x.entryId)).toEqual(['high'])
    expect(list[0].title).toBe('OpenAI 买了相机公司')
    expect(list[0].source).toBe('资讯')
  })

  it('已读和退订源不进列表', () => {
    const list = pickTodayReads(
      [
        rssConv(
          'rss1',
          [
            { id: 'read', title: '已读', valueScore: 5, readAt: now - 1000 },
            { id: 'gone', title: '退订', feedId: 'old', valueScore: 5 }
          ],
          [{ id: 'f1', url: 'https://example.com/feed' }]
        )
      ],
      now
    )
    expect(list).toEqual([])
  })

  it('没有 RSS 任务时 todayHasRssTask 为假', () => {
    expect(todayHasRssTask([conv({ id: 'c', kind: 'chat' })])).toBe(false)
    expect(todayHasRssTask([rssConv('r', [])])).toBe(true)
  })

  it('按任务分栏，并带一个全部', () => {
    const lanes = pickTodayReadLanes(
      [
        rssConv('a', [{ id: 'a1', title: '甲任务新闻', valueScore: 5 }]),
        rssConv('b', [{ id: 'b1', title: '乙任务新闻', valueScore: 4 }])
      ],
      now
    )
    expect(lanes.map((l) => l.id)).toEqual([TODAY_READS_ALL, 'a', 'b'])
    expect(lanes[0].label).toBe('全部')
    expect(lanes[0].items.map((x) => x.entryId)).toEqual(['a1', 'b1'])
    expect(lanes[1].items.map((x) => x.entryId)).toEqual(['a1'])
    expect(lanes[2].items.map((x) => x.entryId)).toEqual(['b1'])
  })

  it('全部与分栏只收值得看及以上，一般和未评分不进', () => {
    const lanes = pickTodayReadLanes(
      [
        rssConv('a', [
          { id: 'must', title: '必读', valueScore: 5 },
          { id: 'ok', title: '值得看', valueScore: 4 },
          { id: 'meh', title: '一般', valueScore: 3 },
          { id: 'raw', title: '还没评' }
        ]),
        rssConv('b', [{ id: 'noise', title: '噪音', valueScore: 1 }])
      ],
      now
    )
    expect(lanes.map((l) => l.id)).toEqual([TODAY_READS_ALL, 'a', 'b'])
    expect(lanes[0].items.map((x) => x.entryId)).toEqual(['must', 'ok'])
    expect(lanes[1].items.map((x) => x.entryId)).toEqual(['must', 'ok'])
    expect(lanes[2].items).toEqual([])
  })

  it('资讯条目带上正文或 enclosure 图', () => {
    const lanes = pickTodayReadLanes(
      [
        rssConv('r', [
          {
            id: 'pic',
            title: '有图',
            valueScore: 5,
            imageUrl: 'https://cdn.example.com/a.jpg',
            contentHtml: '<p>无图摘要</p>'
          },
          {
            id: 'html',
            title: '正文图',
            valueScore: 4,
            contentHtml: '<p><img src="https://cdn.example.com/b.png" alt="x"></p>'
          }
        ])
      ],
      now
    )
    expect(lanes[0].items.find((x) => x.entryId === 'pic')?.imageUrl).toBe('https://cdn.example.com/a.jpg')
    expect(lanes[0].items.find((x) => x.entryId === 'html')?.imageUrl).toBe('https://cdn.example.com/b.png')
  })

  it('没图时用核心 tag 做占位字，分栏宽度被夹在可用区间', () => {
    expect(todayThumbLabel({ tags: ['香港'], title: '长标题' })).toBe('香港')
    expect(todayThumbLabel({ title: 'OpenAI 发布' })).toBe('OP')
    expect(todayThumbLabel({ title: '' })).toBe('讯')
    expect(clampTodayMapWidth(80)).toBe(220)
    expect(clampTodayMapWidth(900)).toBe(560)
    expect(clampTodayMapWidth(Number.NaN)).toBe(TODAY_MAP_W_DEFAULT)
    expect(clampTodayAskPct(10)).toBe(22)
    expect(clampTodayAskPct(80)).toBe(48)
    expect(clampTodayAskPct(Number.NaN)).toBe(33)
    expect(clampTodayDockPct(10)).toBe(24)
    expect(clampTodayDockPct(80)).toBe(62)
    expect(clampTodayMemoPct(10)).toBe(28)
    expect(clampTodayMemoPct(90)).toBe(72)
  })

  it('速览摘录吃正文，不吃订阅牛皮癣', () => {
    const text = todayReadExcerpt({
      snippet: '订阅 热门推荐',
      contentHtml: '<p>香港扩大经贸合作，覆盖东盟和中东市场。</p><div>下一篇 下载APP</div>'
    })
    expect(text).toContain('经贸合作')
    expect(text).not.toContain('下载APP')
  })

  it('速览正文不截断、不加省略号', () => {
    const long = `${'香港扩大经贸合作，覆盖东盟和中东市场。'.repeat(20)}收束。`
    const text = todayReadExcerpt({
      snippet: '短提要。',
      contentHtml: `<p>${long}</p>`
    })
    expect(text).toBe(long)
    expect(text.endsWith('…')).toBe(false)
    expect(text.length).toBeGreaterThan(280)
  })

  it('资讯条目带上速览摘录', () => {
    const lanes = pickTodayReadLanes(
      [
        rssConv('r', [
          {
            id: 'x',
            title: '有摘录',
            valueScore: 5,
            snippet: '香港扩大与东盟经贸往来。'
          }
        ])
      ],
      now
    )
    expect(lanes[0].items[0]?.excerpt).toContain('东盟')
  })

  it('选定日期只收当天资讯，已读也算，不含别的天', () => {
    const day = new Date(2026, 8, 15, 15).getTime()
    const yday = new Date(2026, 8, 14, 18).getTime()
    const convs = [
      rssConv('r', [
        { id: 'today', title: '今天的', publishedAt: day, valueScore: 4 },
        { id: 'read-today', title: '今天已读', publishedAt: day + 1000, readAt: day + 2000, valueScore: 5 },
        { id: 'yest', title: '昨天的', publishedAt: yday, valueScore: 5 }
      ])
    ]
    const lanes = pickTodayReadLanes(convs, day, 48, 32, '2026-09-15')
    expect(lanes[0].items.map((x) => x.entryId)).toEqual(['read-today', 'today'])
    expect(countReadsOnDay(convs, '2026-09-15', day)).toBe(2)
    expect(countReadsOnDay(convs, '2026-09-14', day)).toBe(1)
  })

  it('全部有上限，按重要性加时效排，旧的必读让给新的值得看', () => {
    const items = Array.from({ length: TODAY_READ_ALL_LIMIT + 8 }, (_, i) => ({
      id: `n${i}`,
      title: `条${i}`,
      valueScore: 4 as 4 | 5,
      publishedAt: now - i * 60_000,
      tags: i % 2 ? ['OpenAI'] : ['DeepSeek']
    }))
    items.push({
      id: 'stale',
      title: '很旧的必读',
      valueScore: 5 as const,
      publishedAt: now - 48 * 3600_000,
      tags: ['OpenAI']
    })
    const lanes = pickTodayReadLanes([rssConv('r', items)], now)
    expect(lanes[0].items).toHaveLength(TODAY_READ_ALL_LIMIT)
    expect(lanes[0].items.some((x) => x.entryId === 'stale')).toBe(false)
    expect(readFreshnessScore(now, now)).toBe(5)
    expect(readFreshnessScore(now - 48 * 3600_000, now)).toBe(1)
    expect(readRank({ score: 4, publishedAt: now }, now)).toBeGreaterThan(
      readRank({ score: 5, publishedAt: now - 48 * 3600_000 }, now)
    )
    expect(filterReadsByTag(lanes[0].items, 'OpenAI').every((x) => x.tags?.includes('OpenAI'))).toBe(
      true
    )
  })

  it('图谱池按任务切开，含全部消息，点标签按重要度时效排', () => {
    const convs = [
      rssConv('a', [
        { id: 'a-low', title: '甲一般', tags: ['OpenAI'], valueScore: 2, publishedAt: now },
        { id: 'a-high', title: '甲必读', tags: ['OpenAI'], valueScore: 5, publishedAt: now - 1000 }
      ]),
      rssConv('b', [{ id: 'b1', title: '乙稿', tags: ['DeepSeek'], valueScore: 1, publishedAt: now }])
    ]
    const all = collectRssTagPool(convs, TODAY_READS_ALL, now)
    const onlyA = collectRssTagPool(convs, 'a', now)
    const onlyB = collectRssTagPool(convs, 'b', now)
    expect(all.map((x) => x.entryId).sort()).toEqual(['a-high', 'a-low', 'b1'])
    expect(onlyA.map((x) => x.entryId)).toEqual(['a-high', 'a-low'])
    expect(onlyB.map((x) => x.entryId)).toEqual(['b1'])
    expect(pickReadsByTag(all, 'OpenAI', now).map((x) => x.entryId)).toEqual(['a-high', 'a-low'])
    expect(pickReadsByTag(onlyB, 'OpenAI', now)).toEqual([])
  })

  it('图谱只吃选定那天的消息，换日就换图', () => {
    const day = localDateKey(now)
    const yest = now - 36 * 3600_000
    const convs = [
      rssConv('a', [
        { id: 'today', title: '今天 OpenAI', tags: ['OpenAI'], valueScore: 2, publishedAt: now },
        { id: 'old', title: '昨天 DeepSeek', tags: ['DeepSeek'], valueScore: 5, publishedAt: yest }
      ])
    ]
    const todayPool = collectRssTagPool(convs, TODAY_READS_ALL, now, day)
    const yestPool = collectRssTagPool(convs, TODAY_READS_ALL, now, localDateKey(yest))
    expect(todayPool.map((x) => x.entryId)).toEqual(['today'])
    expect(yestPool.map((x) => x.entryId)).toEqual(['old'])
  })

  it('资讯按页轮播，到头回到第一页', () => {
    const items = pickTodayReads(
      [
        rssConv('rss1', [
          { id: 'a', title: '甲', valueScore: 5, publishedAt: now },
          { id: 'b', title: '乙', valueScore: 4, publishedAt: now - 1 },
          { id: 'c', title: '丙', valueScore: 3, publishedAt: now - 2 },
          { id: 'd', title: '丁', valueScore: 2, publishedAt: now - 3 }
        ])
      ],
      now,
      8
    )
    expect(items.map((x) => x.entryId)).toEqual(['a', 'b'])
    expect(sliceReadPage(items, 0).map((x) => x.entryId)).toEqual(['a', 'b'])
    expect(sliceReadPage(items, 1).map((x) => x.entryId)).toEqual(['a', 'b'])
    const many = Array.from({ length: 16 }, (_, i) => ({ entryId: `e${i}` })) as typeof items
    expect(sliceReadPage(many, 0, 6).map((x) => x.entryId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    expect(sliceReadPage(many, 2, 6).map((x) => x.entryId)).toEqual(['e10', 'e11', 'e12', 'e13', 'e14', 'e15'])
    expect(sliceReadPage(many, 2, 6)).toHaveLength(6)
  })
})

describe('pickTodayRecent', () => {
  it('按最近活动排，并跳过已经在要你看一眼里的任务', () => {
    const list = pickTodayRecent(
      [
        conv({ id: 'old', title: '旧的', updatedAt: now - 10_000 }),
        conv({ id: 'wait', title: '等你的那个', updatedAt: now }),
        conv({ id: 'fresh', title: '刚写过', updatedAt: now - 1000 })
      ],
      new Set(['wait'])
    )
    expect(list.map((x) => x.conversationId)).toEqual(['fresh', 'old'])
  })
})

describe('formatTodayStamp', () => {
  it('给出月日和星期', () => {
    expect(formatTodayStamp(new Date(2026, 8, 15, 12).getTime())).toBe('9月15日 周二')
  })
})

describe('calendar week', () => {
  const tue = new Date(2026, 8, 15, 12).getTime()

  it('坏日期不会算出 NaN 周轴', () => {
    const week = listWeekDays(Number.NaN, Number.NaN)
    expect(week).toHaveLength(7)
    expect(week.every((d) => Number.isFinite(d.date) && d.dow)).toBe(true)
    expect(localDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatDayCaption('NaN-NaN-NaN')).toBe('今天')
  })

  it('三个 RSS 任务即使当天没值得看也要留栏', () => {
    const lanes = pickTodayReadLanes(
      [
        rssConv('a', [{ id: 'a1', title: '甲', valueScore: 5 }]),
        rssConv('b', [{ id: 'b1', title: '乙', valueScore: 2 }]),
        rssConv('c', [])
      ],
      now
    )
    expect(lanes.map((l) => l.id)).toEqual([TODAY_READS_ALL, 'a', 'b', 'c'])
  })

  it('listWeekDays 给出含锚点的周一到周日', () => {
    const week = listWeekDays(tue, tue)
    expect(week.map((d) => d.dow)).toEqual(['一', '二', '三', '四', '五', '六', '日'])
    expect(week.map((d) => d.date)).toEqual([14, 15, 16, 17, 18, 19, 20])
    expect(week[1].isToday).toBe(true)
    expect(week[1].key).toBe('2026-09-15')
  })

  it('周日锚点仍落在当周周一', () => {
    const sun = new Date(2026, 8, 20, 12).getTime()
    expect(listWeekDays(sun, tue)[0].key).toBe('2026-09-14')
  })

  it('shiftDateKey 按日翻，跨月也不断', () => {
    expect(shiftDateKey('2026-09-15', -7)).toBe('2026-09-08')
    expect(shiftDateKey('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('formatDayCaption / formatWeekSpan', () => {
    expect(formatDayCaption('2026-09-15', tue)).toBe('今天')
    expect(formatDayCaption('2026-09-14', tue)).toBe('9月14日 周一')
    const week = listWeekDays(tue, tue)
    expect(formatWeekSpan(week)).toBe('9月14日–20日')
    expect(formatWeekSpan([{ key: '2026-08-31' }, { key: '2026-09-06' }])).toBe('8月31日–9月6日')
  })

  it('isTodayQuickTask 只认工作台快问', () => {
    expect(isTodayQuickTask({ promptTemplateId: TODAY_QUICK_TEMPLATE })).toBe(true)
    expect(isTodayQuickTask({ kind: 'rss', promptTemplateId: TODAY_QUICK_TEMPLATE })).toBe(false)
    expect(isTodayQuickTask({ kind: 'chat' })).toBe(false)
  })

  it('资讯按高度决定一页几条', () => {
    expect(fitReadPageSize(0)).toBe(3)
    expect(fitReadPageSize(200, 64, 3, 12)).toBe(3)
    expect(fitReadPageSize(520, 64, 3, 12)).toBe(8)
    expect(fitReadPageSize(0, 64, 3, 12, 5)).toBe(5)
    expect(fitReadPageSize(327, 64, 3, 12, 4)).toBe(4)
    expect(fitReadPageSize(336, 64, 3, 12, 4)).toBe(5)
    expect(fitReadPageSize(250, 64, 3, 12, 4)).toBe(4)
    expect(fitReadPageSize(200, 64, 3, 12, 4)).toBe(3)
  })

  it('月历从周一起，点月份能跳', () => {
    const grid = listMonthGrid('2026-09-15', tue)
    expect(grid).toHaveLength(42)
    expect(grid[0].key).toBe('2026-08-31')
    expect(grid.find((d) => d.key === '2026-09-15')?.isToday).toBe(true)
    expect(shiftMonthKey('2026-09-15', -1)).toBe('2026-08-15')
  })

  it('快问引用拼进引擎上下文', () => {
    expect(
      formatTodayQuickContext([
        { id: 'm1', kind: 'memo', title: '备', text: '下午开会' },
        { id: 'n1', kind: 'news', title: '某新闻', text: '来源甲' }
      ])
    ).toContain('【记录】备')
  })
})

describe('today reminders', () => {
  it('备忘录首行是标题，其余是正文', () => {
    expect(splitMemoNote('开会\n带纪要\n别迟到')).toEqual({ title: '开会', body: '带纪要\n别迟到' })
    expect(splitMemoNote('只写一行')).toEqual({ title: '只写一行', body: '' })
    expect(joinMemoNote({ title: '开会', body: '带纪要' })).toBe('开会\n带纪要')
  })

  it('旧备忘 text 升成 title', () => {
    const list = normalizeTodayMemos([{ id: 'a', text: '买菜', createdAt: now }])
    expect(list[0]).toEqual(expect.objectContaining({ id: 'a', title: '买菜', body: '' }))
  })

  it('日志不进到点弹窗，完成提醒和日志都算记录', () => {
    const due = takeDueReminders(
      [
        { id: 'log', title: '记', body: '', createdAt: now - 10_000, kind: 'log', remindAt: now - 1000 }
      ],
      now
    )
    expect(due.due).toEqual([])
    const rec = doneReminders([
      { id: 'log', title: '记', body: '', createdAt: now, kind: 'log' },
      { id: 'done', title: '办完', body: '', createdAt: now, completedAt: now }
    ])
    expect(rec.map((m) => m.id)).toEqual(['log', 'done'])
  })

  it('到点未响过的提醒只取一次', () => {
    const dueAt = now - 1000
    const first = takeDueReminders(
      [{ id: 'm', title: '开会', body: '', createdAt: now - 10_000, remindAt: dueAt }],
      now
    )
    expect(first.due.map((m) => m.id)).toEqual(['m'])
    expect(first.next[0].firedAt).toBe(now)
    const again = takeDueReminders(first.next, now + 1000)
    expect(again.due).toEqual([])
  })

  it('勾完记下持续时长', () => {
    const done = completeTodayMemo(
      { id: 'm', title: '写纪要', body: '', createdAt: now - 5 * 60_000 },
      now
    )
    expect(done.completedAt).toBe(now)
    expect(done.durationMs).toBe(5 * 60_000)
  })

  it('资讯栏全部固定第一，其余按手排顺序', () => {
    const ordered = orderReadLanes(
      [
        { id: TODAY_READS_ALL, label: '全部', items: [] },
        { id: 'b', label: '乙', items: [] },
        { id: 'a', label: '甲', items: [] }
      ],
      ['a', 'b']
    )
    expect(ordered.map((l) => l.id)).toEqual([TODAY_READS_ALL, 'a', 'b'])
  })
})
