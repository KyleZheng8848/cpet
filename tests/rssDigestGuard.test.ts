import { describe, expect, it } from 'vitest'
import {
  detectDigestHallucinations,
  matchEntryByUrl,
  repairDigestHallucinations
} from '../src/shared/rssDigestGuard'
import type { RssTaskEntry } from '../src/shared/rssTask'

function entry(partial: Partial<RssTaskEntry> & Pick<RssTaskEntry, 'id' | 'title' | 'url'>): RssTaskEntry {
  return {
    feedId: 'f1',
    fetchedAt: 1,
    feedTitle: 'Demo',
    valueScore: 4,
    ...partial
  }
}

describe('rssDigestGuard', () => {
  const entries = [
    entry({
      id: '1',
      title: 'Claude Opus 5 launch',
      url: 'https://www.anthropic.com/news/claude-opus-5',
      feedTitle: 'Anthropic'
    }),
    entry({
      id: '2',
      title: 'Kimi K3 weights',
      url: 'https://huggingface.co/moonshotai/Kimi-K3',
      feedTitle: 'Hugging Face'
    })
  ]

  it('matches entry by canonical / host url', () => {
    expect(
      matchEntryByUrl('https://anthropic.com/news/claude-opus-5?utm=1', entries)?.id
    ).toBe('1')
    expect(matchEntryByUrl('https://evil.example/fake', entries)).toBeUndefined()
  })

  it('detects unknown urls', () => {
    const issues = detectDigestHallucinations(
      '● see [x](https://evil.example/fake) and [ok](https://www.anthropic.com/news/claude-opus-5)',
      entries
    )
    expect(issues.some((i) => i.url?.includes('evil.example'))).toBe(true)
    expect(issues.some((i) => i.url?.includes('anthropic.com'))).toBe(false)
  })

  it('rewrites or removes hallucinated links and rebuilds sources', () => {
    const raw = [
      '信息窗口：2026 年 7 月 22 日—7 月 28 日（北京时间）',
      '',
      '## 本期概览',
      '● Anthropic 发布新模型 [Claude](https://evil.example/claude-fake)。',
      '● 开放权重见 [Kimi](https://huggingface.co/moonshotai/Kimi-K3)。',
      '● https://totally-fake.test/nope',
      '',
      '### 虚构融资快讯',
      '● 某公司完成巨额融资（无来源）。',
      '',
      '## 资料来源',
      '● [假](https://evil.example/claude-fake)'
    ].join('\n')

    const res = repairDigestHallucinations(raw, entries)
    expect(res.repaired).toBe(true)
    expect(res.markdown).toContain('https://huggingface.co/moonshotai/Kimi-K3')
    expect(res.markdown).toContain('## 资料来源')
    expect(res.markdown).not.toContain('evil.example')
    expect(res.markdown).not.toContain('totally-fake.test')
    expect(res.markdown).not.toContain('虚构融资快讯')
    expect(res.summary).toMatch(/校验/)
  })
})
