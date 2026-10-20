/** 快问 / 桌宠朗读（TTS）配置与常量。 */

/** off=关；edge=EdgeTTS（默认引擎，需联网）；local=CosyVoice 本机；system=旧值，归一为 off */
export type TtsMode = 'off' | 'edge' | 'local' | 'system'

/** 本机 CosyVoice 自定义音色。 */
export type TtsCustomVoice = {
  id: string
  name: string
  /** 参考音频绝对路径（wav）。 */
  promptWav: string
  /** 参考音频对应文本。 */
  promptText: string
  createdAt: number
}

export const DEFAULT_COSYVOICE_MODEL = 'iic/CosyVoice-300M'
export const DEFAULT_COSYVOICE_PORT = 18765
/** 官方示例参考文本（与默认 prompt wav 配套）。 */
export const DEFAULT_COSYVOICE_PROMPT_TEXT = '希望你以后能够做的比我还好呦。'

/** 小智默认同款：晓晓 */
export const DEFAULT_EDGE_TTS_VOICE = 'zh-CN-XiaoxiaoNeural'

/**
 * Edge 当前仍提供的音色（2026-08 实测 getVoices）。
 * 旧列表里晓辰/晓涵等已下架，勿再展示。
 */
export const EDGE_TTS_VOICE_PRESETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（男）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（男）' },
  { id: 'zh-CN-YunjianNeural', label: '云健（男）' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏（男）' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北（辽宁）' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮（陕西）' },
  { id: 'zh-HK-HiuMaanNeural', label: '晓曼（粤·港）' },
  { id: 'zh-HK-HiuGaaiNeural', label: '晓佳（粤）' },
  { id: 'zh-HK-WanLungNeural', label: '云龙（粤·男）' },
  { id: 'zh-TW-HsiaoChenNeural', label: '晓臻（台湾）' },
  { id: 'zh-TW-HsiaoYuNeural', label: '晓雨（台湾）' },
  { id: 'zh-TW-YunJheNeural', label: '云哲（台湾·男）' },
  { id: 'en-US-JennyNeural', label: 'Jenny（英）' },
  { id: 'en-US-GuyNeural', label: 'Guy（英）' }
]

const EDGE_TTS_VOICE_IDS = new Set(EDGE_TTS_VOICE_PRESETS.map((v) => v.id))

/** 已下架/不可用 ShortName → 最近可用音色 */
const EDGE_TTS_VOICE_ALIASES: Readonly<Record<string, string>> = {
  'zh-CN-XiaochenNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaohanNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaomengNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaomoNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoqiuNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoruiNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoshuangNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoxuanNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoyanNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoyouNeural': 'zh-CN-XiaoxiaoNeural',
  'zh-CN-YunfengNeural': 'zh-CN-YunxiNeural',
  'zh-CN-YunhaoNeural': 'zh-CN-YunyangNeural'
}

export function normalizeTtsMode(raw: unknown): TtsMode {
  if (raw === 'off' || raw === false) return 'off'
  if (raw === 'edge' || raw === 'edgetts' || raw === 'edge-tts') return 'edge'
  // CosyVoice 本机（含旧云端 api 映射）
  if (
    raw === 'local' ||
    raw === 'cosyvoice' ||
    raw === 'api' ||
    raw === 'cloud'
  ) {
    return 'local'
  }
  // 旧「系统朗读」收进关
  if (raw === 'system') return 'off'
  // 默认关：未配置 / 未知值都不自动开朗读
  return 'off'
}

/** 是否已开启发声引擎（Edge 或 CosyVoice）。 */
export function isTtsEngineOn(mode: unknown): boolean {
  const m = normalizeTtsMode(mode)
  return m === 'edge' || m === 'local'
}

export function normalizeEdgeTtsVoice(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim().slice(0, 120) : ''
  if (!v) return DEFAULT_EDGE_TTS_VOICE
  const aliased = EDGE_TTS_VOICE_ALIASES[v]
  if (aliased) return aliased
  if (EDGE_TTS_VOICE_IDS.has(v)) return v
  // 未知/已下架：回默认，避免设置里选了却合成失败
  return DEFAULT_EDGE_TTS_VOICE
}

export function clampTtsRate(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.min(2, Math.max(0.5, Math.round(n * 100) / 100))
}

export function clampTtsPitch(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.min(2, Math.max(0, Math.round(n * 100) / 100))
}

/** 旧云端 OpenAI TTS 模型名，不能当 CosyVoice / ModelScope id。 */
function isLegacyOpenAiTtsModel(v: string): boolean {
  return /^(tts-1(-hd)?|gpt-4o-mini-tts)$/i.test(v)
}

export function normalizeCosyvoiceModel(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v || isLegacyOpenAiTtsModel(v)) return DEFAULT_COSYVOICE_MODEL
  // 允许本地目录，或 ModelScope/HF 风格 id（含 /）
  if (v.includes('/') || v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v)) {
    return v.slice(0, 200)
  }
  // 裸短名（如旧 ttsVoice 误写入）一律回默认
  if (!/CosyVoice/i.test(v)) return DEFAULT_COSYVOICE_MODEL
  return v.slice(0, 200)
}

export function normalizeCosyvoicePort(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_COSYVOICE_PORT
  return Math.min(65535, Math.max(1024, Math.floor(n)))
}

/**
 * 朗读前清洗：去掉 markdown 标记与过程/思考类旁白，只留可说的正文。
 * 在 clip 之前调用；各引擎共用，避免把 `**加粗**`、工具过程读出来。
 */
export function sanitizeTtsSpeakText(raw: string): string {
  let t = (raw || '').replace(/\r\n/g, '\n')

  // 代码块整段丢掉（朗读代码体验差）
  t = t.replace(/```[\s\S]*?```/g, '\n')
  t = t.replace(/~~~[\s\S]*?~~~/g, '\n')
  // 行内代码只留内容
  t = t.replace(/`([^`]+)`/g, '$1')

  // 图片 / 链接：留可见文字
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // 标题、引用
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/^>\s?/gm, '')

  // 加粗 / 斜体 / 删除线（先成对剥，再清残留）
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/__([^_]+)__/g, '$1')
  t = t.replace(/~~([^~]+)~~/g, '$1')
  t = t.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1$2')
  t = t.replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1$2')
  t = t.replace(/\*\*/g, '')
  t = t.replace(/__/g, '')
  t = t.replace(/~~/g, '')
  t = t.replace(/(?<![\w/])\*+(?![\w/])/g, '')

  // HTML
  t = t.replace(/<\/?[^>]+>/g, ' ')

  // 过程 / 思考 / 工具旁白行（中英常见前缀）
  t = t.replace(
    /^(?:#{1,6}\s*)?(?:思考|推理|过程|旁白|工具|命令|技能|状态|分析|规划|计划|步骤说明|内部独白)\s*[：:].*$/gm,
    ''
  )
  t = t.replace(
    /^(?:Thinking|Reasoning|Analysis|Tool(?:\s*call)?|Command|Status|Process)\s*[：:].*$/gim,
    ''
  )
  // 【技能…】/【过程…】：去掉标记及同行旁白（不跨空行吞正文）
  t = t.replace(/【[^】]*(?:技能|过程|思考|推理|工具)[^】]*】[^\n]*/g, '')

  // 列表符号不影响听感，去掉标记留正文
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')

  // 表格竖线简化
  t = t.replace(/\|/g, ' ')

  // emoji / 绘文字：不朗读（含组合序列、肤色、旗帜、键帽等）
  t = t.replace(TTS_EMOJI_RE, '')

  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * 覆盖常见 emoji 区段 + ZWJ/VS16/肤色/键帽/旗帜。
 * 用 Unicode property 时部分运行时不全，故以范围为主。
 */
const TTS_EMOJI_RE =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)|(?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:[0-9#*]\uFE0F?\u20E3)/gu

/** 单次朗读总字数上限（清洗后）。 */
export const TTS_MAX_CHARS = 900
/**
 * CosyVoice-300M 本机 RTF 常 >4：切太碎会「念几个字等几秒」。
 * 拉取/合成必须偏大，用更长音频盖住下一段合成。
 */
export const TTS_CHUNK_CHARS = 160
/** 逗号/顿号处允许切开的最短长度。 */
export const TTS_CHUNK_SOFT_MIN = 36
export const TTS_CHUNK_EAGER_CHARS = 160
/** 首段也要够长，禁止「好。」这种一字句进引擎。 */
export const TTS_CHUNK_FIRST_CHARS = 96
export const TTS_CHUNK_FIRST_EAGER = 80
export const TTS_CHUNK_FIRST_SOFT_MIN = 20
/** 句末标点也要达到的最短长度（短于此时继续攒）。 */
export const TTS_CHUNK_MIN_SENTENCE = 24
export const TTS_CHUNK_FIRST_MIN_SENTENCE = 20
/**
 * 合成批：把短句拼到接近该长度再请求侧车。
 */
export const TTS_SYNTH_BATCH_CHARS = 140

const TTS_SENTENCE_END = /[。！？；!?;\n]/
const TTS_CLAUSE_PAUSE = /[，、,：:]/

/** 清洗后再截断，避免超长请求。 */
export function clipTtsInput(text: string, max = TTS_MAX_CHARS): string {
  const t = sanitizeTtsSpeakText(text).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * 从流式缓冲区抽出下一段可合成文本。
 * 优先级：
 * 1. 够长后的句末标点（短句如「好。」不切，继续攒）
 * 2. 够长后的从句标点（，、：）
 * 3. 实在太长仍无标点 → 硬切
 */
export function pullTtsStreamChunk(
  buffer: string,
  opts?: {
    maxChunk?: number
    softMin?: number
    force?: boolean
    eager?: boolean
    /** 覆盖默认 TTS_CHUNK_EAGER_CHARS；仅无标点且超长时使用 */
    eagerChars?: number
    /** 句末切开的最短长度 */
    minSentence?: number
  }
): { chunk: string | null; rest: string } {
  const maxChunk = opts?.maxChunk ?? TTS_CHUNK_CHARS
  const softMin = opts?.softMin ?? TTS_CHUNK_SOFT_MIN
  const minSentence = opts?.minSentence ?? TTS_CHUNK_MIN_SENTENCE
  const eagerChars = Math.min(opts?.eagerChars ?? TTS_CHUNK_EAGER_CHARS, maxChunk)
  const force = opts?.force === true
  const eager = opts?.eager === true
  const raw = buffer.replace(/\r\n/g, '\n')
  if (!raw) return { chunk: null, rest: '' }

  const window = raw.slice(0, maxChunk)
  let cut = -1

  // 1) 句末标点：取「达到最短句长之后」的第一个句末（可跨多句凑长）
  for (let i = 0; i < window.length; i++) {
    if (!TTS_SENTENCE_END.test(window[i]!)) continue
    const at = i + 1
    if (at >= minSentence) {
      cut = at
      // 若还很短，继续往后并更多句末，尽量凑到 softMin
      if (at < softMin) continue
      break
    }
  }

  // 2) 没有合格句末时，够长再按逗号/顿号切
  if (cut < 0) {
    for (let i = softMin - 1; i < window.length; i++) {
      if (TTS_CLAUSE_PAUSE.test(window[i]!)) {
        cut = i + 1
        break
      }
    }
  }

  // 3) 太长仍无标点才硬切
  if (cut < 0 && eager && raw.length >= eagerChars) {
    cut = Math.min(eagerChars, raw.length)
    if (cut < raw.length) {
      const slice = raw.slice(0, cut)
      const sp = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'))
      if (sp >= softMin) cut = sp + 1
    }
  }
  if (cut < 0 && (force || raw.length >= maxChunk)) {
    cut = Math.min(maxChunk, raw.length)
    if (!force && cut < raw.length) {
      const slice = raw.slice(0, cut)
      const sp = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'))
      if (sp >= softMin) cut = sp + 1
    }
  }
  if (cut <= 0) return { chunk: null, rest: raw }

  const head = sanitizeTtsSpeakText(raw.slice(0, cut)).replace(/\s+/g, ' ').trim()
  const rest = raw.slice(cut)
  if (!head) {
    // 洗掉后为空（纯 markdown 标记等），继续消费 rest
    if (!rest) return { chunk: null, rest: '' }
    return pullTtsStreamChunk(rest, opts)
  }
  return { chunk: head, rest }
}

/**
 * 清洗 + 总长截断后，按短句切成多段（点播/非流式）。
 */
export function prepareTtsChunks(
  raw: string,
  maxTotal = TTS_MAX_CHARS,
  maxChunk = TTS_CHUNK_CHARS
): string[] {
  let rest = clipTtsInput(raw, maxTotal)
  if (!rest) return []
  const parts: string[] = []
  while (rest) {
    const { chunk, rest: next } = pullTtsStreamChunk(rest, {
      maxChunk,
      force: rest.length <= maxChunk,
      minSentence: Math.min(TTS_CHUNK_MIN_SENTENCE, rest.length)
    })
    if (chunk) parts.push(chunk)
    if (!chunk && next === rest) {
      // 保底：避免死循环
      parts.push(rest.slice(0, maxChunk))
      rest = rest.slice(maxChunk)
      continue
    }
    rest = next
    if (!chunk && !rest) break
  }
  return parts.filter(Boolean)
}

export function normalizeTtsCustomVoice(raw: unknown): TtsCustomVoice | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const promptWav = typeof o.promptWav === 'string' ? o.promptWav.trim() : ''
  const promptText = typeof o.promptText === 'string' ? o.promptText.trim() : ''
  const createdAt = typeof o.createdAt === 'number' ? o.createdAt : Date.now()
  if (!id || !name || !promptWav) return null
  return {
    id: id.slice(0, 64),
    name: name.slice(0, 40),
    promptWav,
    promptText: promptText.slice(0, 200) || DEFAULT_COSYVOICE_PROMPT_TEXT,
    createdAt
  }
}

/** 主进程 synthesize / 渲染层播放共用结果。 */
export type TtsSpeakResult =
  | { ok: true; mode: 'off' }
  | {
      ok: true
      mode: 'system'
      text: string
      voice?: string
      rate: number
      pitch: number
    }
  | {
      ok: true
      mode: 'local' | 'edge'
      text: string
      mime: string
      base64: string
      /** 已在合成回调里播完（PCM 流），无需再 playTtsResult。 */
      alreadyPlayed?: boolean
    }
  | { ok: false; error: string }

export type CosyVoiceStatus = {
  /** 仓库已就位（路径存在且可导入或至少有目录）。 */
  installed: boolean
  /** 模型文件已下载。 */
  modelReady: boolean
  ready: boolean
  running: boolean
  /** 正在安装时的阶段文案。 */
  installPhase?: string
  python?: string
  /** 当前是否走 CPET 专用 venv（未手动覆盖 Python）。 */
  managedEnv?: boolean
  /** 专用 venv 目录（若已创建）。 */
  venvDir?: string
  cosyRoot?: string
  modelDir?: string
  port: number
  error?: string
  voices: Array<{ id: string; name: string }>
}

export type CosyVoiceInstallResult =
  | {
      ok: true
      cosyRoot: string
      modelDir: string
      /** 依赖未齐时的提示（仓库+模型可能已好）。 */
      warning?: string
    }
  | { ok: false; error: string }
