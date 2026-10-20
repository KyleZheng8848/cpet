/**
 * 聊天右侧文件预览：目标描述 + 从工具事件里抽出写入路径。
 * 产出文件/文件夹还会提升为气泡附件（关「过程」时工具卡会藏，附件必须留下）。
 */

export type FilePreviewTarget = {
  path: string
  name: string
  mime?: string
  source: 'attachment' | 'tool' | 'command' | 'manual'
  toolName?: string
  /** 在线图 URL；有值时右侧预览优先用它（本地 path 可只作文件名占位）。 */
  remoteUrl?: string
  /** 加入本轮文件记录的时间（毫秒）。 */
  addedAt?: number
  /** 置顶时间；有值则排在列表最前。 */
  pinnedAt?: number
}

const WRITE_TOOL_RE =
  /^(Write|Edit|MultiEdit|TabWrite|apply_patch|Create|create_file|write_to_file|write_file|search_replace|StrReplace|ApplyPatch)\b/i
const DELETE_TOOL_RE = /^(Delete|delete_file|Remove)\b/i

/**
 * 交付物后缀（报告/表格/文稿）。技能月报、HTML 页也算；源码 .ts/.py 仍只走 Write。
 * 挂附件已放宽到「任意结果文件」；此名单只约束「从命令输出里扫路径」这条更吵的通道。
 */
export const DELIVERABLE_FILE_EXT_RE =
  /\.(docx?|xlsx?|pptx?|pdf|csv|tsv|zip|md|markdown|txt|html?)$/i

/** @deprecated 使用 isAttachableLocalPath；保留给旧调用。 */
export const OUTPUT_FILE_EXT_RE =
  /\.(docx?|xlsx?|pptx?|pdf|csv|tsv|md|txt|html?|zip|png|jpe?g|gif|webp|svg|mp3|mp4|wav|m4a|[A-Za-z0-9]{1,16})$/i

/**
 * 只认常见绝对路径根；禁止 `/[A-Za-z]`（会把 LaTeX `/n)/(n+1…` 当成路径）。
 */
const ABS_PATH_RE =
  /(?:^|[\s"'`=(])((?:\/(?:Users|home|tmp|var|opt|private|Volumes)\/|~\/)[^\s"'`\n<>()[\]{}^\\|]+|(?:[A-Za-z]:\\)[^\s"'`\n<>()[\]{}^\\|]+)/

const ABS_PATH_GLOBAL_RE =
  /(?:^|[\s"'`=(])((?:\/(?:Users|home|tmp|var|opt|private|Volumes)\/|~\/)[^\s"'`\n<>()[\]{}^\\|]+|(?:[A-Za-z]:\\)[^\s"'`\n<>()[\]{}^\\|]+)/g

/** /Users|/home|~/ 允许空格（Application Support）；吃到行尾再由 recover 回收文件路径。 */
const USERS_HOME_PATH_RE =
  /(?:^|[\s"'`=(「『：:：])((?:\/(?:Users|home)\/|~\/)[^\n"'<>`]+)/g

const FILE_URL_RE = /file:\/\/[^\s"'<>()[\]{}^|]+/gi

const SAVE_LABEL_RE =
  /(?:保存至|保存到|已保存(?:到|至)?|已生成|输出到|输出路径|写入到?|写到)\s*[:：]?\s*$/i

export function filePreviewBasename(pathOrName: string): string {
  const s = (pathOrName || '').trim()
  if (!s) return '文件'
  const parts = s.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || s
}

export function isWriteLikeToolName(name: string | undefined | null): boolean {
  const n = (name || '').trim()
  if (!n) return false
  if (DELETE_TOOL_RE.test(n)) return false
  return WRITE_TOOL_RE.test(n)
}

/**
 * 从可能带尾随说明的候选里收回完整本地路径。
 * 必须先认「整段就是路径」（含 Application Support 空格），再按空格从尾部裁词。
 */
export function recoverAttachablePath(raw: string): string | null {
  const s = (raw || '').trim().replace(/^['"`]+|['"`]+$/g, '')
  if (!s || s.length > 512) return null
  const direct = normalizeLocalFilePath(s)
  if (direct && isAttachableLocalPath(direct)) return canonicalLocalPath(direct)
  if (!/^(?:\/(?:Users|home)\/|~\/)/i.test(s) || !/\s/.test(s)) return null
  let cut = s
  while (true) {
    const i = cut.lastIndexOf(' ')
    if (i < 0) break
    cut = cut.slice(0, i).replace(/[.,;:!?)}\\\]]+$/, '')
    const p = normalizeLocalFilePath(cut)
    if (p && isAttachableLocalPath(p)) return canonicalLocalPath(p)
  }
  return null
}

function pathFromUnknown(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return pathFromUnknown(JSON.parse(t))
      } catch {
        /* fall through */
      }
    }
    const whole = recoverAttachablePath(t)
    if (whole) return whole
    const m = ABS_PATH_RE.exec(t)
    const hit = m?.[1] ? recoverAttachablePath(m[1]) : null
    return hit
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  for (const key of ['path', 'file_path', 'filePath', 'file', 'target', 'filename', 'dir', 'directory', 'folder']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) {
      const got = pathFromUnknown(v)
      if (got) return got
    }
  }
  return null
}

/** 从工具 input/output 文本里尽量抽出一个本地文件路径。 */
export function extractFilePathFromToolPayload(
  input?: string,
  output?: string
): string | null {
  return pathFromUnknown(input) || pathFromUnknown(output)
}

/** 规范化 file:// 与尾标点，得到可点的本地路径。 */
export function normalizeLocalFilePath(raw: string): string | null {
  let p = (raw || '').trim()
  if (!p) return null
  if (/^file:/i.test(p)) {
    try {
      const u = new URL(p)
      p = decodeURIComponent(u.pathname || '')
      // Windows: file:///C:/a → /C:/a → C:/a
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
    } catch {
      p = p.replace(/^file:\/\//i, '')
      try {
        p = decodeURIComponent(p)
      } catch {
        /* keep */
      }
    }
  }
  p = p.replace(/^<|>$/g, '').replace(/[.,;:!?)}\\\]`'"]+$/g, '')
  if (!p || p.length > 512) return null
  // /Users|/home 允许空格（Application Support）；其它根仍禁空格
  if (/\s/.test(p) && !/^(?:\/(?:Users|home)\/|~\/)/i.test(p)) return null
  if (!/^(?:\/|[A-Za-z]:\\|~\/)/.test(p)) return null
  return p
}

/** 路径去尾斜杠，便于去重（/a/b 与 /a/b/ 同键）。 */
export function canonicalLocalPath(path: string): string {
  const p = (path || '').trim()
  if (!p) return ''
  if (/^[A-Za-z]:\\?$/.test(p) || p === '/') return p
  return p.replace(/[/\\]+$/, '') || p
}

/**
 * 像不像真实本地路径（拒 LaTeX `/n)/(n+1…`、正文碎片）。
 * 须落在 /Users /home /tmp … 或盘符下，且不含公式字符。
 * /Users|/home 允许空格（如 Application Support）。
 */
export function isPlausibleLocalPath(path: string): boolean {
  const raw = (path || '').trim()
  if (!raw || raw.length < 5 || raw.length > 512) return false
  const allowSpace = /^(?:\/(?:Users|home)\/|~\/)/i.test(raw)
  if (/\s/.test(raw) && !allowSpace) return false
  // 公式 / markdown 转义碎片（含 /n)/、(1+1/n)^n、### 标题）
  if (/[(){}[\]^<>|#*$]|\\n|\\t|\\\]|\\\(/.test(raw)) return false
  const p = canonicalLocalPath(raw)
  if (!p) return false
  // `/n` `/x/` 这类单字母根是 LaTeX，不是 Unix 路径
  if (/^\/[A-Za-z](\/|$)/.test(p)) return false
  const parts = p.split(/[/\\]/).filter(Boolean)
  if (/^\/(Users|home)\//i.test(p)) return parts.length >= 3
  if (/^\/(tmp|var|opt|private|Volumes)\//i.test(p)) return parts.length >= 2
  if (/^~\//.test(p)) return parts.length >= 2
  if (/^[A-Za-z]:\\/.test(p)) return parts.length >= 2
  return false
}

export function isDeliverableFilePath(path: string): boolean {
  return DELIVERABLE_FILE_EXT_RE.test(path || '')
}

/** 末段无扩展名、或以 / 结尾 → 当作文件夹链接。 */
export function looksLikeFolderPath(path: string): boolean {
  const raw = (path || '').trim()
  if (!raw) return false
  const core = raw.replace(/[/\\]+$/, '') || raw
  if (!isPlausibleLocalPath(core) && !isPlausibleLocalPath(raw)) return false
  if (/[/\\]$/.test(raw)) return true
  const base = filePreviewBasename(raw)
  if (!base || base === '.' || base === '..') return false
  if (base.startsWith('.') && !base.slice(1).includes('.')) return true
  return !base.includes('.')
}

/**
 * 可识别的本地路径（文件或文件夹）；用于解析。
 * 真正挂气泡附件请用 isResultFilePath（只要结果文件，不要过程目录）。
 */
export function isAttachableLocalPath(path: string): boolean {
  const p = normalizeLocalFilePath(path)
  if (!p || !isPlausibleLocalPath(p)) return false
  const norm = canonicalLocalPath(p)
  if (!norm) return false
  if (/^\/(Users|home)\/[^/]+$/i.test(norm)) return false
  if (/^\/(tmp|var|opt|private|System|Library)$/i.test(norm)) return false
  if (/^[A-Za-z]:\\?$/i.test(norm)) return false
  const base = filePreviewBasename(norm)
  if (!base || base === '.' || base === '..') return false
  if (looksLikeFolderPath(p)) return true
  // 任意扩展名文件（含 .ts / .py / .json …）
  return /\.[A-Za-z0-9]{1,16}$/.test(base)
}

/** 可点进右侧预览的 https 图。 */
export function isRemotePreviewUrl(url: string | undefined | null): boolean {
  const u = (url || '').trim()
  return /^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)
}

/** 本地附件或在线图均可打开预览。 */
export function isFilePreviewable(
  target: Pick<FilePreviewTarget, 'path' | 'remoteUrl'> | null | undefined
): boolean {
  if (!target) return false
  if (isRemotePreviewUrl(target.remoteUrl) || isRemotePreviewUrl(target.path)) return true
  return isAttachableLocalPath(target.path)
}

/** 本回合「结果文件」：有扩展名的文件；排除文件夹与过程目录。 */
export function isResultFilePath(path: string): boolean {
  if (!isAttachableLocalPath(path)) return false
  if (looksLikeFolderPath(path)) return false
  const base = filePreviewBasename(path)
  return /\.[A-Za-z0-9]{1,16}$/.test(base)
}

/** 技能/生成图默认落地目录（几乎总在 Application Support 下）。 */
export function isCpetGeneratedPath(path: string): boolean {
  const p = path || ''
  return (
    /(?:cursor-pet|CPET)\/(?:skills\/outputs|generated|outputs)\//i.test(p) ||
    /\/skills\/outputs\/[^/]+$/i.test(p)
  )
}

/** 正文在路径前写了「保存至 / 已生成」这类交付口吻。 */
export function isAnnouncedSavePath(text: string, path: string): boolean {
  if (!text || !path) return false
  const idx = text.indexOf(path)
  const at = idx >= 0 ? idx : text.indexOf(filePreviewBasename(path))
  if (at < 0) return false
  return SAVE_LABEL_RE.test(text.slice(Math.max(0, at - 24), at))
}

const LOCAL_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i
const LOCAL_IMAGE_KEY_RE =
  /^(localPath|local_path|imagePath|image_path|savedPath|saved_path|outputPath|output_path|filePath|file_path|path|file)$/i
const SAVED_IMAGE_LINE_RE =
  /(?:图片已保存|图片已生成|已生成(?:图片|图像)?|已保存到?|本地路径|本地文件|本地\s*路径|本地|输出路径|文件路径|上传路径|local\s*path|saved(?:\s+(?:to|as|at))?)\s*[:：]\s*['"`]?([^\n"'<>]+)/gi
const GENERATED_IMAGE_HINT_RE =
  /图片已生成|图片已保存|生成的图片|本地路径|本地\s*[:：]|localPath|local_path|savedPath|image\/jpeg|image\/png|image\/webp/i
const LOCAL_PATH_JSON_RE =
  /"(?:localPath|local_path|imagePath|image_path|savedPath|saved_path)"\s*:\s*"((?:\\.|[^"\\])+)"/gi
const LOCALHOST_IMAGE_PATH_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^\s"'<>]*[?&]path=([^&\s"'<>]+)/gi
/** 正文里单独一行的本地图路径（避免吃进 ls -l 清单；/Users 允许空格）。 */
const BARE_LOCAL_IMAGE_LINE_RE =
  /(^|\n)[ \t]*((?:\/(?:Users|home)\/[^\n"'<>]+?|~\/[^\n"'<>]+?|\/(?:tmp|var|opt|private|Volumes)\/[^\s"'`\n<>]+|(?:[A-Za-z]:\\)[^\s"'`\n<>]+)\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif))[ \t]*(?=\n|$)/gi
/** 文中绝对本地图路径（含 Application Support 空格）。 */
const ABS_LOCAL_IMAGE_PATH_RE =
  /(?:^|[\s"'`=(「])((?:\/(?:Users|home)\/[^\n"'<>]+?|~\/[^\n"'<>]+?|\/(?:tmp|var|opt|private|Volumes)\/[^\s"'`\n<>]+|(?:[A-Za-z]:\\)[^\s"'`\n<>]+)\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif))(?=[\s"'`)<\]|,;:!]|$)/gi

export function isLocalImagePath(path: string): boolean {
  const p = canonicalLocalPath(path)
  return Boolean(p && isResultFilePath(p) && LOCAL_IMAGE_EXT_RE.test(p))
}

function pushLocalImage(out: string[], seen: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return
  const p = normalizeLocalFilePath(raw.trim().replace(/^['"`]|['"`]$/g, ''))
  if (!p || !isLocalImagePath(p) || seen.has(p)) return
  seen.add(p)
  out.push(p)
}

function walkLocalImageJson(value: unknown, out: string[], seen: Set<string>, depth: number): void {
  if (depth > 8 || value == null) return
  if (typeof value === 'string') {
    pushLocalImage(out, seen, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkLocalImageJson(item, out, seen, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (LOCAL_IMAGE_KEY_RE.test(key)) pushLocalImage(out, seen, val)
    walkLocalImageJson(val, out, seen, depth + 1)
  }
}

/**
 * 从成功命令/工具的「输出」里抽出本地图片路径（工具返回的 localPath、图片已保存）。
 * 命令行里的绝对图路径也会认；整段 ls 目录清单（多行 -rw）仍忽略，避免误挂。
 */
export function extractLocalImagePaths(raw: string): string[] {
  const text = (raw || '').trim()
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  try {
    walkLocalImageJson(JSON.parse(text), out, seen, 0)
  } catch {
    const blob = text.match(/\{[^{}]*"(?:localPath|local_path|imagePath|savedPath)"\s*:\s*"[^"]+"[^{}]*\}/)
    if (blob) {
      try {
        walkLocalImageJson(JSON.parse(blob[0]), out, seen, 0)
      } catch {
        /* fall through */
      }
    }
  }
  for (const m of text.matchAll(LOCAL_PATH_JSON_RE)) pushLocalImage(out, seen, m[1])
  for (const m of text.matchAll(SAVED_IMAGE_LINE_RE)) {
    if (m[1]) pushLocalImage(out, seen, m[1])
  }
  for (const m of text.matchAll(LOCALHOST_IMAGE_PATH_RE)) {
    if (m[1]) pushLocalImage(out, seen, decodeURIComponent(m[1]))
  }
  // Markdown 图：![](/Users/...) 或 ![](http://localhost...?path=)
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const src = (m[1] || '').trim()
    if (!src) continue
    const rewritten = rewriteLocalImageSrc(src)
    if (rewritten) {
      const q = rewritten.match(/[?&]p=([^&]+)/)
      if (q?.[1]) {
        try {
          pushLocalImage(out, seen, decodeURIComponent(q[1]))
        } catch {
          pushLocalImage(out, seen, q[1])
        }
      }
      continue
    }
    pushLocalImage(out, seen, src)
  }

  const lineAt = (index: number): string => {
    const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
    const end = text.indexOf('\n', index)
    return text.slice(start, end < 0 ? text.length : end)
  }
  const isLsListingLine = (line: string): boolean =>
    /^\s*[-d][rwxXsStT-]{9}\s/.test(line) || /^\s*total\s+\d+/i.test(line)

  // 命令行 / 正文中的绝对图路径（非 ls 清单行）
  for (const m of text.matchAll(ABS_LOCAL_IMAGE_PATH_RE)) {
    if (!m[1] || m.index == null) continue
    if (isLsListingLine(lineAt(m.index))) continue
    pushLocalImage(out, seen, m[1])
  }

  // 「图片已生成 / 本地:」时：连 ls 单行确认也收
  if (GENERATED_IMAGE_HINT_RE.test(text)) {
    for (const m of text.matchAll(ABS_LOCAL_IMAGE_PATH_RE)) {
      if (m[1]) pushLocalImage(out, seen, m[1])
    }
    for (const m of text.matchAll(ABS_PATH_GLOBAL_RE)) {
      if (m[1]) pushLocalImage(out, seen, m[1])
    }
  }
  // 正文单独一行的本地图路径（不吃 ls -l）
  for (const m of text.matchAll(BARE_LOCAL_IMAGE_LINE_RE)) {
    if (m[2]) pushLocalImage(out, seen, m[2])
  }
  return out.slice(0, 8)
}

/**
 * 渲染前：把单独成行的本地图路径变成 Markdown 图，避免只显示路径文字、气泡里空白。
 */
export function linkifyBareLocalImagePaths(text: string): string {
  const raw = text || ''
  if (!raw.trim()) return raw
  return raw.replace(BARE_LOCAL_IMAGE_LINE_RE, (_full, pre: string, path: string) => {
    return `${pre}![本地图片](${path})`
  })
}

/** 从 cpet-file:// 或可改写的本地图 src 还原绝对路径。 */
export function localPathFromCpetFileUrl(src: string): string | null {
  const s = (src || '').trim()
  if (!s) return null
  if (/^cpet-file:/i.test(s)) {
    try {
      const u = new URL(s)
      const p = u.searchParams.get('p')
      if (p) {
        const path = canonicalLocalPath(decodeURIComponent(p))
        return path && isLocalImagePath(path) ? path : null
      }
    } catch {
      /* fall through */
    }
  }
  const rewritten = rewriteLocalImageSrc(s)
  if (rewritten) return localPathFromCpetFileUrl(rewritten)
  const direct = normalizeLocalFilePath(s)
  return direct && isLocalImagePath(direct) ? canonicalLocalPath(direct) : null
}

/**
 * Markdown / HTML img 的 src → 可在应用内加载的 cpet-file URL。
 * 处理：绝对路径、file://、localhost 图床代理（?path=）。
 */
export function rewriteLocalImageSrc(src: string): string | null {
  const s = (src || '').trim()
  if (!s) return null
  if (/^(?:cpet-file:|data:)/i.test(s)) return null
  // 公网 https 不动；仅改本地代理
  if (/^https:\/\//i.test(s) && !/localhost|127\.0\.0\.1/i.test(s)) return null

  const toUrl = (raw: string): string | null => {
    const p = normalizeLocalFilePath(raw.trim().replace(/^['"]|['"]$/g, ''))
    if (!p || !isLocalImagePath(p)) return null
    const key = canonicalLocalPath(p)
    if (!key) return null
    return `cpet-file://local/?p=${encodeURIComponent(key)}`
  }

  if (/^file:/i.test(s)) {
    try {
      let path = decodeURIComponent(new URL(s).pathname)
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
      return toUrl(path)
    } catch {
      return null
    }
  }

  const proxy = s.match(
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^?\s]*\?(?:[^#]*&)?path=([^&#]+)/i
  )
  if (proxy?.[1]) {
    try {
      return toUrl(decodeURIComponent(proxy[1]))
    } catch {
      return toUrl(proxy[1])
    }
  }

  if (/^(?:\/(?:Users|home|tmp|var|opt|private|Volumes)\/|~\/|[A-Za-z]:\\)/.test(s)) {
    return toUrl(s)
  }
  return null
}

/**
 * Shell 命令里像「写出目标」的路径：-o / --output / > / tee。
 * 避免把 cwd、素材目录等过程路径挂成附件。
 */
export function extractShellOutputPaths(command: string): string[] {
  const cmd = command || ''
  if (!cmd.trim()) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string): void => {
    const p = recoverAttachablePath(raw)
    if (!p || !isResultFilePath(p)) return
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }
  const flagRe =
    /(?:^|[\s])(?:-o|--output|--out)\s*=?\s*(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/gi
  for (const m of cmd.matchAll(flagRe)) {
    const hit = m[1] || m[2] || m[3]
    if (hit) push(hit)
  }
  const redirRe = /(?:^|[\s])(?:>>?|tee)\s*(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/gi
  for (const m of cmd.matchAll(redirRe)) {
    const hit = m[1] || m[2] || m[3]
    if (hit) push(hit)
  }
  return out
}

/**
 * 从正文 / 命令输出里捞本地路径（绝对路径或 file://）。
 * 含文件夹与各类文件，不只限 docx。
 */
export function extractDocumentPathsFromText(text: string): string[] {
  return extractAttachablePathsFromText(text)
}

export function extractAttachablePathsFromText(text: string): string[] {
  const raw = text || ''
  if (!raw.trim()) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (candidate: string): void => {
    const key = recoverAttachablePath(candidate)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  }
  for (const m of raw.matchAll(FILE_URL_RE)) push(m[0])
  for (const m of raw.matchAll(USERS_HOME_PATH_RE)) {
    if (m[1]) push(m[1])
  }
  for (const m of raw.matchAll(ABS_PATH_GLOBAL_RE)) {
    if (m[1]) push(m[1])
  }
  return out.slice(0, 16)
}

export function filePreviewTargetFromPath(
  path: string,
  source: FilePreviewTarget['source'],
  extra?: Partial<FilePreviewTarget>
): FilePreviewTarget | null {
  const p = (path || '').trim()
  if (!p) return null
  return {
    path: p,
    name: filePreviewBasename(p),
    source,
    ...extra
  }
}

/** 预览栏文件记录：去重；置顶在前，其余按加入时间新的在前。previous 用于移出对话后仍留在列表。 */
export function collectPreviewFiles(input: {
  composer?: Array<{ path: string; name?: string; mime?: string; addedAt?: number; pinnedAt?: number }>
  messageAttachments?: Array<{
    path: string
    name?: string
    mime?: string
    addedAt?: number
    pinnedAt?: number
  }>
  current?: FilePreviewTarget | null
  previous?: FilePreviewTarget[]
  /** 用户从本轮列表移出的路径；不删磁盘文件。 */
  hidden?: string[]
  /** 置顶路径及钉上时间；传入则覆盖 previous 上的 pinnedAt。 */
  pinned?: Array<{ path: string; pinnedAt: number }>
}): FilePreviewTarget[] {
  const hidden = new Set(
    (input.hidden || []).map((p) => canonicalLocalPath(p)).filter(Boolean)
  )
  const pinMap = new Map<string, number>()
  for (const p of input.pinned || []) {
    const key = canonicalLocalPath(p.path)
    if (key && p.pinnedAt > 0) pinMap.set(key, p.pinnedAt)
  }
  const hasPinList = Array.isArray(input.pinned)
  const out: FilePreviewTarget[] = []
  const seen = new Set<string>()
  const push = (raw: {
    path: string
    name?: string
    mime?: string
    source?: FilePreviewTarget['source']
    addedAt?: number
    pinnedAt?: number
  }): void => {
    const path = canonicalLocalPath(raw.path || '')
    if (!path || !isAttachableLocalPath(path) || seen.has(path) || hidden.has(path)) return
    seen.add(path)
    const pinnedAt = hasPinList ? pinMap.get(path) : raw.pinnedAt
    out.push({
      path,
      name: raw.name || filePreviewBasename(path),
      mime: raw.mime,
      source: raw.source || 'attachment',
      addedAt: raw.addedAt,
      pinnedAt
    })
  }
  for (const a of input.previous || []) {
    if (a.path) push(a)
  }
  for (const a of input.messageAttachments || []) {
    if (a.path) push({ ...a, source: 'tool' })
  }
  for (const a of input.composer || []) {
    if (a.path) push({ ...a, source: 'attachment' })
  }
  if (input.current?.path) push(input.current)
  out.sort((a, b) => {
    const ap = a.pinnedAt || 0
    const bp = b.pinnedAt || 0
    if (ap && bp) return bp - ap
    if (ap) return -1
    if (bp) return 1
    return (b.addedAt || 0) - (a.addedAt || 0)
  })
  return out.slice(0, 24)
}

/** 本轮文件列表上的加入时间标签。 */
export function formatFileAddedAt(ts: number | undefined, now = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return ''
  const delta = now - ts
  if (delta < 45_000) return '刚刚'
  if (delta < 60 * 60_000) return `${Math.max(1, Math.round(delta / 60_000))}分钟前`
  const date = new Date(ts)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return `今天 ${hh}:${mm}`
  const yest = new Date(now)
  yest.setDate(yest.getDate() - 1)
  if (date.toDateString() === yest.toDateString()) return `昨天 ${hh}:${mm}`
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`
}

/**
 * 只取「当前一轮」消息：最后一个 user + 其后的 assistant（含对比各列同下标回复）。
 * 仍保留给需要「仅本轮」语义的调用方；文件面板已改为扫整段对话记录。
 */
export function collectCurrentRoundMessages<T extends { id: string; role: string }>(input: {
  messages: T[]
  lanes?: Record<string, { messages: T[] }> | null
}): T[] {
  const messages = input.messages || []
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx < 0) return []

  const out: T[] = [messages[lastUserIdx]]
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') break
    out.push(messages[i])
  }

  const userOrdinal =
    messages.slice(0, lastUserIdx + 1).filter((m) => m.role === 'user').length - 1
  if (userOrdinal >= 0 && input.lanes) {
    for (const lane of Object.values(input.lanes)) {
      const a = lane?.messages?.[userOrdinal]
      if (a) out.push(a)
    }
  }
  return out
}

/** 点开预览后还算不算「从本对话文件进去」：面板本来就开着才沿用。 */
export function nextFilePanelFromList(panelAlreadyOpen: boolean, fromList: boolean): boolean {
  return panelAlreadyOpen ? fromList : false
}
