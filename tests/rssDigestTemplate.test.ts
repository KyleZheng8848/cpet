import { describe, expect, it } from 'vitest'
import {
  assertRssDigestSkillFilesPresent,
  loadRssDigestSystemPrompt
} from '../src/main/rssDigestSkill'
import {
  buildRssDigestReport,
  DIGEST_MAX_ENTRIES,
  finalizeDigestMarkdown,
  isDigestFormat,
  isWeeklyDigestFormat,
  normalizeDigestMarkdown,
  pickDigestEntries,
  stripLegacyDigestSections
} from '../src/main/rssIntelligence'
import {
  formatDigestInfoWindow,
  RSS_DIGEST_TEMPLATES,
  RSS_DIGEST_TEMPLATE_GROUPS,
  rssDigestTemplatePrimarySection
} from '../src/shared/rssTask'
import type { RssTaskEntry } from '../src/shared/rssTask'

function entry(partial: Partial<RssTaskEntry> & Pick<RssTaskEntry, 'id' | 'title'>): RssTaskEntry {
  const body = `${partial.title} 正文足够长，用来走启发式简报骨架，避免单测去抓网页。`.repeat(6)
  return {
    feedId: 'f1',
    url: `https://example.com/${partial.id}`,
    fetchedAt: Date.now(),
    feedTitle: 'Demo',
    valueScore: 4,
    contentSource: 'extract',
    contentHtml: `<p>${body}</p>`,
    ...partial
  }
}

describe('rss digest templates', () => {
  const entries = [
    entry({ id: '1', title: 'Alpha launch', valueScore: 5 }),
    entry({ id: '2', title: 'Beta note', valueScore: 4 }),
    entry({ id: '3', title: 'Spam promo', valueScore: 1 })
  ]

  it('builds brief heuristic as 头条速览', async () => {
    const res = await buildRssDigestReport({
      entries,
      windowHours: 24,
      forceHeuristic: true,
      template: 'brief'
    })
    expect(res.ok).toBe(true)
    expect(res.template).toBe('brief')
    expect(res.title).toContain('Alpha launch')
    expect(res.title).not.toBe('本期概览')
    expect(res.title.length).toBeLessThanOrEqual(28)
    expect(res.markdown).toMatch(/^#\s+\S/)
    expect(res.markdown).toContain('信息窗口：')
    expect(res.markdown).toContain('## 必读头条')
    expect(res.markdown).toContain('## 资料来源')
    expect(res.markdown).toContain('[Demo：Alpha launch](https://example.com/1)')
    expect(res.markdown).not.toContain('可略过噪音')
    expect(res.markdown).not.toMatch(/^[●•]\s*https?:\/\//m)
    expect(isDigestFormat(res.markdown.replace(/\n*_.*_?\s*$/u, '').trim(), 'brief')).toBe(true)
  })

  it('builds followup heuristic as 决策简报', async () => {
    const res = await buildRssDigestReport({
      entries,
      windowHours: 48,
      forceHeuristic: true,
      template: 'followup'
    })
    expect(res.template).toBe('followup')
    expect(res.markdown).toContain('## 关键信号')
    expect(res.markdown).toContain('## 为什么重要')
    expect(res.markdown).toContain('## 该盯谁/盯什么')
    expect(res.markdown).toContain('## 资料来源')
    expect(res.markdown).not.toContain('值得跟进')
    expect(res.markdown).not.toContain('可暂缓')
    expect(res.markdown).toMatch(/\[Demo：.+\]\(https:\/\/example\.com\//)
    expect(isDigestFormat(res.markdown.replace(/\n*_.*_?\s*$/u, '').trim(), 'followup')).toBe(
      true
    )
  })

  it('builds daily / risks / changes heuristics', async () => {
    const daily = await buildRssDigestReport({
      entries,
      windowHours: 24,
      forceHeuristic: true,
      template: 'daily'
    })
    expect(daily.markdown).toContain('## 今日主线')
    expect(daily.markdown).toContain('## 今天优先')
    expect(isDigestFormat(daily.markdown.replace(/\n*_.*_?\s*$/u, '').trim(), 'daily')).toBe(true)

    const risks = await buildRssDigestReport({
      entries: [
        entry({ id: 'r1', title: 'Critical security breach disclosed', valueScore: 5 }),
        ...entries
      ],
      windowHours: 24,
      forceHeuristic: true,
      template: 'risks'
    })
    expect(risks.markdown).toContain('## 风险与争议')
    expect(isDigestFormat(risks.markdown.replace(/\n*_.*_?\s*$/u, '').trim(), 'risks')).toBe(true)

    const changes = await buildRssDigestReport({
      entries,
      windowHours: 48,
      forceHeuristic: true,
      template: 'changes'
    })
    expect(changes.markdown).toContain('## 本时段变动')
    expect(isDigestFormat(changes.markdown.replace(/\n*_.*_?\s*$/u, '').trim(), 'changes')).toBe(
      true
    )
  })

  it('covers all 12 forms with grouped catalog and heuristics', async () => {
    expect(RSS_DIGEST_TEMPLATES).toHaveLength(12)
    expect(RSS_DIGEST_TEMPLATE_GROUPS.map((g) => g.id)).toEqual([
      'scan',
      'decide',
      'archive',
      'publish'
    ])
    const extras = [
      'flash',
      'action',
      'wechat',
      'xhs',
      'report',
      'script'
    ] as const
    for (const template of extras) {
      const res = await buildRssDigestReport({
        entries,
        windowHours: 24,
        forceHeuristic: true,
        template
      })
      expect(res.ok).toBe(true)
      expect(res.template).toBe(template)
      const section = rssDigestTemplatePrimarySection(template)
      expect(res.markdown).toContain(`## ${section}`)
      expect(res.markdown).toContain('## 资料来源')
      expect(isDigestFormat(res.markdown.replace(/\n*_.*_?\s*$/u, '').trim(), template)).toBe(true)
    }
  })

  it('builds full heuristic skeleton by default', async () => {
    const res = await buildRssDigestReport({
      entries,
      windowHours: 24,
      forceHeuristic: true,
      skeletonReason: 'Agent 未完成'
    })
    expect(res.template).toBe('full')
    expect(res.mode).toBe('heuristic')
    expect(res.includedCount).toBe(3)
    expect(res.windowCount).toBe(3)
    expect(res.error).toMatch(/Agent 未完成|未走模型/)
    expect(res.markdown).toMatch(/^#\s+\S/)
    expect(res.markdown).toContain('信息窗口：')
    expect(res.markdown).toContain('模板骨架（非模型归纳）')
    expect(res.markdown).toContain('## 本期概览')
    expect(res.markdown).not.toContain('重点条目')
    expect(res.markdown).toMatch(/## (模型发布与更新|平台与产品|其他动态)/)
    expect(res.markdown).toContain('## 资料来源')
    expect(res.markdown).toContain('[Demo：Alpha launch](https://example.com/1)')
    expect(res.title).toMatch(/等\d+则/)
    expect(res.title).not.toContain('与')
    expect(res.title.length).toBeLessThanOrEqual(28)
  })

  it('caps digest entries by score, not raw order', () => {
    const many = Array.from({ length: DIGEST_MAX_ENTRIES + 10 }, (_, i) =>
      entry({
        id: `e${i}`,
        title: `Item ${i}`,
        valueScore: (i === 7 ? 5 : 1) as 1 | 5,
        publishedAt: 1000 + i
      })
    )
    const picked = pickDigestEntries(many, DIGEST_MAX_ENTRIES)
    expect(picked).toHaveLength(DIGEST_MAX_ENTRIES)
    expect(picked[0]?.id).toBe('e7')
  })

  it('normalizes bare URL bullets into markdown source links', () => {
    const md = normalizeDigestMarkdown(
      [
        '信息窗口：旧日期',
        '',
        '## 本期概览',
        '● https://example.com/1',
        '● 有叙事的要点 [Demo](https://example.com/2)',
        '',
        '## 资料来源',
        '● https://example.com/1'
      ].join('\n'),
      entries,
      '2026 年 7 月 22 日—7 月 28 日（北京时间）'
    )
    expect(md).toContain('信息窗口：2026 年 7 月 22 日—7 月 28 日（北京时间）')
    expect(md).toContain('[Demo：Alpha launch](https://example.com/1)')
    expect(md).toMatch(/## 资料来源[\s\S]*\[Demo：/)
    expect(md).not.toMatch(/^[●•]\s*https?:\/\/example\.com\/1\s*$/m)
    expect(isWeeklyDigestFormat(md)).toBe(true)
  })

  it('does not dump uncited high-score entries into 资料来源', () => {
    const many = [
      entry({ id: '1', title: 'Cited A', valueScore: 5, url: 'https://example.com/1' }),
      entry({ id: '2', title: 'Cited B', valueScore: 5, url: 'https://example.com/2' }),
      entry({ id: '3', title: 'Uncited noise', valueScore: 5, url: 'https://example.com/3' }),
      entry({ id: '4', title: 'Uncited spam', valueScore: 5, url: 'https://example.com/4' })
    ]
    const md = normalizeDigestMarkdown(
      [
        '# Agent 权限边界收紧',
        '信息窗口：旧',
        '',
        '## 必读头条',
        '● **A 越界进入真实机构** — 测试披露 [Demo](https://example.com/1)',
        '● **B 降价推高 Agent 铺开速度** — 最大降幅约八成 [Demo](https://example.com/2)',
        '',
        '## 资料来源',
        '● [旧](https://example.com/9)'
      ].join('\n'),
      many,
      '信息窗口测试',
      'brief'
    )
    const sources = md.split(/^##\s*资料来源\s*$/m)[1] || ''
    expect(sources).toContain('example.com/1')
    expect(sources).toContain('example.com/2')
    expect(sources).not.toContain('example.com/3')
    expect(sources).not.toContain('example.com/4')
    expect(sources).not.toContain('Uncited')
  })

  it('rejects legacy Top话题 / 时段概述 and reformats to weekly shape', () => {
    const legacy = [
      '# 市场监管总局开展光伏 · 苹果股价开盘跌超 9%',
      '',
      '## 时段概述',
      '7 月 25 日至 31 日，国内政策与苹果财报交织。',
      '',
      '## Top 话题',
      '- 核电审批',
      '  - 中核集团宣布 (IT之家): https://example.com/1',
      '- 苹果财报',
      '  - Cook 确认卸任 (9to5Mac): https://example.com/2',
      '',
      '## 可略过噪音',
      '- 广告'
    ].join('\n')

    expect(stripLegacyDigestSections(legacy)).not.toContain('Top 话题')
    expect(stripLegacyDigestSections(legacy)).not.toContain('可略过噪音')

    const info = formatDigestInfoWindow(168)
    const res = finalizeDigestMarkdown(legacy, entries, info, {
      hours: 168,
      template: 'full',
      title: '光伏合规与苹果财报'
    })
    expect(res.reformatted).toBe(true)
    expect(isWeeklyDigestFormat(res.markdown.replace(/\n*_.*_?\s*$/u, '').trim())).toBe(true)
    expect(res.markdown).toMatch(/^#\s+\S/)
    expect(res.markdown).toContain('信息窗口：')
    expect(res.markdown).toContain('## 本期概览')
    expect(res.markdown).toContain('## 资料来源')
    expect(res.markdown).not.toContain('Top 话题')
    expect(res.markdown).not.toContain('时段概述')
    expect(res.markdown).not.toContain('可略过噪音')
    expect(res.repairNote).toMatch(/形态|周报/)
  })

  it('loads cpet-rss-digest skill prompts for all templates', () => {
    const files = assertRssDigestSkillFilesPresent()
    expect(files.ok, files.missing.join(', ')).toBe(true)
    for (const id of RSS_DIGEST_TEMPLATES) {
      const prompt = loadRssDigestSystemPrompt(id)
      expect(prompt.length).toBeGreaterThan(800)
      expect(prompt).toContain('硬性格式')
      expect(prompt).toContain('价值门槛')
      expect(prompt).toContain('去掉 AI 味')
      expect(prompt).toContain('十二形态共用底线')
      expect(prompt).toContain('自检')
      expect(prompt).toContain('好坏示例')
      expect(prompt).not.toContain('未找到 skill')
    }
    expect(loadRssDigestSystemPrompt('brief')).toContain('必读头条')
    expect(loadRssDigestSystemPrompt('risks')).toContain('紧迫度')
    expect(loadRssDigestSystemPrompt('action')).toContain('伪待办')
    expect(loadRssDigestSystemPrompt('full')).toContain('有料才开')
    expect(loadRssDigestSystemPrompt('report')).toContain('总命题')
    expect(loadRssDigestSystemPrompt('flash')).toContain('气氛组')
    expect(loadRssDigestSystemPrompt('changes')).toContain('从旧到新')
    expect(loadRssDigestSystemPrompt('wechat')).toContain('一条主线写透')
    expect(loadRssDigestSystemPrompt('script')).toContain('单一 CTA')
    expect(loadRssDigestSystemPrompt('followup')).toContain('决定|批准|仅知情|监控')
    expect(loadRssDigestSystemPrompt('xhs')).toContain('整篇一条主线')
    expect(loadRssDigestSystemPrompt('daily')).toContain('可勾选')
  })
})
