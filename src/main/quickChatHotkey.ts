/**
 * 快速对话全局快捷键。
 * 对话窗可见且聚焦时注销，避免抢走 Chat 内 ⌘F/⌘K 等快捷键。
 */
import { globalShortcut, type BrowserWindow } from 'electron'
import { normalizeQuickChatSettings } from '../shared/quickChat'
import { IPC } from '../shared/types'
import { getSettings } from './store'
import { getChatWindow, getPetWindow } from './windows'

let registeredAccel: string | null = null
const wiredWins = new WeakSet<BrowserWindow>()

function chatTakesPriority(): boolean {
  const win = getChatWindow()
  return !!(win && !win.isDestroyed() && win.isVisible() && win.isFocused())
}

function fireOpenQuickChat(): void {
  if (chatTakesPriority()) return
  const pet = getPetWindow()
  if (!pet || pet.isDestroyed()) return
  pet.webContents.send(IPC.quickChatHotkey)
}

export function unregisterQuickChatHotkey(): void {
  if (!registeredAccel) return
  try {
    globalShortcut.unregister(registeredAccel)
  } catch {
    /* ignore */
  }
  registeredAccel = null
}

/** 按当前设置与对话窗焦点状态刷新注册。 */
export function refreshQuickChatHotkey(): void {
  unregisterQuickChatHotkey()
  const qc = normalizeQuickChatSettings(getSettings().quickChat)
  if (!qc.enabled) return
  const accel = (qc.hotkey || '').trim()
  if (!accel) return
  if (chatTakesPriority()) return
  try {
    const ok = globalShortcut.register(accel, () => {
      fireOpenQuickChat()
    })
    if (ok) registeredAccel = accel
    else console.warn('[quick-chat] hotkey register failed:', accel)
  } catch (err) {
    console.warn('[quick-chat] hotkey error:', err)
  }
}

/** 给对话窗挂 focus/blur/show/hide。 */
export function wireQuickChatHotkeyToChatWindow(win: BrowserWindow): void {
  if (wiredWins.has(win)) return
  wiredWins.add(win)
  const bump = (): void => refreshQuickChatHotkey()
  win.on('focus', bump)
  win.on('blur', bump)
  win.on('show', bump)
  win.on('hide', bump)
  win.on('closed', bump)
  bump()
}
