import type {
  AgentEvent,
  ChatMessage,
  ChatStore,
  Conversation,
  ScheduleRunPayload,
  ScheduledTask,
  SendPromptPayload
} from '../shared/types'
import {
  getChatStore,
  getSchedules,
  getSettings,
  removeSchedulesForConversation,
  saveChatStore,
  saveSchedules,
  upsertSchedule
} from './store'
import { isSafeAgentCwd } from '../shared/cwd'
import { isAgentModelRef } from '../shared/models'
import { parseLeadingSkillIds } from '../shared/skills'
import {
  makeScheduleDigest,
  SCHEDULE_AUTO_DISABLE_FAILURES
} from '../shared/scheduleDigest'
import {
  isRssDigestSchedule,
  normalizeScheduledTask,
  resolveScheduleRssDigestBounds,
  validateScheduledTask
} from '../shared/scheduledTask'
import {
  normalizeRssDigestScoreMin,
  newRssDigestId,
  normalizeRssDigestTemplate,
  prependRssDigest,
  rssDigestThreadId
} from '../shared/rssTask'
import { runRssDispositionPipeline } from './rssDisposition'
import { listAgentSkills } from './skills'
import { homedir } from 'node:os'
import {
  clampTimerDelay,
  computeNextRun,
  HEARTBEAT_INTERVAL_MS,
  planTimerFire,
  selectDueTaskIds,
  shouldStayEnabled
} from './scheduleTime'
import { ensureTaskThreads } from '../shared/conversationThreads'

type Emit = (event: AgentEvent) => void

/** 定时跑完后的通知载荷（由主进程弹系统通知并深链）。 */
export interface ScheduleFinishedInfo {
  taskId: string
  taskName: string
  conversationId?: string
  ok: boolean
  detail?: string
  autoDisabled?: boolean
  /** rss-digest 完成后带最新 store，供渲染侧合并。 */
  store?: ChatStore
}

/** 定时任务可调用的 agent 入口（Cursor / OpenClaw 共用）。 */
export interface PromptRunner {
  readonly isBusy: boolean
  isBusyFor(conversationId: string): boolean
  run(payload: SendPromptPayload, emit: Emit): Promise<void>
  cancel(conversationId?: string): void
}

function uid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function newConversation(cwd?: string): Conversation {
  const now = Date.now()
  return ensureTaskThreads({
    id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    title: '新对话',
    messages: [],
    kind: 'chat',
    cwd,
    createdAt: now,
    updatedAt: now
  })
}

function ensureStore(): ChatStore {
  const existing = getChatStore()
  if (existing?.conversations?.length) return existing
  const c = newConversation(getSettings().cwd)
  const store: ChatStore = { conversations: [c], activeId: c.id }
  saveChatStore(store)
  return store
}

/**
 * 定时任务的技能来源：显式字段优先，否则退回解析 prompt 开头的 `/技能名`。
 * prompt 本身不改动 —— Cursor 靠这个字面前缀触发服务端展开，其余引擎的注入链路里
 * 由 stripSkillPrefix 自行决定要不要剥。
 */
function resolveTaskSkills(task: ScheduledTask, cwd?: string): string[] | undefined {
  const explicit = [...new Set((task.skills || []).map((s) => s.trim()).filter(Boolean))]
  if (explicit.length) return explicit
  // 开头不是斜杠词就没必要为此扫一遍技能目录
  if (!/^\s*\//.test(task.prompt || '')) return undefined
  const ids = parseLeadingSkillIds(
    task.prompt,
    listAgentSkills(cwd).map((s) => s.id)
  )
  return ids.length ? ids : undefined
}

function prepareRun(task: ScheduledTask): {
  store: ChatStore
  conversationId: string
  userMsgId: string
  assistantMsgId: string
  payload: SendPromptPayload
} {
  let store = ensureStore()
  const settings = getSettings()
  const now = Date.now()

  let conv = task.conversationId
    ? store.conversations.find((c) => c.id === task.conversationId)
    : undefined

  if (!conv) {
    conv = {
      ...newConversation(task.cwd ?? settings.cwd),
      title: task.name || '定时任务',
      cwd: task.cwd ?? settings.cwd,
      modelRef: task.modelRef || settings.defaultModelRef
    }
    store = {
      ...store,
      conversations: [...store.conversations, conv],
      activeId: conv.id
    }
    task.conversationId = conv.id
  } else if (task.modelRef && conv.modelRef !== task.modelRef) {
    conv = { ...conv, modelRef: task.modelRef }
    store = {
      ...store,
      conversations: store.conversations.map((c) => (c.id === conv!.id ? conv! : c))
    }
  }

  const threaded = ensureTaskThreads(conv)
  if (threaded !== conv) {
    conv = threaded
    store = {
      ...store,
      conversations: store.conversations.map((c) => (c.id === conv!.id ? conv! : c))
    }
  }

  const model = task.modelRef || conv.modelRef || settings.defaultModelRef || 'cursor:auto'
  const home = homedir()
  const rawCwd = task.cwd || conv.cwd || settings.cwd
  const cwd = isSafeAgentCwd(rawCwd, home) ? rawCwd : undefined
  if (isAgentModelRef(settings.modelProviders, model) && !cwd) {
    throw new Error(
      `定时任务「${task.name}」未配置安全工作目录（不能使用主目录）。请在任务或对话里选择项目目录。`
    )
  }

  const userMsg: ChatMessage = {
    id: uid('u'),
    role: 'user',
    blocks: [{ kind: 'text', text: `⏰ ${task.name}\n${task.prompt}` }],
    createdAt: now
  }
  const assistantMsg: ChatMessage = {
    id: uid('a'),
    role: 'assistant',
    blocks: [],
    createdAt: now
  }

  const updatedConv: Conversation = {
    ...conv,
    modelRef: model,
    messages: [...conv.messages, userMsg, assistantMsg],
    updatedAt: now
  }
  store = {
    ...store,
    conversations: store.conversations.map((c) => (c.id === conv!.id ? updatedConv : c)),
    activeId: conv.id
  }
  saveChatStore(store)

  const history: NonNullable<SendPromptPayload['history']> = []
  for (const m of conv.messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const text = m.blocks
      .filter((b): b is Extract<ChatMessage['blocks'][number], { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!text) continue
    history.push({ role: m.role, content: text })
  }

  return {
    store,
    conversationId: conv.id,
    userMsgId: userMsg.id,
    assistantMsgId: assistantMsg.id,
    payload: {
      prompt: task.prompt,
      conversationId: conv.id,
      threadId: conv.activeThreadId,
      sessionId: conv.sessionId,
      cwd,
      model,
      skills: resolveTaskSkills(task, cwd),
      systemPrompt: conv.systemPrompt,
      // 定时任务默认代理权限，才能实际改文件；任务里若写了 ask/plan 则尊重
      agentAutonomy: conv.agentAutonomy ?? 'agent',
      history: history.slice(-40)
    }
  }
}

export class TaskScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  private queue: string[] = []
  private draining = false
  private heartbeat: NodeJS.Timeout | null = null
  private running = new Set<string>()

  constructor(
    private runner: PromptRunner,
    private emit: Emit,
    private onChanged: (tasks: ScheduledTask[]) => void,
    private onRunStarted: (payload: ScheduleRunPayload) => void,
    private onRunFinished: (info: ScheduleFinishedInfo) => void = () => {}
  ) {}

  start(): void {
    this.stop()
    const now = Date.now()
    for (const task of getSchedules()) {
      if (!task.enabled) continue
      if (task.kind === 'once' && (!task.runAt || task.runAt <= now)) {
        if (!task.lastRunAt) this.disableTask(task.id)
        continue
      }
      let next = task.nextRunAt
      if (!next) {
        const computed = computeNextRun(task, now)
        if (!computed) continue
        next = computed
        upsertSchedule({ ...task, nextRunAt: next, updatedAt: now })
      }
      const delay = next <= now ? 1000 : next - now
      this.arm(task.id, delay)
    }
    this.heartbeat = setInterval(() => void this.sweepDue(), HEARTBEAT_INTERVAL_MS)
    this.broadcast()
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  /**
   * 按墙钟核查一遍有没有该跑却没跑的任务。
   * 由心跳周期调用，也在系统唤醒（powerMonitor 的 resume）时立刻调用一次，不必等下一次心跳。
   */
  async sweepDue(): Promise<void> {
    for (const id of selectDueTaskIds(getSchedules(), Date.now())) {
      await this.onDue(id)
    }
  }

  reload(): void {
    this.start()
  }

  list(): ScheduledTask[] {
    return getSchedules()
  }

  save(task: ScheduledTask): ScheduledTask {
    const normalized = normalizeScheduledTask(task)
    if (!normalized) throw new Error('无效的定时任务')
    const err = validateScheduledTask(normalized)
    if (err) throw new Error(err)
    if (isRssDigestSchedule(normalized)) {
      normalized.conversationId = normalized.rssConversationId
    }
    const now = Date.now()
    const next = normalized.enabled ? computeNextRun(normalized, now) : null
    const saved = upsertSchedule({
      ...normalized,
      enabled: shouldStayEnabled(normalized.kind, normalized.enabled, next),
      nextRunAt: next ?? undefined,
      updatedAt: now,
      createdAt: normalized.createdAt || now
    })
    this.rescheduleOne(saved)
    this.broadcast()
    return saved
  }

  remove(id: string): void {
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
    saveSchedules(getSchedules().filter((x) => x.id !== id))
    this.queue = this.queue.filter((x) => x !== id)
    this.broadcast()
  }

  /** 删除绑定到某对话（含 RSS）的全部定时任务；返回删除条数。 */
  removeForConversation(conversationId: string): number {
    const id = conversationId.trim()
    if (!id) return 0
    const doomed = getSchedules().filter(
      (t) =>
        t.rssConversationId === id ||
        (isRssDigestSchedule(t) && t.conversationId === id)
    )
    for (const t of doomed) {
      const timer = this.timers.get(t.id)
      if (timer) clearTimeout(timer)
      this.timers.delete(t.id)
      this.queue = this.queue.filter((x) => x !== t.id)
    }
    const n = removeSchedulesForConversation(id)
    if (n > 0) this.broadcast()
    return n
  }

  toggle(id: string, enabled: boolean): ScheduledTask | null {
    const task = getSchedules().find((t) => t.id === id)
    if (!task) return null
    const now = Date.now()
    const next = enabled ? computeNextRun({ ...task, enabled }, now) : null
    const saved = upsertSchedule({
      ...task,
      enabled: shouldStayEnabled(task.kind, enabled, next),
      nextRunAt: next ?? undefined,
      updatedAt: now
    })
    this.rescheduleOne(saved)
    this.broadcast()
    return saved
  }

  async runNow(id: string): Promise<{ ok: boolean; error?: string }> {
    const task = getSchedules().find((t) => t.id === id)
    if (!task) return { ok: false, error: '任务不存在' }
    if (task.conversationId && this.runner.isBusyFor(task.conversationId)) {
      return { ok: false, error: '该任务绑定的对话正在运行中' }
    }
    await this.execute(task)
    return { ok: true }
  }

  private broadcast(): void {
    this.onChanged(getSchedules())
  }

  private disableTask(id: string): void {
    const task = getSchedules().find((t) => t.id === id)
    if (!task) return
    upsertSchedule({ ...task, enabled: false, nextRunAt: undefined, updatedAt: Date.now() })
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
  }

  private rescheduleOne(task: ScheduledTask): void {
    const old = this.timers.get(task.id)
    if (old) clearTimeout(old)
    this.timers.delete(task.id)
    if (!task.enabled || !task.nextRunAt) return
    const delay = Math.max(0, task.nextRunAt - Date.now())
    this.arm(task.id, delay)
  }

  private arm(id: string, delay: number): void {
    // 必须先清旧的：execute()/runNow() 会在已有定时器待触发时重新 arm，
    // 只覆盖 Map 会留下一个脱管的定时器，到点又跑一遍同一个任务。
    const old = this.timers.get(id)
    if (old) clearTimeout(old)
    const timer = setTimeout(() => {
      this.timers.delete(id)
      void this.onDue(id)
    }, clampTimerDelay(delay))
    this.timers.set(id, timer)
  }

  private async onDue(id: string): Promise<void> {
    // 心跳、setTimeout、队列 drain 三条路径可能同时指向同一个任务。执行期间 nextRunAt 还没推进，
    // 此时任何二次触发都会看到「仍已到点」；尤其不能让它落进 queue，否则本次跑完 drain 立刻再跑一遍。
    if (this.running.has(id)) return
    const task = getSchedules().find((t) => t.id === id)
    if (!task?.enabled) return
    const plan = planTimerFire(task.nextRunAt, Date.now())
    if (!plan.fire) {
      this.arm(id, plan.delay)
      return
    }
    if (task.conversationId && this.runner.isBusyFor(task.conversationId)) {
      if (!this.queue.includes(id)) this.queue.push(id)
      this.arm(id, 15_000)
      return
    }
    // 之前忙时排过队的话要摘掉，否则 drainQueue 立刻又执行一次
    this.queue = this.queue.filter((x) => x !== id)
    await this.execute(task)
    void this.drainQueue()
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        const task = getSchedules().find((t) => t.id === id)
        if (!task?.enabled) continue
        if (task.conversationId && this.runner.isBusyFor(task.conversationId)) {
          this.queue.push(id)
          break
        }
        await this.execute(task)
      }
    } finally {
      this.draining = false
    }
  }

  private async execute(rawTask: ScheduledTask): Promise<void> {
    if (this.running.has(rawTask.id)) return
    this.running.add(rawTask.id)
    try {
      await this.runTask(rawTask)
    } finally {
      this.running.delete(rawTask.id)
    }
  }

  private finishRun(
    task: ScheduledTask,
    opts: {
      ok: boolean
      detail: string
      conversationId?: string
      store?: ChatStore
    }
  ): void {
    const failures = opts.ok ? 0 : (task.consecutiveFailures ?? 0) + 1
    const autoDisabled =
      !opts.ok && failures >= SCHEDULE_AUTO_DISABLE_FAILURES && task.kind !== 'once'
    const now = Date.now()
    const digest =
      makeScheduleDigest(opts.detail) ||
      (opts.ok ? '定时任务已执行完毕' : '执行出错，请查看对话')

    if (task.kind === 'once' || autoDisabled) {
      upsertSchedule({
        ...task,
        conversationId: opts.conversationId || task.conversationId,
        enabled: false,
        lastRunAt: now,
        lastRunOk: opts.ok,
        lastRunSummary: digest,
        consecutiveFailures: failures,
        nextRunAt: undefined,
        updatedAt: now
      })
      const t = this.timers.get(task.id)
      if (t) clearTimeout(t)
      this.timers.delete(task.id)
    } else {
      const next = computeNextRun(task, now)
      upsertSchedule({
        ...task,
        conversationId: opts.conversationId || task.conversationId,
        lastRunAt: now,
        lastRunOk: opts.ok,
        lastRunSummary: digest,
        consecutiveFailures: failures,
        nextRunAt: next ?? undefined,
        updatedAt: now
      })
      if (next) this.arm(task.id, next - now)
    }

    this.onRunFinished({
      taskId: task.id,
      taskName: task.name,
      conversationId: opts.conversationId || task.conversationId,
      ok: opts.ok,
      detail: autoDisabled ? `连续失败 ${failures} 次，已自动暂停。${digest}` : digest,
      autoDisabled,
      store: opts.store
    })
    this.broadcast()
  }

  private async runRssDigestTask(task: ScheduledTask): Promise<void> {
    const rssId = (task.rssConversationId || task.conversationId || '').trim()
    const store = getChatStore()
    const conv = store?.conversations.find((c) => c.id === rssId)
    if (!conv || conv.kind !== 'rss' || !conv.rss) {
      this.finishRun(task, {
        ok: false,
        detail: '绑定的 RSS 任务已不存在',
        conversationId: rssId || undefined
      })
      return
    }

    const rss = conv.rss
    const bounds = resolveScheduleRssDigestBounds(task)
    const scoreMin = normalizeRssDigestScoreMin(task.digestScoreMin)
    const template = normalizeRssDigestTemplate(task.digestTemplate || rss.digestTemplate)
    const modelRef =
      (task.modelRef || rss.scoreModelRef || getSettings().rssScoreModelRef || '').trim() ||
      undefined
    const focusPrompt = (task.prompt || '').trim() || undefined

    try {
      const patchDisposition = (
        stage: import('../shared/rssTask').RssDispositionStage,
        detail?: string
      ): void => {
        const cur = getChatStore()
        if (!cur) return
        const next: ChatStore = {
          ...cur,
          conversations: cur.conversations.map((c) =>
            c.id === conv.id && c.rss
              ? {
                  ...c,
                  rss: {
                    ...c.rss,
                    disposition: { stage, detail, updatedAt: Date.now() },
                    digestGenerating: stage === 'digesting' || stage === 'scoring' || stage === 'fetching' || stage === 'picking',
                    updatedAt: Date.now()
                  },
                  updatedAt: Date.now()
                }
              : c
          )
        }
        saveChatStore(next)
      }

      const res = await runRssDispositionPipeline({
        feeds: rss.feeds,
        items: rss.items,
        bounds,
        scoreMin,
        modelRef,
        template,
        focusPrompt,
        refresh: true,
        scoreUnscored: rss.scoreEnabled !== false,
        scoreEnabled: rss.scoreEnabled !== false,
        onStage: patchDisposition
      })

      if (!res.ok || !res.record) {
        patchDisposition('idle', res.error)
        this.finishRun(task, {
          ok: false,
          detail: res.error || '收录窗内没有消息',
          conversationId: conv.id,
          store: getChatStore() || undefined
        })
        return
      }

      const createdAt = Date.now()
      const record = {
        id: newRssDigestId(createdAt),
        ...res.record,
        createdAt
      }
      const latest = getChatStore()
      const latestConv = latest?.conversations.find((c) => c.id === conv.id)
      const baseRss = latestConv?.rss || rss
      const nextRss = prependRssDigest(
        {
          ...baseRss,
          feeds: res.feeds,
          items: res.items,
          readerMode: 'digest',
          digestTemplate: template,
          disposition: {
            stage: res.stage,
            detail: res.detail,
            updatedAt: createdAt
          },
          digestGenerating: false,
          lastDigestError: res.stage === 'skeleton' ? res.error : undefined
        },
        record
      )
      const withSel: ChatStore = {
        ...latest!,
        conversations: latest!.conversations.map((c) =>
          c.id === conv.id
            ? {
                ...c,
                rss: {
                  ...nextRss,
                  selectedId: rssDigestThreadId(record.id),
                  readerMode: 'digest'
                },
                updatedAt: createdAt
              }
            : c
        )
      }
      saveChatStore(withSel)
      const titleBit = record.title?.trim() || bounds.label
      const modeBit = res.stage === 'done' ? '模型归纳' : '模板骨架'
      this.finishRun(task, {
        ok: true,
        detail: `已生成「${titleBit}」· ${modeBit} · 纳入 ${res.includedCount}${
          res.windowCount > res.includedCount ? `/${res.windowCount}` : ''
        } 条`,
        conversationId: conv.id,
        store: withSel
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.finishRun(task, {
        ok: false,
        detail: msg,
        conversationId: conv.id,
        store: getChatStore() || undefined
      })
    }
  }

  private async runTask(rawTask: ScheduledTask): Promise<void> {
    const task = { ...rawTask }
    if (isRssDigestSchedule(task)) {
      await this.runRssDigestTask(task)
      return
    }

    let prep: ReturnType<typeof prepareRun>
    try {
      prep = prepareRun(task)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.finishRun(task, {
        ok: false,
        detail: msg,
        conversationId: task.conversationId
      })
      return
    }
    this.onRunStarted({
      taskId: task.id,
      taskName: task.name,
      conversationId: prep.conversationId,
      userMsgId: prep.userMsgId,
      assistantMsgId: prep.assistantMsgId,
      store: prep.store
    })

    let ok = true
    let detail = ''
    let streamBuf = ''
    const wrapEmit: Emit = (event) => {
      if (event.type === 'assistant-delta' && event.text) {
        streamBuf = (streamBuf + event.text).slice(-4000)
      } else if (event.type === 'done') {
        const r = (event.result || '').trim()
        if (r) streamBuf = r
      } else if (event.type === 'error' && event.message) {
        streamBuf = event.message
      }
      this.emit(event)
    }
    try {
      await this.runner.run(prep.payload, wrapEmit)
    } catch (err) {
      ok = false
      detail = err instanceof Error ? err.message : String(err)
    }

    this.finishRun(
      { ...task, conversationId: prep.conversationId },
      {
        ok,
        detail: ok ? streamBuf || detail : detail || streamBuf,
        conversationId: prep.conversationId
      }
    )
  }
}
