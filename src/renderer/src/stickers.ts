/** 表情包：对话回复时按语境挑选，也用于宠物气泡展示。 */

export interface Sticker {
  id: string
  emoji: string
  label?: string
  image?: string
}

const CATALOG: Record<string, Sticker> = {
  ok: { id: 'ok', emoji: '👌', label: '没问题' },
  celebrate: { id: 'celebrate', emoji: '🎉', label: '搞定啦' },
  clap: { id: 'clap', emoji: '👏', label: '厉害' },
  thumbs: { id: 'thumbs', emoji: '👍', label: '可以' },
  heart: { id: 'heart', emoji: '🥰', label: '谢谢' },
  laugh: { id: 'laugh', emoji: '😂', label: '哈哈哈' },
  grin: { id: 'grin', emoji: '😄', label: '开心' },
  think: { id: 'think', emoji: '🤔', label: '让我想想' },
  work: { id: 'work', emoji: '💪', label: '开干' },
  coffee: { id: 'coffee', emoji: '☕', label: '歇会儿' },
  cry: { id: 'cry', emoji: '😭', label: '太难了' },
  shock: { id: 'shock', emoji: '😱', label: '震惊' },
  sweat: { id: 'sweat', emoji: '😅', label: '汗流浃背' },
  bug: { id: 'bug', emoji: '🐛', label: '有 bug' },
  fire: { id: 'fire', emoji: '🔥', label: '燃起来了' },
  cool: { id: 'cool', emoji: '😎', label: '稳' },
  wave: { id: 'wave', emoji: '👋', label: '你好呀' },
  pet: { id: 'pet', emoji: '🐾', label: '摸摸' },
  moon: { id: 'moon', emoji: '🌙', label: '晚安' },
  question: { id: 'question', emoji: '❓', label: '啥？' },
  warn: { id: 'warn', emoji: '⚠️', label: '注意' },
  nerd: { id: 'nerd', emoji: '🤓', label: '技术活' },
  money: { id: 'money', emoji: '💰', label: '发财' },
  doge: { id: 'doge', emoji: '🐕', label: '柴犬点头' },
  frog: { id: 'frog', emoji: '🐸', label: '呱呱' },
  kun: { id: 'kun', emoji: '🏀', label: '练习时长' }
}

const RULES: Array<{ re: RegExp; ids: string[] }> = [
  { re: /完成|搞定|好了|成功|done|success|✓|✅|finished/i, ids: ['celebrate', 'ok', 'clap', 'thumbs'] },
  { re: /错误|失败|error|bug|崩|异常|不行|无法/i, ids: ['cry', 'shock', 'sweat', 'bug', 'warn'] },
  { re: /谢谢|感谢|thanks|thx/i, ids: ['heart', 'clap', 'wave'] },
  { re: /哈哈|笑|搞笑|hh|lol|有趣/i, ids: ['laugh', 'grin', 'doge'] },
  { re: /为什么|怎么|如何|？|\?|吗$/i, ids: ['think', 'question'] },
  { re: /代码|函数|api|bug|git|npm|ts|react/i, ids: ['nerd', 'work', 'fire'] },
  { re: /睡觉|晚安|休息|累了/i, ids: ['moon', 'coffee'] },
  { re: /你好|嗨|hello|hi/i, ids: ['wave', 'pet', 'grin'] }
]

const FALLBACK = [
  'ok',
  'grin',
  'pet',
  'think',
  'cool',
  'thumbs',
  'frog',
  'doge',
  'kun',
  'fire'
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function fromId(id: string, image?: string): Sticker {
  const base = CATALOG[id] ?? CATALOG.ok
  return image ? { ...base, image } : base
}

function maybeImage(imagePool?: string[]): string | undefined {
  if (!imagePool?.length) return undefined
  if (Math.random() > 0.38) return undefined
  return pick(imagePool)
}

/** 根据回复正文挑一张表情包。 */
export function pickStickerForText(text: string, imagePool?: string[]): Sticker {
  const t = text.trim()
  if (!t) return fromId(pick(FALLBACK), maybeImage(imagePool))
  for (const rule of RULES) {
    if (rule.re.test(t)) return fromId(pick(rule.ids), maybeImage(imagePool))
  }
  return fromId(pick(FALLBACK), maybeImage(imagePool))
}

/** 按 agent 状态挑表情（宠物气泡用）。 */
export function pickStickerForState(
  state: 'done' | 'error' | 'talking' | 'thinking',
  imagePool?: string[]
): Sticker {
  const img = maybeImage(imagePool)
  switch (state) {
    case 'done':
      return fromId(pick(['celebrate', 'ok', 'clap', 'thumbs', 'cool']), img)
    case 'error':
      return fromId(pick(['cry', 'shock', 'sweat', 'bug']), img)
    case 'thinking':
      return fromId(pick(['think', 'nerd', 'work']), img)
    case 'talking':
      return fromId(pick(['grin', 'work', 'think']), img)
    default:
      return fromId(pick(FALLBACK), img)
  }
}
