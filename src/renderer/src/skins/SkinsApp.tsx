import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useState } from 'react'
import { SKINS, isChatThemeId, type SkinId } from '@shared/types'
import {
  applyChatThemeCustom,
  clearChatThemeCustom,
  DEFAULT_CHAT_THEME,
  normalizeChatThemeCustom,
  type ChatThemeId
} from '@shared/chatUi'
import { describeAppearance } from '@shared/skinMarket'
import { SkinMarketPanel } from './SkinMarket'

/** 贴宠物旁的独立皮肤窗：下载完即可选用，管理也集中在此。 */
export function SkinsApp(): JSX.Element {
  useUiLocale()
  const [petSkin, setPetSkin] = useState<SkinId>('violet')
  const [imageSkinId, setImageSkinId] = useState<string | null>(null)
  const [chatTheme, setChatTheme] = useState<ChatThemeId>(DEFAULT_CHAT_THEME)

  function applyThemeFromSettings(s: {
    skin?: SkinId
    imageSkin?: string | null
    chatTheme?: string
    chatThemeCustom?: unknown
  }): void {
    if (s.skin) setPetSkin(s.skin)
    setImageSkinId(s.imageSkin ?? null)
    const theme = isChatThemeId(s.chatTheme) ? s.chatTheme : DEFAULT_CHAT_THEME
    setChatTheme(theme)
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    if (theme === 'custom') {
      applyChatThemeCustom(root, normalizeChatThemeCustom(s.chatThemeCustom))
    } else {
      clearChatThemeCustom(root)
    }
  }

  useEffect(() => {
    void window.petApi.getSettings().then(applyThemeFromSettings)
    const offSkin = window.petApi.onPetSkin((id) => setPetSkin(id))
    const offImage = window.petApi.onPetImageSkin((pack) => {
      setImageSkinId(pack?.id ?? null)
    })
    const offTheme = window.petApi.onChatTheme((payload) => {
      applyThemeFromSettings({
        chatTheme: payload.theme,
        chatThemeCustom: payload.custom
      })
    })
    const onFocus = (): void => {
      void window.petApi.getSettings().then(applyThemeFromSettings)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      offSkin()
      offImage()
      offTheme()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const appearance = describeAppearance({
    skin: petSkin,
    skinName: SKINS.find((s) => s.id === petSkin)?.name,
    imageSkin: imageSkinId
  })

  return (
    <>
      <div className="skin-window-drag" data-theme-sync={chatTheme}>
        <div className="skin-window-title-block">
          <span className="skin-window-title">{uiText("皮肤")}</span>
          <span className="skin-window-sub">
            {uiText("当前 ·")}<strong>{appearance.label}</strong>
            <span aria-hidden> · </span>
            {appearance.detail}
          </span>
        </div>
        <button
          type="button"
          className="settings-btn ghost tiny"
          aria-label={uiText("关闭")}
          onClick={() => window.petApi.closeSkins()}
        >
          {uiText("关闭")}</button>
      </div>
      <div className="skin-window-body">
        <SkinMarketPanel
          petSkin={petSkin}
          imageSkinId={imageSkinId}
          standalone
          onClose={() => window.petApi.closeSkins()}
          onApplied={() => {
            void window.petApi.getSettings().then(applyThemeFromSettings)
          }}
        />
      </div>
    </>
  )
}
