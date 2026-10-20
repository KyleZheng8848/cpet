import { describe, expect, it } from 'vitest'
import {
  activeRssAnalysisQuotes,
  addRssAnalysisQuote,
  buildRssAskContext,
  clearRssAnalysisQuote,
  emptyRssTaskState,
  removeRssAnalysisQuote,
  type RssTaskEntry,
  type RssTaskState
} from '../src/shared/rssTask'

function entry(partial: Partial<RssTaskEntry> & { id: string; title: string }): RssTaskEntry {
  return {
    feedId: 'f1',
    url: `https://example.com/${partial.id}`,
    publishedAt: Date.now(),
    fetchedAt: Date.now(),
    ...partial
  }
}

describe('rss analysis quote', () => {
  it('appends multiple quotes and injects numbered block', () => {
    let state: RssTaskState = {
      ...emptyRssTaskState(),
      items: [entry({ id: 'e1', title: 'Hello' })],
      selectedId: 'e1',
      readerMode: 'extract'
    }
    state = addRssAnalysisQuote(state, 'first selected paragraph for analysis')
    state = addRssAnalysisQuote(state, 'second selected paragraph for analysis')
    state = addRssAnalysisQuote(state, 'first selected paragraph for analysis') // dedupe
    expect(activeRssAnalysisQuotes(state)).toHaveLength(2)
    const ctx = buildRssAskContext(state)
    expect(ctx).toContain('【用户划词 · 2 段】')
    expect(ctx).toContain('1. first selected')
    expect(ctx).toContain('2. second selected')
    expect(ctx).toContain('Hello')
  })

  it('ignores quotes after switching selection', () => {
    let state: RssTaskState = {
      ...emptyRssTaskState(),
      items: [entry({ id: 'e1', title: 'A' }), entry({ id: 'e2', title: 'B' })],
      selectedId: 'e1'
    }
    state = addRssAnalysisQuote(state, 'quote only for first entry here')
    state = { ...state, selectedId: 'e2' }
    expect(activeRssAnalysisQuotes(state)).toHaveLength(0)
    expect(buildRssAskContext(state)).not.toContain('【用户划词】')
  })

  it('removes one segment or clears current entry quotes', () => {
    let state: RssTaskState = {
      ...emptyRssTaskState(),
      items: [entry({ id: 'e1', title: 'Hello' })],
      selectedId: 'e1'
    }
    state = addRssAnalysisQuote(state, 'enough characters to keep as quote a')
    state = addRssAnalysisQuote(state, 'enough characters to keep as quote b')
    const id = activeRssAnalysisQuotes(state)[0].id
    state = removeRssAnalysisQuote(state, id)
    expect(activeRssAnalysisQuotes(state)).toHaveLength(1)
    state = clearRssAnalysisQuote(state)
    expect(activeRssAnalysisQuotes(state)).toHaveLength(0)
  })

  it('migrates legacy single analysisQuote', () => {
    const state = {
      ...emptyRssTaskState(),
      items: [entry({ id: 'e1', title: 'Hello' })],
      selectedId: 'e1',
      analysisQuote: {
        text: 'legacy single quote text here',
        forId: 'e1',
        at: 1
      }
    } as RssTaskState
    expect(activeRssAnalysisQuotes(state)[0]?.text).toContain('legacy single')
  })
})
