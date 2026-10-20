import { describe, expect, it } from 'vitest'
import {
  ideLaunchPlan,
  normalizeOpenPanelPayload,
  resolveAttnOpen,
  resolvePresenceOpen,
  resolvePresenceOpenTarget
} from '../src/shared/openPanel'

describe('normalizeOpenPanelPayload', () => {
  it('接受旧字符串载荷', () => {
    expect(normalizeOpenPanelPayload('settings')).toEqual({ panel: 'settings' })
    expect(normalizeOpenPanelPayload('chat')).toEqual({ panel: 'chat' })
  })

  it('接受带 section 的对象', () => {
    expect(normalizeOpenPanelPayload({ panel: 'settings', section: 'settings-about' })).toEqual({
      panel: 'settings',
      section: 'settings-about'
    })
  })

  it('接受 conversationId 深链', () => {
    expect(
      normalizeOpenPanelPayload({ panel: 'chat', conversationId: 'c123' })
    ).toEqual({ panel: 'chat', conversationId: 'c123' })
  })

  it('接受 RSS 条目 / 简报深链', () => {
    expect(
      normalizeOpenPanelPayload({
        panel: 'chat',
        conversationId: 'rss1',
        rssEntryId: 'e1',
        rssExitDigest: true
      })
    ).toEqual({
      panel: 'chat',
      conversationId: 'rss1',
      rssEntryId: 'e1',
      rssExitDigest: true
    })
    expect(
      normalizeOpenPanelPayload({
        panel: 'chat',
        conversationId: 'rss1',
        rssDigestId: 'd1'
      })
    ).toEqual({ panel: 'chat', conversationId: 'rss1', rssDigestId: 'd1' })
  })

  it('接受 focusComposer', () => {
    expect(
      normalizeOpenPanelPayload({
        panel: 'chat',
        conversationId: 'c123',
        focusComposer: true
      })
    ).toEqual({ panel: 'chat', conversationId: 'c123', focusComposer: true })
  })

  it('非法载荷落到 chat', () => {
    expect(normalizeOpenPanelPayload(null)).toEqual({ panel: 'chat' })
    expect(normalizeOpenPanelPayload({ panel: 'nope' })).toEqual({ panel: 'chat' })
  })

  it('接受 monitorSessionId', () => {
    expect(
      normalizeOpenPanelPayload({ panel: 'monitor', monitorSessionId: 'sess-1' })
    ).toEqual({ panel: 'monitor', monitorSessionId: 'sess-1' })
  })

  it('接受 today 工作台', () => {
    expect(normalizeOpenPanelPayload('today')).toEqual({ panel: 'today' })
    expect(normalizeOpenPanelPayload({ panel: 'today' })).toEqual({ panel: 'today' })
  })
})

describe('resolvePresenceOpen', () => {
  it('IDE 续查绑定优先打开对话', () => {
    const bindings = new Map([['ide:s1', 'conv-continue']])
    expect(
      resolvePresenceOpen(
        { conversationId: 'ide:s1', focusComposer: true },
        bindings
      )
    ).toEqual({
      kind: 'panel',
      target: {
        panel: 'chat',
        conversationId: 'conv-continue',
        focusComposer: true
      }
    })
  })

  it('无绑定 IDE 轨 → 唤起本机 IDE（不是联动活动）', () => {
    expect(
      resolvePresenceOpen(
        { conversationId: 'ide:sess-xyz', ideApp: 'Cursor' },
        new Map()
      )
    ).toEqual({ kind: 'app', name: 'Cursor' })
  })

  it('显式要监控时才带 session 分轨', () => {
    expect(
      resolvePresenceOpen(
        { conversationId: 'ide:sess-xyz', panel: 'monitor' },
        new Map()
      )
    ).toEqual({
      kind: 'panel',
      target: { panel: 'monitor', monitorSessionId: 'sess-xyz' }
    })
  })

  it('普通对话 id', () => {
    expect(
      resolvePresenceOpen(
        { conversationId: 'c1', panel: 'chat', focusComposer: true },
        new Map()
      )
    ).toEqual({
      kind: 'panel',
      target: { panel: 'chat', conversationId: 'c1', focusComposer: true }
    })
  })

  it('IDE 续查对话已经不在了就改唤软件', () => {
    const bindings = new Map([['ide:s1', 'gone-conv']])
    expect(
      resolveAttnOpen(
        { conversationId: 'ide:s1', ideApp: 'Cursor' },
        bindings,
        () => false
      )
    ).toEqual({ kind: 'app', name: 'Cursor' })
  })

  it('Cursor / Codex 启动候选含应用名', () => {
    expect(ideLaunchPlan('Cursor').names).toContain('Cursor')
    expect(ideLaunchPlan('Codex').names).toContain('ChatGPT')
  })

  it('兼容旧 resolvePresenceOpenTarget：无绑定 IDE 不返回 monitor', () => {
    expect(
      resolvePresenceOpenTarget({ conversationId: 'ide:sess-xyz' }, new Map())
    ).toEqual({ panel: 'chat' })
  })
})
