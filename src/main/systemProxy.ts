import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

let cached: Record<string, string> | null = null
let tried = false
let cachedAt = 0
const CACHE_TTL_MS = 30_000

function alreadyHasProxy(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.ALL_PROXY ||
      env.all_proxy ||
      env.HTTPS_PROXY ||
      env.https_proxy ||
      env.HTTP_PROXY ||
      env.http_proxy
  )
}

/** `global-agent` / 多数 Node CLI 的 HTTP_PROXY 只接受 http:，socks 会直接炸进程。 */
export function isSocksProxyUrl(url: string | undefined): boolean {
  return Boolean(url && /^socks[45]h?:\/\//i.test(url.trim()))
}

/**
 * 清掉不能塞进 HTTP(S)_PROXY 的 socks URL，并去掉对应的 GLOBAL_AGENT.*。
 * SOCKS 只应留在 ALL_PROXY。
 */
export function sanitizeProxyEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (!/^(https?_proxy|global_agent_https?_proxy)$/i.test(key)) continue
    if (isSocksProxyUrl(env[key])) {
      delete env[key]
    }
  }
  for (const key of ['GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY'] as const) {
    if (isSocksProxyUrl(env[key])) delete env[key]
  }
}

/** 解析 `scutil --proxy` 文本（供单测）。 */
export function parseScutilProxy(stdout: string): Record<string, string> {
  const get = (key: string): string | undefined => {
    const m = stdout.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'm'))
    return m?.[1]?.trim()
  }
  const out: Record<string, string> = {}

  if (get('SOCKSEnable') === '1') {
    const host = get('SOCKSProxy')
    const port = get('SOCKSPort')
    if (host && port) {
      // socks5h：域名在代理侧解析。绝不要写进 HTTP_PROXY/HTTPS_PROXY ——
      // Electron / cursor-agent 用的 global-agent 只接受 http:，否则全引擎秒挂。
      const url = `socks5h://${host}:${port}`
      out.ALL_PROXY = url
      out.all_proxy = url
    }
    return out
  }

  if (get('HTTPSEnable') === '1') {
    const host = get('HTTPSProxy')
    const port = get('HTTPSPort')
    if (host && port) {
      const url = `http://${host}:${port}`
      out.HTTPS_PROXY = url
      out.https_proxy = url
      out.HTTP_PROXY = out.HTTP_PROXY || url
      out.http_proxy = out.http_proxy || url
    }
  }
  if (get('HTTPEnable') === '1') {
    const host = get('HTTPProxy')
    const port = get('HTTPPort')
    if (host && port) {
      const url = `http://${host}:${port}`
      out.HTTP_PROXY = url
      out.http_proxy = url
      if (!out.HTTPS_PROXY) {
        out.HTTPS_PROXY = url
        out.https_proxy = url
      }
    }
  }
  return out
}

/**
 * macOS：Dock 启动的 Electron 常拿不到终端里的代理环境变量。
 * Codex/ChatGPT CLI 直连 api.openai.com 会超时，而 ChatGPT.app 自己能连 ——
 * 把系统 SOCKS/HTTP 代理注入子进程 env，对齐桌面端可达性。
 */
export async function resolveSystemProxyEnv(
  base: NodeJS.ProcessEnv = process.env
): Promise<Record<string, string>> {
  if (alreadyHasProxy(base)) return {}
  if (process.platform !== 'darwin') return {}
  const now = Date.now()
  if (tried && cached != null && now - cachedAt < CACHE_TTL_MS) return cached
  tried = true
  try {
    const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--proxy'], {
      timeout: 2000,
      env: base
    })
    cached = parseScutilProxy(stdout)
    cachedAt = now
    return cached
  } catch {
    cached = {}
    cachedAt = now
    return cached
  }
}

export function clearSystemProxyCache(): void {
  cached = null
  tried = false
  cachedAt = 0
}
