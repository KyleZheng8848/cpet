/** 并行 run 的索引键：conversationId 或 conversationId::laneOrModel */

export function makeRunKey(conversationId: string, laneOrModel?: string): string {
  return laneOrModel ? `${conversationId}::${laneOrModel}` : conversationId
}

export function matchesConversation(runKey: string, conversationId: string): boolean {
  return runKey === conversationId || runKey.startsWith(`${conversationId}::`)
}

export function resolveRunIdentity(payload: {
  conversationId?: string
  model?: string
  laneId?: string
}): { conversationId: string; modelId?: string; laneId?: string; runKey: string } {
  const conversationId =
    payload.conversationId ||
    `anon-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const modelId = payload.model?.trim() || undefined
  const laneId = payload.laneId?.trim() || undefined
  return {
    conversationId,
    modelId,
    laneId,
    runKey: makeRunKey(conversationId, laneId || modelId)
  }
}
