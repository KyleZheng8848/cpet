/** RSS 任务重点条目 / 新简报 → 宠物气泡推送（主进程扫描 chat store）。 */

import type { ChatStore } from '../shared/types'
import {
  pickRssPetTip,
  resolveRssPetPushMin,
  RSS_PET_TIP_COOLDOWN_MS,
  type RssPetTipPayload
} from '../shared/petBubblePolicy'
import { getSettings } from './store'

type Emitter = (payload: RssPetTipPayload) => void

let emitTip: Emitter | null = null
let lastEmitAt = 0
const tippedKeys = new Set<string>()

export function setRssPetTipEmitter(fn: Emitter | null): void {
  emitTip = fn
}

/** 会话内已 tip 过的 key 可重置（测试用）。 */
export function resetRssPetTipsState(): void {
  lastEmitAt = 0
  tippedKeys.clear()
}

export function scanAndEmitRssPetTips(store: ChatStore | null | undefined, force = false): void {
  if (!emitTip || !store) return
  const now = Date.now()
  if (!force && now - lastEmitAt < RSS_PET_TIP_COOLDOWN_MS) return
  const min = resolveRssPetPushMin(getSettings())
  const tip = pickRssPetTip(store, min, tippedKeys, now)
  if (!tip) return
  tippedKeys.add(tip.key)
  // 防集合无限涨：只留最近 200
  if (tippedKeys.size > 200) {
    const drop = [...tippedKeys].slice(0, tippedKeys.size - 160)
    for (const k of drop) tippedKeys.delete(k)
  }
  lastEmitAt = now
  emitTip(tip)
}
