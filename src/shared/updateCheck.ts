import { t as uiText } from './i18n'
/**
 * 更新检查的纯逻辑（不发请求、不碰 Electron，可单测）。
 *
 * 背景：macOS 包未签名（electron-builder.yml 里 identity: null），
 * electron-updater 的静默下载安装在未签名应用上会失败，所以这里只做
 * 「发现新版本 → 告诉用户 → 打开下载页」，不做自动替换。
 * 等有了 Developer ID 证书再换成 electron-updater。
 */

export interface GitHubRepo {
  owner: string
  repo: string
}

export interface ReleaseAsset {
  name: string
  url: string
}

export type UpdateCheckStatus =
  /** 有新版本 */
  | 'update-available'
  /** 已是最新（含本机版本比线上更高，例如本地开发版） */
  | 'up-to-date'
  /** 没配置发布源，无法检查 */
  | 'not-configured'
  /** 网络或接口出错 */
  | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  /** 本机版本 */
  current: string
  /** 线上最新版本（拿到才有） */
  latest?: string
  /** Release 页，供用户手动下载 */
  releasesUrl?: string
  /** 与本机 平台+架构 匹配的安装包直链（挑到才有） */
  downloadUrl?: string
  /** 面向用户的一句话说明 */
  message: string
}

/** 去掉 v 前缀与两端空白。 */
export function normalizeVersion(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^v/i, '')
}

/**
 * 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等 0。
 * 必须按数字逐段比，不能比字符串——否则 0.3.9 会被判成大于 0.3.10。
 * 带预发布后缀（1.0.0-beta.1）时，有后缀的小于同版本正式版。
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const split = (v: string) => {
    const [core, ...pre] = normalizeVersion(v).split('-')
    return {
      nums: core.split('.').map((n) => {
        const parsed = Number.parseInt(n, 10)
        return Number.isFinite(parsed) ? parsed : 0
      }),
      pre: pre.join('-')
    }
  }
  const x = split(a)
  const y = split(b)

  const len = Math.max(x.nums.length, y.nums.length)
  for (let i = 0; i < len; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d > 0) return 1
    if (d < 0) return -1
  }

  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

/**
 * 从 package.json 的 repository 字段（或任意 GitHub 地址）里解析出 owner/repo。
 * 支持 "owner/repo"、https、git+https、git@ 四种写法。
 */
export function parseGitHubRepo(input: unknown): GitHubRepo | null {
  const raw =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object' && 'url' in input
        ? String((input as { url?: unknown }).url ?? '')
        : ''
  const s = raw.trim()
  if (!s) return null

  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i,
    /^(?:git\+)?(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i,
    /^github:([^/]+)\/(.+?)(?:\.git)?$/i,
    /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/
  ]
  for (const re of patterns) {
    const m = re.exec(s)
    if (m) {
      const owner = m[1].trim()
      const repo = m[2].trim()
      if (owner && repo) return { owner, repo }
    }
  }
  return null
}

export function releasesPageUrl(r: GitHubRepo): string {
  return `https://github.com/${r.owner}/${r.repo}/releases`
}

export function latestReleaseApiUrl(r: GitHubRepo): string {
  return `https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`
}

/**
 * 挑与本机匹配的安装包。挑不到就返回 undefined，让用户去 Release 页自己选，
 * 绝不能给 Intel 机器塞 arm64 包（README 里专门警告过别混装）。
 */
export function pickReleaseAsset(
  assets: readonly ReleaseAsset[],
  platform: string,
  arch: string
): ReleaseAsset | undefined {
  const named = assets.filter((a) => a.name && a.url)
  const match = (...res: RegExp[]) => named.find((a) => res.every((re) => re.test(a.name)))

  if (platform === 'darwin') {
    const wantArm = arch === 'arm64'
    return (
      match(/\.dmg$/i, wantArm ? /arm64/i : /x64|intel/i) ??
      match(/\.zip$/i, wantArm ? /arm64/i : /x64|intel/i)
    )
  }
  if (platform === 'win32') {
    const wantArm = arch === 'arm64'
    return (
      match(/\.exe$/i, wantArm ? /arm64/i : /x64|ia32|win/i) ?? match(/\.exe$/i)
    )
  }
  if (platform === 'linux') {
    // 有两个 AppImage 时必须按架构挑，否则 arm64 机器会下到 x64（或反过来）
    const wantArm = arch === 'arm64'
    return (
      match(/\.AppImage$/i, wantArm ? /arm64|aarch64/i : /x86_64|x64|amd64/i) ??
      match(/\.AppImage$/i)
    )
  }
  return undefined
}

export interface UpdateManifest {
  version: string
  releasesUrl?: string
  assets: ReleaseAsset[]
}

/**
 * 解析更新清单。同时吃两种形状：
 *  1. 自托管清单（私有仓库 / 内网 / 对象存储都能用，无需鉴权）：
 *     { "version": "0.4.0", "releasesUrl": "...", "assets": [{ "name": "...", "url": "..." }] }
 *  2. GitHub Releases API 的返回（tag_name + assets[].browser_download_url）
 *
 * 宽松到底：字段缺失只是少个功能，绝不抛异常——更新检查失败不该让「关于」页崩掉。
 */
export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const version = normalizeVersion(
    String(o.version ?? o.tag_name ?? o.latest ?? o.name ?? '')
  )
  if (!/^\d/.test(version)) return null

  const rawAssets = Array.isArray(o.assets) ? o.assets : []
  const assets: ReleaseAsset[] = []
  for (const a of rawAssets) {
    if (!a || typeof a !== 'object') continue
    const item = a as Record<string, unknown>
    const name = String(item.name ?? '')
    const url = String(item.url ?? item.browser_download_url ?? '')
    if (name && url) assets.push({ name, url })
  }

  const releasesUrl =
    typeof o.releasesUrl === 'string' && o.releasesUrl
      ? o.releasesUrl
      : typeof o.html_url === 'string' && o.html_url
        ? o.html_url
        : undefined

  return { version, releasesUrl, assets }
}

/** 把「本机版本 + 线上版本」翻成用户能直接读的结论。 */
export function evaluateUpdate(input: {
  current: string
  latest: string
  releasesUrl?: string
  downloadUrl?: string
}): UpdateCheckResult {
  const current = normalizeVersion(input.current)
  const latest = normalizeVersion(input.latest)
  const base = {
    current,
    latest,
    releasesUrl: input.releasesUrl,
    downloadUrl: input.downloadUrl
  }

  if (!latest) {
    return { ...base, status: 'error', message: uiText("没读到线上版本号，稍后再试。") }
  }
  if (compareVersions(latest, current) > 0) {
    return {
      ...base,
      status: 'update-available',
      message: uiText("有新版本 {0}（当前 {1}）。", [latest, current])
    }
  }
  return {
    ...base,
    status: 'up-to-date',
    downloadUrl: undefined,
    message: uiText("已是最新版本 {0}。", [current])
  }
}

/**
 * 该不该主动提示这个版本。
 *
 * 只在「确实有新版」且「这个版本还没提示过」时返回 true。
 * CPET 关窗不退出、常驻托盘，如果每次检查都提示，用户一天能被弹好几次——
 * 那会让人直接关掉更新提示，反而比没有更新通道更糟。
 */
export function shouldNotifyUpdate(input: {
  status: UpdateCheckStatus
  latest?: string
  /** 上次已经提示过的版本 */
  seenVersion?: string
}): boolean {
  if (input.status !== 'update-available') return false
  const latest = normalizeVersion(input.latest ?? '')
  if (!latest) return false
  const seen = normalizeVersion(input.seenVersion ?? '')
  if (!seen) return true
  return compareVersions(latest, seen) > 0
}

/** 应用内更新横幅：点过「稍后」的版本不再刷。 */
export function shouldShowUpdateBanner(input: {
  status: UpdateCheckStatus
  latest?: string
  dismissedVersion?: string
}): boolean {
  if (input.status !== 'update-available') return false
  const latest = normalizeVersion(input.latest ?? '')
  if (!latest) return false
  const dismissed = normalizeVersion(input.dismissedVersion ?? '')
  if (!dismissed) return true
  return latest !== dismissed
}

export const NOT_CONFIGURED_MESSAGE =
  '未配置发布源。二选一：① package.json 加 "cpet": { "updateManifest": "https://.../latest.json" }（私有仓库/内网适用）；② 公开 GitHub 仓库可加 "repository": "owner/repo"。也可用环境变量 CPET_UPDATE_MANIFEST_URL / CPET_RELEASES_URL 覆盖。'
