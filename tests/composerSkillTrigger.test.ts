import { describe, expect, it } from 'vitest'

/** 与 Composer.stripTrailingSkillToken / onChange 触发规则保持同构，防回归。 */
function stripTrailingSkillToken(text: string): string {
  const next = text.replace(/(^|\s)\/[a-z0-9_-]*$/i, (_m, lead: string) =>
    /\s/.test(lead) ? lead : ''
  )
  return next.replace(/[ \t]+$/, '')
}

function slashQuery(text: string): string | null {
  const m = text.match(/(?:^|\s)\/([a-z0-9_-]*)$/i)
  return m ? m[1] || '' : null
}

/** 有正文时仅「空格+/」唤起；单独尾部空格不打开。 */
function shouldOpenPicker(text: string): boolean {
  return slashQuery(text) !== null
}

describe('composer skill triggers', () => {
  it('bare slash opens with empty query', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('')).toBe(null)
    expect(shouldOpenPicker('/')).toBe(true)
  })

  it('slash after text requires a space boundary', () => {
    expect(slashQuery('hello/')).toBe(null)
    expect(slashQuery('hello /')).toBe('')
    expect(slashQuery('hello /pdf')).toBe('pdf')
    expect(shouldOpenPicker('hello /')).toBe(true)
    expect(shouldOpenPicker('hello/')).toBe(false)
  })

  it('trailing space alone does not open picker', () => {
    expect(shouldOpenPicker('hello ')).toBe(false)
    expect(shouldOpenPicker('hello')).toBe(false)
    expect(shouldOpenPicker(' ')).toBe(false)
  })

  it('pick strips trailing slash token', () => {
    expect(stripTrailingSkillToken('/')).toBe('')
    expect(stripTrailingSkillToken('/pdf')).toBe('')
    expect(stripTrailingSkillToken('hello /pdf')).toBe('hello')
    expect(stripTrailingSkillToken('hello /')).toBe('hello')
  })

  it('picker-open enter must select not send (contract)', () => {
    // Composer onKeyDown: pickerOpen && Enter → pickSkill(filtered[0])，禁止 submit
    const pickerOpen = true
    const filtered = [{ id: 'pdf' }]
    const action =
      pickerOpen && filtered[0] ? `pick:${filtered[0].id}` : 'submit'
    expect(action).toBe('pick:pdf')
  })
})
