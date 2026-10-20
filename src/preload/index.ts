import type { UiLanguageState } from '../shared/i18n'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/types'
import type {
  Activity,
  AgentEvent,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResult,
  AgentBackend,
  ChatAttachment,
  ChatHistory,
  ChatStore,
  LoadedImageSkin,
  OpenPanelTarget,
  PermissionLogEntry,
  PetApi,
  PetDockEdge,
  PetMood,
  PetState,
  ScheduleRunPayload,
  ScheduledTask,
  SendPromptPayload,
  SkinId,
  UpdateCheckResult
} from '../shared/types'
import { normalizeOpenPanelPayload } from '../shared/openPanel'

const api: PetApi = {
  getAgentStatus: () => ipcRenderer.invoke(IPC.getAgentStatus),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  getUiLanguage: () => ipcRenderer.invoke(IPC.getUiLanguage),
  setUiLanguage: (preference) => ipcRenderer.invoke(IPC.setUiLanguage, preference),
  onUiLanguageChanged: (cb) => {
    const listener = (_event: unknown, state: UiLanguageState) => cb(state)
    ipcRenderer.on(IPC.uiLanguageChanged, listener)
    return () => ipcRenderer.removeListener(IPC.uiLanguageChanged, listener)
  },
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
  getLastUpdateResult: () => ipcRenderer.invoke(IPC.getLastUpdateResult),
  dismissUpdateBanner: (version) => ipcRenderer.send(IPC.dismissUpdateBanner, version),
  onUpdateAvailable: (cb) => {
    const listener = (_e: unknown, result: UpdateCheckResult) => cb(result)
    ipcRenderer.on(IPC.updateAvailable, listener)
    return () => ipcRenderer.removeListener(IPC.updateAvailable, listener)
  },
  pickWorkingDir: (preferredStart?: string) =>
    ipcRenderer.invoke(IPC.pickWorkingDir, preferredStart),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSkin: (skin: SkinId) => ipcRenderer.send(IPC.setSkin, skin),
  setCwd: (cwd: string) => ipcRenderer.send(IPC.setCwd, cwd),
  setUserAvatar: (emoji: string) => ipcRenderer.send(IPC.setUserAvatar, emoji),
  pickUserAvatarImage: () => ipcRenderer.invoke(IPC.pickUserAvatarImage),
  setChatTheme: (theme) => ipcRenderer.send(IPC.setChatTheme, theme),
  setChatThemeCustom: (custom) => ipcRenderer.send(IPC.setChatThemeCustom, custom),
  onChatTheme: (cb) => {
    const listener = (
      _e: unknown,
      payload: {
        theme: import('../shared/chatUi').ChatThemeId
        custom: import('../shared/chatUi').ChatThemeCustom
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.chatTheme, listener)
    return () => ipcRenderer.removeListener(IPC.chatTheme, listener)
  },
  setWeatherCity: (city) => ipcRenderer.send(IPC.setWeatherCity, city),
  setWeatherCityPrompted: (prompted) => ipcRenderer.send(IPC.setWeatherCityPrompted, prompted),
  setBriefOnboardingPrompted: (prompted) =>
    ipcRenderer.send(IPC.setBriefOnboardingPrompted, prompted),
  setNewsSource: (source) => ipcRenderer.send(IPC.setNewsSource, source),
  setBriefRssFeeds: (urls) => ipcRenderer.send(IPC.setBriefRssFeeds, urls),
  setBriefInterestKeywords: (keywords) => ipcRenderer.send(IPC.setBriefInterestKeywords, keywords),
  setBriefMuteKeywords: (keywords) => ipcRenderer.send(IPC.setBriefMuteKeywords, keywords),
  setBriefDailyDigestHours: (hours) => ipcRenderer.send(IPC.setBriefDailyDigestHours, hours),
  setBriefDailyDigestHour: (hour) => ipcRenderer.send(IPC.setBriefDailyDigestHour, hour),
  setBriefDigestIntervalHours: (hours) =>
    ipcRenderer.send(IPC.setBriefDigestIntervalHours, hours),
  setRssScoreModelRef: (ref) => ipcRenderer.send(IPC.setRssScoreModelRef, ref),
  setRssScoreMode: (mode) => ipcRenderer.send(IPC.setRssScoreMode, mode),
  setRssScoreIntervalMinutes: (minutes) =>
    ipcRenderer.send(IPC.setRssScoreIntervalMinutes, minutes),
  setRssOrganizeLang: (lang) => ipcRenderer.send(IPC.setRssOrganizeLang, lang),
  setRssPetPushMinScore: (min) => ipcRenderer.send(IPC.setRssPetPushMinScore, min),
  setRssPaneWidths: (widths) => ipcRenderer.send(IPC.setRssPaneWidths, widths),
  refreshWeather: () => ipcRenderer.invoke(IPC.refreshWeather),
  setSidebarCollapsed: (collapsed) => ipcRenderer.send(IPC.setSidebarCollapsed, collapsed),
  setShowReasoning: (show) => ipcRenderer.send(IPC.setShowReasoning, show),
  setShowTools: (show) => ipcRenderer.send(IPC.setShowTools, show),
  onShowDetailsChange: (cb) => {
    const listener = (_e: unknown, show: boolean) => cb(!!show)
    ipcRenderer.on(IPC.showDetailsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.showDetailsChanged, listener)
  },
  setAgentBackend: (backend: AgentBackend) => ipcRenderer.send(IPC.setAgentBackend, backend),
  setOpenclawAgentId: (id: string) => ipcRenderer.send(IPC.setOpenclawAgentId, id),
  listOpenclawAgents: () => ipcRenderer.invoke(IPC.listOpenclawAgents),
  listSkills: (cwd?: string) => ipcRenderer.invoke(IPC.listSkills, cwd),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  listModelCatalog: () => ipcRenderer.invoke(IPC.listModelCatalog),
  setModels: (models) => ipcRenderer.send(IPC.setModels, models),
  setModelProviders: (providers) => ipcRenderer.invoke(IPC.setModelProviders, providers),
  setDefaultModelRef: (ref) => ipcRenderer.send(IPC.setDefaultModelRef, ref),
  setDefaultAgentAutonomy: (mode) => ipcRenderer.send(IPC.setDefaultAgentAutonomy, mode),
  setSkillDelivery: (mode) => ipcRenderer.send(IPC.setSkillDelivery, mode),
  setSystemPrompt: (text) => ipcRenderer.send(IPC.setSystemPrompt, text),
  setPromptTemplates: (templates) => ipcRenderer.send(IPC.setPromptTemplates, templates),
  setQuickChat: (patch) => ipcRenderer.send(IPC.setQuickChat, patch),
  setAgentMemoryEnabled: (enabled) => ipcRenderer.invoke(IPC.setAgentMemoryEnabled, enabled),
  getAgentMemoryStats: () => ipcRenderer.invoke(IPC.getAgentMemoryStats),
  onAgentMemoryChanged: (cb) => {
    const listener = (
      _e: unknown,
      payload: import('../shared/agentMemory').AgentMemoryStatsResult
    ) => cb(payload)
    ipcRenderer.on(IPC.memoryChanged, listener)
    return () => ipcRenderer.removeListener(IPC.memoryChanged, listener)
  },
  clearAgentMemory: () => ipcRenderer.invoke(IPC.clearAgentMemory),
  ttsSpeak: (text) => ipcRenderer.invoke(IPC.ttsSpeak, text),
  ttsSpeakLive: (text) => ipcRenderer.invoke(IPC.ttsSpeakLive, text),
  ttsClaim: (opts) => ipcRenderer.invoke(IPC.ttsClaim, opts),
  ttsRelease: () => ipcRenderer.invoke(IPC.ttsRelease),
  onTtsPcmStart: (cb) => {
    const listener = (_e: unknown, ev: { id: string; sampleRate: number }) => cb(ev)
    ipcRenderer.on(IPC.ttsPcmStart, listener)
    return () => ipcRenderer.removeListener(IPC.ttsPcmStart, listener)
  },
  onTtsPcmFrame: (cb) => {
    const listener = (
      _e: unknown,
      ev: { id: string; sampleRate: number; pcm: string }
    ) => cb(ev)
    ipcRenderer.on(IPC.ttsPcmFrame, listener)
    return () => ipcRenderer.removeListener(IPC.ttsPcmFrame, listener)
  },
  onTtsPcmEnd: (cb) => {
    const listener = (_e: unknown, ev: { id: string; ok: boolean; error?: string }) =>
      cb(ev)
    ipcRenderer.on(IPC.ttsPcmEnd, listener)
    return () => ipcRenderer.removeListener(IPC.ttsPcmEnd, listener)
  },
  ttsCosyStatus: () => ipcRenderer.invoke(IPC.ttsCosyStatus),
  ttsCosyInstall: () => ipcRenderer.invoke(IPC.ttsCosyInstall),
  ttsCosyPrepareModel: () => ipcRenderer.invoke(IPC.ttsCosyPrepareModel),
  ttsListVoices: () => ipcRenderer.invoke(IPC.ttsListVoices),
  ttsAddVoice: (input) => ipcRenderer.invoke(IPC.ttsAddVoice, input),
  ttsRemoveVoice: (id) => ipcRenderer.invoke(IPC.ttsRemoveVoice, id),
  ttsPickPromptWav: () => ipcRenderer.invoke(IPC.ttsPickPromptWav),
  ttsPickCosyRoot: () => ipcRenderer.invoke(IPC.ttsPickCosyRoot),
  setActivePromptTemplateId: (id) => ipcRenderer.send(IPC.setActivePromptTemplateId, id),
  onPetSkin: (cb) => {
    const listener = (_e: unknown, skin: SkinId) => cb(skin)
    ipcRenderer.on(IPC.petSkin, listener)
    return () => ipcRenderer.removeListener(IPC.petSkin, listener)
  },
  getImagePacks: () => ipcRenderer.invoke(IPC.getImagePacks),
  listLocalSkinPacks: () => ipcRenderer.invoke(IPC.listLocalSkinPacks),
  getImageSkin: () => ipcRenderer.invoke(IPC.getImageSkin),
  getSkinsDir: () => ipcRenderer.invoke(IPC.getSkinsDir),
  setImageSkin: (id: string | null) => ipcRenderer.send(IPC.setImageSkin, id),
  openSkinsDir: () => ipcRenderer.send(IPC.openSkinsDir),
  onPetImageSkin: (cb) => {
    const listener = (_e: unknown, skin: LoadedImageSkin | null) => cb(skin)
    ipcRenderer.on(IPC.petImageSkin, listener)
    return () => ipcRenderer.removeListener(IPC.petImageSkin, listener)
  },
  fetchSkinMarket: () => ipcRenderer.invoke(IPC.fetchSkinMarket),
  downloadSkinPack: (payload) => ipcRenderer.invoke(IPC.downloadSkinPack, payload),
  uninstallSkinPack: (id) => ipcRenderer.invoke(IPC.uninstallSkinPack, id),
  importSkinPack: () => ipcRenderer.invoke(IPC.importSkinPack),
  exportSkinPack: (id) => ipcRenderer.invoke(IPC.exportSkinPack, id),
  prepareSkinMarketSubmission: (id) =>
    ipcRenderer.invoke(IPC.prepareSkinMarketSubmission, id),
  getHistory: () => ipcRenderer.invoke(IPC.getHistory),
  saveHistory: (history: ChatHistory) => ipcRenderer.send(IPC.saveHistory, history),
  getChatStore: () => ipcRenderer.invoke(IPC.getChatStore),
  saveChatStore: (store: ChatStore) => ipcRenderer.send(IPC.saveChatStore, store),
  onTodayMemosPatched: (cb) => {
    const listener = (_e: unknown, memos: import('../shared/types').TodayMemo[]) => cb(memos)
    ipcRenderer.on(IPC.todayMemosPatched, listener)
    return () => ipcRenderer.removeListener(IPC.todayMemosPatched, listener)
  },
  confirm: (message) => ipcRenderer.invoke(IPC.confirm, message),
  getWeather: () => ipcRenderer.invoke(IPC.getWeather),
  getNews: () => ipcRenderer.invoke(IPC.getNews),
  getBriefInbox: () => ipcRenderer.invoke(IPC.getBriefInbox),
  refreshBriefInbox: () => ipcRenderer.invoke(IPC.refreshBriefInbox),
  onBriefInbox: (cb) => {
    const listener = (_e: unknown, snap: import('../shared/briefInbox').BriefInbox) => cb(snap)
    ipcRenderer.on(IPC.briefInbox, listener)
    return () => ipcRenderer.removeListener(IPC.briefInbox, listener)
  },
  markBriefRead: (id) => ipcRenderer.send(IPC.markBriefRead, id),
  markAllBriefRead: () => ipcRenderer.send(IPC.markAllBriefRead),
  dismissBriefItem: (id) => ipcRenderer.send(IPC.dismissBriefItem, id),
  toggleBriefPin: (id) => ipcRenderer.send(IPC.toggleBriefPin, id),
  escalateBrief: (payload) => ipcRenderer.send(IPC.escalateBrief, payload),
  onBriefEscalate: (cb) => {
    const listener = (
      _e: unknown,
      payload: {
        item: import('../shared/briefInbox').BriefItem
        items?: import('../shared/briefInbox').BriefItem[]
        mode: 'chat' | 'compare'
        prompt: string
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.briefEscalate, listener)
    return () => ipcRenderer.removeListener(IPC.briefEscalate, listener)
  },
  onBriefDigest: (cb) => {
    const listener = (
      _e: unknown,
      payload: { text: string; hint: string; briefId?: string }
    ) => cb(payload)
    ipcRenderer.on(IPC.briefDigest, listener)
    return () => ipcRenderer.removeListener(IPC.briefDigest, listener)
  },
  onRssPetTip: (cb) => {
    const listener = (
      _e: unknown,
      payload: {
        text: string
        hint: string
        conversationId: string
        entryId?: string
        digestId?: string
        rank: number
        key: string
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.rssPetTip, listener)
    return () => ipcRenderer.removeListener(IPC.rssPetTip, listener)
  },
  onRssFeedsSynced: (cb) => {
    const listener = (_e: unknown, store: ChatStore) => cb(store)
    ipcRenderer.on(IPC.rssFeedsSynced, listener)
    return () => ipcRenderer.removeListener(IPC.rssFeedsSynced, listener)
  },
  previewBriefDigest: () => ipcRenderer.send(IPC.previewBriefDigest),
  refreshRssTaskFeeds: (feeds) => ipcRenderer.invoke(IPC.refreshRssTaskFeeds, feeds),
  fetchRssArticle: (url, opts) => ipcRenderer.invoke(IPC.fetchRssArticle, url, opts ?? {}),
  recoverRssArticleWithModel: (payload) =>
    ipcRenderer.invoke(IPC.recoverRssArticleWithModel, payload),
  discoverRssFeeds: (payload) => ipcRenderer.invoke(IPC.discoverRssFeeds, payload ?? {}),
  lookupRssFeedMetrics: (payload) => ipcRenderer.invoke(IPC.lookupRssFeedMetrics, payload),
  quickChatArm: (payload) => ipcRenderer.invoke(IPC.quickChatArm, payload),
  quickChatArmVoice: (transcript) => ipcRenderer.invoke(IPC.quickChatArmVoice, transcript),
  onQuickChatHotkey: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.quickChatHotkey, listener)
    return () => ipcRenderer.removeListener(IPC.quickChatHotkey, listener)
  },
  quickChatSend: (payload) => ipcRenderer.invoke(IPC.quickChatSend, payload),
  quickChatReady: () => ipcRenderer.send(IPC.quickChatReady),
  onQuickChatSync: (cb) => {
    const listener = (
      _e: unknown,
      payload: {
        store: import('../shared/types').ChatStore
        conversationId: string
        focusComposer: boolean
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.quickChatSync, listener)
    return () => ipcRenderer.removeListener(IPC.quickChatSync, listener)
  },
  onQuickChatSendToChat: (cb) => {
    const listener = (
      _e: unknown,
      payload: {
        conversationId: string
        text: string
        attachments?: import('../shared/types').ChatAttachment[]
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.quickChatSendToChat, listener)
    return () => ipcRenderer.removeListener(IPC.quickChatSendToChat, listener)
  },
  scoreRssEntries: (payload) => ipcRenderer.invoke(IPC.scoreRssEntries, payload),
  buildRssDigestReport: (payload) => ipcRenderer.invoke(IPC.buildRssDigestReport, payload),
  runRssDisposition: (payload) => ipcRenderer.invoke(IPC.runRssDisposition, payload),
  onRssDispositionStage: (cb) => {
    const listener = (
      _e: unknown,
      payload: {
        conversationId: string
        stage: import('../shared/rssTask').RssDispositionStage
        detail?: string
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.rssDispositionStage, listener)
    return () => ipcRenderer.removeListener(IPC.rssDispositionStage, listener)
  },
  saveTextFile: (payload) => ipcRenderer.invoke(IPC.saveTextFile, payload),
  openExternal: (url: string) => ipcRenderer.send(IPC.openExternal, url),
  openApp: (name: string) => ipcRenderer.send(IPC.openApp, name),
  openChatPanel: (panel) => ipcRenderer.send(IPC.openChatPanel, panel ?? 'chat'),
  onOpenPanel: (cb) => {
    const listener = (_e: unknown, raw: unknown) => {
      cb(normalizeOpenPanelPayload(raw) as OpenPanelTarget)
    }
    ipcRenderer.on(IPC.openPanel, listener)
    return () => ipcRenderer.removeListener(IPC.openPanel, listener)
  },
  openSkins: () => ipcRenderer.send(IPC.openSkins),
  closeSkins: () => ipcRenderer.send(IPC.closeSkins),
  toggleSkins: () => ipcRenderer.send(IPC.toggleSkins),
  pickAttachments: () => ipcRenderer.invoke(IPC.pickAttachments),
  resolveAttachmentPaths: (paths) => ipcRenderer.invoke(IPC.resolveAttachmentPaths, paths),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file as File) || ''
    } catch {
      return ''
    }
  },
  ingestChatAttachments: (attachments) =>
    ipcRenderer.invoke(IPC.ingestChatAttachments, attachments),
  onChatIngestAttachments: (cb) => {
    const listener = (_e: unknown, attachments: ChatAttachment[]) => cb(attachments || [])
    ipcRenderer.on(IPC.chatIngestAttachments, listener)
    return () => ipcRenderer.removeListener(IPC.chatIngestAttachments, listener)
  },
  saveTempAttachment: (payload) => ipcRenderer.invoke(IPC.saveTempAttachment, payload),
  previewAttachment: (path: string) => ipcRenderer.invoke(IPC.previewAttachment, path),
  readAttachmentText: (path: string) => ipcRenderer.invoke(IPC.readAttachmentText, path),
  openAttachmentPath: (path: string) => ipcRenderer.invoke(IPC.openAttachmentPath, path),
  revealAttachmentPath: (path: string) => ipcRenderer.invoke(IPC.revealAttachmentPath, path),
  openAttachmentFolder: (path: string) => ipcRenderer.invoke(IPC.openAttachmentFolder, path),
  readOfficePreviewText: (path: string) =>
    ipcRenderer.invoke(IPC.readOfficePreviewText, path),
  dictationAvailable: () => ipcRenderer.invoke(IPC.dictationAvailable),
  startLiveDictation: () => ipcRenderer.invoke(IPC.startLiveDictation),
  stopLiveDictation: () => ipcRenderer.send(IPC.stopLiveDictation),
  pushLiveDictationPcm: (payload) => ipcRenderer.send(IPC.pushLiveDictationPcm, payload),
  onDictationEvent: (cb) => {
    const listener = (
      _e: unknown,
      ev:
        | { type: 'partial'; text: string }
        | { type: 'final'; text: string }
        | { type: 'end'; reason: string; text: string }
        | { type: 'error'; message: string }
    ) => cb(ev)
    ipcRenderer.on(IPC.dictationEvent, listener)
    return () => ipcRenderer.removeListener(IPC.dictationEvent, listener)
  },
  transcribeAudio: (payload) => ipcRenderer.invoke(IPC.transcribeAudio, payload),
  getSetupStatus: () => ipcRenderer.invoke(IPC.getSetupStatus),
  configureIntegration: () => ipcRenderer.invoke(IPC.configureIntegration),
  removeIntegration: () => ipcRenderer.invoke(IPC.removeIntegration),
  installAgent: () => ipcRenderer.invoke(IPC.installAgent),
  installEngineCli: (engineId) => ipcRenderer.invoke(IPC.installEngineCli, engineId),
  writeClipboard: (text) => ipcRenderer.invoke(IPC.writeClipboard, text),
  agentLogin: () => ipcRenderer.send(IPC.agentLogin),
  engineCliLogin: (engineId) => ipcRenderer.send(IPC.engineCliLogin, engineId),
  setIntercept: (on: boolean) => ipcRenderer.send(IPC.setIntercept, on),
  onApprovalRequest: (cb) => {
    const listener = (_e: unknown, req: ApprovalRequest) => cb(req)
    ipcRenderer.on(IPC.approvalRequest, listener)
    return () => ipcRenderer.removeListener(IPC.approvalRequest, listener)
  },
  onApprovalResolved: (cb) => {
    const listener = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on(IPC.approvalResolved, listener)
    return () => ipcRenderer.removeListener(IPC.approvalResolved, listener)
  },
  onApprovalResult: (cb) => {
    const listener = (_e: unknown, result: ApprovalResult) => cb(result)
    ipcRenderer.on(IPC.approvalResult, listener)
    return () => ipcRenderer.removeListener(IPC.approvalResult, listener)
  },
  decideApproval: (id: string, decision: ApprovalDecision) =>
    ipcRenderer.send(IPC.approvalDecide, { id, decision }),
  onActivity: (cb) => {
    const listener = (_e: unknown, a: Activity) => cb(a)
    ipcRenderer.on(IPC.activity, listener)
    return () => ipcRenderer.removeListener(IPC.activity, listener)
  },
  getSchedules: () => ipcRenderer.invoke(IPC.getSchedules),
  saveSchedule: (task: ScheduledTask) => ipcRenderer.invoke(IPC.saveSchedule, task),
  deleteSchedule: (id: string) => ipcRenderer.invoke(IPC.deleteSchedule, id),
  deleteSchedulesForConversation: (conversationId: string) =>
    ipcRenderer.invoke(IPC.deleteSchedulesForConversation, conversationId),
  toggleSchedule: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.toggleSchedule, { id, enabled }),
  runScheduleNow: (id: string) => ipcRenderer.invoke(IPC.runScheduleNow, id),
  onSchedulesChanged: (cb) => {
    const listener = (_e: unknown, tasks: ScheduledTask[]) => cb(tasks)
    ipcRenderer.on(IPC.schedulesChanged, listener)
    return () => ipcRenderer.removeListener(IPC.schedulesChanged, listener)
  },
  onScheduleRun: (cb) => {
    const listener = (_e: unknown, payload: ScheduleRunPayload) => cb(payload)
    ipcRenderer.on(IPC.scheduleRun, listener)
    return () => ipcRenderer.removeListener(IPC.scheduleRun, listener)
  },
  onScheduleFinished: (cb) => {
    const listener = (
      _e: unknown,
      info: {
        taskId: string
        taskName: string
        conversationId?: string
        ok: boolean
        detail?: string
        autoDisabled?: boolean
        store?: ChatStore
      }
    ) => cb(info)
    ipcRenderer.on(IPC.scheduleFinished, listener)
    return () => ipcRenderer.removeListener(IPC.scheduleFinished, listener)
  },
  onOpenSchedules: (cb) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.openSchedules, listener)
    return () => ipcRenderer.removeListener(IPC.openSchedules, listener)
  },
  onPermissionLog: (cb) => {
    const listener = (
      _e: unknown,
      payload: { conversationId?: string; entry: PermissionLogEntry }
    ) => cb(payload)
    ipcRenderer.on(IPC.permissionLog, listener)
    return () => ipcRenderer.removeListener(IPC.permissionLog, listener)
  },
  reportOpsBoard: (items) => ipcRenderer.send(IPC.opsBoardReport, items),
  getOpsBoard: () => ipcRenderer.invoke(IPC.getOpsBoard),
  onOpsBoard: (cb) => {
    const listener = (_e: unknown, snap: import('../shared/opsBoard').OpsBoardSnapshot) => cb(snap)
    ipcRenderer.on(IPC.opsBoard, listener)
    return () => ipcRenderer.removeListener(IPC.opsBoard, listener)
  },
  dismissOpsItem: (payload) => ipcRenderer.send(IPC.opsBoardDismiss, payload),
  bindIdeContinue: (payload) => ipcRenderer.send(IPC.bindIdeContinue, payload),
  onDismissOpsItem: (cb) => {
    const listener = (_e: unknown, payload: { id: string; conversationId?: string }) => cb(payload)
    ipcRenderer.on(IPC.opsBoardDismiss, listener)
    return () => ipcRenderer.removeListener(IPC.opsBoardDismiss, listener)
  },
  sendPrompt: (payload: SendPromptPayload) => ipcRenderer.invoke(IPC.sendPrompt, payload),
  cancel: (conversationId?: string, modelId?: string) =>
    ipcRenderer.invoke(IPC.cancel, conversationId, modelId),
  onAgentEvent: (cb) => {
    const listener = (_e: unknown, event: AgentEvent) => cb(event)
    ipcRenderer.on(IPC.agentEvent, listener)
    return () => ipcRenderer.removeListener(IPC.agentEvent, listener)
  },
  onExternalSummary: (cb) => {
    const listener = (_e: unknown, text: string) => cb(text)
    ipcRenderer.on(IPC.externalSummary, listener)
    return () => ipcRenderer.removeListener(IPC.externalSummary, listener)
  },
  toggleChat: (panel) => ipcRenderer.send(IPC.toggleChat, panel),
  openChat: () => ipcRenderer.send(IPC.openChat),
  onChatVisibility: (cb) => {
    const listener = (_e: unknown, visible: boolean) => cb(!!visible)
    ipcRenderer.on(IPC.chatVisibility, listener)
    return () => ipcRenderer.removeListener(IPC.chatVisibility, listener)
  },
  setPetState: (state: PetState) => ipcRenderer.send(IPC.setPetState, state),
  onPetState: (cb) => {
    const listener = (_e: unknown, state: PetState) => cb(state)
    ipcRenderer.on(IPC.petState, listener)
    return () => ipcRenderer.removeListener(IPC.petState, listener)
  },
  onPetMood: (cb) => {
    const listener = (_e: unknown, mood: PetMood) => cb(mood)
    ipcRenderer.on(IPC.petMood, listener)
    return () => ipcRenderer.removeListener(IPC.petMood, listener)
  },
  onPetAction: (cb) => {
    const listener = (_e: unknown, action: string) => cb(action)
    ipcRenderer.on(IPC.petAction, listener)
    return () => ipcRenderer.removeListener(IPC.petAction, listener)
  },
  onPetDockEdge: (cb) => {
    const listener = (_e: unknown, edge: PetDockEdge) => cb(edge)
    ipcRenderer.on(IPC.petDockEdge, listener)
    return () => ipcRenderer.removeListener(IPC.petDockEdge, listener)
  },
  showContextMenu: () => ipcRenderer.send(IPC.contextMenu),
  setMouseIgnore: (ignore: boolean) => ipcRenderer.send(IPC.setMouseIgnore, ignore),
  setPetQuickChatExpanded: (expanded) =>
    ipcRenderer.send(IPC.setPetQuickChatExpanded, expanded),
  dragStart: () => ipcRenderer.send(IPC.dragStart),
  dragEnd: () => ipcRenderer.send(IPC.dragEnd),
  hidePet: () => ipcRenderer.send(IPC.hidePet),
  quit: () => ipcRenderer.send(IPC.quit)
}

contextBridge.exposeInMainWorld('petApi', api)
