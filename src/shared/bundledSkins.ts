/**
 * 安装包默认内置的图片皮肤（其余走皮肤市场下载 / 本地导入）。
 * 与 electron-builder.yml extraResources、seedBundledPacks 保持一致。
 */
export const BUNDLED_IMAGE_SKIN_IDS = ['赛博幽灵', '数字佳人'] as const

export type BundledImageSkinId = (typeof BUNDLED_IMAGE_SKIN_IDS)[number]

export function isBundledImageSkinId(id: string): boolean {
  return (BUNDLED_IMAGE_SKIN_IDS as readonly string[]).includes(id)
}
