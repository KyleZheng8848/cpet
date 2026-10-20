import { describe, expect, it } from 'vitest'
import {
  buildRssTagCloud,
  buildRssTagGraph,
  classifyRssTag,
  groundRssTags,
  heuristicRssTags,
  isNounEntityTag,
  normalizeRssTags,
  pickRelatedRssEntries,
  relatedRssScore,
  rssEntryTagList,
  stripRssChromePlain
} from '../src/shared/rssTags'
import type { RssTaskEntry } from '../src/shared/rssTask'

function entry(partial: Partial<RssTaskEntry> & { id: string; title: string }): RssTaskEntry {
  return {
    feedId: 'f1',
    url: `https://example.com/${partial.id}`,
    fetchedAt: 1,
    ...partial
  }
}

describe('rssTags', () => {
  it('丢掉太粗的标签', () => {
    expect(normalizeRssTags(['科技', 'OpenAI', 'AI', 'GPT-5', '新闻'])).toEqual(['OpenAI', 'GPT-5'])
  })

  it('只要名词实体，丢掉整句谓语', () => {
    expect(isNounEntityTag('外交部')).toBe(true)
    expect(isNounEntityTag('欧盟')).toBe(true)
    expect(isNounEntityTag('OpenAI')).toBe(true)
    expect(isNounEntityTag('外交部回应欧盟投资限制')).toBe(false)
    expect(isNounEntityTag('香港扩大经贸合作')).toBe(false)
    expect(isNounEntityTag('投资')).toBe(false)
    expect(isNounEntityTag('The')).toBe(false)
    expect(isNounEntityTag('Inc.')).toBe(false)
    expect(isNounEntityTag('Ltd')).toBe(false)
    expect(isNounEntityTag('20266')).toBe(false)
    expect(isNounEntityTag('GPT-5')).toBe(true)
    expect(normalizeRssTags(['The', 'Inc.', 'OpenAI, Inc.', 'OpenAI'])).toEqual(['OpenAI'])
    expect(normalizeRssTags(['外交部回应欧盟', '外交部', '欧盟'])).toEqual(['外交部', '欧盟'])
    expect(classifyRssTag('外交部')).toBe('org')
    expect(classifyRssTag('香港')).toBe('place')
    expect(classifyRssTag('GPT-5')).toBe('product')
    expect(classifyRssTag('网络安全法')).toBe('law')
    expect(classifyRssTag('保护主义')).toBe('topic')
  })

  it('丢掉订阅/推荐等牛皮癣词', () => {
    expect(normalizeRssTags(['订阅', '外交部', '热门推荐', '保护主义', '下一篇'])).toEqual([
      '外交部',
      '保护主义'
    ])
  })

  it('启发式从标题抽细词，不收粗类目', () => {
    const tags = heuristicRssTags({
      title: 'OpenAI releases GPT-5 in San Francisco',
      snippet: '模型发布'
    })
    expect(tags).toContain('OpenAI')
    expect(tags.some((t) => t.toLowerCase() === 'ai' || t === '新闻')).toBe(false)
  })

  it('只从正文打标签，不吃页面广告和相关推荐', () => {
    const tags = heuristicRssTags({
      title: '外交部：保护主义影响各国企业赴欧投资信心',
      snippet: '订阅 智能 手机 AI 技术 热门推荐',
      contentHtml:
        '<p>外交部发言人表示，保护主义换不来竞争力，影响各国企业赴欧投资信心。</p><div>下一篇 相关阅读 智能手机 下载APP</div>',
      feedTitle: '中新网'
    })
    expect(tags).toContain('外交部')
    expect(tags).toContain('保护主义')
    expect(tags).not.toContain('中新网')
    expect(tags.some((t) => ['订阅', '智能', '手机', 'AI', '技术', '下一篇'].includes(t))).toBe(false)
  })

  it('模型标签对不上正文就丢掉，改回正文实体', () => {
    const e = {
      title: '外交部回应欧盟投资限制',
      tags: ['手机', 'AI', '技术', '订阅'],
      contentHtml: '<p>外交部称保护主义影响赴欧投资。</p>'
    }
    expect(groundRssTags(e.tags, e)).toEqual([])
    expect(rssEntryTagList(e)).toContain('外交部')
    expect(rssEntryTagList(e)).not.toContain('手机')
  })

  it('砍掉相关阅读之后的牛皮癣纯文本', () => {
    const text = stripRssChromePlain(
      '正文说欧盟修订网络安全法。相关阅读 智能手机促销 下载APP 我的订阅'
    )
    expect(text).toContain('网络安全法')
    expect(text).not.toContain('智能手机')
    expect(text).not.toContain('我的订阅')
  })

  it('相关新闻按标签重叠排', () => {
    const seed = entry({ id: 'a', title: '甲', tags: ['OpenAI', 'GPT-5'] })
    const pool = [
      seed,
      entry({ id: 'b', title: '乙', tags: ['OpenAI', 'Sora'], valueScore: 5 }),
      entry({ id: 'c', title: '丙', tags: ['DeepSeek'], valueScore: 5 }),
      entry({ id: 'd', title: '丁', tags: ['OpenAI'], valueScore: 3 })
    ]
    expect(relatedRssScore(['OpenAI'], ['OpenAI', 'Sora'])).toBe(1)
    expect(pickRelatedRssEntries(pool, seed, 2).map((e) => e.id)).toEqual(['b', 'd'])
  })

  it('词云按条数和重要度一起加权', () => {
    const cloud = buildRssTagCloud(
      [
        { tags: ['OpenAI', 'GPT-5'], score: 5 },
        { tags: ['OpenAI'], score: 4 },
        { tags: ['DeepSeek'], score: 1 },
        { tags: ['DeepSeek'], score: 1 },
        { tags: ['DeepSeek'], score: 1 },
        { tags: ['DeepSeek'], score: 1 },
        { tags: ['DeepSeek'], score: 1 }
      ],
      8
    )
    expect(cloud[0].tag).toBe('OpenAI')
    expect(cloud[0].count).toBe(2)
    expect(cloud[0].weight).toBe(1)
    expect(cloud[0].kind).toBe('org')
    expect(cloud.find((x) => x.tag === 'DeepSeek')?.kind).toBe('org')
  })

  it('图谱沿用已打好的标签，不用长标题再滤掉', () => {
    const cloud = buildRssTagCloud(
      [
        {
          title: 'Standard Intelligence: Training General Intelligence in Pixel Space 很长的外文标题用来超过回滤门槛',
          tags: ['Sequoia', 'OpenAI', 'DeepSeek']
        }
      ],
      12
    )
    expect(cloud.map((x) => x.tag).sort()).toEqual(['DeepSeek', 'OpenAI', 'Sequoia'])
  })

  it('图谱有节点和共现边', () => {
    const g = buildRssTagGraph(
      [
        { tags: ['OpenAI', 'GPT-5'] },
        { tags: ['OpenAI', 'Sora'] }
      ],
      8
    )
    expect(g.nodes.some((n) => n.tag === 'OpenAI')).toBe(true)
    expect(g.edges.some((e) => e.a === 'openai' || e.b === 'openai')).toBe(true)
    const hub = g.nodes[0]
    expect(hub.tag).toBe('OpenAI')
    expect(hub.kind).toBe('org')
    const at = Object.fromEntries(g.nodes.map((n) => [n.tag, n]))
    const dist = (a: string, b: string): number =>
      Math.hypot(at[a].x - at[b].x, at[a].y - at[b].y)
    expect(dist('OpenAI', 'GPT-5')).toBeLessThan(40)
    expect(dist('OpenAI', 'Sora')).toBeLessThan(40)
    const split = buildRssTagGraph(
      [
        { tags: ['OpenAI', 'GPT-5'] },
        { tags: ['华为', '鸿蒙'] }
      ],
      8
    )
    const p = Object.fromEntries(split.nodes.map((n) => [n.tag, n]))
    const d = (a: string, b: string): number => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y)
    expect(d('OpenAI', 'GPT-5')).toBeLessThan(d('OpenAI', '华为'))
    expect(d('华为', '鸿蒙')).toBeLessThan(d('华为', 'OpenAI'))
  })

  it('同一簇里的点和标签不会糊成一团', () => {
    const g = buildRssTagGraph(
      [
        { tags: ['国家广播电视总局', '中国', '上海', '香港', '北京', '美国', '十五五'] },
        { tags: ['国家广播电视总局', '平陆运河'] },
        { tags: ['BofA', 'Federal'] },
        { tags: ['Morgan', '特朗普'] }
      ],
      18
    )
    const geo = g.nodes.filter((n) =>
      ['国家广播电视总局', '中国', '上海', '香港', '北京', '美国', '十五五', '平陆运河'].includes(n.tag)
    )
    expect(geo.length).toBeGreaterThanOrEqual(6)
    let minD = Infinity
    for (let i = 0; i < geo.length; i++) {
      for (let j = i + 1; j < geo.length; j++) {
        minD = Math.min(minD, Math.hypot(geo[i].x - geo[j].x, geo[i].y - geo[j].y))
      }
    }
    expect(minD).toBeGreaterThan(10)
    expect(g.nodes.every((n) => Number.isFinite(n.lx) && Number.isFinite(n.ly))).toBe(true)
  })

  it('相关新闻吃全部条目，分高的排前面', () => {
    const seed = entry({ id: 'a', title: '甲', tags: ['OpenAI'] })
    const pool = [
      seed,
      entry({ id: 'low', title: '低分同题', tags: ['OpenAI'], valueScore: 1 }),
      entry({ id: 'high', title: '高分同题', tags: ['OpenAI'], valueScore: 5 })
    ]
    expect(pickRelatedRssEntries(pool, seed, 2).map((e) => e.id)).toEqual(['high', 'low'])
  })
})
