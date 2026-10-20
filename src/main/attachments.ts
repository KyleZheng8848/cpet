import { app, dialog, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { IPC, type ChatAttachment } from '../shared/types'
import { attachmentReadHint, classifyAttachmentMedia } from '../shared/attachmentMedia'
import { normalizeLocalFilePath } from '../shared/filePreview'
import {
  audioFormatOf,
  isNativeVisionMedia,
  nativeMediaKind,
  nativeSizeLimit,
  NATIVE_VISION_MAX_BYTES,
  type InlinedDocument,
  type LoadedMedia,
  type LoadedVisionImage
} from '../shared/multimodal'
import { getChatWindow, openChat } from './windows'
import { readOfficePreviewText } from './officePreview'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.js': 'text/javascript',
  '.jsx': 'text/jsx',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.py': 'text/x-python',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.log': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'application/xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.avif'
])
const MAX_PREVIEW = 2_500_000 // ~2.5MB 图片缩略
const MAX_TEXT_PREVIEW = 400_000
const MAX_INLINE_DOC_CHARS = 40_000
const MAX_INLINE_DOCS_TOTAL = 80_000
const CONVERTIBLE_IMAGE_RE = /\.(heic|heif|bmp|tiff?|avif)$/i
const OFFICE_INLINE_RE = /\.(docx|pptx|xlsx|xlsm)$/i
const REMOTE_VISION_MAX = 4
/** 单次附件上限（含从文件夹展开的文件）。 */
export const MAX_ATTACHMENTS = 12
const MAX_DIR_DEPTH = 3

function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function tmpDir(): string {
  const d = join(app.getPath('userData'), 'attachments')
  mkdirSync(d, { recursive: true })
  return d
}

export function toAttachment(path: string): ChatAttachment | null {
  try {
    if (!existsSync(path)) return null
    const st = statSync(path)
    if (!st.isFile()) return null
    return {
      path,
      name: basename(path),
      mime: mimeOf(path),
      size: st.size
    }
  } catch {
    return null
  }
}

/**
 * 把文件/文件夹路径展开成附件列表（目录递归，跳过隐藏与常见垃圾目录）。
 * 拖到宠/Composer、选文件夹共用。
 */
export function resolveAttachmentPaths(
  paths: unknown,
  maxFiles = MAX_ATTACHMENTS
): ChatAttachment[] {
  const roots = (Array.isArray(paths) ? paths : [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
  const out: ChatAttachment[] = []
  const seen = new Set<string>()

  function addFile(filePath: string): void {
    if (out.length >= maxFiles || seen.has(filePath)) return
    const a = toAttachment(filePath)
    if (!a) return
    seen.add(filePath)
    out.push(a)
  }

  function walkDir(dir: string, depth: number): void {
    if (out.length >= maxFiles || depth > MAX_DIR_DEPTH) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    // 先文件后目录，优先拿到可读附件
    const files: string[] = []
    const dirs: string[] = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      if (name === 'node_modules' || name === '.git' || name === '__pycache__') continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isFile()) files.push(full)
      else if (st.isDirectory()) dirs.push(full)
    }
    for (const f of files) addFile(f)
    for (const d of dirs) walkDir(d, depth + 1)
  }

  for (const p of roots) {
    if (out.length >= maxFiles) break
    try {
      const st = statSync(p)
      if (st.isFile()) addFile(p)
      else if (st.isDirectory()) walkDir(p, 0)
    } catch {
      // skip missing
    }
  }
  return out
}

export async function pickAttachments(): Promise<ChatAttachment[]> {
  const win = getChatWindow()
  // Darwin 可同时选文件/文件夹；Win/Linux 不能混用，保文件选择（文件夹请拖入）
  const props: Array<'openFile' | 'openDirectory' | 'multiSelections'> =
    process.platform === 'darwin'
      ? ['openFile', 'openDirectory', 'multiSelections']
      : ['openFile', 'multiSelections']
  const opts: Electron.OpenDialogOptions = {
    properties: props,
    filters: [
      {
        name: '常用',
        extensions: [
          'png',
          'jpg',
          'jpeg',
          'gif',
          'webp',
          'pdf',
          'txt',
          'md',
          'json',
          'csv',
          'mp3',
          'wav',
          'm4a',
          'mp4',
          'webm',
          'mov',
          'zip',
          'doc',
          'docx',
          'xlsx',
          'pptx',
          'ts',
          'tsx',
          'js',
          'jsx',
          'py'
        ]
      },
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'] },
      { name: '音视频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'webm', 'mov', 'mkv'] },
      {
        name: '文档',
        extensions: ['pdf', 'txt', 'md', 'json', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
      },
      { name: '全部', extensions: ['*'] }
    ]
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled) return []
  return resolveAttachmentPaths(result.filePaths)
}

/** 打开对话窗并把附件塞进当前任务草稿（宠身拖入用）。 */
export function ingestAttachmentsToChat(attachments: ChatAttachment[]): {
  ok: boolean
  count: number
} {
  const list = (attachments || []).filter((a) => a?.path && a?.name).slice(0, MAX_ATTACHMENTS)
  if (!list.length) return { ok: false, count: 0 }
  openChat()
  const win = getChatWindow()
  if (!win || win.isDestroyed()) return { ok: false, count: 0 }
  win.webContents.send(IPC.chatIngestAttachments, list)
  return { ok: true, count: list.length }
}

/** 图片缩略 data URL；非图返回 null。 */
export function previewAttachment(path: string): string | null {
  try {
    const ext = extname(path).toLowerCase()
    if (!IMAGE_EXT.has(ext)) return null
    const st = statSync(path)
    if (st.size > MAX_PREVIEW) return null
    const mime = mimeOf(path)
    const b64 = readFileSync(path).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}

/** 文本附件预览（截断）；非文本返回 null。 */
export function readAttachmentText(
  path: string
): { ok: true; text: string; truncated: boolean } | { ok: false; error: string } {
  try {
    if (!existsSync(path)) return { ok: false, error: '文件不存在' }
    const kind = classifyAttachmentMedia(path, mimeOf(path))
    if (kind !== 'text') return { ok: false, error: '不是文本文件' }
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, error: '不是文件' }
    const buf = readFileSync(path)
    const truncated = buf.length > MAX_TEXT_PREVIEW
    const slice = truncated ? buf.subarray(0, MAX_TEXT_PREVIEW) : buf
    // 粗检二进制
    const sample = slice.subarray(0, Math.min(800, slice.length))
    let weird = 0
    for (const b of sample) {
      if (b === 0) weird += 3
      else if (b < 7 && b !== 9 && b !== 10 && b !== 13) weird++
    }
    if (weird > 20) return { ok: false, error: '看起来是二进制文件' }
    return { ok: true, text: slice.toString('utf8'), truncated }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 用系统默认应用打开本地文件。 */
export async function openAttachmentPath(
  path: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!path || !existsSync(path)) return { ok: false, error: '文件不存在' }
    const err = await shell.openPath(path)
    if (err) return { ok: false, error: err }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 在访达 / 资源管理器中显示该文件。 */
export function revealAttachmentPath(path: string): { ok: boolean; error?: string } {
  try {
    if (!path || !existsSync(path)) return { ok: false, error: '文件不存在' }
    shell.showItemInFolder(path)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 打开文件所在目录（上层文件夹）。 */
export async function openAttachmentFolder(
  path: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!path || !existsSync(path)) return { ok: false, error: '文件不存在' }
    const dir = dirname(path)
    if (!existsSync(dir)) return { ok: false, error: '目录不存在' }
    const err = await shell.openPath(dir)
    if (err) return { ok: false, error: err }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function saveTempAttachment(payload: {
  name: string
  base64: string
  mime?: string
}): ChatAttachment | null {
  try {
    const safe = (payload.name || 'paste.bin').replace(/[^\w.\-\u4e00-\u9fff]+/g, '_')
    let ext = extname(safe)
    if (!ext && payload.mime) {
      if (payload.mime.includes('jpeg')) ext = '.jpg'
      else if (payload.mime.includes('png')) ext = '.png'
      else if (payload.mime.includes('gif')) ext = '.gif'
      else if (payload.mime.includes('webp')) ext = '.webp'
      else if (payload.mime.includes('pdf')) ext = '.pdf'
      else if (payload.mime.includes('mpeg') || payload.mime.includes('mp3')) ext = '.mp3'
      else if (payload.mime.includes('mp4')) ext = '.mp4'
      else if (payload.mime.includes('webm')) ext = '.webm'
      else if (payload.mime.startsWith('text/')) ext = '.txt'
      else ext = '.bin'
    }
    if (!ext) ext = '.bin'
    const base = safe.endsWith(ext) ? safe : `${safe}${ext}`
    const file = join(tmpDir(), `paste-${Date.now()}-${base}`)
    writeFileSync(file, Buffer.from(payload.base64, 'base64'))
    return toAttachment(file)
  } catch {
    return null
  }
}

/** file://、cpet-file、~ 还原成可 stat 的本地路径。 */
export function resolveAttachmentFsPath(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  if (/^cpet-file:/i.test(s)) {
    try {
      const p = new URL(s).searchParams.get('p')
      if (p) return resolveAttachmentFsPath(decodeURIComponent(p))
    } catch {
      // fall through
    }
  }
  const norm = normalizeLocalFilePath(s)
  const candidate = norm
    ? norm.startsWith('~/')
      ? join(homedir(), norm.slice(2))
      : norm
    : s
  try {
    if (existsSync(candidate)) return candidate
  } catch {
    // missing
  }
  return null
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(div|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function convertToNativeVision(path: string): string | null {
  if (process.platform !== 'darwin') return null
  if (!CONVERTIBLE_IMAGE_RE.test(path)) return null
  const out = join(
    tmpdir(),
    `cpet-vision-${Date.now()}-${basename(path, extname(path)).slice(0, 40)}.jpg`
  )
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '2048', path, '--out', out], {
      timeout: 15_000,
      stdio: 'ignore'
    })
    if (existsSync(out) && statSync(out).size > 0) return out
  } catch {
    return null
  }
  return null
}

function readMediaFile(path: string, kind: NonNullable<ReturnType<typeof nativeMediaKind>>): LoadedMedia | null {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size <= 0 || st.size > nativeSizeLimit(kind)) return null
    const resolvedMime = mimeOf(path)
    return {
      kind,
      name: basename(path),
      path,
      mime: resolvedMime,
      base64: readFileSync(path).toString('base64'),
      audioFormat: kind === 'audio' ? audioFormatOf(path, resolvedMime) : undefined
    }
  } catch {
    return null
  }
}

/** 读成直连 API 可用的画面；超限 / 非原生格式返回 null。 */
export function readVisionImage(path: string): Omit<LoadedVisionImage, 'name'> | null {
  const media = readNativeMedia(path)
  if (!media || media.kind !== 'image') return null
  return { mime: media.mime, base64: media.base64 }
}

export function readNativeMedia(path: string, mime?: string): LoadedMedia | null {
  const resolved = resolveAttachmentFsPath(path)
  if (!resolved) return null
  const kind = nativeMediaKind(resolved, mime)
  if (kind) return readMediaFile(resolved, kind)
  if (classifyAttachmentMedia(resolved, mime) !== 'image') return null
  const converted = convertToNativeVision(resolved)
  if (!converted) return null
  return readMediaFile(converted, 'image')
}

export function loadNativeMedia(
  attachments?: Array<{ path: string; name: string; mime?: string }> | null
): LoadedMedia[] {
  const out: LoadedMedia[] = []
  const seen = new Set<string>()
  for (const a of attachments || []) {
    if (!a.path || seen.has(a.path)) continue
    const loaded = readNativeMedia(a.path, a.mime)
    if (!loaded) continue
    seen.add(a.path)
    out.push({ ...loaded, name: a.name || loaded.name, path: a.path })
  }
  return out
}

function clipInlineText(text: string, budget: { left: number }): { text: string; truncated: boolean } {
  const raw = text.trim()
  const cap = Math.min(MAX_INLINE_DOC_CHARS, Math.max(0, budget.left))
  if (!raw || cap <= 0) return { text: '', truncated: !!raw }
  if (raw.length <= cap) {
    budget.left -= raw.length
    return { text: raw, truncated: false }
  }
  budget.left = 0
  return { text: raw.slice(0, cap), truncated: true }
}

/** 文本 / Office 读成正文，给直连 prompt 用。 */
export function loadInlineDocuments(
  attachments?: Array<{ path: string; name: string; mime?: string }> | null
): InlinedDocument[] {
  const out: InlinedDocument[] = []
  const seen = new Set<string>()
  const budget = { left: MAX_INLINE_DOCS_TOTAL }
  for (const a of attachments || []) {
    if (!a.path || seen.has(a.path) || budget.left <= 0) continue
    const resolved = resolveAttachmentFsPath(a.path)
    if (!resolved) continue
    const kind = classifyAttachmentMedia(resolved, a.mime)
    if (kind === 'image' || kind === 'audio' || kind === 'video') continue
    seen.add(a.path)
    if (kind === 'text') {
      const read = readAttachmentText(resolved)
      if (!read.ok || !read.text.trim()) continue
      const clipped = clipInlineText(read.text, budget)
      if (!clipped.text) continue
      out.push({
        path: a.path,
        name: a.name || basename(resolved),
        text: clipped.text,
        truncated: clipped.truncated || read.truncated
      })
      continue
    }
    if (!OFFICE_INLINE_RE.test(resolved) && !OFFICE_INLINE_RE.test(a.name || '')) continue
    const office = readOfficePreviewText(resolved)
    if (!office.ok) continue
    const plain = htmlToPlain(office.html)
    const clipped = clipInlineText(plain, budget)
    if (!clipped.text) continue
    out.push({
      path: a.path,
      name: a.name || basename(resolved),
      text: clipped.text,
      truncated: clipped.truncated || office.truncated
    })
  }
  return out
}

function isSafeRemoteImageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
      return false
    }
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) return false
    return true
  } catch {
    return false
  }
}

/** 资讯远程图拉成本地 vision 块；失败就跳过，不假装模型已经看见 URL。 */
export async function loadRemoteVisionImages(
  urls?: string[] | null
): Promise<LoadedMedia[]> {
  const out: LoadedMedia[] = []
  const seen = new Set<string>()
  for (const raw of urls || []) {
    if (out.length >= REMOTE_VISION_MAX) break
    const url = (raw || '').trim()
    if (!url || seen.has(url) || !isSafeRemoteImageUrl(url)) continue
    seen.add(url)
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' })
      clearTimeout(timer)
      if (!res.ok) continue
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const name = basename(new URL(url).pathname) || 'remote.jpg'
      if (!isNativeVisionMedia(name, mime) && !isNativeVisionMedia(url, mime)) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length <= 0 || buf.length > NATIVE_VISION_MAX_BYTES) continue
      out.push({
        kind: 'image',
        name,
        mime: mime.startsWith('image/') ? mime.replace('image/jpg', 'image/jpeg') : mimeOf(name),
        base64: buf.toString('base64')
      })
    } catch {
      // skip broken / blocked remotes
    }
  }
  return out
}

export function loadVisionImages(
  attachments?: Array<{ path: string; name: string; mime?: string }> | null
): Array<LoadedVisionImage & { path: string }> {
  return loadNativeMedia(attachments)
    .filter((m) => m.kind === 'image' && m.path)
    .map((m) => ({ path: m.path!, name: m.name, mime: m.mime, base64: m.base64 }))
}

/** 直连列不要预写路径；Agent CLI 列才把路径写进 prompt。 */
export function promptWithAttachmentsForLane(
  prompt: string,
  attachments: Array<{ path: string; name: string; mime?: string }> | undefined,
  customApiLane: boolean
): string {
  if (customApiLane) return prompt
  return buildPromptWithAttachments(prompt, attachments)
}

/** 把附件路径写进 prompt，让 agent 能 Read / 看图 / 走对应 skill。 */
export function buildPromptWithAttachments(
  prompt: string,
  attachments?: Array<{ path: string; name: string; mime?: string }>
): string {
  if (!attachments?.length) return prompt
  const lines = attachments
    .map((a) => {
      const hint = attachmentReadHint(a.path || a.name, a.mime)
      return `- ${a.path}（${hint}）`
    })
    .join('\n')
  return `${prompt.trim()}

[附件]
请先掌握以下本地文件的实际内容再回答（已按扩展名自动挂上可用 skill 时请优先遵循）：
${lines}`
}
