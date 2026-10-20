import { t as uiText } from './i18n'
/** RSS 整理语言：评分译标题，模型整理译正文。 */

export const RSS_ORGANIZE_LANGS = [
  { id: 'source', get label() { return uiText("保持原文") }, get hint() { return uiText("不改写标题和正文语言") } },
  { id: 'zh-Hans', get label() { return uiText("简体中文") }, get hint() { return uiText("整理时译成简体") } },
  { id: 'zh-Hant', get label() { return uiText("繁體中文") }, get hint() { return uiText("整理时译成繁體") } },
  { id: 'en', label: 'English', hint: 'Rewrite titles and bodies in English' },
  { id: 'ja', get label() { return uiText("日本語") }, get hint() { return uiText("タイトルと本文を日本語へ") } },
  { id: 'ko', label: '한국어', hint: '제목과 본문을 한국어로' }
] as const

export type RssOrganizeLang = (typeof RSS_ORGANIZE_LANGS)[number]['id']

export const DEFAULT_RSS_ORGANIZE_LANG: RssOrganizeLang = 'zh-Hans'

const LANG_IDS = new Set<string>(RSS_ORGANIZE_LANGS.map((x) => x.id))

export function isRssOrganizeLang(v: unknown): v is RssOrganizeLang {
  return typeof v === 'string' && LANG_IDS.has(v)
}

export function normalizeRssOrganizeLang(raw: unknown): RssOrganizeLang {
  return isRssOrganizeLang(raw) ? raw : DEFAULT_RSS_ORGANIZE_LANG
}

export function rssOrganizeLangMeta(id: RssOrganizeLang): (typeof RSS_ORGANIZE_LANGS)[number] {
  return RSS_ORGANIZE_LANGS.find((x) => x.id === id) || RSS_ORGANIZE_LANGS[1]
}

/** 模型指令里的语言名；source 表示保持原文。 */
export function rssOrganizeLangPhrase(id: RssOrganizeLang): string | null {
  switch (id) {
    case 'source':
      return null
    case 'zh-Hans':
      return '简体中文'
    case 'zh-Hant':
      return '繁體中文'
    case 'en':
      return 'English'
    case 'ja':
      return '日本語'
    case 'ko':
      return '한국어'
  }
}

export function rssOrganizeLangPrompt(id: RssOrganizeLang): string {
  const phrase = rssOrganizeLangPhrase(id)
  if (!phrase) {
    return '保持原文语言，不要翻译标题或正文。'
  }
  return `标题和正文一律写成${phrase}。专有名词、产品名、代码可保留原文。不要夹杂未要求的其它语言。`
}

export function rssEntryDisplayTitle(entry: {
  title?: string
  titleLocal?: string
}): string {
  const local = typeof entry.titleLocal === 'string' ? entry.titleLocal.trim() : ''
  if (local) return local
  return (entry.title || '').trim() || '无标题'
}

/** 从模型整理输出里拆出「标题：」行。 */
export function splitModelTitleAndBody(raw: string): { title?: string; body: string } {
  const text = (raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return { body: '' }
  const m = text.match(/^\s*(?:标题|Title|標題)\s*[:：]\s*(.+)\s*$/m)
  if (!m) return { body: text }
  const title = m[1].trim().replace(/^「|」$/g, '').slice(0, 80)
  const body = text.replace(m[0], '').replace(/^\s*\n/, '').trim()
  return { title: title || undefined, body: body || text }
}
