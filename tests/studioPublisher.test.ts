import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudioPublisher } from '../src/renderer/src/chat/StudioPublisher'
import { applicationMenuTemplate } from '../src/main/appMenu'
import { CPET_REPOSITORY, CPET_COPYRIGHT } from '../src/shared/appIdentity'
import { setUiLocale } from '../src/shared/i18n'
import type { MenuItemConstructorOptions } from 'electron'

afterEach(() => setUiLocale('zh-CN'))

describe('SofunAI publisher identity', () => {
  it('renders the real project URL and publisher in each UI language', () => {
    for (const [locale, label] of [['en', 'View source on GitHub'], ['zh-CN', 'GitHub 开源主页']] as const) {
      setUiLocale(locale)
      const html = renderToStaticMarkup(createElement(StudioPublisher, { openExternal: () => {} }))
      expect(html).toContain(`href="${CPET_REPOSITORY}"`)
      expect(html).toContain(label)
      expect(html).toContain('SofunAI Studio')
      expect(html).toContain(CPET_COPYRIGHT)
      expect(html).toContain('aria-hidden="true"')
    }
  })

  it('native About entry follows language and invokes the application callback', () => {
    let opened = 0
    for (const [locale, label] of [['en', 'About CPET'], ['zh-CN', '关于 CPET']] as const) {
      setUiLocale(locale)
      const template = applicationMenuTemplate('darwin', () => { opened += 1 })
      const submenu = template[0].submenu as MenuItemConstructorOptions[]
      expect(submenu[0].label).toBe(label)
      ;(submenu[0].click as () => void)()
    }
    expect(opened).toBe(2)
  })
})
