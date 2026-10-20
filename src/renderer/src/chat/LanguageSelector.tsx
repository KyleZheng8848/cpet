import { useState } from 'react'
import { t as uiText, type UiLanguagePreference } from '@shared/i18n'
import { useUiLanguageState, useUiLocale } from '../i18n'

export function LanguageSelector(): JSX.Element {
  useUiLocale()
  const { preference } = useUiLanguageState()
  const [error, setError] = useState('')
  return (
    <section className="settings-section" id="settings-language">
      <h3>{uiText('界面语言')}</h3>
      <label className="settings-row between" htmlFor="ui-language">
        <span>{uiText('语言')}</span>
        <select id="ui-language" value={preference} onChange={(event) => {
          setError('')
          void window.petApi.setUiLanguage(event.target.value as UiLanguagePreference)
            .catch(() => setError(uiText('语言设置保存失败，请重试。')))
        }}>
          <option value="system">{uiText('跟随系统')}</option>
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <p className="settings-desc">{uiText('立即同步所有窗口；聊天内容和模型回复保持原文。')}</p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
