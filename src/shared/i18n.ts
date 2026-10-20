import english from './locales/en.json'

export type UiLocale = 'zh-CN' | 'en'
export type UiLanguagePreference = 'system' | UiLocale
export type UiLanguageState = { preference: UiLanguagePreference; locale: UiLocale }

export function normalizeUiLanguage(raw: unknown): UiLanguagePreference {
  return raw === 'zh-CN' || raw === 'en' ? raw : 'system'
}

export function resolveUiLocale(preference: UiLanguagePreference, systemLanguage: string): UiLocale {
  if (preference !== 'system') return preference
  return /^zh(?:[-_]|$)/i.test(systemLanguage) ? 'zh-CN' : 'en'
}

let locale: UiLocale = 'zh-CN'
const listeners = new Set<() => void>()
export function setUiLocale(next: UiLocale): void {
  if (next === locale) return
  locale = next
  for (const listener of listeners) listener()
}
export function getUiLocale(): UiLocale { return locale }
export function uiLocaleTag(): string { return locale === 'en' ? 'en-US' : 'zh-CN' }
export function subscribeUiLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Keys are source UI copy; user text and model output never pass through this function. */
export function t(source: string, values: ReadonlyArray<unknown> = []): string {
  const messages = english as Record<string, string>
  const text = locale === 'en' && Object.hasOwn(messages, source) ? messages[source]! : source
  return text.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)]
    return value === undefined ? match : String(value)
  })
}
