import { afterEach, describe, expect, it } from 'vitest'
import english from '../src/shared/locales/en.json'
import { getUiLocale, normalizeUiLanguage, resolveUiLocale, setUiLocale, subscribeUiLocale, t, uiLocaleTag } from '../src/shared/i18n'

afterEach(() => setUiLocale('zh-CN'))

describe('界面语言', () => {
  it('跟随系统语言，支持中文 BCP-47 标记，未支持语言回退英文', () => {
    expect(resolveUiLocale('system', 'zh-Hans-CN')).toBe('zh-CN')
    expect(resolveUiLocale('system', 'zh_TW')).toBe('zh-CN')
    expect(resolveUiLocale('system', 'en-GB')).toBe('en')
    expect(resolveUiLocale('system', 'fr-FR')).toBe('en')
    expect(resolveUiLocale('zh-CN', 'en-US')).toBe('zh-CN')
    expect(resolveUiLocale('en', 'zh-CN')).toBe('en')
    expect(normalizeUiLanguage('unknown')).toBe('system')
  })

  it('订阅窗口收到变更，同一语言不重复触发，解除订阅后不再通知', () => {
    const seen: string[] = []
    const off = subscribeUiLocale(() => seen.push(getUiLocale()))
    setUiLocale('en')
    setUiLocale('en')
    expect(uiLocaleTag()).toBe('en-US')
    off()
    setUiLocale('zh-CN')
    expect(seen).toEqual(['en'])
  })

  it('切换界面文案时保留插值中的中文、路径和用户内容', () => {
    setUiLocale('en')
    expect(t('设置')).toBe('Settings')
    expect(t('toString')).toBe('toString')
    expect(t('工作目录：{0}（点击切换）', ['/项目/日本語/emoji 🐾'])).toBe('Working directory: /项目/日本語/emoji 🐾 (click to change)')
    expect(t('没有对应词条的用户原文')).toBe('没有对应词条的用户原文')
    setUiLocale('zh-CN')
    expect(t('设置')).toBe('设置')
  })

  it('所有英文消息保留源文案的插值位置，避免计数或路径丢失', () => {
    for (const [source, translation] of Object.entries(english)) {
      const slots = (text: string): string[] => (text.match(/\{\d+\}/g) || []).sort()
      expect(slots(translation), source).toEqual(slots(source))
      expect(translation.trim(), source).not.toBe('')
    }
  })
})
