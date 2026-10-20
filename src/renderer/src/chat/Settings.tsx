import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { LanguageSelector } from './LanguageSelector'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  SKINS,
  type AgentStatus,
  type AppInfo,
  type UpdateCheckResult,
  type ModelProvider,
  type PromptTemplate,
  type SkinId
} from '@shared/types'
import { describeAppearance } from '@shared/skinMarket'
import { appendDiagnosticsExtras } from '@shared/feedback'
import {
  applyModelCatalog,
  ensureBuiltinProviders,
  formatModelRef,
  isAgentProvider,
  migrateLegacyModelPrefs
} from '@shared/models'
import { formatRssScheduleLabel, resolveRssScheduleValue } from '@shared/rssSchedule'
import {
  RSS_SCORE_INTERVALS,
  normalizeRssScoreIntervalMinutes,
  normalizeRssScoreMode,
  type RssScoreMode
} from '@shared/rssTask'
import {
  normalizeRssPetPushMinScore,
  rssPetPushMinScoreLabel,
  type RssPetPushMinScore
} from '@shared/petBubblePolicy'
import { isSafeAgentCwd, isUserHomeDir, UNSAFE_CWD_MESSAGE } from '@shared/cwd'
import { ModelPicker } from './ModelPicker'
import { writeClipboardText } from '../lib/clipboard'
import {
  BUILTIN_PROMPT_TEMPLATES,
  newPromptTemplateId,
  normalizePromptTemplates
} from '@shared/prompts'
import {
  DEFAULT_QUICK_CHAT_HOTKEY,
  DEFAULT_QUICK_CHAT_SETTINGS,
  normalizeQuickChatSettings,
  type QuickChatSettings
} from '@shared/quickChat'
import {
  formatAgentMemoryStatusLine,
  normalizeAgentMemorySettings,
  type AgentMemoryStatsResult
} from '@shared/agentMemory'
import {
  DEFAULT_COSYVOICE_MODEL,
  DEFAULT_COSYVOICE_PORT,
  DEFAULT_COSYVOICE_PROMPT_TEXT,
  DEFAULT_EDGE_TTS_VOICE,
  EDGE_TTS_VOICE_PRESETS,
  isTtsEngineOn,
  type CosyVoiceStatus,
  type TtsCustomVoice,
  type TtsMode
} from '@shared/tts'
import { speakTextWithTts, stopTtsPlayback, unlockTtsAudio } from '../ttsPlayback'
import {
  CHAT_THEMES,
  DEFAULT_CHAT_THEME,
  DEFAULT_CHAT_THEME_CUSTOM,
  DEFAULT_USER_AVATAR,
  USER_AVATAR_CHOICES,
  WEATHER_CITY_PRESETS,
  isChatThemeId,
  isUserAvatarImage,
  normalizeChatThemeCustom,
  sanitizeUserAvatar,
  type ChatThemeCustom,
  type ChatThemeId
} from '@shared/chatUi'
import {
  AGENT_AUTONOMY_OPTIONS,
  DEFAULT_AGENT_AUTONOMY,
  isAgentAutonomy,
  type AgentAutonomy
} from '@shared/agentAutonomy'
import { RssScheduleFields } from './RssScheduleFields'
import { briefUnreadCount } from '@shared/briefInbox'
import {
  SKILL_DELIVERY_OPTIONS,
  isSkillDeliveryPref,
  resolveSkillDelivery,
  type SkillDeliveryPref
} from '@shared/skills'
import { AGENT_CATALOG } from '@shared/agentBackends'
import {
  ENGINE_SETUP_GUIDES,
  canOneClickInstall,
  canOneClickLogin,
  installCommandForPlatform,
  type EngineSetupId
} from '@shared/engineSetup'
import { recentChangelog } from '@shared/changelog'
import { confirmDestructive } from './confirm'
import brandHeader from '../assets/brand/cpet-header-mark.png'
import brandIcon from '../assets/brand/cpet-icon-1024.png'
import { StudioPublisher } from './StudioPublisher'

type SettingsNavItem = { id: string; label: string }
type SettingsNavGroup = { title: string; items: ReadonlyArray<SettingsNavItem> }

/** 按使用心智分组：上手 → 引擎 → 对话 → 外观 → 资讯 → 关于 */
const SETTINGS_NAV: ReadonlyArray<SettingsNavGroup> = [
  {
    get title() { return uiText("上手") },
    items: [{ id: 'settings-setup', get label() { return uiText("上手说明") } }, { id: 'settings-language', get label() { return uiText("界面语言") } }]
  },
  {
    get title() { return uiText("引擎") },
    items: [
      { id: 'settings-models', get label() { return uiText("Agent 引擎") } },
      { id: 'settings-api', get label() { return uiText("自定义 API") } },
      { id: 'settings-hooks', get label() { return uiText("IDE 联动") } }
    ]
  },
  {
    get title() { return uiText("对话") },
    items: [
      { id: 'settings-autonomy', get label() { return uiText("默认任务") } },
      { id: 'settings-prompts', get label() { return uiText("提示模版") } },
      { id: 'settings-quick-chat', get label() { return uiText("快速对话") } },
      { id: 'settings-memory', get label() { return uiText("联想记忆") } }
    ]
  },
  {
    get title() { return uiText("外观") },
    items: [
      { id: 'settings-theme', get label() { return uiText("对话框") } },
      { id: 'settings-avatar', get label() { return uiText("用户头像") } },
      { id: 'settings-pet', get label() { return uiText("宠物形象") } }
    ]
  },
  {
    get title() { return uiText("资讯") },
    items: [
      { id: 'settings-weather', get label() { return uiText("天气") } },
      { id: 'settings-rss', get label() { return uiText("RSS 订阅") } }
    ]
  },
  {
    get title() { return uiText("关于") },
    items: [{ id: 'settings-about', get label() { return uiText("版本与更新") } }]
  }
]

/** 目录要给全路径：只显示末级目录名时，`skins` / `src` 这种到处都有，等于没说。 */
function displayPath(p: string, home: string): string {
  if (!p) return ''
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`
  return p
}

/**
 * 文案里的引擎名一律从引擎目录生成。
 * 手写枚举每加一个引擎就会漏一处，用户会以为新引擎不吃这条设置。
 */
const SUPPORTED_ENGINE_NAMES = AGENT_CATALOG.filter((e) => e.supported)
  .map((e) => e.shortLabel)
  .join(' / ')
const NATIVE_SKILL_ENGINE_NAMES = AGENT_CATALOG.filter(
  (e) => e.supported && resolveSkillDelivery(e.id, 'auto') === 'native'
)
  .map((e) => e.shortLabel)
  .join(' / ')
const CATALOG_SKILL_ENGINE_NAMES = AGENT_CATALOG.filter(
  (e) => e.supported && resolveSkillDelivery(e.id, 'auto') === 'catalog'
)
  .map((e) => e.shortLabel)
  .join(' / ')

export function SettingsPanel({
  status,
  focusSection,
  onFocusSectionConsumed,
  onThemeChange,
  onThemeCustomChange,
  onUserAvatarChange,
  onProvidersChange,
  onStatusRefresh,
  onOpenSkinMarket,
  onQuickChatChange,
  onClose
}: {
  status: AgentStatus | null
  /** 打开时滚到的 section id（如 settings-about）。 */
  focusSection?: string | null
  onFocusSectionConsumed?: () => void
  onThemeChange: (theme: ChatThemeId) => void
  onThemeCustomChange?: (custom: ChatThemeCustom) => void
  onUserAvatarChange: (avatar: string) => void
  /** 模型树变更时同步给对话侧选单。 */
  onProvidersChange?: (providers: ModelProvider[]) => void
  /** 安装/登录后刷新引擎检测。 */
  onStatusRefresh?: () => void
  /** 打开独立皮肤窗（换肤/下载/导入的主入口）。 */
  onOpenSkinMarket?: () => void
  /** 快问/TTS 设置变更时立刻同步对话顶栏（无需等关闭设置）。 */
  onQuickChatChange?: (qc: QuickChatSettings) => void
  /** 关闭时带回最新模型树，避免对话侧被旧 settings 覆盖。 */
  onClose: (providers?: ModelProvider[]) => void
}): JSX.Element {
  useUiLocale()
  const [setupBusy, setSetupBusy] = useState<string | null>(null)
  const [activeNavId, setActiveNavId] = useState('settings-setup')
  const [theme, setTheme] = useState<ChatThemeId>(DEFAULT_CHAT_THEME)
  const [themeCustom, setThemeCustom] = useState<ChatThemeCustom>(DEFAULT_CHAT_THEME_CUSTOM)
  const [userAvatar, setUserAvatar] = useState(DEFAULT_USER_AVATAR)
  const [customAvatarDraft, setCustomAvatarDraft] = useState('')
  const [pickingAvatarImage, setPickingAvatarImage] = useState(false)
  const [weatherCity, setWeatherCity] = useState('')
  const [briefInterestDraft, setBriefInterestDraft] = useState('')
  const [briefMuteDraft, setBriefMuteDraft] = useState('')
  const [briefDigestHours, setBriefDigestHours] = useState<number[] | null>(null)
  const [briefDigestIntervalHours, setBriefDigestIntervalHours] = useState<number | undefined>(
    undefined
  )
  const [rssScoreModelRef, setRssScoreModelRef] = useState('')
  const [rssScoreMode, setRssScoreMode] = useState<RssScoreMode>('realtime')
  const [rssScoreInterval, setRssScoreInterval] = useState(30)
  const [rssPetPushMin, setRssPetPushMin] = useState<RssPetPushMinScore>(5)
  const [briefTestBusy, setBriefTestBusy] = useState(false)
  const [defaultAutonomy, setDefaultAutonomy] =
    useState<AgentAutonomy>(DEFAULT_AGENT_AUTONOMY)
  const [skillDelivery, setSkillDelivery] = useState<SkillDeliveryPref>('auto')
  const [petSkin, setPetSkin] = useState<SkinId>('violet')
  const [imageSkin, setImageSkin] = useState<string | null>(null)
  const [skinsDir, setSkinsDir] = useState('')
  const [cwd, setCwd] = useState<string>('')
  const [homeDir, setHomeDir] = useState('')
  const [defaultModelRef, setDefaultModelRef] = useState(formatModelRef('cursor', 'auto'))
  const [hooksInstalled, setHooksInstalled] = useState(false)
  const [hookDetail, setHookDetail] = useState<{
    cursor?: boolean
    claudeCode?: boolean
    codex?: boolean
    codexTrusted?: boolean | null
  }>({})
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  /** 引擎卡片默认全部折叠，点标题再展开 */
  const [openProviderId, setOpenProviderId] = useState<string | null>(null)
  const [addingProvider, setAddingProvider] = useState(false)
  const [newProv, setNewProv] = useState({
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    apiFormat: 'openai' as 'openai' | 'anthropic',
    enableThinking: false,
    models: 'gpt-4o\ngpt-4o-mini'
  })
  const [showNewApiKey, setShowNewApiKey] = useState(false)
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<string, boolean>>({})
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [templateDraft, setTemplateDraft] = useState('')
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([])
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [quickChat, setQuickChat] = useState<QuickChatSettings>(DEFAULT_QUICK_CHAT_SETTINGS)
  const [agentMemoryOn, setAgentMemoryOn] = useState(false)
  const [agentMemoryStats, setAgentMemoryStats] = useState<AgentMemoryStatsResult>({
    enabled: false,
    nodes: 0,
    edges: 0,
    recentFacts: []
  })
  const [memoryBusy, setMemoryBusy] = useState(false)

  const refreshMemoryStats = useCallback(async () => {
    try {
      const st = await window.petApi.getAgentMemoryStats()
      setAgentMemoryOn(!!st.enabled)
      setAgentMemoryStats(st)
    } catch {
      // ignore
    }
  }, [])

  const applyQuickChat = (next: QuickChatSettings): void => {
    const normalized = normalizeQuickChatSettings(next)
    setQuickChat(normalized)
    window.petApi.setQuickChat(normalized)
    onQuickChatChange?.(normalized)
  }
  const [cosyStatus, setCosyStatus] = useState<CosyVoiceStatus | null>(null)
  const [ttsVoices, setTtsVoices] = useState<TtsCustomVoice[]>([])
  const [ttsPreviewHint, setTtsPreviewHint] = useState<string | null>(null)
  const [ttsPreviewBusy, setTtsPreviewBusy] = useState(false)
  const [cosyPrepareBusy, setCosyPrepareBusy] = useState(false)
  const [newVoiceName, setNewVoiceName] = useState('')
  const [newVoiceWav, setNewVoiceWav] = useState('')
  const [newVoiceText, setNewVoiceText] = useState(DEFAULT_COSYVOICE_PROMPT_TEXT)

  const refreshCosy = useCallback(async () => {
    try {
      const [st, voices] = await Promise.all([
        window.petApi.ttsCosyStatus(),
        window.petApi.ttsListVoices()
      ])
      setCosyStatus(st)
      setTtsVoices(voices)
    } catch {
      setCosyStatus(null)
      setTtsVoices([])
    }
  }, [])

  const refresh = useCallback(async () => {
    const [settings, setup, skinDir] = await Promise.all([
      window.petApi.getSettings(),
      window.petApi.getSetupStatus(),
      window.petApi.getSkinsDir()
    ])
    const t = isChatThemeId(settings.chatTheme) ? settings.chatTheme : DEFAULT_CHAT_THEME
    setTheme(t)
    onThemeChange(t)
    const custom = normalizeChatThemeCustom(settings.chatThemeCustom)
    setThemeCustom(custom)
    onThemeCustomChange?.(custom)
    if (settings.userAvatar) {
      setUserAvatar(settings.userAvatar)
      onUserAvatarChange(settings.userAvatar)
    }
    setWeatherCity(settings.weatherCity || '')
    // 废弃全局订阅源：清掉旧配置，避免残留数据误导
    if ((settings.briefRssFeeds || []).length) {
      window.petApi.setBriefRssFeeds([])
    }
    setBriefInterestDraft((settings.briefInterestKeywords || []).join('，'))
    setBriefMuteDraft((settings.briefMuteKeywords || []).join('，'))
    const push = resolveRssScheduleValue({
      hours: settings.briefDailyDigestHours,
      legacyHour: settings.briefDailyDigestHour,
      intervalHours: settings.briefDigestIntervalHours
    })
    setBriefDigestHours(push.mode === 'daily' ? push.hours || null : null)
    setBriefDigestIntervalHours(
      push.mode === 'interval' ? push.intervalHours : undefined
    )
    setRssScoreModelRef(settings.rssScoreModelRef || '')
    setRssScoreMode(normalizeRssScoreMode(settings.rssScoreMode))
    setRssScoreInterval(normalizeRssScoreIntervalMinutes(settings.rssScoreIntervalMinutes))
    setRssPetPushMin(normalizeRssPetPushMinScore(settings.rssPetPushMinScore))
    setDefaultAutonomy(
      isAgentAutonomy(settings.defaultAgentAutonomy)
        ? settings.defaultAgentAutonomy
        : DEFAULT_AGENT_AUTONOMY
    )
    setSkillDelivery(
      isSkillDeliveryPref(settings.skillDelivery) ? settings.skillDelivery : 'auto'
    )
    if (settings.skin) setPetSkin(settings.skin)
    setImageSkin(settings.imageSkin ?? null)
    setSkinsDir(skinDir)
    setHomeDir(status?.defaultCwd || '')
    setCwd(
      settings.cwd && isSafeAgentCwd(settings.cwd, status?.defaultCwd || '')
        ? settings.cwd
        : ''
    )
    setDefaultModelRef(settings.defaultModelRef || formatModelRef('cursor', 'auto'))
    setHooksInstalled(setup.hooksInstalled)
    setHookDetail({
      cursor: setup.cursor,
      claudeCode: setup.claudeCode,
      codex: setup.codex,
      codexTrusted: setup.codexTrusted
    })
    const tree =
      settings.modelProviders?.length
        ? ensureBuiltinProviders(settings.modelProviders)
        : migrateLegacyModelPrefs(settings.models)
    setProviders(tree)
    onProvidersChange?.(tree)
    setPromptTemplates(normalizePromptTemplates(settings.promptTemplates))
    setQuickChat(normalizeQuickChatSettings(settings.quickChat))
    setAgentMemoryOn(normalizeAgentMemorySettings(settings.agentMemory).enabled)
    setTemplateDraft('')
    setEditingTemplateId(null)
    void refreshMemoryStats()
    void refreshCosy()
    // 设置打开后立刻按本机引擎对齐，并同步对话选单
    void (async () => {
      setModelsBusy(true)
      try {
        const catalog = await window.petApi.listModelCatalog()
        const next = ensureBuiltinProviders(applyModelCatalog(tree, catalog, 'enable-listed'))
        setProviders(next)
        onProvidersChange?.(next)
        const saved = await window.petApi.setModelProviders(next)
        if (saved?.length) {
          setProviders(saved)
          onProvidersChange?.(saved)
        }
      } finally {
        setModelsBusy(false)
      }
    })()
  }, [
    onThemeChange,
    onThemeCustomChange,
    onUserAvatarChange,
    onProvidersChange,
    status?.defaultCwd,
    refreshCosy,
    refreshMemoryStats
  ])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.petApi.onAgentMemoryChanged((st) => {
      setAgentMemoryOn(!!st.enabled)
      setAgentMemoryStats(st)
    })
    return off
  }, [])

  useEffect(() => {
    void window.petApi.getAppInfo().then(setAppInfo)
  }, [])

  const runUpdateCheck = useCallback(async () => {
    setUpdateChecking(true)
    try {
      setUpdate(await window.petApi.checkForUpdate())
    } catch (err) {
      setUpdate({
        status: 'error',
        current: appInfo?.version ?? '',
        message: uiText("检查更新出错：{0}", [err instanceof Error ? err.message : String(err)])
      })
    } finally {
      setUpdateChecking(false)
    }
  }, [appInfo?.version])

  // 设置页展示后台静默检查结果；进页时再静默查一次（按钮仍可手动加查）
  useEffect(() => {
    void window.petApi.getLastUpdateResult().then((r) => {
      if (r) setUpdate(r)
    })
    const off = window.petApi.onUpdateAvailable((r) => setUpdate(r))
    void runUpdateCheck()
    return off
  }, [runUpdateCheck])

  useEffect(() => {
    const root = document.querySelector('.settings-scroll')
    if (!(root instanceof HTMLElement)) return
    const ids = SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id))
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const id = hit?.target instanceof HTMLElement ? hit.target.id : ''
        if (id) setActiveNavId(id)
      },
      { root, rootMargin: '-8% 0px -72% 0px', threshold: [0, 0.25, 0.6] }
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  function persistProviders(next: ModelProvider[]): void {
    const ordered = ensureBuiltinProviders(next)
    setProviders(ordered)
    onProvidersChange?.(ordered)
    void window.petApi.setModelProviders(ordered).then((saved) => {
      if (saved?.length) {
        setProviders(saved)
        onProvidersChange?.(saved)
      }
    })
  }

  async function refreshCatalog(): Promise<void> {
    setModelsBusy(true)
    try {
      const catalog = await window.petApi.listModelCatalog()
      // enable-listed：本机扫到的引擎模型全部勾选，对话选单与设置列表对齐
      const next = ensureBuiltinProviders(applyModelCatalog(providers, catalog, 'enable-listed'))
      setProviders(next)
      onProvidersChange?.(next)
      const saved = await window.petApi.setModelProviders(next)
      if (saved?.length) {
        setProviders(saved)
        onProvidersChange?.(saved)
      }
      flash(uiText("已刷新并同步到对话选单"))
    } finally {
      setModelsBusy(false)
    }
  }

  function toggleProvider(id: string): void {
    persistProviders(providers.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
  }

  function toggleProviderModel(providerId: string, modelId: string): void {
    persistProviders(
      providers.map((p) =>
        p.id !== providerId
          ? p
          : {
              ...p,
              models: p.models.map((m) =>
                m.id === modelId ? { ...m, enabled: !m.enabled } : m
              )
            }
      )
    )
  }

  /** 某个引擎下模型全选 / 全不选。 */
  function setProviderModelsEnabled(providerId: string, enabled: boolean): void {
    persistProviders(
      providers.map((p) =>
        p.id !== providerId
          ? p
          : {
              ...p,
              enabled: enabled ? true : p.enabled,
              models: p.models.map((m) => ({ ...m, enabled }))
            }
      )
    )
    flash(enabled ? '已全选该引擎模型' : '已取消该引擎全部勾选')
  }

  /** 所有 Agent 引擎模型默认全选（并启用引擎本身）。 */
  function selectAllAgentModels(): void {
    persistProviders(
      providers.map((p) =>
        isAgentProvider(p)
          ? {
              ...p,
              enabled: true,
              models: p.models.map((m) => ({ ...m, enabled: true }))
            }
          : p
      )
    )
    flash(uiText("已默认全选全部 Agent 引擎模型"))
  }

  function moveProviderModel(providerId: string, modelId: string, dir: -1 | 1): void {
    persistProviders(
      providers.map((p) => {
        if (p.id !== providerId) return p
        const models = [...p.models]
        const idx = models.findIndex((m) => m.id === modelId)
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= models.length) return p
        ;[models[idx], models[j]] = [models[j], models[idx]]
        return { ...p, models: models.map((m, i) => ({ ...m, order: i })) }
      })
    )
  }

  function updateCustomField(
    providerId: string,
    patch: Partial<
      Pick<ModelProvider, 'baseUrl' | 'apiKey' | 'label' | 'apiFormat' | 'enableThinking'>
    >
  ): void {
    persistProviders(providers.map((p) => (p.id === providerId ? { ...p, ...patch } : p)))
  }

  function setCustomModelsText(providerId: string, text: string): void {
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const current = providers.find((p) => p.id === providerId)
    if (current && current.models.length > 0 && lines.length === 0) {
      if (!confirmDestructive(uiText("确定清空「{0}」的全部模型列表？保存后将无法从列表恢复。", [current.label]))) {
        return
      }
    }
    persistProviders(
      providers.map((p) => {
        if (p.id !== providerId) return p
        const prev = new Map(p.models.map((m) => [m.id, m]))
        return {
          ...p,
          models: lines.map((id, i) => {
            const old = prev.get(id)
            return old
              ? { ...old, order: i }
              : { id, label: id, enabled: true, order: i }
          })
        }
      })
    )
  }

  function addCustomProvider(): void {
    const id = newProv.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (
      !id ||
      id === 'cursor' ||
      id === 'openclaw' ||
      id === 'claude-code' ||
      id === 'codex' ||
      id === 'opencode'
    ) {
      flash(uiText("提供商 ID 不可用"))
      return
    }
    if (providers.some((p) => p.id === id)) {
      flash(uiText("该提供商已存在"))
      return
    }
    if (!newProv.baseUrl.trim()) {
      flash(uiText("请填写 Base URL"))
      return
    }
    const models = newProv.models
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((mid, i) => ({ id: mid, label: mid, enabled: true, order: i }))
    if (models.length === 0) {
      flash(uiText("请至少填写一个模型名（每行一个）"))
      return
    }
    persistProviders([
      ...providers,
      {
        id,
        kind: 'custom',
        label: newProv.label.trim() || id,
        enabled: true,
        order: providers.length,
        baseUrl: newProv.baseUrl.trim(),
        apiKey: newProv.apiKey,
        apiFormat: newProv.apiFormat,
        enableThinking: !!newProv.enableThinking,
        models
      }
    ])
    setAddingProvider(false)
    setShowNewApiKey(false)
    setOpenProviderId(id)
    flash(uiText("已添加 {0}", [id]))
  }

  function removeProvider(id: string): void {
    const p = providers.find((x) => x.id === id)
    if (!p || p.kind !== 'custom') return
    if (
      !confirmDestructive(
        uiText("确定删除自定义提供商「{0}」？其下 {1} 个模型配置将一并清除，且不可撤销。", [p.label, p.models.length])
      )
    ) {
      return
    }
    persistProviders(providers.filter((x) => x.id !== id))
    setRevealedApiKeys((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    flash(uiText("已删除 {0}", [p.label]))
  }

  function flash(msg: string): void {
    setHint(msg)
    window.setTimeout(() => setHint(null), 2200)
  }

  function scrollToSection(id: string): void {
    setActiveNavId(id)
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  useEffect(() => {
    if (!focusSection) return
    const id = focusSection
    const t = window.setTimeout(() => {
      setActiveNavId(id)
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      // 故意不依赖 onFocusSectionConsumed 引用：父组件常内联箭头，进 deps 会反复重滚
      onFocusSectionConsumed?.()
    }, 80)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟锚点走
  }, [focusSection])

  function pickDefaultAutonomy(id: AgentAutonomy): void {
    setDefaultAutonomy(id)
    window.petApi.setDefaultAgentAutonomy(id)
    flash(uiText("新任务默认权限：{0}", [AGENT_AUTONOMY_OPTIONS.find((o) => o.id === id)?.label ?? id]))
  }

  function pickSkillDelivery(id: SkillDeliveryPref): void {
    setSkillDelivery(id)
    window.petApi.setSkillDelivery(id)
    flash(uiText("技能投递：{0}", [SKILL_DELIVERY_OPTIONS.find((o) => o.id === id)?.label ?? id]))
  }

  async function copyText(text: string, okMsg: string): Promise<void> {
    const ok = await writeClipboardText(text)
    flash(ok ? okMsg : '复制失败，请直接选中下方命令')
  }

  async function assistEngineInstall(engineId: EngineSetupId): Promise<void> {
    const guide = ENGINE_SETUP_GUIDES.find((g) => g.id === engineId)
    const label = guide?.label ?? engineId
    setSetupBusy(`install:${engineId}`)
    try {
      const r = await window.petApi.installEngineCli(engineId)
      onStatusRefresh?.()
      if (r.ok) {
        flash(
          guide && canOneClickLogin(guide)
            ? `${label} 已安装，请点「一键登录」`
            : `${label} 已安装，请刷新选单`
        )
      } else {
        const cmd = guide
          ? installCommandForPlatform(guide, appInfo?.platform || 'darwin')
          : undefined
        if (cmd) await copyText(cmd, uiText("安装失败：命令已复制，请到终端手动执行"))
        else flash(r.log?.slice(-200) || `${label} 安装失败`)
      }
    } finally {
      setSetupBusy(null)
    }
  }

  function assistEngineLogin(engineId: EngineSetupId): void {
    const guide = ENGINE_SETUP_GUIDES.find((g) => g.id === engineId)
    const label = guide?.label ?? engineId
    window.petApi.engineCliLogin(engineId)
    flash(uiText("已打开 {0} 登录（按终端/浏览器提示完成）", [label]))
    window.setTimeout(() => onStatusRefresh?.(), 2000)
  }

  function engineInstalled(id: EngineSetupId): boolean | undefined {
    if (id === 'custom-api') {
      return providers.some((p) => !isAgentProvider(p) && !!p.apiKey?.trim())
    }
    return engines.find((e) => e.id === id)?.installed
  }

  function pickTheme(id: ChatThemeId): void {
    setTheme(id)
    onThemeChange(id)
    window.petApi.setChatTheme(id)
    flash(uiText("已切换到「{0}」", [CHAT_THEMES.find((t) => t.id === id)?.name]))
  }

  function patchThemeCustom(key: keyof ChatThemeCustom, value: string): void {
    const next = { ...themeCustom, [key]: value }
    setThemeCustom(next)
    onThemeCustomChange?.(next)
    window.petApi.setChatThemeCustom(next)
    if (theme !== 'custom') {
      setTheme('custom')
      onThemeChange('custom')
      window.petApi.setChatTheme('custom')
    }
  }

  function pickAvatar(emoji: string): void {
    const e = sanitizeUserAvatar(emoji)
    if (!e) return
    setUserAvatar(e)
    onUserAvatarChange(e)
    window.petApi.setUserAvatar(e)
  }

  function applyCustomAvatar(): void {
    const e = sanitizeUserAvatar(customAvatarDraft)
    if (!e) {
      flash(uiText("请贴一个 emoji（字母/数字不行）"))
      return
    }
    pickAvatar(e)
    setCustomAvatarDraft('')
    flash(uiText("已设置自定义头像"))
  }

  async function pickImageAvatar(): Promise<void> {
    if (pickingAvatarImage) return
    setPickingAvatarImage(true)
    try {
      const url = await window.petApi.pickUserAvatarImage()
      if (!url) {
        flash(uiText("已取消"))
        return
      }
      setUserAvatar(url)
      onUserAvatarChange(url)
      flash(uiText("已设置图片头像"))
    } catch {
      flash(uiText("选图失败"))
    } finally {
      setPickingAvatarImage(false)
    }
  }

  async function applyWeatherCity(city: string): Promise<void> {
    const next = city.trim()
    setWeatherCity(next)
    window.petApi.setWeatherCity(next)
    flash(next ? `正在校验「${next}」…` : '留空=按 IP；失败则约估（建议手填）')
    try {
      const w = await window.petApi.refreshWeather()
      if (!w) {
        flash(next ? `「${next}」天气拉取失败，请检查网络或换写法` : '自动定位失败，请手填城市')
        return
      }
      flash(w.approx ? `约估：${w.place}（建议手填城市）` : `已定位：${w.place}`)
    } catch {
      flash(uiText("天气校验失败"))
    }
  }

  function applyBriefInterest(): void {
    const keywords = briefInterestDraft
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    window.petApi.setBriefInterestKeywords(keywords)
    setBriefInterestDraft(keywords.join('，'))
    flash(
      keywords.length
        ? `兴趣词 ${keywords.length} 个：气泡只盯匹配项`
        : '已清空兴趣词：所有新条目都会计未读'
    )
  }

  function applyBriefMute(): void {
    const keywords = briefMuteDraft
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    window.petApi.setBriefMuteKeywords(keywords)
    setBriefMuteDraft(keywords.join('，'))
    flash(keywords.length ? `屏蔽词 ${keywords.length} 个已生效` : '已清空屏蔽词')
  }

  function savePushSchedule(next: ReturnType<typeof resolveRssScheduleValue>): void {
    if (next.mode === 'interval' && next.intervalHours != null) {
      setBriefDigestIntervalHours(next.intervalHours)
      setBriefDigestHours(null)
      window.petApi.setBriefDigestIntervalHours(next.intervalHours)
      flash(uiText("宠物推送：{0}", [formatRssScheduleLabel(next)]))
      return
    }
    if (next.mode === 'daily' && next.hours?.length) {
      setBriefDigestHours(next.hours)
      setBriefDigestIntervalHours(undefined)
      window.petApi.setBriefDailyDigestHours(next.hours)
      flash(uiText("宠物推送：{0}", [formatRssScheduleLabel(next)]))
      return
    }
    setBriefDigestHours(null)
    setBriefDigestIntervalHours(undefined)
    window.petApi.setBriefDailyDigestHours(null)
    window.petApi.setBriefDigestIntervalHours(null)
    flash(uiText("已关闭宠物推送"))
  }

  const pushSchedule = resolveRssScheduleValue({
    hours: briefDigestHours,
    intervalHours: briefDigestIntervalHours
  })

  async function testRefreshBrief(): Promise<void> {
    setBriefTestBusy(true)
    try {
      const snap = await window.petApi.refreshBriefInbox()
      flash(uiText("已刷新 · 未读 {0}", [briefUnreadCount(snap)]))
    } catch {
      flash(uiText("刷新失败，请检查网络"))
    } finally {
      setBriefTestBusy(false)
    }
  }

  function testPreviewDigest(): void {
    window.petApi.previewBriefDigest()
    flash(uiText("已在宠物旁播一条简报气泡"))
  }

  async function pickCwd(): Promise<void> {
    const dir = await window.petApi.pickWorkingDir(cwd || undefined)
    if (!dir) return
    if (isUserHomeDir(dir, homeDir || status?.defaultCwd || '')) {
      flash(UNSAFE_CWD_MESSAGE)
      return
    }
    setCwd(dir)
    window.petApi.setCwd(dir)
    flash(uiText("默认工作目录：{0}", [displayPath(dir, homeDir)]))
  }

  async function configureHooks(): Promise<void> {
    setBusy(true)
    const r = await window.petApi.configureIntegration()
    setBusy(false)
    if (r.ok) {
      const setup = await window.petApi.getSetupStatus()
      setHooksInstalled(setup.hooksInstalled)
      setHookDetail({
        cursor: setup.cursor,
        claudeCode: setup.claudeCode,
        codex: setup.codex,
        codexTrusted: setup.codexTrusted
      })
      if (r.codexTrustOk === false) {
        flash(
          uiText("联动已写入，但 Codex 未信任：{0}", [r.codexTrustError || '请重启 ChatGPT 或再点配置'])
        )
      } else if (setup.codexTrusted === false) {
        flash(uiText("联动已写入，但 Codex hooks 仍未信任（ChatGPT 会静默跳过）"))
      } else {
        flash(uiText("已配置 Cursor / Claude / Codex 联动"))
      }
    } else {
      flash(r.error || '配置失败')
    }
  }

  async function removeHooks(): Promise<void> {
    if (
      !confirmDestructive(
        uiText("确定移除各引擎联动 hooks？Cursor / Claude Code / Codex 将不再驱动宠物，需重新配置才能恢复。")
      )
    ) {
      return
    }
    setBusy(true)
    const r = await window.petApi.removeIntegration()
    setBusy(false)
    if (r.ok) {
      setHooksInstalled(false)
      setHookDetail({})
      flash(uiText("已移除引擎联动"))
    } else {
      flash(r.error || '移除失败')
    }
  }

  const engines = status?.engines ?? []

  function formatPlatform(platform: string, arch: string): string {
    const os =
      platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform
    const chip =
      arch === 'arm64'
        ? platform === 'darwin'
          ? 'Apple Silicon'
          : 'ARM64'
        : arch === 'x64'
          ? platform === 'darwin'
            ? 'Intel'
            : 'x64'
          : arch
    return `${os} · ${chip}`
  }

  /** 去掉与引擎名重复的前缀，压缩过长 build 串。 */
  function formatEngineVersion(label: string, version?: string): string | undefined {
    if (!version) return undefined
    let v = version.trim()
    const prefixes = [label, label.replace(/\s+Agent$/i, '')]
    for (const p of prefixes) {
      const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i')
      v = v.replace(re, '')
    }
    v = v.replace(/^[vV]/, '').trim()
    if (v.length > 28) {
      const m = v.match(/^([\w.-]+)\s*\(([0-9a-f]{7,})\)/i)
      if (m) return `${m[1]} (${m[2].slice(0, 7)})`
      return `${v.slice(0, 24)}…`
    }
    return v || undefined
  }

  function engineStatusText(e: (typeof engines)[number]): string {
    if (!e.supported) return e.note || '计划中'
    if (!e.installed) return e.note || '未安装'
    return formatEngineVersion(e.label || e.id, e.version) || '已就绪'
  }

  function buildDiagnosticsText(): string {
    if (!appInfo) return ''
    const lines = [
      `${appInfo.name} v${appInfo.version}`,
      `作者 ${appInfo.author}`,
      `系统 ${formatPlatform(appInfo.platform, appInfo.arch)} (${appInfo.platform}/${appInfo.arch})`,
      `Electron ${appInfo.electron} · Chromium ${appInfo.chrome} · Node ${appInfo.node}`,
      '',
      '引擎'
    ]
    for (const e of engines) {
      const ver = e.installed
        ? formatEngineVersion(e.label || e.id, e.version) || e.version || '已就绪'
        : e.note || '未安装'
      lines.push(`- ${e.label || e.id}: ${e.installed ? '已安装' : '未安装'} · ${ver}`)
    }
    return appendDiagnosticsExtras(lines.join('\n'), {
      imageSkinId: imageSkin,
      vectorSkinId: petSkin,
      updateStatus: update?.status,
      updateLatest: update?.latest
    })
  }

  async function copyDiagnostics(): Promise<void> {
    const text = buildDiagnosticsText()
    if (!text) return
    await copyText(text, uiText("已复制诊断信息"))
  }

  function persistTemplates(next: PromptTemplate[]): void {
    const normalized = normalizePromptTemplates(next)
    setPromptTemplates(normalized)
    window.petApi.setPromptTemplates(normalized)
  }

  function loadTemplateToDraft(id: string | null, name: string, content: string): void {
    setTemplateDraft(content)
    setEditingTemplateId(id)
    setSaveName(name)
    flash(uiText("已载入「{0}」到草稿", [name]))
  }

  function saveCurrentAsTemplate(): void {
    const name = saveName.trim() || '未命名模版'
    const content = templateDraft
    if (!content.trim()) {
      flash(uiText("请先填写模版内容再保存"))
      return
    }
    const existing = promptTemplates.find((t) => t.name === name)
    const now = Date.now()
    let next: PromptTemplate[]
    let id: string
    if (existing) {
      id = existing.id
      next = promptTemplates.map((t) =>
        t.id === existing.id ? { ...t, content, updatedAt: now } : t
      )
      flash(uiText("已更新模版「{0}」", [name]))
    } else {
      id = newPromptTemplateId()
      next = [...promptTemplates, { id, name, content, updatedAt: now }]
      flash(uiText("已保存模版「{0}」", [name]))
    }
    persistTemplates(next)
    setEditingTemplateId(id)
    setSaveName(name)
  }

  function overwriteEditingTemplate(): void {
    if (!editingTemplateId) {
      flash(uiText("请先从下方选用一个已保存模版"))
      return
    }
    const t = promptTemplates.find((x) => x.id === editingTemplateId)
    if (!t) {
      flash(uiText("当前模版不存在"))
      return
    }
    if (!templateDraft.trim()) {
      flash(uiText("模版内容不能为空"))
      return
    }
    const next = promptTemplates.map((x) =>
      x.id === t.id
        ? {
            ...x,
            name: saveName.trim() || t.name,
            content: templateDraft,
            updatedAt: Date.now()
          }
        : x
    )
    persistTemplates(next)
    flash(uiText("已覆盖「{0}」", [saveName.trim() || t.name]))
  }

  function deleteTemplate(id: string): void {
    const t = promptTemplates.find((x) => x.id === id)
    if (!t) return
    if (!confirmDestructive(uiText("确定删除模版「{0}」？", [t.name]))) return
    const next = promptTemplates.filter((x) => x.id !== id)
    persistTemplates(next)
    if (editingTemplateId === id) {
      setEditingTemplateId(null)
      setTemplateDraft('')
      setSaveName('')
    }
    flash(uiText("已删除「{0}」", [t.name]))
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <div>
          <h2>{uiText("设置")}</h2>
          <p className="settings-sub">
            {uiText("左侧按模块跳转")}{appInfo ? ` · v${appInfo.version}` : ''}
          </p>
        </div>
        <button
          className="icon-btn"
          title={uiText("返回对话")}
          aria-label={uiText("返回对话")}
          onClick={() => onClose(providers)}
        >
          ✕
        </button>
      </div>

      {hint && <div className="settings-hint">{hint}</div>}

      {!weatherCity.trim() && (
        <div className="settings-banner" role="status">
          {uiText("尚未指定天气城市：碎碎念可能按 VPN 出口误判地点。")}<button
            type="button"
            className="settings-btn ghost"
            onClick={() => scrollToSection('settings-weather')}
          >
            {uiText("去设置")}</button>
        </div>
      )}

      <div className="settings-body">
        <nav className="settings-toc" aria-label={uiText("设置目录")}>
          {SETTINGS_NAV.map((group) => (
            <div key={group.title} className="settings-toc-group">
              <div className="settings-toc-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-toc-item${activeNavId === item.id ? ' is-active' : ''}`}
                  aria-current={activeNavId === item.id ? 'true' : undefined}
                  onClick={() => scrollToSection(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-scroll">
        <LanguageSelector />
        <section className="settings-section" id="settings-setup">
          <h3>{uiText("上手说明")}</h3>
          <p className="settings-desc">
            {uiText("两条目标别混：只想桌宠跟 IDE 动 → 配置联动即可；要在本窗口真实对话 → 再装 CLI / 自定义 API，并选项目目录。")}</p>
          <div className="goal-cards settings-goal-cards">
            <div className={`goal-card ${hooksInstalled ? 'is-done' : ''}`}>
              <div className="goal-card-kicker">{uiText("目标 A · 推荐")}</div>
              <strong>{uiText("宠物跟着 Cursor IDE 动")}</strong>
              <p>{uiText("只装 Cursor 应用。配置联动后，在 IDE 里跑 Agent，桌宠会动、完成会通知。")}</p>
              <p className="goal-card-note">{uiText("不需要 cursor-agent CLI")}</p>
              <button
                type="button"
                className="setup-btn"
                disabled={busy}
                onClick={() => scrollToSection('settings-hooks')}
              >
                {hooksInstalled ? uiText("去看联动配置") : uiText("去配置 IDE 联动")}
              </button>
            </div>
            <div
              className={`goal-card ${
                status?.anyAgentInstalled || (status && !status.usingMock) ? 'is-done' : ''
              }`}
            >
              <div className="goal-card-kicker">{uiText("目标 B")}</div>
              <strong>{uiText("在本窗口真实对话")}</strong>
              <p>{uiText("需要本机 Agent CLI 或自定义 API，并选好项目目录（不能用主目录）。")}</p>
              <p className="goal-card-note">{uiText("安装命令与文档收在下方说明里")}</p>
            </div>
          </div>
          <details className="settings-help-fold">
            <summary>{uiText("各引擎安装命令与文档")}</summary>
            <p className="settings-desc tight">
              {uiText("这是说明，不是日常设置。装好之后一般不用再打开。")}</p>
          <div className="engine-setup-list">
            {ENGINE_SETUP_GUIDES.map((g) => {
              const installed = engineInstalled(g.id)
              const platform = appInfo?.platform || 'darwin'
              const cmd = installCommandForPlatform(g, platform)
              return (
                <article
                  key={g.id}
                  className={`engine-setup-card ${installed ? 'is-ready' : ''}`}
                >
                  <div className="engine-setup-head">
                    <strong>{g.label}</strong>
                    <span
                      className={`engine-setup-badge ${installed ? 'on' : 'off'}`}
                    >
                      {installed === undefined
                        ? '—'
                        : installed
                          ? uiText("已就绪")
                          : uiText("未检测到")}
                    </span>
                  </div>
                  <p className="engine-setup-blurb">{g.blurb}</p>
                  <p className="engine-setup-next">{g.nextSteps}</p>
                  {platform === 'win32' && g.installHintWin && (
                    <p className="settings-desc tight">{g.installHintWin}</p>
                  )}
                  {(cmd || g.loginCmd) && (
                    <div className="engine-setup-cmds">
                      {cmd && (
                        <label className="engine-setup-cmd">
                          <span>{uiText("安装")}</span>
                          <code tabIndex={0}>{cmd}</code>
                        </label>
                      )}
                      {g.loginCmd && (
                        <label className="engine-setup-cmd">
                          <span>{uiText("登录")}</span>
                          <code tabIndex={0}>{g.loginCmd}</code>
                        </label>
                      )}
                    </div>
                  )}
                  <div className="engine-setup-actions">
                    {canOneClickInstall(g, platform) && (
                      <button
                        type="button"
                        className="settings-btn tiny"
                        disabled={setupBusy === `install:${g.id}`}
                        onClick={() => void assistEngineInstall(g.id)}
                      >
                        {setupBusy === `install:${g.id}` ? uiText("安装中…") : uiText("一键安装 CLI")}
                      </button>
                    )}
                    {canOneClickLogin(g) && (
                      <button
                        type="button"
                        className="settings-btn ghost tiny"
                        onClick={() => assistEngineLogin(g.id)}
                      >
                        {uiText("一键登录")}</button>
                    )}
                    {g.appAssist?.includes('hooks') && (
                      <button
                        type="button"
                        className="settings-btn ghost tiny"
                        onClick={() => scrollToSection('settings-hooks')}
                      >
                        {uiText("去配置联动")}</button>
                    )}
                    {g.appAssist?.includes('open-api-settings') && (
                      <button
                        type="button"
                        className="settings-btn tiny"
                        onClick={() => {
                          setAddingProvider(true)
                          scrollToSection('settings-api')
                        }}
                      >
                        {uiText("添加 API")}</button>
                    )}
                    {cmd && (
                      <button
                        type="button"
                        className="settings-btn ghost tiny"
                        title={cmd}
                        onClick={() => void copyText(cmd, uiText("安装命令已复制"))}
                      >
                        {uiText("复制安装命令")}</button>
                    )}
                    {g.loginCmd && (
                      <button
                        type="button"
                        className="settings-btn ghost tiny"
                        title={g.loginCmd}
                        onClick={() => void copyText(g.loginCmd!, uiText("登录命令已复制"))}
                      >
                        {uiText("复制登录命令")}</button>
                    )}
                    {g.docsUrl && (
                      <button
                        type="button"
                        className="settings-btn ghost tiny"
                        onClick={() => window.petApi.openExternal(g.docsUrl!)}
                      >
                        {uiText("打开文档")}</button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          <div className="settings-row" style={{ marginTop: 10, gap: 8 }}>
            <button
              type="button"
              className="settings-btn ghost"
              disabled={modelsBusy}
              onClick={() => {
                onStatusRefresh?.()
                void refreshCatalog()
              }}
            >
              {uiText("重新检测并同步模型")}</button>
          </div>
          </details>
        </section>

        <section className="settings-section" id="settings-weather">
          <h3>{uiText("天气")}</h3>
          <p className="settings-desc">{uiText("影响碎碎念里的天气；开 VPN 时建议手填城市，别靠自动定位。")}</p>
          <input
            className="settings-input"
            placeholder={uiText("上海 / Beijing（空=按 IP 自动）")}
            value={weatherCity}
            maxLength={64}
            onChange={(e) => setWeatherCity(e.target.value)}
            onBlur={() => void applyWeatherCity(weatherCity)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void applyWeatherCity(weatherCity)
              }
            }}
          />
          <div className="city-chip-row">
            <button
              type="button"
              className={`city-chip ${!weatherCity.trim() ? 'on' : ''}`}
              onClick={() => void applyWeatherCity('')}
            >
              {uiText("自动")}</button>
            {WEATHER_CITY_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`city-chip ${weatherCity === c ? 'on' : ''}`}
                onClick={() => void applyWeatherCity(c)}
              >
                {uiText(c)}
              </button>
            ))}
          </div>
          <div className="settings-actions-row">
            <button
              type="button"
              className="settings-btn ghost tiny"
              onClick={() => void applyWeatherCity(weatherCity)}
            >
              {uiText("立即刷新天气")}</button>
          </div>
        </section>

        <section className="settings-section" id="settings-rss">
          <h3>RSS</h3>
          <p className="settings-desc">
            {uiText("订阅源在「RSS 订阅」任务里添加与管理。宠物气泡只推任务里实际订阅的源；此处配置过滤、评分与推送节奏。")}</p>

          <div className="settings-block">
            <h4 className="settings-subhead">{uiText("过滤")}</h4>
            <div className="settings-brief-filters">
              <div>
                <label className="settings-label" htmlFor="settings-brief-interest">
                  {uiText("兴趣词")}</label>
                <input
                  id="settings-brief-interest"
                  className="settings-input"
                  placeholder={uiText("逗号分隔，如 AI，Rust（空=全收）")}
                  value={briefInterestDraft}
                  maxLength={200}
                  onChange={(e) => setBriefInterestDraft(e.target.value)}
                  onBlur={() => applyBriefInterest()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applyBriefInterest()
                    }
                  }}
                />
              </div>
              <div>
                <label className="settings-label" htmlFor="settings-brief-mute">
                  {uiText("屏蔽词")}</label>
                <input
                  id="settings-brief-mute"
                  className="settings-input"
                  placeholder={uiText("逗号分隔，如 招聘，广告")}
                  value={briefMuteDraft}
                  maxLength={200}
                  onChange={(e) => setBriefMuteDraft(e.target.value)}
                  onBlur={() => applyBriefMute()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applyBriefMute()
                    }
                  }}
                />
              </div>
            </div>
            <p className="settings-desc tight">{uiText("失焦或回车保存。兴趣词收窄未读；屏蔽词直接丢掉。")}</p>
          </div>

          <div className="settings-block">
            <h4 className="settings-subhead">{uiText("评分")}</h4>
            <p className="settings-desc tight">
              {uiText("对话里 RSS 任务打分与写简报用。可选大模型直连或 Agent 引擎；空则走规则。Agent 需已选安全工作目录。")}</p>
            <label className="settings-label">{uiText("评分 / 简报模型")}</label>
            <ModelPicker
              className="settings-rss-intel-picker"
              providers={providers}
              value={rssScoreModelRef}
              allowEmpty
              emptyLabel={uiText("规则 + 兴趣词（不调模型）")}
              title={uiText("评分与简报模型")}
              onChange={(v) => {
                setRssScoreModelRef(v)
                window.petApi.setRssScoreModelRef(v)
                flash(v ? '已保存评分/简报模型' : '已改为规则/关键词评分')
              }}
            />
            <h4 className="settings-subhead">{uiText("节奏")}</h4>
            <p className="settings-desc tight">
              {uiText("CPET 启动后就会按节奏后台拉源，不必先打开 RSS 任务。下列选项管间隔，以及何时评分。")}</p>
            <div className="city-chip-row">
              {(
                [
                  ['realtime', uiText("实时")],
                  ['interval', uiText("定时")],
                  ['off', uiText("仅手动")]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`city-chip ${rssScoreMode === id ? 'on' : ''}`}
                  title={
                    id === 'realtime'
                      ? uiText("启动即拉源；约 8 分钟后台再拉；进任务后新条目即评")
                      : id === 'interval'
                        ? uiText("启动即拉源；按间隔后台再拉；进任务后按间隔评分")
                        : uiText("不后台拉源；进任务或点刷新才更新")
                  }
                  onClick={() => {
                    setRssScoreMode(id)
                    window.petApi.setRssScoreMode(id)
                    flash(
                      id === 'realtime'
                        ? '实时：启动后拉源 · 约 8 分钟再拉 · 进任务后新条目即评'
                        : id === 'interval'
                          ? '定时：启动后按间隔拉源；进任务后按间隔评分'
                          : '仅手动：不后台拉源，进任务或点刷新才更新'
                    )
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {rssScoreMode === 'interval' ? (
              <>
                <h4 className="settings-subhead">{uiText("定时间隔")}</h4>
                <div className="city-chip-row">
                  {RSS_SCORE_INTERVALS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`city-chip ${rssScoreInterval === m ? 'on' : ''}`}
                      onClick={() => {
                        setRssScoreInterval(m)
                        window.petApi.setRssScoreIntervalMinutes(m)
                        flash(uiText("每 {0} 分钟拉源并评分", [m]))
                      }}
                    >
                      {m} {uiText("分")}</button>
                  ))}
                </div>
              </>
            ) : null}
            <h4 className="settings-subhead">{uiText("气泡提醒门槛")}</h4>
            <p className="settings-desc tight">
              {uiText("空闲时优先播达到此档的未读；点气泡可进任务。默认只推「必读」。")}</p>
            <div className="city-chip-row">
              {([5, 4, 3] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`city-chip ${rssPetPushMin === m ? 'on' : ''}`}
                  onClick={() => {
                    setRssPetPushMin(m)
                    window.petApi.setRssPetPushMinScore(m)
                    flash(uiText("气泡提醒：{0}", [rssPetPushMinScoreLabel(m)]))
                  }}
                >
                  {rssPetPushMinScoreLabel(m)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("宠物推送")}</h4>
              <span className="settings-block-meta">{formatRssScheduleLabel(pushSchedule)}</span>
            </div>
            <p className="settings-desc tight">{uiText("到点刷新收件箱并轻播未读要点。")}</p>
            <RssScheduleFields value={pushSchedule} onChange={savePushSchedule} offLabel={uiText("关")} />
            <div className="settings-actions-row">
              <button
                type="button"
                className="settings-btn ghost tiny"
                disabled={briefTestBusy}
                onClick={() => void testRefreshBrief()}
              >
                {briefTestBusy ? uiText("刷新中…") : uiText("立即刷新")}
              </button>
              <button
                type="button"
                className="settings-btn ghost tiny"
                onClick={() => testPreviewDigest()}
              >
                {uiText("预览气泡")}</button>
            </div>
          </div>

        </section>

        <section className="settings-section" id="settings-theme">
          <h3>{uiText("对话框")}</h3>
          <p className="settings-desc">{uiText("聊天窗整体色调，立即生效；也可选「自定义」调色")}</p>
          <div className="theme-grid">
            {CHAT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-card ${theme === t.id ? 'on' : ''}`}
                onClick={() => pickTheme(t.id)}
                style={
                  {
                    ['--swatch-bg']:
                      t.id === 'custom' ? themeCustom.paper : t.swatch.bg,
                    ['--swatch-ink']:
                      t.id === 'custom' ? themeCustom.ink : t.swatch.ink,
                    ['--swatch-accent']:
                      t.id === 'custom' ? themeCustom.accent : t.swatch.accent
                  } as CSSProperties
                }
              >
                <span className="theme-swatch" aria-hidden>
                  <span className="theme-swatch-bar" />
                </span>
                <span className="theme-meta">
                  <strong>{t.name}</strong>
                  <span>{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
          {theme === 'custom' && (
            <>
              <div className="theme-custom-panel" aria-label={uiText("自定义配色")}>
                {(
                  [
                    ['paper', uiText("背景")],
                    ['paper2', uiText("次级底")],
                    ['ink', uiText("正文")],
                    ['inkDim', uiText("次要字")],
                    ['accent', uiText("强调色")],
                    ['accent2', uiText("辅色")]
                  ] as Array<[keyof ChatThemeCustom, string]>
                ).map(([key, label]) => (
                  <label key={key} className="theme-color-row">
                    <span>{label}</span>
                    <input
                      type="color"
                      value={themeCustom[key]}
                      onInput={(e) =>
                        patchThemeCustom(key, (e.target as HTMLInputElement).value)
                      }
                      onChange={(e) => patchThemeCustom(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <div
                className="theme-preview"
                style={
                  {
                    ['--paper']: themeCustom.paper,
                    ['--paper-2']: themeCustom.paper2,
                    ['--ink']: themeCustom.ink,
                    ['--ink-dim']: themeCustom.inkDim,
                    ['--accent']: themeCustom.accent,
                    ['--accent-2']: themeCustom.accent2
                  } as CSSProperties
                }
              >
                <div className="theme-preview-bubble them">{uiText("你好，今天怎么样？")}</div>
                <div className="theme-preview-bubble me">{uiText("还不错，一起开干～")}</div>
                <div className="theme-preview-bar">{uiText("输入消息…")}</div>
              </div>
            </>
          )}
        </section>

        <section className="settings-section" id="settings-avatar">
          <h3>{uiText("你的头像")}</h3>
          <p className="settings-desc">{uiText("点选 emoji、粘贴 emoji，或选一张本地图片")}</p>
          <div className="avatar-grid">
            {USER_AVATAR_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                className={`avatar-chip ${!isUserAvatarImage(userAvatar) && userAvatar === e ? 'on' : ''}`}
                onClick={() => pickAvatar(e)}
                aria-label={uiText("头像 {0}", [e])}
              >
                {e}
              </button>
            ))}
            {isUserAvatarImage(userAvatar) ? (
              <button type="button" className="avatar-chip avatar-chip-img on" title={uiText("当前图片头像")}>
                <img src={userAvatar} alt="" draggable={false} />
              </button>
            ) : (
              !(USER_AVATAR_CHOICES as readonly string[]).includes(userAvatar) &&
              userAvatar && (
                <button type="button" className="avatar-chip on" title={uiText("当前自定义头像")}>
                  {userAvatar}
                </button>
              )
            )}
          </div>
          <div className="avatar-custom-row">
            <input
              className="settings-input"
              placeholder={uiText("自定义 emoji，如 🚀")}
              value={customAvatarDraft}
              maxLength={16}
              onChange={(e) => setCustomAvatarDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyCustomAvatar()
                }
              }}
            />
            <button type="button" className="settings-btn ghost" onClick={applyCustomAvatar}>
              {uiText("应用")}</button>
            <button
              type="button"
              className="settings-btn"
              disabled={pickingAvatarImage}
              onClick={() => void pickImageAvatar()}
            >
              {pickingAvatarImage ? uiText("选择中…") : uiText("选图片")}
            </button>
          </div>
        </section>

        <section className="settings-section" id="settings-pet">
          <h3>{uiText("宠物外观")}</h3>
          <p className="settings-desc">
            {uiText("切换 / 下载 / 导入请在宠物旁的「皮肤市场」窗口完成。这里只看当前选用，避免和右键快切各搞一套。")}</p>
          <div className="settings-appearance-summary">
            <div>
              <strong>
                {
                  describeAppearance({
                    skin: petSkin,
                    skinName: SKINS.find((s) => s.id === petSkin)?.name,
                    imageSkin
                  }).label
                }
              </strong>
              <span className="settings-desc tight" style={{ display: 'block', marginTop: 2 }}>
                {
                  describeAppearance({
                    skin: petSkin,
                    skinName: SKINS.find((s) => s.id === petSkin)?.name,
                    imageSkin
                  }).detail
                }
                {uiText("（与桌面宠物同步）")}</span>
            </div>
            <div className="settings-row" style={{ gap: 8, marginTop: 0 }}>
              <button
                type="button"
                className="settings-btn"
                onClick={() => onOpenSkinMarket?.()}
              >
                {uiText("打开皮肤市场")}</button>
              <button
                type="button"
                className="settings-btn ghost"
                onClick={() => window.petApi.openSkinsDir()}
              >
                {uiText("打开目录")}</button>
            </div>
          </div>
          {skinsDir ? (
            <p className="settings-desc tight skin-dir-one" title={skinsDir}>
              {uiText("皮肤目录：")}<code>{skinsDir}</code>
            </p>
          ) : null}
        </section>

        <section className="settings-section" id="settings-quick-chat" aria-label={uiText("快速对话")}>
          <h3>{uiText("快速对话")}</h3>
          <p className="settings-desc">
            {uiText("点宠物旁「麦」按钮，或用下方快捷键打开：大窗未聚焦时在宠边输入；对话窗聚焦时进当前任务。对话窗内快捷键优先（聚焦对话时本快捷键不生效）。")}</p>
          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("开关与快捷键")}</h4>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={quickChat.enabled}
                onChange={(e) => {
                  const next = { ...quickChat, enabled: e.target.checked }
                  setQuickChat(next)
                  window.petApi.setQuickChat(next)
                }}
              />
              <span>{uiText("启用快速对话")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={quickChat.autoSend}
                onChange={(e) => {
                  const next = { ...quickChat, autoSend: e.target.checked }
                  setQuickChat(next)
                  window.petApi.setQuickChat(next)
                }}
              />
              <span>{uiText("说完自动发送")}</span>
            </label>
            <label className="settings-field">
              <span>{uiText("打开快捷键")}</span>
              <input
                className="settings-input"
                value={quickChat.hotkey ?? DEFAULT_QUICK_CHAT_HOTKEY}
                placeholder={DEFAULT_QUICK_CHAT_HOTKEY}
                title={uiText("Electron accelerator，如 CommandOrControl+Shift+Space；留空关闭快捷键")}
                onChange={(e) => {
                  const next = { ...quickChat, hotkey: e.target.value }
                  setQuickChat(next)
                  window.petApi.setQuickChat(next)
                }}
              />
            </label>
            <p className="settings-desc tight">
              {uiText("默认 ⌘⇧Space（Windows/Linux 为 Ctrl+Shift+Space）。清空输入框可关闭快捷键。")}</p>
          </div>
          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("回复朗读（TTS）")}</h4>
            </div>
            <p className="settings-desc tight">
              {uiText("默认关闭。开启后默认用 EdgeTTS（需联网、免安装，和小智默认引擎同类）；CosyVoice 本机可作高品质/音色克隆可选引擎。")}</p>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={isTtsEngineOn(quickChat.tts)}
                disabled={cosyPrepareBusy}
                onChange={(e) => {
                  setTtsPreviewHint(null)
                  if (!e.target.checked) {
                    stopTtsPlayback()
                    applyQuickChat({
                      ...quickChat,
                      tts: 'off' as TtsMode,
                      ttsAutoSpeak: false
                    })
                    return
                  }
                  // 开启默认走 EdgeTTS；自动朗读仍保持关，需用户再勾
                  applyQuickChat({
                    ...quickChat,
                    tts: 'edge' as TtsMode,
                    ttsAutoSpeak: false,
                    ttsEdgeVoice: quickChat.ttsEdgeVoice || DEFAULT_EDGE_TTS_VOICE
                  })
                }}
              />
              <span>{uiText("开启 TTS")}</span>
            </label>
            {isTtsEngineOn(quickChat.tts) ? (
              <>
                <p className="settings-desc">
                  <label>
                    <input
                      type="checkbox"
                      checked={quickChat.ttsAutoSpeak === true}
                      onChange={(e) => {
                        applyQuickChat({ ...quickChat, ttsAutoSpeak: e.target.checked })
                      }}
                    />{' '}
                    {uiText("生成时短句流式朗读（对话 / RSS 缺省，默认关）")}</label>
                </p>
                <p className="settings-desc tight">
                  {uiText("任务顶栏才出现「自动朗读」；缺省关，可按任务再开。消息旁可点播。")}</p>
                <label className="settings-field">
                  <span>{uiText("引擎")}</span>
                  <select
                    className="settings-select"
                    value={quickChat.tts === 'local' ? 'local' : 'edge'}
                    onChange={(e) => {
                      void (async () => {
                        const v = e.target.value === 'local' ? 'local' : 'edge'
                        setTtsPreviewHint(null)
                        if (v === 'edge') {
                          applyQuickChat({ ...quickChat, tts: 'edge' as TtsMode })
                          return
                        }
                        // 切到 CosyVoice：若未装好则触发安装
                        const next = { ...quickChat, tts: 'local' as TtsMode }
                        applyQuickChat(next)
                        if (cosyStatus?.modelReady && cosyStatus?.managedEnv) {
                          setTtsPreviewHint('已切换到 CosyVoice 本机')
                          return
                        }
                        setCosyPrepareBusy(true)
                        const poll = window.setInterval(() => {
                          void refreshCosy()
                        }, 1500)
                        try {
                          const res = await window.petApi.ttsCosyInstall()
                          if (!res.ok) {
                            setTtsPreviewHint(res.error)
                            applyQuickChat({ ...next, tts: 'edge' as TtsMode })
                            return
                          }
                          applyQuickChat({
                            ...next,
                            tts: 'local' as TtsMode,
                            cosyvoiceRoot: res.cosyRoot
                          })
                          setTtsPreviewHint(
                            res.warning ? res.warning : `已安装：${res.modelDir}`
                          )
                          await refreshCosy()
                          const settings = await window.petApi.getSettings()
                          applyQuickChat(normalizeQuickChatSettings(settings.quickChat))
                        } catch (err) {
                          setTtsPreviewHint(
                            err instanceof Error ? err.message : String(err)
                          )
                          applyQuickChat({ ...next, tts: 'edge' as TtsMode })
                        } finally {
                          window.clearInterval(poll)
                          setCosyPrepareBusy(false)
                          void refreshCosy()
                        }
                      })()
                    }}
                  >
                    <option value="edge">{uiText("EdgeTTS（推荐 · 需联网）")}</option>
                    <option value="local">{uiText("CosyVoice 本机（高品质 / 克隆）")}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{uiText("语速")}</span>
                  <input
                    className="settings-input"
                    type="number"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={quickChat.ttsRate ?? 1}
                    onChange={(e) => {
                      const next = {
                        ...quickChat,
                        ttsRate: Number(e.target.value) || 1
                      }
                      setQuickChat(next)
                      window.petApi.setQuickChat(next)
                    }}
                  />
                </label>

                {quickChat.tts === 'edge' ? (
                  <>
                    <label className="settings-field">
                      <span>{uiText("音色")}</span>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          width: '100%',
                          alignItems: 'center'
                        }}
                      >
                        <select
                          className="settings-select"
                          style={{ flex: 1 }}
                          value={quickChat.ttsEdgeVoice || DEFAULT_EDGE_TTS_VOICE}
                          onChange={(e) => {
                            const next = {
                              ...quickChat,
                              ttsEdgeVoice: e.target.value || DEFAULT_EDGE_TTS_VOICE
                            }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                            setTtsPreviewHint('已切换音色，点「试听」可听效果')
                          }}
                        >
                          {EDGE_TTS_VOICE_PRESETS.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="msg-act"
                          disabled={ttsPreviewBusy}
                          onClick={() => {
                            void (async () => {
                              setTtsPreviewBusy(true)
                              setTtsPreviewHint(null)
                              stopTtsPlayback()
                              await unlockTtsAudio()
                              const voiceLabel =
                                EDGE_TTS_VOICE_PRESETS.find(
                                  (v) =>
                                    v.id ===
                                    (quickChat.ttsEdgeVoice || DEFAULT_EDGE_TTS_VOICE)
                                )?.label || 'EdgeTTS'
                              try {
                                setTtsPreviewHint('合成中…')
                                await speakTextWithTts(
                                  `你好，这是「${voiceLabel}」音色试听。`
                                )
                                setTtsPreviewHint(`试听完成（${voiceLabel}）`)
                              } catch (err) {
                                setTtsPreviewHint(
                                  err instanceof Error ? err.message : String(err)
                                )
                              } finally {
                                setTtsPreviewBusy(false)
                              }
                            })()
                          }}
                        >
                          {ttsPreviewBusy ? uiText("试听中…") : uiText("试听")}
                        </button>
                      </div>
                    </label>
                    <p className="settings-desc tight">
                      {uiText("EdgeTTS 走微软在线朗读，无需本机模型；列表仅含当前仍可用音色。断网请改用 CosyVoice 本机。英文音色读中文可能无声。")}</p>
                  </>
                ) : null}

                {quickChat.tts === 'local' ? (
                  <>
                    <p className="settings-desc tight">
                      {cosyStatus?.modelReady
                        ? uiText("模型文件就绪{0}", [cosyStatus.modelDir ? ` · ${cosyStatus.modelDir}` : ''])
                        : cosyStatus?.error || uiText("尚未安装完成")}
                      {cosyStatus?.managedEnv
                        ? uiText(" · 专用环境")
                        : cosyStatus?.python
                          ? ` · Python ${cosyStatus.python}`
                          : ''}
                      {cosyStatus?.ready
                        ? uiText(" · 侧车运行中")
                        : cosyStatus?.running
                          ? cosyStatus.error
                            ? uiText(" · 侧车未就绪：{0}", [cosyStatus.error])
                            : uiText(" · 侧车启动中（首次加载模型可能需 1–2 分钟）")
                          : ''}
                    </p>
                    {cosyPrepareBusy || cosyStatus?.installPhase ? (
                      <p className="settings-desc tight is-warn">
                        {cosyStatus?.installPhase || uiText("正在安装…")}
                      </p>
                    ) : null}
                    {(!cosyStatus?.modelReady ||
                      !cosyStatus?.managedEnv ||
                      /No module named|ModuleNotFoundError/i.test(
                        cosyStatus?.error || ''
                      )) &&
                    !cosyPrepareBusy ? (
                      <p className="settings-desc">
                        <button
                          type="button"
                          className="msg-act"
                          onClick={() => {
                            void (async () => {
                              setCosyPrepareBusy(true)
                              setTtsPreviewHint(null)
                              const poll = window.setInterval(() => {
                                void refreshCosy()
                              }, 1500)
                              try {
                                const res = await window.petApi.ttsCosyInstall()
                                if (!res.ok) {
                                  setTtsPreviewHint(res.error)
                                  return
                                }
                                setTtsPreviewHint(
                                  res.warning ||
                                    `已装入专用环境：${res.modelDir}（不改系统 Python）`
                                )
                                const settings = await window.petApi.getSettings()
                                setQuickChat(
                                  normalizeQuickChatSettings(settings.quickChat)
                                )
                              } catch (err) {
                                setTtsPreviewHint(
                                  err instanceof Error ? err.message : String(err)
                                )
                              } finally {
                                window.clearInterval(poll)
                                setCosyPrepareBusy(false)
                                void refreshCosy()
                              }
                            })()
                          }}
                        >
                          {!cosyStatus?.modelReady
                            ? uiText("继续安装")
                            : !cosyStatus?.managedEnv
                              ? uiText("创建专用环境并装依赖")
                              : uiText("修复专用环境依赖")}
                        </button>
                      </p>
                    ) : null}
                    <label className="settings-field">
                      <span>{uiText("音色")}</span>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          width: '100%',
                          alignItems: 'center'
                        }}
                      >
                        <select
                          className="settings-select"
                          style={{ flex: 1 }}
                          value={quickChat.ttsVoiceId || ''}
                          onChange={(e) => {
                            const next = {
                              ...quickChat,
                              ttsVoiceId: e.target.value || undefined
                            }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                            setTtsPreviewHint('已切换音色，点「试听」可听效果')
                          }}
                        >
                          <option value="">{uiText("默认参考音")}</option>
                          {ttsVoices.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="msg-act"
                          disabled={
                            ttsPreviewBusy ||
                            cosyPrepareBusy ||
                            !cosyStatus?.modelReady
                          }
                          title={
                            !cosyStatus?.modelReady
                              ? uiText("请先完成 CosyVoice 安装")
                              : uiText("用当前音色试听一句")
                          }
                          onClick={() => {
                            void (async () => {
                              setTtsPreviewBusy(true)
                              setTtsPreviewHint(null)
                              stopTtsPlayback()
                              await unlockTtsAudio()
                              const voiceName =
                                ttsVoices.find((v) => v.id === quickChat.ttsVoiceId)
                                  ?.name || '默认参考音'
                              try {
                                setTtsPreviewHint('合成中…')
                                await speakTextWithTts(
                                  `你好，这是「${voiceName}」音色试听。`
                                )
                                setTtsPreviewHint(`试听完成（${voiceName}）`)
                              } catch (err) {
                                setTtsPreviewHint(
                                  err instanceof Error ? err.message : String(err)
                                )
                              } finally {
                                setTtsPreviewBusy(false)
                              }
                            })()
                          }}
                        >
                          {ttsPreviewBusy ? uiText("试听中…") : uiText("试听")}
                        </button>
                      </div>
                    </label>
                    <p className="settings-desc tight">
                      {uiText("换音色后点右侧「试听」。添加自定义音色需参考 wav + 参考文本。")}</p>
                    <label className="settings-field">
                      <span>{uiText("名称")}</span>
                      <input
                        className="settings-input"
                        value={newVoiceName}
                        placeholder={uiText("我的音色")}
                        onChange={(e) => setNewVoiceName(e.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{uiText("参考音频")}</span>
                      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                        <input
                          className="settings-input"
                          style={{ flex: 1 }}
                          value={newVoiceWav}
                          placeholder={uiText("选择一段清晰人声 wav")}
                          readOnly
                        />
                        <button
                          type="button"
                          className="msg-act"
                          onClick={() => {
                            void (async () => {
                              const p = await window.petApi.ttsPickPromptWav()
                              if (p) setNewVoiceWav(p)
                            })()
                          }}
                        >
                          {uiText("选择…")}</button>
                      </div>
                    </label>
                    <label className="settings-field">
                      <span>{uiText("参考文本")}</span>
                      <input
                        className="settings-input"
                        value={newVoiceText}
                        onChange={(e) => setNewVoiceText(e.target.value)}
                      />
                    </label>
                    <p className="settings-desc">
                      <button
                        type="button"
                        className="msg-act"
                        onClick={() => {
                          void (async () => {
                            const res = await window.petApi.ttsAddVoice({
                              name: newVoiceName,
                              promptWav: newVoiceWav,
                              promptText: newVoiceText
                            })
                            if (!res.ok) {
                              setTtsPreviewHint(res.error)
                              return
                            }
                            const next = { ...quickChat, ttsVoiceId: res.voice.id }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                            setNewVoiceName('')
                            setNewVoiceWav('')
                            setTtsPreviewHint(`已添加音色「${res.voice.name}」`)
                            void refreshCosy()
                          })()
                        }}
                      >
                        {uiText("添加音色")}</button>
                      {quickChat.ttsVoiceId ? (
                        <button
                          type="button"
                          className="msg-act"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            void (async () => {
                              const id = quickChat.ttsVoiceId
                              if (!id) return
                              const res = await window.petApi.ttsRemoveVoice(id)
                              if (!res.ok) {
                                setTtsPreviewHint(res.error)
                                return
                              }
                              const next = { ...quickChat, ttsVoiceId: undefined }
                              setQuickChat(next)
                              window.petApi.setQuickChat(next)
                              setTtsPreviewHint('已删除音色')
                              void refreshCosy()
                            })()
                          }}
                        >
                          {uiText("删除当前")}</button>
                      ) : null}
                    </p>
                    <details style={{ marginTop: 8 }}>
                      <summary className="settings-desc tight">{uiText("高级选项")}</summary>
                      <label className="settings-field">
                        <span>{uiText("仓库路径")}</span>
                        <input
                          className="settings-input"
                          value={quickChat.cosyvoiceRoot || ''}
                          placeholder={uiText("自动安装到 userData")}
                          onChange={(e) => {
                            const next = {
                              ...quickChat,
                              cosyvoiceRoot: e.target.value
                            }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                          }}
                          onBlur={() => void refreshCosy()}
                        />
                      </label>
                      <label className="settings-field">
                        <span>{uiText("模型")}</span>
                        <input
                          className="settings-input"
                          value={quickChat.cosyvoiceModel || DEFAULT_COSYVOICE_MODEL}
                          onChange={(e) => {
                            const next = {
                              ...quickChat,
                              cosyvoiceModel: e.target.value
                            }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                          }}
                        />
                      </label>
                      <label className="settings-field">
                        <span>{uiText("端口")}</span>
                        <input
                          className="settings-input"
                          type="number"
                          min={1024}
                          max={65535}
                          value={quickChat.cosyvoicePort ?? DEFAULT_COSYVOICE_PORT}
                          onChange={(e) => {
                            const next = {
                              ...quickChat,
                              cosyvoicePort:
                                Number(e.target.value) || DEFAULT_COSYVOICE_PORT
                            }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                          }}
                        />
                      </label>
                      <label className="settings-field">
                        <span>{uiText("Python（可选）")}</span>
                        <input
                          className="settings-input"
                          value={quickChat.cosyvoicePython || ''}
                          placeholder={uiText("留空 = 专用 venv，不改系统包")}
                          onChange={(e) => {
                            const next = {
                              ...quickChat,
                              cosyvoicePython: e.target.value || undefined
                            }
                            setQuickChat(next)
                            window.petApi.setQuickChat(next)
                          }}
                        />
                      </label>
                      <p className="settings-desc tight">
                        {uiText("默认使用")}{' '}
                        <code>
                          {cosyStatus?.venvDir ||
                            '~/Library/Application Support/cursor-pet/cosyvoice/venv'}
                        </code>
                        {uiText("；依赖只装进这里。仅在要用自己的解释器时才填写上方路径。")}</p>
                    </details>
                  </>
                ) : null}

                {ttsPreviewHint ? (
                  <p className="settings-desc tight" style={{ marginTop: 6 }}>
                    {ttsPreviewHint}
                  </p>
                ) : null}
              </>
            ) : ttsPreviewHint ? (
              <p className="settings-desc tight is-warn">{ttsPreviewHint}</p>
            ) : null}
          </div>
        </section>

        <section className="settings-section" id="settings-prompts" aria-label={uiText("系统提示模版")}>
          <h3>{uiText("系统提示模版")}</h3>
          <p className="settings-desc">
            {uiText("系统提示在每个对话/对比任务顶栏单独配置，不会全量生效。这里只管理可复用模版，可在任务里一键套用。")}</p>
          <textarea
            className="system-prompt-editor"
            rows={6}
            placeholder={uiText("在此编辑模版正文，再另存到模版库…")}
            value={templateDraft}
            onChange={(e) => setTemplateDraft(e.target.value)}
          />
          <div className="prompt-save-row" style={{ marginTop: 8 }}>
            <input
              className="settings-input"
              placeholder={uiText("模版名称")}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrentAsTemplate()
              }}
            />
            <button type="button" className="settings-btn tiny" onClick={saveCurrentAsTemplate}>
              {uiText("另存为")}</button>
            <button
              type="button"
              className="settings-btn ghost tiny"
              disabled={!editingTemplateId}
              onClick={overwriteEditingTemplate}
              title={uiText("用当前草稿覆盖已选中的模版")}
            >
              {uiText("覆盖选中")}</button>
            <button
              type="button"
              className="settings-btn ghost tiny"
              disabled={!templateDraft.trim()}
              onClick={() => {
                setTemplateDraft('')
                setEditingTemplateId(null)
                setSaveName('')
                flash(uiText("已清空草稿"))
              }}
            >
              {uiText("清空草稿")}</button>
          </div>

          <h4 className="about-block-title" style={{ marginTop: 14 }}>
            {uiText("推荐模版")}</h4>
          <div className="prompt-template-chips">
            {BUILTIN_PROMPT_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="prompt-chip"
                title={t.content}
                onClick={() => loadTemplateToDraft(null, t.name, t.content)}
              >
                {t.name}
              </button>
            ))}
          </div>

          <h4 className="about-block-title" style={{ marginTop: 14 }}>
            {uiText("我的模版")}</h4>
          {promptTemplates.length === 0 ? (
            <p className="settings-desc tight" style={{ marginTop: 8 }}>
              {uiText("还没有保存的模版。填好上方草稿后点「另存为」。")}</p>
          ) : (
            <ul className="prompt-template-list">
              {promptTemplates.map((t) => (
                <li key={t.id} className={t.id === editingTemplateId ? 'on' : ''}>
                  <button
                    type="button"
                    className="prompt-template-main"
                    onClick={() => loadTemplateToDraft(t.id, t.name, t.content)}
                    title={t.content}
                  >
                    <strong>{t.name}</strong>
                    <span>
                      {t.content.replace(/\s+/g, ' ').slice(0, 48)}
                      {t.content.length > 48 ? '…' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="settings-btn ghost tiny"
                    onClick={() => deleteTemplate(t.id)}
                  >
                    {uiText("删除")}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-section" id="settings-models">
          <h3>{uiText("Agent 引擎")}</h3>
          <p className="settings-desc">
            {uiText("本机 CLI 引擎（Cursor / OpenClaw / Claude Code / Codex / OpenCode）。对话引用格式")}{' '}
            <code>{uiText("供应商:模型")}</code>{uiText("，界面显示为「供应商：模型」。")}</p>
          <div className="settings-row between">
            <span className="settings-desc tight">
              {providers.filter((p) => isAgentProvider(p) && p.enabled).length} {uiText("个引擎启用 · 刷新会读本机 目录并同步到对话选单")}</span>
            <div className="settings-row" style={{ gap: 6 }}>
              <button
                type="button"
                className="settings-btn tiny"
                disabled={modelsBusy}
                title={uiText("勾选全部 Agent 引擎下的所有模型，并同步到对话选单")}
                onClick={selectAllAgentModels}
              >
                {uiText("默认全选")}</button>
              <button
                type="button"
                className="settings-btn ghost tiny"
                disabled={modelsBusy}
                onClick={() => void refreshCatalog()}
              >
                {modelsBusy ? uiText("刷新中…") : uiText("刷新并同步选单")}
              </button>
            </div>
          </div>

          <ul className="provider-list">
            {providers.filter(isAgentProvider).map((p) => {
              const open = openProviderId === p.id
              const enabledCount = p.models.filter((m) => m.enabled).length
              return (
                <li key={p.id} className={`provider-card ${p.enabled ? 'on' : ''}`}>
                  <div className="provider-card-head">
                    <button
                      type="button"
                      className="provider-fold"
                      onClick={() => setOpenProviderId(open ? null : p.id)}
                    >
                      <span className="chevron">{open ? '▾' : '▸'}</span>
                      <strong>{p.label}</strong>
                      <code className="provider-id">{p.id}</code>
                      <span className="provider-kind">agent</span>
                    </button>
                    <label className="provider-enable" title={uiText("整组启用")}>
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={() => toggleProvider(p.id)}
                      />
                      {uiText("启用")}</label>
                  </div>
                  {open && (
                    <div className="provider-card-body">
                      <div className="settings-row between">
                        <p className="settings-desc tight" style={{ margin: 0 }}>
                          {uiText("已勾选")}{enabledCount} / {p.models.length} {' '}{uiText("· 如")}{' '}
                          <code>
                            {p.id}:{p.models[0]?.id || 'model'}
                          </code>
                        </p>
                        <div className="settings-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="settings-btn ghost tiny"
                            disabled={!p.models.length || enabledCount === p.models.length}
                            onClick={() => setProviderModelsEnabled(p.id, true)}
                          >
                            {uiText("全选")}</button>
                          <button
                            type="button"
                            className="settings-btn ghost tiny"
                            disabled={!p.models.length || enabledCount === 0}
                            onClick={() => setProviderModelsEnabled(p.id, false)}
                          >
                            {uiText("全不选")}</button>
                        </div>
                      </div>
                      <label className="settings-desc tight" style={{ display: 'block', marginTop: 8 }}>
                        {uiText("模型列表（每行一个裸名，可手改）")}<textarea
                          className="provider-models-text"
                          rows={Math.min(8, Math.max(3, p.models.length + 1))}
                          value={p.models.map((m) => m.id).join('\n')}
                          onChange={(e) => setCustomModelsText(p.id, e.target.value)}
                        />
                      </label>
                      <ul className="model-pref-list compact">
                        {p.models.map((m, i) => (
                          <li key={m.id} className={`model-pref-row ${m.enabled ? 'on' : ''}`}>
                            <label className="model-pref-check">
                              <input
                                type="checkbox"
                                checked={m.enabled}
                                onChange={() => toggleProviderModel(p.id, m.id)}
                              />
                              <span className="model-pref-name">
                                {p.label}：{m.label}
                              </span>
                              <code className="model-pref-id">
                                {p.id}:{m.id}
                              </code>
                            </label>
                            <div className="model-pref-move">
                              <button
                                type="button"
                                className="settings-btn ghost tiny"
                                disabled={i === 0}
                                onClick={() => moveProviderModel(p.id, m.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="settings-btn ghost tiny"
                                disabled={i === p.models.length - 1}
                                onClick={() => moveProviderModel(p.id, m.id, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="settings-section" id="settings-api">
          <h3>{uiText("API 模型提供商")}</h3>
          <p className="settings-desc">
            {uiText("自定义 OpenAI / Anthropic 兼容 API（与上方 Agent 引擎分开）。引用同样是")}{' '}
            <code>provider:model</code>。
          </p>
          <div className="settings-row between">
            <span className="settings-desc tight">
              {providers.filter((p) => !isAgentProvider(p) && p.enabled).length} {uiText("个 API 提供商启用")}</span>
            <button
              type="button"
              className="settings-btn tiny"
              onClick={() => setAddingProvider((v) => !v)}
            >
              {uiText("＋ API 提供商")}</button>
          </div>

          {addingProvider && (
            <div className="provider-add-form">
              <input
                className="settings-select"
                placeholder={uiText("id（如 openai）")}
                value={newProv.id}
                onChange={(e) => setNewProv({ ...newProv, id: e.target.value })}
              />
              <input
                className="settings-select"
                placeholder={uiText("显示名")}
                value={newProv.label}
                onChange={(e) => setNewProv({ ...newProv, label: e.target.value })}
              />
              <input
                className="settings-select"
                placeholder="Base URL"
                value={newProv.baseUrl}
                onChange={(e) => setNewProv({ ...newProv, baseUrl: e.target.value })}
              />
              <label className="settings-field">
                {uiText("API 格式")}<select
                  className="settings-select"
                  value={newProv.apiFormat}
                  onChange={(e) => {
                    const apiFormat = e.target.value === 'anthropic' ? 'anthropic' : 'openai'
                    setNewProv({
                      ...newProv,
                      apiFormat,
                      ...(apiFormat === 'anthropic' && newProv.id === 'openai'
                        ? {
                            id: 'anthropic',
                            label: 'Anthropic',
                            baseUrl: 'https://api.anthropic.com/v1',
                            models: 'claude-sonnet-4-5\nclaude-opus-4-5'
                          }
                        : {})
                    })
                  }}
                >
                  <option value="openai">OpenAI（Chat Completions）</option>
                  <option value="anthropic">Anthropic（Messages）</option>
                </select>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={!!newProv.enableThinking}
                  onChange={(e) => setNewProv({ ...newProv, enableThinking: e.target.checked })}
                />
                <span>{uiText("深度思考（请求思维链并展示过程）")}</span>
              </label>
              <div className="settings-secret-row">
                <input
                  className="settings-select"
                  placeholder="API Key"
                  type={showNewApiKey ? 'text' : 'password'}
                  autoComplete="off"
                  value={newProv.apiKey}
                  onChange={(e) => setNewProv({ ...newProv, apiKey: e.target.value })}
                />
                <button
                  type="button"
                  className="settings-btn ghost tiny"
                  onClick={() => setShowNewApiKey((v) => !v)}
                  aria-label={showNewApiKey ? uiText("隐藏 API Key") : uiText("显示 API Key")}
                  title={showNewApiKey ? uiText("隐藏") : uiText("显示")}
                >
                  {showNewApiKey ? uiText("隐藏") : uiText("显示")}
                </button>
              </div>
              <textarea
                className="provider-models-text"
                placeholder={uiText("模型名，每行一个（必填）")}
                rows={3}
                value={newProv.models}
                onChange={(e) => setNewProv({ ...newProv, models: e.target.value })}
              />
              <div className="settings-actions">
                <button
                  type="button"
                  className="settings-btn ghost tiny"
                  onClick={() => {
                    setAddingProvider(false)
                    setShowNewApiKey(false)
                  }}
                >
                  {uiText("取消")}</button>
                <button type="button" className="settings-btn tiny" onClick={addCustomProvider}>
                  {uiText("保存")}</button>
              </div>
            </div>
          )}

          <ul className="provider-list">
            {providers.filter((p) => !isAgentProvider(p)).map((p) => {
              const open = openProviderId === p.id
              const enabledCount = p.models.filter((m) => m.enabled).length
              return (
                <li key={p.id} className={`provider-card ${p.enabled ? 'on' : ''}`}>
                  <div className="provider-card-head">
                    <button
                      type="button"
                      className="provider-fold"
                      onClick={() => setOpenProviderId(open ? null : p.id)}
                    >
                      <span className="chevron">{open ? '▾' : '▸'}</span>
                      <strong>{p.label}</strong>
                      <code className="provider-id">{p.id}</code>
                      <span className="provider-kind">
                        {p.apiFormat === 'anthropic' ? 'anthropic' : 'openai'}
                      </span>
                    </button>
                    <label className="provider-enable" title={uiText("整组启用")}>
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={() => toggleProvider(p.id)}
                      />
                      {uiText("启用")}</label>
                    <button
                      type="button"
                      className="settings-btn ghost tiny"
                      onClick={() => removeProvider(p.id)}
                    >
                      {uiText("删除")}</button>
                  </div>
                  {open && (
                    <div className="provider-card-body">
                      <div className="provider-custom-fields">
                        <label>
                          Base URL
                          <input
                            className="settings-select"
                            value={p.baseUrl || ''}
                            onChange={(e) => updateCustomField(p.id, { baseUrl: e.target.value })}
                          />
                        </label>
                        <label>
                          {uiText("API 格式")}<select
                            className="settings-select"
                            value={p.apiFormat === 'anthropic' ? 'anthropic' : 'openai'}
                            onChange={(e) =>
                              updateCustomField(p.id, {
                                apiFormat: e.target.value === 'anthropic' ? 'anthropic' : 'openai'
                              })
                            }
                          >
                            <option value="openai">OpenAI（Chat Completions）</option>
                            <option value="anthropic">Anthropic（Messages）</option>
                          </select>
                        </label>
                        <label className="settings-toggle">
                          <input
                            type="checkbox"
                            checked={!!p.enableThinking}
                            onChange={(e) =>
                              updateCustomField(p.id, { enableThinking: e.target.checked })
                            }
                          />
                          <span>
                            {uiText("深度思考（新任务默认）")}<span className="settings-desc tight">
                              {uiText("输入框旁「思考」可按任务再改。会发 thinking / enable_thinking，并展示思维链；不支持时降级")}</span>
                          </span>
                        </label>
                        <label>
                          API Key
                          <div className="settings-secret-row">
                            <input
                              className="settings-select"
                              type={revealedApiKeys[p.id] ? 'text' : 'password'}
                              autoComplete="off"
                              value={p.apiKey || ''}
                              onChange={(e) => updateCustomField(p.id, { apiKey: e.target.value })}
                            />
                            <button
                              type="button"
                              className="settings-btn ghost tiny"
                              onClick={() =>
                                setRevealedApiKeys((prev) => ({
                                  ...prev,
                                  [p.id]: !prev[p.id]
                                }))
                              }
                              aria-label={
                                revealedApiKeys[p.id] ? uiText("隐藏 API Key") : uiText("显示 API Key")
                              }
                              title={revealedApiKeys[p.id] ? uiText("隐藏") : uiText("显示")}
                            >
                              {revealedApiKeys[p.id] ? uiText("隐藏") : uiText("显示")}
                            </button>
                          </div>
                        </label>
                        <label>
                          {uiText("模型列表（每行一个裸名）")}<textarea
                            className="provider-models-text"
                            rows={4}
                            value={p.models.map((m) => m.id).join('\n')}
                            onChange={(e) => setCustomModelsText(p.id, e.target.value)}
                          />
                        </label>
                      </div>
                      <p className="settings-desc tight">
                        {uiText("已勾选")}{enabledCount} / {p.models.length} {' '}{uiText("· 引用如")}{' '}
                        <code>
                          {p.id}:{p.models[0]?.id || 'model'}
                        </code>
                      </p>
                      <ul className="model-pref-list compact">
                        {p.models.map((m, i) => (
                          <li key={m.id} className={`model-pref-row ${m.enabled ? 'on' : ''}`}>
                            <label className="model-pref-check">
                              <input
                                type="checkbox"
                                checked={m.enabled}
                                onChange={() => toggleProviderModel(p.id, m.id)}
                              />
                              <span className="model-pref-name">
                                {p.label}：{m.label}
                              </span>
                              <code className="model-pref-id">
                                {p.id}:{m.id}
                              </code>
                            </label>
                            <div className="model-pref-move">
                              <button
                                type="button"
                                className="settings-btn ghost tiny"
                                disabled={i === 0}
                                onClick={() => moveProviderModel(p.id, m.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="settings-btn ghost tiny"
                                disabled={i === p.models.length - 1}
                                onClick={() => moveProviderModel(p.id, m.id, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {providers.every(isAgentProvider) && !addingProvider && (
            <p className="settings-desc tight">{uiText("尚未添加自定义 API 提供商。")}</p>
          )}
        </section>

        <section className="settings-section" id="settings-autonomy">
          <h3>{uiText("默认任务")}</h3>
          <p className="settings-desc">
            {uiText("只影响新建任务的初始模型、目录与权限；改某个任务顶栏不会改这里。")}</p>
          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("默认模型")}</h4>
            </div>
            <div className="settings-row between">
              <span className="settings-desc tight">{uiText("新建任务时预选")}</span>
              <ModelPicker
                providers={providers}
                value={defaultModelRef}
                onChange={(ref) => {
                  setDefaultModelRef(ref)
                  window.petApi.setDefaultModelRef(ref)
                  flash(uiText("已更新新任务默认模型"))
                }}
              />
            </div>
          </div>
          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("默认权限")}</h4>
            </div>
            <p className="settings-desc tight">
              {SUPPORTED_ENGINE_NAMES} {uiText("/ 直连 API 均生效。推荐「代理」；要强制只读时再改成问答 / 计划。")}</p>
            <div className="city-chip-row">
              {AGENT_AUTONOMY_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`city-chip ${defaultAutonomy === o.id ? 'on' : ''}`}
                  title={o.desc}
                  onClick={() => pickDefaultAutonomy(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("技能投递")}</h4>
            </div>
            <p className="settings-desc tight">
              {uiText("选中技能后怎么交给引擎。推荐「自动」：")}{NATIVE_SKILL_ENGINE_NAMES} {uiText("只点名、按需加载正文")}{CATALOG_SKILL_ENGINE_NAMES ? uiText("；{0} 只给薄目录", [CATALOG_SKILL_ENGINE_NAMES]) : ''}
              {uiText("；直连 API 才全文注入。想省 token 别选「全文注入」。")}</p>
            <div className="city-chip-row">
              {SKILL_DELIVERY_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`city-chip ${skillDelivery === o.id ? 'on' : ''}`}
                  title={o.desc}
                  onClick={() => pickSkillDelivery(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-block">
            <div className="settings-block-head">
              <h4 className="settings-subhead">{uiText("默认工作目录")}</h4>
              <button type="button" className="settings-btn tiny" onClick={() => void pickCwd()}>
                {uiText("选择…")}</button>
            </div>
            <code className="settings-path full" title={cwd || undefined}>
              {cwd ? displayPath(cwd, homeDir) : uiText("未设置（发 Agent 前须选项目目录）")}
            </code>
            <p className="settings-desc tight">
              {cwd
                ? uiText("新建任务从这里开始；Agent 读写文件都在这个目录下。")
                : uiText("不能使用用户主目录。Agent 会写入文件，请指向具体项目。")}
            </p>
          </div>
        </section>

        <section className="settings-section" id="settings-memory" aria-label={uiText("联想记忆")}>
          <h3>{uiText("联想记忆")}</h3>
          <p className="settings-desc">
            {uiText("开启后，你在这扇对话窗里聊完一轮，会记下「人 / 项目 / 偏好」这类关系；下次问到相关话题时自动带上。宠物闲着也可能提一句。失败不影响对话。")}</p>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={agentMemoryOn}
              disabled={memoryBusy}
              onChange={(e) => {
                const on = e.target.checked
                setAgentMemoryOn(on)
                setMemoryBusy(true)
                void window.petApi
                  .setAgentMemoryEnabled(on)
                  .then(() => refreshMemoryStats())
                  .finally(() => setMemoryBusy(false))
                flash(on ? '已开启联想记忆' : '已关闭联想记忆')
              }}
            />
            <span>{uiText("开启联想记忆")}</span>
          </label>
          {!agentMemoryStats.modelRef ? (
            <p className="settings-desc tight is-warn">
              {uiText("先在「Agent 引擎」里选好默认模型，否则开了也不会记。")}</p>
          ) : null}
          <p className="settings-desc tight">{formatAgentMemoryStatusLine(agentMemoryStats)}</p>
          {agentMemoryStats.recentFacts?.length ? (
            <ul className="settings-desc tight settings-memory-facts">
              {agentMemoryStats.recentFacts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          ) : null}
          <div className="settings-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="settings-btn"
              disabled={memoryBusy}
              onClick={() => void refreshMemoryStats()}
            >
              {uiText("刷新统计")}</button>
            <button
              type="button"
              className="settings-btn danger"
              disabled={memoryBusy || (agentMemoryStats.nodes === 0 && agentMemoryStats.edges === 0)}
              onClick={() => {
                if (
                  !confirmDestructive(
                    uiText("确定清空全部联想记忆？记下的关系和闲聊提示会清掉，开关状态保留。")
                  )
                ) {
                  return
                }
                setMemoryBusy(true)
                void window.petApi
                  .clearAgentMemory()
                  .then(() => refreshMemoryStats())
                  .then(() => flash(uiText("已清空联想记忆")))
                  .finally(() => setMemoryBusy(false))
              }}
            >
              {uiText("清空记忆")}</button>
          </div>
        </section>

        <section className="settings-section" id="settings-hooks">
          <h3>{uiText("IDE 联动")}</h3>
          <p className="settings-desc">
            {uiText("只装了 Cursor 应用：配置联动即可，在 Cursor 里跑 Agent 时宠物会动（不需要 cursor-agent）。 cursor-agent 仅用于「在 CPET 窗口里用 Cursor 引擎发消息」，且需另装另登录。")}</p>
          <div className="settings-row between">
            <span className="settings-desc tight">
              {uiText("引擎联动（Cursor / Claude / Codex）")}</span>
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn"
                disabled={busy}
                onClick={() => void configureHooks()}
              >
                {hooksInstalled ? uiText("重新配置") : uiText("配置联动")}
              </button>
              {hooksInstalled && (
                <button
                  type="button"
                  className="settings-btn ghost"
                  disabled={busy}
                  onClick={() => void removeHooks()}
                >
                  {uiText("移除")}</button>
              )}
            </div>
          </div>
          <ul className="settings-desc tight" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li>Cursor：{hookDetail.cursor ? uiText("已挂") : uiText("未挂")}</li>
            <li>Claude Code：{hookDetail.claudeCode ? uiText("已挂") : uiText("未挂")}</li>
            <li>
              Codex：
              {!hookDetail.codex
                ? uiText("未挂")
                : hookDetail.codexTrusted === false
                  ? uiText("已挂但未信任（ChatGPT 会静默跳过，请重新配置）")
                  : hookDetail.codexTrusted === true
                    ? uiText("已挂且已信任（改完后须完全退出 ChatGPT 再开，app-server 不热加载）")
                    : uiText("已挂（信任状态待探测）")}
              {uiText("（含 PermissionRequest）")}</li>
            <li>{uiText("CPET 内对话：默认联动宠物 + 完成提醒")}</li>
          </ul>
        </section>

        <section className="settings-section settings-about" id="settings-about" aria-label={uiText("关于 CPET")}>
          <h3>{uiText("关于 CPET")}</h3>
          <p className="settings-desc">
            {uiText("核对版本、查看本机引擎。反馈问题请先复制诊断，再打开 Issue 粘贴。对话与设置只存在本机 Application Support，不会打进安装包——分享 DMG 不会带上你的聊天。")}</p>
          {appInfo ? (
            <div className="about-card">
              <div className="about-hero">
                <img
                  className="about-brand-mark"
                  src={brandHeader}
                  alt="CPET"
                  width={420}
                  height={140}
                />
                <div className="about-hero-main">
                  <img className="about-brand-icon" src={brandIcon} alt="" aria-hidden width={36} height={36} />
                  <span className="about-name">{appInfo.name}</span>
                  <code className="about-ver">v{appInfo.version}</code>
                </div>
                <p className="about-meta">
                  {appInfo.author} · {formatPlatform(appInfo.platform, appInfo.arch)}
                </p>
              </div>

              <StudioPublisher openExternal={(url) => window.petApi.openExternal(url)} />

              {engines.length > 0 && (
                <div className="about-block">
                  <h4 className="about-block-title">{uiText("本机引擎")}</h4>
                  <ul className="about-engine-list">
                    {engines.map((e) => (
                      <li key={e.id}>
                        <span className="about-engine-name">{e.label || e.id}</span>
                        <span
                          className={
                            e.installed
                              ? 'about-engine-status is-on'
                              : e.supported
                                ? 'about-engine-status'
                                : 'about-engine-status is-soon'
                          }
                          title={e.version || e.note || undefined}
                        >
                          {uiText(engineStatusText(e))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="about-block">
                <h4 className="about-block-title">{uiText("更新日志")}</h4>
                <p className="settings-desc">{uiText('历史更新说明保留原始中文。')}</p>
                <ul className="about-changelog">
                  {recentChangelog(8).map((entry) => (
                    <li key={entry.version} className="about-changelog-item">
                      <div className="about-changelog-head">
                        <code className="about-ver">v{entry.version}</code>
                        <span className="about-changelog-date">{entry.date}</span>
                      </div>
                      <ul className="about-changelog-points">
                        {entry.highlights.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>

              <details className="about-runtime">
                <summary>{uiText("运行环境")}</summary>
                <dl className="about-grid">
                  <div className="about-row">
                    <dt>Electron</dt>
                    <dd>{appInfo.electron}</dd>
                  </div>
                  <div className="about-row">
                    <dt>Chromium</dt>
                    <dd>{appInfo.chrome}</dd>
                  </div>
                  <div className="about-row">
                    <dt>Node</dt>
                    <dd>{appInfo.node}</dd>
                  </div>
                  <div className="about-row">
                    <dt>{uiText("平台")}</dt>
                    <dd>
                      {appInfo.platform}/{appInfo.arch}
                    </dd>
                  </div>
                </dl>
              </details>

              <div className="about-actions">
                <button type="button" className="settings-btn ghost" onClick={() => void copyDiagnostics()}>
                  {uiText("复制诊断信息")}</button>
                {appInfo.feedbackUrl ? (
                  <button
                    type="button"
                    className="settings-btn ghost"
                    onClick={() => {
                      void (async () => {
                        const text = buildDiagnosticsText()
                        if (text && !(await writeClipboardText(text))) {
                          flash(uiText("复制失败，请手动选中诊断信息"))
                          return
                        }
                        window.petApi.openExternal(appInfo.feedbackUrl!)
                        flash(uiText("已复制诊断，请在 Issue 里粘贴"))
                      })()
                    }}
                  >
                    {uiText("提交问题反馈")}</button>
                ) : null}
                <button
                  type="button"
                  className="settings-btn"
                  disabled={updateChecking}
                  onClick={() => void runUpdateCheck()}
                >
                  {updateChecking ? uiText("检查中…") : uiText("检查更新")}
                </button>
                {update?.status === 'update-available' ? (
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() =>
                      window.petApi.openExternal(update.downloadUrl || update.releasesUrl!)
                    }
                  >
                    {update.downloadUrl ? uiText("下载 {0}", [update.latest]) : uiText("打开下载页")}
                  </button>
                ) : null}
              </div>
              {appInfo.repoUrl ? (
                <p className="settings-desc tight">
                  {uiText("源码")}{' '}
                  <button
                    type="button"
                    className="empty-link"
                    onClick={() => window.petApi.openExternal(appInfo.repoUrl!)}
                  >
                    {appInfo.repoUrl}
                  </button>
                </p>
              ) : null}
              {update ? (
                <p
                  className={`settings-desc tight${update.status === 'error' || update.status === 'not-configured' ? ' warn' : ''}`}
                >
                  {uiText(update.message)}
                  {update.status !== 'up-to-date' && update.releasesUrl ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="empty-link"
                        onClick={() => window.petApi.openExternal(update.releasesUrl!)}
                      >
                        {uiText("打开 Release 页")}</button>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="settings-desc tight">{uiText("启动后会自动检查；也可以点上面手动查一次。")}</p>
              )}
            </div>
          ) : (
            <p className="settings-desc tight">{uiText("正在读取版本信息…")}</p>
          )}
        </section>
      </div>
      </div>
    </div>
  )
}
