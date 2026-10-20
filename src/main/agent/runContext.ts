/**
 * 单次 Agent 运行的发事件上下文。
 * Runner 只负责解析原始流，一律经此对象发出规范化 AgentEvent。
 */

import type { AgentEvent, AgentRunUsage, PetState } from '../../shared/types'
import { resolveTextPiece, type TextMode } from './normalize'
import { extractRunUsage, mergeRunUsage } from './usage'

export type Emit = (event: AgentEvent) => void

export interface RunIdentity {
  conversationId: string
  modelId?: string
  laneId?: string
  runKey: string
}

/** 控制面事件处理结果。 */
export type ControlAction = 'settle' | 'handled' | null

/** 正文已齐后的宽限：CLI 若迟迟不 result/close，到点强制收尾，避免空转数分钟。 */
const SEAL_GRACE_MS = 1_200

function pickNonEmpty(s?: string | null): string | undefined {
  const t = typeof s === 'string' ? s.trim() : ''
  return t || undefined
}

export class RunContext {
  readonly conversationId: string
  readonly modelId?: string
  readonly laneId?: string
  readonly runKey: string
  readonly startedAt = Date.now()

  aborting = false
  settled = false
  sawAssistant = false
  /**
   * 正文已齐 / CLI 即将重放时封口。
   * 封口后忽略 thinking/assistant，直到 tool/command 开新一轮。
   */
  contentSealed = false
  lastText = ''
  lastReasoning = ''
  lastPetState?: PetState
  sessionId?: string
  usage: AgentRunUsage = {}

  private readonly emitRaw: Emit
  /** Runner 注册：宽限到点时杀子进程并 drop（比单纯 done 更干净）。 */
  private settleHook: (() => void) | null = null
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  /** 进行中的 tool/command：沙箱跑脚本时可能数分钟无正文，不能当「已完成」。 */
  private readonly activeWorkIds = new Set<string>()

  constructor(identity: RunIdentity, emitRaw: Emit) {
    this.conversationId = identity.conversationId
    this.modelId = identity.modelId
    this.laneId = identity.laneId
    this.runKey = identity.runKey
    this.emitRaw = emitRaw
  }

  setSettleHook(hook: (() => void) | null): void {
    this.settleHook = hook
  }

  /** 已有任何可见输出（正文或思考）——用于重连收尾，避免「只有思考」时干等。 */
  get hasOutput(): boolean {
    return (
      this.sawAssistant ||
      this.lastText.trim().length > 0 ||
      this.lastReasoning.trim().length > 0
    )
  }

  /** 仍有工具/命令在跑（含沙箱长任务）。 */
  get hasActiveWork(): boolean {
    return this.activeWorkIds.size > 0
  }

  sealContent(): void {
    this.contentSealed = true
    this.armGraceSettle()
  }

  unsealContent(): void {
    this.contentSealed = false
    this.clearGraceSettle()
  }

  private clearGraceSettle(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
  }

  private armGraceSettle(): void {
    this.clearGraceSettle()
    if (!this.hasOutput || this.settled || this.aborting || this.hasActiveWork) return
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null
      if (
        this.settled ||
        this.aborting ||
        !this.contentSealed ||
        !this.hasOutput ||
        this.hasActiveWork
      ) {
        return
      }
      if (this.settleHook) this.settleHook()
      else this.done()
    }, SEAL_GRACE_MS)
  }

  private markWork(
    kind: 'tool' | 'command',
    id: string | undefined,
    status: string,
    hint?: string
  ): void {
    const key =
      id && id.trim()
        ? `${kind}:${id.trim()}`
        : `${kind}:${(hint || 'current').slice(0, 80)}`
    if (status === 'running') this.activeWorkIds.add(key)
    else this.activeWorkIds.delete(key)
  }

  noteUsage(patch?: AgentRunUsage): void {
    if (!patch) return
    this.usage = mergeRunUsage(this.usage, patch)
  }

  /** 结束时带上耗时（及已收集的 token）。 */
  private finalUsage(): AgentRunUsage {
    return mergeRunUsage(
      { durationMs: Math.max(0, Date.now() - this.startedAt) },
      this.usage
    )
  }

  /**
   * 共用控制面：usage / 断线重连 / retry。
   * - settle：已有正文，立刻 done（勿等 CLI 空转重连数分钟）
   * - handled：已处理，调用方勿再当内容解析
   * - null：不是控制事件
   */
  consumeControlEvent(obj: unknown): ControlAction {
    if (!obj || typeof obj !== 'object') return null
    const rec = obj as Record<string, unknown>
    const type = String(rec.type ?? rec.event ?? '')
    const subtype = String(rec.subtype ?? '')

    if (
      type === 'usage' ||
      type === 'token_usage' ||
      type === 'tokens' ||
      type === 'metering'
    ) {
      this.noteUsage(extractRunUsage(rec))
      return 'handled'
    }

    // 只认 reconnecting，不认 reconnected（后者会误伤）
    const reconnecting =
      type === 'reconnecting' || (type === 'connection' && subtype === 'reconnecting')

    if (reconnecting) {
      // 工具还在跑（沙箱脚本等）时绝不能当完成
      if (this.hasOutput && !this.hasActiveWork && !this.settled && !this.aborting) {
        this.sealContent()
        return 'settle'
      }
      return 'handled'
    }

    // 只认 type===retry（含 subtype starting/resuming）
    if (type === 'retry') {
      if (this.hasOutput && !this.hasActiveWork && !this.settled && !this.aborting) {
        this.sealContent()
        return 'settle'
      }
      return 'handled'
    }

    return null
  }

  /** 带上 conversation / model / lane 标签。 */
  emit(event: AgentEvent): void {
    // 终态可以在 settled=true 之后发出（done/error 先置 settled 再 emit）
    const terminal =
      event.type === 'done' || event.type === 'error' || event.type === 'aborted'
    if (this.settled && !terminal) return
    this.emitRaw({
      ...event,
      conversationId: this.conversationId,
      ...(this.modelId ? { modelId: this.modelId } : {}),
      ...(this.laneId ? { laneId: this.laneId } : {})
    })
  }

  notice(text: string): void {
    const t = text.trim()
    if (!t || this.settled || this.aborting) return
    this.emit({ type: 'notice', text: t })
  }

  state(state: PetState): void {
    if (this.lastPetState === state) return
    this.lastPetState = state
    this.emit({ type: 'state', state })
  }

  session(sessionId: string): void {
    this.sessionId = sessionId
    this.emit({ type: 'session', sessionId })
  }

  /** 正文：delta / snapshot / replace；重复完整快照会封口。 */
  assistant(text: string, mode: TextMode = 'delta'): boolean {
    if (this.settled || this.aborting || this.contentSealed) return false
    const piece = resolveTextPiece(this.lastText, text, mode)
    if (!piece) {
      if (text && text === this.lastText) this.sealContent()
      return false
    }
    this.lastText = piece.accumulated
    this.sawAssistant = true
    this.state('talking')
    this.emit({ type: 'assistant-delta', text: piece.delta })
    return true
  }

  /**
   * 终局正文（result 事件）：即使已 contentSealed 也要尽量补进 UI。
   * 换机/重连后常见：流式片被封口丢掉，但 result 里仍有完整回答 + token。
   */
  ensureFinalText(text: string): boolean {
    if (this.aborting || this.settled) return false
    const finalText = text.trimEnd()
    if (!finalText) return this.sawAssistant
    this.unsealContent()
    if (finalText === this.lastText) {
      this.sealContent()
      return this.sawAssistant
    }
    if (!this.lastText) {
      const ok = this.assistant(finalText, 'replace')
      this.sealContent()
      return ok
    }
    if (finalText.startsWith(this.lastText) || finalText.includes(this.lastText)) {
      const ok = this.assistant(finalText, 'snapshot')
      this.sealContent()
      return ok || this.sawAssistant
    }
    // 流式碎片与终局不一致：几乎没发出去，或终局明显更完整 → 整段覆盖
    const streamShort = !this.sawAssistant || this.lastText.length < 8
    const finalMuchLonger =
      finalText.length >= Math.max(this.lastText.length + 80, Math.floor(this.lastText.length * 1.5))
    if (streamShort || finalMuchLonger) {
      this.lastText = ''
      this.sawAssistant = false
      const ok = this.assistant(finalText, 'replace')
      this.sealContent()
      return ok
    }
    this.sealContent()
    return this.sawAssistant
  }

  reasoning(text: string): boolean {
    if (this.settled || this.aborting || this.contentSealed || !text) return false
    const piece = resolveTextPiece(this.lastReasoning, text, 'delta')
    if (!piece) return false
    this.lastReasoning = piece.accumulated
    this.state('thinking')
    this.emit({ type: 'reasoning-delta', text: piece.delta })
    return true
  }

  /**
   * 取消时务必通知 UI 解锁。
   * 若此前已 done 但渲染进程漏了终态，仍补发 aborted。
   */
  forceAbort(): void {
    this.clearGraceSettle()
    this.aborting = true
    this.contentSealed = true
    this.settled = true
    // settled 后仍允许发 aborted（见 emit）
    this.emit({ type: 'aborted', usage: this.finalUsage() })
  }

  tool(payload: {
    id?: string
    name: string
    input?: string
    output?: string
    status: 'running' | 'done' | 'error'
  }): void {
    if (this.settled || this.aborting) return
    this.markWork('tool', payload.id, payload.status, payload.name)
    if (payload.status === 'running') {
      this.unsealContent()
      this.state('tool')
    }
    this.emit({ type: 'tool', ...payload })
  }

  command(payload: {
    id?: string
    command: string
    output?: string
    exitCode?: number
    status: 'running' | 'done' | 'error'
  }): void {
    if (this.settled || this.aborting) return
    this.markWork('command', payload.id, payload.status, payload.command)
    if (payload.status === 'running') {
      this.unsealContent()
      this.state('tool')
    }
    this.emit({ type: 'command', ...payload })
  }

  done(result?: string): void {
    if (this.settled || this.aborting) return
    this.settled = true
    this.clearGraceSettle()
    this.contentSealed = true
    // 许多 settle 路径只调 done() 不传参；流式片若没进 UI，靠 result 兜底回填
    const final =
      pickNonEmpty(result) ||
      pickNonEmpty(this.lastText) ||
      pickNonEmpty(this.lastReasoning) ||
      undefined
    this.emit({ type: 'done', ...(final ? { result: final } : {}), usage: this.finalUsage() })
  }

  error(message: string): void {
    if (this.settled || this.aborting) return
    this.settled = true
    this.clearGraceSettle()
    this.contentSealed = true
    this.emit({ type: 'error', message, usage: this.finalUsage() })
  }

  aborted(): void {
    this.forceAbort()
  }
}
