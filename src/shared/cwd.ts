/** 工作目录安全：Agent 不得默认落在用户主目录。 */

/** 跨主进程/渲染进程的轻量路径归一化（仅用于相等比较）。 */
export function normalizePathish(p: string): string {
  return p
    .trim()
    .replace(/[/\\]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()
}

export function isUserHomeDir(cwd: string | undefined | null, homeDir: string): boolean {
  if (!cwd?.trim() || !homeDir?.trim()) return false
  return normalizePathish(cwd) === normalizePathish(homeDir)
}

/** Agent CLI 可写文件：必须有明确项目目录，且不能是主目录。 */
export function isSafeAgentCwd(cwd: string | undefined | null, homeDir: string): boolean {
  if (!cwd?.trim()) return false
  return !isUserHomeDir(cwd, homeDir)
}

export const UNSAFE_CWD_MESSAGE =
  '请先选择项目工作目录（不能使用用户主目录）。Agent 可能写入/执行命令，主目录风险过高。'
