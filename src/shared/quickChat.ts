/** 桌宠快速对话：会话路由与设置（纯函数）。 */

import type { Conversation } from './types'
import { conversationHasContent } from './conversationContent'
import { newTaskThread } from './conversationThreads'
import {
  clampTtsPitch,
  clampTtsRate,
  DEFAULT_COSYVOICE_MODEL,
  DEFAULT_COSYVOICE_PORT,
  DEFAULT_EDGE_TTS_VOICE,
  normalizeCosyvoiceModel,
  normalizeCosyvoicePort,
  normalizeEdgeTtsVoice,
  normalizeTtsMode,
  type TtsMode
} from './tts'

/** 快问空闲超过此时长再来新消息 → 本任务内自动开新对话。 */
export const QUICK_CHAT_IDLE_NEW_THREAD_MS = 2 * 60 * 60 * 1000

export type { TtsMode }

/** 默认快捷键：对话窗聚焦时不注册，避免抢 Chat 内快捷键。 */
export const DEFAULT_QUICK_CHAT_HOTKEY = 'CommandOrControl+Shift+Space'

export type QuickChatSettings = {
  /** 总开关；默认开。 */
  enabled: boolean
  /** 说完是否直接发送（默认关，需点发送/确认）。 */
  autoSend: boolean
  /**
   * 打开快速对话的全局快捷键（Electron accelerator）。
   * 空字符串 = 关闭快捷键；对话窗聚焦时临时不注册。
   */
  hotkey?: string
  /** TTS：关 / EdgeTTS（默认） / CosyVoice 本机。 */
  tts: TtsMode
  /**
   * 生成时短句流式朗读（对话 / RSS 缺省）。
   * 单任务可用 Conversation.ttsAutoSpeak 覆盖。
   */
  ttsAutoSpeak: boolean
  /** 系统朗读：speechSynthesis voiceURI（旧）。 */
  ttsSystemVoice?: string
  /** EdgeTTS 音色 ShortName，如 zh-CN-XiaoxiaoNeural。 */
  ttsEdgeVoice?: string
  /** 语速 0.5–2（Edge / CosyVoice / 旧系统朗读共用）。 */
  ttsRate?: number
  /** 音调 0–2。 */
  ttsPitch?: number
  /** CosyVoice 仓库根目录。 */
  cosyvoiceRoot?: string
  /** ModelScope id 或本地模型目录。 */
  cosyvoiceModel?: string
  /** 侧车端口。 */
  cosyvoicePort?: number
  /** CosyVoice 自定义音色 id；空则用内置默认参考音。 */
  ttsVoiceId?: string
  /**
   * Python 可执行文件（可选覆盖）。
   * 留空则使用 CPET 专用 venv（userData/cosyvoice/venv），避免污染系统环境。
   */
  cosyvoicePython?: string
}

export const DEFAULT_QUICK_CHAT_SETTINGS: QuickChatSettings = {
  enabled: true,
  autoSend: false,
  hotkey: DEFAULT_QUICK_CHAT_HOTKEY,
  tts: 'off',
  ttsAutoSpeak: false,
  ttsEdgeVoice: DEFAULT_EDGE_TTS_VOICE,
  ttsRate: 1,
  ttsPitch: 1,
  cosyvoiceModel: DEFAULT_COSYVOICE_MODEL,
  cosyvoicePort: DEFAULT_COSYVOICE_PORT
}

export type QuickChatRouteInput = {
  chatPanelFocused: boolean
  activeId?: string
  lastChatInteractedId?: string
  conversations: ReadonlyArray<Conversation>
}

export function normalizeQuickChatHotkey(raw: unknown): string {
  if (raw === '' || raw === false || raw === null) return ''
  if (typeof raw !== 'string') return DEFAULT_QUICK_CHAT_HOTKEY
  const v = raw.trim()
  if (!v) return ''
  // 过长或明显非法时回退默认
  if (v.length > 80) return DEFAULT_QUICK_CHAT_HOTKEY
  return v
}

export function normalizeQuickChatSettings(raw: unknown): QuickChatSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const systemVoice =
    typeof o.ttsSystemVoice === 'string' && o.ttsSystemVoice.trim()
      ? o.ttsSystemVoice.trim().slice(0, 200)
      : undefined
  const cosyRoot =
    typeof o.cosyvoiceRoot === 'string' && o.cosyvoiceRoot.trim()
      ? o.cosyvoiceRoot.trim()
      : undefined
  const voiceId =
    typeof o.ttsVoiceId === 'string' && o.ttsVoiceId.trim()
      ? o.ttsVoiceId.trim().slice(0, 64)
      : undefined
  const py =
    typeof o.cosyvoicePython === 'string' && o.cosyvoicePython.trim()
      ? o.cosyvoicePython.trim()
      : undefined
  const hotkey =
    o.hotkey === undefined ? DEFAULT_QUICK_CHAT_HOTKEY : normalizeQuickChatHotkey(o.hotkey)
  return {
    enabled: o.enabled !== false,
    autoSend: o.autoSend === true,
    hotkey,
    tts: normalizeTtsMode(o.tts),
    ttsAutoSpeak: o.ttsAutoSpeak === true,
    ttsSystemVoice: systemVoice,
    ttsEdgeVoice: normalizeEdgeTtsVoice(o.ttsEdgeVoice),
    ttsRate: clampTtsRate(o.ttsRate),
    ttsPitch: clampTtsPitch(o.ttsPitch),
    cosyvoiceRoot: cosyRoot,
    cosyvoiceModel: normalizeCosyvoiceModel(o.cosyvoiceModel),
    cosyvoicePort: normalizeCosyvoicePort(o.cosyvoicePort),
    ttsVoiceId: voiceId,
    cosyvoicePython: py
  }
}

/** 本任务是否自动朗读：任务覆盖优先，否则跟设置缺省。 */
export function resolveConvTtsAutoSpeak(
  conv: { ttsAutoSpeak?: boolean } | null | undefined,
  settingsDefault: boolean
): boolean {
  if (conv && typeof conv.ttsAutoSpeak === 'boolean') return conv.ttsAutoSpeak
  return settingsDefault
}

function isChatTask(c: Conversation): boolean {
  return !c.kind || c.kind === 'chat'
}

export type QuickChatResolve =
  | { action: 'use'; conversationId: string; surface: 'strip' | 'panel' }
  | { action: 'create'; fromPresetId?: string; surface: 'strip' | 'panel' }
  | { action: 'ignore' }

/** @deprecated 用 QuickChatResolve */
export type QuickChatTarget = QuickChatResolve

/** 当前快问轮次最近活动时间（消息 / 线程 / 任务）。 */
export function lastQuickChatActivityAt(conv: Conversation): number {
  let max = 0
  for (const m of conv.messages || []) {
    if (typeof m.createdAt === 'number' && m.createdAt > max) max = m.createdAt
  }
  const th = (conv.threads || []).find((t) => t.id === conv.activeThreadId)
  if (th && typeof th.updatedAt === 'number' && th.updatedAt > max) max = th.updatedAt
  if (typeof conv.updatedAt === 'number' && conv.updatedAt > max) max = conv.updatedAt
  if (typeof conv.createdAt === 'number' && conv.createdAt > max) max = conv.createdAt
  return max
}

/**
 * 快问空闲过久且当前轮有内容 → 应开新对话（任务内线程，不新建侧栏任务）。
 */
export function shouldRotateQuickChatThread(
  conv: Conversation | null | undefined,
  now = Date.now(),
  idleMs = QUICK_CHAT_IDLE_NEW_THREAD_MS
): boolean {
  if (!conv || !isChatTask(conv)) return false
  if (!conversationHasContent(conv)) return false
  const last = lastQuickChatActivityAt(conv)
  if (!last) return false
  return now - last >= idleMs
}

/** 空闲超时则归档当前轮并开空白新对话；否则原样返回。 */
export function rotateQuickChatThreadIfIdle(
  conv: Conversation,
  now = Date.now(),
  idleMs = QUICK_CHAT_IDLE_NEW_THREAD_MS
): Conversation {
  if (!shouldRotateQuickChatThread(conv, now, idleMs)) return conv
  return newTaskThread(conv)
}

/** 点宠 / 按钮 / 快捷键：聚焦对话窗则进面板，否则宠边条。 */
export function resolveQuickChatTarget(input: QuickChatRouteInput): QuickChatResolve {
  const surface: 'strip' | 'panel' = input.chatPanelFocused ? 'panel' : 'strip'
  if (input.chatPanelFocused && input.activeId) {
    return { action: 'use', conversationId: input.activeId, surface: 'panel' }
  }
  const recent =
    (input.lastChatInteractedId &&
      input.conversations.find(
        (c) => c.id === input.lastChatInteractedId && isChatTask(c)
      )?.id) ||
    [...input.conversations]
      .filter(isChatTask)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.id
  if (recent) return { action: 'use', conversationId: recent, surface }
  return { action: 'create', surface }
}
