import { describe, expect, it } from 'vitest'
import {
  articleHtmlToMarkdown,
  rssDigestToMarkdown,
  rssEntryToMarkdown,
  safeRssExportFilename
} from '../src/shared/rssExport'
import type { RssDigestRecord, RssTaskEntry } from '../src/shared/rssTask'

describe('rssExport', () => {
  it('converts article html to markdown', () => {
    const md = articleHtmlToMarkdown(
      '<h2>Hello</h2><p>Hi <strong>there</strong> and <a href="https://ex.com">link</a>.</p><ul><li>One</li></ul>'
    )
    expect(md).toContain('## Hello')
    expect(md).toContain('**there**')
    expect(md).toContain('[link](https://ex.com)')
    expect(md).toContain('- One')
  })

  it('exports digest markdown with title and trailing meta', () => {
    const d: RssDigestRecord = {
      id: 'd1',
      title: '开源与安全周刊',
      createdAt: new Date('2026-08-01T08:30:00').getTime(),
      windowHours: 24,
      template: 'brief',
      markdown: '# 开源与安全周刊\n\n信息窗口：x\n\n## 本期概览\n\n● A',
      mode: 'model',
      entryCount: 3
    }
    const md = rssDigestToMarkdown(d)
    expect(md.startsWith('# 开源与安全周刊')).toBe(true)
    expect(md).toContain('## 本期概览')
    expect(md).toContain('- 形式：头条速览')
    expect(md).toContain('- 来源：模型')
  })

  it('exports entry with link and body', () => {
    const entry: RssTaskEntry = {
      id: 'e1',
      feedId: 'f1',
      title: 'Alpha launch',
      url: 'https://example.com/1',
      feedTitle: 'Demo',
      contentHtml: '<p>Body <em>text</em></p>',
      fetchedAt: 1,
      publishedAt: new Date('2026-08-01T10:00:00').getTime(),
      valueScore: 5
    }
    const md = rssEntryToMarkdown(entry)
    expect(md).toContain('# Alpha launch')
    expect(md).toContain('https://example.com/1')
    expect(md).toContain('Demo')
    expect(md).toContain('*text*')
    expect(safeRssExportFilename('Alpha launch')).toMatch(/\.md$/)
  })
})
