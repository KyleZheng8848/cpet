import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { whichBin } from './cliPath'

/**
 * 窗内 `codex:` 引擎使用 OpenAI / ChatGPT Codex。
 *
 * 本机常见两套：
 * - ChatGPT.app/Contents/Resources/codex  ← 要接这个
 * - 私有包装器目录中的 CLI 不作为原生 Codex
 */

const CHATGPT_BUNDLED = [
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  join(homedir(), 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex')
]

const CODEX_APP_BUNDLED = [
  '/Applications/Codex.app/Contents/Resources/codex',
  join(homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex')
]

const STANDALONE = [
  join(homedir(), '.local', 'bin', 'codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex'
]

/** 旧私有包装器目录里的 codex，一律不算「ChatGPT Codex」。 */
export function isPrivateCodexPath(binPath: string): boolean {
  const p = binPath.replace(/\\/g, '/')
  return /\/\.codefuse\//i.test(p) || /\/codefuse-cli\//i.test(p) || /\/fuse\/engine\/bin\/codex\//i.test(p)
}

export function isChatGPTCodexPath(binPath: string): boolean {
  return /ChatGPT\.app\/Contents\/Resources\/codex$/i.test(binPath.replace(/\\/g, '/'))
}

export function isOpenAICodexAppPath(binPath: string): boolean {
  return /Codex\.app\/Contents\/Resources\/codex$/i.test(binPath.replace(/\\/g, '/'))
}

function resolveReal(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

function firstExistingAcceptable(paths: string[]): string | undefined {
  for (const p of paths) {
    if (!p || !existsSync(p)) continue
    const real = resolveReal(p)
    if (isPrivateCodexPath(p) || isPrivateCodexPath(real)) continue
    return p
  }
  return undefined
}

/** 候选顺序：ChatGPT.app → Codex.app → 独立安装；永不包含 .codefuse。 */
export function codexCandidatePaths(): string[] {
  return [...CHATGPT_BUNDLED, ...CODEX_APP_BUNDLED, ...STANDALONE]
}

/**
 * 解析窗内 Codex CLI：强制优先 ChatGPT.app。
 * 不会返回私有包装器目录下的 codex。
 */
export async function resolveCodexBin(): Promise<string | undefined> {
  const preferred = firstExistingAcceptable(codexCandidatePaths())
  if (preferred) return preferred

  const fromPath = await whichBin('codex')
  if (!fromPath) return undefined
  const real = resolveReal(fromPath)
  if (isPrivateCodexPath(fromPath) || isPrivateCodexPath(real)) return undefined
  return fromPath
}

/** 探测入口用：已找到则附带来源说明。 */
export function describeCodexBin(binPath: string): string {
  if (isChatGPTCodexPath(binPath)) return 'ChatGPT.app 内嵌 CLI（OpenAI Codex）'
  if (isOpenAICodexAppPath(binPath)) return 'Codex.app 内嵌 CLI（OpenAI）'
  return '独立 Codex CLI（OpenAI）'
}
