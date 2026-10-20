import type { ChatPanelId, OpenPanelTarget } from './types'
import { isIdePresenceTrackId, sessionIdFromIdeTrack } from './petPresence'

const PANELS = new Set<ChatPanelId>(['chat', 'today', 'monitor', 'schedules', 'settings', 'skins'])

function isPanel(v: unknown): v is ChatPanelId {
  return typeof v === 'string' && PANELS.has(v as ChatPanelId)
}

/**
 * 兼容旧载荷（纯字符串 panel）与新载荷 `{ panel, section }`。
 * 解析失败时落到 chat，避免托盘/通知把窗体打进死胡同。
 */
export function normalizeOpenPanelPayload(raw: unknown): OpenPanelTarget {
  if (isPanel(raw)) return { panel: raw }
  if (raw && typeof raw === 'object') {
    const o = raw as {
      panel?: unknown
      section?: unknown
      conversationId?: unknown
      focusComposer?: unknown
      rssEntryId?: unknown
      rssDigestId?: unknown
      rssExitDigest?: unknown
      monitorSessionId?: unknown
    }
    const panel = isPanel(o.panel) ? o.panel : 'chat'
    const section =
      typeof o.section === 'string' && o.section.trim() ? o.section.trim() : undefined
    const conversationId =
      typeof o.conversationId === 'string' && o.conversationId.trim()
        ? o.conversationId.trim()
        : undefined
    const rssEntryId =
      typeof o.rssEntryId === 'string' && o.rssEntryId.trim() ? o.rssEntryId.trim() : undefined
    const rssDigestId =
      typeof o.rssDigestId === 'string' && o.rssDigestId.trim() ? o.rssDigestId.trim() : undefined
    const monitorSessionId =
      typeof o.monitorSessionId === 'string' && o.monitorSessionId.trim()
        ? o.monitorSessionId.trim()
        : undefined
    const target: OpenPanelTarget = { panel }
    if (section) target.section = section
    if (conversationId) target.conversationId = conversationId
    if (o.focusComposer === true) target.focusComposer = true
    if (rssEntryId) target.rssEntryId = rssEntryId
    if (rssDigestId) target.rssDigestId = rssDigestId
    if (o.rssExitDigest === true) target.rssExitDigest = true
    if (monitorSessionId) target.monitorSessionId = monitorSessionId
    return target
  }
  return { panel: 'chat' }
}

/** IDE 深链解析结果：续查对话 / 显式监控 / 唤起本机 IDE。 */
export type PresenceOpenResult =
  | { kind: 'panel'; target: OpenPanelTarget }
  | { kind: 'app'; name: string }

/**
 * 角标 / 通知 / 点宠物深链：
 * - IDE 轨有续查绑定 → CPET 对话
 * - IDE 轨无绑定且显式 monitor → 联动活动分轨
 * - IDE 轨无绑定（默认）→ 唤起 Cursor 等本机 IDE（绝不进联动活动）
 * - 普通 conversationId → 对话
 */
export function resolvePresenceOpen(
  opts: {
    conversationId?: string
    panel?: ChatPanelId
    focusComposer?: boolean
    ideApp?: string
  },
  ideContinueBindings: ReadonlyMap<string, string>
): PresenceOpenResult {
  const cid = typeof opts.conversationId === 'string' ? opts.conversationId.trim() : ''
  const wantMonitor = opts.panel === 'monitor'
  const appName = (opts.ideApp || 'Cursor').trim() || 'Cursor'
  if (cid && isIdePresenceTrackId(cid)) {
    const bound = ideContinueBindings.get(cid)?.trim()
    if (bound && !isIdePresenceTrackId(bound)) {
      const t: OpenPanelTarget = { panel: 'chat', conversationId: bound }
      if (opts.focusComposer) t.focusComposer = true
      return { kind: 'panel', target: t }
    }
    if (wantMonitor) {
      const sessionId = sessionIdFromIdeTrack(cid)
      const t: OpenPanelTarget = { panel: 'monitor' }
      if (sessionId && sessionId !== 'default') t.monitorSessionId = sessionId
      return { kind: 'panel', target: t }
    }
    return { kind: 'app', name: appName }
  }
  if (cid) {
    const t: OpenPanelTarget = {
      panel: wantMonitor ? 'chat' : opts.panel || 'chat',
      conversationId: cid
    }
    if (opts.focusComposer) t.focusComposer = true
    return { kind: 'panel', target: t }
  }
  return { kind: 'panel', target: { panel: opts.panel || 'chat' } }
}

/** 角标点开：对话还在就进对话；IDE 轨对话没了就唤起对应软件。 */
export function resolveAttnOpen(
  opts: {
    conversationId?: string
    panel?: ChatPanelId
    focusComposer?: boolean
    ideApp?: string
  },
  ideContinueBindings: ReadonlyMap<string, string>,
  convExists: (id: string) => boolean
): PresenceOpenResult {
  const raw = resolvePresenceOpen(opts, ideContinueBindings)
  if (raw.kind === 'panel' && raw.target.conversationId && !convExists(raw.target.conversationId)) {
    const seed = (opts.conversationId || '').trim()
    if (seed && isIdePresenceTrackId(seed)) {
      return { kind: 'app', name: (opts.ideApp || 'Cursor').trim() || 'Cursor' }
    }
  }
  return raw
}

/** macOS `open -a` / bundle 候选。 */
export function ideLaunchPlan(name: string): { names: string[]; bundles: string[] } {
  const n = (name || 'Cursor').trim() || 'Cursor'
  const k = n.toLowerCase()
  if (k.includes('cursor')) {
    return { names: ['Cursor', 'Cursor 2'], bundles: ['com.todesktop.230313mzl4w4u92'] }
  }
  if (k.includes('codex') || k.includes('chatgpt')) {
    return { names: ['ChatGPT', 'Codex'], bundles: ['com.openai.chat'] }
  }
  if (k.includes('claude')) {
    return { names: ['Claude'], bundles: ['com.anthropic.claudefordesktop'] }
  }
  return { names: [n], bundles: [] }
}

/** @deprecated 用 resolvePresenceOpen；保留给旧测试/调用方。 */
export function resolvePresenceOpenTarget(
  opts: {
    conversationId?: string
    panel?: ChatPanelId
    focusComposer?: boolean
  },
  ideContinueBindings: ReadonlyMap<string, string>
): OpenPanelTarget {
  const r = resolvePresenceOpen(opts, ideContinueBindings)
  if (r.kind === 'app') return { panel: 'chat' }
  return r.target
}
