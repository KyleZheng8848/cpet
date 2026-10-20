/** 写文件类工具：IDE 往往已经落盘或随后自己批，弹允许/拒绝等于假按钮。 */
const WRITE_TOOL =
  /^(apply_patch|Write|write|Edit|edit|MultiEdit|Delete|delete|TabWrite|search_replace|create_file|write_file)$/i

export function isWriteToolName(name: string | undefined): boolean {
  return !!name && WRITE_TOOL.test(name.trim())
}

/**
 * 审批卡已去掉：永远不弹。hook 仍须立刻 allow，否则 IDE agent 会卡住。
 */
export function shouldPromptIdeApproval(_opts: {
  intercept?: boolean
  kind?: string
  toolName?: string
  content?: string
}): boolean {
  return false
}
