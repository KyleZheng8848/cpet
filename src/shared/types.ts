import type { UiLanguagePreference, UiLanguageState } from './i18n'
// 主进程与渲染进程共享的类型定义。

import type { AgentBackend, EngineDetection } from './agentBackends'
import type { AgentAutonomy } from './agentAutonomy'
import type { ChatThemeCustom, ChatThemeId, NewsSourceId } from './chatUi'
import type { AgentSkill, SkillDeliveryPref, SkillReportMode } from './skills'
import type { UpdateCheckResult } from './updateCheck'

export type { AgentBackend, EngineDetection } from './agentBackends'
export type { AgentAutonomy } from './agentAutonomy'
export type { ChatThemeCustom, ChatThemeId, NewsSourceId } from './chatUi'
export type { AgentSkill, SkillDeliveryPref, SkillReportMode } from './skills'
export type { UpdateCheckResult, UpdateCheckStatus } from './updateCheck'
export {
  AGENT_AUTONOMY_OPTIONS,
  DEFAULT_AGENT_AUTONOMY,
  isAgentAutonomy,
  normalizeAgentAutonomy,
  agentAutonomyLabel
} from './agentAutonomy'
export {
  ENGINE_SETUP_GUIDES,
  getEngineSetupGuide,
  installCommandForPlatform,
  canOneClickInstall,
  canOneClickLogin,
  type EngineSetupGuide,
  type EngineSetupId
} from './engineSetup'
export { AGENT_CATALOG, getBackendInfo, isSupportedBackend, isKnownBackend } from './agentBackends'
export {
  applySkillsToPrompt,
  engineExpandsSkills,
  skillUsableOnEngine,
  isSkillDeliveryPref,
  SKILL_DELIVERY_OPTIONS,
  resolveSkillDelivery,
  skillMarkerForEngine
} from './skills'
export {
  CHAT_THEMES,
  DEFAULT_CHAT_THEME,
  DEFAULT_CHAT_THEME_CUSTOM,
  DEFAULT_USER_AVATAR,
  USER_AVATAR_CHOICES,
  WEATHER_CITY_PRESETS,
  NEWS_SOURCES,
  isChatThemeId,
  isNewsSourceId,
  normalizeChatThemeCustom,
  applyChatThemeCustom,
  clearChatThemeCustom,
  sanitizeUserAvatar,
  isLikelyEmoji,
  isUserAvatarImage,
  USER_AVATAR_IMAGE_PREFIX
} from './chatUi'

/** 宠物由 agent 生命周期驱动的状态。 */
export type PetState =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'talking'
  | 'waiting'
  | 'done'
  | 'error'

/** 由本地交互触发的临时情绪，会临时覆盖 agent 状态。 */
export type PetMood = 'petted' | 'dragged' | 'sleeping' | 'wake'

/** 宠物贴边半隐藏方向（收起露出条时；展开或未贴边为 null）。 */
export type PetDockEdge = 'left' | 'right' | null

/** 宠物皮肤 ID。 */
export type SkinId =
  | 'violet'
  | 'mint'
  | 'peach'
  | 'slate'
  | 'panda'
  | 'cow'
  | 'kun'
  | 'doge'
  | 'capy'
  | 'frog'
  | 'emoji'

/** 皮肤在菜单里的展示信息（调色板细节放在渲染层）。 */
export const SKINS: ReadonlyArray<{ id: SkinId; name: string }> = [
  { id: 'violet', name: '小紫熊' },
  { id: 'mint', name: '薄荷猫' },
  { id: 'peach', name: '蜜桃团' },
  { id: 'slate', name: '钢蓝机' },
  { id: 'panda', name: '熊猫 🐼' },
  { id: 'cow', name: '牛马 🐮' },
  { id: 'kun', name: '坤坤 🏀' },
  { id: 'doge', name: '柴犬 🐕' },
  { id: 'capy', name: '卡皮巴拉 🦫' },
  { id: 'frog', name: '青蛙 🐸' },
  { id: 'emoji', name: '黄脸 😄' }
]

/** 设置里勾选的模型（扁平；可由 modelProviders 派生，兼容旧数据）。 */
export interface ModelPref {
  id: string
  label: string
  enabled: boolean
  order: number
}

export type ModelProviderKind =
  | 'cursor'
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'custom'

/** 提供商下的单个模型（裸名）。 */
export interface ProviderModel {
  id: string
  label: string
  enabled: boolean
  order: number
}

/** 模型提供商（层级配置真源）。完整引用 = `${id}:${model.id}`。 */
export interface ModelProvider {
  id: string
  kind: ModelProviderKind
  label: string
  enabled: boolean
  order: number
  /** 仅 custom */
  baseUrl?: string
  apiKey?: string
  /**
   * 自定义 API 协议：
   * - openai：Chat Completions（默认）
   * - anthropic：Messages API（/v1/messages）
   */
  apiFormat?: 'openai' | 'anthropic'
  /**
   * 直连深度思考：请求时带上 enable_thinking / Anthropic thinking，
   * 并解析 reasoning_content / thinking 块为过程气泡。
   */
  enableThinking?: boolean
  models: ProviderModel[]
}

/** 对比任务中某一列的会话状态（按列实例 id 索引，modelId 可重复）。 */
export interface CompareLane {
  /** 该列实际调用的模型引用，如 cursor:auto。 */
  modelId: string
  sessionId?: string
  messages: ChatMessage[]
}

/** 对比任务的一列：唯一 id + 所选模型（可与其它列相同）。 */
export interface CompareLaneRef {
  id: string
  modelId: string
}

/** 系统提示模版。 */
export interface PromptTemplate {
  id: string
  name: string
  content: string
  updatedAt: number
  /** @deprecated 唤醒词已移除，保留字段仅兼容旧数据。 */
  wakeWord?: string
}

export interface Settings {
  uiLanguage?: UiLanguagePreference
  skin: SkinId
  cwd?: string
  /**
   * 本地工作记忆：最近目录 / 失败引擎，只驱动宠物 idle 碎碎念（见 workMemory.ts）。
   */
  workMemory?: {
    recentCwds: string[]
    failedEngines: Array<{ id: string; at: number; note?: string }>
  }
  /**
   * 轻量联想记忆开关与宠物念叨句（边表在 userData/agent-memory.json，见 agentMemory.ts）。
   */
  agentMemory?: {
    enabled: boolean
    chatterHints?: string[]
  }
  /** 是否拦截 IDE 的 shell/MCP（宠物里批准）。关则全部自动放行且不弹。默认关。 */
  intercept?: boolean
  /** 选中的图片皮肤包 id（为空则用矢量皮肤 skin）。 */
  imageSkin?: string
  /** 首次运行的「配置 Cursor 联动」提示是否已展示过。 */
  setupPromptShown?: boolean
  /** 首跑目标：ide=跟 IDE / chat=窗口对话 / skipped=跳过。 */
  onboardingGoal?: 'ide' | 'chat' | 'skipped'
  /** 新任务默认 Agent 自治等级。 */
  defaultAgentAutonomy?: AgentAutonomy
  /**
   * 技能投递：auto（默认）/ native（点名）/ catalog（薄目录）/ inject（全文）。
   * Claude/Codex/OpenClaw 默认按原版点名，省 token。
   */
  skillDelivery?: SkillDeliveryPref
  /**
   * 聊天窗用户头像。
   * 持久化：emoji，或 `img:文件名`（见 userData/avatars）。
   * 经 getSettings 下发到渲染进程时，图片会解析为 data URL。
   */
  userAvatar?: string
  /** 对话框皮肤主题。 */
  chatTheme?: ChatThemeId
  /** 自定义主题配色（chatTheme=custom 时生效）。 */
  chatThemeCustom?: ChatThemeCustom
  /** 天气城市（空=按出口 IP；VPN 时建议手动填）。 */
  weatherCity?: string
  /** 是否已提示过用户设置天气城市（避免反复唠叨）。 */
  weatherCityPrompted?: boolean
  /** 是否已提示过资讯简报用法（避免反复唠叨）。 */
  briefOnboardingPrompted?: boolean
  /**
   * 宠物简报内置兜底源（HN / V2EX）。
   * 无 RSS 任务时拉取；有任务时忽略。
   */
  newsSource?: NewsSourceId
  /**
   * @deprecated 全局订阅源已废弃；宠物简报与新建任务只认 RSS 任务内的源。
   * 字段仅兼容旧配置，读取侧忽略。
   */
  briefRssFeeds?: string[]
  /** 简报兴趣词：有则角标/digest 只盯匹配项，其它新条目自动标已读。 */
  briefInterestKeywords?: string[]
  /** 简报屏蔽词：命中则永不进未读/digest。 */
  briefMuteKeywords?: string[]
  /**
   * 宠物推送：每日整点（最多 3 个，0–23）；与 briefDigestIntervalHours 互斥。
   */
  briefDailyDigestHours?: number[] | null
  /** @deprecated 旧单点字段；读取时迁入 briefDailyDigestHours。 */
  briefDailyDigestHour?: number | null
  /** 宠物推送：每隔 N 小时；与 briefDailyDigestHours 互斥。 */
  briefDigestIntervalHours?: number
  /**
   * RSS 任务条目评分专用模型（OpenAI 兼容直连）。
   * 空 / Agent 引擎 → 走兴趣词 + 规则，不调用对话用的 Agent。
   */
  rssScoreModelRef?: string
  /** RSS 评分节奏：realtime 新条目即评；interval 按间隔批评；off 仅手动。 */
  rssScoreMode?: 'realtime' | 'interval' | 'off'
  /** 定时评分间隔（分钟），默认 30。 */
  rssScoreIntervalMinutes?: number
  /**
   * RSS 整理语言。评分时译标题，「用模型整理」时译正文。
   * source = 保持原文；缺省简体中文。
   */
  rssOrganizeLang?: import('./rssLang').RssOrganizeLang
  /**
   * 推到桌宠气泡的最低价值分：3=一般+ / 4=值得看+ / 5=必读（默认）。
   * 有匹配未读时优先于天气与碎碎念。
   */
  rssPetPushMinScore?: 3 | 4 | 5
  /** RSS 任务栏宽（列表%/讨论%）；全局，新建任务共用。 */
  rssPaneWidths?: import('./rssTask').RssPaneWidths
  /** 已经主动提示过的新版本号（同一版本只弹一次）。 */
  updateNoticeSeenVersion?: string
  /** 用户点过「稍后」的更新横幅版本；与通知 seen 分开，避免横幅被静默吞掉 */
  updateBannerDismissedVersion?: string
  /** 左侧任务列表是否折叠。 */
  sidebarCollapsed?: boolean
  /** 聊天后端：Cursor / OpenClaw / Claude Code / Codex。 */
  agentBackend?: AgentBackend
  /** OpenClaw 的 agent id（如 main / frontend）。 */
  openclawAgentId?: string
  /** @deprecated 使用 modelProviders；保留兼容。 */
  models?: ModelPref[]
  /** 层级模型提供商配置（真源）。 */
  modelProviders?: ModelProvider[]
  /** 普通对话默认模型引用，如 cursor:auto。 */
  defaultModelRef?: string
  /** 是否展示 agent 思考过程（关则隐藏；开则默认折叠）。 */
  showReasoning?: boolean
  /** 是否展示工具/命令调用（关则隐藏；开则默认折叠）。 */
  showTools?: boolean
  /**
   * 已废弃：系统提示改为按 Conversation.systemPrompt 配置。
   * 保留字段以免旧 settings.json 报错；发送时不再读取。
   */
  systemPrompt?: string
  /** 用户保存的系统提示模版库（可套用到某个任务）。 */
  promptTemplates?: PromptTemplate[]
  /** @deprecated 系统提示不再用全局选中模版。 */
  activePromptTemplateId?: string | null
  /** 桌宠快速对话（点宠 / 语音）。 */
  quickChat?: import('./quickChat').QuickChatSettings
}

/** 图片皮肤包（唯一目录 userData/skins）。 */
export interface ImagePack {
  id: string
  name: string
  /** 该包提供了哪些状态的图（如 idle/thinking/tool…）。 */
  states: string[]
}

/** 加载后的图片皮肤：各状态 → data URL。 */
export interface LoadedImageSkin {
  id: string
  images: Record<string, string>
  /** 动作图池（非状态命名的图），用于随机动作 / 连续表演 / 日常随机触发。 */
  actions: string[]
}

/** 区分不同任务/会话的标签。 */
export interface TaskTag {
  id: string
  emoji: string
  label: string
}

/** 需要用户批准的请求。 */
export interface ApprovalRequest {
  id: string
  kind: 'shell' | 'mcp' | 'tool'
  content: string
  task: TaskTag
  /** 来自 IDE 联动时，点击可唤起的本机应用名。 */
  ideApp?: string
  /** IDE session / 态势轨 id，多审批卡辨识用。 */
  sessionId?: string
  trackId?: string
}

/** 命令/工具执行结果。 */
export interface ApprovalResult {
  command: string
  output?: string
  exitCode?: number
  task: TaskTag
}

export type ApprovalDecision = 'allow' | 'deny'

/** IDE agent 活动监控的一条记录。 */
export interface Activity {
  id: string
  ts: number
  emoji: string
  label: string
  kind: 'prompt' | 'think' | 'tool' | 'edit' | 'command' | 'wait' | 'done' | 'error'
  text: string
  /** IDE 工作区目录（若 hook 能解析）。 */
  cwd?: string
  /** IDE session / conversation id（若 hook 能解析）。 */
  sessionId?: string
}

export interface ChatHistory {
  messages: ChatMessage[]
  sessionId?: string
}

/** 一个独立任务/会话（多标签）。 */
/** 任务内一轮对话（侧栏任务之下的多线程）。 */
export interface TaskThread {
  id: string
  title: string
  messages: ChatMessage[]
  sessionId?: string
  /** 对比任务：各列随线程归档。 */
  lanes?: Record<string, CompareLane>
  createdAt: number
  updatedAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  /** cursor-agent 会话 ID，用于 --resume 保持上下文。 */
  sessionId?: string
  /**
   * 任务内多轮对话线程（chat / compare）。
   * 当前线程镜像在 messages / sessionId / lanes；切换前会 sync。
   */
  threads?: TaskThread[]
  /** 当前线程 id；缺省时由 messages 懒生成。 */
  activeThreadId?: string
  /** 该任务的工作目录。 */
  cwd?: string
  /** 普通对话 / 多模型对比 / RSS 订阅；缺省为 chat。 */
  kind?: 'chat' | 'compare' | 'rss'
  /** RSS 订阅任务：多源 + 长期条目归档（Folo 三栏）。 */
  rss?: import('./rssTask').RssTaskState
  /**
   * RSS：每条订阅独立讨论（entryId → messages）。
   * 当前选中条的消息仍镜像在 `messages`，便于复用发送/流式逻辑。
   */
  rssThreads?: Record<string, ChatMessage[]>
  /** RSS：每条讨论各自的引擎 session。 */
  rssSessions?: Record<string, string>
  /**
   * RSS：每条讨论的 讨论轮次。清空该条讨论必须换新，否则 daemon 续旧文。
   */
  rssDiscussionEpochs?: Record<string, string>
  /** RSS：每条讨论各自的模型（与顶栏 modelRef 镜像当前条）。 */
  rssModelRefs?: Record<string, string>
  /** RSS：每条讨论各自的权限档。 */
  rssAutonomies?: Record<string, AgentAutonomy>
  /**
   * RSS：新讨论的默认模型（建任务时写入；切条时无独立配置则回落这里）。
   * 改某条讨论的模型不会改这个默认值。
   */
  rssDefaultModelRef?: string
  /** RSS：新讨论的默认权限档。 */
  rssDefaultAutonomy?: AgentAutonomy
  /** 普通对话选用的模型引用（如 cursor:auto）。 */
  modelRef?: string
  /**
   * 本任务：生成完成后是否自动朗读。
   * undefined = 跟随设置里的 TTS 缺省；true/false = 本任务覆盖。
   */
  ttsAutoSpeak?: boolean
  /**
   * 本任务的系统提示（可空）。
   * 仅作用于当前对话/对比，不共享到其它任务。
   */
  systemPrompt?: string
  /** @deprecated 唤醒词已移除。 */
  wakeWord?: string
  /** 若由提示词预设创建，记下模板 id。 */
  promptTemplateId?: string
  /**
   * 本任务是否开启直连深度思考。
   * undefined = 跟随提供商默认；true/false = 本任务覆盖。
   */
  enableThinking?: boolean
  /**
   * 本任务 Agent 自治等级（全引擎 + 直连 API）。
   * 缺省：新任务写默认值；旧存档无字段发送时按 agent 兼容。
   */
  agentAutonomy?: AgentAutonomy
  /** @deprecated UI 已去掉权限回放；旧存档可能仍带此字段。 */
  permissionLog?: PermissionLogEntry[]
  /**
   * 对比列定义（有序）。id 唯一；modelId 可重复。
   * 旧数据可能只有 compareModelIds，加载时会迁移。
   */
  compareLanes?: CompareLaneRef[]
  /** @deprecated 使用 compareLanes；保留以兼容旧存档。 */
  compareModelIds?: string[]
  /**
   * 对比任务：共享 user 时间线在 messages；
   * 各列 assistant 放在 lanes[laneId].messages。
   */
  lanes?: Record<string, CompareLane>
  /**
   * 所属自定义分组；缺省 / 空 = 未分组。
   * 指向 ChatStore.groups[].id；normalize 时会清掉失效 id。
   */
  groupId?: string
  /** 置顶时间戳；有值则出现在侧栏「置顶」区（仍保留 groupId）。 */
  pinnedAt?: number
  createdAt: number
  updatedAt: number
}

/** 任务侧栏自定义分组。 */
export interface ConversationGroup {
  id: string
  name: string
  /** 显示顺序（越小越靠前）；未分组区始终在最上，不占此列。 */
  order: number
}

/** 多会话存储。 */
export interface TodayMemo {
  id: string
  title: string
  body: string
  createdAt: number
  /** 最近改过；缺省当 createdAt。 */
  updatedAt?: number
  /** 缺省 remind。log 只进右侧记录，不进待办、不弹宠物。 */
  kind?: 'remind' | 'log'
  /** 到点提醒；没有则仍是待办（随时），只是不弹宠物。 */
  remindAt?: number
  completedAt?: number
  /** 从创建到勾完的时长。 */
  durationMs?: number
  /** 已经对宠物响过一次。 */
  firedAt?: number
}

/** 对话跑完但人还没点进去：钉在工作台待看，不被态势冲掉。 */
export interface TodayHeldDone {
  id: string
  conversationId: string
  title: string
  detail: string
  updatedAt: number
}

export interface ChatStore {
  conversations: Conversation[]
  activeId: string
  /** 自定义分组；旧存档缺省视为 []。 */
  groups?: ConversationGroup[]
  /** 默认任务区显示名；缺省为「日常」。 */
  ungroupedLabel?: string
  /** 最近一次快速对话/发送过的 chat 任务（点宠关窗时回落）。 */
  lastChatInteractedId?: string
  /** 工作台提醒（含已完成笔记）。 */
  todayMemos?: TodayMemo[]
  /** 资讯任务栏顺序（不含「全部」）。 */
  todayReadLaneOrder?: string[]
  /** 完成但未打开的对话。 */
  todayHeldDones?: TodayHeldDone[]
}

/** 一条对话消息里，不同类型的内容块（codex 风格）。 */
export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  /** 工具调用前的过程旁白（如「我先查一下…」），可隐藏且不进汇总。 */
  | { kind: 'status'; text: string; pin?: boolean }
  /**
   * 本回合技能落地结果（始终展示）：
   * native/cursor-slash = 点名；catalog = 薄目录；inline = 全文注入。
   */
  | {
      kind: 'skill'
      mode: SkillReportMode
      injected: string[]
      missing: string[]
      truncated: string[]
      text: string
    }
  | { kind: 'sticker'; id: string; emoji: string; label?: string; image?: string }
  | { kind: 'attachment'; path: string; name: string; mime?: string; preview?: string }
  | { kind: 'tool'; id?: string; name: string; input?: string; output?: string; status: 'running' | 'done' | 'error' }
  | {
      kind: 'command'
      id?: string
      command: string
      output?: string
      exitCode?: number
      status: 'running' | 'done' | 'error'
    }

/** 一轮 Agent 完成后的耗时 / token（有则展示）。 */
export interface AgentRunUsage {
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  /** 缓存命中（含在 inputTokens 里）。有则输入不是「这一句的新字」。 */
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  blocks: ChatBlock[]
  createdAt: number
  /** 对比任务中 assistant 归属的模型 id。 */
  modelId?: string
  /**
   * 消息来源标记。compare-summary：多模型勾选后的汇总请求（UI 默认可折叠）。
   */
  source?: 'compare-summary'
  /** 汇总请求的短摘要（候选条数、用户附加说明）。 */
  summaryMeta?: { candidateCount: number; note?: string }
  /** 本轮完成后的耗时 / token。 */
  runUsage?: AgentRunUsage
}

/** 从 cursor-agent 流里解析出来、发给渲染进程的增量事件。 */
export type AgentEvent = (
  | { type: 'session'; sessionId: string }
  | { type: 'state'; state: PetState; note?: string }
  | { type: 'assistant-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool'; id?: string; name: string; input?: string; output?: string; status: 'running' | 'done' | 'error' }
  | {
      type: 'command'
      id?: string
      command: string
      output?: string
      exitCode?: number
      status: 'running' | 'done' | 'error'
    }
  /** 本回合技能是否真正进了 prompt（用户靠它判断 OpenClaw/Claude 等有没有用上）。 */
  | {
      type: 'skills'
      mode: SkillReportMode
      injected: string[]
      missing: string[]
      truncated: string[]
    }
    /** 给用户看的本轮说明（如直连没把附件内嵌），关「过程」也要留着。 */
    | { type: 'notice'; text: string }
    | { type: 'done'; result?: string; usage?: AgentRunUsage; quiet?: boolean }
  | { type: 'error'; message: string; usage?: AgentRunUsage; quiet?: boolean }
  | { type: 'aborted'; usage?: AgentRunUsage; quiet?: boolean }
) & {
  /** 归属的对话；并行多任务时用于路由到对应会话。 */
  conversationId?: string
  /** 对比并行时归属的模型 id（展示用）。 */
  modelId?: string
  /** 对比并行时归属的列实例 id（路由用，可重复模型时必须）。 */
  laneId?: string
  /**
   * 事件来源：ide = Cursor/Claude/Codex 等联动 hooks；
   * cpet = 本应用对话窗。缺省按 cpet 处理。
   */
  origin?: 'ide' | 'cpet'
  /** origin=ide 时用于唤起的本机应用名（如 Cursor / Claude）。 */
  ideApp?: string
}

export interface NewsItem {
  title: string
  /** 文章或讨论页。 */
  url: string
  id: number | string
  /** 来源，气泡展示用。 */
  source?: 'hn' | 'v2ex' | 'rss'
  /** 浅摘要（非全文）。 */
  snippet?: string
  /** RSS 源展示名。 */
  sourceLabel?: string
}

export interface WeatherInfo {
  /** 地域名，如 Beijing, China / 上海 */
  place: string
  /** 展示文案：地域 · 天气 · 温度… */
  text: string
  /** 点击打开的详情页。 */
  url: string
  /** 按时区约估定位，非可靠；应引导用户手填城市。 */
  approx?: boolean
}

/** 对话附件（文件 / 图片）。 */
export interface ChatAttachment {
  path: string
  name: string
  mime?: string
  size?: number
  /** 图片预览 data URL（仅 UI）。 */
  preview?: string
  /** 加入本轮附件的时间（毫秒）。 */
  addedAt?: number
}

/** 点击宠物气泡后要执行的动作。 */
export type BubbleAction =
  | { kind: 'chat'; conversationId?: string }
  | { kind: 'monitor' }
  | { kind: 'schedules' }
  | { kind: 'settings'; section?: string }
  | { kind: 'url'; url: string }
  | { kind: 'app'; name: string }
  /** 打开资讯：优先对齐 RSS 新闻条目（briefId 可定位收件箱条目；不落到简报页）。 */
  | { kind: 'brief'; briefId?: string }
  /** 打开 RSS 任务并定位条目或简报。 */
  | { kind: 'rss'; conversationId: string; entryId?: string; digestId?: string }

/** 权限/工具回放条的一条记录（IDE 审批或本窗代理操作摘要）。 */
export interface PermissionLogEntry {
  id: string
  at: number
  source: 'ide' | 'cpet'
  kind: 'shell' | 'write' | 'tool' | 'mcp' | 'other'
  summary: string
  decision?: 'allow' | 'deny' | 'timeout' | 'auto'
}

export interface ChatTurnMessage {
  role: 'user' | 'assistant'
  content: string
  /** 该轮用户附件；直连 API 用来内嵌图/声/影，不只把路径当文字。 */
  attachments?: Array<{ path: string; name: string; mime?: string }>
}

export interface SendPromptPayload {
  prompt: string
  /** 对话 id：用于并行多任务时隔离运行与事件路由。 */
  conversationId?: string
  /**
   * 任务内对话轮次。后台 session 按这个绑，清空/新开一轮必须换新 id。
   */
  threadId?: string
  /** 复用已有会话以保持上下文；为空则新建会话。 */
  sessionId?: string
  /** 可选：agent 运行的工作目录。 */
  cwd?: string
  /**
   * 本轮附件。直连 API 把图/声/影编成原生多模态 content；
   * Codex 图片走 `--image`；其余 Agent CLI 把路径写入 prompt 再 Read。
   */
  attachments?: Array<{ path: string; name: string; mime?: string }>
  /**
   * 资讯正文里的远程图。直连主进程拉下来编成 image_url，不把 URL 当已经看见。
   */
  remoteImages?: string[]
  /** 显式调用的技能 id（Cursor：消息前加 /name）。 */
  skills?: string[]
  /** 单模型指定（cursor-agent --model）。 */
  model?: string
  /** 对比列实例 id（与 model 一起用；并行重复模型时作 run key）。 */
  laneId?: string
  /**
   * 非 Agent（自定义 API）的多轮上下文（不含本轮 prompt）。
   * Agent CLI 靠 sessionId 自己续聊，可忽略此字段。
   */
  history?: ChatTurnMessage[]
  /**
   * 系统提示。自定义 API 用 system 角色；Agent CLI 叠到用户消息前。
   * 主进程会从设置注入；也可由调用方显式传入。
   */
  systemPrompt?: string
  /**
   * 直连深度思考（覆盖提供商默认）。Agent CLI 忽略此字段。
   */
  enableThinking?: boolean
  /** Agent 自治：ask / plan / agent（全引擎 CLI flag + 系统提示约束）。 */
  agentAutonomy?: AgentAutonomy
  /** 对比一轮：并行发给多个列（可重复模型）。 */
  compareRuns?: Array<{
    laneId: string
    model: string
    sessionId?: string
    /** 该列自己的多轮上下文（对比时每列回复不同）。 */
    history?: ChatTurnMessage[]
  }>
  /** @deprecated 使用 compareRuns。 */
  models?: string[]
  /** @deprecated 使用 compareRuns[].sessionId。 */
  modelSessions?: Record<string, string>
}

/** 定时任务调度方式。 */
export type ScheduleKind = 'interval' | 'daily' | 'once'

/** 定时任务作业类型：agent 发提示词；rss-digest 写回绑定 RSS 的简报。 */
export type ScheduleJob = 'agent' | 'rss-digest'

/** 一条定时任务：到点跑 agent 提示词，或生成绑定 RSS 的简报。 */
export interface ScheduledTask {
  id: string
  name: string
  /**
   * agent：完整提示词（必填）。
   * rss-digest：可选「关注问题 / 补充说明」。
   */
  prompt: string
  cwd?: string
  /**
   * 执行所用模型，格式 provider:model（如 cursor:auto、openclaw:main、medical:qwen3.7-max）。
   * 缺省则用设置里的 defaultModelRef。
   */
  modelRef?: string
  /** 显式启用的技能 id；缺省时从 prompt 开头的 `/技能名` 解析。 */
  skills?: string[]
  kind: ScheduleKind
  /** interval：间隔分钟数（最少 1）。 */
  intervalMinutes?: number
  /** daily：每天几点几分（0–23 / 0–59）。 */
  hour?: number
  minute?: number
  /** once：一次性执行的 Unix 毫秒时间戳。 */
  runAt?: number
  enabled: boolean
  /** 绑定会话以 --resume 保持上下文；空则每次新建。rss-digest 与 rssConversationId 对齐。 */
  conversationId?: string
  /** 缺省 agent；旧数据无此字段视为 agent。 */
  job?: ScheduleJob
  /** rss-digest：绑定的 RSS 对话 id（删除该 RSS 时级联删除本任务）。 */
  rssConversationId?: string
  /** rss-digest：来源 RSS 标题快照，列表展示用。 */
  sourceLabel?: string
  /** rss-digest：简报形式。 */
  digestTemplate?: import('./rssTask').RssDigestTemplate
  /**
   * rss-digest：只收录评分 ≥ 此值的消息；缺省 / 0 = 全部。
   * 与列表「重点」档位一致：3 一般+ · 4 值得看+ · 5 必读。
   */
  digestScoreMin?: 3 | 4 | 5
  lastRunAt?: number
  /** 最近一次是否成功（旧数据可能缺省）。 */
  lastRunOk?: boolean
  /** 最近一次运行摘要（成功结论或失败原因）。 */
  lastRunSummary?: string
  /** 连续失败次数；成功清零。达到阈值可自动暂停。 */
  consecutiveFailures?: number
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

/** 定时任务触发时通知渲染进程同步对话状态。 */
export interface ScheduleRunPayload {
  taskId: string
  taskName: string
  conversationId: string
  userMsgId: string
  assistantMsgId: string
  store: ChatStore
}

export interface AgentStatus {
  installed: boolean
  /** cursor-agent 可执行文件路径（若找到）。 */
  binPath?: string
  version?: string
  /**
   * 是否没有任何 Agent CLI 可用（此时默认 cursor 路径会走 Mock）。
   * 具体任务是否演示，请结合模型引用看 resolveRunMode。
   */
  usingMock: boolean
  /** 本机用户主目录（仅作参照；不得作为 Agent 默认 cwd）。 */
  defaultCwd: string
  /** 是否至少有一个 Agent 引擎已安装。 */
  anyAgentInstalled?: boolean
  /** 当前选用的后端。 */
  backend: AgentBackend
  /** 启动扫描：各引擎安装/就绪情况（含未来引擎）。 */
  engines: EngineDetection[]
  /** OpenClaw 是否已安装。 */
  openclawInstalled: boolean
  openclawBinPath?: string
  openclawVersion?: string
  /** 本机可用的 OpenClaw agent id 列表。 */
  openclawAgents: string[]
  /** 当前选中的 OpenClaw agent。 */
  openclawAgentId: string
}

export type ChatPanelId = 'chat' | 'today' | 'monitor' | 'schedules' | 'settings' | 'skins'

/** 打开对话窗面板；可带设置页锚点或聚焦某对话。 */
export type OpenPanelTarget = {
  panel: ChatPanelId
  section?: string
  /** 打开 chat 时切换到该对话（定时通知深链等）。 */
  conversationId?: string
  /** 打开后聚焦输入框（作战板「回复」/ 等你通知）。 */
  focusComposer?: boolean
  /** 打开 RSS 任务时选中该条目。 */
  rssEntryId?: string
  /** 打开 RSS 任务时选中该简报。 */
  rssDigestId?: string
  /** 打开 RSS 时离开简报页，落到新闻列表/阅读（资讯气泡用）。 */
  rssExitDigest?: boolean
  /** 打开监控时预选该 IDE session 分轨（真实 session，非 default）。 */
  monitorSessionId?: string
}

/** 应用自身信息（About / 版本展示）。 */
export interface AppInfo {
  name: string
  version: string
  author: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  /** GitHub Releases 等更新页（可空）。 */
  releasesUrl?: string
  /** 源码仓（Git 仓库）。 */
  repoUrl?: string
  /** 问题反馈 Issue 页。 */
  feedbackUrl?: string
}

/** preload 通过 contextBridge 暴露给渲染进程的 API 形状。 */
export interface PetApi {
  // 通用
  getAgentStatus: () => Promise<AgentStatus>
  /** 应用版本与运行时信息。 */
  getAppInfo: () => Promise<AppInfo>
  getUiLanguage: () => Promise<UiLanguageState>
  setUiLanguage: (preference: UiLanguagePreference) => Promise<UiLanguageState>
  onUiLanguageChanged: (cb: (state: UiLanguageState) => void) => () => void
  /** 查线上最新 Release 并与本机版本比较。 */
  checkForUpdate: () => Promise<UpdateCheckResult>
  /** 最近一次更新检查结果（供横幅；可能为 null）。 */
  getLastUpdateResult: () => Promise<UpdateCheckResult | null>
  /** 关掉某版本的更新横幅（仍可去关于页手动检查）。 */
  dismissUpdateBanner: (version: string) => void
  /** 后台发现新版本时推给对话窗。 */
  onUpdateAvailable: (cb: (result: UpdateCheckResult) => void) => () => void
  /** 弹出目录选择框，返回所选路径（取消则 undefined）。preferredStart 为期望打开的起点目录。 */
  pickWorkingDir: (preferredStart?: string) => Promise<string | undefined>
  // 设置持久化
  getSettings: () => Promise<Settings>
  setSkin: (skin: SkinId) => void
  setCwd: (cwd: string) => void
  /** 设置聊天用户头像 emoji（会清除图片头像）。 */
  setUserAvatar: (emoji: string) => void
  /** 选择本地图片作为用户头像；取消返回 null，成功返回 data URL。 */
  pickUserAvatarImage: () => Promise<string | null>
  /** 对话框皮肤主题。 */
  setChatTheme: (theme: ChatThemeId) => void
  /** 自定义主题配色。 */
  setChatThemeCustom: (custom: ChatThemeCustom) => void
  /** 主题变更（设置页改完后同步到宠物窗 / 皮肤窗）。 */
  onChatTheme: (
    cb: (payload: { theme: ChatThemeId; custom: ChatThemeCustom }) => void
  ) => () => void
  /** 天气城市（空字符串=自动 IP）。 */
  setWeatherCity: (city: string) => void
  /** 标记已提示过设置天气城市。 */
  setWeatherCityPrompted: (prompted: boolean) => void
  setBriefOnboardingPrompted: (prompted: boolean) => void
  /** 宠物简报内置兜底源（无 RSS 时生效）。 */
  setNewsSource: (source: NewsSourceId) => void
  /** @deprecated 全局订阅源已废弃；仅用于清空旧配置。 */
  setBriefRssFeeds: (urls: string[]) => void
  /** 简报兴趣关键词。 */
  setBriefInterestKeywords: (keywords: string[]) => void
  /** 简报屏蔽词。 */
  setBriefMuteKeywords: (keywords: string[]) => void
  /** 每日简报气泡整点（可多选）；传 null/[] 关闭。与 interval 互斥。 */
  setBriefDailyDigestHours: (hours: number[] | null) => void
  /** @deprecated 改用 setBriefDailyDigestHours。 */
  setBriefDailyDigestHour: (hour: number | null) => void
  /** 宠物推送每隔 N 小时；传 null/undefined 关闭。与每日整点互斥。 */
  setBriefDigestIntervalHours: (hours: number | null) => void
  setRssScoreModelRef: (ref: string) => void
  setRssScoreMode: (mode: 'realtime' | 'interval' | 'off') => void
  setRssScoreIntervalMinutes: (minutes: number) => void
  setRssOrganizeLang: (lang: import('./rssLang').RssOrganizeLang) => void
  /** 桌宠气泡推送的最低价值分（默认必读=5）。 */
  setRssPetPushMinScore: (min: 3 | 4 | 5) => void
  /** RSS 三栏宽度（全局，新建任务共用）。 */
  setRssPaneWidths: (widths: import('./rssTask').RssPaneWidths) => void
  /** 清天气缓存并立即重拉（设置页校验用）。 */
  refreshWeather: () => Promise<WeatherInfo | null>
  /** 左侧任务列表折叠。 */
  setSidebarCollapsed: (collapsed: boolean) => void
  /** 显示/隐藏思考过程。 */
  setShowReasoning: (show: boolean) => void
  /** 显示/隐藏工具与命令。 */
  setShowTools: (show: boolean) => void
  /** 对话窗切换「⋯ 过程」时同步给宠物窗。 */
  onShowDetailsChange: (cb: (show: boolean) => void) => () => void
  setAgentBackend: (backend: AgentBackend) => void
  setOpenclawAgentId: (id: string) => void
  listOpenclawAgents: () => Promise<string[]>
  /** 扫描可用 Agent 技能（按工作目录）。 */
  listSkills: (cwd?: string) => Promise<AgentSkill[]>
  /** 拉取模型目录（按提供商分组）。 */
  listModelCatalog: () => Promise<{
    cursor: Array<{ id: string; label: string }>
    openclaw: Array<{ id: string; label: string }>
    'claude-code': Array<{ id: string; label: string }>
    codex: Array<{ id: string; label: string }>
  }>
  /** @deprecated 使用 listModelCatalog */
  listModels: () => Promise<Array<{ id: string; label: string }>>
  /** 持久化扁平模型勾选（兼容）。 */
  setModels: (models: ModelPref[]) => void
  /** 持久化层级提供商配置。 */
  setModelProviders: (providers: ModelProvider[]) => Promise<ModelProvider[]>
  setDefaultModelRef: (ref: string) => void
  /** 新任务默认 Agent 自治等级。 */
  setDefaultAgentAutonomy: (mode: AgentAutonomy) => void
  /** 技能投递方式（auto / native / catalog / inject）。 */
  setSkillDelivery: (mode: SkillDeliveryPref) => void
  /** 设置当前生效的系统提示（空字符串=关闭）。 */
  setSystemPrompt: (text: string) => void
  /** 保存用户系统提示模版列表。 */
  setPromptTemplates: (templates: PromptTemplate[]) => void
  setQuickChat: (patch: import('./quickChat').QuickChatSettings) => void
  /** 轻量联想记忆：开/关（默认关）。 */
  setAgentMemoryEnabled: (enabled: boolean) => Promise<import('./agentMemory').AgentMemorySettings>
  /** 联想记忆统计（节点/有效边、抽取模型、上次抽取结果）。 */
  getAgentMemoryStats: () => Promise<import('./agentMemory').AgentMemoryStatsResult>
  /** 抽取结束或本次发送带上召回时推给对话窗。 */
  onAgentMemoryChanged: (
    cb: (payload: import('./agentMemory').AgentMemoryStatsResult) => void
  ) => () => void
  /** 清空边表与日记念叨句（不关开关）。 */
  clearAgentMemory: () => Promise<{ ok: true; nodes: number; edges: number }>
  /** 合成朗读：系统参数回传 / CosyVoice 本机音频；渲染层负责播放。 */
  ttsSpeak: (text: string) => Promise<import('./tts').TtsSpeakResult>
  /**
   * 流式朗读：主进程推 PCM 帧，渲染层边收边播。
   * 成功且 alreadyPlayed 时无需再 playTtsResult。
   */
  ttsSpeakLive: (text: string) => Promise<import('./tts').TtsSpeakResult>
  /**
   * 认领本窗为唯一朗读方（防聊天窗+桌宠双播重复/音色漂移）。
   * chat 可抢走 pet；pet 抢不到 chat。
   */
  ttsClaim: (opts: {
    role: 'chat' | 'pet' | 'preview'
    conversationId?: string
  }) => Promise<{ ok: true; gen: number } | { ok: false; reason: string }>
  /** 释放朗读归属（停止/结束一轮时调用）。 */
  ttsRelease: () => Promise<void>
  onTtsPcmStart: (
    cb: (ev: { id: string; sampleRate: number }) => void
  ) => () => void
  onTtsPcmFrame: (
    cb: (ev: { id: string; sampleRate: number; pcm: string }) => void
  ) => () => void
  onTtsPcmEnd: (
    cb: (ev: { id: string; ok: boolean; error?: string }) => void
  ) => () => void
  /** CosyVoice 侧车状态。 */
  ttsCosyStatus: () => Promise<import('./tts').CosyVoiceStatus>
  /** 开启 TTS 时安装：克隆仓库 + 拉模型。 */
  ttsCosyInstall: () => Promise<import('./tts').CosyVoiceInstallResult>
  /** 下载 / 校验 CosyVoice 模型。 */
  ttsCosyPrepareModel: () => Promise<{ ok: true; modelDir: string } | { ok: false; error: string }>
  /** 自定义音色列表。 */
  ttsListVoices: () => Promise<import('./tts').TtsCustomVoice[]>
  /** 添加自定义音色（参考 wav + 文本）。 */
  ttsAddVoice: (input: {
    name: string
    promptWav: string
    promptText?: string
  }) => Promise<{ ok: true; voice: import('./tts').TtsCustomVoice } | { ok: false; error: string }>
  ttsRemoveVoice: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  ttsPickPromptWav: () => Promise<string | null>
  ttsPickCosyRoot: () => Promise<string | null>
  /** 记录当前选中的模版 id（可空）。 */
  setActivePromptTemplateId: (id: string | null) => void
  onPetSkin: (cb: (skin: SkinId) => void) => () => void
  // 图片皮肤 / 皮肤市场
  getImagePacks: () => Promise<ImagePack[]>
  /** 本地包列表（来源、预览、状态数）。 */
  listLocalSkinPacks: () => Promise<
    Array<{
      id: string
      name: string
      states: string[]
      source: 'bundled' | 'user' | 'market'
      actionCount?: number
      preview?: string
    }>
  >
  getImageSkin: () => Promise<LoadedImageSkin | null>
  /** 唯一皮肤目录路径（userData/skins）。 */
  getSkinsDir: () => Promise<string>
  setImageSkin: (id: string | null) => void
  openSkinsDir: () => void
  onPetImageSkin: (cb: (skin: LoadedImageSkin | null) => void) => () => void
  /** 拉取 OSS 皮肤目录并合并本机安装状态。 */
  fetchSkinMarket: () => Promise<{
    status: 'ok' | 'not-configured' | 'error' | 'empty'
    message: string
    rows?: Array<{
      entry: {
        id: string
        name: string
        description?: string
        author?: string
        packUrl: string
        previewUrl?: string
        sha256?: string
        bytes?: number
        states?: string[]
        version?: string
      }
      installed: boolean
      localSource?: 'bundled' | 'user' | 'market'
      resolvedPackUrl: string
      resolvedPreviewUrl?: string
    }>
    activeImageSkin?: string
  }>
  downloadSkinPack: (payload: {
    id: string
    packUrl: string
    sha256?: string
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  uninstallSkinPack: (
    id: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  importSkinPack: () => Promise<
    { ok: true; id: string } | { ok: false; error: string; canceled?: boolean }
  >
  exportSkinPack: (
    id: string
  ) => Promise<
    { ok: true; path: string } | { ok: false; error: string; canceled?: boolean }
  >
  /** 投稿到皮肤市场：导出 zip、写剪贴板、打开 Issue（审核后才上架）。 */
  prepareSkinMarketSubmission: (id: string) => Promise<
    | { ok: true; zipPath: string; clipboardText: string; issueUrl?: string; revealed: boolean }
    | { ok: false; error: string; canceled?: boolean }
  >
  // 对话历史持久化
  getHistory: () => Promise<ChatHistory>
  saveHistory: (history: ChatHistory) => void
  // 多会话存储
  getChatStore: () => Promise<ChatStore | null>
  saveChatStore: (store: ChatStore) => void
  onTodayMemosPatched: (cb: (memos: TodayMemo[]) => void) => () => void
  /** 原生确认框（无边框窗里比 window.confirm 可靠）。 */
  confirm: (message: string) => Promise<boolean>
  // 趣味信息源
  getWeather: () => Promise<WeatherInfo | null>
  getNews: () => Promise<NewsItem | null>
  /** 资讯简报收件箱快照。 */
  getBriefInbox: () => Promise<import('./briefInbox').BriefInbox>
  /** 强制刷新简报（网络拉取）。 */
  refreshBriefInbox: () => Promise<import('./briefInbox').BriefInbox>
  /** 订阅简报更新。 */
  onBriefInbox: (cb: (snap: import('./briefInbox').BriefInbox) => void) => () => void
  markBriefRead: (id: string) => void
  markAllBriefRead: () => void
  dismissBriefItem: (id: string) => void
  toggleBriefPin: (id: string) => void
  /**
   * 升级进对话/对比：打开窗并预填草稿（不自动发送）。
   * mode 默认 chat。
   */
  escalateBrief: (payload: {
    id?: string
    mode?: 'chat' | 'compare'
    /** 批量升级当前可行动未读（最多 5 条）。 */
    unreadBatch?: boolean
  }) => void
  onBriefEscalate: (
    cb: (payload: {
      item: import('./briefInbox').BriefItem
      items?: import('./briefInbox').BriefItem[]
      mode: 'chat' | 'compare'
      prompt: string
    }) => void
  ) => () => void
  /** 拉取后出现新料时的轻气泡（不进对话）。 */
  onBriefDigest: (cb: (payload: { text: string; hint: string; briefId?: string }) => void) => () => void
  /** RSS 任务重点条目 / 新简报推送到桌宠气泡。 */
  onRssPetTip: (
    cb: (payload: {
      text: string
      hint: string
      conversationId: string
      entryId?: string
      digestId?: string
      rank: number
      key: string
    }) => void
  ) => () => void
  /** 主进程后台拉源完成后，把源/条目合进当前会话（不抢阅读位置）。 */
  onRssFeedsSynced: (cb: (store: ChatStore) => void) => () => void
  /** 立刻在宠物旁播一条当前未读 digest（设置页当场试）。 */
  previewBriefDigest: () => void
  /** 按源列表拉取 RSS，返回可合并进任务的条目。 */
  refreshRssTaskFeeds: (feeds: import('./rssTask').RssTaskFeed[]) => Promise<{
    items: import('./rssTask').RssTaskEntry[]
    feeds: import('./rssTask').RssTaskFeed[]
    errors: string[]
  }>
  /** 抓取并净化文章可读正文（非通用浏览器）。 */
  fetchRssArticle: (
    url: string,
    opts?: { fallbackHtml?: string }
  ) => Promise<{
    ok: boolean
    title?: string
    html?: string
    error?: string
    preferWeb?: boolean
    /** 仅摘要/半截，网页全文未拿到 */
    partial?: boolean
  }>
  /**
   * 简洁/网页都失败时：用资讯模型（直连或 Agent）补全文。
   * 调用方负责写入条目并缓存，避免重复调用。
   */
  recoverRssArticleWithModel: (payload: {
    url: string
    title?: string
    snippet?: string
    /** 本地已有正文，作抓取 fallback */
    contentHtml?: string
    modelRef?: string
    /** true：强制走模型整理，不因已有抓取正文而短路 */
    forceModel?: boolean
  }) => Promise<{
    ok: boolean
    html?: string
    title?: string
    titleLocal?: string
    error?: string
    mode?: 'model' | 'extract'
  }>
  /** 发现订阅源：精选匹配 + 可选远程搜索。 */
  discoverRssFeeds: (payload?: {
    query?: string
    limit?: number
    /** 只返回本地精选，不请求 Feedly（首屏用）。 */
    localOnly?: boolean
  }) => Promise<{
    ok: boolean
    items: Array<{
      id: string
      name: string
      url: string
      desc: string
      category?: string
      source: 'preset' | 'remote'
      subscribers?: number
      updatedAt?: number
    }>
    error?: string
    remote?: boolean
  }>
  /** 目录源指标：订阅数 / 最近更新；可触发 Feedly + 直拉源回填。 */
  lookupRssFeedMetrics: (payload: {
    urls?: string[]
    items?: Array<{ url: string; name?: string }>
    enrich?: boolean
  }) => Promise<{
    ok: boolean
    metrics: Record<
      string,
      {
        subscribers?: number
        updatedAt?: number
        fetchedAt: number
      }
    >
  }>
  /** 按钮 / 快捷键：准备快速对话目标。 */
  quickChatArm: (payload?: { trigger?: 'click' }) => Promise<{
    ok: boolean
    error?: string
    conversationId?: string
    title?: string
    surface?: 'panel' | 'strip'
    pendingText?: string
    created?: boolean
  }>
  /** 语音一句：整句作为待发文本。 */
  quickChatArmVoice: (transcript: string) => Promise<{
    ok: boolean
    error?: string
    conversationId?: string
    title?: string
    surface?: 'panel' | 'strip'
    pendingText?: string
    created?: boolean
  }>
  /** 宠边发送到目标任务；目标不可用时主进程会新建对话并返回新 id。 */
  quickChatSend: (payload: {
    conversationId: string
    text: string
    attachments?: ChatAttachment[]
  }) => Promise<{
    ok: boolean
    error?: string
    conversationId?: string
    title?: string
    created?: boolean
  }>
  /** 对话窗 UI 已挂上快问监听（供主进程冲刷暂存发送）。 */
  quickChatReady: () => void
  /** 全局快捷键触发打开快速对话（主进程 → 宠物窗）。 */
  onQuickChatHotkey: (cb: () => void) => () => void
  /** 主进程同步会话到对话窗。 */
  onQuickChatSync: (
    cb: (payload: {
      store: ChatStore
      conversationId: string
      focusComposer: boolean
    }) => void
  ) => () => void
  /** 主进程让对话窗代发。 */
  onQuickChatSendToChat: (
    cb: (payload: {
      conversationId: string
      text: string
      attachments?: ChatAttachment[]
    }) => void
  ) => () => void
  /** 轻量条目价值打分（不写讨论线程）。 */
  scoreRssEntries: (payload: {
    entries: import('./rssTask').RssTaskEntry[]
    modelRef?: string
    forceHeuristic?: boolean
  }) => Promise<{
    ok: boolean
    scores: Array<{
      id: string
      valueScore: import('./rssTask').RssValueScore
      scoreReason: string
      tags?: string[]
      titleLocal?: string
    }>
    mode: 'model' | 'heuristic'
    error?: string
    bodyPatches?: import('./rssTask').RssBodyPatch[]
  }>
  /** 热点盘点报告（Markdown）。 */
  buildRssDigestReport: (payload: {
    entries: import('./rssTask').RssTaskEntry[]
    windowHours: number
    /** 自定义信息窗口文案；缺省按 windowHours 生成。 */
    infoWindow?: string
    modelRef?: string
    forceHeuristic?: boolean
    skeletonReason?: string
    template?: import('./rssTask').RssDigestTemplate
    /** 可选关注问题（定时简报）。 */
    focusPrompt?: string
  }) => Promise<{
    ok: boolean
    markdown: string
    /** 每份简报的独立题名。 */
    title: string
    mode: 'model' | 'heuristic'
    template?: import('./rssTask').RssDigestTemplate
    /** 实际纳入生成的条数。 */
    includedCount: number
    /** 窗内候选条数。 */
    windowCount: number
    error?: string
    /** 幻觉检测/链接校验修复摘要。 */
    repairNote?: string
    bodyPatches?: import('./rssTask').RssBodyPatch[]
  }>
  /**
   * 消息处置流水线：拉取→评分→截取→写稿（单窗）。
   * 进度经 onRssDispositionStage 推送。
   */
  runRssDisposition: (payload: {
    conversationId: string
    feeds: import('./rssTask').RssTaskFeed[]
    items: import('./rssTask').RssTaskEntry[]
    bounds: import('./rssTask').DigestTimeBounds
    entryIds?: string[]
    scoreMin?: number
    modelRef?: string
    template?: import('./rssTask').RssDigestTemplate
    focusPrompt?: string
    refresh?: boolean
    scoreUnscored?: boolean
    scoreEnabled?: boolean
  }) => Promise<{
    ok: boolean
    stage: import('./rssTask').RssDispositionStage
    detail?: string
    error?: string
    feeds: import('./rssTask').RssTaskFeed[]
    items: import('./rssTask').RssTaskEntry[]
    refreshErrors?: string[]
    record?: {
      title: string
      windowHours: import('./rssTask').RssDigestWindowHours
      rangeFrom?: string
      rangeTo?: string
      template: import('./rssTask').RssDigestTemplate
      markdown: string
      mode: 'model' | 'heuristic'
      entryCount: number
      windowCount?: number
      error?: string
    }
    includedCount: number
    windowCount: number
    unscoredBefore: number
    bodyPatches: import('./rssTask').RssBodyPatch[]
  }>
  onRssDispositionStage: (
    cb: (payload: {
      conversationId: string
      stage: import('./rssTask').RssDispositionStage
      detail?: string
    }) => void
  ) => () => void
  /** 弹出保存对话框写入文本文件。 */
  saveTextFile: (payload: {
    defaultPath: string
    content: string
    /** 保存对话框标题；默认「导出 Markdown」。 */
    title?: string
  }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 用系统浏览器打开外链。 */
  openExternal: (url: string) => void
  /** 打开本机应用（如 Cursor）。 */
  openApp: (name: string) => void
  /** 打开对话窗并切到指定面板。`skins` 会打开独立皮肤窗。可传 `{ panel, section }`。 */
  openChatPanel: (panel?: ChatPanelId | OpenPanelTarget) => void
  onOpenPanel: (cb: (target: OpenPanelTarget) => void) => () => void
  /** 从宠物旁打开独立皮肤窗（浏览/下载/导入/选用）。 */
  openSkins: () => void
  /** 关闭（隐藏）皮肤窗。 */
  closeSkins: () => void
  /** 切换皮肤窗显示。 */
  toggleSkins: () => void
  /** 选择本地文件作为附件（macOS 可选文件夹）。 */
  pickAttachments: () => Promise<ChatAttachment[]>
  /** 把文件/文件夹路径展开成附件列表。 */
  resolveAttachmentPaths: (paths: string[]) => Promise<ChatAttachment[]>
  /**
   * Electron 拖入/选取的 File → 本地绝对路径（webUtils.getPathForFile）。
   * 渲染进程不可再读 File.path（Electron 32+ 已移除）。
   */
  getPathForFile: (file: object) => string
  /** 打开对话窗并把附件加入当前任务草稿。 */
  ingestChatAttachments: (
    attachments: ChatAttachment[]
  ) => Promise<{ ok: boolean; count: number }>
  /** 对话窗：接收宠身/外部拖入的附件。 */
  onChatIngestAttachments: (cb: (attachments: ChatAttachment[]) => void) => () => void
  /** 把粘贴/拖入的二进制存成临时文件。 */
  saveTempAttachment: (payload: {
    name: string
    base64: string
    mime?: string
  }) => Promise<ChatAttachment | null>
  /** 为图片附件生成预览 data URL。 */
  previewAttachment: (path: string) => Promise<string | null>
  /** 读取文本附件预览。 */
  readAttachmentText: (
    path: string
  ) => Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; error: string }>
  /** 用系统默认应用打开本地附件。 */
  openAttachmentPath: (path: string) => Promise<{ ok: boolean; error?: string }>
  /** 在访达 / 资源管理器中显示该文件。 */
  revealAttachmentPath: (path: string) => Promise<{ ok: boolean; error?: string }>
  /** 打开文件所在上层文件夹。 */
  openAttachmentFolder: (path: string) => Promise<{ ok: boolean; error?: string }>
  /** Office（docx/xlsx/pptx）预览：有 LibreOffice 时出 PDF 原版式，否则 HTML 版式预览。 */
  readOfficePreviewText: (
    path: string
  ) => Promise<
    | {
        ok: true
        html: string
        truncated: boolean
        format: string
        pdfPath?: string
        mode?: 'pdf' | 'html'
      }
    | { ok: false; error: string }
  >
  /** macOS 原生听写是否可用（助手二进制存在）。 */
  dictationAvailable: () => Promise<boolean>
  /** 开始流式听写（边说边出字，静音自动停）。 */
  startLiveDictation: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** 手动结束当前流式听写。 */
  stopLiveDictation: () => void
  /** 推送一帧 PCM（渲染进程采音）。 */
  pushLiveDictationPcm: (payload: { base64: string; sampleRate: number }) => void
  /** 流式听写事件。 */
  onDictationEvent: (
    cb: (
      ev:
        | { type: 'partial'; text: string }
        | { type: 'final'; text: string }
        | { type: 'end'; reason: string; text: string }
        | { type: 'error'; message: string }
    ) => void
  ) => () => void
  /** 将录音（base64 wav）交给系统语音识别，返回文本。 */
  transcribeAudio: (payload: {
    base64: string
    ext?: string
  }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  // Cursor 联动配置
  getSetupStatus: () => Promise<{
    hooksInstalled: boolean
    scriptsInstalled?: boolean
    cursor?: boolean
    claudeCode?: boolean
    codex?: boolean
    /** null=未探测；false=已挂但仍有未信任 hooks（ChatGPT 会静默跳过） */
    codexTrusted?: boolean | null
  }>
  configureIntegration: () => Promise<{
    ok: boolean
    error?: string
    codexTrustOk?: boolean | null
    codexTrustError?: string
    codexTrusted?: number
  }>
  removeIntegration: () => Promise<{ ok: boolean; error?: string }>
  installAgent: () => Promise<{ ok: boolean; log?: string }>
  /** 按引擎一键安装 CLI（OpenCode / Claude / Codex / Cursor 等）。 */
  installEngineCli: (engineId: string) => Promise<{ ok: boolean; log?: string }>
  /** 主进程写剪贴板（设置页复制命令；避免 navigator.clipboard 在 Electron 里失败）。 */
  writeClipboard: (text: string) => Promise<boolean>
  agentLogin: () => void
  /** 按引擎一键登录 CLI。 */
  engineCliLogin: (engineId: string) => void
  // 交互式审批
  setIntercept: (on: boolean) => void
  onApprovalRequest: (cb: (req: ApprovalRequest) => void) => () => void
  onApprovalResolved: (cb: (id: string) => void) => () => void
  onApprovalResult: (cb: (result: ApprovalResult) => void) => () => void
  decideApproval: (id: string, decision: ApprovalDecision) => void
  // IDE 活动监控
  onActivity: (cb: (a: Activity) => void) => () => void
  // 定时任务
  getSchedules: () => Promise<ScheduledTask[]>
  saveSchedule: (task: ScheduledTask) => Promise<ScheduledTask>
  deleteSchedule: (id: string) => Promise<void>
  /** 删除绑定到某对话（含 RSS）的全部定时任务。 */
  deleteSchedulesForConversation: (conversationId: string) => Promise<number>
  toggleSchedule: (id: string, enabled: boolean) => Promise<ScheduledTask | null>
  runScheduleNow: (id: string) => Promise<{ ok: boolean; error?: string }>
  onSchedulesChanged: (cb: (tasks: ScheduledTask[]) => void) => () => void
  onScheduleRun: (cb: (payload: ScheduleRunPayload) => void) => () => void
  /** 定时任务结束（可选监听；UI 已不再追加系统摘要卡）。 */
  onScheduleFinished: (
    cb: (info: {
      taskId: string
      taskName: string
      conversationId?: string
      ok: boolean
      detail?: string
      autoDisabled?: boolean
      /** rss-digest 完成后带上最新 chat store，渲染侧合并且不 beginStream。 */
      store?: ChatStore
    }) => void
  ) => () => void
  onOpenSchedules: (cb: () => void) => () => void
  /** 权限决策日志（兼容保留；UI 已去掉回放条）。 */
  onPermissionLog: (
    cb: (payload: { conversationId?: string; entry: PermissionLogEntry }) => void
  ) => () => void
  /** 作战板上报（兼容保留；UI 已去掉）。 */
  reportOpsBoard: (items: import('./opsBoard').OpsBoardItem[]) => void
  getOpsBoard: () => Promise<import('./opsBoard').OpsBoardSnapshot>
  onOpsBoard: (cb: (snap: import('./opsBoard').OpsBoardSnapshot) => void) => () => void
  dismissOpsItem: (payload: { id: string; conversationId?: string }) => void
  onDismissOpsItem: (
    cb: (payload: { id: string; conversationId?: string }) => void
  ) => () => void
  /** 登记 IDE 轨 ↔ 续查 CPET 对话，供通知/深链复用。 */
  bindIdeContinue: (payload: {
    conversationId: string
    sessionId?: string
    trackId?: string
  }) => void
  // 聊天
  sendPrompt: (payload: SendPromptPayload) => Promise<{ ok: boolean; error?: string }>
  /** 取消指定对话的运行；可再传 laneId/modelId 只取消该列；都不传则取消全部。 */
  cancel: (conversationId?: string, laneOrModelId?: string) => Promise<void>
  onAgentEvent: (cb: (event: AgentEvent) => void) => () => void
  /** @deprecated 完成摘要改在宠物气泡展示，对话窗不再消费。 */
  onExternalSummary: (cb: (text: string) => void) => () => void
  // 窗口 / 宠物
  /** 开/关对话窗；若传入 panel，仅在打开时跳转（关闭不带参）。 */
  toggleChat: (panel?: ChatPanelId | OpenPanelTarget) => void
  openChat: () => void
  /** 对话窗显隐：打开时宠物应收起快问气泡。 */
  onChatVisibility: (cb: (visible: boolean) => void) => () => void
  setPetState: (state: PetState) => void
  onPetState: (cb: (state: PetState) => void) => () => void
  onPetMood: (cb: (mood: PetMood) => void) => () => void
  /** 主进程下发动作指令：具体动作名 / 'random' / 'combo'。 */
  onPetAction: (cb: (action: string) => void) => () => void
  /** 贴边半隐藏：left/right/top；展开或未贴边为 null。 */
  onPetDockEdge: (cb: (edge: PetDockEdge) => void) => () => void
  showContextMenu: () => void
  /** 透明区域点击穿透开关：true=穿透到桌面，false=接管交互。 */
  setMouseIgnore: (ignore: boolean) => void
  /** 快问垫高；待办可再加宽，避免审批卡挤成一条。 */
  setPetQuickChatExpanded: (
    expanded: boolean | { expanded: boolean; wide?: boolean }
  ) => void
  dragStart: () => void
  dragEnd: () => void
  hidePet: () => void
  quit: () => void
}

export const IPC = {
  getAgentStatus: 'agent:status',
  getAppInfo: 'app:info',
  getUiLanguage: 'app:language:get',
  setUiLanguage: 'app:language:set',
  uiLanguageChanged: 'app:language:changed',
  checkForUpdate: 'app:check-update',
  getLastUpdateResult: 'app:last-update',
  dismissUpdateBanner: 'app:dismiss-update-banner',
  updateAvailable: 'app:update-available',
  pickWorkingDir: 'agent:pick-dir',
  getSettings: 'settings:get',
  setSkin: 'settings:set-skin',
  setCwd: 'settings:set-cwd',
  setUserAvatar: 'settings:set-user-avatar',
  pickUserAvatarImage: 'settings:pick-user-avatar-image',
  setChatTheme: 'settings:set-chat-theme',
  setChatThemeCustom: 'settings:set-chat-theme-custom',
  chatTheme: 'settings:chat-theme',
  setWeatherCity: 'settings:set-weather-city',
  setWeatherCityPrompted: 'settings:set-weather-city-prompted',
  setBriefOnboardingPrompted: 'settings:set-brief-onboarding-prompted',
  setNewsSource: 'settings:set-news-source',
  setBriefRssFeeds: 'settings:set-brief-rss',
  setBriefInterestKeywords: 'settings:set-brief-interest',
  setBriefMuteKeywords: 'settings:set-brief-mute',
  setBriefDailyDigestHours: 'settings:set-brief-digest-hours',
  setBriefDailyDigestHour: 'settings:set-brief-digest-hour',
  setBriefDigestIntervalHours: 'settings:set-brief-digest-interval',
  setRssScoreModelRef: 'settings:set-rss-score-model',
  setRssScoreMode: 'settings:set-rss-score-mode',
  setRssScoreIntervalMinutes: 'settings:set-rss-score-interval',
  setRssOrganizeLang: 'settings:set-rss-organize-lang',
  setRssPetPushMinScore: 'settings:set-rss-pet-push-min',
  setRssPaneWidths: 'settings:set-rss-pane-widths',
  refreshWeather: 'feed:weather-refresh',
  setSidebarCollapsed: 'settings:set-sidebar-collapsed',
  setShowReasoning: 'settings:set-show-reasoning',
  setShowTools: 'settings:set-show-tools',
  showDetailsChanged: 'settings:show-details-changed',
  setAgentBackend: 'settings:set-agent-backend',
  setOpenclawAgentId: 'settings:set-openclaw-agent',
  listOpenclawAgents: 'openclaw:list-agents',
  listSkills: 'skills:list',
  listModels: 'models:list',
  listModelCatalog: 'models:catalog',
  setModels: 'settings:set-models',
  setModelProviders: 'settings:set-model-providers',
  setDefaultModelRef: 'settings:set-default-model',
  setDefaultAgentAutonomy: 'settings:set-default-autonomy',
  setSkillDelivery: 'settings:set-skill-delivery',
  setSystemPrompt: 'settings:set-system-prompt',
  setPromptTemplates: 'settings:set-prompt-templates',
  setQuickChat: 'settings:set-quick-chat',
  setAgentMemoryEnabled: 'settings:set-agent-memory-enabled',
  getAgentMemoryStats: 'memory:stats',
  clearAgentMemory: 'memory:clear',
  memoryChanged: 'memory:changed',
  ttsSpeak: 'tts:speak',
  ttsSpeakLive: 'tts:speak-live',
  ttsClaim: 'tts:claim',
  ttsRelease: 'tts:release',
  ttsPcmStart: 'tts:pcm-start',
  ttsPcmFrame: 'tts:pcm-frame',
  ttsPcmEnd: 'tts:pcm-end',
  ttsCosyStatus: 'tts:cosy-status',
  ttsCosyInstall: 'tts:cosy-install',
  ttsCosyPrepareModel: 'tts:cosy-prepare',
  ttsListVoices: 'tts:list-voices',
  ttsAddVoice: 'tts:add-voice',
  ttsRemoveVoice: 'tts:remove-voice',
  ttsPickPromptWav: 'tts:pick-prompt-wav',
  ttsPickCosyRoot: 'tts:pick-cosy-root',
  setActivePromptTemplateId: 'settings:set-active-prompt-template',
  petSkin: 'pet:skin',
  getImagePacks: 'imgskin:list',
  getImageSkin: 'imgskin:get',
  getSkinsDir: 'imgskin:dir',
  setImageSkin: 'imgskin:set',
  openSkinsDir: 'imgskin:open-dir',
  petImageSkin: 'pet:image-skin',
  listLocalSkinPacks: 'skinmarket:list-local',
  fetchSkinMarket: 'skinmarket:fetch',
  downloadSkinPack: 'skinmarket:download',
  uninstallSkinPack: 'skinmarket:uninstall',
  importSkinPack: 'skinmarket:import',
  exportSkinPack: 'skinmarket:export',
  prepareSkinMarketSubmission: 'skinmarket:submit',
  getHistory: 'chat:get-history',
  saveHistory: 'chat:save-history',
  getChatStore: 'chat:get-store',
  saveChatStore: 'chat:save-store',
  todayMemosPatched: 'today:memos-patched',
  confirm: 'ui:confirm',
  getWeather: 'feed:weather',
  getNews: 'feed:news',
  getBriefInbox: 'brief:get',
  refreshBriefInbox: 'brief:refresh',
  briefInbox: 'brief:update',
  markBriefRead: 'brief:mark-read',
  markAllBriefRead: 'brief:mark-all-read',
  dismissBriefItem: 'brief:dismiss',
  toggleBriefPin: 'brief:toggle-pin',
  escalateBrief: 'brief:escalate',
  briefEscalate: 'brief:escalate-event',
  briefDigest: 'brief:digest',
  rssPetTip: 'rss:pet-tip',
  rssFeedsSynced: 'rss-task:feeds-synced',
  previewBriefDigest: 'brief:preview-digest',
  refreshRssTaskFeeds: 'rss-task:refresh',
  fetchRssArticle: 'rss-task:fetch-article',
  recoverRssArticleWithModel: 'rss-task:recover-article-model',
  discoverRssFeeds: 'rss-task:discover',
  lookupRssFeedMetrics: 'rss-task:lookup-metrics',
  quickChatArm: 'quick-chat:arm',
  quickChatArmVoice: 'quick-chat:arm-voice',
  quickChatHotkey: 'quick-chat:hotkey',
  quickChatSend: 'quick-chat:send',
  quickChatReady: 'quick-chat:ready',
  quickChatSync: 'quick-chat:sync',
  quickChatSendToChat: 'quick-chat:send-to-chat',
  scoreRssEntries: 'rss-task:score-entries',
  buildRssDigestReport: 'rss-task:digest-report',
  runRssDisposition: 'rss-task:disposition',
  rssDispositionStage: 'rss-task:disposition-stage',
  saveTextFile: 'shell:save-text-file',
  openExternal: 'shell:open-external',
  openApp: 'shell:open-app',
  openChatPanel: 'window:open-panel',
  openPanel: 'window:panel',
  openSkins: 'window:open-skins',
  closeSkins: 'window:close-skins',
  toggleSkins: 'window:toggle-skins',
  pickAttachments: 'attach:pick',
  resolveAttachmentPaths: 'attach:resolve-paths',
  ingestChatAttachments: 'attach:ingest-chat',
  chatIngestAttachments: 'chat:ingest-attachments',
  saveTempAttachment: 'attach:save-temp',
  previewAttachment: 'attach:preview',
  readAttachmentText: 'attach:read-text',
  openAttachmentPath: 'attach:open-path',
  revealAttachmentPath: 'attach:reveal-path',
  openAttachmentFolder: 'attach:open-folder',
  readOfficePreviewText: 'attach:read-office',
  dictationAvailable: 'dictation:available',
  startLiveDictation: 'dictation:live-start',
  stopLiveDictation: 'dictation:live-stop',
  pushLiveDictationPcm: 'dictation:live-pcm',
  dictationEvent: 'dictation:event',
  transcribeAudio: 'dictation:transcribe',
  getSetupStatus: 'setup:status',
  configureIntegration: 'setup:configure',
  removeIntegration: 'setup:remove',
  installAgent: 'setup:install-agent',
  installEngineCli: 'setup:install-engine-cli',
  writeClipboard: 'clipboard:write',
  agentLogin: 'setup:login',
  engineCliLogin: 'setup:engine-login',
  setIntercept: 'settings:set-intercept',
  approvalRequest: 'approval:request',
  approvalResolved: 'approval:resolved',
  approvalResult: 'approval:result',
  approvalDecide: 'approval:decide',
  activity: 'monitor:activity',
  getSchedules: 'schedule:list',
  saveSchedule: 'schedule:save',
  deleteSchedule: 'schedule:delete',
  deleteSchedulesForConversation: 'schedule:delete-for-conversation',
  toggleSchedule: 'schedule:toggle',
  runScheduleNow: 'schedule:run-now',
  schedulesChanged: 'schedule:changed',
  scheduleRun: 'schedule:run',
  scheduleFinished: 'schedule:finished',
  openSchedules: 'schedule:open',
  permissionLog: 'permission:log',
  /** 渲染进程上报作战板条目；主进程广播给宠物。 */
  opsBoardReport: 'opsboard:report',
  /** 宠物挂载时拉取最近一次作战板快照（避免错过广播）。 */
  getOpsBoard: 'opsboard:get',
  opsBoard: 'opsboard:update',
  /** 作战板忽略（宠物 → 主进程 → 对话窗）。 */
  opsBoardDismiss: 'opsboard:dismiss',
  /** Chat 续查：绑定 IDE trackId → CPET conversationId。 */
  bindIdeContinue: 'ide:bind-continue',
  sendPrompt: 'agent:send',
  cancel: 'agent:cancel',
  agentEvent: 'agent:event',
  externalSummary: 'chat:external-summary',
  toggleChat: 'window:toggle-chat',
  openChat: 'window:open-chat',
  /** 对话窗显隐变化（宠物侧用来收起快问气泡）。 */
  chatVisibility: 'window:chat-visibility',
  setPetState: 'pet:set-state',
  petState: 'pet:state',
  petMood: 'pet:mood',
  petAction: 'pet:action',
  petDockEdge: 'pet:dock-edge',
  contextMenu: 'pet:context-menu',
  setMouseIgnore: 'pet:set-mouse-ignore',
  setPetQuickChatExpanded: 'pet:set-quick-chat-expanded',
  dragStart: 'pet:drag-start',
  dragEnd: 'pet:drag-end',
  hidePet: 'pet:hide',
  quit: 'app:quit'
} as const
