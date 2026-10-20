/** 多会话宠物态势：按优先级仲裁全局展示态与焦点会话。 */

import type { PetState } from './types'

/** 数值越大越抢占桌宠全局态。 */
export const PET_STATE_RANK: Record<PetState, number> = {
  error: 100,
  waiting: 80,
  tool: 60,
  thinking: 50,
  talking: 40,
  done: 30,
  idle: 0
}

/** done / error 超过此时长视为已回到 idle，避免终态永久霸占。 */
export const PRESENCE_TERMINAL_IDLE_MS = 8_000

/** IDE 联动写入 convPresence 时的 conversationId 前缀。 */
export const IDE_TRACK_PREFIX = 'ide:'

/** 由 hook session 生成稳定轨 id（与 CPET conversationId 并列参与仲裁）。 */
export function idePresenceTrackId(sessionId: string, ideApp?: string): string {
  const sid = (sessionId || '').trim() || 'default'
  if (sid === 'default') {
    const app = (ideApp || 'Cursor').trim() || 'Cursor'
    return `${IDE_TRACK_PREFIX}default:${app}`
  }
  return `${IDE_TRACK_PREFIX}${sid}`
}

export function isIdePresenceTrackId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(IDE_TRACK_PREFIX)
}

/** 从 `ide:{sessionId}` / `ide:default:{app}` 还原 sessionId，供监控分轨。 */
export function sessionIdFromIdeTrack(trackId: string | undefined | null): string | undefined {
  if (!isIdePresenceTrackId(trackId)) return undefined
  const rest = trackId!.slice(IDE_TRACK_PREFIX.length)
  if (!rest) return undefined
  if (rest.startsWith('default:')) return 'default'
  return rest
}

/** Monitor 分轨键：有真实 session 用 session，否则退回 emoji+label。 */
export function activityTrackKey(a: {
  sessionId?: string
  emoji: string
  label: string
}): string {
  const sid = (a.sessionId || '').trim()
  if (sid && sid !== 'default') return `s:${sid}`
  return `t:${a.emoji}${a.label}`
}

export interface PresenceEntry {
  state: PetState
  updatedAt: number
  /** ide=监听/IDE 联动；cpet=本应用对话或对比。同态时 ide 优先。 */
  origin?: 'ide' | 'cpet'
  /** IDE 轨：点击气泡唤起的应用名。 */
  ideApp?: string
}

/** 角标用原始终态，不跟宠物动画一起 8 秒变 idle。 */
export function presenceToOpsKind(entry: PresenceEntry): 'error' | 'waiting' | 'done' | null {
  if (entry.state === 'error') return 'error'
  if (entry.state === 'waiting') return 'waiting'
  if (entry.state === 'done') return 'done'
  return null
}

export function presenceDisplayState(entry: PresenceEntry, now = Date.now()): PetState {
  if (
    (entry.state === 'done' || entry.state === 'error') &&
    now - entry.updatedAt > PRESENCE_TERMINAL_IDLE_MS
  ) {
    return 'idle'
  }
  return entry.state
}

export interface ArbitratedPresence {
  state: PetState
  conversationId?: string
  origin?: 'ide' | 'cpet'
  ideApp?: string
}

function originBoost(origin?: 'ide' | 'cpet'): number {
  return origin === 'ide' ? 1 : 0
}

/** 从并发会话态里选出应展示的全局态与焦点 conversationId。 */
export function arbitratePetPresence(
  entries: ReadonlyMap<string, PresenceEntry>,
  now = Date.now()
): ArbitratedPresence {
  let best: ArbitratedPresence = { state: 'idle' }
  let bestRank = -1
  let bestAt = -1
  let bestOriginBoost = -1
  for (const [conversationId, entry] of entries) {
    if (!conversationId) continue
    const state = presenceDisplayState(entry, now)
    const rank = PET_STATE_RANK[state] ?? 0
    const ob = originBoost(entry.origin)
    const better =
      rank > bestRank ||
      (rank === bestRank &&
        (ob > bestOriginBoost || (ob === bestOriginBoost && entry.updatedAt >= bestAt)))
    if (better) {
      bestRank = rank
      bestAt = entry.updatedAt
      bestOriginBoost = ob
      best = {
        state,
        conversationId: state === 'idle' ? undefined : conversationId,
        origin: state === 'idle' ? undefined : entry.origin,
        ideApp: state === 'idle' ? undefined : entry.ideApp
      }
    }
  }
  return best
}

/** 根据 agent 事件类型推断要写入的会话态；无关事件返回 null。 */
export function presenceStateFromAgentEvent(event: {
  type: string
  state?: PetState
  status?: string
}): PetState | null {
  switch (event.type) {
    case 'state':
      return event.state ?? null
    case 'tool':
    case 'command':
      if (event.status === 'running') return 'tool'
      return null
    case 'done':
      return 'done'
    case 'error':
      return 'error'
    case 'aborted':
      return 'idle'
    default:
      return null
  }
}
