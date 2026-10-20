import { useSyncExternalStore } from 'react'
import { getUiLocale, setUiLocale, subscribeUiLocale, type UiLanguageState } from '@shared/i18n'

let state: UiLanguageState = { preference: 'system', locale: 'zh-CN' }
const listeners = new Set<() => void>()
function applyLanguage(next: UiLanguageState): void {
  state = next
  document.documentElement.lang = next.locale
  setUiLocale(next.locale)
  document.title = next.locale === 'en'
    ? document.title.replace('对话', 'Chat').replace('皮肤', 'Skins')
    : document.title.replace('Chat', '对话').replace('Skins', '皮肤')
  for (const listener of listeners) listener()
}

let initialized: Promise<void> | undefined
export function initializeUiLanguage(): Promise<void> {
  if (!initialized) {
    window.petApi.onUiLanguageChanged(applyLanguage)
    initialized = window.petApi.getUiLanguage().then(applyLanguage)
  }
  return initialized
}

/** Subscribe each component, including memoized leaves, without remounting the app. */
export function useUiLocale(): string {
  return useSyncExternalStore(subscribeUiLocale, getUiLocale, getUiLocale)
}
export function useUiLanguageState(): UiLanguageState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state)
}
