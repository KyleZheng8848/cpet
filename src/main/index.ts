import { t as uiText } from '../shared/i18n'
import { normalizeUiLanguage, resolveUiLocale, setUiLocale, type UiLanguageState } from '../shared/i18n'
import { STUDIO_NAME } from '../shared/appIdentity'
import { applicationMenuTemplate } from './appMenu'
import {
  app,
  clipboard,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  BrowserWindow,
  dialog,
  Notification,
  powerMonitor,
  shell,
  screen
} from 'electron'
import {
  registerCpetFileProtocolHandler,
  registerCpetFileSchemePrivileged
} from './cpetFileProtocol'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import {
  IPC,
  SKINS,
  isSupportedBackend,
  isChatThemeId,
  isNewsSourceId,
  isAgentAutonomy,
  normalizeChatThemeCustom,
  DEFAULT_CHAT_THEME,
  sanitizeUserAvatar
} from '../shared/types'
import { isSkillDeliveryPref } from '../shared/skills'
import type { ChatThemeCustom, NewsSourceId } from '../shared/types'
import type {
  Activity,
  AgentBackend,
  AgentEvent,
  ApprovalDecision,
  ApprovalRequest,
  ChatHistory,
  ChatStore,
  ModelPref,
  ModelProvider,
  PetMood,
  PetState,
  ScheduledTask,
  ScheduleRunPayload,
  UpdateCheckResult,
  SendPromptPayload,
  SkinId,
  TaskTag
} from '../shared/types'
import { AgentRunner, getAgentStatus, clearAgentStatusCache, listCursorModels } from './cursorAgent'
import { refreshAugmentedPath } from './cliPath'
import { OpenClawRunner, listOpenclawAgents } from './openclawAgent'
import { listModelCatalog } from './modelCatalog'
import { OpenAICompatRunner } from './openaiCompat'
import { ClaudeCodeRunner } from './claudeCodeAgent'
import { CodexRunner } from './codexAgent'
import { OpencodeRunner } from './opencodeAgent'
import {
  parseModelRef,
  ensureBuiltinProviders,
  isAgentModelRef
} from '../shared/models'
import {
  normalizePromptTemplates,
  normalizeSystemPrompt,
  mergeSystemWithLocalContext,
  mergeSystemWithAutonomy
} from '../shared/prompts'
import { mergeSystemWithAgentMemory } from '../shared/agentMemory'
import {
  clearAgentMemoryGraph,
  getAgentMemoryStats,
  noteAgentMemoryTurn,
  recallAgentMemoryBlock,
  scheduleAgentMemoryExtract,
  setAgentMemoryComplete,
  setAgentMemoryEnabled
} from './agentMemory'
import { isSafeAgentCwd, UNSAFE_CWD_MESSAGE } from '../shared/cwd'
import { homedir } from 'node:os'
import { bootstrapAgentBackend } from './agentDetect'
import { listAgentSkills } from './skills'
import {
  dictationAvailable,
  pushLiveDictationPcm,
  startLiveDictation,
  stopLiveDictation,
  transcribeAudioBase64,
  type DictationLiveEvent
} from './dictation'
import { startHookServer, extractPrompt, type HookEvent } from './hookServer'
import { getSettings, updateSettings, getHistory, saveHistory, getChatStore, saveChatStore } from './store'
import { takeDueReminders } from '../shared/todayHome'
import {
  checkForUpdate,
  dismissUpdateBanner,
  getLastUpdateResult,
  getReleasesUrl,
  getRepoUrl,
  startUpdateWatch,
  stopUpdateWatch
} from './updates'
import { shouldNotifyUpdate } from '../shared/updateCheck'
import { feedbackIssuesUrl } from '../shared/feedback'
import {
  ideLaunchPlan,
  normalizeOpenPanelPayload,
  resolveAttnOpen,
  resolvePresenceOpen,
  type PresenceOpenResult
} from '../shared/openPanel'
import {
  arbitratePetPresence,
  idePresenceTrackId,
  isIdePresenceTrackId,
  PET_STATE_RANK,
  presenceToOpsKind,
  presenceStateFromAgentEvent,
  type PresenceEntry
} from '../shared/petPresence'
import {
  engineIdFromModelRef,
  normalizeWorkMemory,
  rememberCwd,
  rememberEngineFailure
} from '../shared/workMemory'
import { mergeOpsBoard, type OpsBoardItem, type OpsBoardSnapshot } from '../shared/opsBoard'
import { TaskScheduler, type ScheduleFinishedInfo } from './scheduler'
import type { PermissionLogEntry } from '../shared/types'
import { getWeather, getNews, clearWeatherCache } from './feeds'
import {
  briefDismiss,
  briefMarkAllRead,
  briefMarkRead,
  briefReapplyFilters,
  briefTogglePin,
  emitCurrentBriefDigest,
  findBriefItem,
  getBriefInbox,
  initBriefInbox,
  refreshBriefInbox,
  setBriefDigestEmitter,
  setBriefInboxEmitter,
  stopBriefInbox,
  takeActionableUnread,
  tickDailyDigest
} from './briefInbox'
import { discoverRssFeeds } from './rssDiscover'
import { lookupRssFeedMetrics } from './rssCatalogMetrics'
import {
  armQuickChat,
  armQuickChatFromVoice,
  notifyQuickChatUiGone,
  notifyQuickChatUiReady,
  sendQuickChat
} from './quickChat'
import {
  refreshQuickChatHotkey,
  unregisterQuickChatHotkey
} from './quickChatHotkey'
import { normalizeQuickChatSettings } from '../shared/quickChat'
import { claimTtsPlayback, releaseTtsPlayback, speakTts, speakTtsLive } from './ttsSpeak'
import {
  getCosyVoiceStatus,
  installCosyVoice,
  prepareCosyVoiceModel,
  stopCosyVoiceSidecar
} from './cosyVoiceSidecar'
import {
  addTtsVoice,
  listTtsVoices,
  pickCosyvoiceRoot,
  pickTtsPromptWav,
  removeTtsVoice
} from './ttsVoices'
import {
  buildRssDigestReport,
  recoverRssArticleWithModel,
  scoreRssEntries,
  setRssAgentComplete
} from './rssIntelligence'
import { runRssDispositionPipeline } from './rssDisposition'
import { scanAndEmitRssPetTips, setRssPetTipEmitter } from './rssPetTips'
import { reconcileRssOnChatStoreSave } from '../shared/rssFeedPoll'
import {
  setRssFeedPollEmitter,
  startRssFeedPoller,
  stopRssFeedPoller,
  tickRssFeedPolls
} from './rssFeedPoller'
import { normalizeRssPetPushMinScore } from '../shared/petBubblePolicy'
import { fetchRssArticle, refreshRssTaskFeeds } from './rssTask'
import { setupRssWebviewSession } from './rssWebview'
import { normalizeRssOrganizeLang } from '../shared/rssLang'
import { normalizeRssDigestIntervalHours, normalizeRssPaneWidths } from '../shared/rssTask'
import {
  buildBriefBatchEscalatePrompt,
  buildBriefEscalatePrompt,
  normalizeBriefDailyDigestHour,
  normalizeBriefDailyDigestHours,
  normalizeInterestKeywords
} from '../shared/briefInbox'
import { normalizeRssFeedUrls } from '../shared/rssBrief'
import {
  pickAttachments,
  previewAttachment,
  saveTempAttachment,
  promptWithAttachmentsForLane,
  openAttachmentPath,
  openAttachmentFolder,
  revealAttachmentPath,
  readAttachmentText,
  resolveAttachmentPaths,
  ingestAttachmentsToChat
} from './attachments'
import { previewOffice } from './officePdf'
import {
  exportSkinPackDialog,
  getSkinsDir,
  importSkinPackDialog,
  listImagePacks,
  listLocalSkinPacks,
  loadImageSkin,
  openSkinsLocation,
  prepareSkinMarketSubmission,
  uninstallImagePack
} from './imageSkins'
import { downloadAndInstallSkin, fetchSkinMarket } from './skinMarket'
import {
  clearUserAvatarImage,
  pickUserAvatarImage,
  resolveUserAvatarDisplay
} from './userAvatar'
import {
  getSetupStatus,
  installHooks,
  uninstallHooks,
  installAgent as runInstallAgent,
  installEngineCli as runInstallEngineCli,
  agentLogin,
  engineCliLogin,
  ensureHooksFresh
} from './setup'
import { trustCodexPetHooks } from './codexHookTrust'
import { startHookInbox } from './hookInbox'
import {
  createPetWindow,
  createChatWindow,
  closeSkins,
  getChatWindow,
  getPetWindow,
  getSkinsWindow,
  showPet,
  openChat,
  openSkins,
  setAppQuitting,
  setChatWindowClosedHandler,
  setPetIgnoreMouse,
  setPetQuickChatExpanded,
  startPetDrag,
  stopPetDrag,
  toggleChat,
  toggleSkins
} from './windows'

const runner = new AgentRunner()
const openclawRunner = new OpenClawRunner()
const openaiRunner = new OpenAICompatRunner()
const claudeCodeRunner = new ClaudeCodeRunner()
const codexRunner = new CodexRunner()
const opencodeRunner = new OpencodeRunner()

const BUILTIN_CLI_PROVIDERS = new Set([
  'cursor',
  'openclaw',
  'claude-code',
  'codex',
  'opencode'
])

function activeBackend(): AgentBackend {
  const b = getSettings().agentBackend
  return isSupportedBackend(b ?? '') ? b! : 'cursor'
}

function routeOne(
  payload: SendPromptPayload,
  emit: (e: AgentEvent) => void
): Promise<void> {
  const ref = payload.model?.trim()
  const customApiLane = Boolean(
    ref && !isAgentModelRef(getSettings().modelProviders, ref)
  )
  payload = {
    ...payload,
    prompt: promptWithAttachmentsForLane(payload.prompt, payload.attachments, customApiLane)
  }
  if (ref) {
    const { provider } = parseModelRef(ref)
    if (provider === 'openclaw') return openclawRunner.run(payload, emit)
    if (provider === 'cursor') return runner.run(payload, emit)
    if (provider === 'claude-code') return claudeCodeRunner.run(payload, emit)
    if (provider === 'codex') return codexRunner.run(payload, emit)
    if (provider === 'opencode') return opencodeRunner.run(payload, emit)
    const settings = getSettings()
    const prov = (settings.modelProviders ?? []).find((p) => p.id === provider)
    if (prov?.kind === 'custom' || (prov && !BUILTIN_CLI_PROVIDERS.has(provider))) {
      return openaiRunner.run(payload, emit)
    }
    emit({
      type: 'error',
      message: uiText("该模型提供商已不可用，请重新选择模型。"),
      conversationId: payload.conversationId,
      modelId: ref,
      laneId: payload.laneId
    })
    return Promise.resolve()
  }
  const backend = activeBackend()
  if (backend === 'openclaw') return openclawRunner.run(payload, emit)
  if (backend === 'claude-code') return claudeCodeRunner.run(payload, emit)
  if (backend === 'codex') return codexRunner.run(payload, emit)
  if (backend === 'opencode') return opencodeRunner.run(payload, emit)
  return runner.run(payload, emit)
}

function collectPayloadModelRefs(payload: SendPromptPayload): string[] {
  const fromCompare = payload.compareRuns?.map((r) => r.model).filter(Boolean) as string[] | undefined
  if (fromCompare?.length) return fromCompare
  if (payload.models?.length) return payload.models.filter(Boolean)
  if (payload.model?.trim()) return [payload.model.trim()]
  return []
}

/** Agent CLI 必须带安全项目目录；纯 API 直连不强制。 */
function payloadNeedsSafeCwd(payload: SendPromptPayload): boolean {
  const refs = collectPayloadModelRefs(payload)
  const providers = getSettings().modelProviders
  if (refs.length === 0) return true
  return refs.some((r) => isAgentModelRef(providers, r))
}

function assertSafeAgentCwd(payload: SendPromptPayload, emit: (e: AgentEvent) => void): boolean {
  if (!payloadNeedsSafeCwd(payload)) return true
  const home = homedir()
  if (isSafeAgentCwd(payload.cwd, home)) return true
  emit({
    type: 'error',
    message: UNSAFE_CWD_MESSAGE,
    conversationId: payload.conversationId,
    laneId: payload.laneId,
    modelId: payload.model
  })
  return false
}

const agentFacade = {
  get isBusy(): boolean {
    return (
      runner.isBusy ||
      openclawRunner.isBusy ||
      openaiRunner.isBusy ||
      claudeCodeRunner.isBusy ||
      codexRunner.isBusy ||
      opencodeRunner.isBusy
    )
  },
  isBusyFor(conversationId: string): boolean {
    return (
      runner.isBusyFor(conversationId) ||
      openclawRunner.isBusyFor(conversationId) ||
      openaiRunner.isBusyFor(conversationId) ||
      claudeCodeRunner.isBusyFor(conversationId) ||
      codexRunner.isBusyFor(conversationId) ||
      opencodeRunner.isBusyFor(conversationId)
    )
  },
  async run(payload: SendPromptPayload, emit: (e: AgentEvent) => void): Promise<void> {
    // 本地上下文 + 任务权限（问答/计划）写入 system，全引擎 / 直连 API 共用
    const headless = (payload.conversationId || '').startsWith('rss-intel-')
    if (!headless) noteAgentMemoryTurn(payload.conversationId, payload.prompt)
    payload = {
      ...payload,
      systemPrompt: mergeSystemWithAgentMemory(
        mergeSystemWithAutonomy(
          mergeSystemWithLocalContext(
            payload.systemPrompt,
            getSettings().weatherCity,
            payload.cwd
          ),
          payload.agentAutonomy
        ),
        headless ? '' : recallAgentMemoryBlock(payload.prompt)
      )
    }
    if (!assertSafeAgentCwd(payload, emit)) return
    const compareRuns = payload.compareRuns?.filter((r) => r.laneId && r.model)
    if (compareRuns && compareRuns.length > 0) {
      await Promise.all(
        compareRuns.map((r) =>
          routeOne(
            {
              ...payload,
              model: r.model,
              laneId: r.laneId,
              sessionId: r.sessionId,
              history: r.history ?? payload.history,
              compareRuns: undefined,
              models: undefined,
              modelSessions: undefined
            },
            emit
          )
        )
      )
      return
    }
    const models = payload.models?.filter(Boolean)
    if (models && models.length > 0) {
      await Promise.all(
        models.map((model, i) =>
          routeOne(
            {
              ...payload,
              model,
              laneId: payload.laneId || `legacy_${i}_${model}`,
              models: undefined,
              sessionId: payload.modelSessions?.[model] ?? undefined,
              modelSessions: undefined
            },
            emit
          )
        )
      )
      return
    }
    await routeOne(payload, emit)
  },
  cancel(conversationId?: string, laneOrModelId?: string): void {
    runner.cancel(conversationId, laneOrModelId)
    openclawRunner.cancel(conversationId, laneOrModelId)
    openaiRunner.cancel(conversationId, laneOrModelId)
    claudeCodeRunner.cancel(conversationId, laneOrModelId)
    codexRunner.cancel(conversationId, laneOrModelId)
    opencodeRunner.cancel(conversationId, laneOrModelId)
  }
}

/** RSS 问答级 Agent：优先用设置里的安全项目目录，否则用 userData 沙箱（不拦主目录用户）。 */
function resolveRssIntelAgentCwd(): string {
  const settings = getSettings()
  const home = homedir()
  if (isSafeAgentCwd(settings.cwd, home)) return settings.cwd!.trim()
  const dir = join(app.getPath('userData'), 'rss-intel-workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** RSS 评分/简报：Agent 走问答权限 headless，不写讨论线程。 */
async function headlessAgentComplete(
  modelRef: string,
  system: string,
  user: string,
  timeoutMs: number
): Promise<string> {
  const cwd = resolveRssIntelAgentCwd()
  const conversationId = `rss-intel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let text = ''
  let doneResult = ''
  let errorMsg = ''
  let settled = false

  // 多数 CLI runner 的 run() 在 spawn 后立刻 resolve，不能把它当成「写完」。
  // 必须以 done / error / aborted 终态事件为准。
  let resolveTerminal: () => void = () => undefined
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  const markSettled = (): void => {
    if (settled) return
    settled = true
    resolveTerminal()
  }

  void agentFacade
    .run(
      {
        prompt: user,
        systemPrompt: system,
        model: modelRef,
        cwd,
        conversationId,
        agentAutonomy: 'ask'
      },
      (ev) => {
        if (ev.type === 'assistant-delta' && ev.text) text += ev.text
        if (ev.type === 'done') {
          if (typeof ev.result === 'string' && ev.result.trim()) doneResult = ev.result.trim()
          // done 可能略早于最后一帧 delta，再让出一轮
          setImmediate(markSettled)
        }
        if (ev.type === 'error') {
          errorMsg = ev.message || 'Agent 出错'
          markSettled()
        }
        if (ev.type === 'aborted') {
          errorMsg = errorMsg || '已取消'
          markSettled()
        }
      }
    )
    .catch((err: unknown) => {
      errorMsg = err instanceof Error ? err.message : String(err || 'Agent 出错')
      markSettled()
    })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      terminal,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          agentFacade.cancel(conversationId)
          reject(new Error(`Agent 超时（${Math.round(timeoutMs / 1000)}s）`))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (errorMsg) throw new Error(errorMsg)
  const out = (doneResult || text).trim()
  if (!out) {
    throw new Error(settled ? 'Agent 返回空内容' : 'Agent 未完成')
  }
  return out
}

setRssAgentComplete(headlessAgentComplete)
setAgentMemoryComplete(headlessAgentComplete)

let tray: Tray | null = null
let stopHookServer: (() => void) | null = null
let scheduler: TaskScheduler | null = null
let stopHookInbox: (() => void) | null = null
let lastHookAt = 0
let lastHookKey = ''
let lastDoneNotifyAt = 0
/** IDE 轨摘要：按 trackId 分槽，避免多 Composer 串台。 */
const ideSummaries = new Map<string, string>()
/** IDE 轨 → 续查用的 CPET conversationId。 */
const ideContinueBindings = new Map<string, string>()
/** CPET 内对话：按会话攒回复摘要，用于完成提醒。 */
const chatSummaries = new Map<string, string>()

// ---- 任务标签：优先用工作区目录名区分 Cursor 会话；避免无意义的「任务 1」 ----
const TAG_EMOJIS = ['🟣', '🟢', '🟠', '🔵', '🔴', '🟡', '🟤', '⚫']
const sessionTags = new Map<string, TaskTag>()
let tagCursor = 0

function pathBase(p: string): string {
  const parts = String(p).replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

const WEAK_IDE_LABELS = new Set([
  'Cursor',
  'ChatGPT',
  'Terminal',
  'Codex',
  'Claude',
  'CPET'
])

function isWeakTaskLabel(label: string): boolean {
  return !label || WEAK_IDE_LABELS.has(label) || /^任务\s*\d+$/.test(label)
}

/** 从 hook payload 尽量抽出稳定会话 id。 */
function resolveHookSessionId(raw: any): string {
  if (!raw || typeof raw !== 'object') return 'default'
  const candidates = [
    raw.session_id,
    raw.sessionId,
    raw.conversation_id,
    raw.conversationId,
    raw.composer_id,
    raw.composerId,
    raw.generation_id,
    raw.generationId,
    raw.threadId,
    raw.thread_id,
    raw.turn_id,
    raw.turnId,
    raw.agent_id,
    raw.agentId
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
    if (typeof c === 'number' && Number.isFinite(c)) return String(c)
  }
  return 'default'
}

/** 可读任务名：工作区文件夹 > 模型 > 短会话号；回落真实 IDE 名（绝不永远写死 Cursor）。 */
function resolveHookTaskLabel(raw: any): string {
  const ideFallback = resolveIdeApp(raw)
  if (!raw || typeof raw !== 'object') return ideFallback
  const roots = raw.workspace_roots ?? raw.workspaceRoots
  const cwd =
    (Array.isArray(roots) && roots[0]) ||
    raw.cwd ||
    raw.workspaceRoot ||
    raw.workspace_root ||
    raw.workspace ||
    raw.project_dir ||
    raw.projectDir ||
    ''
  if (cwd) {
    const base = pathBase(String(cwd))
    if (base) return base
  }
  const model = raw.model ?? raw.model_name ?? raw.modelName
  if (typeof model === 'string' && model.trim()) {
    const m = model.trim()
    // composer-2.5 / gpt-… 等直接可用；过长则截断
    return m.length > 28 ? m.slice(0, 26) + '…' : m
  }
  const transcript = raw.transcript_path ?? raw.transcriptPath
  if (typeof transcript === 'string' && transcript.includes('/')) {
    // …/proj/.cursor/… → 尽量取项目名
    const parts = transcript.replace(/\\/g, '/').split('/').filter(Boolean)
    const cursorIdx = parts.findIndex((p) => p === '.cursor')
    if (cursorIdx > 0) return parts[cursorIdx - 1]!
    const codexIdx = parts.findIndex((p) => p === '.codex')
    if (codexIdx > 0) return parts[codexIdx - 1]!
  }
  const sid = resolveHookSessionId(raw)
  if (sid !== 'default' && sid.length >= 6) return `会话 ${sid.slice(0, 6)}`
  return ideFallback
}

function taskFor(raw: any): TaskTag {
  const sid = resolveHookSessionId(raw)
  const better = resolveHookTaskLabel(raw)
  let tag = sessionTags.get(sid)
  if (!tag) {
    tag = {
      id: sid,
      emoji: TAG_EMOJIS[tagCursor++ % TAG_EMOJIS.length],
      label: better
    }
    sessionTags.set(sid, tag)
    if (sessionTags.size > 60) {
      const oldest = sessionTags.keys().next().value
      if (oldest !== undefined) sessionTags.delete(oldest)
    }
  } else if (isWeakTaskLabel(tag.label) && !isWeakTaskLabel(better)) {
    // 早期事件缺 cwd，后续工具/命令事件常带上工作区 —— 就地升级标签
    tag = { ...tag, label: better }
    sessionTags.set(sid, tag)
  }
  return tag
}

// ---- 待决审批 ----
const pendingApprovals = new Map<
  string,
  {
    resolve: (d: ApprovalDecision) => void
    timer: ReturnType<typeof setTimeout>
    logKind: PermissionLogEntry['kind']
    summary: string
  }
>()

function resourcePath(file: string): string {
  // 开发态资源在项目 resources/，打包后在 process.resourcesPath。
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../../resources', file)
}

/** 多会话态势：conversationId → 最近态（供桌宠仲裁）。 */
const convPresence = new Map<string, PresenceEntry>()
/** 定时任务跑着的会话：完成时走定时通知，跳过普通 notifyDone。 */
const scheduleCeremonyPending = new Set<string>()
/** 所选引擎不健康时的提示（idle 时覆盖碎碎念）。 */
let engineHealthNote: string | null = null

/** 根据当前后端与引擎探测结果刷新「虚弱」提示。 */
async function refreshEngineHealthNote(): Promise<void> {
  try {
    const st = await getAgentStatus()
    const backend = st.backend
    if (st.usingMock || !st.anyAgentInstalled) {
      engineHealthNote = '引擎未就绪：当前是演示模式，去设置接上真实引擎'
      return
    }
    const eng = st.engines?.find((e) => e.id === backend)
    if (backend === 'openclaw') {
      const note = eng?.note || ''
      if (!eng?.installed || /Gateway 未连通|未检测/i.test(note)) {
        engineHealthNote = 'OpenClaw Gateway 未连通，我有点趴窝了'
        return
      }
    } else if (eng && !eng.installed) {
      engineHealthNote = `${eng.label || backend} 未安装或未就绪`
      return
    }
    engineHealthNote = null
  } catch {
    // 探测失败不覆盖
  }
}

function extractHookCwd(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const roots = raw.workspace_roots ?? raw.workspaceRoots
  const cwd =
    (Array.isArray(roots) && typeof roots[0] === 'string' && roots[0]) ||
    raw.cwd ||
    raw.workspaceRoot ||
    raw.workspace_root ||
    raw.workspace ||
    raw.project_dir ||
    raw.projectDir ||
    ''
  const s = String(cwd || '').trim()
  return s || undefined
}

function emitPermissionLog(entry: PermissionLogEntry, conversationId?: string): void {
  getChatWindow()?.webContents.send(IPC.permissionLog, { conversationId, entry })
}

let lastOpsBoard: OpsBoardSnapshot = { items: [], updatedAt: 0 }
/** 作战板忽略：压制到「完整上报」里该 id 消失后再允许重新出现。 */
const opsDismissed = new Set<string>()

function emitOpsBoard(snap: OpsBoardSnapshot): void {
  lastOpsBoard = snap
  getPetWindow()?.webContents.send(IPC.opsBoard, lastOpsBoard)
}

/** @param items 对话窗+态势的完整候选；忽略集按「上报里还有没有」维护。 */
function publishOpsBoard(items: OpsBoardItem[]): void {
  const incoming = new Set(items.map((it) => it.id))
  for (const id of [...opsDismissed]) {
    if (!incoming.has(id)) opsDismissed.delete(id)
  }
  emitOpsBoard(mergeOpsBoard(items.filter((it) => !opsDismissed.has(it.id))))
}

/**
 * 用户已点进该任务/界面：角标去掉对应条目，并清 presence，避免立刻刷回。
 */
function dismissOpsForConversation(conversationId: string, explicitId?: string): void {
  const cid = conversationId.trim()
  if (!cid) return
  if (explicitId?.trim()) opsDismissed.add(explicitId.trim())
  for (const prefix of ['wait-', 'err-', 'run-', 'pres-', 'sched-']) {
    opsDismissed.add(`${prefix}${cid}`)
  }
  for (const it of lastOpsBoard.items) {
    if (it.conversationId === cid) opsDismissed.add(it.id)
  }
  convPresence.delete(cid)
  const next = mergeOpsBoard(
    lastOpsBoard.items.filter(
      (x) => x.conversationId !== cid && !opsDismissed.has(x.id)
    )
  )
  emitOpsBoard(next)
}

function presenceTitle(cid: string): string {
  const fromStore = getChatStore()?.conversations.find((c) => c.id === cid)?.title
  if (fromStore) return fromStore
  if (isIdePresenceTrackId(cid)) {
    const rest = cid.slice('ide:'.length)
    const sid = rest.startsWith('default:') ? 'default' : rest
    const tag = sessionTags.get(sid)
    if (tag) return `${tag.emoji} ${tag.label}`
    return 'IDE 任务'
  }
  return '任务'
}

/** 从 convPresence 合成待办条目（审批不在此列，宠边单独计）。 */
function presenceOpsItems(): OpsBoardItem[] {
  const items: OpsBoardItem[] = []
  for (const [cid, ent] of convPresence) {
    const kind = presenceToOpsKind(ent)
    if (!kind) continue
    items.push({
      id: `pres-${cid}`,
      kind,
      title: presenceTitle(cid),
      detail:
        kind === 'waiting'
          ? '在等你回复'
          : kind === 'error'
            ? '运行出错'
            : ent.origin === 'ide' || isIdePresenceTrackId(cid)
              ? '去对应应用里看'
              : '刚完成，点开看看',
      conversationId: cid,
      ideApp: ent.ideApp,
      panel: 'chat',
      updatedAt: ent.updatedAt
    })
  }
  return items
}

/** 态势变更后刷新宠物角标数据源（保留非 pres- 的定时等条目）。 */
function syncPresenceOpsBoard(): void {
  const keep = lastOpsBoard.items.filter((x) => !x.id.startsWith('pres-'))
  publishOpsBoard([...keep, ...presenceOpsItems()])
}

function ideAppAliases(name: string): string[] {
  const n = (name || '').trim().toLowerCase()
  if (!n) return ['cursor']
  if (n.includes('cursor')) return ['cursor', 'cursor 2']
  if (n.includes('codex') || n.includes('chatgpt')) return ['chatgpt', 'codex']
  if (n.includes('claude')) return ['claude']
  return [n]
}

function ackIdeOpsIfFrontmost(): void {
  if (process.platform !== 'darwin') return
  const pending: { cid: string; app: string }[] = []
  for (const [cid, ent] of convPresence) {
    if (!presenceToOpsKind(ent)) continue
    if (ent.origin !== 'ide' && !isIdePresenceTrackId(cid)) continue
    pending.push({ cid, app: ent.ideApp || 'Cursor' })
  }
  if (!pending.length) return
  execFile(
    'osascript',
    ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
    { timeout: 1500 },
    (err, stdout) => {
      if (err) return
      const front = String(stdout || '').trim().toLowerCase()
      if (!front || front === 'electron' || front === 'cpet') return
      for (const p of pending) {
        if (ideAppAliases(p.app).some((a) => front === a || front.includes(a))) {
          dismissOpsForConversation(p.cid)
        }
      }
    }
  )
}

function patchWorkMemory(
  fn: (mem: ReturnType<typeof normalizeWorkMemory>) => ReturnType<typeof normalizeWorkMemory>
): void {
  const cur = normalizeWorkMemory(getSettings().workMemory)
  updateSettings({ workMemory: fn(cur) })
}

function rememberProjectCwd(cwd?: string): void {
  if (!cwd?.trim()) return
  patchWorkMemory((m) => rememberCwd(m, cwd.trim()))
}

function updatePresenceFromEvent(event: AgentEvent): void {
  const cid = event.conversationId
  if (!cid) return
  const state = presenceStateFromAgentEvent(event)
  if (!state) return
  const prev = convPresence.get(cid)
  const origin: 'ide' | 'cpet' =
    event.origin === 'ide' || event.origin === 'cpet'
      ? event.origin
      : prev?.origin || (isIdePresenceTrackId(cid) ? 'ide' : 'cpet')
  convPresence.set(cid, {
    state,
    updatedAt: Date.now(),
    origin,
    ideApp: event.ideApp || prev?.ideApp
  })
  // 终态驻留角标：只有点进该对话或切到对应 IDE 才消，不因工作台开着/回复结束就抹掉
  syncPresenceOpsBoard()
}

function sourceCeremonyRank(source: AgentEvent): number {
  if (source.type === 'error') return PET_STATE_RANK.error
  if (source.type === 'done') return PET_STATE_RANK.done
  if (source.type === 'aborted') return PET_STATE_RANK.idle
  return 0
}

/** 把仲裁后的态发给宠物窗（带焦点 conversationId）。 */
function pushArbitratedPetEvent(source: AgentEvent): void {
  const focus = arbitratePetPresence(convPresence)
  const pet = getPetWindow()
  if (!pet || pet.isDestroyed()) return
  if (source.type === 'state' || source.type === 'tool' || source.type === 'command') {
    const note =
      focus.state === 'idle' && engineHealthNote
        ? engineHealthNote
        : source.type === 'state' &&
            (!focus.conversationId || focus.conversationId === source.conversationId)
          ? source.note
          : undefined
    const focusEntry = focus.conversationId
      ? convPresence.get(focus.conversationId)
      : undefined
    const ev: AgentEvent = {
      type: 'state',
      state: focus.state,
      conversationId: focus.conversationId || source.conversationId,
      note,
      // 焦点会话来自监听时保持 ide，避免被后到的 CPET 事件盖掉点击目标
      origin: focus.origin || source.origin,
      ideApp: focus.ideApp || focusEntry?.ideApp || source.ideApp
    }
    pet.webContents.send(IPC.agentEvent, ev)
    if (focus.state === 'idle' && engineHealthNote) setPetMood('sleeping')
    return
  }
  if (source.type === 'done' || source.type === 'error' || source.type === 'aborted') {
    // 更高优轨（如另一会话 waiting）仍在时，不要用本轨完成仪式盖掉
    if (
      focus.conversationId &&
      source.conversationId &&
      focus.conversationId !== source.conversationId &&
      (PET_STATE_RANK[focus.state] ?? 0) > sourceCeremonyRank(source)
    ) {
      const focusEntry = convPresence.get(focus.conversationId)
      pet.webContents.send(IPC.agentEvent, {
        type: 'state',
        state: focus.state,
        conversationId: focus.conversationId,
        origin: focus.origin,
        ideApp: focus.ideApp || focusEntry?.ideApp
      })
      // 仍转发 quiet 终态：快问条要靠它结束「回答中」，但不抢宠物完成仪式
      pet.webContents.send(IPC.agentEvent, {
        ...source,
        quiet: true,
        conversationId: source.conversationId,
        origin: source.origin || 'cpet',
        ideApp: source.ideApp
      })
      return
    }
    pet.webContents.send(IPC.agentEvent, {
      ...source,
      conversationId: source.conversationId || focus.conversationId,
      origin: source.origin || focus.origin,
      ideApp: source.ideApp || focus.ideApp
    })
    return
  }
  // assistant-delta / reasoning-delta 等：原样转发，保证快问能流式刷
  pet.webContents.send(IPC.agentEvent, source)
}

/** 把 agent 事件广播给所有窗口（宠物看态势仲裁态，聊天看原始事件），并做 CPET 内对话联动。 */
function broadcast(event: AgentEvent): void {
  updatePresenceFromEvent(event)
  const pet = getPetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (pet && !pet.isDestroyed() && win.id === pet.id) {
      pushArbitratedPetEvent(event)
    } else {
      win.webContents.send(IPC.agentEvent, event)
    }
  }
  handleCpetChatLinkage(event)
}

type CeremonyKind = 'done' | 'error' | 'waiting' | 'schedule' | 'skill'

/** 统一完成/定时/技能通知：防抖 + 可选深链 conversationId。 */
function notifyCeremony(opts: {
  kind: CeremonyKind
  title: string
  body: string
  conversationId?: string
  silent?: boolean
}): void {
  const now = Date.now()
  if (now - lastDoneNotifyAt < 3000 && opts.kind !== 'skill') return
  lastDoneNotifyAt = now
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: opts.title,
    body: opts.body.slice(0, 240),
    silent: opts.silent ?? false
  })
  n.on('click', () => {
    showPet({ focus: true })
    openChatToConversation(opts.conversationId, opts.kind === 'waiting')
  })
  n.show()
}

function isChatActivelyWatched(): boolean {
  const win = getChatWindow()
  return Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused())
}

function cpetTaskFromEvent(event: AgentEvent): TaskTag {
  const ref = event.modelId || ''
  const provider = ref.includes(':') ? ref.split(':')[0]! : ref
  const label =
    provider === 'cursor'
      ? 'Cursor'
      : provider === 'openclaw'
        ? 'OpenClaw'
        : provider === 'claude-code'
          ? 'Claude'
          : provider === 'codex'
            ? 'Codex'
            : provider === 'opencode'
              ? 'OpenCode'
              : provider || 'CPET'
  return {
    id: `cpet:${event.conversationId || provider || 'chat'}`,
    emoji: '💬',
    label
  }
}

function cpetActivityExtra(event: AgentEvent): { cwd?: string; sessionId?: string } {
  return {
    cwd: getSettings().cwd,
    sessionId: event.conversationId
  }
}

function chatSummaryKey(event: AgentEvent): string {
  return event.conversationId || event.laneId || event.modelId || 'default'
}

/** CPET 聊天默认联动：活动时间线 + 未盯着聊天窗时的系统完成提醒。 */
function handleCpetChatLinkage(event: AgentEvent): void {
  const key = chatSummaryKey(event)
  const task = cpetTaskFromEvent(event)
  const extra = cpetActivityExtra(event)

  switch (event.type) {
    case 'state':
      if (event.state === 'thinking' && !chatSummaries.has(key)) {
        chatSummaries.set(key, '')
        emitActivity(task, 'think', 'CPET 开始思考…', extra)
      }
      break
    case 'assistant-delta':
      if (event.text) {
        const prev = chatSummaries.get(key) || ''
        chatSummaries.set(key, (prev + event.text).slice(-4000))
      }
      break
    case 'tool':
      if (event.status === 'running') {
        emitActivity(
          task,
          'tool',
          `→ ${event.name}${event.input ? ` ${event.input}` : ''}`,
          extra
        )
      }
      break
    case 'command':
      if (event.status === 'running') {
        emitActivity(task, 'command', `$ ${event.command}`, extra)
      } else if (event.status === 'done' || event.status === 'error') {
        const code =
          typeof event.exitCode === 'number'
            ? event.exitCode === 0
              ? ' ✓'
              : ` ✗${event.exitCode}`
            : ''
        emitActivity(task, 'command', `$ ${event.command}${code}`, extra)
      }
      break
    case 'skills': {
      const bad = [...(event.missing || []), ...(event.truncated || [])]
      if (bad.length < 1) break
      const body =
        event.missing?.length
          ? `技能未找到：${event.missing.join('、')}`
          : `技能正文被截断：${event.truncated.join('、')}`
      notifyCeremony({
        kind: 'skill',
        title: uiText("⚠️ 技能未生效"),
        body,
        conversationId: event.conversationId,
        silent: false
      })
      break
    }
    case 'done': {
      const summary = (chatSummaries.get(key) || event.result || '').trim()
      chatSummaries.delete(key)
      scheduleAgentMemoryExtract({
        conversationId: event.conversationId,
        assistantText: summary || event.result
      })
      const sched = event.conversationId && scheduleCeremonyPending.has(event.conversationId)
      if (looksLikeQuestion(summary)) {
        emitActivity(task, 'wait', summary || '等你回复', extra)
        petSend({
          type: 'state',
          state: 'waiting',
          note: summary || 'CPET 在等你回复',
          origin: 'cpet',
          conversationId: event.conversationId
        })
        if (!sched && !isChatActivelyWatched()) {
          notifyWaiting(task, 'CPET 对话在等你回复', {
            conversationId: event.conversationId
          })
        }
      } else {
        emitActivity(task, 'done', summary ? `完成：${summary}` : 'CPET 对话完成', extra)
        if (summary) {
          petSend({
            type: 'done',
            result: summary,
            origin: 'cpet',
            conversationId: event.conversationId
          })
        }
        if (!sched && !isChatActivelyWatched()) {
          notifyCeremony({
            kind: 'done',
            title: uiText("🐾 {0} {1} · 任务完成", [task.emoji, task.label]),
            body: summary || '你的 CPET 对话跑完啦，来看看吧',
            conversationId: event.conversationId
          })
        }
      }
      break
    }
    case 'error': {
      chatSummaries.delete(key)
      const msg = event.message || '出错了'
      emitActivity(task, 'error', msg, extra)
      petSend({
        type: 'state',
        state: 'error',
        note: msg,
        origin: 'cpet',
        conversationId: event.conversationId
      })
      const eng = engineIdFromModelRef(event.modelId) || task.label
      if (eng) {
        patchWorkMemory((m) => rememberEngineFailure(m, eng, msg.slice(0, 80)))
      }
      const sched = event.conversationId && scheduleCeremonyPending.has(event.conversationId)
      if (!sched && !isChatActivelyWatched()) {
        notifyCeremony({
          kind: 'error',
          title: uiText("⚠️ {0} {1} · 出错", [task.emoji, task.label]),
          body: msg,
          conversationId: event.conversationId
        })
      }
      break
    }
    case 'aborted':
      chatSummaries.delete(key)
      break
    default:
      break
  }
}

function broadcastSchedules(tasks: ScheduledTask[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.schedulesChanged, tasks)
  }
}

function notifyScheduleRun(payload: ScheduleRunPayload): void {
  if (payload.conversationId) scheduleCeremonyPending.add(payload.conversationId)
  getChatWindow()?.webContents.send(IPC.scheduleRun, payload)
  openChat()
}

/** 定时任务结束：宠物气泡 + 系统通知。 */
function notifyScheduleFinished(info: ScheduleFinishedInfo): void {
  if (info.conversationId) scheduleCeremonyPending.delete(info.conversationId)
  const body =
    info.detail?.slice(0, 200) || (info.ok ? '定时任务已执行完毕' : '执行出错，请查看对话')
  const title = info.autoDisabled
    ? `⏰ ${info.taskName} 已暂停`
    : info.ok
      ? `⏰ ${info.taskName} 完成`
      : `⏰ ${info.taskName} 失败`
  if (info.ok) {
    petSend({
      type: 'done',
      result: `定时完成 · ${info.taskName}：${body}`,
      conversationId: info.conversationId,
      origin: 'cpet'
    })
  } else {
    petSend({
      type: 'error',
      message: uiText("定时失败 · {0}：{1}", [info.taskName, body]),
      conversationId: info.conversationId,
      origin: 'cpet'
    })
  }
  getChatWindow()?.webContents.send(IPC.scheduleFinished, info)
  notifyCeremony({
    kind: 'schedule',
    title,
    body,
    conversationId: info.conversationId
  })
}

function setPetState(state: PetState): void {
  getPetWindow()?.webContents.send(IPC.petState, state)
}

/**
 * 只更新宠物窗：写入态势图并走仲裁（不再 last-write-wins 直推）。
 * 聊天窗仍只走 broadcast 原始事件。
 */
function fireDueTodayReminders(store?: ChatStore | null): void {
  const cur = store || getChatStore()
  if (!cur?.todayMemos?.length) return
  const { next, due } = takeDueReminders(cur.todayMemos)
  if (!due.length) return
  for (const m of due) {
    petSend({
      type: 'state',
      state: 'waiting',
      note: m.title || '提醒到了',
      origin: 'cpet'
    })
    if (!Notification.isSupported()) continue
    const n = new Notification({
      title: `⏰ ${m.title || '提醒'}`,
      body: m.body || '到点了',
      silent: false
    })
    n.on('click', () => {
      openChat()
      getChatWindow()?.webContents.send(IPC.openPanel, { panel: 'today' })
    })
    n.show()
  }
  saveChatStore({ ...cur, todayMemos: next })
  getChatWindow()?.webContents.send(IPC.todayMemosPatched, next)
}

function petSend(event: AgentEvent): void {
  // CPET 侧常漏 origin；默认 cpet，避免气泡点击目标粘在上次 IDE
  const withOrigin: AgentEvent =
    event.origin === 'ide' || event.origin === 'cpet'
      ? event
      : { ...event, origin: 'cpet' }
  updatePresenceFromEvent(withOrigin)
  pushArbitratedPetEvent(withOrigin)
}

/** 从 hook payload 推断要唤起的 IDE 应用名（macOS `open -a`）。
 * 只用「产品/路径」标记，不用模型名：Cursor 里跑 Claude 模型时 payload 常含 claude，
 * 若按模型名判断会误开 Claude 应用。
 */
function resolveIdeApp(raw: unknown): string {
  const blob = JSON.stringify(raw ?? {})
  if (/\.claude\b|\/\.claude\/|claude-code|claude_code|CLAUDE_PROJECT/i.test(blob)) {
    return 'Claude'
  }
  // Codex 桌面端常为 ChatGPT.app；CLI 场景再回落 Terminal（openIdeApp 候选链）
  if (
    /\.codex\b|\/\.codex\/|codex\.openai|com\.openai\.codex|"turn_id"\s*:/i.test(blob)
  ) {
    return 'ChatGPT'
  }
  // Cursor hooks 常见字段；其余 IDE 联动默认也回落 Cursor
  if (/\.cursor\b|composer_id|composerId|generation_id|generationId/i.test(blob)) {
    return 'Cursor'
  }
  return 'Cursor'
}

/** IDE hook → 态势轨 id。 */
function ideTrackIdFromRaw(raw: unknown): string {
  const sid = resolveHookSessionId(raw)
  const ideApp = resolveIdeApp(raw)
  return idePresenceTrackId(sid, ideApp)
}

function ideSummaryOf(trackId: string): string {
  return ideSummaries.get(trackId) || ''
}

function setIdeSummary(trackId: string, text: string): void {
  const t = text.trim()
  if (!t) {
    ideSummaries.delete(trackId)
    return
  }
  ideSummaries.set(trackId, t.slice(-4000))
}

/** IDE hooks → 宠物：写入 ide:session 轨并参与仲裁。 */
function petSendIde(event: AgentEvent, raw?: unknown): void {
  const ideApp = resolveIdeApp(raw)
  const trackId = event.conversationId?.startsWith('ide:')
    ? event.conversationId
    : ideTrackIdFromRaw(raw)
  petSend({
    ...event,
    conversationId: trackId,
    origin: 'ide',
    ideApp
  })
}

let activitySeq = 0
/** 把一条 IDE agent 活动推给对话窗（监控时间线）。 */
function emitActivity(
  task: TaskTag,
  kind: Activity['kind'],
  text: string,
  extra?: { cwd?: string; sessionId?: string; raw?: any }
): void {
  const cwd = extra?.cwd || extractHookCwd(extra?.raw)
  const sessionId =
    extra?.sessionId ||
    (extra?.raw ? resolveHookSessionId(extra.raw) : undefined)
  const a: Activity = {
    id: `a${Date.now().toString(36)}${activitySeq++}`,
    ts: Date.now(),
    emoji: task.emoji,
    label: task.label,
    kind,
    text,
    cwd,
    sessionId: sessionId && sessionId !== 'default' ? sessionId : undefined
  }
  getChatWindow()?.webContents.send(IPC.activity, a)
}

/** HTTP + 收件箱双通道去重后分发。 */
function dispatchHookEvent(e: HookEvent): void {
  const sid = resolveHookSessionId(e.raw)
  const key = `${e.state}:${sid}:${e.detail ?? ''}`
  const now = Date.now()
  if (key === lastHookKey && now - lastHookAt < 400) return
  lastHookKey = key
  lastHookAt = now
  handleHookEvent(e)
  createTray()
}

/** 处理来自 Cursor IDE 的 hook 事件：驱动宠物 + 活动监控 + 完成通知。 */
function handleHookEvent(e: HookEvent): void {
  const trackId = ideTrackIdFromRaw(e.raw)
  switch (e.state) {
    case 'thinking': {
      setIdeSummary(trackId, '')
      petSendIde({ type: 'state', state: 'thinking' }, e.raw)
      const prompt = extractPrompt(e.raw) || e.text
      emitActivity(taskFor(e.raw), 'prompt', prompt ? `你说：${prompt}` : '提交了新任务', {
        raw: e.raw
      })
      break
    }
    case 'talking': {
      const reply = e.text || extractTextLoose(e.raw)
      if (reply) setIdeSummary(trackId, reply)
      petSendIde({ type: 'state', state: 'talking' }, e.raw)
      emitActivity(taskFor(e.raw), 'think', reply ? `回复：${reply}` : '正在回复…', {
        raw: e.raw
      })
      break
    }
    case 'thought': {
      petSendIde({ type: 'state', state: 'thinking' }, e.raw)
      const thought = e.text || extractTextLoose(e.raw)
      if (thought) emitActivity(taskFor(e.raw), 'think', `思考：${thought}`, { raw: e.raw })
      break
    }
    case 'tool': {
      const task = taskFor(e.raw)
      const detail = e.detail || describeTool(e.raw) || '使用工具'
      petSendIde(
        { type: 'tool', name: `${task.emoji}${task.label} · ${detail}`, status: 'running' },
        e.raw
      )
      const isEdit =
        /^(Write|Edit|MultiEdit|Delete|TabWrite|apply_patch)\b/i.test(detail) ||
        (/\.(ts|tsx|js|jsx|py|go|rs|md|json|css|html)\b/i.test(detail) && !/\$/.test(detail))
      emitActivity(task, isEdit ? 'edit' : 'tool', `→ ${detail}`, { raw: e.raw })
      break
    }
    case 'toolresult': {
      const task = taskFor(e.raw)
      const name =
        e.raw?.tool_name ?? e.raw?.toolName ?? e.raw?.name ?? e.detail ?? '工具'
      const out = extractToolResult(e.raw)
      const dur =
        typeof e.raw?.duration === 'number' ? ` · ${Math.round(e.raw.duration)}ms` : ''
      const text = out ? `✓ ${name}${dur}\n${out}` : `✓ ${name} 完成${dur}`
      petSendIde({ type: 'state', state: 'thinking' }, e.raw)
      // 只进活动监控 + 宠物跟态；勿弹对话窗「结果」卡（Read/Write 会刷屏干扰工作）
      emitActivity(task, 'tool', text, { raw: e.raw })
      break
    }
    case 'shellresult': {
      petSendIde({ type: 'state', state: 'thinking' }, e.raw)
      const command =
        (typeof e.raw?.command === 'string' && e.raw.command) || e.detail || ''
      const output = extractOutput(e.raw)
      const exitCode = extractExit(e.raw)
      const task = taskFor(e.raw)
      const codeHint =
        typeof exitCode === 'number' ? (exitCode === 0 ? ' ✓' : ` ✗${exitCode}`) : ''
      const outHint = output ? `\n${output}` : ''
      if (command || output) {
        emitActivity(task, 'command', `$ ${command || '命令'}${codeHint}${outHint}`, {
          raw: e.raw
        })
      }
      break
    }
    case 'done': {
      if (e.text) setIdeSummary(trackId, e.text)
      const summary = ideSummaryOf(trackId)
      const task = taskFor(e.raw)
      const status = e.raw?.status
      if (status === 'error' || status === 'aborted') {
        petSendIde(
          {
            type: 'state',
            state: 'error',
            note: summary || (status === 'aborted' ? '任务已中止' : '任务出错')
          },
          e.raw
        )
        emitActivity(
          task,
          'error',
          summary
            ? `${status === 'aborted' ? '已中止' : '出错'}：${summary}`
            : status === 'aborted'
              ? '任务已中止'
              : '任务出错',
          { raw: e.raw }
        )
        break
      }
      if (looksLikeQuestion(summary)) {
        petSendIde(
          { type: 'state', state: 'waiting', note: summary || '等你回复' },
          e.raw
        )
        emitActivity(task, 'wait', summary || '等你回复', { raw: e.raw })
        notifyWaiting(task, undefined, { ideTrackId: trackId })
      } else {
        petSendIde({ type: 'done', result: summary || undefined }, e.raw)
        emitActivity(task, 'done', summary ? `完成：${summary}` : '任务完成', {
          raw: e.raw
        })
        notifyDone(task, undefined, undefined, { ideTrackId: trackId })
        setIdeSummary(trackId, '')
      }
      break
    }
    case 'waiting': {
      const task = taskFor(e.raw)
      const text = e.text || extractTextLoose(e.raw) || ideSummaryOf(trackId)
      if (text) setIdeSummary(trackId, text)
      petSendIde({ type: 'state', state: 'waiting', note: text || '等你回复' }, e.raw)
      emitActivity(task, 'wait', text || '等你回复', { raw: e.raw })
      notifyWaiting(task, text || 'Agent 在等你回复', { ideTrackId: trackId })
      break
    }
  }
}

function describeTool(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const name = raw.tool_name ?? raw.toolName ?? raw.name
  const input = raw.tool_input ?? raw.arguments ?? raw.input
  if (typeof raw.command === 'string' && raw.command.trim()) {
    return `${name || 'Shell'}: $ ${raw.command.replace(/\s+/g, ' ').trim()}`
  }
  if (input && typeof input === 'object') {
    const cmd = (input as any).command
    const path = (input as any).path ?? (input as any).file_path ?? (input as any).filePath
    const q = (input as any).query ?? (input as any).pattern
    if (typeof cmd === 'string') return `${name || 'Shell'}: $ ${cmd.replace(/\s+/g, ' ').trim()}`
    if (typeof path === 'string') return `${name || '工具'}: ${path}`
    if (typeof q === 'string') return `${name || '搜索'}: ${q}`
  }
  if (typeof name === 'string') return name
  return undefined
}

function extractTextLoose(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw.text ?? raw.thought ?? raw.content
  if (typeof t === 'string' && t.trim()) {
    return t.replace(/\s+/g, ' ').trim()
  }
  return undefined
}

function flushPendingApprovals(decision: ApprovalDecision = 'allow'): void {
  for (const [id, p] of pendingApprovals) {
    clearTimeout(p.timer)
    emitPermissionLog({
      id,
      at: Date.now(),
      source: 'ide',
      kind: p.logKind,
      summary: p.summary,
      decision: decision === 'allow' ? 'auto' : decision
    })
    p.resolve(decision)
    resolveApprovalUI(id)
  }
  pendingApprovals.clear()
}

/** hook 必须回 allow，否则 IDE agent 卡在 beforeShellExecution。审批卡已去掉。 */
async function handleApproval(reqIn: { kind: string; content: string; raw: any }): Promise<ApprovalDecision> {
  const task = taskFor(reqIn.raw)
  const firstLine = (reqIn.content || '').split('\n')[0].trim()
  const toolName = String(reqIn.raw?.tool_name ?? reqIn.raw?.toolName ?? '')
  const uiKind: ApprovalRequest['kind'] =
    reqIn.kind === 'mcp'
      ? 'mcp'
      : reqIn.kind === 'tool' || /^(apply_patch|Write|Edit|MultiEdit)$/i.test(toolName)
        ? 'tool'
        : 'shell'
  const logKind: PermissionLogEntry['kind'] =
    uiKind === 'mcp' ? 'mcp' : uiKind === 'tool' ? 'tool' : 'shell'
  if (firstLine) emitActivity(task, 'command', `即将执行：${firstLine}`, { raw: reqIn.raw })
  emitPermissionLog({
    id: `auto-${Date.now().toString(36)}`,
    at: Date.now(),
    source: 'ide',
    kind: logKind,
    summary: firstLine || reqIn.kind,
    decision: 'auto'
  })
  return 'allow'
}

/** 通知宠物窗 + 对话窗清掉该审批。 */
function resolveApprovalUI(id: string): void {
  getPetWindow()?.webContents.send(IPC.approvalResolved, id)
  getChatWindow()?.webContents.send(IPC.approvalResolved, id)
}

function extractOutput(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw.output ?? raw.stdout ?? raw.result ?? raw.stderr ?? raw.tool_output
  if (v == null) return undefined
  let s = typeof v === 'string' ? v : ''
  if (!s && typeof v === 'object') {
    try {
      s = JSON.stringify(v)
    } catch {
      return undefined
    }
  }
  // tool_output 常是 JSON 字符串，尽量抽出可读字段
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const j = JSON.parse(s)
      const nested =
        j.stdout ?? j.output ?? j.content ?? j.result ?? j.message ?? j.text
      if (typeof nested === 'string' && nested.trim()) s = nested
      else if (typeof j.exitCode === 'number') {
        s = j.stdout || j.stderr || `exit ${j.exitCode}`
      }
    } catch {
      // keep raw
    }
  }
  s = String(s).replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  return s
}

function extractToolResult(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const fromOut = extractOutput(raw)
  if (fromOut) return fromOut
  // 编辑类：展示完整文件路径
  const path =
    raw.file_path ??
    raw.filePath ??
    raw.tool_input?.path ??
    raw.tool_input?.file_path
  if (typeof path === 'string' && path.trim()) {
    return `已写入 ${path}`
  }
  return undefined
}

function extractExit(raw: any): number | undefined {
  const v = raw?.exit_code ?? raw?.exitCode ?? raw?.code
  return typeof v === 'number' ? v : undefined
}

/** 判断 agent 收尾文本是不是在向你提问 / 让你选择。 */
function looksLikeQuestion(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  if (/[?？]\s*$/.test(t)) return true
  return /请(选择|确认|回复|告诉我|决定|提供)|需要你|要不要|是否|哪一?个|哪种|你想|which|choose|confirm\??$/i.test(
    t
  )
}

function openChatToConversation(conversationId?: string, focusComposer = false): void {
  openChat()
  if (!conversationId) return
  dismissOpsForConversation(conversationId)
  getChatWindow()?.webContents.send(IPC.openPanel, {
    panel: 'chat',
    conversationId,
    focusComposer: focusComposer || undefined
  })
}

/** macOS `open -a` / bundle / AppleScript 激活；失败才换下一个。 */
function openIdeApp(name: string): void {
  const { names, bundles } = ideLaunchPlan(name)
  if (process.platform === 'darwin') {
    const steps: string[][] = [
      ...names.map((n) => ['-a', n]),
      ...bundles.map((b) => ['-b', b]),
      ...names.map((n) => ['-a', `${n}.app`])
    ]
    const tryNext = (i: number): void => {
      if (i >= steps.length) {
        const app = names[0]
        if (app) {
          spawn('/usr/bin/osascript', ['-e', `tell application "${app}" to activate`], {
            detached: true,
            stdio: 'ignore'
          }).unref()
        }
        return
      }
      const child = spawn('/usr/bin/open', steps[i], {
        detached: true,
        stdio: 'ignore'
      })
      child.once('error', () => tryNext(i + 1))
      child.once('exit', (code) => {
        if (code && code !== 0) {
          tryNext(i + 1)
          return
        }
        const app = names[0]
        if (app) {
          spawn('/usr/bin/osascript', ['-e', `tell application "${app}" to activate`], {
            detached: true,
            stdio: 'ignore'
          }).unref()
        }
      })
      child.unref()
    }
    tryNext(0)
    return
  }
  void shell.openPath(names[0] || 'Cursor').catch(() => undefined)
}

function applyPresenceOpenResult(result: PresenceOpenResult): void {
  if (result.kind === 'app') {
    openIdeApp(result.name)
    return
  }
  if (result.target.panel === 'skins') {
    openSkins()
    return
  }
  openChat()
  getChatWindow()?.webContents.send(IPC.openPanel, result.target)
}

function presenceIdeApp(trackId?: string): string | undefined {
  if (!trackId) return undefined
  return convPresence.get(trackId)?.ideApp
}

/** 通知点击：有续查绑定 → CPET 对话；纯 IDE 轨 → 唤起 Cursor；否则按 conversationId。 */
function openNotifyTarget(opts: {
  conversationId?: string
  ideTrackId?: string
  focusComposer?: boolean
}): void {
  showPet({ focus: true })
  const trackOrCid = opts.ideTrackId || opts.conversationId
  applyPresenceOpenResult(
    resolvePresenceOpen(
      {
        conversationId: trackOrCid,
        panel: 'chat',
        focusComposer: opts.focusComposer,
        ideApp: presenceIdeApp(trackOrCid)
      },
      ideContinueBindings
    )
  )
}

function notifyWaiting(
  task?: TaskTag,
  bodyOverride?: string,
  link?: { conversationId?: string; ideTrackId?: string }
): void {
  const now = Date.now()
  if (now - lastDoneNotifyAt < 3000) return
  lastDoneNotifyAt = now
  if (!Notification.isSupported()) return
  const tag = task ? `${task.emoji} ${task.label} · ` : ''
  const body =
    bodyOverride ||
    (link?.ideTrackId ? ideSummaryOf(link.ideTrackId) : '') ||
    'Agent 在等你回复'
  const n = new Notification({ title: uiText("🕐 {0}等你回复", [tag]), body, silent: false })
  n.on('click', () => {
    openNotifyTarget({ ...link, focusComposer: true })
  })
  n.show()
}

function notifyDone(
  task?: TaskTag,
  bodyOverride?: string,
  titleOverride?: string,
  link?: { conversationId?: string; ideTrackId?: string }
): void {
  const now = Date.now()
  if (now - lastDoneNotifyAt < 3000) return
  lastDoneNotifyAt = now
  if (!Notification.isSupported()) return
  const tag = task ? `${task.emoji} ${task.label} · ` : ''
  const body =
    bodyOverride ||
    (link?.ideTrackId ? ideSummaryOf(link.ideTrackId) : '') ||
    '任务跑完啦，来看看吧'
  if (link?.ideTrackId) setIdeSummary(link.ideTrackId, '')
  const n = new Notification({
    title: titleOverride || `🐾 ${tag}任务完成`,
    body,
    silent: false
  })
  n.on('click', () => {
    openNotifyTarget({ ...link, focusComposer: false })
  })
  n.show()
}

/** 打开设置并滚到指定锚点（默认上手/安装助手，勿默认滚到最底「关于」）。 */
function openSettingsSection(section = 'settings-setup'): void {
  openChat()
  getChatWindow()?.webContents.send(IPC.openPanel, { panel: 'settings', section })
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate(process.platform, () => openSettingsSection('settings-about'))))
}

/** 把已缓存的「有新版」推给对话窗（窗口晚开 / 从托盘再打开时不丢）。 */
function pushPendingUpdateToChat(): void {
  const result = getLastUpdateResult()
  if (result?.status !== 'update-available' || !result.latest) return
  const win = getChatWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.updateAvailable, result)
}

/** 发现新版本：始终推顶部横幅；系统通知同一版本只弹一次。 */
function notifyUpdateAvailable(result: UpdateCheckResult): void {
  createTray()
  getChatWindow()?.webContents.send(IPC.updateAvailable, result)
  if (
    !shouldNotifyUpdate({
      status: result.status,
      latest: result.latest,
      seenVersion: getSettings().updateNoticeSeenVersion
    })
  ) {
    return
  }
  updateSettings({ updateNoticeSeenVersion: result.latest })
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: uiText("🐾 CPET {0} 可以更新了", [result.latest]),
    body: `当前 ${result.current}。点这里打开对话窗，用顶栏「更新」按钮下载。`,
    silent: true
  })
  n.on('click', () => {
    openChat()
    getChatWindow()?.webContents.send(IPC.updateAvailable, result)
  })
  n.show()
}

function setPetMood(mood: PetMood): void {
  getPetWindow()?.webContents.send(IPC.petMood, mood)
}

function sendPetAction(action: string): void {
  getPetWindow()?.webContents.send(IPC.petAction, action)
}

/** 皮肤变更同步到宠物窗 + 对话窗（对话里助手头像跟随皮肤）。 */
function broadcastSkinEvent(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload)
    } catch {
      // ignore destroyed windows
    }
  }
}

function applySkin(skin: SkinId): void {
  // 切矢量时清掉图片包，避免只调 setSkin 时 imageSkin 残留把矢量盖住
  const hadImage = !!getSettings().imageSkin
  updateSettings({ skin, ...(hadImage ? { imageSkin: undefined } : {}) })
  if (hadImage) broadcastSkinEvent(IPC.petImageSkin, null)
  broadcastSkinEvent(IPC.petSkin, skin)
  createTray() // 刷新托盘菜单里的选中态
}

function applyImageSkin(id: string | null): void {
  if (!id) {
    updateSettings({ imageSkin: undefined })
    broadcastSkinEvent(IPC.petImageSkin, null)
    createTray()
    return
  }
  const loaded = loadImageSkin(id)
  if (!loaded) return
  updateSettings({ imageSkin: id })
  broadcastSkinEvent(IPC.petImageSkin, loaded)
  createTray()
}

/** 右键 / 托盘：已安装快切；管理/下载进皮肤市场。 */
function skinMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const s = getSettings()
  const usingImage = !!s.imageSkin
  const vectorItems: Electron.MenuItemConstructorOptions[] = SKINS.map((sk) => ({
    label: sk.name,
    type: 'radio' as const,
    checked: !usingImage && sk.id === s.skin,
    click: () => {
      applyImageSkin(null)
      applySkin(sk.id)
    }
  }))

  const packs = listImagePacks()
  const imageItems: Electron.MenuItemConstructorOptions[] = packs.length
    ? packs.map((p) => ({
        label: p.name,
        type: 'radio' as const,
        checked: usingImage && s.imageSkin === p.id,
        click: () => applyImageSkin(p.id)
      }))
    : [{ label: uiText("(尚未安装图片皮肤)"), enabled: false }]

  return [
    { label: uiText("矢量皮肤"), enabled: false },
    ...vectorItems,
    { type: 'separator' },
    { label: uiText("图片皮肤"), enabled: false },
    ...imageItems,
    { type: 'separator' },
    { label: uiText("皮肤市场…"), click: () => openSkins() },
    { label: uiText("打开皮肤目录…"), click: () => void openSkinsLocation() },
    { label: uiText("刷新列表"), click: () => createTray() }
  ]
}

function showPetContextMenu(): void {
  const pet = getPetWindow()
  if (!pet) return
  const hooksOk = getSetupStatus().hooksInstalled
  const menu = Menu.buildFromTemplate([
    { label: uiText("打开对话"), click: () => openChat() },
    {
      label: uiText("定时任务"),
      click: () => {
        openChat()
        getChatWindow()?.webContents.send(IPC.openSchedules)
      }
    },
    {
      label: uiText("设置…"),
      click: () => openSettingsSection('settings-setup')
    },
    { type: 'separator' },
    { label: uiText("连续表演"), click: () => sendPetAction('combo') },
    { label: uiText("换皮肤"), submenu: skinMenuTemplate() },
    { type: 'separator' },
    { label: uiText("摸摸它"), click: () => setPetMood('petted') },
    { label: uiText("让它睡觉"), click: () => setPetMood('sleeping') },
    { type: 'separator' },
    {
      label: hooksOk ? '引擎联动（重新配置）' : '配置引擎联动…',
      click: () => runFirstRunSetup(true)
    },
    ...(hooksOk
      ? [{ label: uiText("移除引擎联动"), click: () => uninstallHooks() && createTray() }]
      : []),
    { type: 'separator' },
    { label: uiText("隐藏宠物"), click: () => pet.hide() },
    { label: uiText("退出 CPET"), click: () => app.quit() }
  ])
  menu.popup({ window: pet })
}

function buildTrayMenu(): Electron.Menu {
  const scheduleCount = scheduler?.list().filter((t) => t.enabled).length ?? 0
  const hookAge = lastHookAt ? Math.round((Date.now() - lastHookAt) / 1000) : null
  const setupNow = getSetupStatus()
  const linkLabel =
    setupNow.codex && setupNow.codexTrusted === false
      ? uiText('修复引擎联动（Codex 未信任）')
      : hookAge != null && hookAge < 120
        ? uiText('引擎联动 ✓（{0}s 前）', [hookAge])
        : setupNow.hooksInstalled
          ? uiText('引擎联动（等待 IDE 事件…）')
          : uiText('修复引擎联动')
  const pendingUpdate = getLastUpdateResult()
  const updateItems: Electron.MenuItemConstructorOptions[] =
    pendingUpdate?.status === 'update-available'
      ? [
          {
            label: uiText("↑ 有新版本 {0}", [pendingUpdate.latest]),
            click: () => openSettingsSection('settings-about')
          },
          {
            label: pendingUpdate.downloadUrl
              ? `下载 ${pendingUpdate.latest}…`
              : '打开下载页…',
            click: () => {
              const url = pendingUpdate.downloadUrl || pendingUpdate.releasesUrl
              if (url) void shell.openExternal(url)
              else openSettingsSection('settings-about')
            }
          },
          { type: 'separator' }
        ]
      : []
  return Menu.buildFromTemplate([
    ...updateItems,
    { label: uiText("打开对话"), click: () => openChat() },
    {
      label: scheduleCount ? uiText('定时任务（{0}）', [scheduleCount]) : uiText('定时任务'),
      click: () => {
        openChat()
        getChatWindow()?.webContents.send(IPC.openSchedules)
      }
    },
    {
      label: uiText("设置…"),
      click: () => openSettingsSection('settings-setup')
    },
    { type: 'separator' },
    { label: uiText("换皮肤"), submenu: skinMenuTemplate() },
    {
      label: uiText("显示 / 隐藏宠物"),
      click: () => {
        const pet = getPetWindow()
        if (!pet) return createPetWindow()
        pet.isVisible() ? pet.hide() : showPet({ focus: true })
      }
    },
    { type: 'separator' },
    {
      label: linkLabel,
      click: async () => {
        const r = ensureHooksFresh()
        if (!r.ok) {
          dialog.showMessageBox({ type: 'error', message: uiText("联动修复失败"), detail: r.error })
          return
        }
        if (r.upgraded) createTray()
        const hookTrust = await trustCodexPetHooks()
        createTray()
        if (!hookTrust.ok && hookTrust.error && hookTrust.error !== 'no-codex-bin') {
          dialog.showMessageBox({
            type: 'warning',
            message: uiText("Codex hooks 已安装，但信任写入失败"),
            detail: uiText("{0}\n可在 ChatGPT → Settings → Hooks 里手动 Trust CPET 相关钩子，然后重启 ChatGPT。", [hookTrust.error])
          })
          return
        }
        if (hookTrust.ok && hookTrust.trusted > 0) {
          dialog.showMessageBox({
            type: 'info',
            message: uiText("Codex（ChatGPT）hooks 已信任"),
            detail: uiText("已确认 {0} 个 CPET hooks。若 ChatGPT 正在运行，请完全退出后重开再试任务联动。", [hookTrust.trusted])
          })
          return
        }
        runFirstRunSetup(true)
      }
    },
    { type: 'separator' },
    { label: uiText("退出 CPET"), click: () => app.quit() }
  ])
}

/** 单例托盘：只创建一次；后续调用仅刷新菜单，避免图标泄漏/重复。 */
function createTray(): void {
  if (!tray) {
    const image = nativeImage
      .createFromPath(resourcePath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'))
      .resize({ width: 18, height: 18 })
    if (process.platform === 'darwin') image.setTemplateImage(true)
    tray = new Tray(image)
    tray.setToolTip('CPET · 桌面宠物')
    tray.on('click', () => openChat())
  }
  tray.setContextMenu(buildTrayMenu())
}

async function runFirstRunSetup(force = false): Promise<void> {
  const status = getSetupStatus()
  if (!force && (status.hooksInstalled || getSettings().setupPromptShown)) return
  updateSettings({ setupPromptShown: true })

  // 目标分流：多数人只要「宠物跟 IDE」，少数人才要「窗口里真对话」
  if (!force) {
    const goal = await dialog.showMessageBox({
      type: 'question',
      title: uiText("欢迎使用 CPET"),
      message: uiText("你更想先达成哪件事？"),
      detail:
        'A · 宠物跟着 Cursor IDE 动（推荐）\n' +
        '只装 Cursor 应用 → 配置联动 → 在 IDE 里跑 Agent，桌宠会动、完成会通知。\n' +
        '不需要 cursor-agent CLI。\n\n' +
        'B · 在本窗口用多引擎真实对话\n' +
        '需要本机 Agent CLI 或自定义 API，并选好项目目录。\n\n' +
        '可随时在设置里改。',
      buttons: ['A · 跟 IDE（推荐）', 'B · 窗口对话', '以后再说'],
      defaultId: 0,
      cancelId: 2
    })
    if (goal.response === 2) {
      updateSettings({ onboardingGoal: 'skipped' })
      return
    }
    if (goal.response === 1) {
      updateSettings({ onboardingGoal: 'chat' })
      openSettingsSection('settings-setup')
      const agent = await getAgentStatus()
      if (!agent.anyAgentInstalled && !agent.installed) {
        const res = await dialog.showMessageBox({
          type: 'info',
          title: uiText("窗口对话需要引擎"),
          message: uiText("本机还没有可用的 Agent CLI。"),
          detail:
            '可在设置里配置 OpenClaw / Claude / Codex / 自定义 API；\n' +
            '或安装 cursor-agent（≠ Cursor 应用）并再登录一次。\n\n' +
            '现在安装 cursor-agent 吗？',
          buttons: ['先去设置', '安装 cursor-agent'],
          defaultId: 0,
          cancelId: 0
        })
        if (res.response === 1) {
          runInstallAgent((ok, log) => {
            clearAgentStatusCache()
            createTray()
            dialog.showMessageBox({
              type: ok ? 'info' : 'error',
              message: ok ? 'cursor-agent 已安装' : '安装失败',
              detail: log?.slice(-800) || undefined
            })
          })
        }
      }
      return
    }
    updateSettings({ onboardingGoal: 'ide' })
  }

  if (!status.hooksInstalled || force) {
    const res = await dialog.showMessageBox({
      type: 'question',
      title: uiText("配置 IDE 联动"),
      message: force ? '重新配置 IDE 联动？' : '配置联动，让宠物跟着 IDE 动。',
      detail:
        '将写入 Cursor / Claude / Codex 的 hook（保留你已有配置）。\n' +
        '这不需要单独安装 cursor-agent，也不用再登录一次。',
      buttons: force ? ['配置联动', '取消'] : ['现在配置', '以后再说'],
      defaultId: 0,
      cancelId: 1
    })
    if (res.response !== 0) return
    const r = installHooks()
    createTray()
    if (!r.ok) {
      dialog.showMessageBox({ type: 'error', message: uiText("配置失败"), detail: r.error })
      return
    }
    // Codex 信任门禁：必须等写入并回读，禁止「已配置」假绿
    const trust = await trustCodexPetHooks()
    createTray()
    if (trust.error === 'no-codex-bin') {
      // 本机无 ChatGPT/Codex CLI 时跳过，Cursor/Claude 联动仍可用
    } else if (!trust.ok) {
      dialog.showMessageBox({
        type: 'warning',
        message: uiText("Cursor/Claude 联动已写入，但 Codex（ChatGPT）hooks 尚未信任"),
        detail:
          `${trust.error || 'trust-failed'}\n\n` +
          '未信任时 ChatGPT 会静默跳过 CPET hooks，宠物不会跟态。\n' +
          '可再点托盘「修复引擎联动」，或在 ChatGPT → Settings → Hooks 里 Trust CPET 钩子后重启 ChatGPT。'
      })
    } else if (trust.trusted > 0) {
      dialog.showMessageBox({
        type: 'info',
        message: uiText("IDE 联动已配置"),
        detail:
          `Codex（ChatGPT）已信任 ${trust.trusted} 个 CPET hooks。\n\n` +
          '重要：请完全退出 ChatGPT（菜单栏图标也要退出，不要只关窗口），再重新打开。\n' +
          'app-server 不热加载 hooks；不重启会表现为「设置里已挂、宠物完全不动」。\n' +
          '然后在 ChatGPT 里跑一个会用工具的任务验证跟态。'
      })
    }
  }

  if (force) {
    const agent = await getAgentStatus()
    if (!agent.installed) {
      const res = await dialog.showMessageBox({
        type: 'info',
        title: uiText("联动已就绪（可选下一步）"),
        message: uiText("在 Cursor 里用 Agent 时，宠物已经可以跟着动了。"),
        detail:
          '可选：若还想在 CPET 对话窗里直接用「Cursor 引擎」发消息，才需要额外安装 cursor-agent CLI（和 Cursor 应用不是同一个东西），并再登录一次。\n\n' +
          '也可以在对话里换 OpenClaw / Claude Code / Codex / 自定义 API，不必装 cursor-agent。\n\n' +
          '现在要安装 cursor-agent 吗？',
        buttons: ['跳过，先这样用', '安装 cursor-agent'],
        defaultId: 0,
        cancelId: 0
      })
      if (res.response === 1) {
        runInstallAgent((ok, log) => {
          clearAgentStatusCache()
          if (ok) {
            dialog
              .showMessageBox({
                type: 'info',
                message: uiText("cursor-agent 安装完成 ✓"),
                detail: uiText("这是独立 CLI，还需登录一次（会打开浏览器授权）。"),
                buttons: ['去登录', '稍后']
              })
              .then((r) => {
                if (r.response === 0) agentLogin()
              })
          } else {
            dialog.showMessageBox({
              type: 'error',
              message: uiText("cursor-agent 安装失败"),
              detail:
                (log || '').slice(-800) +
                '\n\n可在终端手动安装：curl https://cursor.com/install -fsS | bash'
            })
          }
        })
      }
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: uiText("完成"),
        message: uiText("IDE 联动已配置 ✓"),
        detail: uiText("在 Cursor 里跑 Agent 时，宠物会实时反应；任务完成会通知你。")
      })
    }
  } else {
    dialog.showMessageBox({
      type: 'info',
      title: uiText("完成"),
      message: uiText("IDE 联动已配置 ✓"),
      detail:
        '在 Cursor 里跑 Agent 时，宠物会实时反应；任务完成会通知你。\n' +
        '若还要在本窗口真实对话，打开设置配置引擎或安装 CLI。'
    })
  }
}

/** 选目录对话框起点：优先调用方传入，其次设置里的 cwd；路径不存在则向上找父目录。 */
function resolveWorkingDirDialogStart(preferred?: string): string | undefined {
  const candidates = [preferred, getSettings().cwd]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
  for (const raw of candidates) {
    let p = raw
    for (let i = 0; i < 10 && p; i++) {
      if (existsSync(p)) {
        try {
          return realpathSync(p)
        } catch {
          return p
        }
      }
      const parent = dirname(p)
      if (!parent || parent === p) break
      p = parent
    }
  }
  return undefined
}

function currentUiLanguage(): UiLanguageState {
  const preference = normalizeUiLanguage(getSettings().uiLanguage)
  const system = app.getPreferredSystemLanguages?.()[0] || app.getLocale()
  return { preference, locale: resolveUiLocale(preference, system) }
}

function registerIpc(): void {
  setUiLocale(currentUiLanguage().locale)
  installApplicationMenu()
  ipcMain.handle(IPC.getUiLanguage, () => currentUiLanguage())
  ipcMain.handle(IPC.setUiLanguage, (_event, preference: unknown) => {
    if (preference === 'system' || preference === 'zh-CN' || preference === 'en') {
      updateSettings({ uiLanguage: preference })
    }
    const language = currentUiLanguage()
    setUiLocale(language.locale)
    installApplicationMenu()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.uiLanguageChanged, language)
    }
    createTray()
    return language
  })
  ipcMain.handle(IPC.getAgentStatus, () => getAgentStatus())

  ipcMain.handle(IPC.pickWorkingDir, async (_e, preferred?: string) => {
    const start = resolveWorkingDirDialogStart(
      typeof preferred === 'string' ? preferred : undefined
    )
    // Library/Application Support 等默认隐藏；不开 showHiddenFiles 时 macOS 会丢弃
    // defaultPath 并落到「文稿/下载」。
    // 也不要挂到 chat 窗做 sheet：新建任务 HTML 遮罩开着时，sheet 同样常丢掉
    // ~/Library/... 下的 defaultPath（看起来像从「个人收藏」重开）。
    const opts: Electron.OpenDialogOptions = {
      title: start ? `选择目录（当前：${start}）` : '选择工作目录',
      properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'],
      ...(start ? { defaultPath: start } : {})
    }
    const result = await dialog.showOpenDialog(opts)
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle(IPC.getSettings, () => {
    const s = getSettings()
    return { ...s, userAvatar: resolveUserAvatarDisplay(s.userAvatar) ?? s.userAvatar }
  })
  ipcMain.handle(IPC.getAppInfo, () => {
    const repoUrl = getRepoUrl()
    return {
      name: app.getName() === 'cursor-pet' ? 'CPET' : app.getName() || 'CPET',
      version: app.getVersion(),
      author: STUDIO_NAME,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      releasesUrl: getReleasesUrl(),
      repoUrl,
      feedbackUrl: feedbackIssuesUrl(repoUrl)
    }
  })
  ipcMain.handle(IPC.checkForUpdate, async () => {
    const result = await checkForUpdate()
    // 设置里手动检查也要同步顶栏提醒（不只写 lastResult）
    getChatWindow()?.webContents.send(IPC.updateAvailable, result)
    return result
  })
  ipcMain.handle(IPC.getLastUpdateResult, () => getLastUpdateResult())
  ipcMain.on(IPC.dismissUpdateBanner, (_e, version: string) => {
    dismissUpdateBanner(String(version || ''))
  })
  ipcMain.handle(IPC.getImagePacks, () => listImagePacks())
  ipcMain.handle(IPC.listLocalSkinPacks, () => listLocalSkinPacks())
  ipcMain.handle(IPC.getImageSkin, () => {
    const id = getSettings().imageSkin
    return id ? loadImageSkin(id) : null
  })
  ipcMain.handle(IPC.getSkinsDir, () => getSkinsDir())
  ipcMain.on(IPC.setImageSkin, (_e, id: string | null) => applyImageSkin(id))
  ipcMain.on(IPC.openSkinsDir, () => {
    void openSkinsLocation()
  })
  ipcMain.handle(IPC.fetchSkinMarket, () => fetchSkinMarket())
  ipcMain.handle(IPC.downloadSkinPack, async (_e, payload) => {
    const r = await downloadAndInstallSkin({
      id: String(payload?.id ?? ''),
      packUrl: String(payload?.packUrl ?? ''),
      sha256: typeof payload?.sha256 === 'string' ? payload.sha256 : undefined
    })
    if (r.ok) createTray()
    return r
  })
  ipcMain.handle(IPC.uninstallSkinPack, (_e, id: string) => {
    const packId = String(id || '')
    if (getSettings().imageSkin === packId) applyImageSkin(null)
    const r = uninstallImagePack(packId)
    if (r.ok) createTray()
    return r
  })
  ipcMain.handle(IPC.importSkinPack, async () => {
    const r = await importSkinPackDialog(getChatWindow())
    if (r.ok) createTray()
    return r
  })
  ipcMain.handle(IPC.exportSkinPack, (_e, id: string) =>
    exportSkinPackDialog(String(id || ''), getChatWindow())
  )
  ipcMain.handle(IPC.prepareSkinMarketSubmission, (_e, id: string) =>
    prepareSkinMarketSubmission(String(id || ''), {
      issueUrl: feedbackIssuesUrl(getRepoUrl()),
      parent: getChatWindow() ?? getSkinsWindow()
    })
  )
  ipcMain.on(IPC.setSkin, (_e, skin: SkinId) => applySkin(skin))
  ipcMain.on(IPC.setCwd, (_e, cwd: string) => {
    if (typeof cwd !== 'string' || !cwd.trim()) return
    if (!isSafeAgentCwd(cwd, homedir())) return
    updateSettings({ cwd: cwd.trim() })
    rememberProjectCwd(cwd.trim())
  })
  ipcMain.on(IPC.setUserAvatar, (_e, emoji: string) => {
    const e = typeof emoji === 'string' ? sanitizeUserAvatar(emoji) : ''
    if (!e) return
    clearUserAvatarImage()
    updateSettings({ userAvatar: e })
  })
  ipcMain.handle(IPC.pickUserAvatarImage, () => pickUserAvatarImage())
  function broadcastChatTheme(): void {
    const s = getSettings()
    const theme = isChatThemeId(s.chatTheme) ? s.chatTheme : DEFAULT_CHAT_THEME
    const custom = normalizeChatThemeCustom(s.chatThemeCustom)
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(IPC.chatTheme, { theme, custom })
    }
  }
  ipcMain.on(IPC.setChatTheme, (_e, theme: string) => {
    if (!isChatThemeId(theme)) return
    updateSettings({ chatTheme: theme })
    broadcastChatTheme()
  })
  ipcMain.on(IPC.setChatThemeCustom, (_e, custom: ChatThemeCustom) => {
    updateSettings({ chatThemeCustom: normalizeChatThemeCustom(custom) })
    broadcastChatTheme()
  })
  ipcMain.on(IPC.setWeatherCity, (_e, city: string) => {
    const next = typeof city === 'string' ? city.trim().slice(0, 64) : ''
    updateSettings({
      weatherCity: next || undefined,
      weatherCityPrompted: true
    })
    clearWeatherCache()
  })
  ipcMain.on(IPC.setWeatherCityPrompted, (_e, prompted: boolean) => {
    updateSettings({ weatherCityPrompted: !!prompted })
  })
  ipcMain.on(IPC.setBriefOnboardingPrompted, (_e, prompted: boolean) => {
    updateSettings({ briefOnboardingPrompted: !!prompted })
  })
  ipcMain.on(IPC.setNewsSource, (_e, source: NewsSourceId) => {
    if (!isNewsSourceId(source)) return
    updateSettings({ newsSource: source })
    void refreshBriefInbox(true)
  })
  ipcMain.on(IPC.setBriefRssFeeds, (_e, raw: unknown) => {
    const urls = normalizeRssFeedUrls(raw)
    updateSettings({ briefRssFeeds: urls })
    void refreshBriefInbox(true)
  })
  ipcMain.on(IPC.setBriefInterestKeywords, (_e, raw: unknown) => {
    const keywords = normalizeInterestKeywords(raw)
    updateSettings({ briefInterestKeywords: keywords })
    // 立刻重算未读并回显（避免旧噪音角标继续挂着）
    briefReapplyFilters()
  })
  ipcMain.on(IPC.setBriefMuteKeywords, (_e, raw: unknown) => {
    const keywords = normalizeInterestKeywords(raw)
    updateSettings({ briefMuteKeywords: keywords })
    briefReapplyFilters()
  })
  ipcMain.on(IPC.setRssScoreModelRef, (_e, ref: unknown) => {
    updateSettings({
      rssScoreModelRef: typeof ref === 'string' ? ref.trim() : ''
    })
  })
  ipcMain.on(IPC.setRssScoreMode, (_e, mode: unknown) => {
    updateSettings({
      rssScoreMode:
        mode === 'interval' || mode === 'off' || mode === 'realtime' ? mode : 'realtime'
    })
  })
  ipcMain.on(IPC.setRssOrganizeLang, (_e, raw: unknown) => {
    updateSettings({ rssOrganizeLang: normalizeRssOrganizeLang(raw) })
  })
  ipcMain.on(IPC.setRssScoreIntervalMinutes, (_e, raw: unknown) => {
    const n = typeof raw === 'number' ? raw : Number(raw)
    updateSettings({
      rssScoreIntervalMinutes: Number.isFinite(n) ? Math.max(5, Math.min(24 * 60, Math.round(n))) : 30
    })
  })
  ipcMain.on(IPC.setRssPetPushMinScore, (_e, raw: unknown) => {
    updateSettings({ rssPetPushMinScore: normalizeRssPetPushMinScore(raw) })
  })
  ipcMain.on(IPC.setRssPaneWidths, (_e, raw: unknown) => {
    updateSettings({ rssPaneWidths: normalizeRssPaneWidths(raw) })
  })
  ipcMain.on(IPC.setBriefDailyDigestHours, (_e, raw: unknown) => {
    const hours = normalizeBriefDailyDigestHours(raw)
    updateSettings({
      briefDailyDigestHours: hours,
      briefDailyDigestHour: undefined,
      ...(hours?.length ? { briefDigestIntervalHours: undefined } : {})
    })
  })
  ipcMain.on(IPC.setBriefDailyDigestHour, (_e, raw: unknown) => {
    const one = normalizeBriefDailyDigestHour(raw)
    updateSettings({
      briefDailyDigestHours: one == null ? null : [one],
      briefDailyDigestHour: undefined,
      ...(one != null ? { briefDigestIntervalHours: undefined } : {})
    })
  })
  ipcMain.on(IPC.setBriefDigestIntervalHours, (_e, raw: unknown) => {
    const hours =
      raw === null || raw === undefined || raw === ''
        ? undefined
        : normalizeRssDigestIntervalHours(raw)
    updateSettings({
      briefDigestIntervalHours: hours,
      briefDailyDigestHour: undefined,
      ...(hours != null ? { briefDailyDigestHours: null } : {})
    })
  })
  ipcMain.on(IPC.setSidebarCollapsed, (_e, collapsed: boolean) => {
    updateSettings({ sidebarCollapsed: !!collapsed })
  })
  ipcMain.on(IPC.setShowReasoning, (_e, show: boolean) => {
    // 与「过程」开关共用：两键同写，避免 true&&false 中间态
    const on = !!show
    updateSettings({ showReasoning: on, showTools: on })
    getPetWindow()?.webContents.send(IPC.showDetailsChanged, on)
    getChatWindow()?.webContents.send(IPC.showDetailsChanged, on)
  })
  ipcMain.on(IPC.setShowTools, (_e, show: boolean) => {
    const on = !!show
    updateSettings({ showReasoning: on, showTools: on })
    getPetWindow()?.webContents.send(IPC.showDetailsChanged, on)
    getChatWindow()?.webContents.send(IPC.showDetailsChanged, on)
  })
  ipcMain.on(IPC.setAgentBackend, (_e, backend: AgentBackend) => {
    if (!isSupportedBackend(backend)) return
    updateSettings({ agentBackend: backend })
    clearAgentStatusCache()
    createTray()
  })
  ipcMain.on(IPC.setOpenclawAgentId, (_e, id: string) => {
    const agentId = typeof id === 'string' ? id.trim() : ''
    if (!agentId) return
    updateSettings({ openclawAgentId: agentId })
    clearAgentStatusCache()
    createTray()
  })
  ipcMain.handle(IPC.listOpenclawAgents, () => listOpenclawAgents())
  ipcMain.handle(IPC.listSkills, (_e, cwd?: string) => {
    const dir = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined
    return listAgentSkills(dir)
  })
  ipcMain.handle(IPC.listModels, async () => {
    // 返回裸模型 id（勿加 cursor: 前缀）；选择器侧用 formatModelRef 组装。
    const listed = await listCursorModels()
    return listed.map((m) => ({ id: m.id, label: m.label }))
  })
  ipcMain.handle(IPC.listModelCatalog, async () => listModelCatalog())
  ipcMain.on(IPC.setModels, (_e, models: ModelPref[]) => {
    if (!Array.isArray(models)) return
    updateSettings({ models })
  })
  ipcMain.handle(IPC.setModelProviders, (_e, providers: ModelProvider[]) => {
    if (!Array.isArray(providers)) return getSettings().modelProviders ?? []
    const next = ensureBuiltinProviders(providers)
    updateSettings({ modelProviders: next })
    return next
  })
  ipcMain.on(IPC.setDefaultModelRef, (_e, ref: string) => {
    if (typeof ref !== 'string' || !ref.trim()) return
    updateSettings({ defaultModelRef: ref.trim() })
  })
  ipcMain.on(IPC.setDefaultAgentAutonomy, (_e, mode: string) => {
    if (!isAgentAutonomy(mode)) return
    updateSettings({ defaultAgentAutonomy: mode })
  })
  ipcMain.on(IPC.setSkillDelivery, (_e, mode: string) => {
    if (!isSkillDeliveryPref(mode)) return
    updateSettings({ skillDelivery: mode })
  })
  ipcMain.on(IPC.setSystemPrompt, (_e, text: string) => {
    updateSettings({ systemPrompt: typeof text === 'string' ? text : '' })
  })
  ipcMain.on(IPC.setPromptTemplates, (_e, templates: unknown) => {
    updateSettings({
      promptTemplates: normalizePromptTemplates(
        templates as import('../shared/types').PromptTemplate[]
      )
    })
  })
  ipcMain.on(IPC.setQuickChat, (_e, patch: unknown) => {
    updateSettings({
      quickChat: normalizeQuickChatSettings(patch)
    })
    refreshQuickChatHotkey()
  })
  ipcMain.handle(IPC.setAgentMemoryEnabled, (_e, enabled: unknown) => {
    return setAgentMemoryEnabled(enabled === true)
  })
  ipcMain.handle(IPC.getAgentMemoryStats, () => getAgentMemoryStats())
  ipcMain.handle(IPC.clearAgentMemory, () => clearAgentMemoryGraph())
  ipcMain.handle(IPC.ttsSpeak, (e, text: unknown) => speakTts(text, e.sender))
  ipcMain.handle(IPC.ttsSpeakLive, (e, text: unknown) => speakTtsLive(text, e.sender))
  ipcMain.handle(IPC.ttsClaim, (e, opts: unknown) => {
    const o = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {}
    const role =
      o.role === 'pet' || o.role === 'preview' || o.role === 'chat' ? o.role : 'chat'
    const conversationId = typeof o.conversationId === 'string' ? o.conversationId : undefined
    return claimTtsPlayback(e.sender.id, role, conversationId)
  })
  ipcMain.handle(IPC.ttsRelease, (e) => {
    releaseTtsPlayback(e.sender.id)
  })
  ipcMain.handle(IPC.ttsCosyStatus, () => getCosyVoiceStatus())
  ipcMain.handle(IPC.ttsCosyInstall, () => installCosyVoice())
  ipcMain.handle(IPC.ttsCosyPrepareModel, () => prepareCosyVoiceModel())
  ipcMain.handle(IPC.ttsListVoices, () => listTtsVoices())
  ipcMain.handle(IPC.ttsAddVoice, (_e, input: unknown) => {
    const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    return addTtsVoice({
      name: typeof o.name === 'string' ? o.name : '',
      promptWav: typeof o.promptWav === 'string' ? o.promptWav : '',
      promptText: typeof o.promptText === 'string' ? o.promptText : undefined
    })
  })
  ipcMain.handle(IPC.ttsRemoveVoice, (_e, id: unknown) => removeTtsVoice(id))
  ipcMain.handle(IPC.ttsPickPromptWav, () => pickTtsPromptWav())
  ipcMain.handle(IPC.ttsPickCosyRoot, () => pickCosyvoiceRoot())
  ipcMain.on(IPC.setActivePromptTemplateId, (_e, id: string | null) => {
    updateSettings({
      activePromptTemplateId: typeof id === 'string' && id.trim() ? id.trim() : null
    })
  })
  ipcMain.handle(IPC.getHistory, () => getHistory())
  ipcMain.on(IPC.saveHistory, (_e, history: ChatHistory) => saveHistory(history))
  ipcMain.handle(IPC.getChatStore, () => getChatStore())
  ipcMain.on(IPC.saveChatStore, (_e, store: ChatStore) => {
    const merged = reconcileRssOnChatStoreSave(store, getChatStore())
    saveChatStore(merged)
    // 评分/新简报落盘后扫一次重点推送（有冷却，不刷屏）
    scanAndEmitRssPetTips(merged)
    fireDueTodayReminders(merged)
  })
  ipcMain.handle(IPC.confirm, async (e, raw: unknown) => {
    const message = typeof raw === 'string' && raw.trim() ? raw.trim() : '确定？'
    const win = BrowserWindow.fromWebContents(e.sender) ?? getChatWindow()
    const opts = {
      type: 'question' as const,
      buttons: ['取消', '确定'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      message
    }
    const res = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    return res.response === 1
  })
  ipcMain.handle(IPC.getWeather, () => {
    const city = getSettings().weatherCity
    return getWeather(city)
  })
  ipcMain.handle(IPC.refreshWeather, () => {
    clearWeatherCache()
    const city = getSettings().weatherCity
    return getWeather(city)
  })
  ipcMain.handle(IPC.getNews, () => {
    const source = getSettings().newsSource || 'auto'
    return getNews(isNewsSourceId(source) ? source : 'auto')
  })
  ipcMain.handle(IPC.getBriefInbox, () => getBriefInbox())
  ipcMain.handle(IPC.refreshBriefInbox, () => refreshBriefInbox(true))
  ipcMain.on(IPC.previewBriefDigest, () => emitCurrentBriefDigest(true))
  ipcMain.handle(IPC.refreshRssTaskFeeds, (_e, feeds: unknown) => refreshRssTaskFeeds(feeds))
  ipcMain.handle(IPC.fetchRssArticle, (_e, url: unknown, opts: unknown) =>
    fetchRssArticle(
      typeof url === 'string' ? url : '',
      opts && typeof opts === 'object'
        ? (opts as { fallbackHtml?: string })
        : undefined
    )
  )
  ipcMain.handle(IPC.recoverRssArticleWithModel, (_e, payload: unknown) => {
    const p =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    return recoverRssArticleWithModel({
      url: typeof p.url === 'string' ? p.url : '',
      title: typeof p.title === 'string' ? p.title : undefined,
      snippet: typeof p.snippet === 'string' ? p.snippet : undefined,
      contentHtml: typeof p.contentHtml === 'string' ? p.contentHtml : undefined,
      modelRef: typeof p.modelRef === 'string' ? p.modelRef : undefined,
      forceModel: p.forceModel === true
    })
  })
  ipcMain.handle(IPC.discoverRssFeeds, (_e, payload: unknown) =>
    discoverRssFeeds(
      payload && typeof payload === 'object'
        ? (payload as { query?: string; limit?: number; localOnly?: boolean })
        : {}
    )
  )
  ipcMain.handle(IPC.lookupRssFeedMetrics, (_e, payload: unknown) =>
    lookupRssFeedMetrics(
      payload && typeof payload === 'object'
        ? (payload as { urls?: string[]; enrich?: boolean })
        : {}
    )
  )
  ipcMain.handle(IPC.quickChatArm, () => armQuickChat())
  ipcMain.handle(IPC.quickChatArmVoice, (_e, transcript: unknown) =>
    armQuickChatFromVoice(typeof transcript === 'string' ? transcript : '')
  )
  ipcMain.handle(IPC.quickChatSend, (_e, payload: unknown) => {
    const p =
      payload && typeof payload === 'object'
        ? (payload as {
            conversationId?: string
            text?: string
            attachments?: Array<{ path: string; name: string; mime?: string; size?: number }>
          })
        : {}
    const attachments = Array.isArray(p.attachments)
      ? p.attachments.filter(
          (a): a is { path: string; name: string; mime?: string; size?: number } =>
            !!a && typeof a.path === 'string' && typeof a.name === 'string'
        )
      : undefined
    return sendQuickChat({
      conversationId: typeof p.conversationId === 'string' ? p.conversationId : '',
      text: typeof p.text === 'string' ? p.text : '',
      attachments
    })
  })
  ipcMain.on(IPC.quickChatReady, () => notifyQuickChatUiReady())
  setChatWindowClosedHandler(() => notifyQuickChatUiGone())
  ipcMain.handle(IPC.scoreRssEntries, (_e, payload: unknown) =>
    scoreRssEntries(
      payload && typeof payload === 'object'
        ? (payload as {
            entries: import('../shared/rssTask').RssTaskEntry[]
            modelRef?: string
            forceHeuristic?: boolean
          })
        : { entries: [] }
    )
  )
  ipcMain.handle(IPC.buildRssDigestReport, (_e, payload: unknown) =>
    buildRssDigestReport(
      payload && typeof payload === 'object'
        ? (payload as {
            entries: import('../shared/rssTask').RssTaskEntry[]
            windowHours: number
            infoWindow?: string
            modelRef?: string
            forceHeuristic?: boolean
            template?: import('../shared/rssTask').RssDigestTemplate
          })
        : { entries: [], windowHours: 24 }
    )
  )
  ipcMain.handle(IPC.runRssDisposition, async (_e, payload: unknown) => {
    const p =
      payload && typeof payload === 'object'
        ? (payload as {
            conversationId?: string
            feeds?: import('../shared/rssTask').RssTaskFeed[]
            items?: import('../shared/rssTask').RssTaskEntry[]
            bounds?: import('../shared/rssTask').DigestTimeBounds
            entryIds?: string[]
            scoreMin?: number
            modelRef?: string
            template?: import('../shared/rssTask').RssDigestTemplate
            focusPrompt?: string
            refresh?: boolean
            scoreUnscored?: boolean
            scoreEnabled?: boolean
          })
        : {}
    const conversationId = typeof p.conversationId === 'string' ? p.conversationId : ''
    const bounds = p.bounds
    if (!bounds || typeof bounds.fromAt !== 'number' || typeof bounds.toAt !== 'number') {
      return {
        ok: false,
        stage: 'idle' as const,
        error: '缺少时间窗',
        feeds: p.feeds || [],
        items: p.items || [],
        includedCount: 0,
        windowCount: 0,
        unscoredBefore: 0,
        bodyPatches: []
      }
    }
    return runRssDispositionPipeline({
      feeds: p.feeds || [],
      items: p.items || [],
      bounds,
      entryIds: p.entryIds,
      scoreMin: p.scoreMin,
      modelRef: p.modelRef,
      template: p.template,
      focusPrompt: p.focusPrompt,
      refresh: p.refresh,
      scoreUnscored: p.scoreUnscored,
      scoreEnabled: p.scoreEnabled,
      onStage: (stage, detail) => {
        if (!conversationId) return
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue
          win.webContents.send(IPC.rssDispositionStage, { conversationId, stage, detail })
        }
      }
    })
  })
  ipcMain.on(IPC.markBriefRead, (_e, id: unknown) => {
    if (typeof id === 'string' && id.trim()) briefMarkRead(id.trim())
  })
  ipcMain.on(IPC.markAllBriefRead, () => briefMarkAllRead())
  ipcMain.on(IPC.dismissBriefItem, (_e, id: unknown) => {
    if (typeof id === 'string' && id.trim()) briefDismiss(id.trim())
  })
  ipcMain.on(IPC.toggleBriefPin, (_e, id: unknown) => {
    if (typeof id === 'string' && id.trim()) briefTogglePin(id.trim())
  })
  ipcMain.on(IPC.escalateBrief, (_e, raw: unknown) => {
    const o =
      raw && typeof raw === 'object'
        ? (raw as { id?: unknown; mode?: unknown; unreadBatch?: unknown })
        : {}
    const mode = o.mode === 'compare' ? 'compare' : 'chat'
    openChat()
    getChatWindow()?.webContents.send(IPC.openPanel, { panel: 'chat', focusComposer: true })

    if (o.unreadBatch === true) {
      const items = takeActionableUnread(5)
      if (!items.length) return
      for (const it of items) briefMarkRead(it.id)
      getChatWindow()?.webContents.send(IPC.briefEscalate, {
        item: items[0],
        items,
        mode,
        prompt: buildBriefBatchEscalatePrompt(items)
      })
      return
    }

    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!id) return
    const item = findBriefItem(id)
    if (!item) return
    briefMarkRead(id)
    getChatWindow()?.webContents.send(IPC.briefEscalate, {
      item,
      mode,
      prompt: buildBriefEscalatePrompt(item)
    })
  })
  ipcMain.handle(IPC.pickAttachments, () => pickAttachments())
  ipcMain.handle(IPC.resolveAttachmentPaths, (_e, paths: unknown) =>
    resolveAttachmentPaths(paths)
  )
  ipcMain.handle(IPC.ingestChatAttachments, (_e, attachments: unknown) =>
    ingestAttachmentsToChat(
      Array.isArray(attachments)
        ? (attachments as Array<{ path?: string; name?: string; mime?: string; size?: number }>)
            .filter((a) => a && typeof a.path === 'string' && typeof a.name === 'string')
            .map((a) => ({
              path: String(a.path),
              name: String(a.name),
              mime: typeof a.mime === 'string' ? a.mime : undefined,
              size: typeof a.size === 'number' ? a.size : undefined
            }))
        : []
    )
  )
  ipcMain.handle(IPC.previewAttachment, (_e, path: string) => previewAttachment(path))
  ipcMain.handle(IPC.readAttachmentText, (_e, path: string) => readAttachmentText(String(path || '')))
  ipcMain.handle(IPC.openAttachmentPath, (_e, path: string) =>
    openAttachmentPath(String(path || ''))
  )
  ipcMain.handle(IPC.revealAttachmentPath, (_e, path: string) =>
    revealAttachmentPath(String(path || ''))
  )
  ipcMain.handle(IPC.openAttachmentFolder, (_e, path: string) =>
    openAttachmentFolder(String(path || ''))
  )
  ipcMain.handle(IPC.readOfficePreviewText, (_e, path: string) =>
    previewOffice(String(path || ''))
  )
  ipcMain.handle(
    IPC.saveTempAttachment,
    (_e, payload: { name: string; base64: string; mime?: string }) => saveTempAttachment(payload)
  )
  ipcMain.handle(IPC.dictationAvailable, () => dictationAvailable())
  ipcMain.handle(IPC.startLiveDictation, async (e) => {
    const wc = e.sender
    return startLiveDictation((ev: DictationLiveEvent) => {
      if (!wc.isDestroyed()) wc.send(IPC.dictationEvent, ev)
    })
  })
  ipcMain.on(IPC.stopLiveDictation, () => stopLiveDictation())
  ipcMain.on(
    IPC.pushLiveDictationPcm,
    (_e, payload: { base64?: string; sampleRate?: number }) => {
      const base64 = typeof payload?.base64 === 'string' ? payload.base64 : ''
      const sampleRate = Number(payload?.sampleRate)
      if (!base64 || !(sampleRate > 0)) return
      pushLiveDictationPcm(base64, sampleRate)
    }
  )
  ipcMain.handle(
    IPC.transcribeAudio,
    (_e, payload: { base64?: string; ext?: string }) => {
      const base64 = typeof payload?.base64 === 'string' ? payload.base64 : ''
      if (!base64) return { ok: false as const, error: '录音为空' }
      const ext = typeof payload?.ext === 'string' && payload.ext.trim() ? payload.ext : 'wav'
      return transcribeAudioBase64(base64, ext)
    }
  )
  ipcMain.handle(
    IPC.saveTextFile,
    async (_e, payload: { defaultPath?: string; content?: string; title?: string }) => {
      const content = typeof payload?.content === 'string' ? payload.content : ''
      const defaultPath =
        typeof payload?.defaultPath === 'string' && payload.defaultPath.trim()
          ? payload.defaultPath.trim()
          : 'CPET-export.md'
      const dialogTitle =
        typeof payload?.title === 'string' && payload.title.trim()
          ? payload.title.trim()
          : '导出 Markdown'
      const win = BrowserWindow.getFocusedWindow() ?? getChatWindow()
      const saveOpts = {
        title: dialogTitle,
        defaultPath: join(app.getPath('documents'), defaultPath),
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All', extensions: ['*'] }
        ]
      }
      const res = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        writeFileSync(res.filePath, content, 'utf8')
        return { ok: true, path: res.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
  ipcMain.on(IPC.openExternal, (_e, url: string) => {
    if (typeof url === 'string' && /^(https?|mailto):/i.test(url)) shell.openExternal(url)
  })
  ipcMain.on(IPC.openApp, (_e, name: string) => {
    if (typeof name !== 'string' || !name.trim()) return
    openIdeApp(name.trim())
  })
  ipcMain.on(IPC.openChatPanel, (_e, raw: unknown) => {
    const rawTarget = normalizeOpenPanelPayload(raw ?? 'chat')
    if (rawTarget.panel === 'skins') {
      openSkins()
      return
    }
    // IDE 轨：续查→对话；默认→唤起 Cursor；仅显式 panel:monitor 才进联动活动
    const result = rawTarget.conversationId
      ? resolveAttnOpen(
          {
            conversationId: rawTarget.conversationId,
            panel: rawTarget.panel,
            focusComposer: rawTarget.focusComposer,
            ideApp: presenceIdeApp(rawTarget.conversationId)
          },
          ideContinueBindings,
          (id) => Boolean(getChatStore()?.conversations.some((c) => c.id === id))
        )
      : ({ kind: 'panel', target: rawTarget } satisfies PresenceOpenResult)
    if (result.kind === 'panel') {
      const target = result.target
      if (rawTarget.rssEntryId) target.rssEntryId = rawTarget.rssEntryId
      if (rawTarget.rssDigestId) target.rssDigestId = rawTarget.rssDigestId
      if (rawTarget.rssExitDigest) target.rssExitDigest = true
      if (rawTarget.section) target.section = rawTarget.section
      if (rawTarget.monitorSessionId && !target.monitorSessionId) {
        target.monitorSessionId = rawTarget.monitorSessionId
      }
      applyPresenceOpenResult({ kind: 'panel', target })
      if (rawTarget.conversationId) dismissOpsForConversation(rawTarget.conversationId)
      return
    }
    applyPresenceOpenResult(result)
    if (rawTarget.conversationId) dismissOpsForConversation(rawTarget.conversationId)
  })
  ipcMain.on(IPC.openSkins, () => openSkins())
  ipcMain.on(IPC.closeSkins, () => closeSkins())
  ipcMain.on(IPC.toggleSkins, () => toggleSkins())

  ipcMain.handle(IPC.getSetupStatus, () => getSetupStatus())
  ipcMain.handle(IPC.configureIntegration, async () => {
    const r = installHooks()
    if (!r.ok) {
      createTray()
      return r
    }
    const trust = await trustCodexPetHooks()
    createTray()
    if (trust.error && trust.error !== 'no-codex-bin' && !trust.ok) {
      return {
        ok: true,
        error: undefined,
        codexTrustOk: false,
        codexTrustError: trust.error,
        codexTrusted: trust.trusted
      }
    }
    return {
      ok: true,
      codexTrustOk: trust.error === 'no-codex-bin' ? null : true,
      codexTrusted: trust.trusted
    }
  })
  ipcMain.handle(IPC.removeIntegration, () => {
    const r = uninstallHooks()
    createTray()
    return r
  })
  ipcMain.handle(IPC.installAgent, () => {
    return new Promise<{ ok: boolean; log?: string }>((resolve) => {
      runInstallAgent((ok, log) => {
        clearAgentStatusCache()
        resolve({ ok, log: log.slice(-2000) })
      })
    })
  })
  ipcMain.handle(IPC.installEngineCli, (_e, engineId: string) => {
    const id = typeof engineId === 'string' ? engineId.trim() : ''
    return new Promise<{ ok: boolean; log?: string }>((resolve) => {
      if (!id) {
        resolve({ ok: false, log: '缺少引擎 id' })
        return
      }
      runInstallEngineCli(id, (ok, log) => {
        clearAgentStatusCache()
        resolve({ ok, log: log.slice(-2000) })
      })
    })
  })
  ipcMain.handle(IPC.writeClipboard, (_e, text: string) => {
    try {
      clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''))
      return true
    } catch {
      return false
    }
  })
  ipcMain.on(IPC.agentLogin, async () => {
    const st = await getAgentStatus()
    agentLogin(st.binPath)
  })
  ipcMain.on(IPC.engineCliLogin, async (_e, engineId: string) => {
    const id = typeof engineId === 'string' ? engineId.trim() : ''
    if (!id) return
    if (id === 'cursor') {
      const st = await getAgentStatus()
      engineCliLogin('cursor', st.binPath)
      return
    }
    engineCliLogin(id)
  })

  ipcMain.on(IPC.setIntercept, (_e, on: boolean) => {
    updateSettings({ intercept: on })
    if (!on) flushPendingApprovals('allow')
    createTray()
  })
  ipcMain.on(IPC.bindIdeContinue, (_e, raw: unknown) => {
    const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const conversationId =
      typeof p.conversationId === 'string' ? p.conversationId.trim() : ''
    if (!conversationId || isIdePresenceTrackId(conversationId)) return
    let trackId = typeof p.trackId === 'string' ? p.trackId.trim() : ''
    if (!trackId && typeof p.sessionId === 'string' && p.sessionId.trim()) {
      trackId = idePresenceTrackId(p.sessionId.trim())
    }
    if (!trackId) return
    ideContinueBindings.set(trackId, conversationId)
  })
  ipcMain.on(IPC.opsBoardReport, (_e, items: OpsBoardItem[]) => {
    const list = Array.isArray(items) ? items : []
    publishOpsBoard([...list, ...presenceOpsItems()])
  })
  ipcMain.handle(IPC.getOpsBoard, () => lastOpsBoard)
  ipcMain.on(IPC.opsBoardDismiss, (_e, raw: unknown) => {
    const payload = raw && typeof raw === 'object' ? (raw as { id?: unknown; conversationId?: unknown }) : {}
    const id = typeof payload.id === 'string' ? payload.id.trim() : ''
    const conversationId =
      typeof payload.conversationId === 'string' && payload.conversationId.trim()
        ? payload.conversationId.trim()
        : undefined
    // 有会话 id：整任务从角标拿掉（侧栏点进 / 深链打开也走这条）
    if (conversationId) {
      dismissOpsForConversation(conversationId, id || undefined)
      return
    }
    if (!id) return
    opsDismissed.add(id)
    const next = mergeOpsBoard(
      lastOpsBoard.items.filter((x) => x.id !== id && !opsDismissed.has(x.id))
    )
    emitOpsBoard(next)
  })

  ipcMain.on(IPC.approvalDecide, (_e, payload: { id: string; decision: ApprovalDecision }) => {
    const p = pendingApprovals.get(payload.id)
    if (!p) return
    clearTimeout(p.timer)
    pendingApprovals.delete(payload.id)
    emitPermissionLog({
      id: payload.id,
      at: Date.now(),
      source: 'ide',
      kind: p.logKind,
      summary: p.summary,
      decision: payload.decision
    })
    p.resolve(payload.decision)
    resolveApprovalUI(payload.id)
  })

  ipcMain.handle(IPC.getSchedules, () => scheduler?.list() ?? [])
  ipcMain.handle(IPC.saveSchedule, (_e, task: ScheduledTask) => scheduler!.save(task))
  ipcMain.handle(IPC.deleteSchedule, (_e, id: string) => {
    scheduler!.remove(id)
  })
  ipcMain.handle(IPC.deleteSchedulesForConversation, (_e, conversationId: string) => {
    return scheduler?.removeForConversation(String(conversationId || '')) ?? 0
  })
  ipcMain.handle(IPC.toggleSchedule, (_e, payload: { id: string; enabled: boolean }) =>
    scheduler!.toggle(payload.id, payload.enabled)
  )
  ipcMain.handle(IPC.runScheduleNow, (_e, id: string) => scheduler!.runNow(id))

  ipcMain.handle(IPC.sendPrompt, async (_e, payload: SendPromptPayload) => {
    try {
      if (payload.cwd) rememberProjectCwd(payload.cwd)
      const full: SendPromptPayload = {
        ...payload,
        systemPrompt: normalizeSystemPrompt(payload.systemPrompt),
        prompt: payload.prompt
      }
      await agentFacade.run(full, broadcast)
      return { ok: true }
    } catch (err) {
      const eng =
        engineIdFromModelRef(payload.model) ||
        engineIdFromModelRef(payload.compareRuns?.[0]?.model)
      if (eng) {
        patchWorkMemory((m) =>
          rememberEngineFailure(m, eng, err instanceof Error ? err.message : String(err))
        )
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.cancel, (_e, conversationId?: string, modelId?: string) => {
    agentFacade.cancel(conversationId, modelId)
    if (!agentFacade.isBusy) setPetState('idle')
  })

  ipcMain.on(IPC.toggleChat, (_e, raw?: unknown) => {
    const closing = !!getChatWindow()?.isVisible()
    // IDE 无续查：只唤起 Cursor，不要 toggle 出联动活动/对话窗
    if (!closing && raw != null) {
      const rawTarget = normalizeOpenPanelPayload(raw)
      if (rawTarget.panel === 'skins') {
        toggleChat()
        return
      }
      if (rawTarget.conversationId) {
        const result = resolvePresenceOpen(
          {
            conversationId: rawTarget.conversationId,
            panel: rawTarget.panel,
            focusComposer: rawTarget.focusComposer,
            ideApp: presenceIdeApp(rawTarget.conversationId)
          },
          ideContinueBindings
        )
        dismissOpsForConversation(rawTarget.conversationId)
        if (result.kind === 'app') {
          applyPresenceOpenResult(result)
          return
        }
        toggleChat()
        const target = result.target
        if (rawTarget.monitorSessionId && !target.monitorSessionId) {
          target.monitorSessionId = rawTarget.monitorSessionId
        }
        getChatWindow()?.webContents.send(IPC.openPanel, target)
        return
      }
      toggleChat()
      getChatWindow()?.webContents.send(IPC.openPanel, rawTarget)
      return
    }
    toggleChat()
  })
  ipcMain.on(IPC.openChat, () => openChat())
  ipcMain.on(IPC.setPetState, (_e, state: PetState) => setPetState(state))
  ipcMain.on(IPC.contextMenu, () => showPetContextMenu())
  ipcMain.on(IPC.setMouseIgnore, (_e, ignore: boolean) => setPetIgnoreMouse(ignore))
  ipcMain.on(IPC.setPetQuickChatExpanded, (_e, raw: unknown) => {
    if (raw && typeof raw === 'object') {
      const o = raw as { expanded?: unknown; wide?: unknown }
      setPetQuickChatExpanded(!!o.expanded, !!o.wide)
      return
    }
    setPetQuickChatExpanded(!!raw)
  })
  ipcMain.on(IPC.dragStart, () => startPetDrag())
  ipcMain.on(IPC.dragEnd, () => stopPetDrag())
  ipcMain.on(IPC.hidePet, () => getPetWindow()?.hide())
  ipcMain.on(IPC.quit, () => app.quit())
}

// 本地附件媒体协议：必须在 app ready 前声明特权 scheme
registerCpetFileSchemePrivileged()

// 生成完成后自动朗读无用户手势；允许 HTMLAudioElement 自动播放
try {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
} catch {
  /* ignore */
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide()
  registerCpetFileProtocolHandler()
  setupRssWebviewSession()
  registerIpc()
  // Dock/Finder 启动 PATH 很短：先合并登录 shell / homebrew / nvm，再扫引擎
  await refreshAugmentedPath()
  // 启动扫描本机引擎，自动校正当前后端
  await bootstrapAgentBackend()
  clearAgentStatusCache()
  await refreshEngineHealthNote()
  setInterval(() => {
    void refreshEngineHealthNote().then(() => {
      if (engineHealthNote && !agentFacade.isBusy) {
        petSend({ type: 'state', state: 'idle', note: engineHealthNote, origin: 'cpet' })
        setPetMood('sleeping')
      }
    })
  }, 120_000)
  setInterval(() => fireDueTodayReminders(), 20_000)
  setInterval(() => ackIdeOpsIfFrontmost(), 4_000)
  scheduler = new TaskScheduler(
    agentFacade,
    broadcast,
    broadcastSchedules,
    notifyScheduleRun,
    notifyScheduleFinished
  )
  scheduler.start()
  // 休眠期间 setTimeout 不计时，唤醒后原定时器还剩着整段延迟；这里立刻按墙钟补一次核查
  powerMonitor.on('resume', () => {
    void scheduler?.sweepDue()
    // 休眠可能错过每日简报窗口，唤醒后补扫
    void tickDailyDigest()
    void tickRssFeedPolls(true)
    // 休眠期间可能已发版，醒来补一次静默检查
    void checkForUpdate().then((r) => {
      if (r.status === 'update-available') notifyUpdateAvailable(r)
    })
  })
  createPetWindow()
  createChatWindow()
  // 开发态：自动亮起对话窗，避免「只有宠物、对话一片空白」难排查
  if (!app.isPackaged) {
    setTimeout(() => openChat(), 800)
  }
  {
    const chat = getChatWindow()
    // 渲染晚于首检 / 从托盘再打开时，把缓存的新版推回顶栏
    chat?.webContents.on('did-finish-load', () => pushPendingUpdateToChat())
    chat?.on('show', () => pushPendingUpdateToChat())
  }
  refreshQuickChatHotkey()
  createTray()
  // 开发验收角标：CPET_DEMO_ATTN=1 时灌入样例待办并截宠物窗
  if (!app.isPackaged && process.env.CPET_DEMO_ATTN === '1') {
    setTimeout(() => {
      try {
        publishOpsBoard([
          {
            id: 'demo-wait',
            kind: 'waiting',
            title: '🟣 demo-proj',
            detail: uiText("在等你回复"),
            conversationId: 'demo-wait-cid',
            panel: 'chat',
            updatedAt: Date.now()
          },
          {
            id: 'demo-done',
            kind: 'done',
            title: '🟢 other-repo',
            detail: uiText("刚完成，点开看看"),
            conversationId: 'ide:demo-sess',
            panel: 'monitor',
            updatedAt: Date.now() - 1000
          },
          {
            id: 'demo-err',
            kind: 'error',
            title: '🟠 build-bot',
            detail: uiText("运行出错"),
            conversationId: 'demo-err-cid',
            panel: 'chat',
            updatedAt: Date.now() - 500
          }
        ])
        const pet = getPetWindow()
        // 保证不贴边；高度留给展开后的待办面板（与 setPetQuickChatExpanded 对齐）
        if (pet && !pet.isDestroyed()) {
          const { workArea } = screen.getPrimaryDisplay()
          pet.setBounds({
            x: workArea.x + workArea.width - 320,
            y: workArea.y + workArea.height - 600,
            width: 280,
            height: 540
          })
          pet.show()
        }
        setTimeout(() => {
          const w = getPetWindow()
          if (!w || w.isDestroyed()) return
          void w.webContents.capturePage().then((img) => {
            const out = join(app.getPath('temp'), 'cpet-attn-demo.png')
            writeFileSync(out, img.toPNG())
            console.log('[cpet-demo-attn] screenshot', out)
          })
        }, 2000)
      } catch (err) {
        console.warn('[cpet-demo-attn] seed failed', err)
      }
    }, 1800)
  }
  setBriefInboxEmitter((snap) => {
    getPetWindow()?.webContents.send(IPC.briefInbox, snap)
  })
  setBriefDigestEmitter((payload) => {
    getPetWindow()?.webContents.send(IPC.briefDigest, payload)
  })
  setRssPetTipEmitter((payload) => {
    getPetWindow()?.webContents.send(IPC.rssPetTip, payload)
  })
  initBriefInbox()
  setRssFeedPollEmitter((store) => {
    getChatWindow()?.webContents.send(IPC.rssFeedsSynced, store)
  })
  startRssFeedPoller()
  const hookUpgrade = ensureHooksFresh()
  if (hookUpgrade.upgraded) createTray()
  // Codex 信任门禁：启动时补写 hooks.state（挂了 hooks.json 仍可能 untrusted）
  void trustCodexPetHooks().catch(() => undefined)
  stopHookServer = startHookServer({ onEvent: dispatchHookEvent, onApproval: handleApproval })
  stopHookInbox = startHookInbox(dispatchHookEvent)
  // 首次运行引导配置引擎联动
  setTimeout(() => runFirstRunSetup(false), 1200)
  // 后台静默查更新：只有真有新版才提示，同一版本只弹一次
  startUpdateWatch(notifyUpdateAvailable)

  app.on('activate', () => {
    if (!getPetWindow()) createPetWindow()
  })
})

// 桌面宠物应用不随窗口关闭而退出，交给托盘控制。
app.on('window-all-closed', () => {
  // 保持常驻；通过托盘“退出”结束进程。
})

app.on('before-quit', () => {
  setAppQuitting(true)
  agentFacade.cancel()
  scheduler?.stop()
  stopBriefInbox()
  stopRssFeedPoller()
  stopHookInbox?.()
  stopHookServer?.()
  stopUpdateWatch()
  stopCosyVoiceSidecar()
  unregisterQuickChatHotkey()
})
