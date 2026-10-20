import { t as uiText } from './i18n'
/** 聊天窗外观 / 头像等 UI 常量（设置页与 Chat 共用）。 */

export type ChatThemeId =
  | 'paper'
  | 'ink'
  | 'mint'
  | 'dusk'
  | 'rose'
  | 'slate'
  | 'matcha'
  | 'aurora'
  | 'custom'

/** 自定义主题可调色（写入 CSS 变量）。 */
export interface ChatThemeCustom {
  paper: string
  paper2: string
  ink: string
  inkDim: string
  accent: string
  accent2: string
}

export const DEFAULT_CHAT_THEME_CUSTOM: ChatThemeCustom = {
  paper: '#f6efe0',
  paper2: '#fffdf6',
  ink: '#40382e',
  inkDim: '#877a66',
  accent: '#e07a5f',
  accent2: '#3f6b8f'
}

export const CHAT_THEMES: ReadonlyArray<{
  id: ChatThemeId
  name: string
  desc: string
  /** 设置页色块预览 */
  swatch: { bg: string; ink: string; accent: string }
}> = [
  {
    id: 'paper',
    get name() { return uiText("实验室") },
    get desc() { return uiText("冷白台面") },
    swatch: { bg: '#f4f6fa', ink: '#1d2129', accent: '#1677ff' }
  },
  {
    id: 'ink',
    get name() { return uiText("墨夜") },
    get desc() { return uiText("深色编辑台") },
    swatch: { bg: '#1a1d23', ink: '#e8eaed', accent: '#7eb8da' }
  },
  {
    id: 'mint',
    get name() { return uiText("青瓷") },
    get desc() { return uiText("冷调清爽") },
    swatch: { bg: '#e8f2ef', ink: '#243532', accent: '#2a7a6a' }
  },
  {
    id: 'dusk',
    get name() { return uiText("暮色") },
    get desc() { return uiText("暖暗琥珀") },
    swatch: { bg: '#2a221c', ink: '#f0e6d8', accent: '#d4a574' }
  },
  {
    id: 'rose',
    get name() { return uiText("蔷薇") },
    get desc() { return uiText("浅粉柔光") },
    swatch: { bg: '#f7ecef', ink: '#4a3038', accent: '#c45c7a' }
  },
  {
    id: 'slate',
    get name() { return uiText("岩灰") },
    get desc() { return uiText("冷静中性") },
    swatch: { bg: '#eef1f4', ink: '#2c333c', accent: '#5b7c99' }
  },
  {
    id: 'matcha',
    get name() { return uiText("抹茶") },
    get desc() { return uiText("草木清新") },
    swatch: { bg: '#eef3e4', ink: '#2f3a28', accent: '#6a8f4e' }
  },
  {
    id: 'aurora',
    get name() { return uiText("极光") },
    get desc() { return uiText("深色霓彩") },
    swatch: { bg: '#14182a', ink: '#e6eaf8', accent: '#6ec8c0' }
  },
  {
    id: 'custom',
    get name() { return uiText("自定义") },
    get desc() { return uiText("自选配色") },
    swatch: { bg: '#f0f0f0', ink: '#333333', accent: '#888888' }
  }
]

export const DEFAULT_CHAT_THEME: ChatThemeId = 'paper'

export const DEFAULT_USER_AVATAR = '🧑'

export const USER_AVATAR_CHOICES = [
  '🧑',
  '👩',
  '👨',
  '🧔',
  '👱',
  '🧓',
  '👩‍💻',
  '👨‍💻',
  '🧑‍🎨',
  '🧑‍🚀',
  '🦊',
  '🐱',
  '🐶',
  '🐼',
  '🐯',
  '🐸',
  '🐧',
  '🦉',
  '🦄',
  '🐙',
  '🍀',
  '🌸',
  '⭐',
  '🌙',
  '🔥',
  '💡',
  '🎯',
  '🎮',
  '📚',
  '☕'
] as const

export const WEATHER_CITY_PRESETS = [
  '上海',
  '北京',
  '深圳',
  '杭州',
  '广州',
  '成都',
  '南京',
  '武汉',
  '西安',
  '香港',
  '台北',
  '东京',
  '新加坡'
] as const

export type NewsSourceId = 'auto' | 'hn' | 'v2ex'

export const NEWS_SOURCES: ReadonlyArray<{ id: NewsSourceId; name: string; desc: string }> = [
  { id: 'auto', get name() { return uiText("自动") }, get desc() { return uiText("先 HN，失败再 V2EX") } },
  { id: 'hn', name: 'Hacker News', get desc() { return uiText("英文极客热帖") } },
  { id: 'v2ex', name: 'V2EX', get desc() { return uiText("中文社区热议") } }
]

export function isChatThemeId(v: unknown): v is ChatThemeId {
  return typeof v === 'string' && CHAT_THEMES.some((t) => t.id === v)
}

export function isNewsSourceId(v: unknown): v is NewsSourceId {
  return v === 'auto' || v === 'hn' || v === 'v2ex'
}

export function normalizeChatThemeCustom(raw: unknown): ChatThemeCustom {
  const d = DEFAULT_CHAT_THEME_CUSTOM
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const hex = (v: unknown, fb: string): string =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fb
  return {
    paper: hex(o.paper, d.paper),
    paper2: hex(o.paper2, d.paper2),
    ink: hex(o.ink, d.ink),
    inkDim: hex(o.inkDim, d.inkDim),
    accent: hex(o.accent, d.accent),
    accent2: hex(o.accent2, d.accent2)
  }
}

/** 把自定义色写到根节点 CSS 变量（data-theme=custom 时用）。 */
export function applyChatThemeCustom(el: HTMLElement, c: ChatThemeCustom): void {
  el.style.setProperty('--paper', c.paper)
  el.style.setProperty('--paper-2', c.paper2)
  el.style.setProperty('--paper-3', c.paper)
  el.style.setProperty('--ink', c.ink)
  el.style.setProperty('--ink-dim', c.inkDim)
  el.style.setProperty('--muted', c.inkDim)
  el.style.setProperty('--accent', c.accent)
  el.style.setProperty('--accent-2', c.accent2)
  el.style.setProperty('--header-from', c.paper2)
  el.style.setProperty('--header-to', c.paper)
  el.style.setProperty('--line', c.inkDim + '55')
  el.style.setProperty('--rule', c.ink + '18')
}

export function clearChatThemeCustom(el: HTMLElement): void {
  for (const k of [
    '--paper',
    '--paper-2',
    '--paper-3',
    '--ink',
    '--ink-dim',
    '--muted',
    '--accent',
    '--accent-2',
    '--header-from',
    '--header-to',
    '--line',
    '--rule'
  ]) {
    el.style.removeProperty(k)
  }
}

/** settings 里图片头像标记前缀，后接 userData/avatars 下的文件名。 */
export const USER_AVATAR_IMAGE_PREFIX = 'img:'

/** 界面展示值是否为图片（data URL；或尚未解析的 img: 标记）。 */
export function isUserAvatarImage(avatar: string | undefined | null): boolean {
  if (!avatar) return false
  return avatar.startsWith('data:image/') || avatar.startsWith(USER_AVATAR_IMAGE_PREFIX)
}

/** 是否像可用作头像的 emoji（拒纯字母/数字冒充）。 */
export function isLikelyEmoji(s: string): boolean {
  if (!s) return false
  try {
    return /\p{Extended_Pictographic}/u.test(s)
  } catch {
    return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)
  }
}

/** 截取首个 emoji 作头像（兼容 ZWJ 序列）；非 emoji 返回空。 */
export function sanitizeUserAvatar(raw: string): string {
  const t = raw.trim()
  if (!t || isUserAvatarImage(t)) return ''
  let first: string
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    first = [...seg.segment(t)][0]?.segment || ''
  } catch {
    first = Array.from(t)[0] || ''
  }
  if (!first || !isLikelyEmoji(first)) return ''
  return first.slice(0, 16)
}
