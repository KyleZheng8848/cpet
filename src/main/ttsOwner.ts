/**
 * 全局 TTS 播放归属：聊天窗与桌宠是两个渲染进程，
 * 若同时流式朗读，会各合成各播 → 重复念 + 音色漂移。
 * 主进程原子认领，非归属方合成直接跳过。
 */

export type TtsOwnerRole = 'chat' | 'pet' | 'preview'

type Session = {
  wcId: number
  role: TtsOwnerRole
  conversationId?: string
  gen: number
}

let session: Session | null = null
let gen = 0

export function claimTtsOwner(
  wcId: number,
  role: TtsOwnerRole,
  conversationId?: string
): { ok: true; gen: number } | { ok: false; reason: string } {
  const conv = conversationId?.trim() || undefined
  if (session && session.wcId !== wcId) {
    // 聊天窗优先：可抢走桌宠；桌宠不可抢聊天窗
    if (role === 'pet' && session.role === 'chat') {
      return { ok: false, reason: 'chat-owns' }
    }
    if (role === 'pet' && session.role === 'preview') {
      return { ok: false, reason: 'preview-owns' }
    }
  }
  gen += 1
  session = { wcId, role, conversationId: conv, gen }
  return { ok: true, gen }
}

export function releaseTtsOwner(wcId: number): void {
  if (session?.wcId === wcId) session = null
}

export function isTtsOwner(wcId: number): boolean {
  // 尚未认领时放行（设置页试听等偶尔直调）
  if (!session) return true
  return session.wcId === wcId
}

export function currentTtsOwner(): Session | null {
  return session
}
