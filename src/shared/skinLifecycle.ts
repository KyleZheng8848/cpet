/**
 * 图片皮肤 lifecycle stem：投稿 / 校验的最低覆盖要求。
 * 与运行时 KNOWN_STATES 对齐；缺核心态则 fail-closed。
 */

/** 投稿必须齐套的核心态（缺一拒投稿）。 */
export const REQUIRED_LIFECYCLE_STEMS = [
  'idle',
  'thinking',
  'tool',
  'talking',
  'done',
  'error',
  'waiting'
] as const

/** 建议有、缺了只警告不拦投稿。 */
export const RECOMMENDED_LIFECYCLE_STEMS = [
  'sleeping',
  'petted',
  'dragged',
  'docked',
  'docked-left',
  'docked-right'
] as const

export interface SkinStemCoverage {
  ok: boolean
  missingRequired: string[]
  missingRecommended: string[]
}

export function checkSkinStemCoverage(states: readonly string[]): SkinStemCoverage {
  const have = new Set(states.map((s) => s.trim().toLowerCase()).filter(Boolean))
  const missingRequired = REQUIRED_LIFECYCLE_STEMS.filter((s) => !have.has(s))
  const missingRecommended = RECOMMENDED_LIFECYCLE_STEMS.filter((s) => !have.has(s))
  return {
    ok: missingRequired.length === 0,
    missingRequired: [...missingRequired],
    missingRecommended: [...missingRecommended]
  }
}
