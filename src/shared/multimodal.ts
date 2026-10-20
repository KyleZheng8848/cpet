/**
 * 对话多模态：图 / 声 / 影怎么原生编进直连 API，以及编不进去时怎么如实说明。
 * CLI 仍走路径；直连绝不能把音视频折成「请按路径处理」假装已经听见/看见。
 */

import { classifyAttachmentMedia, type AttachmentMediaKind } from './attachmentMedia'

export const NATIVE_VISION_MAX_BYTES = 8_000_000
export const NATIVE_AUDIO_MAX_BYTES = 25_000_000
export const NATIVE_VIDEO_MAX_BYTES = 20_000_000
export const MAX_NATIVE_MEDIA_ITEMS = 8
export const MAX_NATIVE_MEDIA_BYTES = 24_000_000

const NATIVE_VISION_EXT = /\.(png|jpe?g|gif|webp)$/i
const NATIVE_VISION_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'])
const INPUT_AUDIO_EXT = /\.(mp3|wav|mpeg)$/i
const FILE_AUDIO_EXT = /\.(m4a|aac|ogg|flac|oga|opus)$/i
const NATIVE_VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i
const INPUT_AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'])
const FILE_AUDIO_MIME = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/opus'
])
const NATIVE_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'])

export type ImageSendMode = 'native-api' | 'codex-flag' | 'path-read' | 'mixed'
export type NativePackStyle = 'openai-official' | 'openai-gateway' | 'anthropic'
export type VideoPack = 'file' | 'video_url'
export type MediaKind = 'image' | 'audio' | 'video'

export type LoadedVisionImage = {
  name: string
  mime: string
  base64: string
}

export type LoadedMedia = {
  kind: MediaKind
  name: string
  path?: string
  mime: string
  base64: string
  /** OpenAI input_audio 只认 wav/mp3 */
  audioFormat?: 'wav' | 'mp3'
}

export type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export type ApiChatMessage = {
  role: string
  content: string | ApiContentPart[]
}

export type HistoryMediaTurn = {
  role: string
  content: string
  media?: LoadedMedia[]
  /** @deprecated 仅兼容上轮图片字段 */
  images?: LoadedVisionImage[]
}

export type HistoryVisionTurn = HistoryMediaTurn

export function isNativeVisionMedia(pathOrName: string, mime?: string): boolean {
  const m = (mime || '').toLowerCase()
  if (NATIVE_VISION_MIME.has(m)) return true
  return NATIVE_VISION_EXT.test(pathOrName || '')
}

export function isInputAudioMedia(pathOrName: string, mime?: string): boolean {
  const m = (mime || '').toLowerCase()
  if (INPUT_AUDIO_MIME.has(m)) return true
  return INPUT_AUDIO_EXT.test(pathOrName || '')
}

export function isFileAudioMedia(pathOrName: string, mime?: string): boolean {
  const m = (mime || '').toLowerCase()
  if (FILE_AUDIO_MIME.has(m)) return true
  return FILE_AUDIO_EXT.test(pathOrName || '')
}

export function isNativeAudioMedia(pathOrName: string, mime?: string): boolean {
  return isInputAudioMedia(pathOrName, mime) || isFileAudioMedia(pathOrName, mime)
}

export function isNativeVideoMedia(pathOrName: string, mime?: string): boolean {
  const m = (mime || '').toLowerCase()
  if (NATIVE_VIDEO_MIME.has(m)) return true
  return NATIVE_VIDEO_EXT.test(pathOrName || '')
}

export function nativeMediaKind(
  pathOrName: string,
  mime?: string
): MediaKind | null {
  const kind = classifyAttachmentMedia(pathOrName, mime)
  if (kind === 'image' && isNativeVisionMedia(pathOrName, mime)) return 'image'
  if (kind === 'audio' && isNativeAudioMedia(pathOrName, mime)) return 'audio'
  if (kind === 'video' && isNativeVideoMedia(pathOrName, mime)) return 'video'
  return null
}

export function nativeVisionPaths(
  attachments?: Array<{ path?: string; name?: string; mime?: string }> | null
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of attachments || []) {
    const p = (a.path || '').trim()
    if (!p || seen.has(p)) continue
    if (!isNativeVisionMedia(p, a.mime)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

export function resolveImageSendMode(opts: {
  customApiOnly: boolean
  hasCodex: boolean
  hasOtherAgent: boolean
  hasCustomApi?: boolean
}): ImageSendMode {
  if (opts.customApiOnly) return 'native-api'
  if (opts.hasCustomApi && (opts.hasCodex || opts.hasOtherAgent)) return 'mixed'
  if (opts.hasCodex && !opts.hasOtherAgent) return 'codex-flag'
  return 'path-read'
}

export function resolveNativePackStyle(
  format: 'openai' | 'anthropic',
  baseUrl?: string
): NativePackStyle {
  if (format === 'anthropic') return 'anthropic'
  const b = (baseUrl || '').toLowerCase()
  if (b.includes('api.openai.com') || b.includes('openai.azure.com')) return 'openai-official'
  return 'openai-gateway'
}

export function defaultVideoPack(pack: NativePackStyle): VideoPack {
  return pack === 'openai-official' ? 'file' : 'video_url'
}

export function imageSendHint(mode: ImageSendMode, imageCount: number): string {
  return mediaSendHint(mode, { image: imageCount, audio: 0, video: 0 })
}

export function mediaSendHint(
  mode: ImageSendMode,
  counts: { image: number; audio: number; video: number }
): string {
  const { image, audio, video } = counts
  if (image + audio + video <= 0) return ''
  const bits: string[] = []
  if (image) bits.push(`${image} 张图作为画面`)
  if (audio) bits.push(`${audio} 段音频作为声音`)
  if (video) bits.push(`${video} 段视频作为影像`)
  if (mode === 'native-api') return `这 ${bits.join('、')} 发给模型，不只是文件名`
  if (mode === 'mixed') {
    return `直连列会把这 ${bits.join('、')} 发给模型；Agent 列按路径读取`
  }
  if (mode === 'codex-flag') {
    const extra: string[] = []
    if (image) extra.push(`${image} 张图走 Codex --image`)
    if (audio) extra.push(`${audio} 段音频只能按路径交给 Codex`)
    if (video) extra.push(`${video} 段视频只能按路径交给 Codex`)
    return extra.join('；')
  }
  const pathBits: string[] = []
  if (image) pathBits.push(`${image} 张图`)
  if (audio) pathBits.push(`${audio} 段音频`)
  if (video) pathBits.push(`${video} 段视频`)
  return `这 ${pathBits.join('、')} 会按路径交给 Agent 读取（请选能看/听的模型）`
}

export function unsupportedVisionHint(count: number): string {
  return unsupportedMediaHint({ image: count, audio: 0, video: 0 })
}

export function unsupportedMediaHint(counts: {
  image: number
  audio: number
  video: number
}): string {
  const bits: string[] = []
  if (counts.image > 0) bits.push(`${counts.image} 张图不是 PNG/JPEG/GIF/WebP`)
  if (counts.audio > 0) bits.push(`${counts.audio} 段音频不是常见音轨`)
  if (counts.video > 0) bits.push(`${counts.video} 段视频不是 MP4/WebM/MOV`)
  if (!bits.length) return ''
  return `有 ${bits.join('、')}，直连无法作为画面/声音/影像发送`
}

export function oversizedMediaHint(counts: {
  image: number
  audio: number
  video: number
}): string {
  const bits: string[] = []
  if (counts.image > 0) bits.push(`${counts.image} 张图超过 ${Math.round(NATIVE_VISION_MAX_BYTES / 1_000_000)}MB`)
  if (counts.audio > 0) bits.push(`${counts.audio} 段音频超过 ${Math.round(NATIVE_AUDIO_MAX_BYTES / 1_000_000)}MB`)
  if (counts.video > 0) bits.push(`${counts.video} 段视频超过 ${Math.round(NATIVE_VIDEO_MAX_BYTES / 1_000_000)}MB`)
  if (!bits.length) return ''
  return `有 ${bits.join('、')}，不会作为画面/声音/影像发送`
}

export function formatApiHistoryAttachmentNote(
  attachments: Array<{ path: string; name: string; mime?: string }> | undefined | null
): string {
  const list = (attachments || []).filter((a) => a.path && a.name)
  if (!list.length) return ''
  const images: typeof list = []
  const audios: typeof list = []
  const videos: typeof list = []
  const others: typeof list = []
  for (const a of list) {
    const kind = classifyAttachmentMedia(a.path || a.name, a.mime)
    if (kind === 'image') images.push(a)
    else if (kind === 'audio') audios.push(a)
    else if (kind === 'video') videos.push(a)
    else others.push(a)
  }
  const bits: string[] = []
  if (images.length) bits.push(`[图片 ${images.map((a) => a.name).join('、')}]`)
  if (audios.length) bits.push(`[音频 ${audios.map((a) => a.name).join('、')}]`)
  if (videos.length) bits.push(`[视频 ${videos.map((a) => a.name).join('、')}]`)
  if (others.length) {
    bits.push(`[附件 ${others.map((a) => a.name).join('、')}]`)
  }
  return bits.join('\n\n')
}

export function leftoverAttachmentNote(
  attachments: Array<{ path: string; name: string; mime?: string }> | undefined | null,
  nativePaths: Iterable<string>,
  opts?: {
    includeNonImages?: boolean
    pack?: NativePackStyle
    rejected?: { audio?: boolean; video?: boolean }
    /** 历史轮被预算裁掉，不是文件坏了。 */
    budgetDropped?: boolean
    /** 已读出但被条数/体积预算裁掉的路径。 */
    budgetDroppedPaths?: Iterable<string>
    /** 文本/Office 已内嵌进 prompt，不要再说打不开。 */
    inlinedPaths?: Iterable<string>
  }
): string {
  const native = new Set(nativePaths)
  const budgetDroppedPaths = new Set(opts?.budgetDroppedPaths || [])
  const inlined = new Set(opts?.inlinedPaths || [])
  const includeNonImages = opts?.includeNonImages !== false
  const pack = opts?.pack
  const lines: string[] = []
  for (const a of attachments || []) {
    if (!a.path || !a.name || inlined.has(a.path)) continue
    const kind: AttachmentMediaKind = classifyAttachmentMedia(a.path || a.name, a.mime)
    if (kind === 'image' || kind === 'audio' || kind === 'video') {
      if (native.has(a.path)) continue
      const droppedByBudget = !!opts?.budgetDropped || budgetDroppedPaths.has(a.path)
      lines.push(`- ${leftoverMediaLine(a, kind, pack, opts?.rejected, droppedByBudget)}`)
      continue
    }
    if (!includeNonImages) continue
    lines.push(`- ${a.name}：直连打不开本地文件，请把要点贴进对话（${a.path}）`)
  }
  if (!lines.length) return ''
  return `[附件]\n以下文件没有内嵌进模型（直连打不开本地路径）：\n${lines.join('\n')}`
}

/** 给用户看的短句：模型侧 leftover 已经写进 prompt，气泡里也要能看见。 */
export function leftoverUserNotice(
  attachments: Array<{ path: string; name: string; mime?: string }> | undefined | null,
  nativePaths: Iterable<string>,
  opts?: {
    includeNonImages?: boolean
    budgetDropped?: boolean
    budgetDroppedPaths?: Iterable<string>
    inlinedPaths?: Iterable<string>
  }
): string {
  const native = new Set(nativePaths)
  const inlined = new Set(opts?.inlinedPaths || [])
  const includeNonImages = opts?.includeNonImages !== false
  const names: string[] = []
  const seen = new Set<string>()
  for (const a of attachments || []) {
    if (!a.path || !a.name || seen.has(a.path) || inlined.has(a.path)) continue
    const kind: AttachmentMediaKind = classifyAttachmentMedia(a.path || a.name, a.mime)
    if (kind === 'image' || kind === 'audio' || kind === 'video') {
      if (native.has(a.path)) continue
      seen.add(a.path)
      names.push(a.name)
      continue
    }
    if (!includeNonImages) continue
    seen.add(a.path)
    names.push(a.name)
  }
  if (!names.length) return ''
  return `直连没有把 ${names.join('、')} 发给模型（打不开本地路径）`
}

function leftoverMediaLine(
  a: { path: string; name: string; mime?: string },
  kind: 'image' | 'audio' | 'video',
  pack?: NativePackStyle,
  rejected?: { audio?: boolean; video?: boolean },
  budgetDropped?: boolean
): string {
  if (budgetDropped) {
    if (kind === 'image') return `${a.name}：上下文已满，本轮未再次内嵌画面（${a.path}）`
    if (kind === 'audio') return `${a.name}：上下文已满，本轮未再次内嵌声音（${a.path}）`
    return `${a.name}：上下文已满，本轮未再次内嵌影像（${a.path}）`
  }
  if (kind === 'image') {
    if (isNativeVisionMedia(a.path, a.mime)) {
      return `${a.name}：图片过大或读失败，未内嵌画面（${a.path}）`
    }
    return `${a.name}：此格式无法作为画面发送，请另存为 PNG/JPEG（${a.path}）`
  }
  if (kind === 'audio') {
    if (pack === 'anthropic') {
      return `${a.name}：当前直连是 Anthropic Messages，不能把音频当声音发送（${a.path}）`
    }
    if (rejected?.audio) {
      return `${a.name}：该模型拒收原生音频，录音没有作为声音发送（${a.path}）`
    }
    if (isNativeAudioMedia(a.path, a.mime)) {
      return `${a.name}：音频过大或读失败，未作为声音发送（${a.path}）`
    }
    return `${a.name}：此格式无法作为声音发送，请另存为 MP3/WAV（${a.path}）`
  }
  if (pack === 'anthropic') {
    return `${a.name}：当前直连是 Anthropic Messages，不能把视频当影像发送（${a.path}）`
  }
  if (rejected?.video) {
    return `${a.name}：该模型拒收原生视频，影像没有作为画面发送（${a.path}）`
  }
  if (isNativeVideoMedia(a.path, a.mime)) {
    return `${a.name}：视频过大或读失败，未作为影像发送（${a.path}）`
  }
  return `${a.name}：此格式无法作为影像发送，请另存为 MP4/WebM（${a.path}）`
}

export type InlinedDocument = {
  path: string
  name: string
  text: string
  truncated?: boolean
}

/** 把已读出的文本/表格正文编进 user prompt，直连才能看见内容。 */
export function formatInlinedDocuments(docs: InlinedDocument[] | undefined | null): string {
  const list = (docs || []).filter((d) => d.text.trim())
  if (!list.length) return ''
  return list
    .map((d) => {
      const cut = d.truncated ? '\n…（已截断）' : ''
      return `【文件 ${d.name}】\n${d.text.trim()}${cut}`
    })
    .join('\n\n')
}

export function asLoadedMedia(
  item: LoadedMedia | LoadedVisionImage,
  kind: MediaKind = 'image'
): LoadedMedia {
  if ('kind' in item && item.kind) return item
  return { kind, name: item.name, mime: item.mime, base64: item.base64 }
}

export function mediaPartsForPack(
  media: Array<LoadedMedia | LoadedVisionImage>,
  pack: NativePackStyle,
  videoPack: VideoPack = defaultVideoPack(pack)
): ApiContentPart[] {
  const parts: ApiContentPart[] = []
  for (const raw of media) {
    const item = asLoadedMedia(raw)
    if (item.kind === 'image') {
      if (pack === 'anthropic') {
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: item.mime, data: item.base64 }
        })
      } else {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${item.mime};base64,${item.base64}` }
        })
      }
      continue
    }
    if (pack === 'anthropic') continue
    if (item.kind === 'audio') {
      if (item.audioFormat) {
        parts.push({
          type: 'input_audio',
          input_audio: { data: item.base64, format: item.audioFormat }
        })
      } else {
        parts.push({
          type: 'file',
          file: { filename: item.name, file_data: `data:${item.mime};base64,${item.base64}` }
        })
      }
      continue
    }
    if (item.kind === 'video') {
      const dataUrl = `data:${item.mime};base64,${item.base64}`
      if (videoPack === 'video_url') {
        parts.push({ type: 'video_url', video_url: { url: dataUrl } })
      } else {
        parts.push({ type: 'file', file: { filename: item.name, file_data: dataUrl } })
      }
    }
  }
  return parts
}

/** @deprecated 用 mediaPartsForPack */
export function visionPartsForFormat(
  images: LoadedVisionImage[],
  format: 'openai' | 'anthropic'
): ApiContentPart[] {
  return mediaPartsForPack(
    images.map((img) => asLoadedMedia(img, 'image')),
    format === 'anthropic' ? 'anthropic' : 'openai-gateway'
  )
}

export function composeUserContent(
  text: string,
  media: Array<LoadedMedia | LoadedVisionImage>,
  format: 'openai' | 'anthropic',
  pack: NativePackStyle = format === 'anthropic' ? 'anthropic' : 'openai-gateway',
  videoPack: VideoPack = defaultVideoPack(pack)
): string | ApiContentPart[] {
  const parts = mediaPartsForPack(media, pack, videoPack)
  if (!parts.length) return text
  if (text.trim()) parts.push({ type: 'text', text })
  return parts
}

export function estimatedMediaBytes(item: { base64: string }): number {
  return Math.floor(((item.base64 || '').length * 3) / 4)
}

export function budgetVisionImages<T>(
  current: T[],
  historyNewestFirst: T[][],
  max = MAX_NATIVE_MEDIA_ITEMS
): { current: T[]; history: T[][] } {
  return budgetNativeMedia(current, historyNewestFirst, { maxItems: max }).split
}

export function budgetNativeMedia<T>(
  current: T[],
  historyNewestFirst: T[][],
  opts?: { maxItems?: number; maxBytes?: number }
): { split: { current: T[]; history: T[][] }; dropped: T[] } {
  const maxItems = opts?.maxItems ?? MAX_NATIVE_MEDIA_ITEMS
  const maxBytes = opts?.maxBytes ?? MAX_NATIVE_MEDIA_BYTES
  const dropped: T[] = []
  let leftItems = Math.max(0, maxItems)
  let leftBytes = Math.max(0, maxBytes)

  const take = (items: T[]): T[] => {
    const kept: T[] = []
    for (const item of items) {
      const b64 = (item as { base64?: string }).base64
      const bytes = typeof b64 === 'string' && b64 ? estimatedMediaBytes({ base64: b64 }) : 0
      if (leftItems <= 0 || (bytes > 0 && bytes > leftBytes)) {
        dropped.push(item)
        continue
      }
      kept.push(item)
      leftItems -= 1
      leftBytes -= bytes
    }
    return kept
  }

  const cur = take(current)
  const history = historyNewestFirst.map((turn) => take(turn))
  return { split: { current: cur, history }, dropped }
}

export function buildApiChatMessages(opts: {
  format: 'openai' | 'anthropic'
  history?: HistoryMediaTurn[]
  prompt: string
  promptImages?: LoadedVisionImage[]
  promptMedia?: LoadedMedia[]
  leftoverNote?: string
  systemPrompt?: string
  pack?: NativePackStyle
  videoPack?: VideoPack
}): ApiChatMessage[] {
  const pack = opts.pack ?? (opts.format === 'anthropic' ? 'anthropic' : 'openai-gateway')
  const videoPack = opts.videoPack ?? defaultVideoPack(pack)
  const messages: ApiChatMessage[] = []
  if (opts.format === 'openai' && opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt })
  }
  for (const turn of opts.history ?? []) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue
    const media =
      turn.media ||
      (turn.images || []).map((img) => asLoadedMedia(img, 'image'))
    const content =
      turn.role === 'user'
        ? composeUserContent(turn.content || '', media, opts.format, pack, videoPack)
        : turn.content || ''
    if (typeof content === 'string' && !content.trim() && !media.length) continue
    messages.push({ role: turn.role, content })
  }
  const promptMedia = [
    ...(opts.promptMedia || []),
    ...((opts.promptImages || []).map((img) => asLoadedMedia(img, 'image')))
  ]
  const userText = [opts.prompt.trim(), (opts.leftoverNote || '').trim()].filter(Boolean).join('\n\n')
  const userContent = composeUserContent(userText, promptMedia, opts.format, pack, videoPack)
  if (typeof userContent === 'string' && !userContent.trim() && !promptMedia.length) {
    return messages
  }
  messages.push({ role: 'user', content: userContent })

  const merged: ApiChatMessage[] = []
  for (const m of messages) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.role === m.role &&
      m.role !== 'system' &&
      typeof last.content === 'string' &&
      typeof m.content === 'string'
    ) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      merged.push({ ...m })
    }
  }
  return merged
}

export type MediaRejectAction =
  | { kind: 'switch-video'; videoPack: VideoPack }
  | { kind: 'drop-audio' }
  | { kind: 'drop-video' }
  | { kind: 'drop-av' }

/** 直连 400 时判断该卸哪一类媒体，避免一张图被音频字段拖死。 */
export function classifyMediaReject(
  errText: string,
  currentVideoPack: VideoPack
): MediaRejectAction | null {
  const t = (errText || '').toLowerCase()
  if (!t.trim()) return null
  const mentionsAudio = /input_audio|unknown.*audio|audio.*unsupported|unsupported.*audio/.test(t)
  const mentionsVideoUrl = /video_url/.test(t)
  const mentionsFile = /\bfile\b/.test(t) && /unsupported|unknown|invalid|not (allowed|supported)/.test(t)
  const mentionsVideo = mentionsVideoUrl || /video/.test(t)

  if (mentionsVideoUrl && currentVideoPack === 'video_url') {
    return { kind: 'switch-video', videoPack: 'file' }
  }
  if (mentionsFile && currentVideoPack === 'file' && mentionsVideo) {
    return { kind: 'switch-video', videoPack: 'video_url' }
  }
  if (mentionsAudio && mentionsVideo) return { kind: 'drop-av' }
  if (mentionsAudio) return { kind: 'drop-audio' }
  if (mentionsVideo) return { kind: 'drop-video' }
  return null
}

export function audioFormatOf(pathOrName: string, mime?: string): 'wav' | 'mp3' | undefined {
  const m = (mime || '').toLowerCase()
  const n = pathOrName || ''
  if (m.includes('wav') || /\.wav$/i.test(n)) return 'wav'
  if (m.includes('mpeg') || m.includes('mp3') || /\.(mp3|mpeg)$/i.test(n)) return 'mp3'
  return undefined
}

export function nativeSizeLimit(kind: MediaKind): number {
  if (kind === 'audio') return NATIVE_AUDIO_MAX_BYTES
  if (kind === 'video') return NATIVE_VIDEO_MAX_BYTES
  return NATIVE_VISION_MAX_BYTES
}
