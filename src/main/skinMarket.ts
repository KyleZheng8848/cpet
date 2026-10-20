import { t as uiText } from '../shared/i18n'
/**
 * 皮肤市场主进程：拉目录、下载安装。密钥不进仓库；缺配置时 fail-closed。
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMarketRows,
  catalogBaseUrlFromCatalogUrl,
  isSafeSkinPackId,
  normalizeSkinPackId,
  parseSkinCatalog,
  resolveSkinCatalogUrl,
  type MarketSkinRow,
  type SkinCatalogFetchResult
} from '../shared/skinMarket'
import { getSettings } from './store'
import { installPackFromZip, listLocalSkinPacks } from './imageSkins'

const FETCH_TIMEOUT_MS = 15_000
const MAX_PACK_BYTES = 40 * 1024 * 1024

function readPackageJson(): Record<string, unknown> | null {
  for (const p of [join(app.getAppPath(), 'package.json'), join(process.cwd(), 'package.json')]) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      // next
    }
  }
  return null
}

export function getSkinCatalogUrl(): string | null {
  const pkg = readPackageJson()
  const cpet = (pkg?.cpet ?? null) as Record<string, unknown> | null
  return resolveSkinCatalogUrl({
    skinCatalog: process.env.CPET_SKIN_CATALOG_URL || cpet?.skinCatalog,
    downloadBaseUrl: process.env.CPET_DOWNLOAD_BASE_URL || cpet?.downloadBaseUrl
  })
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': `CPET/${app.getVersion()}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

async function downloadToFile(url: string, dest: string): Promise<{ bytes: number; sha256: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS * 4)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': `CPET/${app.getVersion()}` }
    })
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_PACK_BYTES) throw new Error(`皮肤包过大（>${MAX_PACK_BYTES} 字节）`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_PACK_BYTES) throw new Error(`皮肤包过大（>${MAX_PACK_BYTES} 字节）`)
    writeFileSync(dest, buf)
    return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
  } finally {
    clearTimeout(t)
  }
}

/** 拉取远端目录并与本地安装状态合并。 */
export async function fetchSkinMarket(): Promise<
  SkinCatalogFetchResult & { rows?: MarketSkinRow[]; activeImageSkin?: string }
> {
  const url = getSkinCatalogUrl()
  if (!url) {
    return {
      status: 'not-configured',
      message: uiText('未配置皮肤目录。请在 package.json 的 cpet.downloadBaseUrl / skinCatalog 设置地址。'),
      activeImageSkin: getSettings().imageSkin
    }
  }
  try {
    const text = await fetchText(url)
    const catalog = parseSkinCatalog(JSON.parse(text))
    const baseUrl = catalogBaseUrlFromCatalogUrl(url)
    const local = listLocalSkinPacks({ includePreview: false })
    const rows = buildMarketRows(catalog, baseUrl, local)
    return {
      status: catalog.skins.length ? 'ok' : 'empty',
      catalog,
      baseUrl,
      rows,
      message: catalog.skins.length
        ? `已加载 ${catalog.skins.length} 款市场皮肤`
        : '市场目录为空（可先发布皮肤包）',
      activeImageSkin: getSettings().imageSkin
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      status: 'error',
      message: `拉取皮肤目录失败：${msg}`,
      activeImageSkin: getSettings().imageSkin
    }
  }
}

/** 从市场下载并安装皮肤包。 */
export async function downloadAndInstallSkin(opts: {
  id: string
  packUrl: string
  sha256?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = normalizeSkinPackId(opts.id)
  if (!isSafeSkinPackId(id)) return { ok: false, error: '非法皮肤 id' }
  const packUrl = String(opts.packUrl || '').trim()
  if (!/^https?:\/\//i.test(packUrl)) return { ok: false, error: '无效的下载地址' }

  const tmp = join(tmpdir(), `cpet-skin-dl-${Date.now()}.zip`)
  try {
    const { sha256 } = await downloadToFile(packUrl, tmp)
    if (opts.sha256 && opts.sha256.toLowerCase() !== sha256) {
      return { ok: false, error: '校验失败：sha256 与目录声明不一致' }
    }
    return installPackFromZip(tmp, id, 'market')
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // ignore
    }
  }
}
