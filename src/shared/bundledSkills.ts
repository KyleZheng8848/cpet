import { join } from 'node:path'

/**
 * 安装包内置技能根目录：Resources/skills（extraResources）。
 * 开发态回退到仓库 `.cursor/skills`，方便不打包也能扫到
 * cpet-cute-skins / harsh-optimize-loop / cpet-rss-digest。
 */

/** 发版强制校验用：与 electron-builder.yml extraResources 对齐。 */
export const REQUIRED_BUNDLED_SKILL_IDS = [
  'cpet-cute-skins',
  'harsh-optimize-loop',
  'cpet-rss-digest'
] as const
export function resolveBundledSkillsRoots(input: {
  isPackaged: boolean
  resourcesPath: string
  /** 仓库根（dev）；打包后可省略 */
  projectRoot?: string
}): string[] {
  if (input.isPackaged) {
    return [join(input.resourcesPath, 'skills')]
  }
  const root = input.projectRoot?.trim()
  if (!root) return []
  return [join(root, '.cursor', 'skills')]
}
