import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type {
  AgentEvent,
  BubbleAction,
  LoadedImageSkin,
  PetDockEdge,
  PetMood,
  PetState,
  SkinId
} from '@shared/types'
import { isTypingTarget } from '@shared/typingTarget'
import { attachmentsFromDroppedFiles } from '../lib/dropFiles'
import {
  briefUnreadCount,
  topUnreadBrief,
  type BriefInbox,
  EMPTY_BRIEF_INBOX
} from '@shared/briefInbox'
import {
  agentEventShouldClearIdleChatter,
  canReplaceIdleBubble,
  IDLE_RANK,
  IDLE_SETTLE_MS,
  PUSH_BUBBLE_MS,
  PUSH_SHOW_DEBOUNCE_MS,
  SOFT_BUBBLE_MS,
  STATE_DEBOUNCE_MS,
  THOUGHT_AUTO_HIDE_MS,
  ATTN_AUTO_CLOSE_MS,
  isSamePetAgentTarget,
  resolveNewsBubbleOpenTarget,
  resolveRssPetPushMin,
  pickRssPetTip,
  rssPetTipToBubbleAction,
  rssTipOpenTarget,
  shouldApplyPetStateNow,
  type IdleBubbleRank,
  type PendingPetAgent,
  type RssPetTipPayload
} from '@shared/petBubblePolicy'
import {
  opsBoardKindLabel,
  opsBoardNeedsAttention,
  type OpsBoardItem,
  type OpsBoardSnapshot
} from '@shared/opsBoard'
import { Mascot } from './Mascot'
import { ThoughtBubble } from './ThoughtBubble'
import { QuickChatStrip, type QuickChatSession } from './QuickChatStrip'
import { normalizeQuickChatSettings, resolveConvTtsAutoSpeak } from '@shared/quickChat'
import { StreamTtsController, stopTtsPlayback } from '../ttsPlayback'
import {
  applyChatThemeCustom,
  clearChatThemeCustom,
  DEFAULT_CHAT_THEME,
  isChatThemeId,
  normalizeChatThemeCustom,
  type ChatThemeCustom,
  type ChatThemeId
} from '@shared/chatUi'
import { SKIN_PALETTES } from './skins'
import { randomLocalChatter, type ChatterItem } from './chatter'
import { pickStickerForState, type Sticker } from '../stickers'
import { describeAgentError } from '../agentErrorInfo'
import { parseModelRef } from '@shared/models'

const FIDGETS = ['stretch', 'spin', 'wobble', 'bounce', 'look'] as const

// 每个动作的时长（与 pet.css 里的动画时长对应，毫秒）
const FIDGET_DUR: Record<string, number> = {
  stretch: 1600,
  spin: 1200,
  wobble: 1200,
  bounce: 1400,
  look: 1800
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 渲染时的综合情绪：本地交互情绪优先，否则用 agent 状态。 */
type View = PetState | PetMood

interface State {
  agent: PetState
  mood: PetMood | null // petted / dragged / sleeping（wake 只用于清除）
  toolLabel: string
}

type Action =
  | { t: 'agent'; state: PetState }
  | { t: 'tool'; label: string }
  | { t: 'mood'; mood: PetMood | null }

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'agent':
      return { ...s, agent: a.state }
    case 'tool':
      return { ...s, agent: 'tool', toolLabel: a.label }
    case 'mood':
      return { ...s, mood: a.mood }
  }
}

const IDLE_SLEEP_MS = 45000
const CLICK_WINDOW_MS = 260
const LONG_PRESS_MS: number = 500

export function Pet(): JSX.Element {
  useUiLocale()
  const [state, dispatch] = useReducer(reducer, { agent: 'idle', mood: null, toolLabel: '' })
  const agentStateRef = useRef(state.agent)
  agentStateRef.current = state.agent
  const [skin, setSkin] = useState<SkinId>('violet')
  const [imageSkin, setImageSkin] = useState<LoadedImageSkin | null>(null)
  const [chatter, setChatter] = useState<ChatterItem | null>(null)
  const [fidget, setFidget] = useState<string | null>(null)
  const [actionImg, setActionImg] = useState<string | null>(null)
  /** 多任务待办（等待/出错/完成等），供角标与快捷列表。 */
  const [opsItems, setOpsItems] = useState<OpsBoardItem[]>([])
  const [attnOpen, setAttnOpen] = useState(false)
  const [replySticker, setReplySticker] = useState<Sticker | null>(null)
  const [statusNote, setStatusNote] = useState<string>('')
  /** 模型思维链累积（气泡展示用）。 */
  const [processText, setProcessText] = useState('')
  /** 与对话窗「⋯ 过程」同步。 */
  const [showProcess, setShowProcess] = useState(true)
  const [dockEdge, setDockEdge] = useState<PetDockEdge>(null)
  /** 当前气泡来自 IDE 联动还是本应用对话。 */
  const [bubbleOrigin, setBubbleOrigin] = useState<'ide' | 'cpet'>('cpet')
  /** IDE 气泡点击要唤起的本机应用。 */
  const [ideApp, setIdeApp] = useState('Cursor')
  /** 多任务焦点：点击气泡/宠物时打开对应对话。 */
  const [focusConversationId, setFocusConversationId] = useState<string | undefined>()
  const focusConversationIdRef = useRef<string | undefined>(undefined)
  focusConversationIdRef.current = focusConversationId
  const ideAppRef = useRef(ideApp)
  ideAppRef.current = ideApp
  const bubbleOriginRef = useRef(bubbleOrigin)
  bubbleOriginRef.current = bubbleOrigin
  /** 资讯简报（供空闲气泡 / 升级进对话；不再挂角标面板）。 */
  const [briefInbox, setBriefInbox] = useState<BriefInbox>(EMPTY_BRIEF_INBOX)
  /** 用户点过气泡后先藏起来，直到态势真正变化。 */
  const [bubbleHidden, setBubbleHidden] = useState(false)
  /** 用户关掉的终态气泡：同会话同态心跳不得把 × 打回来。 */
  const dismissedBubbleKeyRef = useRef<string | null>(null)
  const autoHiddenBubbleKeyRef = useRef<string | null>(null)
  const attnHoverRef = useRef(false)
  const attnCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const imageSkinRef = useRef<LoadedImageSkin | null>(null)
  const hasApprovalRef = useRef(false)
  const processBufRef = useRef('')
  const processFlushRaf = useRef<number | null>(null)

  const freeRef = useRef(true)
  /** 进入 idle 的时间，用于 settle 防抽搐。 */
  const idleSinceRef = useRef(Date.now())
  const chatterRankRef = useRef(0)
  const chatterShownAtRef = useRef(0)
  const pushDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presentIdleBubbleRef = useRef<
    (
      item: ChatterItem,
      rank: IdleBubbleRank,
      holdMs: number,
      opts?: { force?: boolean; debounceMs?: number }
    ) => void
  >(() => {})
  const chatterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fidgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lastActivity = useRef(Date.now())
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pettedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 态势尾随防抖：只保留最新目标，安静后再落地。 */
  const pendingAgentRef = useRef<PendingPetAgent | null>(null)
  const stateDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayedAgentRef = useRef<PendingPetAgent>({ state: 'idle' })
  displayedAgentRef.current = {
    state: state.agent,
    toolLabel: state.agent === 'tool' ? state.toolLabel : undefined
  }

  const petBodyRef = useRef<HTMLDivElement>(null)
  const bubbleLayerRef = useRef<HTMLDivElement>(null)
  const attnPanelRef = useRef<HTMLDivElement>(null)
  const quickChatRef = useRef<HTMLDivElement>(null)
  const ignoringRef = useRef(true)
  const [quickSession, setQuickSession] = useState<QuickChatSession | null>(null)
  const [quickVisible, setQuickVisible] = useState(false)
  const quickVisibleRef = useRef(false)
  quickVisibleRef.current = quickVisible
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickStatus, setQuickStatus] = useState<string | undefined>()
  const [quickAsk, setQuickAsk] = useState('')
  const [quickAskAttachments, setQuickAskAttachments] = useState<Array<{ name: string }>>([])
  const [quickReply, setQuickReply] = useState('')
  const [quickAutoSend, setQuickAutoSend] = useState(false)
  const quickTrackCid = useRef<string | null>(null)
  /** 本轮快问是否仍在生成：done 后迟到 delta 不得再点亮「回答中」。 */
  const quickStreamLive = useRef(false)
  const quickReplyBuf = useRef('')
  /** 已上屏长度；大包到达时按步追 buf，避免整段闪出。 */
  const quickReplyShownLen = useRef(0)
  /** 不用 rAF：宠边常被当成后台窗，rAF 会拖到结束才刷，看起来像非流式。 */
  const quickReplyFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 快问条上的上一轮问答：闲置一段时间后收起，避免一直挂着旧对话。 */
  const quickHistoryClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 快问流式朗读：跟随对应任务自动朗读开关；role=pet，对话窗可夺权。 */
  const quickTtsRef = useRef<StreamTtsController | null>(null)
  const quickTtsEnabledRef = useRef(false)
  const quickTtsAutoDefaultRef = useRef(false)
  const quickConvAutoSpeakRef = useRef<boolean | undefined>(undefined)
  /** 对话窗开着时，流式/完成不要把快问气泡再顶出来。 */
  const chatOpenRef = useRef(false)
  const closeQuickSurfaceRef = useRef<() => void>(() => undefined)
  /** 鼠标停在气泡/快问上时，到期的自动消失先挂起，移开后再清。 */
  const bubbleHoverRef = useRef(false)
  type BubbleDismissKind = 'chatter' | 'sticker' | 'doneIdle' | 'errorIdle' | 'quickHistory'
  const deferredBubbleDismiss = useRef<Map<BubbleDismissKind, () => void>>(new Map())

  /** 回答结束后多久不再展示上一轮问答（毫秒）。 */
  const QUICK_HISTORY_TTL_MS = 60_000

  function clearQuickReplyFlush(): void {
    if (quickReplyFlushTimer.current != null) {
      clearTimeout(quickReplyFlushTimer.current)
      quickReplyFlushTimer.current = null
    }
  }

  function shouldQuickTts(): boolean {
    if (!quickTtsEnabledRef.current) return false
    return resolveConvTtsAutoSpeak(
      { ttsAutoSpeak: quickConvAutoSpeakRef.current },
      quickTtsAutoDefaultRef.current
    )
  }

  async function refreshQuickTtsPrefs(conversationId?: string): Promise<void> {
    try {
      const [s, store] = await Promise.all([
        window.petApi.getSettings(),
        window.petApi.getChatStore()
      ])
      const qc = normalizeQuickChatSettings(s.quickChat)
      quickTtsEnabledRef.current = qc.tts === 'edge' || qc.tts === 'local'
      quickTtsAutoDefaultRef.current = qc.ttsAutoSpeak === true
      const cid = conversationId?.trim()
      const conv = cid ? store?.conversations?.find((c) => c.id === cid) : undefined
      quickConvAutoSpeakRef.current =
        conv && typeof conv.ttsAutoSpeak === 'boolean' ? conv.ttsAutoSpeak : undefined
    } catch {
      // 设置读失败时沿用上次缓存
    }
  }

  function feedQuickTts(delta: string): void {
    if (!delta || !shouldQuickTts()) return
    const cid = quickTrackCid.current
    if (!cid) return
    let ctrl = quickTtsRef.current
    if (ctrl?.active) {
      if (ctrl.finishing) ctrl.reopenForLateDelta()
      ctrl.push(delta)
      return
    }
    ctrl = new StreamTtsController(undefined, {
      maxInFlight: 1,
      role: 'pet',
      conversationId: cid,
      haltExisting: false
    })
    quickTtsRef.current = ctrl
    ctrl.push(delta)
  }

  function endQuickTts(fallbackText?: string): void {
    const ctrl = quickTtsRef.current
    if (ctrl?.active) {
      const spoken = ctrl.spokenChars
      ctrl.end()
      void ctrl.whenSynthIdle().then(() => {
        if (quickTtsRef.current === ctrl) quickTtsRef.current = null
      })
      if (spoken > 0) return
      void ctrl.whenSynthIdle().then(() => {
        if (ctrl.spokenChars > 0) return
        if (quickTtsRef.current === ctrl) return
        const text = (fallbackText || '').trim()
        if (!text || !shouldQuickTts()) return
        feedQuickTts(text)
        quickTtsRef.current?.end()
      })
      return
    }
    const text = (fallbackText || '').trim()
    if (!text || !shouldQuickTts()) return
    feedQuickTts(text)
    quickTtsRef.current?.end()
  }

  function cancelQuickTts(): void {
    const ctrl = quickTtsRef.current
    if (ctrl) {
      ctrl.cancel()
      quickTtsRef.current = null
    }
  }

  function clearQuickHistoryTimer(): void {
    if (quickHistoryClearTimer.current != null) {
      clearTimeout(quickHistoryClearTimer.current)
      quickHistoryClearTimer.current = null
    }
  }

  function cancelDeferredBubbleDismiss(kind?: BubbleDismissKind): void {
    if (kind) deferredBubbleDismiss.current.delete(kind)
    else deferredBubbleDismiss.current.clear()
  }

  /** 定时到了：悬停中则挂起，否则立刻执行。 */
  function runBubbleDismiss(kind: BubbleDismissKind, fn: () => void): void {
    if (bubbleHoverRef.current) {
      deferredBubbleDismiss.current.set(kind, fn)
      return
    }
    deferredBubbleDismiss.current.delete(kind)
    fn()
  }

  function setBubbleHover(on: boolean): void {
    bubbleHoverRef.current = on
    if (on) return
    const pending = [...deferredBubbleDismiss.current.entries()]
    deferredBubbleDismiss.current.clear()
    for (const [, fn] of pending) fn()
  }

  /** 清掉快问条上的问答展示（不关会话，仍可续问）。 */
  function clearQuickHistoryDisplay(): void {
    clearQuickHistoryTimer()
    cancelDeferredBubbleDismiss('quickHistory')
    clearQuickReplyFlush()
    setQuickAsk('')
    setQuickAskAttachments([])
    setQuickReply('')
    setQuickStatus(undefined)
    quickReplyBuf.current = ''
    quickReplyShownLen.current = 0
  }

  function scheduleQuickHistoryClear(): void {
    clearQuickHistoryTimer()
    cancelDeferredBubbleDismiss('quickHistory')
    quickHistoryClearTimer.current = setTimeout(() => {
      quickHistoryClearTimer.current = null
      runBubbleDismiss('quickHistory', () => clearQuickHistoryDisplay())
    }, QUICK_HISTORY_TTL_MS)
  }

  /** 对话窗已开时只更新内容，不重新展开快问条。 */
  function revealQuickSurface(): void {
    if (chatOpenRef.current) return
    setQuickVisible(true)
  }

  function paintQuickReply(text: string, busy = true): void {
    quickReplyShownLen.current = text.length
    setQuickReply(text)
    revealQuickSurface()
    // 生成已结束后禁止再点亮 busy（ensureFinalText 迟到片会走这里）
    if (busy && quickStreamLive.current) setQuickBusy(true)
    setQuickStatus(undefined)
  }

  function settleQuickStream(opts?: {
    status?: string
    reply?: string
    tts?: 'end' | 'cancel' | 'none'
    ttsFallback?: string
  }): void {
    quickStreamLive.current = false
    clearQuickReplyFlush()
    setQuickBusy(false)
    if (opts?.reply !== undefined) {
      quickReplyBuf.current = opts.reply
      quickReplyShownLen.current = opts.reply.length
      setQuickReply(opts.reply)
    }
    if (opts?.status !== undefined) setQuickStatus(opts.status)
    revealQuickSurface()
    if (opts?.tts === 'cancel') cancelQuickTts()
    else if (opts?.tts === 'end') endQuickTts(opts.ttsFallback ?? opts.reply)
  }

  /** 追平 buf：真增量直接刷；单包很大则步进揭示。 */
  function pumpQuickReplyStream(): void {
    clearQuickReplyFlush()
    const target = quickReplyBuf.current
    const shown = quickReplyShownLen.current
    if (!target) {
      paintQuickReply('', true)
      return
    }
    if (shown >= target.length) {
      paintQuickReply(target, true)
      return
    }
    const gap = target.length - shown
    if (gap <= 28) {
      paintQuickReply(target, true)
      return
    }
    const step = Math.min(gap, Math.max(4, Math.ceil(gap / 10)))
    paintQuickReply(target.slice(0, shown + step), true)
    if (quickReplyShownLen.current < quickReplyBuf.current.length) {
      quickReplyFlushTimer.current = setTimeout(() => pumpQuickReplyStream(), 28)
    }
  }

  function scheduleQuickReplyFlush(): void {
    if (quickReplyFlushTimer.current != null) return
    quickReplyFlushTimer.current = setTimeout(() => {
      quickReplyFlushTimer.current = null
      pumpQuickReplyStream()
    }, 24)
  }
  const openQuickChatRef = useRef<() => void>(() => undefined)
  /** 麦克风打开条后是否自动听一轮。 */
  const [quickAutoListen, setQuickAutoListen] = useState(false)

  // 快问 / 待办列表展开：垫高窗口，避免头顶面板被裁切
  useEffect(() => {
    const open = (quickVisible && !!quickSession) || attnOpen
    window.petApi.setPetQuickChatExpanded({ expanded: open, wide: attnOpen })
    if (open) setBubbleHidden(true)
    return () => window.petApi.setPetQuickChatExpanded(false)
  }, [quickVisible, quickSession, attnOpen])

  // 打开对话窗 → 自动收起快问气泡（避免和完整对话叠两层）
  useEffect(() => {
    return window.petApi.onChatVisibility((visible) => {
      chatOpenRef.current = visible
      if (visible) closeQuickSurfaceRef.current()
    })
  }, [])

  const openQuickChatFromMicRef = useRef<() => void>(() => undefined)
  // 全局快捷键（主进程在对话窗聚焦时不注册，故不会抢 Chat 内快捷键）
  useEffect(() => {
    return window.petApi.onQuickChatHotkey(() => {
      openQuickChatFromMicRef.current()
    })
  }, [])

  useEffect(() => {
    return () => {
      clearQuickHistoryTimer()
      clearQuickReplyFlush()
    }
  }, [])

  // 交互相关
  const dragging = useRef(false)
  const moved = useRef(false)
  const longPressed = useRef(false)
  const startPos = useRef({ x: 0, y: 0 })
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickCount = useRef(0)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const bump = (): void => {
    lastActivity.current = Date.now()
  }

  // 同步 imageSkin 到 ref，供事件回调读取最新值
  useEffect(() => {
    imageSkinRef.current = imageSkin
  }, [imageSkin])

  function showReplySticker(state: 'done' | 'error' | 'talking' | 'thinking'): void {
    const pool = imageSkinRef.current?.actions
    setReplySticker(pickStickerForState(state, pool))
    if (stickerTimer.current) clearTimeout(stickerTimer.current)
    cancelDeferredBubbleDismiss('sticker')
    stickerTimer.current = setTimeout(() => {
      stickerTimer.current = null
      runBubbleDismiss('sticker', () => setReplySticker(null))
    }, 4200)
  }

  function pickImages(pool: string[], n: number): string[] {
    if (!pool.length) return []
    if (pool.length >= n) return shuffle(pool).slice(0, n)
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(pool[Math.floor(Math.random() * pool.length)])
    return out
  }

  /** 图片皮肤：依次播放一串动作图（清空强制 GIF 重播）。 */
  function runImageActions(imgs: string[]): void {
    if (!imgs.length) return
    if (actionTimer.current) clearTimeout(actionTimer.current)
    setFidget(null)
    let i = 0
    const next = (): void => {
      if (i >= imgs.length) {
        setActionImg(null)
        return
      }
      const url = imgs[i++]
      setActionImg(null)
      actionTimer.current = setTimeout(() => {
        setActionImg(url)
        actionTimer.current = setTimeout(next, 1600)
      }, 40)
    }
    next()
  }

  /** 统一的「做动作」：图片皮肤用皮肤里「所有图片」随机播放，否则用 CSS 动效。 */
  function doAction(kind: 'random' | 'combo' | string): void {
    const skin = imageSkinRef.current
    if (skin) {
      // 全部图片 = 状态图 + 动作图（去重）
      const pool = [...new Set([...Object.values(skin.images), ...skin.actions])]
      if (pool.length) {
        const n = kind === 'combo' ? Math.min(5, Math.max(3, pool.length)) : 1
        runImageActions(pickImages(pool, n))
        return
      }
    }
    if (kind === 'random') runActions([FIDGETS[Math.floor(Math.random() * FIDGETS.length)]])
    else if (kind === 'combo') runActions(shuffle(FIDGETS).slice(0, 4))
    else runActions([kind])
  }

  // ---- 由 agent 事件驱动状态 ----
  useEffect(() => {
    const clearStateDebounce = (): void => {
      if (stateDebounceTimer.current) clearTimeout(stateDebounceTimer.current)
      stateDebounceTimer.current = null
      pendingAgentRef.current = null
    }

    const commitAgentTarget = (target: PendingPetAgent): void => {
      if (target.state !== 'error') {
        if (errorTimer.current) {
          clearTimeout(errorTimer.current)
          errorTimer.current = null
        }
        cancelDeferredBubbleDismiss('errorIdle')
      }
      if (target.state === 'tool') {
        dispatch({ t: 'tool', label: target.toolLabel || '' })
      } else {
        dispatch({ t: 'agent', state: target.state })
      }
    }

    const armErrorIdle = (): void => {
      if (errorTimer.current) clearTimeout(errorTimer.current)
      cancelDeferredBubbleDismiss('errorIdle')
      errorTimer.current = setTimeout(() => {
        errorTimer.current = null
        runBubbleDismiss('errorIdle', () => {
          setStatusNote('')
          clearStateDebounce()
          dispatch({ t: 'agent', state: 'idle' })
        })
      }, 3600)
    }

    /** 尾随防抖：连发只留最新；waiting/error/done 立即落地。 */
    const requestAgentState = (next: PetState, meta?: { toolLabel?: string }): void => {
      const target: PendingPetAgent = {
        state: next,
        toolLabel: next === 'tool' ? meta?.toolLabel || '' : undefined
      }
      // 已展示同目标且无 pending → 忽略
      if (!pendingAgentRef.current && isSamePetAgentTarget(displayedAgentRef.current, target)) {
        return
      }
      // 已 pending 同目标 → 不重置计时
      if (isSamePetAgentTarget(pendingAgentRef.current, target)) {
        return
      }

      if (shouldApplyPetStateNow(next)) {
        clearStateDebounce()
        commitAgentTarget(target)
        return
      }

      pendingAgentRef.current = target
      if (stateDebounceTimer.current) clearTimeout(stateDebounceTimer.current)
      stateDebounceTimer.current = setTimeout(() => {
        const pending = pendingAgentRef.current
        stateDebounceTimer.current = null
        pendingAgentRef.current = null
        if (pending) commitAgentTarget(pending)
      }, STATE_DEBOUNCE_MS)
    }

    const effectiveAgentState = (): PetState =>
      pendingAgentRef.current?.state ?? agentStateRef.current

    const applyChatTheme = (theme: ChatThemeId, custom: ChatThemeCustom): void => {
      const root = document.documentElement
      root.setAttribute('data-theme', theme)
      if (theme === 'custom') applyChatThemeCustom(root, custom)
      else clearChatThemeCustom(root)
    }

    window.petApi.getSettings().then((s) => {
      setSkin(s.skin)
      setShowProcess(s.showReasoning !== false && s.showTools !== false)
      const qc = normalizeQuickChatSettings(s.quickChat)
      setQuickAutoSend(qc.autoSend)
      quickTtsEnabledRef.current = qc.tts === 'edge' || qc.tts === 'local'
      quickTtsAutoDefaultRef.current = qc.ttsAutoSpeak === true
      applyChatTheme(
        isChatThemeId(s.chatTheme) ? s.chatTheme : DEFAULT_CHAT_THEME,
        normalizeChatThemeCustom(s.chatThemeCustom)
      )
    })
    window.petApi.getImageSkin().then(setImageSkin)
    const offSkin = window.petApi.onPetSkin((s) => {
      setSkin(s)
      setImageSkin(null) // 切到矢量皮肤时清掉图片皮肤
    })
    const offImgSkin = window.petApi.onPetImageSkin((s) => setImageSkin(s))
    const offShowDetails = window.petApi.onShowDetailsChange((show) => setShowProcess(show))
    const offChatTheme = window.petApi.onChatTheme((payload) => {
      applyChatTheme(
        isChatThemeId(payload.theme) ? payload.theme : DEFAULT_CHAT_THEME,
        normalizeChatThemeCustom(payload.custom)
      )
    })

    const offState = window.petApi.onPetState((s) => {
      bump()
      requestAgentState(s)
    })

    const offMood = window.petApi.onPetMood((m: PetMood) => {
      bump()
      if (m === 'wake') dispatch({ t: 'mood', mood: null })
      else if (m === 'petted') triggerPetted()
      else dispatch({ t: 'mood', mood: m })
    })

    const offAction = window.petApi.onPetAction((action: string) => {
      bump()
      setChatter(null)
      dispatch({ t: 'mood', mood: null }) // 叫醒
      doAction(action)
    })

    const offDock = window.petApi.onPetDockEdge((edge) => setDockEdge(edge))

    const offEvent = window.petApi.onAgentEvent((e: AgentEvent) => {
      bump()
      const quietTerminal =
        (e.type === 'done' || e.type === 'error' || e.type === 'aborted') &&
        e.quiet === true
      // quiet 终态只清快问 busy，不抢宠物态势 / 焦点 / 气泡
      if (!quietTerminal) {
        // agent 活动 → 叫醒；流式 delta 不清碎碎念，避免抽搐（气泡层本身会被 ThoughtBubble 盖住）
        dispatch({ t: 'mood', mood: null })
        if (agentEventShouldClearIdleChatter(e)) {
          setChatter(null)
          chatterRankRef.current = 0
          setFidget(null)
          setActionImg(null)
        }
        // 有 origin 就刷新，避免粘在上次 IDE；缺省按轨 id 推断
        if (e.origin === 'ide' || e.origin === 'cpet') {
          setBubbleOrigin(e.origin)
        } else if (e.conversationId?.startsWith('ide:')) {
          setBubbleOrigin('ide')
        } else if (e.conversationId) {
          setBubbleOrigin('cpet')
        }
        if (e.ideApp?.trim()) setIdeApp(e.ideApp.trim())
        if (e.conversationId) setFocusConversationId(e.conversationId)
        if (e.type === 'state' && e.state === 'thinking') {
          setReplySticker(null)
        }
        // 同会话同态（尤其 IDE waiting 心跳）不得把用户关掉的气泡打回来
        {
          const nextState: PetState | null =
            e.type === 'state'
              ? e.state
              : e.type === 'done'
                ? 'done'
                : e.type === 'error'
                  ? 'error'
                  : e.type === 'aborted'
                    ? 'idle'
                    : e.type === 'tool' || e.type === 'command'
                      ? e.status === 'running'
                        ? 'tool'
                        : null
                      : e.type === 'assistant-delta'
                        ? 'talking'
                        : e.type === 'reasoning-delta'
                          ? 'thinking'
                          : null
          if (nextState) {
            const key = `${e.conversationId || '_'}::${nextState}`
            if (nextState === 'idle') {
              dismissedBubbleKeyRef.current = null
              autoHiddenBubbleKeyRef.current = null
              setBubbleHidden(false)
            } else if (
              dismissedBubbleKeyRef.current === key ||
              autoHiddenBubbleKeyRef.current === key
            ) {
              setBubbleHidden(true)
            } else {
              dismissedBubbleKeyRef.current = null
              autoHiddenBubbleKeyRef.current = null
              setBubbleHidden(false)
            }
          }
        }
      }
      switch (e.type) {
        case 'state':
          if (e.state === 'thinking' || e.state === 'talking' || e.state === 'tool') {
            setStatusNote('')
          }
          // 仅空闲时清思维链；thinking 反复推送时不要把已累积的链冲掉
          if (e.state === 'idle') {
            processBufRef.current = ''
            setProcessText('')
            // 引擎虚弱提示挂在 idle.note 上
            setStatusNote(e.note?.trim() || '')
          }
          if (e.state === 'waiting' && e.note) setStatusNote(e.note)
          if (e.state === 'error' && e.note) setStatusNote(e.note)
          requestAgentState(e.state)
          if (e.state === 'error') armErrorIdle()
          break
        case 'reasoning-delta':
          processBufRef.current = (processBufRef.current + e.text).slice(-800)
          if (processFlushRaf.current == null) {
            processFlushRaf.current = requestAnimationFrame(() => {
              processFlushRaf.current = null
              setProcessText(processBufRef.current)
            })
          }
          if (effectiveAgentState() !== 'thinking') {
            requestAgentState('thinking')
          }
          break
        case 'assistant-delta':
          // 同态不重复请求，避免逐 token 重置防抖
          if (effectiveAgentState() !== 'talking') {
            requestAgentState('talking')
          }
          if (
            quickTrackCid.current &&
            typeof e.text === 'string' &&
            e.text &&
            (!e.conversationId || e.conversationId === quickTrackCid.current)
          ) {
            quickReplyBuf.current = (quickReplyBuf.current + e.text).slice(-4000)
            if (quickStreamLive.current) {
              // setTimeout 追屏（不用 rAF）；大包会步进揭示
              scheduleQuickReplyFlush()
              // 首包不等 24ms
              if (quickReplyShownLen.current === 0) pumpQuickReplyStream()
              // 跟随对应任务自动朗读；role=pet，对话窗聚焦时可夺权
              feedQuickTts(e.text)
            } else {
              // 终局迟到片：只补正文，绝不重新点亮「回答中」
              quickReplyShownLen.current = quickReplyBuf.current.length
              setQuickReply(quickReplyBuf.current)
            }
          }
          break
        case 'tool':
          if (e.status === 'running') {
            setStatusNote('')
            requestAgentState('tool', { toolLabel: e.name })
          }
          break
        case 'command':
          if (e.status === 'running') {
            setStatusNote('')
            requestAgentState('tool', { toolLabel: e.command })
          }
          break
        case 'done': {
          const quiet = e.quiet === true
          if (!quiet) {
            setStatusNote(e.result?.trim() || '')
            processBufRef.current = ''
            setProcessText('')
            requestAgentState('done')
            showReplySticker('done')
          }
          if (
            quickTrackCid.current &&
            (!e.conversationId || e.conversationId === quickTrackCid.current)
          ) {
            const reply = (e.result || quickReplyBuf.current || '').trim()
            settleQuickStream({
              reply,
              status: reply ? undefined : '完成',
              tts: 'end',
              ttsFallback: reply
            })
            // 闲置一段时间后收起本轮问答，避免旧历史一直挂着
            scheduleQuickHistoryClear()
          }
          if (!quiet) {
            if (doneTimer.current) clearTimeout(doneTimer.current)
            cancelDeferredBubbleDismiss('doneIdle')
            // done→idle 走既有仪式时长，不再叠加态势防抖；悬停气泡时先挂起
            doneTimer.current = setTimeout(() => {
              doneTimer.current = null
              runBubbleDismiss('doneIdle', () => {
                setStatusNote('')
                clearStateDebounce()
                dispatch({ t: 'agent', state: 'idle' })
              })
            }, e.result?.trim() ? 4200 : 2400)
          }
          break
        }
        case 'aborted':
          if (e.quiet !== true) {
            setStatusNote('')
            processBufRef.current = ''
            setProcessText('')
            requestAgentState('idle')
          }
          if (
            quickTrackCid.current &&
            (!e.conversationId || e.conversationId === quickTrackCid.current)
          ) {
            settleQuickStream({ status: '已暂停', tts: 'cancel' })
            scheduleQuickHistoryClear()
          }
          break
        case 'error':
          if (e.quiet !== true) {
            // 与对话窗同一套文案：头顶气泡也不该出现 spawn ENOENT 这种原文
            setStatusNote(
              describeAgentError(
                e.message,
                e.modelId ? parseModelRef(e.modelId).provider : undefined
              ).summary
            )
            processBufRef.current = ''
            setProcessText('')
            requestAgentState('error')
            showReplySticker('error')
          }
          if (
            quickTrackCid.current &&
            (!e.conversationId || e.conversationId === quickTrackCid.current)
          ) {
            settleQuickStream({
              status: describeAgentError(
                e.message,
                e.modelId ? parseModelRef(e.modelId).provider : undefined
              ).summary,
              tts: 'cancel'
            })
            scheduleQuickHistoryClear()
          }
          if (e.quiet !== true) {
            if (errorTimer.current) clearTimeout(errorTimer.current)
            armErrorIdle()
          }
          break
      }
    })

    const offBrief = window.petApi.onBriefInbox((snap) => {
      setBriefInbox(snap)
    })
    void window.petApi.getBriefInbox().then((snap) => {
      if (snap) setBriefInbox(snap)
    })
    const showDigest = (payload: { text: string; hint: string; briefId?: string }): void => {
      presentIdleBubbleRef.current(
        {
          text: payload.text,
          hint: payload.hint || '点击打开对应资讯',
          action: { kind: 'brief', briefId: payload.briefId }
        },
        IDLE_RANK.brief,
        PUSH_BUBBLE_MS,
        { debounceMs: PUSH_SHOW_DEBOUNCE_MS }
      )
    }
    const showRssTip = (payload: {
      text: string
      hint: string
      conversationId: string
      entryId?: string
      digestId?: string
      rank: number
      key: string
    }): void => {
      const rank: IdleBubbleRank =
        payload.rank >= IDLE_RANK.rssEntry
          ? IDLE_RANK.rssEntry
          : payload.rank >= IDLE_RANK.rssDigest
            ? IDLE_RANK.rssDigest
            : IDLE_RANK.brief
      const tip: RssPetTipPayload = {
        text: payload.text,
        hint: payload.hint,
        conversationId: payload.conversationId,
        entryId: payload.entryId,
        digestId: payload.digestId,
        rank,
        key: payload.key
      }
      presentIdleBubbleRef.current(
        {
          text: tip.text,
          hint: tip.hint,
          action: rssPetTipToBubbleAction(tip)
        },
        tip.rank,
        PUSH_BUBBLE_MS,
        { debounceMs: PUSH_SHOW_DEBOUNCE_MS }
      )
    }
    const offDigest = window.petApi.onBriefDigest(showDigest)
    const offRssTip = window.petApi.onRssPetTip(showRssTip)

    return () => {
      offSkin()
      offImgSkin()
      offShowDetails()
      offChatTheme()
      offState()
      offMood()
      offAction()
      offDock()
      offEvent()
      offBrief()
      offDigest()
      offRssTip()
      if (pushDebounceTimer.current) clearTimeout(pushDebounceTimer.current)
      if (stateDebounceTimer.current) clearTimeout(stateDebounceTimer.current)
      stateDebounceTimer.current = null
      pendingAgentRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 空闲判定（供调度器读取，避免闭包过期） ----
  useEffect(() => {
    const free = state.agent === 'idle' && state.mood === null
    if (free && !freeRef.current) idleSinceRef.current = Date.now()
    freeRef.current = free
  }, [state.agent, state.mood])

  /** 空闲气泡落场：优先级 + 最短展示 + 可选防抖。 */
  const presentIdleBubble = (
    item: ChatterItem,
    rank: IdleBubbleRank,
    holdMs: number,
    opts?: { force?: boolean; debounceMs?: number }
  ): void => {
    const apply = (): void => {
      if (!freeRef.current && !opts?.force) return
      // 用户正在打字或快问开着：空闲气泡不得挤上来抢焦点
      if (quickVisibleRef.current || isTypingTarget(document.activeElement)) return
      if (
        !canReplaceIdleBubble({
          currentRank: chatterRankRef.current,
          currentShownAt: chatterShownAtRef.current,
          nextRank: rank,
          force: opts?.force
        })
      ) {
        return
      }
      setChatter(item)
      chatterRankRef.current = rank
      chatterShownAtRef.current = Date.now()
      if (chatterTimer.current) clearTimeout(chatterTimer.current)
      cancelDeferredBubbleDismiss('chatter')
      chatterTimer.current = setTimeout(() => {
        chatterTimer.current = null
        runBubbleDismiss('chatter', () => {
          setChatter(null)
          chatterRankRef.current = 0
        })
      }, holdMs)
    }
    if (opts?.debounceMs && opts.debounceMs > 0) {
      if (pushDebounceTimer.current) clearTimeout(pushDebounceTimer.current)
      pushDebounceTimer.current = setTimeout(apply, opts.debounceMs)
      return
    }
    apply()
  }
  presentIdleBubbleRef.current = presentIdleBubble

  // ---- 空闲：小动作 / 严格优先级气泡（RSS > 轻简报 > 天气 > 碎碎念） ----
  useEffect(() => {
    let alive = true
    let handle: ReturnType<typeof setTimeout>

    const pickChatter = async (): Promise<{
      item: ChatterItem
      rank: IdleBubbleRank
      holdMs: number
    } | null> => {
      try {
        const s = await window.petApi.getSettings()
        const min = resolveRssPetPushMin(s)
        try {
          const store = await window.petApi.getChatStore()
          const tip = pickRssPetTip(store, min, new Set())
          if (tip) {
            return {
              item: {
                text: tip.text,
                hint: tip.hint,
                action: rssPetTipToBubbleAction(tip)
              },
              rank: tip.rank,
              holdMs: PUSH_BUBBLE_MS
            }
          }
        } catch {
          /* ignore */
        }
        if (!s.weatherCity?.trim() && !s.weatherCityPrompted) {
          window.petApi.setWeatherCityPrompted(true)
          return {
            item: {
              text: '告诉我你在哪座城市？天气才准（开 VPN 时尤其重要）',
              hint: uiText("点击去设置城市"),
              action: { kind: 'settings', section: 'settings-weather' }
            },
            rank: IDLE_RANK.weather,
            holdMs: SOFT_BUBBLE_MS
          }
        }
        try {
          const w = await window.petApi.getWeather()
          if (w) {
            return {
              item: {
                text: `📍 ${w.text}`,
                hint: w.approx ? '地点为约估，点击去设置城市' : '点击查看天气',
                action: w.approx
                  ? { kind: 'settings', section: 'settings-weather' }
                  : { kind: 'url', url: w.url }
              },
              rank: IDLE_RANK.weather,
              holdMs: SOFT_BUBBLE_MS
            }
          }
        } catch {
          /* ignore */
        }
        return {
          item: randomLocalChatter(
            s.workMemory ?? null,
            s.agentMemory?.enabled ? s.agentMemory.chatterHints : null
          ),
          rank: IDLE_RANK.chatter,
          holdMs: SOFT_BUBBLE_MS
        }
      } catch {
        return {
          item: randomLocalChatter(),
          rank: IDLE_RANK.chatter,
          holdMs: SOFT_BUBBLE_MS
        }
      }
    }

    const schedule = (): void => {
      const delay = 14000 + Math.random() * 14000 // 14~28s
      handle = setTimeout(async () => {
        if (!alive) return
        const settled =
          freeRef.current && Date.now() - idleSinceRef.current >= IDLE_SETTLE_MS
        if (settled) {
          // 待机可随机切图 / fidget；图片皮肤的「晃」已靠 CSS 关掉，只靠换图表达生命感。
          if (chatterRankRef.current >= IDLE_RANK.brief) {
            if (Math.random() < 0.35) doAction('random')
          } else if (Math.random() < 0.4) {
            doAction('random')
          } else {
            const picked = await pickChatter()
            if (alive && freeRef.current && picked) {
              presentIdleBubbleRef.current(picked.item, picked.rank, picked.holdMs)
            }
          }
        }
        schedule()
      }, delay)
    }

    schedule()
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [])

  // ---- 长时间闲置 → 睡觉 ----
  useEffect(() => {
    const id = setInterval(() => {
      if (
        Date.now() - lastActivity.current > IDLE_SLEEP_MS &&
        state.agent === 'idle' &&
        state.mood === null
      ) {
        dispatch({ t: 'mood', mood: 'sleeping' })
      }
    }, 4000)
    return () => clearInterval(id)
  }, [state.agent, state.mood])

  function runBubbleAction(action?: BubbleAction): void {
    if (!action) return
    bump()
    setChatter(null)
    chatterRankRef.current = 0
    switch (action.kind) {
      case 'chat':
        window.petApi.openChatPanel(
          action.conversationId
            ? { panel: 'chat', conversationId: action.conversationId }
            : 'chat'
        )
        break
      case 'monitor':
        window.petApi.openChatPanel('monitor')
        break
      case 'schedules':
        window.petApi.openChatPanel('schedules')
        break
      case 'settings':
        window.petApi.openChatPanel(
          action.section
            ? { panel: 'settings', section: action.section }
            : 'settings'
        )
        break
      case 'url':
        window.petApi.openExternal(action.url)
        break
      case 'app':
        window.petApi.openApp(action.name)
        break
      case 'brief':
        void (async () => {
          try {
            const [store, inbox] = await Promise.all([
              window.petApi.getChatStore(),
              window.petApi.getBriefInbox()
            ])
            const target = resolveNewsBubbleOpenTarget({
              store,
              inbox,
              briefId: action.briefId
            })
            if (action.briefId) window.petApi.markBriefRead(action.briefId)
            window.petApi.openChatPanel(target)
          } catch {
            window.petApi.openChatPanel({ panel: 'chat', section: 'new-rss' })
          }
        })()
        break
      case 'rss':
        window.petApi.openChatPanel(rssTipOpenTarget(action))
        break
    }
  }

  /** 关掉头顶状态气泡（碎碎念另管）；进行中的 agent 动画可继续，只是不挡视线。 */
  function dismissThoughtBubble(goIdle = false): void {
    const v = state.mood ?? state.agent
    if (v === 'waiting' || v === 'done' || v === 'error' || v === 'talking' || v === 'thinking' || v === 'tool') {
      dismissedBubbleKeyRef.current = `${focusConversationIdRef.current || '_'}::${v}`
    }
    setBubbleHidden(true)
    setReplySticker(null)
    setStatusNote('')
    if (stickerTimer.current) clearTimeout(stickerTimer.current)
    cancelDeferredBubbleDismiss('sticker')
    if (goIdle) {
      if (doneTimer.current) clearTimeout(doneTimer.current)
      if (errorTimer.current) clearTimeout(errorTimer.current)
      cancelDeferredBubbleDismiss('doneIdle')
      cancelDeferredBubbleDismiss('errorIdle')
      if (stateDebounceTimer.current) clearTimeout(stateDebounceTimer.current)
      stateDebounceTimer.current = null
      pendingAgentRef.current = null
      processBufRef.current = ''
      setProcessText('')
      dispatch({ t: 'agent', state: 'idle' })
    }
  }

  function thoughtBubbleAction(): BubbleAction {
    if (bubbleOrigin === 'ide' || focusConversationId?.startsWith('ide:')) {
      return { kind: 'app', name: ideApp || 'Cursor' }
    }
    return { kind: 'chat', conversationId: focusConversationId }
  }

  function thoughtBubbleHint(): string {
    if (bubbleOrigin === 'ide' || focusConversationId?.startsWith('ide:')) {
      return `点击打开 ${ideApp || 'Cursor'}`
    }
    return focusConversationId ? '点击打开对应对话' : '点击打开对话'
  }

  function onThoughtClick(): void {
    const v = state.mood ?? state.agent
    if (
      v === 'waiting' ||
      v === 'done' ||
      v === 'error' ||
      v === 'talking' ||
      v === 'thinking' ||
      v === 'tool'
    ) {
      const terminal = v === 'done' || v === 'error' || v === 'waiting'
      dismissThoughtBubble(terminal)
      runBubbleAction(thoughtBubbleAction())
    }
  }

  /** 只关气泡：进行中藏起来；终态直接回 idle。 */
  function onThoughtDismiss(): void {
    const v = state.mood ?? state.agent
    const terminal = v === 'done' || v === 'error' || v === 'waiting'
    dismissThoughtBubble(terminal)
  }

  /** 依次播放一串动作（用短暂清空强制动画重启，连续动作也能连贯）。 */
  function runActions(names: string[]): void {
    if (fidgetTimer.current) clearTimeout(fidgetTimer.current)
    if (actionTimer.current) clearTimeout(actionTimer.current)
    let i = 0
    const next = (): void => {
      if (i >= names.length) {
        setFidget(null)
        return
      }
      const name = names[i++]
      const dur = FIDGET_DUR[name] ?? 1500
      setFidget(null)
      actionTimer.current = setTimeout(() => {
        setFidget(name)
        actionTimer.current = setTimeout(next, dur + 120)
      }, 40)
    }
    next()
  }

  function triggerPetted(): void {
    dispatch({ t: 'mood', mood: 'petted' })
    // 图片皮肤：切到 petted 态图即可（view=petted）；不再叠强制 actionImg，避免表情+动效+爱心叠太满
    if (actionTimer.current) clearTimeout(actionTimer.current)
    setActionImg(null)
    setFidget(null)
    if (pettedTimer.current) clearTimeout(pettedTimer.current)
    pettedTimer.current = setTimeout(() => dispatch({ t: 'mood', mood: null }), 1600)
  }

  // ---- 鼠标交互 ----
  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 2) return // 右键交给 contextmenu
    bump()
    setChatter(null)
    setFidget(null)
    setActionImg(null)
    dragging.current = true
    moved.current = false
    longPressed.current = false
    startPos.current = { x: e.screenX, y: e.screenY }
    window.petApi.dragStart()
    longPressTimer.current = setTimeout(() => {
      if (!moved.current) {
        longPressed.current = true
        window.petApi.showContextMenu()
      }
    }, LONG_PRESS_MS)
  }

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      const dx = Math.abs(e.screenX - startPos.current.x)
      const dy = Math.abs(e.screenY - startPos.current.y)
      if (dx > 4 || dy > 4) {
        if (!moved.current) {
          moved.current = true
          dispatch({ t: 'mood', mood: 'dragged' })
          if (longPressTimer.current) clearTimeout(longPressTimer.current)
        }
        bump()
      }
    }

    const onUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      window.petApi.dragEnd()
      if (longPressTimer.current) clearTimeout(longPressTimer.current)

      if (moved.current) {
        // 拖完晃两下再恢复
        setTimeout(() => dispatch({ t: 'mood', mood: null }), 500)
        return
      }
      if (longPressed.current) return

      // 记一次点击，延迟判定单击/双击/连点
      clickCount.current += 1
      if (clickTimer.current) clearTimeout(clickTimer.current)
      clickTimer.current = setTimeout(() => {
        const n = clickCount.current
        clickCount.current = 0
        if (n === 1) {
          // 单击宠物：对话窗开着就关，关着就开（toggle）。
          // IDE 轨 id 不要带上（会解析成只唤起 Cursor）；唤起 Cursor 走气泡。
          const cid = focusConversationIdRef.current
          if (cid && !cid.startsWith('ide:')) {
            window.petApi.toggleChat({
              panel: 'chat',
              conversationId: cid,
              focusComposer: true
            })
          } else {
            window.petApi.toggleChat({ panel: 'chat', focusComposer: true })
          }
        } else {
          triggerPetted() // 双击 / 连点 = 摸头
        }
      }, CLICK_WINDOW_MS)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ---- 透明区域点击穿透：宠物本体或气泡层命中时才接管交互 ----
  useEffect(() => {
    const PAD = 6
    const hit = (el: HTMLElement | null, x: number, y: number): boolean => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD
    }
    const onMove = (e: MouseEvent): void => {
      const inside =
        dragging.current ||
        hasApprovalRef.current ||
        hit(petBodyRef.current, e.clientX, e.clientY) ||
        hit(bubbleLayerRef.current, e.clientX, e.clientY) ||
        hit(attnPanelRef.current, e.clientX, e.clientY) ||
        hit(quickChatRef.current, e.clientX, e.clientY)
      const ignore = !inside
      if (ignore !== ignoringRef.current) {
        ignoringRef.current = ignore
        window.petApi.setMouseIgnore(ignore)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // ---- 卸载时清理所有计时器，避免泄漏 ----
  useEffect(() => {
    return () => {
      for (const t of [
        chatterTimer,
        fidgetTimer,
        actionTimer,
        stickerTimer,
        doneTimer,
        errorTimer,
        pettedTimer,
        clickTimer,
        longPressTimer,
        attnCloseTimer
      ]) {
        if (t.current) clearTimeout(t.current)
      }
    }
  }, [])

  // 多任务态势板 → 角标（主进程随 presence 推送）
  useEffect(() => {
    let cancelled = false
    void window.petApi.getOpsBoard().then((snap) => {
      if (!cancelled && snap?.items) setOpsItems(snap.items)
    })
    const off = window.petApi.onOpsBoard((snap: OpsBoardSnapshot) => {
      setOpsItems(snap?.items || [])
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const view: View = state.mood ?? state.agent

  const attnOps = useMemo(
    () => opsItems.filter((it) => opsBoardNeedsAttention(it.kind)),
    [opsItems]
  )
  const badgeCount = attnOps.length
  const badgeTone: 'bad' | 'warn' | 'ok' | 'neutral' =
    attnOps.some((x) => x.kind === 'error')
      ? 'bad'
      : attnOps.some((x) => x.kind === 'waiting')
        ? 'warn'
        : attnOps.some((x) => x.kind === 'done')
          ? 'ok'
          : 'neutral'

  // 角标亮着或面板开着时强制接管交互（否则点点会被穿透吃掉）
  useEffect(() => {
    const hot = attnOpen || badgeCount > 0
    hasApprovalRef.current = hot
    if (hot) {
      ignoringRef.current = false
      window.petApi.setMouseIgnore(false)
    }
  }, [attnOpen, badgeCount])

  function onAttnBadgeClick(): void {
    if (!attnOps.length) return
    if (attnOps.length === 1 || dockEdge) {
      openAttnItem(attnOps[0])
      return
    }
    setAttnOpen((open) => !open)
  }

  function clearAttnOps(): void {
    const ids = new Set(attnOps.map((it) => it.id))
    for (const it of attnOps) {
      window.petApi.dismissOpsItem({ id: it.id, conversationId: it.conversationId })
    }
    setOpsItems((prev) => prev.filter((x) => !ids.has(x.id)))
    setAttnOpen(false)
  }

  function openAttnItem(it: OpsBoardItem): void {
    dismissAttnPanel()
    const cid = it.conversationId
    const ideApp = it.ideApp
    if (ideApp || (cid && cid.startsWith('ide:'))) {
      window.petApi.openApp(ideApp || 'Cursor')
    }
    window.petApi.openChatPanel({
      panel: it.panel || 'chat',
      conversationId: cid,
      focusComposer: it.kind === 'waiting'
    })
  }

  function dismissAttnPanel(): void {
    setAttnOpen(false)
  }

  useEffect(() => {
    if (badgeCount === 0 && attnOpen) setAttnOpen(false)
  }, [badgeCount, attnOpen])

  useEffect(() => {
    if (!attnOpen) return
    const arm = (): void => {
      if (attnCloseTimer.current) clearTimeout(attnCloseTimer.current)
      attnCloseTimer.current = setTimeout(() => {
        attnCloseTimer.current = null
        if (attnHoverRef.current) {
          arm()
          return
        }
        setAttnOpen(false)
      }, ATTN_AUTO_CLOSE_MS)
    }
    arm()
    return () => {
      if (attnCloseTimer.current) clearTimeout(attnCloseTimer.current)
    }
  }, [attnOpen])

  useEffect(() => {
    const v = state.mood ?? state.agent
    const showable =
      v === 'thinking' ||
      v === 'tool' ||
      v === 'talking' ||
      v === 'waiting' ||
      v === 'done' ||
      v === 'error' ||
      v === 'petted'
    if (!showable || bubbleHidden) return
    const key = `${focusConversationId || '_'}::${v}`
    const t = setTimeout(() => {
      autoHiddenBubbleKeyRef.current = key
      setBubbleHidden(true)
    }, THOUGHT_AUTO_HIDE_MS)
    return () => clearTimeout(t)
  }, [state.mood, state.agent, bubbleHidden, focusConversationId])

  // 首次简报就绪：空态引导去设置；有未读则引导点气泡进对话（只说一次）
  useEffect(() => {
    if (briefInbox.status === 'idle' || briefInbox.status === 'loading') return
    let cancelled = false
    void window.petApi.getSettings().then((s) => {
      if (cancelled || s.briefOnboardingPrompted) return
      window.petApi.setBriefOnboardingPrompted(true)
      if (!freeRef.current) return
      const top = topUnreadBrief(briefInbox)
      const unread = top?.source === 'rss' ? briefUnreadCount(briefInbox) : 0
      const tip =
        unread > 0 && top
          ? {
              text: `🗞 简报有 ${unread} 条可跟进 · 点我打开`,
              hint: uiText("打开对应资讯 / 简报页"),
              action: {
                kind: 'brief' as const,
                briefId: top.id
              }
            }
          : {
              text: '我能自动拉资讯了。新建「RSS 订阅」任务加点源，或去设置写兴趣词吧',
              hint: uiText("点击打开对话 · 新建 RSS"),
              action: { kind: 'settings' as const, section: 'settings-rss' }
            }
      presentIdleBubbleRef.current(tip, IDLE_RANK.brief, PUSH_BUBBLE_MS)
    })
    return () => {
      cancelled = true
    }
    // briefInbox 字段已在依赖里拆开；整对象入依赖会无意义重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefInbox.status, briefInbox.updatedAt, briefInbox.items.length, state.agent, state.mood])

  async function openQuickChat(): Promise<void> {
    try {
      const res = await window.petApi.quickChatArm()
      if (!res.ok || !res.conversationId) {
        if (res.error === '快速对话已关闭') {
          setQuickAutoListen(false)
          const cid = focusConversationIdRef.current
          if (cid) window.petApi.toggleChat({ panel: 'chat', conversationId: cid })
          else window.petApi.toggleChat()
          return
        }
        setQuickAutoListen(false)
        setQuickStatus(res.error || '打不开')
        return
      }
      quickTrackCid.current = res.conversationId
      quickReplyBuf.current = ''
      quickReplyShownLen.current = 0
      clearQuickReplyFlush()
      if (res.surface === 'panel') {
        setQuickSession(null)
        setQuickVisible(false)
        setQuickAutoListen(false)
        return
      }
      setQuickSession({
        conversationId: res.conversationId,
        title: res.title || '对话',
        draft: res.pendingText || ''
      })
      setQuickVisible(true)
      setQuickStatus(undefined)
    } catch (err) {
      setQuickAutoListen(false)
      setQuickStatus(err instanceof Error ? err.message : '快速对话失败')
    }
  }
  openQuickChatRef.current = () => {
    void openQuickChat()
  }

  async function sendQuickChatText(
    text: string,
    attachments: Array<{ path: string; name: string; mime?: string; size?: number }> = []
  ): Promise<void> {
    if (!quickSession) return
    clearQuickHistoryTimer()
    const prompt = text.trim()
    setQuickAsk(prompt || (attachments.length ? '请查看附件' : ''))
    setQuickAskAttachments(attachments.map((a) => ({ name: a.name })))
    setQuickReply('') // 立刻清掉上一轮，避免「回答中」还挂着旧答案
    quickStreamLive.current = true
    setQuickBusy(true)
    setQuickStatus(undefined)
    setQuickVisible(true)
    quickTrackCid.current = quickSession.conversationId
    quickReplyBuf.current = ''
    quickReplyShownLen.current = 0
    clearQuickReplyFlush()
    cancelQuickTts()
    stopTtsPlayback()
    await refreshQuickTtsPrefs(quickSession.conversationId)
    try {
      const res = await window.petApi.quickChatSend({
        conversationId: quickSession.conversationId,
        text: prompt,
        attachments: attachments.map(({ path, name, mime, size }) => ({ path, name, mime, size }))
      })
      if (!res.ok) {
        settleQuickStream({ status: res.error || '发送失败', tts: 'cancel' })
        return
      }
      // 目标任务没了时主进程会新建对话；宠边要跟上新 id，否则流式对不上
      if (res.conversationId && res.conversationId !== quickSession.conversationId) {
        quickTrackCid.current = res.conversationId
        setQuickSession({
          conversationId: res.conversationId,
          title: res.title || '对话'
        })
        await refreshQuickTtsPrefs(res.conversationId)
      }
    } catch (err) {
      settleQuickStream({
        status: err instanceof Error ? err.message : '发送失败',
        tts: 'cancel'
      })
    }
  }

  function closeQuickSurface(): void {
    setQuickVisible(false)
    setQuickAutoListen(false)
    // 保留 session / reply，TTL 内可再点开看；超时由 scheduleQuickHistoryClear 清掉
  }
  closeQuickSurfaceRef.current = closeQuickSurface

  function stopQuickChat(): void {
    const cid = quickSession?.conversationId || quickTrackCid.current
    if (!cid) return
    void window.petApi.cancel(cid)
    settleQuickStream({ status: '已暂停', tts: 'cancel' })
  }

  /** 打开快问气泡；关掉后的回答可再点重开。 */
  async function openQuickChatFromMic(): Promise<void> {
    if (quickSession && !quickVisible && (quickReply.trim() || quickBusy || quickAsk.trim())) {
      setQuickVisible(true)
      return
    }
    setQuickAutoListen(false)
    await openQuickChat()
  }
  openQuickChatFromMicRef.current = () => {
    void openQuickChatFromMic()
  }

  return (
    <div className={`pet-root${dockEdge ? ` docked-${dockEdge}` : ''}`}>
      {/* 舞台贴窗底：气泡绝对叠在头顶，出现/消失不顶开本体 */}
      <div className="pet-stage">
        {quickVisible && quickSession ? (
          // 快速对话表面占用头顶槽，暂不叠碎碎念
          <div className="bubble-layer" ref={bubbleLayerRef} />
        ) : (
          <div
            className="bubble-layer"
            ref={bubbleLayerRef}
            onMouseEnter={() => setBubbleHover(true)}
            onMouseLeave={() => setBubbleHover(false)}
          >
            {!bubbleHidden && replySticker && (view === 'done' || view === 'error') ? (
              <div
                className="sticker-bubble clickable"
                title={thoughtBubbleHint()}
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onThoughtClick()
                }}
              >
                <button
                  type="button"
                  className="bubble-dismiss"
                  aria-label={uiText("关闭气泡")}
                  title={uiText("关闭")}
                  onClick={(e) => {
                    e.stopPropagation()
                    onThoughtDismiss()
                  }}
                >
                  <span aria-hidden>×</span>
                </button>
                {replySticker.image ? (
                  <img className="sticker-bubble-img" src={replySticker.image} alt="" draggable={false} />
                ) : (
                  <span className="sticker-bubble-emoji">{replySticker.emoji}</span>
                )}
                <span className="bubble-hint">{thoughtBubbleHint()}</span>
              </div>
            ) : !bubbleHidden ? (
              <ThoughtBubble
                view={view}
                toolLabel={state.toolLabel}
                note={statusNote}
                processText={processText}
                showProcess={showProcess}
                hint={thoughtBubbleHint()}
                onClick={onThoughtClick}
                onDismiss={onThoughtDismiss}
              />
            ) : null}
            {chatter && !state.mood && state.agent === 'idle' && !replySticker && (
              <div
                className={`chatter${chatter.action ? ' clickable' : ''}`}
                role={chatter.action ? 'button' : undefined}
                title={chatter.hint || (chatter.action ? uiText("点击打开") : undefined)}
                onClick={(e) => {
                  if (!chatter.action) return
                  e.stopPropagation()
                  runBubbleAction(chatter.action)
                }}
              >
                {chatter.text}
                {chatter.action && chatter.hint ? (
                  <span className="bubble-hint">{chatter.hint}</span>
                ) : null}
              </div>
            )}
          </div>
        )}
        {/* FAB 贴身体侧；展开表面浮在头顶（窗口已垫高） */}
        <div
          ref={quickChatRef}
          className={`quick-chat-hit${quickVisible && quickSession ? ' is-open' : ''}`}
          onMouseEnter={() => {
            if (quickVisible && quickSession) setBubbleHover(true)
          }}
          onMouseLeave={() => {
            if (quickVisible && quickSession) setBubbleHover(false)
          }}
        >
          {quickVisible && quickSession ? (
            <QuickChatStrip
              session={quickSession}
              autoSend={quickAutoSend}
              autoListen={quickAutoListen}
              busy={quickBusy}
              status={quickStatus}
              ask={quickAsk}
              askAttachments={quickAskAttachments}
              reply={quickReply}
              onClose={closeQuickSurface}
              onSend={(t, atts) => void sendQuickChatText(t, atts)}
              onStop={stopQuickChat}
              onOpenFull={() => {
                const cid = quickSession.conversationId
                closeQuickSurface()
                window.petApi.openChatPanel({ panel: 'chat', conversationId: cid })
              }}
              onAutoListenDone={() => setQuickAutoListen(false)}
            />
          ) : (
            <>
              {badgeCount > 0 && !quickVisible ? (
                <button
                  type="button"
                  className={`pet-attn-badge tone-${badgeTone}${attnOpen ? ' on' : ''}`}
                  title={uiText("{0} 条待处理（等你 / 完成 / 出错）", [attnOps.length])}
                  aria-label={uiText("待处理 {0} 项", [badgeCount])}
                  aria-expanded={attnOpen}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAttnBadgeClick()
                  }}
                >
                  {badgeCount > 9 ? '9+' : badgeCount}
                </button>
              ) : null}
              <button
                type="button"
                className="quick-chat-fab"
                title={
                  quickSession && (quickReply.trim() || quickBusy)
                    ? uiText("打开上次回答")
                    : uiText("快速对话（语音/文字）")
                }
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void openQuickChatFromMic()
                }}
              >
                {quickSession && quickReply.trim() && !quickVisible ? uiText("答") : uiText("麦")}
              </button>
            </>
          )}
        </div>
        {attnOpen && badgeCount > 0 ? (
          <div
            className="pet-attn-panel"
            ref={attnPanelRef}
            role="dialog"
            aria-label={uiText("待处理任务")}
            onMouseEnter={() => {
              attnHoverRef.current = true
            }}
            onMouseLeave={() => {
              attnHoverRef.current = false
            }}
          >
            <div className="pet-attn-head">
              <span>{uiText("待处理 ·")}{' '}{badgeCount}</span>
              <div className="pet-attn-head-acts">
                {attnOps.length > 0 ? (
                  <button
                    type="button"
                    className="pet-attn-clear"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearAttnOps()
                    }}
                  >
                    {uiText("清空")}</button>
                ) : null}
                <button
                  type="button"
                  className="pet-attn-close"
                  aria-label={uiText("关闭")}
                  onClick={(e) => {
                    e.stopPropagation()
                    dismissAttnPanel()
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            {attnOps.length > 0 ? (
              <div className="pet-attn-list">
                {attnOps.slice(0, 8).map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className={`pet-attn-row kind-${it.kind}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      openAttnItem(it)
                    }}
                  >
                    <span className="pet-attn-kind">{opsBoardKindLabel(it.kind)}</span>
                    <span className="pet-attn-body">
                      <span className="pet-attn-title">{it.title}</span>
                      {it.detail ? <span className="pet-attn-detail">{it.detail}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="pet-attn-more"
              onClick={(e) => {
                e.stopPropagation()
                dismissAttnPanel()
                window.petApi.openChatPanel({ panel: 'today' })
              }}
            >
              {uiText("打开工作台")}</button>
          </div>
        ) : null}
        <div
          ref={petBodyRef}
          className={`pet-body mood-${view}${imageSkin ? ' has-image-skin' : ''}${fidget ? ' act-' + fidget : ''}`}
          onMouseDown={onMouseDown}
          onMouseEnter={() => {
            bump()
            if (state.mood === 'sleeping') dispatch({ t: 'mood', mood: null })
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            window.petApi.setMouseIgnore(false)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const files = Array.from(e.dataTransfer.files || [])
            if (!files.length) return
            void (async () => {
              // Electron 32+ 无 File.path，经 webUtils 取路径后再 ingest
              const list = await attachmentsFromDroppedFiles(files)
              if (!list.length) return
              await window.petApi.ingestChatAttachments(list)
            })()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            window.petApi.showContextMenu()
          }}
          title={uiText("单击打开对话 · 双击摸头 · 可拖入文件/文件夹作附件 · 麦按钮快速对话 · 拖到边缘半隐藏 · 右键菜单")}
        >
          {imageSkin ? (
            (() => {
              const src =
                actionImg ??
                (dockEdge
                  ? (imageSkin.images[`docked-${dockEdge}`] ??
                    imageSkin.images.docked ??
                    imageSkin.images[view] ??
                    imageSkin.images.idle)
                  : (imageSkin.images[view] ?? imageSkin.images.idle))
              const calm =
                !actionImg &&
                !fidget &&
                (view === 'idle' || view === 'waiting' || view === 'sleeping')
              if (!calm || !src) {
                return <img className="mascot mascot-img" src={src} alt="" draggable={false} />
              }
              // GIF 三层会帧不同步；静态图才走真·头胸腰分层（三国志13）
              const layered =
                !/^data:image\/gif/i.test(src) && !/\.gif(?:$|\?)/i.test(src)
              if (!layered) {
                return (
                  <img
                    className={`mascot mascot-img portrait-gif-breathe${view === 'sleeping' ? ' is-sleep' : ''}`}
                    src={src}
                    alt=""
                    draggable={false}
                  />
                )
              }
              return (
                <div
                  className={`portrait-breathe${view === 'sleeping' ? ' is-sleep' : ''}`}
                  aria-hidden
                >
                  <img className="mascot mascot-img layer-waist" src={src} alt="" draggable={false} />
                  <img className="mascot mascot-img layer-chest" src={src} alt="" draggable={false} />
                  <img className="mascot mascot-img layer-head" src={src} alt="" draggable={false} />
                </div>
              )
            })()
          ) : (
            <Mascot view={view} skin={skin} />
          )}
          {!imageSkin && view === 'tool' && (
            <div className="working">
              <span className="desk" />
              <span
                className="paw paw-l"
                style={{ background: SKIN_PALETTES[skin].c2 } as CSSProperties}
              />
              <span
                className="paw paw-r"
                style={{ background: SKIN_PALETTES[skin].c2 } as CSSProperties}
              />
              <span className="effort-sweat">💦</span>
            </div>
          )}
          {view === 'sleeping' && (
            <div className="zzz">
              <span>z</span>
              <span>Z</span>
              <span>z</span>
            </div>
          )}
          {view === 'petted' && (
            <div className="hearts">
              <span>♥</span>
              <span>♥</span>
              <span>♥</span>
            </div>
          )}
        </div>
        <div className={`pet-shadow ${view === 'dragged' ? 'lift' : ''}`} />
      </div>
    </div>
  )
}
