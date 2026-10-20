/**
 * 问题反馈 / 皮肤投稿：URL 与剪贴板模板（纯函数，可单测）。
 * 不碰 OSS 密钥；投稿只生成说明，上架仍由维护者 skins:publish。
 */

/** 从仓库根 URL 得到 Issue 列表/新建页。Git 仓库 都吃 `/issues`。 */
export function feedbackIssuesUrl(repoUrl?: string | null): string | undefined {
  const base = String(repoUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) return undefined
  return `${base}/issues`
}

export type SkinSubmissionInput = {
  id: string
  name: string
  author?: string
  states: string[]
  actionCount?: number
  /** 建议有但未齐的 lifecycle（不拦投稿）。 */
  missingRecommended?: string[]
  sha256?: string
  bytes?: number
  zipPath: string
  appVersion?: string
}

/** 投稿 Issue 正文模板：用户粘贴到 代码托管平台，并附上 zip。 */
export function buildSkinSubmissionClipboard(input: SkinSubmissionInput): string {
  const lines = [
    '【CPET 皮肤市场投稿】',
    '',
    `皮肤 id：${input.id}`,
    `显示名：${input.name}`,
    input.author ? `作者：${input.author}` : null,
    `状态数：${input.states.length}${input.states.length ? `（${input.states.join(', ')}）` : ''}`,
    input.actionCount != null ? `动作数：${input.actionCount}` : null,
    input.missingRecommended?.length
      ? `建议补齐（不拦投稿）：${input.missingRecommended.join(', ')}`
      : null,
    input.sha256 ? `SHA256：${input.sha256}` : null,
    input.bytes != null ? `体积：${input.bytes} bytes` : null,
    `本地 zip：${input.zipPath}`,
    input.appVersion ? `来自 CPET ${input.appVersion}` : null,
    '',
    '说明：',
    '- 请把上面的 zip 作为附件上传（或说明网盘链接）。',
    '- 核心 lifecycle（idle/thinking/tool/talking/done/error/waiting）已校验。',
    '- 审核通过后维护者会执行 skins:publish，才会出现在皮肤市场。',
    '- 这不是即时上架。'
  ]
  return lines.filter((x) => x != null).join('\n')
}

export type DiagnosticsExtra = {
  imageSkinId?: string | null
  vectorSkinId?: string | null
  updateStatus?: string
  updateLatest?: string
}

/** 追加到诊断文本末尾的额外字段（仍不包含密钥）。 */
export function appendDiagnosticsExtras(base: string, extra: DiagnosticsExtra): string {
  const lines = [base.trimEnd(), '', '外观与更新']
  lines.push(`- 图片皮肤: ${extra.imageSkinId || '（无）'}`)
  lines.push(`- 矢量皮肤: ${extra.vectorSkinId || '（无）'}`)
  if (extra.updateStatus) {
    lines.push(
      `- 更新检查: ${extra.updateStatus}${extra.updateLatest ? ` · 远端 ${extra.updateLatest}` : ''}`
    )
  }
  return lines.join('\n')
}
