/**
 * 桌宠快速对话：路由解析、按需建任务、通知对话窗发送。
 */

import type { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { getChatStore, getSettings, saveChatStore } from './store'
import { ensureChatWindow, getChatWindow, openChat } from './windows'
import {
  resolveQuickChatTarget,
  rotateQuickChatThreadIfIdle,
  type QuickChatResolve
} from '../shared/quickChat'
import type { ChatStore, Conversation, PromptTemplate } from '../shared/types'
import { IPC } from '../shared/types'
import { isUserHomeDir } from '../shared/cwd'

export type QuickChatArmResult = {
  ok: boolean
  error?: string
  conversationId?: string
  title?: string
  surface?: 'panel' | 'strip'
  /** 语音听写得到的待发文本（可空）。 */
  pendingText?: string
  created?: boolean
}

function uid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function ensureStore(): ChatStore {
  const existing = getChatStore()
  if (existing?.conversations?.length) return existing
  const now = Date.now()
  const c: Conversation = {
    id: 'c' + now.toString(36),
    title: '新对话',
    messages: [],
    kind: 'chat',
    createdAt: now,
    updatedAt: now,
    cwd: getSettings().cwd
  }
  const store: ChatStore = { conversations: [c], activeId: c.id }
  saveChatStore(store)
  return store
}

function templates(): PromptTemplate[] {
  return getSettings().promptTemplates || []
}

function isChatFocused(): boolean {
  const win = getChatWindow()
  return !!(win && !win.isDestroyed() && win.isVisible() && win.isFocused())
}

function createChatFromPreset(presetId?: string): Conversation {
  const settings = getSettings()
  const now = Date.now()
  const tpl = presetId ? templates().find((t) => t.id === presetId) : undefined
  const home = homedir()
  const cwd =
    typeof settings.cwd === 'string' && settings.cwd.trim() && !isUserHomeDir(settings.cwd, home)
      ? settings.cwd.trim()
      : undefined
  return {
    id: uid('c'),
    title: tpl?.name || '快速对话',
    messages: [],
    kind: 'chat',
    cwd,
    modelRef: settings.defaultModelRef,
    agentAutonomy: settings.defaultAgentAutonomy,
    systemPrompt: tpl?.content || undefined,
    promptTemplateId: tpl?.id,
    createdAt: now,
    updatedAt: now
  }
}

/** 复用任务时：超过 2h 无继续则本任务内自动开新对话。 */
function withIdleThreadRotation(store: ChatStore, conversationId: string): ChatStore {
  const conv = store.conversations.find((c) => c.id === conversationId)
  if (!conv) return store
  const next = rotateQuickChatThreadIfIdle(conv)
  if (next === conv) return store
  return {
    ...store,
    conversations: store.conversations.map((c) => (c.id === conversationId ? next : c))
  }
}

function applyResolve(resolved: QuickChatResolve): {
  store: ChatStore
  conversationId: string
  surface: 'panel' | 'strip'
  created: boolean
} | null {
  if (resolved.action === 'ignore') return null
  let store = ensureStore()
  let created = false
  let conversationId: string
  if (resolved.action === 'create') {
    const conv = createChatFromPreset(resolved.fromPresetId)
    store = {
      ...store,
      conversations: [...store.conversations, conv],
      activeId: conv.id,
      lastChatInteractedId: conv.id
    }
    saveChatStore(store)
    created = true
    conversationId = conv.id
  } else {
    conversationId = resolved.conversationId
    store = withIdleThreadRotation(
      {
        ...store,
        lastChatInteractedId: conversationId,
        activeId: store.activeId || conversationId
      },
      conversationId
    )
    saveChatStore(store)
  }
  return { store, conversationId, surface: resolved.surface, created }
}

function syncChatWindow(store: ChatStore, conversationId: string, focusComposer: boolean): void {
  const win = getChatWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.quickChatSync, {
    store,
    conversationId,
    focusComposer
  })
}

/** 按钮 / 快捷键 / 点宠：准备会话。 */
export function armQuickChat(_payload?: { trigger?: 'click' }): QuickChatArmResult {
  const settings = getSettings().quickChat
  if (settings && settings.enabled === false) {
    return { ok: false, error: '快速对话已关闭' }
  }
  const store = ensureStore()
  const resolved = resolveQuickChatTarget({
    chatPanelFocused: isChatFocused(),
    activeId: store.activeId,
    lastChatInteractedId: store.lastChatInteractedId,
    conversations: store.conversations
  })
  const applied = applyResolve(resolved)
  if (!applied) {
    return { ok: false, error: '无法打开对话' }
  }
  const conv = applied.store.conversations.find((c) => c.id === applied.conversationId)
  if (applied.surface === 'panel') {
    openChat()
    syncChatWindow(applied.store, applied.conversationId, true)
  } else {
    syncChatWindow(applied.store, applied.conversationId, false)
  }
  return {
    ok: true,
    conversationId: applied.conversationId,
    title: conv?.title || '对话',
    surface: applied.surface,
    created: applied.created
  }
}

/** 语音一句：整句作为待发文本（不再解析唤醒词）。 */
export function armQuickChatFromVoice(transcript: string): QuickChatArmResult {
  const text = (transcript || '').trim()
  if (!text) return { ok: false, error: '没有听清' }
  const armed = armQuickChat()
  if (!armed.ok) return armed
  return { ...armed, pendingText: text }
}

type QuickSendPayload = {
  conversationId: string
  text: string
  attachments: Array<{ path: string; name: string; mime?: string; size?: number }>
}

/** 对话窗刚重建时 React 可能还没挂上监听；暂存后由 ready 冲刷。 */
let pendingQuickSend: QuickSendPayload | null = null
let chatUiReady = false

export function notifyQuickChatUiReady(): void {
  chatUiReady = true
  const pending = pendingQuickSend
  if (!pending) return
  pendingQuickSend = null
  const win = getChatWindow()
  if (!win || win.isDestroyed()) return
  dispatchQuickSend(win, pending)
}

export function notifyQuickChatUiGone(): void {
  chatUiReady = false
}

function dispatchQuickSend(win: BrowserWindow, payload: QuickSendPayload): void {
  if (!chatUiReady) {
    pendingQuickSend = payload
    return
  }
  win.webContents.send(IPC.quickChatSendToChat, payload)
}

/**
 * 宠边发送：目标任务若已删则新建对话。
 */
export function sendQuickChat(payload: {
  conversationId?: string
  text?: string
  attachments?: Array<{ path: string; name: string; mime?: string; size?: number }>
}): QuickChatArmResult {
  const text = (payload.text || '').trim()
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
  if (!text && !attachments.length) {
    return { ok: false, error: '没有内容' }
  }
  let store = ensureStore()
  let conv = store.conversations.find((c) => c.id === payload.conversationId)
  let created = false
  if (!conv || (conv.kind && conv.kind !== 'chat')) {
    conv = createChatFromPreset()
    store = {
      ...store,
      conversations: [...store.conversations, conv],
      activeId: conv.id,
      lastChatInteractedId: conv.id
    }
    saveChatStore(store)
    created = true
  } else {
    store = withIdleThreadRotation(
      {
        ...store,
        lastChatInteractedId: conv.id,
        activeId: conv.id
      },
      conv.id
    )
    conv = store.conversations.find((c) => c.id === conv!.id) || conv
    saveChatStore(store)
  }
  const hadWindow = !!(getChatWindow() && !getChatWindow()!.isDestroyed())
  const win = ensureChatWindow()
  if (!win || win.isDestroyed()) {
    return { ok: false, error: '对话窗未就绪' }
  }
  if (!hadWindow) chatUiReady = false
  // 新建或空闲轮换后都要把最新 threads 同步进对话窗，再代发
  syncChatWindow(store, conv.id, false)
  dispatchQuickSend(win, {
    conversationId: conv.id,
    text,
    attachments
  })
  return {
    ok: true,
    conversationId: conv.id,
    title: conv.title || '对话',
    created
  }
}
