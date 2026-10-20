import { describe, expect, it } from 'vitest'
import { shouldPromptIdeApproval } from '../src/shared/approvalGate'

describe('shouldPromptIdeApproval', () => {
  it('审批卡已去掉：任何命令都不弹', () => {
    expect(
      shouldPromptIdeApproval({
        intercept: true,
        kind: 'shell',
        content: 'rm -rf build'
      })
    ).toBe(false)
    expect(shouldPromptIdeApproval({ intercept: true, kind: 'mcp', content: 'browser.open' })).toBe(
      false
    )
    expect(shouldPromptIdeApproval({ intercept: false, kind: 'shell', content: 'ls' })).toBe(false)
  })
})
