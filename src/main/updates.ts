import { t as uiText } from '../shared/i18n'
/**
 * 更新检查：查线上最新版本，与本机版本比较。
 *
 * 支持两种发布源，优先自托管清单（私有仓库 / 内网 / 对象存储都能用，不牵扯任何 token）：
 *   1. 更新清单 URL —— CPET_UPDATE_MANIFEST_URL 环境变量，或 package.json 的 cpet.updateManifest
 *   2. 公开 GitHub 仓库 —— CPET_RELEASES_URL 环境变量，或 package.json 的 repository
 *
 * 为什么不用 electron-updater：mac 包未签名（electron-builder.yml 里 identity: null），
 * 静默下载安装在未签名应用上会失败。这里只负责「告诉用户有新版」，下载仍走浏览器。
 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { updateSettings } from './store'
import {
  NOT_CONFIGURED_MESSAGE,
  evaluateUpdate,
  latestReleaseApiUrl,
  normalizeVersion,
  parseGitHubRepo,
  parseUpdateManifest,
  pickReleaseAsset,
  releasesPageUrl,
  type UpdateCheckResult
} from '../shared/updateCheck'

const CHECK_TIMEOUT_MS = 8000
/** 启动后稍等再查，避免和首屏抢网络；仍要够早让顶栏提醒出现。 */
const FIRST_CHECK_DELAY_MS = 8_000
/** 关窗不退出，常驻托盘；发版较勤，按小时级轮询而不是一天一次。 */
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** 首检失败（离线等）后的补查间隔。 */
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000

type Source =
  | { kind: 'manifest'; url: string }
  | { kind: 'github'; apiUrl: string; releasesUrl: string }
  | null

let cachedSource: Source | undefined

/** 打包后 package.json 在 app 根；开发时在项目根。两处都试。 */
function readPackageJson(): Record<string, unknown> | null {
  for (const p of [join(app.getAppPath(), 'package.json'), join(process.cwd(), 'package.json')]) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      // 换下一个候选路径
    }
  }
  return null
}

function httpUrlOrNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^https?:\/\//i.test(s) ? s : null
}

export function resolveSource(): Source {
  if (cachedSource !== undefined) return cachedSource

  const pkg = readPackageJson()
  const cpetField = (pkg?.cpet ?? null) as Record<string, unknown> | null

  const manifest =
    httpUrlOrNull(process.env.CPET_UPDATE_MANIFEST_URL) ??
    httpUrlOrNull(cpetField?.updateManifest)
  if (manifest) {
    cachedSource = { kind: 'manifest', url: manifest }
    return cachedSource
  }

  const repo = parseGitHubRepo(process.env.CPET_RELEASES_URL) ?? parseGitHubRepo(pkg?.repository)
  cachedSource = repo
    ? { kind: 'github', apiUrl: latestReleaseApiUrl(repo), releasesUrl: releasesPageUrl(repo) }
    : null
  return cachedSource
}

/** 供「关于」页展示的下载/Release 页地址；没配置则 undefined。 */
export function getReleasesUrl(): string | undefined {
  const src = resolveSource()
  if (src?.kind === 'github') return src.releasesUrl
  const pkg = readPackageJson()
  const cpet = (pkg?.cpet ?? {}) as Record<string, unknown>
  const fromEnv = httpUrlOrNull(process.env.CPET_DOWNLOAD_PAGE)
  if (fromEnv) return fromEnv
  const fromPkg = httpUrlOrNull(cpet.downloadPage)
  return fromPkg || undefined
}

/** 源码仓地址（问题反馈 / 皮肤投稿 Issue）。 */
export function getRepoUrl(): string | undefined {
  const pkg = readPackageJson()
  const cpet = (pkg?.cpet ?? {}) as Record<string, unknown>
  const url = httpUrlOrNull(cpet.repoUrl)
  return url || undefined
}

/**
 * 关掉某版本的应用内更新横幅。
 * 同时记入 updateNoticeSeenVersion，避免「稍后」后系统通知又弹同一版。
 */
export function dismissUpdateBanner(version: string): void {
  const v = normalizeVersion(String(version || ''))
  if (!v) return
  updateSettings({
    updateBannerDismissedVersion: v,
    updateNoticeSeenVersion: v
  })
}

let lastResult: UpdateCheckResult | null = null
let firstTimer: ReturnType<typeof setTimeout> | null = null
let recheckTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** 最近一次检查结果，供托盘菜单 / 顶栏 / 设置页展示；从未检查过则 null。 */
export function getLastUpdateResult(): UpdateCheckResult | null {
  return lastResult
}

/**
 * 后台静默检查更新（启动后自动 + 周期轮询）。
 *
 * 没有这一步，前面做的版本比较等于白做：用户得自己想起来进「设置 → 关于」点按钮，
 * 而两周发 31 个版本的节奏下，没人会主动去点。
 *
 * 纪律：
 *  - 失败一律静默（离线、发布源没配、接口挂了都不弹窗）
 *  - 只要「本机 < 最新」就回调（供顶部更新横幅）；系统通知去重由调用方做
 *  - 「检查更新」按钮只是手动加查，不是唯一入口
 */
export function startUpdateWatch(onAvailable: (result: UpdateCheckResult) => void): void {
  if (!resolveSource()) return

  const scheduleRetry = (): void => {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void run()
    }, RETRY_AFTER_ERROR_MS)
  }

  const run = async (): Promise<void> => {
    let result: UpdateCheckResult
    try {
      result = await checkForUpdate()
    } catch {
      scheduleRetry()
      return
    }
    if (result.status === 'error') {
      scheduleRetry()
      return
    }
    if (result.status !== 'update-available') return
    onAvailable(result)
  }

  stopUpdateWatch()
  firstTimer = setTimeout(() => {
    firstTimer = null
    void run()
  }, FIRST_CHECK_DELAY_MS)
  recheckTimer = setInterval(() => void run(), RECHECK_INTERVAL_MS)
}

export function stopUpdateWatch(): void {
  if (firstTimer) {
    clearTimeout(firstTimer)
    firstTimer = null
  }
  if (recheckTimer) {
    clearInterval(recheckTimer)
    recheckTimer = null
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/** 手动与后台走同一条路，结果统一记下来供托盘展示。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const result = await performCheck()
  lastResult = result
  return result
}

async function performCheck(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  const src = resolveSource()
  if (!src) {
    return { status: 'not-configured', current, message: uiText(NOT_CONFIGURED_MESSAGE) }
  }

  const url = src.kind === 'manifest' ? src.url : src.apiUrl
  const fallbackReleasesUrl = src.kind === 'github' ? src.releasesUrl : undefined

  try {
    const res = await fetch(url, {
      headers:
        src.kind === 'github'
          ? { Accept: 'application/vnd.github+json', 'User-Agent': `CPET/${current}` }
          : { Accept: 'application/json', 'User-Agent': `CPET/${current}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })

    if (res.status === 404) {
      return {
        status: 'error',
        current,
        releasesUrl: fallbackReleasesUrl,
        message:
          src.kind === 'github'
            ? '发布源上还没有任何 Release。打过 v* tag 后再检查。'
            : '更新清单地址返回 404，检查一下 updateManifest 配的路径。'
      }
    }
    if (!res.ok) {
      return {
        status: 'error',
        current,
        releasesUrl: fallbackReleasesUrl,
        message: `检查更新失败（HTTP ${res.status}）。`
      }
    }

    const manifest = parseUpdateManifest(await res.json())
    if (!manifest) {
      return {
        status: 'error',
        current,
        releasesUrl: fallbackReleasesUrl,
        message: '更新清单里没读到版本号（需要 version 或 tag_name 字段）。'
      }
    }

    const asset = pickReleaseAsset(manifest.assets, process.platform, process.arch)
    return evaluateUpdate({
      current,
      latest: manifest.version,
      releasesUrl: manifest.releasesUrl ?? fallbackReleasesUrl,
      downloadUrl: asset?.url
    })
  } catch (err) {
    const timedOut = err instanceof Error && /abort|timeout/i.test(err.name + err.message)
    return {
      status: 'error',
      current,
      releasesUrl: fallbackReleasesUrl,
      message: timedOut
        ? '检查更新超时（网络不通？）。'
        : `检查更新出错：${err instanceof Error ? err.message : String(err)}`
    }
  }
}
