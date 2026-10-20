import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUICK_CHAT_HOTKEY,
  normalizeQuickChatHotkey,
  normalizeQuickChatSettings,
  QUICK_CHAT_IDLE_NEW_THREAD_MS,
  resolveQuickChatTarget,
  rotateQuickChatThreadIfIdle,
  shouldRotateQuickChatThread
} from '../src/shared/quickChat'
import type { ChatMessage, Conversation } from '../src/shared/types'

function chat(partial: Partial<Conversation> & { id: string }): Conversation {
  const now = Date.now()
  return {
    title: partial.title || 't',
    messages: [],
    createdAt: now,
    updatedAt: partial.updatedAt ?? now,
    kind: 'chat',
    ...partial
  }
}

function userMsg(text: string, createdAt: number): ChatMessage {
  return {
    id: 'm' + createdAt,
    role: 'user',
    createdAt,
    blocks: [{ kind: 'text', text }]
  }
}

describe('quickChat', () => {
  it('defaults hotkey and normalizes empty to off', () => {
    expect(normalizeQuickChatSettings({}).hotkey).toBe(DEFAULT_QUICK_CHAT_HOTKEY)
    expect(normalizeQuickChatHotkey('')).toBe('')
    expect(normalizeQuickChatHotkey('CommandOrControl+Alt+Q')).toBe('CommandOrControl+Alt+Q')
  })

  it('routes click to focused panel then recent chat', () => {
    const convs = [chat({ id: 'old', updatedAt: 1 }), chat({ id: 'new', updatedAt: 99 })]
    expect(
      resolveQuickChatTarget({
        chatPanelFocused: true,
        activeId: 'old',
        conversations: convs
      })
    ).toEqual({ action: 'use', conversationId: 'old', surface: 'panel' })

    expect(
      resolveQuickChatTarget({
        chatPanelFocused: false,
        lastChatInteractedId: 'old',
        conversations: convs
      })
    ).toEqual({ action: 'use', conversationId: 'old', surface: 'strip' })
  })

  it('creates when no chat tasks', () => {
    expect(
      resolveQuickChatTarget({
        chatPanelFocused: false,
        conversations: []
      })
    ).toEqual({ action: 'create', surface: 'strip' })
  })

  it('rotates to a new in-task thread after 2h idle', () => {
    const now = 1_700_000_000_000
    const stale = now - QUICK_CHAT_IDLE_NEW_THREAD_MS - 1
    const conv = chat({
      id: 'qc',
      createdAt: stale,
      updatedAt: stale,
      messages: [userMsg('昨天聊的', stale)]
    })
    expect(shouldRotateQuickChatThread(conv, now)).toBe(true)
    const next = rotateQuickChatThreadIfIdle(conv, now)
    expect(next).not.toBe(conv)
    expect(next.messages).toEqual([])
    expect(next.threads?.length).toBeGreaterThanOrEqual(2)
    expect(next.activeThreadId).not.toBe(conv.activeThreadId)

    const fresh = chat({
      id: 'qc2',
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      messages: [userMsg('刚聊过', now - 60_000)]
    })
    expect(shouldRotateQuickChatThread(fresh, now)).toBe(false)
    expect(rotateQuickChatThreadIfIdle(fresh, now)).toBe(fresh)

    const empty = chat({ id: 'empty', createdAt: stale, updatedAt: stale, messages: [] })
    expect(shouldRotateQuickChatThread(empty, now)).toBe(false)
  })
})
