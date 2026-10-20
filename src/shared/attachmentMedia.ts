/**
 * 聊天附件：类型判断 + 本地媒体 URL（cpet-file 协议，主进程注册）。
 */

import { looksLikeFolderPath } from './filePreview'

export type AttachmentMediaKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'pdf'
  | 'folder'
  | 'file'

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac|oga|opus)$/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i
const TEXT_RE =
  /\.(txt|md|markdown|json|jsonl|ndjson|jsonc|geojson|csv|tsv|log|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|fs|php|lua|r|jl|scala|dart|ex|exs|erl|hs|clj|sh|zsh|bash|fish|sql|ini|conf|env|proto|graphql|gql|gitignore|gitattributes|dockerignore|editorconfig|npmrc|prettierrc|eslintrc|babelrc|lock)$/i
const PDF_RE = /\.pdf$/i
/** Office OOXML / 旧版二进制：MIME 里常含 openxml，不能当 text。 */
const OFFICE_RE = /\.(docx?|xlsx?|pptx?)$/i
const OFFICE_MIME_RE =
  /(?:application\/(?:msword|vnd\.ms-|vnd\.openxmlformats-officedocument))/i

/** 扩展名 → 读取该格式所需的 skill id（须本机/项目技能目录里真实存在才会启用）。 */
const EXT_SKILL: Record<string, string> = {
  '.doc': 'docx',
  '.docx': 'docx',
  '.xls': 'xlsx',
  '.xlsx': 'xlsx',
  '.ppt': 'pptx',
  '.pptx': 'pptx',
  '.pdf': 'pdf'
}

export function attachmentExt(nameOrPath: string): string {
  const base = nameOrPath.split(/[\\/]/).pop() || nameOrPath
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(i).toLowerCase() : ''
}

/** 附件建议挂上的 skill id（去重；不校验是否已安装）。 */
export function skillIdsForAttachments(
  attachments: Array<{ path?: string; name?: string }> | undefined | null
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of attachments || []) {
    const id = EXT_SKILL[attachmentExt(a.path || a.name || '')]
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 把附件对应 skill 并入已选列表；只保留 knownIds 里存在的。 */
export function mergeAttachmentSkills(
  selected: string[] | undefined,
  attachments: Array<{ path?: string; name?: string }> | undefined | null,
  knownIds: Iterable<string>
): string[] {
  const known = new Set(knownIds)
  const base = [...new Set((selected || []).map((s) => s.trim()).filter(Boolean))]
  const suggested = skillIdsForAttachments(attachments).filter((id) => known.has(id))
  if (!suggested.length) return base
  const seen = new Set(base)
  for (const id of suggested) {
    if (seen.has(id)) continue
    seen.add(id)
    base.push(id)
  }
  return base
}

/** 与 multimodal 原生视觉集合对齐（避免 attachmentMedia ↔ multimodal 循环依赖）。 */
const NATIVE_VISION_EXT = /\.(png|jpe?g|gif|webp)$/i
const NATIVE_VISION_MIME_HINT = /image\/(png|jpe?g|jpg|gif|webp)/i

/** 给模型的单文件读取提示（不依赖 skill 是否已安装）。 */
export function attachmentReadHint(pathOrName: string, mime?: string): string {
  const ext = attachmentExt(pathOrName)
  const skill = EXT_SKILL[ext]
  if (skill) return `请用 /${skill} skill 读取内容，勿只凭文件名猜测`
  const kind = classifyAttachmentMedia(pathOrName, mime)
  if (kind === 'image') {
    return NATIVE_VISION_EXT.test(pathOrName || '') || NATIVE_VISION_MIME_HINT.test(mime || '')
      ? '请用 Read 读取该图片的像素后再回答，不要只根据文件名猜测'
      : '此格式多数模型无法直接看图，请先转成 PNG/JPEG，或用工具处理'
  }
  if (kind === 'text') return '请用 Read 读取全文'
  if (kind === 'audio') return '请用工具读取该音频，不要只根据文件名猜测内容'
  if (kind === 'video') return '请用工具读取该视频画面与声音，不要只根据文件名猜测'
  return '用系统可处理该格式的方式读取内容'
}

export function classifyAttachmentMedia(
  pathOrName: string,
  mime?: string
): AttachmentMediaKind {
  const name = pathOrName || ''
  const m = (mime || '').toLowerCase()
  if (m === 'inode/directory' || m === 'application/x-directory' || looksLikeFolderPath(name)) {
    return 'folder'
  }
  // Office 必须先于 xml/json 启发式：openxmlformats 含 "xml"，否则会被误判成文本
  if (OFFICE_RE.test(name) || OFFICE_MIME_RE.test(m)) return 'file'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  if (m === 'application/pdf') return 'pdf'
  if (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m.endsWith('+json') ||
    m === 'application/xml' ||
    m === 'text/xml' ||
    m.endsWith('+xml')
  ) {
    return 'text'
  }
  if (IMAGE_RE.test(name)) return 'image'
  if (AUDIO_RE.test(name)) return 'audio'
  if (VIDEO_RE.test(name)) return 'video'
  if (PDF_RE.test(name)) return 'pdf'
  if (TEXT_RE.test(name)) return 'text'
  return 'file'
}

/** 渲染进程用本地媒体 URL（需主进程 registerCpetFileProtocol）。 */
export function attachmentLocalUrl(absPath: string): string {
  return `cpet-file://local/?p=${encodeURIComponent(absPath)}`
}

export function attachmentKindLabel(kind: AttachmentMediaKind): string {
  switch (kind) {
    case 'image':
      return '图片'
    case 'audio':
      return '音频'
    case 'video':
      return '视频'
    case 'text':
      return '文本'
    case 'pdf':
      return 'PDF'
    case 'folder':
      return '文件夹'
    default:
      return '文件'
  }
}

export function attachmentKindIcon(kind: AttachmentMediaKind): string {
  switch (kind) {
    case 'image':
      return '🖼'
    case 'audio':
      return '🎵'
    case 'video':
      return '🎬'
    case 'text':
      return '📄'
    case 'pdf':
      return '📕'
    case 'folder':
      return '📁'
    default:
      return '📎'
  }
}
