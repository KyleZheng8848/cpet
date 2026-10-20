import { describe, expect, it } from 'vitest'
import { engineLoginHint, humanizeRssIntelError, isRetriableAgentError } from '../src/shared/agentErrors'

describe('humanizeRssIntelError', () => {
  it('maps bare fetch failed to Chinese fallback note', () => {
    expect(humanizeRssIntelError('fetch failed')).toMatch(/连不上/)
    expect(humanizeRssIntelError('直连 custom-api请求失败：fetch failed')).toMatch(/连不上|网络/)
  })

  it('keeps short unknown messages', () => {
    expect(humanizeRssIntelError('模型未返回 JSON 数组')).toBe('模型未返回 JSON 数组')
  })

  it('maps Agent incomplete / empty to skeleton-aware Chinese', () => {
    expect(humanizeRssIntelError('Agent 未完成')).toMatch(/简版/)
    expect(humanizeRssIntelError('Agent 返回空内容')).toMatch(/简版/)
  })
})

describe('engineLoginHint', () => {
  it('Cursor 只提 cursor-agent，不提 claude', () => {
    expect(engineLoginHint('cursor')).toContain('cursor-agent login')
    expect(engineLoginHint('cursor')).not.toMatch(/claude/i)
  })

})

describe('isRetriableAgentError', () => {
  it('treats fetch failed as retriable', () => {
    expect(isRetriableAgentError('fetch failed')).toBe(true)
  })
})
