/**
 * Electron GUI 的 PATH 往往只有 /usr/bin 等系统目录；
 * 用户在终端装的 homebrew / nvm / fnm / npm-global 对 which/spawn 都不可见。
 * 换电脑后「终端能跑、CPET 连不上」多半在此。
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildQuietCliEnv } from './cliSanitize'
import { resolveSystemProxyEnv, sanitizeProxyEnv } from './systemProxy'

const execFileAsync = promisify(execFile)

let cachedPath: string | null = null
let loginShellTried = false

/** 常见 CLI / node 安装前缀（存在才加入）。 */
function staticPathPrefixes(): string[] {
  const home = homedir()
  const out: string[] = [
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin'
  ]

  // nvm：取最新 node 的 bin
  const nvmVersions = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmVersions)) {
    try {
      const vers = readdirSync(nvmVersions)
        .filter((d) => d.startsWith('v'))
        .sort()
        .reverse()
      for (const v of vers.slice(0, 3)) {
        out.push(join(nvmVersions, v, 'bin'))
      }
    } catch {
      // ignore
    }
  }

  // fnm 默认目录
  const fnmBase = join(home, '.local', 'share', 'fnm', 'node-versions')
  if (existsSync(fnmBase)) {
    try {
      const vers = readdirSync(fnmBase).sort().reverse()
      for (const v of vers.slice(0, 3)) {
        const bin = join(fnmBase, v, 'installation', 'bin')
        if (existsSync(bin)) out.push(bin)
      }
    } catch {
      // ignore
    }
  }

  // mise / asdf shims
  for (const p of [join(home, '.local', 'share', 'mise', 'shims'), join(home, '.asdf', 'shims')]) {
    if (existsSync(p)) out.push(p)
  }

  // ClawX 捆绑 CLI
  const clawx = '/Applications/ClawX.app/Contents/Resources/cli'
  if (existsSync(clawx)) out.push(clawx)

  return out.filter((p, i, arr) => arr.indexOf(p) === i && existsSync(p))
}

/** 尝试读一次登录 shell 的 PATH（最多 2s；失败则跳过）。 */
async function loginShellPath(): Promise<string | undefined> {
  if (loginShellTried) return undefined
  loginShellTried = true
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'printenv PATH'], {
      timeout: 2000,
      env: process.env
    })
    const p = stdout.trim()
    return p || undefined
  } catch {
    return undefined
  }
}

/** 合并后的 PATH（同步版：不含 login shell，启动热路径用）。 */
export function getAugmentedPathSync(): string {
  if (cachedPath) return cachedPath
  const parts: string[] = []
  const push = (seg: string | undefined): void => {
    if (!seg) return
    for (const p of seg.split(delimiter)) {
      const t = p.trim()
      if (t && !parts.includes(t)) parts.push(t)
    }
  }
  for (const p of staticPathPrefixes()) push(p)
  push(process.env.PATH)
  cachedPath = parts.join(delimiter)
  return cachedPath
}

/** 异步增强：合并登录 shell PATH 后刷新缓存。 */
export async function refreshAugmentedPath(): Promise<string> {
  cachedPath = null
  loginShellTried = false
  const login = await loginShellPath()
  const parts: string[] = []
  const push = (seg: string | undefined): void => {
    if (!seg) return
    for (const p of seg.split(delimiter)) {
      const t = p.trim()
      if (t && !parts.includes(t)) parts.push(t)
    }
  }
  for (const p of staticPathPrefixes()) push(p)
  push(login)
  push(process.env.PATH)
  cachedPath = parts.join(delimiter)
  return cachedPath
}

/** 首次探测/spawn 前调用：合并登录 shell PATH（只试一次）。 */
export async function ensureAugmentedPath(): Promise<string> {
  if (loginShellTried && cachedPath != null) return cachedPath
  return refreshAugmentedPath()
}

/** 安静 CLI + 增强 PATH（所有引擎 spawn / which 应走这里）。 */
export function buildAgentEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = buildQuietCliEnv()
  env.PATH = getAugmentedPathSync()
  if (extra) Object.assign(env, extra)
  return env
}

/** 先 ensure PATH，再构建 env（spawn 前用）；补系统代理（Codex 等出海 CLI）。 */
export async function buildAgentEnvAsync(extra?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  await ensureAugmentedPath()
  const env = buildAgentEnv(extra)
  // 先清继承来的 socks→HTTP_PROXY（否则 global-agent 直接抛错，所有对话挂）
  sanitizeProxyEnv(env)
  if (!extra || !Object.keys(extra).some((k) => /^(all|http|https)_?proxy$/i.test(k))) {
    const proxy = await resolveSystemProxyEnv(env)
    Object.assign(env, proxy)
    sanitizeProxyEnv(env)
  }
  return env
}

/** 在增强 PATH 里 which / where。 */
export async function whichBin(name: string): Promise<string | undefined> {
  try {
    await ensureAugmentedPath()
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(cmd, [name], {
      timeout: 3000,
      env: buildAgentEnv()
    })
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    return first && existsSync(first) ? first : undefined
  } catch {
    return undefined
  }
}

/** 先扫绝对路径候选，再 which。 */
export async function resolveBin(
  candidates: string[],
  whichName?: string
): Promise<string | undefined> {
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  if (whichName) return whichBin(whichName)
  return undefined
}

/** 清除 PATH 缓存（安装 CLI / 用户点「重新检测」后调用）。 */
export function clearCliPathCache(): void {
  cachedPath = null
  loginShellTried = false
}
