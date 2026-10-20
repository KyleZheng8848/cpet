import { t as uiText } from './i18n'
/**
 * 皮肤市场：目录清单与本地包元数据的纯逻辑（不碰 Electron / 网络）。
 */

/** 本地图片皮肤来源。 */
export type SkinPackSource = 'bundled' | 'user' | 'market'

/** 本地已安装的图片皮肤包（含来源）。 */
export interface LocalSkinPack {
  id: string
  name: string
  states: string[]
  source: SkinPackSource
  /** 非状态命名的动作图数量。 */
  actionCount?: number
  /** idle（或首张）预览 data URL；过大时可省略。 */
  preview?: string
}

/** 远端目录里的一条皮肤。 */
export interface SkinCatalogEntry {
  id: string
  name: string
  description?: string
  author?: string
  /** 包 zip 的绝对 URL，或相对 catalog 基址的路径。 */
  packUrl: string
  /** 预览图绝对 URL 或相对路径。 */
  previewUrl?: string
  sha256?: string
  bytes?: number
  states?: string[]
  version?: string
}

/** OSS / 自托管上的皮肤目录（类似 latest.json）。 */
export interface SkinCatalog {
  version: number
  updatedAt?: string
  skins: SkinCatalogEntry[]
}

export type SkinCatalogFetchStatus =
  | 'ok'
  | 'not-configured'
  | 'error'
  | 'empty'

export interface SkinCatalogFetchResult {
  status: SkinCatalogFetchStatus
  catalog?: SkinCatalog
  /** 目录文件本身的基址（用于拼相对 packUrl）。 */
  baseUrl?: string
  message: string
}

/** 合并视图：远端条目 + 本机是否已装。 */
export interface MarketSkinRow {
  entry: SkinCatalogEntry
  installed: boolean
  localSource?: SkinPackSource
  /** 解析后的绝对下载地址。 */
  resolvedPackUrl: string
  resolvedPreviewUrl?: string
}

const SAFE_ID_RE = /^[^\\/:*?"<>|\x00-\x1f]+$/u

/** 皮肤包 id / 文件夹名：禁止路径穿越与危险字符。 */
export function isSafeSkinPackId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  const s = id.trim()
  if (!s || s.length > 120) return false
  if (s === '.' || s === '..') return false
  if (s.includes('..')) return false
  if (!SAFE_ID_RE.test(s)) return false
  return true
}

export function normalizeSkinPackId(id: string): string {
  return id.trim()
}

function httpUrlOrNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^https?:\/\//i.test(s) ? s : null
}

/** 拼绝对 URL；已是 http(s) 则原样返回。 */
export function resolveCatalogAssetUrl(baseUrl: string, ref: string): string {
  const r = String(ref || '').trim()
  if (!r) return ''
  if (/^https?:\/\//i.test(r)) return r
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(r.replace(/^\//, ''), base).href
}

/**
 * 解析皮肤目录 URL。
 * 优先显式 skinCatalog；否则用 downloadBaseUrl + skins/catalog.json。
 */
export function resolveSkinCatalogUrl(opts: {
  skinCatalog?: unknown
  downloadBaseUrl?: unknown
}): string | null {
  const explicit = httpUrlOrNull(opts.skinCatalog)
  if (explicit) return explicit
  const base = httpUrlOrNull(opts.downloadBaseUrl)
  if (!base) return null
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}skins/catalog.json`
}

/** 目录文件所在目录作为相对资源基址。 */
export function catalogBaseUrlFromCatalogUrl(catalogUrl: string): string {
  try {
    const u = new URL(catalogUrl)
    const path = u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/[^/]+$/, '')
    u.pathname = path.endsWith('/') ? path : `${path}/`
    u.search = ''
    u.hash = ''
    return u.href
  } catch {
    const i = catalogUrl.lastIndexOf('/')
    return i >= 0 ? catalogUrl.slice(0, i + 1) : catalogUrl
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function asPositiveInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

/** 解析并校验远端 catalog JSON；失败抛错（调用方转成 error 状态）。 */
export function parseSkinCatalog(raw: unknown): SkinCatalog {
  if (!raw || typeof raw !== 'object') throw new Error('皮肤目录不是 JSON 对象')
  const o = raw as Record<string, unknown>
  const version = asPositiveInt(o.version) ?? 0
  if (version < 1) throw new Error('皮肤目录 version 无效（需要 ≥ 1）')
  if (!Array.isArray(o.skins)) throw new Error('皮肤目录缺少 skins 数组')

  const skins: SkinCatalogEntry[] = []
  for (const item of o.skins) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const id = asString(e.id)
    const name = asString(e.name) || id
    const packUrl = asString(e.packUrl) || asString(e.pack)
    if (!id || !isSafeSkinPackId(id) || !packUrl) continue
    const states = Array.isArray(e.states)
      ? e.states.filter((s): s is string => typeof s === 'string' && !!s.trim())
      : undefined
    skins.push({
      id: normalizeSkinPackId(id),
      name: name!,
      description: asString(e.description),
      author: asString(e.author),
      packUrl,
      previewUrl: asString(e.previewUrl) || asString(e.preview),
      sha256: asString(e.sha256)?.toLowerCase(),
      bytes: asPositiveInt(e.bytes),
      states,
      version: asString(e.version)
    })
  }

  return {
    version,
    updatedAt: asString(o.updatedAt),
    skins
  }
}

/** 把远端目录与本地安装列表合成市场行。 */
export function buildMarketRows(
  catalog: SkinCatalog,
  baseUrl: string,
  local: ReadonlyArray<Pick<LocalSkinPack, 'id' | 'source'>>
): MarketSkinRow[] {
  const byId = new Map(local.map((p) => [p.id, p]))
  return catalog.skins.map((entry) => {
    const installed = byId.get(entry.id)
    return {
      entry,
      installed: !!installed,
      localSource: installed?.source,
      resolvedPackUrl: resolveCatalogAssetUrl(baseUrl, entry.packUrl),
      resolvedPreviewUrl: entry.previewUrl
        ? resolveCatalogAssetUrl(baseUrl, entry.previewUrl)
        : undefined
    }
  })
}

export type AppearanceKind = 'vector' | 'image'

/** 当前外观摘要（顶栏 / 设置摘要共用）。 */
export function describeAppearance(opts: {
  skin: string
  skinName?: string
  imageSkin?: string | null
}): { kind: AppearanceKind; label: string; detail: string } {
  const image = opts.imageSkin?.trim()
  if (image) {
    return { kind: 'image', label: image, detail: uiText("图片皮肤") }
  }
  return {
    kind: 'vector',
    label: opts.skinName || opts.skin,
    detail: uiText("矢量皮肤")
  }
}
