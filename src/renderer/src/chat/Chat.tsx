import { t as uiText, uiLocaleTag } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent
} from 'react'
import { createPortal } from 'react-dom'
import type {
  Activity,
  AgentEvent,
  AgentRunUsage,
  AgentStatus,
  ChatAttachment,
  ChatBlock,
  ChatMessage,
  ChatStore,
  ChatTurnMessage,
  Conversation,
  ConversationGroup,
  LoadedImageSkin,
  ModelProvider,
  ScheduledTask,
  SkinId,
  TodayHeldDone,
  TodayMemo,
  UpdateCheckResult
} from '@shared/types'
import {
  DEFAULT_UNGROUPED_LABEL,
  UNGROUPED_SECTION_ID,
  deleteConversationGroup,
  formatConversationAge,
  moveConversationToGroup,
  newConversationGroup,
  normalizeChatStore,
  normalizeUngroupedLabel,
  partitionConversationsByGroup,
  renameConversationGroup,
  setConversationPinned
} from '@shared/conversationGroups'
import { SKINS } from '@shared/types'
import { describeAppearance } from '@shared/skinMarket'
import { formatRunUsage, formatRunUsageTitle } from '@shared/runUsage'
import { isTypingTarget } from '@shared/typingTarget'
import { mergeRssFeedPollConversations } from '@shared/rssFeedPoll'
import {
  DEFAULT_CHAT_THEME,
  DEFAULT_CHAT_THEME_CUSTOM,
  DEFAULT_USER_AVATAR,
  USER_AVATAR_CHOICES,
  applyChatThemeCustom,
  clearChatThemeCustom,
  isChatThemeId,
  isUserAvatarImage,
  normalizeChatThemeCustom,
  sanitizeUserAvatar,
  type ChatThemeCustom,
  type ChatThemeId
} from '@shared/chatUi'
import { mergeAttachmentSkills } from '@shared/attachmentMedia'
import {
  formatApiHistoryAttachmentNote,
  resolveImageSendMode,
  type ImageSendMode
} from '@shared/multimodal'
import {
  collectPreviewFiles,
  DELIVERABLE_FILE_EXT_RE,
  extractDocumentPathsFromText,
  extractFilePathFromToolPayload,
  extractLocalImagePaths,
  extractShellOutputPaths,
  filePreviewBasename,
  nextFilePanelFromList,
  canonicalLocalPath,
  isResultFilePath,
  isWriteLikeToolName,
  isAttachableLocalPath,
  isRemotePreviewUrl,
  type FilePreviewTarget
} from '@shared/filePreview'
import { extractRemoteImageUrls } from '@shared/remoteImages'
import { applySkillsToPrompt, formatSkillReportText, skillUsableOnEngine } from '@shared/skills'
import {
  applyModelCatalog,
  ensureBuiltinProviders,
  flattenEnabledRefs,
  formatModelRef,
  getCompareLanes,
  isAgentModelRef,
  migrateLegacyModelPrefs,
  modelRefLabel,
  newLaneId,
  normalizeCompareConversation,
  parseModelRef,
  syncRssActiveThread,
  switchRssEntry
} from '@shared/models'
import { Block } from './Blocks'
import {
  clearAllTaskThreads,
  deleteTaskThread,
  ensureTaskThreads,
  newTaskThread,
  switchTaskThread,
  syncActiveThread
} from '@shared/conversationThreads'
import { resolveConversationThreadId } from '@shared/conversationThreadId'
import { ConvHistoryMenu } from './ConvHistoryMenu'
import { TypingDots } from '../TypingDots'
import { createScrollFollow } from '../scrollFollow'
import {
  speakTextWithTts,
  stopTtsPlayback,
  StreamTtsController,
  onTtsSpeakingChange
} from '../ttsPlayback'
import {
  normalizeQuickChatSettings,
  resolveConvTtsAutoSpeak,
  rotateQuickChatThreadIfIdle
} from '@shared/quickChat'
import {
  applyDoneResult,
  blocksForDisplay,
  ensureAttachmentBlock,
  ensureImageMarkdown,
  finalizeAssistantBlocks,
  promoteOutputImages
} from './processBlocks'
import { writeClipboardText } from '../lib/clipboard'
import { attachmentsFromDroppedFiles } from '../lib/dropFiles'
import { Composer, type ComposerDraft } from './Composer'
import { FilePreviewPane } from './FilePreviewPane'
import { SendQueuePanel, type QueuedPrompt } from './SendQueue'
import { ChatFindBar } from './ChatFindBar'
import {
  IconActivity,
  IconClear,
  IconClose,
  IconExport,
  IconFiles,
  IconFolder,
  IconSchedule,
  IconSearch,
  IconSettings,
  IconSkin
} from './icons'
import brandIcon from '../assets/brand/cpet-icon-1024.png'
import {
  conversationToMarkdown,
  safeExportFilename,
  searchInConversations,
  searchInMessages,
  type ChatSearchHit
} from '@shared/chatExport'
import { SchedulesPanel } from './Schedules'
import { SettingsPanel } from './Settings'
import { UpdateBanner } from './UpdateBanner'
import { shouldShowUpdateBanner } from '@shared/updateCheck'
import { SystemPromptEditor } from './SystemPromptEditor'
import { CompareView, type CompareColumns } from './CompareView'
import { RssTaskView } from './RssTaskView'
import { TodayHome } from './TodayHome'
import { ModelPicker, ModelTreeBrowser } from './ModelPicker'
import { RssFeedPicker } from './RssFeedPicker'
import {
  activeRssAnalysisQuotes,
  buildRssAskContext,
  buildRssQuickActionPrompt,
  RSS_QUICK_ACTIONS,
  clearRssAnalysisQuote,
  removeRssAnalysisQuote,
  emptyRssTaskState,
  filterRssTaskItems,
  markRssDigestRead,
  markRssEntryRead,
  normalizeRssTaskFeeds,
  removeRssDigest,
  rssDigestThreadId,
  rssDiscussionBasisLabel,
  rssEntryHasDiscussion,
  rssEntryHasSourceBody,
  rssEntryHasUsableBody,
  rssAskRemoteImageUrls,
  rssEntrySourceHtml,
  rssTaskUnreadCount,
  selectedRssEntry,
  stripRssAskPreamble,
  withRssExtractHtml,
  withRssModelHtml,
  type RssTaskEntry,
  type RssTaskState
} from '@shared/rssTask'
import { opsBoardAckOnOpen, type OpsBoardItem } from '@shared/opsBoard'
import {
  completeTodayMemo,
  formatTodayQuickContext,
  splitMemoNote,
  mergeHeldDones,
  pickTodayNeeds,
  pickTodayReadLanes,
  releaseHeldDone,
  reopenTodayMemo,
  TODAY_QUICK_TEMPLATE,
  TODAY_READS_ALL,
  isTodayQuickTask,
  todayHasRssTask,
  type TodayDayItem,
  type TodayNeedItem,
  type TodayQuickRef,
  type TodayReadItem
} from '@shared/todayHome'
import {
  AgentDetailToggles,
  type AgentDetailVisibility
} from './DetailToggles'
import { confirmDestructive, confirmDestructiveAsync } from './confirm'
import { pickStickerForText } from '../stickers'
import {
  describeAgentError,
  formatAgentErrorNotice,
  stripAgentErrorNotice,
  type AgentErrorFix,
  type AgentErrorInfo
} from '../agentErrorInfo'
import { isSafeAgentCwd, isUserHomeDir, UNSAFE_CWD_MESSAGE } from '@shared/cwd'
import { DEMO_SEND_CONFIRM, resolveRunMode, runModeLabel } from '@shared/runMode'
import {
  applyTaskScenario,
  autonomyShortLabel,
  BUILTIN_TASK_SCENARIOS,
  groupTaskScenarios,
  type TaskScenario
} from '@shared/taskScenarios'
import { normalizeWorkMemory } from '@shared/workMemory'
import { activityTrackKey } from '@shared/petPresence'
import { buildBriefCompareFallbackNote } from '@shared/briefInbox'
import {
  AGENT_AUTONOMY_OPTIONS,
  DEFAULT_AGENT_AUTONOMY,
  isAgentAutonomy,
  isCodexResumableSessionId,
  type AgentAutonomy
} from '@shared/agentAutonomy'

type TaskFormKind = 'chat' | 'compare' | 'rss'

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function makeStreamKey(conversationId: string, laneId?: string): string {
  return laneId ? `${conversationId}::${laneId}` : conversationId
}

/** 失败提示必须跟这一轮实际选的引擎走，不能从文案里误判成其它引擎。 */
function engineFromAgentEvent(
  e: AgentEvent,
  conv: Conversation | undefined,
  laneId?: string
): string | undefined {
  const ref =
    e.modelId?.trim() ||
    (laneId ? conv?.lanes?.[laneId]?.modelId : undefined) ||
    conv?.modelRef
  if (!ref?.trim()) return undefined
  return parseModelRef(ref).provider
}

function isConvStreaming(keys: ReadonlySet<string>, conversationId: string): boolean {
  for (const k of keys) {
    if (k === conversationId || k.startsWith(`${conversationId}::`)) return true
  }
  return false
}

function isStreamingInMap(
  map: Map<string, string>,
  conversationId: string
): boolean {
  for (const k of map.keys()) {
    if (k === conversationId || k.startsWith(`${conversationId}::`)) return true
  }
  return false
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || p
}

/** 顶栏工作区按钮：显示末两级，避免只剩 `skins` 看不出是哪个项目。 */
function cwdShortLabel(p: string): string {
  const parts = p.replace(/\/+$/, '').split(/[/\\]/).filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return parts[parts.length - 1] || p
}

function convImageSendMode(
  providers: ModelProvider[],
  c: Conversation,
  defaultRef: string
): ImageSendMode {
  const refs =
    c.kind === 'compare'
      ? getCompareLanes(c).map((l) => l.modelId)
      : [c.modelRef || defaultRef]
  const customApiOnly = refs.every((r) => !isAgentModelRef(providers, r))
  const hasCustomApi = refs.some((r) => !isAgentModelRef(providers, r))
  const hasCodex = refs.some((r) => parseModelRef(r).provider === 'codex')
  const hasOtherAgent = refs.some(
    (r) => isAgentModelRef(providers, r) && parseModelRef(r).provider !== 'codex'
  )
  return resolveImageSendMode({ customApiOnly, hasCodex, hasOtherAgent, hasCustomApi })
}

/** 当前任务是否用到自定义 API（可开深度思考）。 */
function convUsesCustomApi(
  providers: ModelProvider[],
  c: Conversation,
  defaultRef: string
): boolean {
  if (c.kind === 'compare') {
    return getCompareLanes(c).some((l) => !isAgentModelRef(providers, l.modelId))
  }
  return !isAgentModelRef(providers, c.modelRef || defaultRef)
}

/** 本任务深度思考是否生效：任务覆盖 > 提供商默认。 */
function resolveConvThinking(
  providers: ModelProvider[],
  c: Conversation,
  defaultRef: string
): boolean {
  if (typeof c.enableThinking === 'boolean') return c.enableThinking
  if (c.kind === 'compare') {
    for (const l of getCompareLanes(c)) {
      if (isAgentModelRef(providers, l.modelId)) continue
      const { provider } = parseModelRef(l.modelId)
      const p = providers.find((x) => x.id === provider)
      if (p?.enableThinking) return true
    }
    return false
  }
  const ref = c.modelRef || defaultRef
  if (isAgentModelRef(providers, ref)) return false
  const { provider } = parseModelRef(ref)
  return !!providers.find((x) => x.id === provider)?.enableThinking
}

/** 气泡 / 通知深链：精确选中 RSS 条目或简报（并保证条目落在当前筛选里）。 */
function applyRssDeepLink(
  list: Conversation[],
  target: {
    conversationId: string
    rssEntryId?: string
    rssDigestId?: string
    rssExitDigest?: boolean
  }
): Conversation[] {
  return list.map((c) => {
    if (c.id !== target.conversationId || c.kind !== 'rss' || !c.rss) return c
    if (target.rssDigestId) {
      const raw = target.rssDigestId
      const digestId = raw.startsWith('digest:') ? raw.slice('digest:'.length) : raw
      const threadId = rssDigestThreadId(digestId)
      const switched = switchRssEntry(c, threadId)
      const marked = markRssDigestRead(switched.rss!, digestId)
      return {
        ...switched,
        rss: {
          ...marked,
          selectedId: threadId,
          selectedDigestId: digestId,
          readerMode: 'digest' as const,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }
    }
    if (target.rssEntryId) {
      const entryId = target.rssEntryId
      if (!c.rss.items.some((x) => x.id === entryId)) return c
      const switched = switchRssEntry(c, entryId)
      const marked = markRssEntryRead(switched.rss!, entryId)
      const visible = filterRssTaskItems(marked).some((x) => x.id === entryId)
      return {
        ...switched,
        rss: {
          ...marked,
          selectedId: entryId,
          filter: visible ? marked.filter : 'all',
          readerMode: marked.readerMode === 'digest' ? ('web' as const) : marked.readerMode,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }
    }
    if (target.rssExitDigest) {
      const selectedId = c.rss.selectedId?.startsWith('digest:')
        ? undefined
        : c.rss.selectedId
      return {
        ...c,
        rss: {
          ...c.rss,
          selectedId,
          readerMode: c.rss.readerMode === 'digest' ? ('web' as const) : c.rss.readerMode,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }
    }
    return c
  })
}

/** 任务列表副标题（侧栏窄，保持短句，详情放 title）。 */
function convRouteHint(
  providers: ModelProvider[],
  c: Conversation,
  defaultRef: string
): string {
  if (c.kind === 'compare') {
    const n = getCompareLanes(c).length
    return n > 0 ? `对比 ${n}列` : '对比'
  }
  if (c.kind === 'rss') {
    const n = c.rss?.feeds.length || 0
    const u = rssTaskUnreadCount(c.rss)
    if (u > 0) return `${n}源 · ${u}未读`
    return n > 0 ? `${n}源` : 'RSS'
  }
  const ref = c.modelRef || defaultRef
  if (!ref) return '未选模型'
  const { provider } = parseModelRef(ref)
  const p = ensureBuiltinProviders(providers).find((x) => x.id === provider)
  const kind = isAgentModelRef(providers, ref) ? 'Agent' : uiText('直连')
  const label = (p?.label || provider || '').trim()
  // 侧栏太窄时只留短标签，完整名在悬停 title
  if (!label) return kind
  const short = label.length > 10 ? `${label.slice(0, 10)}…` : label
  return `${kind} · ${short}`
}

const TAG_COLORS = ['#a78bfa', '#5f9a72', '#e07a5f', '#3f6b8f', '#c65a45', '#d19a3e', '#8a6b4f', '#7c7c9c']
const SKIN_AVATAR: Record<SkinId, string> = {
  violet: '🐻',
  mint: '🐱',
  peach: '🍑',
  slate: '🤖',
  panda: '🐼',
  cow: '🐮',
  kun: '🏀',
  doge: '🐕',
  capy: '🦫',
  frog: '🐸',
  emoji: '😄'
}
const EMOJI_COLOR: Record<string, string> = {
  '🟣': '#a78bfa',
  '🟢': '#5f9a72',
  '🟠': '#e07a5f',
  '🔵': '#3f6b8f',
  '🔴': '#c65a45',
  '🟡': '#d19a3e',
  '🟤': '#8a6b4f',
  '⚫': '#555555'
}
function hashColor(s: string): string {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

function deriveTitle(prompt: string): string {
  const t = prompt.replace(/\s+/g, ' ').trim()
  return t.length > 18 ? t.slice(0, 18) + '…' : t || '新对话'
}

/** 未显式设置时用全局默认（代理），避免新任务卡在只读问答。 */
function resolveConvAutonomy(c: Conversation | undefined): AgentAutonomy {
  if (isAgentAutonomy(c?.agentAutonomy)) return c.agentAutonomy
  return DEFAULT_AGENT_AUTONOMY
}

function newConversation(
  cwd?: string,
  modelRef?: string,
  agentAutonomy: AgentAutonomy = DEFAULT_AGENT_AUTONOMY
): Conversation {
  const now = Date.now()
  return ensureTaskThreads({
    id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    title: uiText("新对话"),
    messages: [],
    kind: 'chat',
    cwd,
    modelRef,
    agentAutonomy,
    // 新建任务默认不自动朗读（跟设置缺省一致；可在顶栏再开）
    ttsAutoSpeak: false,
    createdAt: now,
    updatedAt: now
  })
}

function newCompareConversation(
  cwd: string | undefined,
  modelRefs: string[],
  modelRef?: string,
  agentAutonomy: AgentAutonomy = DEFAULT_AGENT_AUTONOMY
): Conversation {
  const now = Date.now()
  const compareLanes: NonNullable<Conversation['compareLanes']> = []
  const lanes: Conversation['lanes'] = {}
  for (const ref of modelRefs) {
    const laneId = newLaneId()
    compareLanes.push({ id: laneId, modelId: ref })
    lanes[laneId] = { modelId: ref, messages: [] }
  }
  return ensureTaskThreads({
    id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    title: uiText("模型对比"),
    messages: [],
    kind: 'compare',
    compareLanes,
    lanes,
    cwd,
    modelRef,
    agentAutonomy,
    ttsAutoSpeak: false,
    createdAt: now,
    updatedAt: now
  })
}

function newRssConversation(
  cwd: string | undefined,
  feedUrls: string[],
  modelRef?: string,
  agentAutonomy: AgentAutonomy = DEFAULT_AGENT_AUTONOMY
): Conversation {
  const now = Date.now()
  const feeds = normalizeRssTaskFeeds(feedUrls)
  const rss = emptyRssTaskState(feeds)
  // 创建时选的模型同时作为讨论默认 + 评分/简报默认（之后可在任务内改）
  if (modelRef?.trim()) rss.scoreModelRef = modelRef.trim()
  return {
    id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    title: feeds[0]?.title ? `RSS · ${feeds[0].title}` : 'RSS 订阅',
    messages: [],
    kind: 'rss',
    rss,
    cwd,
    modelRef,
    agentAutonomy,
    rssDefaultModelRef: modelRef,
    rssDefaultAutonomy: agentAutonomy,
    rssThreads: {},
    rssSessions: {},
    rssModelRefs: {},
    rssAutonomies: {},
    ttsAutoSpeak: false,
    createdAt: now,
    updatedAt: now
  }
}

function kindPrefix(kind: Conversation['kind']): string {
  if (kind === 'compare') return '⚖ '
  if (kind === 'rss') return '📰 '
  return ''
}

function blockText(b: ChatBlock): string {
  switch (b.kind) {
    case 'text':
    case 'reasoning':
    case 'status':
    case 'skill':
      return b.text
    case 'sticker':
      return b.label ?? b.emoji
    case 'attachment':
      return `[附件] ${b.name} (${b.path})`
    case 'tool':
      return [b.name, b.input, b.output].filter(Boolean).join('\n')
    case 'command':
      return ['$ ' + b.command, b.output].filter(Boolean).join('\n')
    default:
      return ''
  }
}

function messagePlainText(m: ChatMessage): string {
  return m.blocks.map(blockText).join('\n').trim()
}

/** assistant 最终回复正文（仅 text，不含过程旁白/思考/工具/命令）。 */
function assistantReplyText(m: ChatMessage): string {
  return finalizeAssistantBlocks(m.blocks)
    .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * 复制用：优先最终正文；若几乎只有工具/命令输出（常见 Codex file_change），带上完整块文本。
 */
function assistantCopyText(m: ChatMessage): string {
  const reply = assistantReplyText(m)
  const hasTools = m.blocks.some((b) => b.kind === 'tool' || b.kind === 'command')
  if (hasTools && reply.length < 80) {
    return messagePlainText(m) || reply
  }
  return reply || messagePlainText(m)
}

/** 用户消息里可回填到输入框的纯文本（不含附件占位）。 */
function messageUserPrompt(m: ChatMessage): string {
  return m.blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function messageAttachments(m: ChatMessage): ChatAttachment[] {
  return m.blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'attachment' }> => b.kind === 'attachment')
    .map((b) => ({
      path: b.path,
      name: b.name,
      mime: b.mime,
      preview: b.preview
    }))
}

const API_HISTORY_MAX_TURNS = 40

/** 汇总请求在后续多轮历史里只留短摘要，避免把整段候选再塞进上下文打乱配对。 */
function compareSummaryStub(m: ChatMessage): string {
  const n = m.summaryMeta?.candidateCount
  const note = m.summaryMeta?.note?.trim()
  const countBit = typeof n === 'number' && n > 0 ? `${n} 条候选` : '多条候选'
  return note ? `[汇总请求：${countBit}；任务：${note}]` : `[汇总请求：${countBit}，默认取舍]`
}

/** 把一条消息编成 API 上下文内容（用户可附带附件路径说明）。 */
function messageApiContent(m: ChatMessage): string {
  if (m.role === 'user') {
    if (m.source === 'compare-summary') return compareSummaryStub(m)
    let content = messageUserPrompt(m)
    // 历史里未打标的旧汇总原文：按结构缩成短 stub，避免问答错位
    if (content.includes('## 候选回答') && content.includes('## 任务')) {
      const count = (content.match(/^### /gm) || []).length
      const task = content.split(/## 任务\s*\n/)[1]?.trim().split('\n')[0]?.trim()
      const stubMsg: ChatMessage = {
        ...m,
        source: 'compare-summary',
        summaryMeta: {
          candidateCount: count,
          note:
            task && !/请根据以上候选回答做汇总/.test(task) ? task.slice(0, 120) : undefined
        }
      }
      return compareSummaryStub(stubMsg)
    }
    const atts = messageAttachments(m)
    const note = formatApiHistoryAttachmentNote(atts)
    if (note) content = content ? `${content}\n\n${note}` : note
    return content.trim()
  }
  // CPET 写进气泡的失败提示不是模型说的话，喂回上下文会让下一轮对着它道歉
  return stripAgentErrorNotice(assistantReplyText(m))
}

/** 展示用原题文案：普通问题全文；汇总轮用短标签。 */
function compareRoundQuestionLabel(user: ChatMessage | undefined): string {
  if (!user) return '（未知问题）'
  if (user.source === 'compare-summary') return compareSummaryStub(user)
  const text = messageUserPrompt(user) || '（附件）'
  // 旧汇总原文走 messageApiContent 的缩略逻辑
  if (text.includes('## 候选回答') && text.includes('## 任务')) return messageApiContent(user)
  return text
}

function userTurnAttachments(
  m: ChatMessage
): Array<{ path: string; name: string; mime?: string }> | undefined {
  if (m.role !== 'user') return undefined
  const atts = messageAttachments(m)
    .filter((a) => a.path && a.name)
    .map((a) => ({ path: a.path, name: a.name, mime: a.mime }))
  return atts.length ? atts : undefined
}

function toApiHistoryTurn(m: ChatMessage): ChatTurnMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null
  const content = messageApiContent(m)
  const attachments = userTurnAttachments(m)
  if (m.role === 'assistant' && (!content || content === '（本轮未参与）')) return null
  if (!content && !attachments?.length) return null
  return attachments ? { role: m.role, content: content || '', attachments } : { role: m.role, content }
}

/** 普通对话：从已有消息生成自定义 API 多轮上下文（不含本轮）。 */
function buildChatApiHistory(messages: ChatMessage[]): ChatTurnMessage[] {
  const out: ChatTurnMessage[] = []
  for (const m of messages) {
    const turn = toApiHistoryTurn(m)
    if (turn) out.push(turn)
  }
  return out.slice(-API_HISTORY_MAX_TURNS)
}

/**
 * 对比模式：共享用户轮次 + 该列自己的助手回复，对齐成多轮。
 * `users` / `laneAssistants` 均为发送前的历史（不含本轮）。
 */
function buildCompareLaneApiHistory(
  users: ChatMessage[],
  laneAssistants: ChatMessage[] | undefined
): ChatTurnMessage[] {
  const out: ChatTurnMessage[] = []
  const lane = laneAssistants ?? []
  for (let i = 0; i < users.length; i++) {
    const u = users[i]
    const userTurn = toApiHistoryTurn(u)
    if (userTurn) out.push(userTurn)
    const a = lane[i]
    if (!a) continue
    const reply = messageApiContent(a)
    if (reply && reply !== '（本轮未参与）') out.push({ role: 'assistant', content: reply })
  }
  return out.slice(-API_HISTORY_MAX_TURNS)
}

/** 从 agent 回复里解析编号选项（仅当明显是在让你选择时）。 */
/** 选项文案上限：超过就说明这是正文大纲，不是让人点的候选。 */
const OPTION_MAX_LEN = 28

function plainOptionLabel(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/[*_`]/g, '')
    .trim()
}

/**
 * 只认「正文末尾的短编号清单 + 选择型问句」。
 * 正文里的编号小节（长句、带说明、后面还有大段正文）不算选项，
 * 否则一份大纲会被整段渲染成一排看不懂的按钮。
 */
function parseOptions(text: string): string[] {
  const lines = text.split('\n')
  const items: Array<{ idx: number; n: number; label: string }> = []
  let lastIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s*(\d{1,2})\s*[.)、．]\s+(.+?)\s*$/)
    if (m) {
      if (lastIdx < 0) lastIdx = i
      items.unshift({ idx: i, n: Number(m[1]), label: plainOptionLabel(m[2]) })
      continue
    }
    // 编号块之后的收尾文字先跳过；块内空行允许；遇到正文则到达块上沿
    if (!items.length) continue
    if (!lines[i].trim()) continue
    break
  }
  if (items.length < 2 || items.length > 6) return []
  if (items.some((it, i) => it.n !== i + 1)) return []
  if (items.some((it) => !it.label || it.label.length > OPTION_MAX_LEN)) return []
  // 编号块后最多留一句收尾问句，否则是正文中的编号小节
  const trailing = lines.slice(lastIdx + 1).filter((l) => l.trim())
  if (trailing.length > 1) return []
  const lead = lines
    .slice(0, items[0].idx)
    .filter((l) => l.trim())
    .slice(-2)
    .join(' ')
  const ask = `${lead} ${trailing.join(' ')}`
  if (!/[?？]|请选择|请选|选一个|选哪|哪一个|哪种|二选一|choose|which/i.test(ask)) return []
  return items.map((it) => it.label)
}

function appendText(blocks: ChatBlock[], kind: 'text' | 'reasoning', text: string): ChatBlock[] {
  const last = blocks[blocks.length - 1]
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { ...last, text: last.text + text }]
  }
  return [...blocks, { kind, text } as ChatBlock]
}

function upsertBlock(blocks: ChatBlock[], next: ChatBlock): ChatBlock[] {
  const nextId = (next as any).id as string | undefined
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.kind !== next.kind) continue
    const bId = (b as any).id as string | undefined
    const sameById = nextId != null && bId === nextId
    const sameTool = b.kind === 'tool' && next.kind === 'tool' && b.name === next.name
    const sameCmd = b.kind === 'command' && next.kind === 'command' && b.command === next.command
    if (sameById || ((sameTool || sameCmd) && (b as any).status === 'running')) {
      const merged: any = { ...b }
      for (const [k, v] of Object.entries(next)) if (v !== undefined) merged[k] = v
      // 流式中不 demote：避免「过程」关闭时工具一出现正文就被藏掉
      return [...blocks.slice(0, i), merged, ...blocks.slice(i + 1)]
    }
  }
  return [...blocks, next]
}

export function Chat(): JSX.Element {
  useUiLocale()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [groups, setGroups] = useState<ConversationGroup[]>([])
  const [ungroupedLabel, setUngroupedLabel] = useState(DEFAULT_UNGROUPED_LABEL)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupEditValue, setGroupEditValue] = useState('')
  const [moveMenu, setMoveMenu] = useState<null | { convId: string; x: number; y: number }>(
    null
  )
  /** 侧栏左键拖拽：正在拖的任务 id；放置目标 'ungrouped' | groupId */
  const [dragConvId, setDragConvId] = useState<string | null>(null)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  /** 对话主区接收系统文件拖入 */
  const [fileDragOver, setFileDragOver] = useState(false)
  /** 右侧文件栏（钉钉式：先列表，点开才预览） */
  const [filePanelOpen, setFilePanelOpen] = useState(false)
  const [filePreview, setFilePreview] = useState<FilePreviewTarget | null>(null)
  /** 只有从「本对话文件」进去，关预览才回列表；消息里点开的文件直接关掉。 */
  const [filePanelFromList, setFilePanelFromList] = useState(false)
  const filePanelOpenRef = useRef(false)
  filePanelOpenRef.current = filePanelOpen
  const openFileList = useCallback(() => {
    setFilePreview(null)
    setFilePanelFromList(true)
    setFilePanelOpen(true)
    setMonitorMode(false)
    setScheduleMode(false)
    setSettingsMode(false)
    monitorRef.current = false
  }, [])
  const openFilePreview = useCallback((target: FilePreviewTarget) => {
    if (!target?.path && !target?.remoteUrl) return
    const remote = target.remoteUrl || (isRemotePreviewUrl(target.path) ? target.path : '')
    if (remote) {
      setFilePreview({
        ...target,
        path: target.path || remote,
        remoteUrl: remote,
        name: target.name || filePreviewBasename(remote.split('?')[0]) || '图片',
        mime: target.mime || 'image/*'
      })
    } else {
      if (!isAttachableLocalPath(target.path)) return
      setFilePreview({
        ...target,
        name: target.name || filePreviewBasename(target.path)
      })
    }
    setFilePanelFromList((was) => nextFilePanelFromList(filePanelOpenRef.current, was))
    setFilePanelOpen(true)
    setMonitorMode(false)
    setScheduleMode(false)
    setSettingsMode(false)
    monitorRef.current = false
  }, [])
  const closeFilePanel = useCallback(() => {
    setFilePanelOpen(false)
    setFilePreview(null)
    setFilePanelFromList(false)
  }, [])
  /** 侧栏相对时间刷新（30s）。 */
  const [ageNow, setAgeNow] = useState(() => Date.now())
  const [activeId, setActiveId] = useState<string>('')
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const [lastChatInteractedId, setLastChatInteractedId] = useState<string | undefined>()
  const quickSendRef = useRef<
    (conversationId: string, text: string, attachments?: ChatAttachment[]) => void
  >((_cid, _text, _atts) => undefined)
  /** 快问条代发的会话：未聚焦对话窗时让宠边朗读，聚焦后聊天窗夺权。 */
  const quickStripTtsCidRef = useRef<string | null>(null)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [defaultCwd, setDefaultCwd] = useState<string | undefined>(undefined)
  /** 新建任务可选的最近项目目录（设置 cwd + 工作记忆）。 */
  const [recentCwds, setRecentCwds] = useState<string[]>([])
  /** 本机主目录（仅用于判定不安全 cwd，不作默认工作目录）。 */
  const [homeDir, setHomeDir] = useState('')
  const [activities, setActivities] = useState<Activity[]>([])
  const [monitorMode, setMonitorMode] = useState(false)
  /** 角标/通知打开监控时预选分轨；token 变化强制重应用。 */
  const [monitorFocus, setMonitorFocus] = useState<{ sessionId?: string; token: number }>({
    token: 0
  })
  const [scheduleMode, setScheduleMode] = useState(false)
  const [settingsMode, setSettingsMode] = useState(false)
  /** 打开对话窗先落「今天」；点进任务或深链后离开，隐藏再开不拽回来。 */
  const [todayMode, setTodayMode] = useState(true)
  const [todayToolsHidden, setTodayToolsHidden] = useState(true)
  const [todayAskBarHost, setTodayAskBarHost] = useState<HTMLDivElement | null>(null)
  const [opsItems, setOpsItems] = useState<OpsBoardItem[]>([])
  const [schedules, setSchedules] = useState<ScheduledTask[]>([])
  const [todayMemos, setTodayMemos] = useState<TodayMemo[]>([])
  const [todayHeldDones, setTodayHeldDones] = useState<TodayHeldDone[]>([])
  const [todayReadLaneOrder, setTodayReadLaneOrder] = useState<string[]>([])
  const [focusMemoId, setFocusMemoId] = useState<string | null>(null)
  /** 打开设置时滚到的锚点（如 settings-about）；用完清空 */
  const [settingsFocusSection, setSettingsFocusSection] = useState<string | null>(null)
  /** 全屏横幅：点「稍后」后按版本关掉。 */
  const [updateBanner, setUpdateBanner] = useState<UpdateCheckResult | null>(null)
  /** 顶栏提醒：有新版就一直显示，不随「稍后」消失。 */
  const [headerUpdate, setHeaderUpdate] = useState<UpdateCheckResult | null>(null)
  const overlayModesRef = useRef({
    monitor: false,
    schedule: false,
    settings: false,
    today: true
  })
  /** 正在流式输出的对话 id 集合（可并行）。 */
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(() => new Set())
  /** 各任务最近一次失败的可操作说明（仅当轮，不持久化）。 */
  const [errorByConv, setErrorByConv] = useState<Record<string, AgentErrorInfo>>({})
  const [userAvatar, setUserAvatar] = useState(DEFAULT_USER_AVATAR)
  const [chatTheme, setChatTheme] = useState<ChatThemeId>(DEFAULT_CHAT_THEME)
  const [chatThemeCustom, setChatThemeCustom] = useState<ChatThemeCustom>(DEFAULT_CHAT_THEME_CUSTOM)
  const modKey = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [petSkin, setPetSkin] = useState<SkinId>('violet')
  const [petImage, setPetImage] = useState<string | null>(null)
  /** 当前图片皮肤包 id（空=矢量）。 */
  const [imageSkinId, setImageSkinId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([])
  const [defaultModelRef, setDefaultModelRef] = useState(formatModelRef('cursor', 'auto'))
  const [defaultAgentAutonomy, setDefaultAgentAutonomy] =
    useState<AgentAutonomy>(DEFAULT_AGENT_AUTONOMY)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findScope, setFindScope] = useState<'current' | 'all'>('current')
  const [exportHint, setExportHint] = useState<string | null>(null)
  /** 各对话的后续请求暂存队列（生成中可排队，结束后自动发送）。 */
  const [queuesByConv, setQueuesByConv] = useState<Record<string, QueuedPrompt[]>>({})
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newTaskSeed, setNewTaskSeed] = useState<TaskFormKind>('chat')
  const [compareColumns, setCompareColumns] = useState<CompareColumns>(2)
  const [selectedReplies, setSelectedReplies] = useState<Set<string>>(() => new Set())
  const [detailVisibility, setDetailVisibility] = useState<AgentDetailVisibility>({
    showDetails: true
  })
  const [appVersion, setAppVersion] = useState('')
  /** TTS 总开关（设置里 CosyVoice）；关则隐藏朗读按钮与任务开关。 */
  const [ttsEnabled, setTtsEnabled] = useState(false)
  /** 设置缺省：生成完成后自动朗读。 */
  const [ttsAutoSpeakDefault, setTtsAutoSpeakDefault] = useState(false)
  /** 当前是否正在朗读（流式 / 点播），用于顶栏「停止朗读」。 */
  const [ttsSpeaking, setTtsSpeaking] = useState(false)
  const ttsEnabledRef = useRef(false)
  const ttsAutoSpeakDefaultRef = useRef(false)
  ttsEnabledRef.current = ttsEnabled
  ttsAutoSpeakDefaultRef.current = ttsAutoSpeakDefault
  /** 对话流式自动朗读（按 conversationId）。 */
  const streamTtsRef = useRef(new Map<string, StreamTtsController>())
  const monitorRef = useRef(false)

  useEffect(() => onTtsSpeakingChange(setTtsSpeaking), [])

  /**
   * 各任务的输入草稿（正文 + 附件 + 技能）。
   * 必须存在 Chat 而不是 Composer 里：进设置/定时/监控面板时 Composer 会卸载，
   * 草稿留在它自己的 state 上等于用户写的字随时被清空。
   */
  const draftsRef = useRef(new Map<string, ComposerDraft>())
  /** 仅用于草稿被外部改写（撤回消息 / 编辑暂存）后触发一次重渲染。 */
  const [draftTick, bumpDraft] = useState(0)

  /** streamKey → 当前流式 assistant 消息 id（对比时为 conversationId::laneId） */
  const streamsRef = useRef(new Map<string, string>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const scrollFollowRef = useRef<ReturnType<typeof createScrollFollow> | null>(null)
  const [showJumpBottom, setShowJumpBottom] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loaded = useRef(false)
  const defaultCwdRef = useRef<string | undefined>(undefined)
  const homeDirRef = useRef('')
  const demoSendOkRef = useRef(false)
  const stickerPoolRef = useRef<string[]>([])
  const conversationsRef = useRef(conversations)
  /**
   * 气泡深链目标：在 store 加载前后都可能到达，需保留到 selectedId 真正对齐为止，
   * 避免「先选中又被 getChatStore 回写冲掉」。
   */
  const desiredRssOpenRef = useRef<{
    conversationId: string
    rssEntryId?: string
    rssDigestId?: string
    rssExitDigest?: boolean
  } | null>(null)
  /** 启动拉源可能早于 store 载入，先攒着。 */
  const pendingRssSyncRef = useRef<ChatStore | null>(null)
  const queuesRef = useRef(queuesByConv)
  const drainLockRef = useRef(new Set<string>())
  const handleEventRef = useRef<(e: AgentEvent) => void>(() => {})
  /** 流式 patch 按帧合并：避免每字 setState + Markdown 把 UI 卡成「整段弹出」 */
  const streamPatchQueueRef = useRef(
    new Map<string, Array<{ laneId?: string; fn: (blocks: ChatBlock[]) => ChatBlock[] }>>()
  )
  /** 流式 patch 用 setTimeout：失焦窗 rAF 会被节流，追底也跟着停 */
  const streamPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** conversationId → 最近一次流事件时间；用于卡住时强制解锁 */
  const lastStreamEventAtRef = useRef(new Map<string, number>())
  const streamStartedAtRef = useRef(new Map<string, number>())
  /** conversationId → 仍在跑的 tool/command 数（沙箱长任务时放宽 stall） */
  const activeWorkCountRef = useRef(new Map<string, number>())
  /** 与 streamingIds 同步，供 endStream/watchdog 同步读（避免 state 滞后） */
  const streamingIdsRef = useRef<ReadonlySet<string>>(streamingIds)
  streamingIdsRef.current = streamingIds
  /** stream key → epoch：取消进行中的 beginStream 迟到 setState */
  const streamEpochRef = useRef(new Map<string, number>())
  // 勿在 render 里用 state 回写 conversationsRef：
  // updateConv/flush 会先把正文写进 ref 再 setState；若中间有一次旧 state 重渲，
  // 回写会冲掉正文，只剩随后的 runUsage →「有用量无正文」。
  queuesRef.current = queuesByConv

  /**
   * 卡住兜底（只看「多久没事件」，绝不因墙钟 3 分钟杀掉仍有活动的 run）：
   * - 普通沉默：5 分钟
   * - 仍有 tool/command：30 分钟（沙箱跑脚本常见）
   */
  const STREAM_STALL_MS = 5 * 60_000
  const STREAM_STALL_WITH_WORK_MS = 30 * 60_000

  const active = conversations.find((c) => c.id === activeId) ?? null
  const activeQueue = activeId ? (queuesByConv[activeId] ?? []) : []
  const messages = active?.messages ?? []
  const sessionFilesRef = useRef(new Map<string, FilePreviewTarget[]>())
  const hiddenPreviewRef = useRef(new Map<string, Set<string>>())
  const pinnedPreviewRef = useRef(new Map<string, Map<string, number>>())
  const [hiddenPreviewTick, setHiddenPreviewTick] = useState(0)

  /** 文件列表按「任务 + 对话记录」隔离，不跨 thread / 不跨任务。 */
  function previewFilesScopeKey(
    cid?: string | null,
    threadId?: string | null
  ): string | null {
    if (!cid) return null
    return `${cid}::${threadId || 'main'}`
  }

  function activePreviewFilesScopeKey(): string | null {
    const cid = activeIdRef.current
    if (!cid) return null
    const conv = conversationsRef.current.find((c) => c.id === cid)
    return previewFilesScopeKey(cid, conv?.activeThreadId)
  }

  const previewFiles = useMemo(() => {
    const messageAttachments: Array<{
      path: string
      name?: string
      mime?: string
      addedAt?: number
    }> = []
    const seen = new Set<string>()
    const pushPath = (path: string, name?: string, mime?: string, addedAt?: number): void => {
      const key = canonicalLocalPath(path)
      if (!key || seen.has(key) || !isResultFilePath(key)) return
      seen.add(key)
      messageAttachments.push({
        path: key,
        name: name || filePreviewBasename(key),
        mime,
        addedAt
      })
    }
    const harvestMsg = (msg: { role?: string; blocks: ChatBlock[]; createdAt?: number }): void => {
      const blocks =
        msg.role === 'assistant' ? promoteOutputImages(msg.blocks) : msg.blocks
      for (const b of blocks) {
        if (b.kind === 'attachment' && b.path) {
          pushPath(b.path, b.name, b.mime, msg.createdAt)
          continue
        }
        if (b.kind === 'text' && b.text) {
          for (const p of extractLocalImagePaths(b.text)) pushPath(p, undefined, undefined, msg.createdAt)
          for (const p of extractDocumentPathsFromText(b.text)) {
            pushPath(p, undefined, undefined, msg.createdAt)
          }
        }
        if (b.kind === 'tool' && b.output) {
          for (const p of extractLocalImagePaths(b.output)) pushPath(p, undefined, undefined, msg.createdAt)
        }
        if (b.kind === 'command') {
          for (const p of extractLocalImagePaths(`${b.command || ''}\n${b.output || ''}`)) {
            pushPath(p, undefined, undefined, msg.createdAt)
          }
        }
      }
    }
    // 当前任务 · 当前对话记录（thread）里的全部消息；对比则合并各列
    if (active) {
      for (const msg of active.messages || []) harvestMsg(msg)
      if (active.lanes) {
        for (const lane of Object.values(active.lanes)) {
          for (const msg of lane?.messages || []) harvestMsg(msg)
        }
      }
    }
    const fileScopeKey = activeId
      ? `${activeId}::${active?.activeThreadId || 'main'}`
      : ''
    const composer = activeId ? draftsRef.current.get(activeId)?.attachments || [] : []
    const pinned = fileScopeKey
      ? [...(pinnedPreviewRef.current.get(fileScopeKey) || [])].map(([path, pinnedAt]) => ({
          path,
          pinnedAt
        }))
      : []
    const threadKeys = new Set(messageAttachments.map((a) => canonicalLocalPath(a.path)))
    for (const a of composer) {
      const key = canonicalLocalPath(a.path)
      if (key) threadKeys.add(key)
    }
    if (filePreview?.path) threadKeys.add(canonicalLocalPath(filePreview.path))
    // previous 只保留本对话仍相关的（预览过 / 仍在消息或输入栏），不跨对话记录堆积
    const previous = (
      fileScopeKey ? sessionFilesRef.current.get(fileScopeKey) : undefined
    )?.filter((f) => threadKeys.has(canonicalLocalPath(f.path)))
    const collected = collectPreviewFiles({
      composer,
      messageAttachments,
      current: filePreview,
      previous,
      hidden: fileScopeKey ? [...(hiddenPreviewRef.current.get(fileScopeKey) || [])] : undefined,
      pinned: pinned.filter((p) => threadKeys.has(canonicalLocalPath(p.path)))
    })
    if (fileScopeKey) sessionFilesRef.current.set(fileScopeKey, collected)
    return collected
  }, [
    messages,
    active,
    active?.lanes,
    active?.activeThreadId,
    filePreview,
    activeId,
    draftTick,
    hiddenPreviewTick
  ])
  const composerAttachedPaths = useMemo(() => {
    if (!activeId) return [] as string[]
    return (draftsRef.current.get(activeId)?.attachments || []).map((a) => a.path)
  }, [activeId, draftTick])
  const findLocalHits = findOpen
    ? searchInMessages(messages, findQuery)
    : []
  const findAllHits =
    findOpen && findScope === 'all' ? searchInConversations(conversations, findQuery) : []
  const findMatchIds =
    findOpen && findScope === 'current' && findQuery.trim()
      ? new Set(findLocalHits.map((h) => h.messageId))
      : null
  const displayMessages =
    findMatchIds && findMatchIds.size > 0
      ? messages.filter((m) => findMatchIds.has(m.id))
      : messages
  const cwd = active?.cwd ?? defaultCwd
  const cwdSafe = isSafeAgentCwd(cwd, homeDir)
  const todayNeeds = useMemo(
    () =>
      pickTodayNeeds(
        opsItems.filter((it) => {
          if (!it.conversationId) return true
          const c = conversations.find((x) => x.id === it.conversationId)
          return !c || !isTodayQuickTask(c)
        }),
        conversations.filter((c) => !isTodayQuickTask(c)),
        streamingIds,
        8,
        schedules,
        ageNow,
        todayHeldDones,
        todayMemos
      ),
    [opsItems, conversations, streamingIds, schedules, ageNow, todayHeldDones, todayMemos]
  )
  const todayReadLanes = useMemo(() => pickTodayReadLanes(conversations, ageNow), [conversations, ageNow])

  useEffect(() => {
    setTodayHeldDones((prev) => mergeHeldDones(prev, opsItems))
  }, [opsItems])
  const todayReadCount =
    todayReadLanes.find((l) => l.id === TODAY_READS_ALL)?.items.length || 0
  const hasRssTask = useMemo(() => todayHasRssTask(conversations), [conversations])
  const busy = isConvStreaming(streamingIds, activeId)
  const isCompare = active?.kind === 'compare'
  const isRss = active?.kind === 'rss'
  const rssHasDiscussion =
    !!isRss &&
    !!active &&
    (rssEntryHasDiscussion(active.rssThreads, active.rss?.selectedId) ||
      (!!active.rss?.selectedId && active.messages.length > 0))
  const rssPanel = active?.rss?.discussionPanel || 'auto'
  const rssShowDiscussion =
    !!isRss &&
    rssPanel !== 'hide' &&
    (rssHasDiscussion || rssPanel === 'show')
  const rssQuotes = isRss ? activeRssAnalysisQuotes(active?.rss) : []
  const activeModelRef = active?.modelRef || defaultModelRef
  const runMode = resolveRunMode(status, modelProviders, activeModelRef)

  /**
   * MessageView 的 memo 只有在回调引用稳定时才生效：内联箭头会让整段历史
   * 跟着流式的每一帧重渲。需要读最新闭包的动作走 ref 转发，避免拿到过期的 send。
   */
  const msgActionsRef = useRef({
    resend: (_messageId: string) => {},
    pick: (_option: string) => {}
  })
  msgActionsRef.current.resend = (messageId: string) => {
    const conv = conversationsRef.current.find((c) => c.id === activeId)
    const msg = conv?.messages.find((m) => m.id === messageId)
    if (!msg) return
    // 必须带回真附件：messagePlainText 会把附件压成 "[附件] a.png (/tmp/a.png)" 这类文本
    void send(messageUserPrompt(msg), messageAttachments(msg))
  }
  msgActionsRef.current.pick = (option: string) => {
    void send(option)
  }
  const handleResend = useCallback((messageId: string) => {
    msgActionsRef.current.resend(messageId)
  }, [])
  const handlePickReply = useCallback((option: string) => {
    msgActionsRef.current.pick(option)
  }, [])
  const handleUserAvatarChange = useCallback((next: string) => {
    if (isUserAvatarImage(next)) {
      setUserAvatar(next)
      return
    }
    const emoji = sanitizeUserAvatar(next)
    if (!emoji) return
    setUserAvatar(emoji)
    window.petApi.setUserAvatar(emoji)
  }, [])

  /** Composer 每次输入都回写；只落 ref，避免长对话逐字触发整页重渲染。 */
  function saveDraftFor(conversationId: string, next: Omit<ComposerDraft, 'nonce'>): void {
    if (!conversationId) return
    const prev = draftsRef.current.get(conversationId)
    const prevPaths = (prev?.attachments || [])
      .map((a) => canonicalLocalPath(a.path))
      .join('\0')
    const nextPaths = next.attachments.map((a) => canonicalLocalPath(a.path)).join('\0')
    const empty = !next.text.trim() && !next.attachments.length && !next.skills?.length
    if (empty) {
      draftsRef.current.delete(conversationId)
    } else {
      draftsRef.current.set(conversationId, { ...next, nonce: prev?.nonce ?? 0 })
    }
    if (prevPaths !== nextPaths) bumpDraft((n) => n + 1)
  }

  function saveDraft(next: Omit<ComposerDraft, 'nonce'>): void {
    if (!activeId) return
    saveDraftFor(activeId, next)
  }

  /** 外部回填草稿：换 nonce 让已挂载的 Composer 强制吃进去。 */
  function restoreDraft(conversationId: string, next: Omit<ComposerDraft, 'nonce'>): void {
    draftsRef.current.set(conversationId, { ...next, nonce: Date.now() })
    bumpDraft((n) => n + 1)
  }

  /** 宠身/对话主区拖入：合并进当前任务草稿附件，并打开预览。 */
  function applyIngestedAttachments(attachments: ChatAttachment[]): void {
    const list = (attachments || []).filter((a) => a?.path && a?.name)
    if (!list.length) return
    const cid =
      activeIdRef.current ||
      conversationsRef.current.find((c) => !c.kind || c.kind === 'chat' || c.kind === 'rss')?.id
    if (!cid) return
    setActiveId(cid)
    setLastChatInteractedId(cid)
    setTodayMode(false)
    setMonitorMode(false)
    setScheduleMode(false)
    setSettingsMode(false)
    monitorRef.current = false
    const prev = draftsRef.current.get(cid)
    const merged = [...(prev?.attachments || [])]
    const seen = new Set(merged.map((a) => a.path))
    const now = Date.now()
    let lastNew: ChatAttachment | null = null
    for (const a of list) {
      if (seen.has(a.path)) continue
      seen.add(a.path)
      const next = { ...a, addedAt: a.addedAt || now }
      merged.push(next)
      lastNew = next
    }
    const hidden = hiddenPreviewRef.current.get(
      previewFilesScopeKey(
        cid,
        conversationsRef.current.find((c) => c.id === cid)?.activeThreadId
      ) || ''
    )
    if (hidden) {
      let changed = false
      for (const a of list) {
        const key = canonicalLocalPath(a.path)
        if (hidden.delete(key)) changed = true
      }
      if (changed) setHiddenPreviewTick((n) => n + 1)
    }
    restoreDraft(cid, {
      text: prev?.text || '',
      attachments: merged.slice(0, 12),
      skills: prev?.skills || []
    })
    const preview = lastNew || list[list.length - 1]
    if (preview) {
      openFilePreview({
        path: preview.path,
        name: preview.name,
        mime: preview.mime,
        source: 'attachment',
        addedAt: preview.addedAt || now
      })
    }
    window.setTimeout(() => inputRef.current?.focus(), 80)
  }

  function detachFromComposer(path: string): void {
    const cid = activeIdRef.current
    if (!cid) return
    const prev = draftsRef.current.get(cid)
    if (!prev) return
    const key = canonicalLocalPath(path)
    restoreDraft(cid, {
      text: prev.text,
      attachments: prev.attachments.filter((a) => canonicalLocalPath(a.path) !== key),
      skills: prev.skills || []
    })
  }

  /** 从本对话文件列表移出（不删磁盘；再拖入/回形针会回来）。 */
  function hidePreviewFile(path: string): void {
    const scope = activePreviewFilesScopeKey()
    if (!scope) return
    const key = canonicalLocalPath(path)
    if (!key) return
    const set = hiddenPreviewRef.current.get(scope) ?? new Set<string>()
    set.add(key)
    hiddenPreviewRef.current.set(scope, set)
    const kept = (sessionFilesRef.current.get(scope) || []).filter(
      (f) => canonicalLocalPath(f.path) !== key
    )
    sessionFilesRef.current.set(scope, kept)
    detachFromComposer(path)
    setFilePreview((cur) => (cur && canonicalLocalPath(cur.path) === key ? null : cur))
    setHiddenPreviewTick((n) => n + 1)
  }

  function hideAllPreviewFiles(): void {
    const scope = activePreviewFilesScopeKey()
    if (!scope) return
    const files = sessionFilesRef.current.get(scope) || []
    const set = hiddenPreviewRef.current.get(scope) ?? new Set<string>()
    for (const f of files) {
      const key = canonicalLocalPath(f.path)
      if (key) {
        set.add(key)
        detachFromComposer(f.path)
      }
    }
    hiddenPreviewRef.current.set(scope, set)
    sessionFilesRef.current.set(scope, [])
    setFilePreview(null)
    setHiddenPreviewTick((n) => n + 1)
  }

  function togglePreviewFilePin(path: string): void {
    const scope = activePreviewFilesScopeKey()
    if (!scope) return
    const key = canonicalLocalPath(path)
    if (!key) return
    const map = pinnedPreviewRef.current.get(scope) ?? new Map<string, number>()
    if (map.has(key)) map.delete(key)
    else map.set(key, Date.now())
    pinnedPreviewRef.current.set(scope, map)
    const nextPin = map.get(key)
    setFilePreview((cur) =>
      cur && canonicalLocalPath(cur.path) === key ? { ...cur, pinnedAt: nextPin } : cur
    )
    setHiddenPreviewTick((n) => n + 1)
  }

  /** 发送后立刻清掉该任务草稿，避免流式重渲染把输入框写回。 */
  function clearComposerDraft(conversationId: string): void {
    draftsRef.current.delete(conversationId)
    bumpDraft((n) => n + 1)
  }

  function updateDetailVisibility(patch: Partial<AgentDetailVisibility>): void {
    const nextShow =
      patch.showDetails !== undefined ? patch.showDetails : detailVisibility.showDetails
    setDetailVisibility((prev) => ({ ...prev, ...patch, showDetails: nextShow }))
    if (patch.showDetails !== undefined) {
      // main 侧会把 reasoning/tools 两键一起写
      window.petApi.setShowReasoning(nextShow)
    }
  }

  /**
   * 同步写 conversationsRef 再 setState。
   * 对比多列时 部分引擎可能在 sendPrompt 后几十毫秒就 done；
   * 若只靠异步 setState，正文 patch 会打在「尚未插入的 assistant」上被静默丢弃，只剩 usage →「无正文」。
   */
  function updateConv(id: string, fn: (c: Conversation) => Conversation): void {
    const next = conversationsRef.current.map((c) => {
      if (c.id !== id) return c
      const updated = fn(c)
      return updated.kind === 'rss' ? syncRssActiveThread(updated) : updated
    })
    conversationsRef.current = next
    setConversations(next)
  }

  /** 拉取本机 Agent 引擎模型目录，并同步到对话选单（新模型默认启用）。 */
  async function syncEngineCatalog(mode: 'preserve' | 'enable-listed' = 'preserve'): Promise<void> {
    const catalog = await window.petApi.listModelCatalog()
    setModelProviders((prev) => {
      const next = applyModelCatalog(prev, catalog, mode)
      void window.petApi.setModelProviders(next)
      return next
    })
  }

  // 更新：顶栏常驻提醒 + 可选横幅。主进程启动/周期静默检查；这里读缓存 + 订阅 + 补漏轮询
  useEffect(() => {
    let alive = true
    const apply = async (result: UpdateCheckResult | null): Promise<void> => {
      if (!alive || !result) return
      if (result.status === 'update-available' && result.latest) {
        setHeaderUpdate(result)
      } else if (result.status === 'up-to-date' || result.status === 'error') {
        // 已最新则清顶栏；error 不硬清，避免短暂网络失败把已发现的新版冲掉
        if (result.status === 'up-to-date') {
          setHeaderUpdate(null)
          setUpdateBanner(null)
        }
      }
      const settings = await window.petApi.getSettings()
      if (
        !shouldShowUpdateBanner({
          status: result.status,
          latest: result.latest,
          dismissedVersion: settings.updateBannerDismissedVersion
        })
      ) {
        return
      }
      setUpdateBanner(result)
    }
    const pull = (): void => {
      void window.petApi.getLastUpdateResult().then((r) => void apply(r))
    }
    pull()
    const off = window.petApi.onUpdateAvailable((r) => void apply(r))
    // 首检约 8s：前后多探几次，避免只靠一次 IPC
    const bootPolls = [6_000, 12_000, 25_000, 60_000].map((ms) => window.setTimeout(pull, ms))
    // 长驻窗口：周期读缓存（主进程每 4h 静默检查，这里 30min 同步 UI）
    const tick = window.setInterval(pull, 30 * 60 * 1000)
    return () => {
      alive = false
      off()
      for (const t of bootPolls) window.clearTimeout(t)
      window.clearInterval(tick)
    }
  }, [])

  // ---- 挂载：加载存储/状态/订阅事件 ----
  useEffect(() => {
    const applyRssFeedsSynced = (store: ChatStore): void => {
      const incoming = (normalizeChatStore(store) || store).conversations
      if (!loaded.current) {
        pendingRssSyncRef.current = store
        return
      }
      const merged = mergeRssFeedPollConversations(conversationsRef.current, incoming)
      if (merged === conversationsRef.current) return
      conversationsRef.current = merged
      setConversations(merged)
    }
    const offRssFeeds = window.petApi.onRssFeedsSynced(applyRssFeedsSynced)
    void window.petApi.getAppInfo().then((info) => setAppVersion(info.version))
    Promise.all([
      window.petApi.getAgentStatus(),
      window.petApi.getSettings(),
      window.petApi.getChatStore()
    ]).then(([s, settings, store]) => {
      setStatus(s)
      setHomeDir(s.defaultCwd || '')
      homeDirRef.current = s.defaultCwd || ''
      const dc =
        settings.cwd && isSafeAgentCwd(settings.cwd, s.defaultCwd) ? settings.cwd : undefined
      setDefaultCwd(dc)
      defaultCwdRef.current = dc
      const mem = normalizeWorkMemory(settings.workMemory)
      const home = s.defaultCwd || ''
      setRecentCwds(
        [dc, ...mem.recentCwds]
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .filter((x, i, arr) => arr.indexOf(x) === i)
          .filter((x) => isSafeAgentCwd(x, home))
          .slice(0, 8)
      )
      if (settings.userAvatar) setUserAvatar(settings.userAvatar)
      if (isChatThemeId(settings.chatTheme)) setChatTheme(settings.chatTheme)
      setChatThemeCustom(normalizeChatThemeCustom(settings.chatThemeCustom))
      if (typeof settings.sidebarCollapsed === 'boolean') {
        setSidebarCollapsed(settings.sidebarCollapsed)
      }
      setDetailVisibility({
        showDetails: settings.showReasoning !== false && settings.showTools !== false
      })
      if (settings.skin) setPetSkin(settings.skin)
      setImageSkinId(settings.imageSkin ?? null)
      {
        const qc = normalizeQuickChatSettings(settings.quickChat)
        setTtsEnabled(qc.tts === 'edge' || qc.tts === 'local')
        setTtsAutoSpeakDefault(qc.ttsAutoSpeak === true)
      }
      const providers = ensureBuiltinProviders(
        settings.modelProviders?.length
          ? settings.modelProviders
          : migrateLegacyModelPrefs(settings.models)
      )
      setModelProviders(providers)
      window.petApi.setModelProviders(providers)
      const defModel = settings.defaultModelRef || formatModelRef('cursor', 'auto')
      setDefaultModelRef(defModel)
      const defAutonomy = isAgentAutonomy(settings.defaultAgentAutonomy)
        ? settings.defaultAgentAutonomy
        : DEFAULT_AGENT_AUTONOMY
      setDefaultAgentAutonomy(defAutonomy)
      void window.petApi.listModelCatalog().then(async (catalog) => {
        setModelProviders((prev) => {
          // 启动时按本机目录对齐并启用，避免设置里有、对话选单没有
          const next = applyModelCatalog(prev, catalog, 'enable-listed')
          void window.petApi.setModelProviders(next)
          return next
        })
      })
      if (store) {
        const chat = normalizeChatStore(store) || {
          conversations: store.conversations,
          activeId: store.activeId,
          groups: []
        }
        let normalized = chat.conversations.map(normalizeCompareConversation)
        const desiredRss = desiredRssOpenRef.current
        if (desiredRss && normalized.some((c) => c.id === desiredRss.conversationId)) {
          normalized = applyRssDeepLink(normalized, desiredRss)
          const c = normalized.find((x) => x.id === desiredRss.conversationId)
          const aligned =
            (desiredRss.rssEntryId && c?.rss?.selectedId === desiredRss.rssEntryId) ||
            (desiredRss.rssDigestId &&
              (c?.rss?.selectedId === desiredRss.rssDigestId ||
                c?.rss?.selectedId === `digest:${desiredRss.rssDigestId}` ||
                c?.rss?.selectedDigestId === desiredRss.rssDigestId)) ||
            (desiredRss.rssExitDigest && c?.rss?.readerMode !== 'digest')
          if (aligned) desiredRssOpenRef.current = null
          conversationsRef.current = normalized
          setConversations(normalized)
          setGroups(chat.groups || [])
          setUngroupedLabel(normalizeUngroupedLabel(chat.ungroupedLabel))
          if (chat.lastChatInteractedId) setLastChatInteractedId(chat.lastChatInteractedId)
          setTodayMemos(chat.todayMemos || [])
          setTodayHeldDones(chat.todayHeldDones || [])
          setTodayReadLaneOrder(chat.todayReadLaneOrder || [])
          setActiveId(desiredRss.conversationId)
          setTodayMode(false)
        } else {
          conversationsRef.current = normalized
          setConversations(normalized)
          setGroups(chat.groups || [])
          setUngroupedLabel(normalizeUngroupedLabel(chat.ungroupedLabel))
          if (chat.lastChatInteractedId) setLastChatInteractedId(chat.lastChatInteractedId)
          setTodayMemos(chat.todayMemos || [])
          setTodayHeldDones(chat.todayHeldDones || [])
          setTodayReadLaneOrder(chat.todayReadLaneOrder || [])
          if (!normalized.length) {
            setActiveId('')
          } else {
            const valid = normalized.some((c) => c.id === chat.activeId)
            setActiveId(valid ? chat.activeId : normalized[0].id)
          }
        }
      } else {
        // 首次安装：给一个空白任务；之后可全部关掉
        const c = newConversation(dc, defModel, defAutonomy)
        conversationsRef.current = [c]
        setConversations([c])
        setGroups([])
        setUngroupedLabel(DEFAULT_UNGROUPED_LABEL)
        setActiveId(c.id)
      }
      loaded.current = true
      if (pendingRssSyncRef.current) {
        applyRssFeedsSynced(pendingRssSyncRef.current)
        pendingRssSyncRef.current = null
      }
    })
    window.petApi.getImageSkin().then((skin) => {
      if (skin?.actions?.length) stickerPoolRef.current = skin.actions
      setPetImage(skin?.images?.idle ?? skin?.images?.talking ?? null)
      setImageSkinId(skin?.id ?? null)
    })
    const offImgSkin = window.petApi.onPetImageSkin((skin: LoadedImageSkin | null) => {
      stickerPoolRef.current = skin?.actions ?? []
      // null = 切回矢量皮肤，必须清掉图片头像
      setPetImage(skin ? (skin.images?.idle ?? skin.images?.talking ?? null) : null)
      setImageSkinId(skin?.id ?? null)
    })
    const offPetSkin = window.petApi.onPetSkin((skin) => {
      setPetSkin(skin)
    })

    const off = window.petApi.onAgentEvent((e) => handleEventRef.current(e))
    const offDetails = window.petApi.onShowDetailsChange((show) => {
      setDetailVisibility({ showDetails: !!show })
    })
    const offActivity = window.petApi.onActivity((a) => {
      setActivities((p) => [...p.slice(-199), a])
    })
    const offScheduleRun = window.petApi.onScheduleRun((payload) => {
      const chat = normalizeChatStore(payload.store) || payload.store
      conversationsRef.current = chat.conversations
      setConversations(chat.conversations)
      setGroups(chat.groups || [])
      setUngroupedLabel(normalizeUngroupedLabel(chat.ungroupedLabel))
      setActiveId(payload.conversationId)
      beginStream(payload.conversationId, payload.assistantMsgId)
      setTodayMode(false)
      setScheduleMode(false)
      setMonitorMode(false)
      setSettingsMode(false)
      monitorRef.current = false
      stickScrollToBottom()
    })
    const offScheduleFinished = window.petApi.onScheduleFinished((info) => {
      if (!info.store) return
      const chat = normalizeChatStore(info.store) || info.store
      conversationsRef.current = chat.conversations
      setConversations(chat.conversations)
      if (chat.groups) setGroups(chat.groups)
      if (info.ok && info.conversationId) {
        setActiveId(info.conversationId)
        setTodayMode(false)
        setScheduleMode(false)
        setMonitorMode(false)
        setSettingsMode(false)
        monitorRef.current = false
      }
    })
    const offOpenSchedules = window.petApi.onOpenSchedules(() => {
      setScheduleMode(true)
      setMonitorMode(false)
      setSettingsMode(false)
      monitorRef.current = false
    })
    const offOpenPanel = window.petApi.onOpenPanel((target) => {
      const panel = target.panel
      const focusComposer = (): void => {
        if (!target.focusComposer) return
        window.setTimeout(() => inputRef.current?.focus(), 80)
      }
      // 监控优先：带 session 分轨时不要被 conversationId 误切到空对话
      if (panel === 'monitor' || target.monitorSessionId) {
        setMonitorMode(true)
        setScheduleMode(false)
        setSettingsMode(false)
        setSettingsFocusSection(null)
        monitorRef.current = true
        setMonitorFocus({
          sessionId: target.monitorSessionId,
          token: Date.now()
        })
        return
      }
      if (target.conversationId) {
        const exists = conversationsRef.current.some((c) => c.id === target.conversationId)
        setMonitorMode(false)
        setScheduleMode(false)
        setSettingsMode(false)
        setSettingsFocusSection(null)
        monitorRef.current = false
        if (!exists) {
          // 演示/过期 id：打开对话窗落「今天」，不切到不存在的任务
          setTodayMode(true)
          return
        }
        setTodayMode(false)
        if (target.rssEntryId || target.rssDigestId || target.rssExitDigest) {
          const deep = {
            conversationId: target.conversationId,
            rssEntryId: target.rssEntryId,
            rssDigestId: target.rssDigestId,
            rssExitDigest: target.rssExitDigest
          }
          desiredRssOpenRef.current = deep
          const next = applyRssDeepLink(conversationsRef.current, deep)
          conversationsRef.current = next
          setConversations(next)
          const c = next.find((x) => x.id === deep.conversationId)
          const aligned =
            (deep.rssEntryId && c?.rss?.selectedId === deep.rssEntryId) ||
            (deep.rssDigestId &&
              (c?.rss?.selectedId === deep.rssDigestId ||
                c?.rss?.selectedId === `digest:${deep.rssDigestId}` ||
                c?.rss?.selectedDigestId === deep.rssDigestId)) ||
            (deep.rssExitDigest && c?.rss?.readerMode !== 'digest')
          if (aligned) desiredRssOpenRef.current = null
          setActiveId(deep.conversationId)
        } else {
          setActiveId(target.conversationId)
        }
        focusComposer()
        return
      }
      if (panel === 'schedules') {
        setScheduleMode(true)
        setMonitorMode(false)
        setSettingsMode(false)
        setSettingsFocusSection(null)
        monitorRef.current = false
      } else if (panel === 'settings') {
        setSettingsMode(true)
        setScheduleMode(false)
        setMonitorMode(false)
        monitorRef.current = false
        // 仅深链带 section 时滚动；普通打开设置不抢滚动位置
        setSettingsFocusSection(target.section ?? null)
      } else {
        setMonitorMode(false)
        setScheduleMode(false)
        setSettingsMode(false)
        setSettingsFocusSection(null)
        monitorRef.current = false
        if (panel === 'today' || panel === 'chat') {
          setTodayMode(true)
        }
        if (target.section === 'new-rss') {
          setNewTaskSeed('rss')
          setNewTaskOpen(true)
        }
        if (target.focusComposer && panel !== 'today') focusComposer()
      }
    })
    const offQuickSync = window.petApi.onQuickChatSync((payload) => {
      const chat = normalizeChatStore(payload.store) || payload.store
      const normalized = chat.conversations.map(normalizeCompareConversation)
      conversationsRef.current = normalized
      setConversations(normalized)
      setGroups(chat.groups || [])
      setUngroupedLabel(normalizeUngroupedLabel(chat.ungroupedLabel))
      if (chat.lastChatInteractedId) setLastChatInteractedId(chat.lastChatInteractedId)
      setActiveId(payload.conversationId)
      setLastChatInteractedId(payload.conversationId)
      setTodayMode(false)
      setMonitorMode(false)
      setScheduleMode(false)
      setSettingsMode(false)
      monitorRef.current = false
      if (payload.focusComposer) {
        window.setTimeout(() => inputRef.current?.focus(), 80)
      }
    })
    const offQuickSend = window.petApi.onQuickChatSendToChat((payload) => {
      quickStripTtsCidRef.current = payload.conversationId
      quickSendRef.current(payload.conversationId, payload.text, payload.attachments)
    })
    const offIngestAttach = window.petApi.onChatIngestAttachments((attachments) => {
      applyIngestedAttachments(attachments)
    })
    const offMemory = window.petApi.onAgentMemoryChanged((payload) => {
      if (!payload.usedRecall) return
      const fact = (payload.preview || '').trim()
      if (!fact) return
      setExportHint(`已带上记忆：${fact}`)
      window.setTimeout(() => setExportHint(null), 2800)
    })
    // 告诉主进程：快问代发监听已挂上（重建对话窗后冲刷暂存）
    window.petApi.quickChatReady()
    return () => {
      off()
      offDetails()
      offActivity()
      offScheduleRun()
      offScheduleFinished()
      offOpenSchedules()
      offOpenPanel()
      offImgSkin()
      offPetSkin()
      offQuickSync()
      offQuickSend()
      offIngestAttach()
      offMemory()
      offRssFeeds()
    }

  }, [])

  // ---- 持久化（防抖；允许空任务列表） ----
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(
      () =>
        window.petApi.saveChatStore({
          // 落盘前把当前 messages 写回任务内线程，避免历史丢轮次
          conversations: conversations.map((c) =>
            c.kind === 'rss' ? c : syncActiveThread(c)
          ),
          activeId,
          groups,
          ungroupedLabel:
            ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? undefined : ungroupedLabel,
          lastChatInteractedId,
          todayMemos,
          todayReadLaneOrder,
          todayHeldDones
        }),
      500
    )
    return () => clearTimeout(t)
  }, [
    conversations,
    activeId,
    groups,
    ungroupedLabel,
    lastChatInteractedId,
    todayMemos,
    todayReadLaneOrder,
    todayHeldDones
  ])

  /** 旧任务懒挂线程结构，便于「对话记录」高亮当前轮。 */
  useEffect(() => {
    if (!loaded.current || !activeId || !active) return
    if (active.kind === 'rss') return
    if (active.threads?.length && active.activeThreadId) return
    updateConv(activeId, (c) => ensureTaskThreads(c))
  }, [activeId, active])

  /** 用户已点进该任务/对话界面：清掉对应角标（侧栏切换、深链、从设置返回对话）。 */
  useEffect(() => {
    if (!loaded.current) return
    if (!activeId) return
    if (monitorMode || scheduleMode || settingsMode || todayMode) return
    // 启动恢复 activeId / 窗体仍隐藏时不算「已经点到」
    if (!document.hasFocus()) return
    window.petApi.dismissOpsItem({ id: `pres-${activeId}`, conversationId: activeId })
  }, [activeId, monitorMode, scheduleMode, settingsMode, todayMode])

  /** 对话窗重新获得焦点且正看着某任务：同样视为已读。 */
  useEffect(() => {
    const ackIfViewing = (): void => {
      if (monitorMode || scheduleMode || settingsMode || todayMode) return
      const id = activeIdRef.current
      if (!id) return
      window.petApi.dismissOpsItem({ id: `pres-${id}`, conversationId: id })
    }
    window.addEventListener('focus', ackIfViewing)
    return () => window.removeEventListener('focus', ackIfViewing)
  }, [monitorMode, scheduleMode, settingsMode, todayMode])

  useEffect(() => {
    if (!moveMenu) return
    const close = (): void => setMoveMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    // 延后绑定，避免右键打开当帧的 click 立刻关掉菜单
    const t = window.setTimeout(() => window.addEventListener('click', close), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [moveMenu])

  useEffect(() => {
    const id = window.setInterval(() => setAgeNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.petApi.getOpsBoard().then((snap) => {
      if (!cancelled && snap?.items) setOpsItems(snap.items)
    })
    const off = window.petApi.onOpsBoard((snap) => {
      setOpsItems(snap.items || [])
    })
    const offMemos =
      typeof window.petApi.onTodayMemosPatched === 'function'
        ? window.petApi.onTodayMemosPatched((memos) => {
            setTodayMemos(memos)
          })
        : undefined
    return () => {
      cancelled = true
      off()
      offMemos?.()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.petApi.getSchedules().then((list) => {
      if (!cancelled && Array.isArray(list)) setSchedules(list)
    })
    const off = window.petApi.onSchedulesChanged((list) => {
      setSchedules(Array.isArray(list) ? list : [])
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // ---- 流卡住兜底：按 streamKey（含对比列）各自计时，互不拖死 ----
  useEffect(() => {
    if (streamingIds.size === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      for (const key of [...streamingIdsRef.current]) {
        const idx = key.indexOf('::')
        const cid = idx >= 0 ? key.slice(0, idx) : key
        const laneId = idx >= 0 ? key.slice(idx + 2) : undefined
        const started = streamStartedAtRef.current.get(key)
        const last = lastStreamEventAtRef.current.get(key) ?? started
        if (started == null && last == null) {
          void window.petApi.cancel(cid, laneId)
          endStream(cid, laneId, { drainQueue: true })
          continue
        }
        const lastAt = last ?? started ?? 0
        const hasWork = (activeWorkCountRef.current.get(key) ?? 0) > 0
        const stallMs = hasWork ? STREAM_STALL_WITH_WORK_MS : STREAM_STALL_MS
        if (now - lastAt < stallMs) continue
        void window.petApi.cancel(cid, laneId)
        endStream(cid, laneId, { drainQueue: true })
      }
    }, 4000)
    return () => clearInterval(timer)
    // endStream 稳定闭包于组件内；仅随 streamingIds 启停
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingIds])

  // ---- 暂存兜底：有空闲列/会话空闲时再冲一次 ----
  useEffect(() => {
    for (const cid of Object.keys(queuesRef.current)) {
      const conv = conversationsRef.current.find((c) => c.id === cid)
      if (!conv) continue
      if (conv.kind === 'compare') {
        if (compareReadyLaneIds(conv).length) {
          queueMicrotask(() => {
            void tryDrainQueue(cid)
          })
        }
        continue
      }
      if (
        !isConvStreaming(streamingIds, cid) &&
        !isStreamingInMap(streamsRef.current, cid)
      ) {
        queueMicrotask(() => {
          void tryDrainQueue(cid)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingIds])

  // ---- 焦点 / 快捷键 ----
  useEffect(() => {
    const focusInput = (): void => {
      // 已在 composer / 搜索 / 重命名里打字（含中文输入）时不要再 focus，否则会掐输入法
      if (isTypingTarget(document.activeElement)) return
      setTimeout(() => {
        if (isTypingTarget(document.activeElement)) return
        inputRef.current?.focus()
      }, 50)
    }
    focusInput()
    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [])

  useEffect(() => {
    overlayModesRef.current = {
      monitor: monitorMode,
      schedule: scheduleMode,
      settings: settingsMode,
      today: todayMode
    }
  }, [monitorMode, scheduleMode, settingsMode, todayMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        if (findOpen) {
          e.preventDefault()
          setFindOpen(false)
          return
        }
        const o = overlayModesRef.current
        if (o.settings || o.schedule || o.monitor) {
          e.preventDefault()
          setMonitorMode(false)
          setScheduleMode(false)
          setSettingsMode(false)
              monitorRef.current = false
          return
        }
        if (!o.today) {
          e.preventDefault()
          setTodayMode(true)
          return
        }
        window.petApi.toggleChat()
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
        setMonitorMode(false)
        setScheduleMode(false)
        setSettingsMode(false)
        } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        clearChat()
      } else if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault()
        addConversation()
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void exportActiveConversation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, activeId, defaultCwd, findOpen])

  async function exportActiveConversation(): Promise<void> {
    if (!active) {
      setExportHint('没有可导出的任务')
      window.setTimeout(() => setExportHint(null), 1800)
      return
    }
    const md = conversationToMarkdown(active)
    const res = await window.petApi.saveTextFile({
      defaultPath: safeExportFilename(active.title),
      content: md,
      title: uiText("导出对话")
    })
    if (res.canceled) return
    if (!res.ok) {
      setExportHint(res.error || '导出失败')
    } else {
      setExportHint(res.path ? `已导出：${res.path.split(/[/\\]/).pop()}` : '已导出')
    }
    window.setTimeout(() => setExportHint(null), 2200)
  }

  function jumpSearchHit(hit: ChatSearchHit): void {
    const conv = conversationsRef.current.find((c) => c.id === hit.conversationId)
    const stayToday = todayMode && !!conv && isTodayQuickTask(conv)
    setActiveId(hit.conversationId)
    setFindScope('current')
    setFindQuery(findQuery)
    if (!stayToday) {
      setTodayMode(false)
      setMonitorMode(false)
      setScheduleMode(false)
      setSettingsMode(false)
    }
    window.setTimeout(() => {
      document.getElementById(`msg-${hit.messageId}`)?.scrollIntoView({ block: 'center' })
    }, 80)
  }

  useEffect(() => {
    const follow = createScrollFollow(() => scrollRef.current, { pxPerSec: 110 })
    scrollFollowRef.current = follow
    return () => {
      follow.destroy()
      scrollFollowRef.current = null
    }
  }, [])

  // 末条长度：流式 delta 时再挂一档，避免漏 kick
  const streamTailLen = messages.length
    ? messagePlainText(messages[messages.length - 1]!).length
    : 0

  const wasBusyScrollRef = useRef(false)
  // 仅生成中慢速追底；人手动上滑 / 回答结束 → 停
  useLayoutEffect(() => {
    const follow = scrollFollowRef.current
    if (!follow) return
    if (busy) {
      if (!wasBusyScrollRef.current) {
        follow.resume()
        follow.snapToBottom()
      }
      if (follow.isFollowing()) {
        atBottom.current = true
        follow.kick()
        setShowJumpBottom(false)
      } else {
        atBottom.current = false
        setShowJumpBottom(messages.length > 0)
      }
    } else {
      if (wasBusyScrollRef.current) {
        follow.finish()
      }
      atBottom.current = follow.isFollowing()
      setShowJumpBottom(!follow.isFollowing() && messages.length > 0)
    }
    wasBusyScrollRef.current = !!busy
  }, [messages, streamTailLen, busy])

  function onMessagesScroll(): void {
    const follow = scrollFollowRef.current
    follow?.onScroll()
    const following = follow?.isFollowing() ?? false
    atBottom.current = following
    setShowJumpBottom(!following && messages.length > 0)
  }

  function scrollToBottom(): void {
    atBottom.current = true
    setShowJumpBottom(false)
    scrollFollowRef.current?.snapToBottom()
  }

  function stickScrollToBottom(): void {
    atBottom.current = true
    setShowJumpBottom(false)
    scrollFollowRef.current?.resume()
    // DOM 高度可能晚一拍：短延迟再贴底（不用 rAF，失焦窗也能执行）
    window.setTimeout(() => scrollFollowRef.current?.snapToBottom(), 0)
    window.setTimeout(() => scrollFollowRef.current?.snapToBottom(), 32)
  }

  /** 退出设置 / 定时 / 活动监控，回到对话主界面。 */
  function exitOverlayModes(): void {
    setMonitorMode(false)
    setScheduleMode(false)
    setSettingsMode(false)
    monitorRef.current = false
  }

  function showToday(): void {
    exitOverlayModes()
    setTodayMode(true)
    const id = ensureTodayQuick()
    if (activeIdRef.current !== id) setActiveId(id)
  }

  function leaveToday(): void {
    setTodayMode(false)
  }

  function openTodayNeed(it: TodayNeedItem): void {
    if (it.kind === 'remind' && it.memoId) {
      setFocusMemoId(it.memoId)
      return
    }
    if (it.conversationId) {
      setTodayHeldDones((prev) => releaseHeldDone(prev, it.conversationId!))
    }
    if (it.kind === 'schedule' && (!it.conversationId || it.panel === 'schedules')) {
      setScheduleMode(true)
      setMonitorMode(false)
      setSettingsMode(false)
      monitorRef.current = false
      return
    }
    if (it.panel === 'monitor' && !it.conversationId) {
      setMonitorMode(true)
      setScheduleMode(false)
      setSettingsMode(false)
      monitorRef.current = true
      return
    }
    if (!it.conversationId) return
    leaveToday()
    exitOverlayModes()
    setActiveId(it.conversationId)
    if (it.kind === 'waiting') {
      window.setTimeout(() => inputRef.current?.focus(), 80)
    }
    if (it.kind !== 'remind' && opsBoardAckOnOpen(it.kind)) {
      window.petApi.dismissOpsItem({ id: it.id, conversationId: it.conversationId })
    }
  }

  function findTodayQuick(): Conversation | undefined {
    return conversationsRef.current.find(isTodayQuickTask)
  }

  function ensureTodayQuick(): string {
    const hit = findTodayQuick()
    if (hit) {
      const rotated = rotateQuickChatThreadIfIdle(hit)
      if (rotated !== hit) {
        const next = conversationsRef.current.map((c) => (c.id === hit.id ? rotated : c))
        conversationsRef.current = next
        setConversations(next)
      }
      return hit.id
    }
    const c = newConversation(defaultCwdRef.current, defaultModelRef, defaultAgentAutonomy)
    c.title = '快问'
    c.promptTemplateId = TODAY_QUICK_TEMPLATE
    const next = [...conversationsRef.current, c]
    conversationsRef.current = next
    setConversations(next)
    return c.id
  }

  function sendTodayQuick(
    text: string,
    refs: TodayQuickRef[] = [],
    attachments: ChatAttachment[] = [],
    skills: string[] = []
  ): void {
    const id = ensureTodayQuick()
    const prefix = formatTodayQuickContext(refs)
    void send(text, attachments, skills, { conversationId: id, enginePrefix: prefix || undefined })
  }

  function addTodayMemo(text: string): void {
    const t = text.trim()
    if (!t) return
    const { title, body } = splitMemoNote(t)
    setTodayMemos((prev) =>
      [
        { id: uid(), title: title || '未命名', body, createdAt: Date.now(), kind: 'log' as const },
        ...prev.filter((m) => m.title !== (title || '未命名'))
      ].slice(0, 120)
    )
  }

  function upsertTodayMemo(memo: TodayMemo): void {
    setTodayMemos((prev) => [memo, ...prev.filter((m) => m.id !== memo.id)].slice(0, 120))
  }

  function completeTodayMemoById(id: string, done: boolean): void {
    setTodayMemos((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m
        return done ? completeTodayMemo(m) : reopenTodayMemo(m)
      })
    )
  }

  function stopTodayQuick(): void {
    const id = findTodayQuick()?.id
    if (!id) return
    void window.petApi.cancel(id)
    endStream(id, undefined, { drainQueue: false })
  }

  useEffect(() => {
    if (!todayMode || !loaded.current) return
    const id = ensureTodayQuick()
    if (activeIdRef.current !== id) setActiveId(id)
  }, [todayMode, conversations.length])

  function openTodayDayItem(it: TodayDayItem): void {
    if (it.kind === 'rss-digest' && it.conversationId && it.digestId) {
      leaveToday()
      exitOverlayModes()
      setActiveId(it.conversationId)
      selectRssDigestOn(it.conversationId, it.digestId)
      return
    }
    if (it.conversationId) {
      leaveToday()
      exitOverlayModes()
      setActiveId(it.conversationId)
      return
    }
    setScheduleMode(true)
    setMonitorMode(false)
    setSettingsMode(false)
    monitorRef.current = false
  }

  function openTodayRead(it: TodayReadItem): void {
    leaveToday()
    exitOverlayModes()
    const deep = { conversationId: it.conversationId, rssEntryId: it.entryId }
    desiredRssOpenRef.current = deep
    const next = applyRssDeepLink(conversationsRef.current, deep)
    conversationsRef.current = next
    setConversations(next)
    const c = next.find((x) => x.id === deep.conversationId)
    if (c?.rss?.selectedId === deep.rssEntryId) desiredRssOpenRef.current = null
    setActiveId(it.conversationId)
  }

  function switchTo(id: string): void {
    const inOverlay = monitorMode || scheduleMode || settingsMode
    // 在设置 / 今天里点当前任务，也应切回对话
    if (id === activeId && !inOverlay && !todayMode) return
    leaveToday()
    exitOverlayModes()
    stickScrollToBottom()
    setSelectedReplies(new Set())
    setTodayHeldDones((prev) => releaseHeldDone(prev, id))
    setActiveId(id)
  }

  /** 定时任务「打开简报」：切到该 RSS，进简报页；有记录则选中最新一份。 */
  function openRssLatestDigest(conversationId: string): void {
    if (!conversationId.trim()) return
    leaveToday()
    exitOverlayModes()
    stickScrollToBottom()
    setSelectedReplies(new Set())
    setActiveId(conversationId)
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== conversationId || c.kind !== 'rss' || !c.rss) return c
        const latest = (c.rss.digests || [])[0]
        if (!latest) {
          return {
            ...c,
            rss: {
              ...c.rss,
              readerMode: 'digest' as const,
              updatedAt: Date.now()
            },
            updatedAt: Date.now()
          }
        }
        const switched = switchRssEntry(c, rssDigestThreadId(latest.id))
        return {
          ...switched,
          rss: {
            ...switched.rss!,
            readerMode: 'digest' as const,
            selectedDigestId: latest.id,
            updatedAt: Date.now()
          },
          updatedAt: Date.now()
        }
      })
      conversationsRef.current = next
      return next
    })
  }

  /** IDE 联动时间线 → 复用同 session 续查对话，否则新建一次并登记绑定。 */
  function continueFromMonitor(a: Activity): void {
    leaveToday()
    exitOverlayModes()
    const cwd = (a.cwd && a.cwd.trim()) || defaultCwdRef.current
    const sid = (a.sessionId || '').trim()
    const draftText =
      `【来自 IDE 联动 · ${a.label}】` +
      (a.cwd ? `\n工作目录：${a.cwd}` : '') +
      (sid && sid !== 'default' ? `\nIDE 会话：${sid}` : '') +
      `\n${a.text}\n\n` +
      '请基于以上情况继续排查、收尾或给出下一步可执行动作。'

    const existing =
      sid && sid !== 'default'
        ? conversationsRef.current.find(
            (c) => c.kind !== 'rss' && c.kind !== 'compare' && c.sessionId === sid
          )
        : undefined

    if (existing) {
      setActiveId(existing.id)
      if (cwd && !existing.cwd) {
        updateConv(existing.id, (c) => ({ ...c, cwd }))
      }
      restoreDraft(existing.id, { text: draftText, attachments: [], skills: [] })
      window.petApi.bindIdeContinue({
        conversationId: existing.id,
        sessionId: sid !== 'default' ? sid : undefined
      })
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }

    const c = newConversation(cwd, defaultModelRef, defaultAgentAutonomy)
    c.title = `续查 · ${a.label}`.slice(0, 40)
    if (sid && sid !== 'default') c.sessionId = sid
    setConversations((prev) => [...prev, c])
    conversationsRef.current = [...conversationsRef.current, c]
    setActiveId(c.id)
    restoreDraft(c.id, { text: draftText, attachments: [], skills: [] })
    window.petApi.bindIdeContinue({
      conversationId: c.id,
      sessionId: sid && sid !== 'default' ? sid : undefined
    })
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function startRename(c: Conversation): void {
    setEditingId(c.id)
    setEditValue(c.title === '新对话' ? '' : c.title)
  }
  function commitRename(): void {
    if (editingId) {
      const name = editValue.trim()
      updateConv(editingId, (c) => ({ ...c, title: name || c.title }))
    }
    setEditingId(null)
  }

  function addGroup(): void {
    const g = newConversationGroup('', groups)
    setGroups((prev) => [...prev, g])
    setEditingGroupId(g.id)
    setGroupEditValue(g.name)
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev)
      next.delete(g.id)
      return next
    })
  }

  function beginGroupRename(groupId: string, currentName: string): void {
    setEditingGroupId(groupId)
    setGroupEditValue(currentName)
  }

  function commitGroupRename(): void {
    if (!editingGroupId) return
    if (editingGroupId === UNGROUPED_SECTION_ID) {
      setUngroupedLabel(normalizeUngroupedLabel(groupEditValue))
      setEditingGroupId(null)
      return
    }
    setGroups((prev) => renameConversationGroup(prev, editingGroupId, groupEditValue))
    setEditingGroupId(null)
  }

  async function removeGroup(groupId: string): Promise<void> {
    const g = groups.find((x) => x.id === groupId)
    if (!g) return
    // 无边框窗里 window.confirm 常失灵，走主进程原生对话框
    const ok = await confirmDestructiveAsync(
      `删除分组「${g.name}」？其中的任务会回到「${ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? uiText(DEFAULT_UNGROUPED_LABEL) : ungroupedLabel}」，不会丢失。`
    )
    if (!ok) return
    const next = deleteConversationGroup(groups, conversationsRef.current, groupId)
    conversationsRef.current = next.conversations
    setConversations(next.conversations)
    setGroups(next.groups)
    setCollapsedGroupIds((prev) => {
      const s = new Set(prev)
      s.delete(groupId)
      return s
    })
    if (editingGroupId === groupId) setEditingGroupId(null)
  }

  function moveConvToGroup(conversationId: string, groupId: string | undefined): void {
    const valid = new Set(groups.map((g) => g.id))
    const next = moveConversationToGroup(
      conversationsRef.current,
      conversationId,
      groupId,
      valid
    )
    conversationsRef.current = next
    setConversations(next)
    setMoveMenu(null)
    setDragConvId(null)
    setDropTargetKey(null)
  }

  function toggleConvPinned(conversationId: string, pinned?: boolean): void {
    const cur = conversationsRef.current.find((c) => c.id === conversationId)
    if (!cur) return
    const nextPin = pinned ?? !cur.pinnedAt
    const next = setConversationPinned(conversationsRef.current, conversationId, nextPin)
    conversationsRef.current = next
    setConversations(next)
    setMoveMenu(null)
    setDragConvId(null)
    setDropTargetKey(null)
  }

  function toggleGroupCollapsed(groupId: string): void {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  function expandGroupForDrop(groupId: string): void {
    setCollapsedGroupIds((prev) => {
      if (!prev.has(groupId)) return prev
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
  }

  function onGroupDragOver(e: DragEvent, key: string): void {
    if (!dragConvId && !e.dataTransfer.types.includes('text/plain')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetKey !== key) setDropTargetKey(key)
    if (key !== 'ungrouped' && key !== 'pinned') expandGroupForDrop(key)
  }

  function onGroupDrop(e: DragEvent, key: string): void {
    e.preventDefault()
    e.stopPropagation()
    const id = e.dataTransfer.getData('text/plain') || dragConvId
    if (!id) {
      setDragConvId(null)
      setDropTargetKey(null)
      return
    }
    if (key === 'pinned') {
      toggleConvPinned(id, true)
      return
    }
    moveConvToGroup(id, key === 'ungrouped' ? undefined : key)
  }

  const conversationPartition = useMemo(
    () =>
      partitionConversationsByGroup(
        conversations.filter((c) => !isTodayQuickTask(c)),
        groups
      ),
    [conversations, groups]
  )
  const todayQuick = conversations.find(isTodayQuickTask)

  // 对话框皮肤：写到 <html data-theme>，驱动全局 CSS 变量
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', chatTheme)
    if (chatTheme === 'custom') {
      applyChatThemeCustom(root, chatThemeCustom)
    } else {
      clearChatThemeCustom(root)
    }
  }, [chatTheme, chatThemeCustom])

  function toggleSidebar(): void {
    setSidebarCollapsed((v) => {
      const next = !v
      window.petApi.setSidebarCollapsed(next)
      return next
    })
  }

  function toggleMonitor(): void {
    setMonitorMode((v) => {
      const nv = !v
      monitorRef.current = nv
      if (nv) {
        setScheduleMode(false)
        setSettingsMode(false)
        }
      return nv
    })
  }

  function toggleSchedule(): void {
    setScheduleMode((v) => {
      if (!v) {
        setMonitorMode(false)
        setSettingsMode(false)
          monitorRef.current = false
      }
      return !v
    })
  }

  function toggleSettings(): void {
    setSettingsMode((v) => {
      if (!v) {
        setMonitorMode(false)
        setScheduleMode(false)
          monitorRef.current = false
      }
      return !v
    })
  }


  function addConversation(): void {
    exitOverlayModes()
    setNewTaskSeed('chat')
    setNewTaskOpen(true)
  }

  /** 本任务内开一轮新对话（归档当前 messages，不新建侧栏任务）。 */
  function newThreadInActiveTask(): void {
    if (!activeId || !active || active.kind === 'rss') return
    if (busy) return
    stickScrollToBottom()
    setSelectedReplies(new Set())
    dismissError(activeId)
    clearConvQueue(activeId)
    setFilePreview(null)
    updateConv(activeId, (c) => newTaskThread(c))
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  /** 本任务内切换到另一轮对话。 */
  function switchThreadInActiveTask(threadId: string): void {
    if (!activeId || !active || active.kind === 'rss') return
    if (busy) return
    stickScrollToBottom()
    setSelectedReplies(new Set())
    setFilePreview(null)
    updateConv(activeId, (c) => switchTaskThread(c, threadId))
  }

  /** 本任务内删除某一轮对话记录。 */
  function deleteThreadInActiveTask(threadId: string): void {
    if (!activeId || !active || active.kind === 'rss') return
    if (busy) return
    stickScrollToBottom()
    setSelectedReplies(new Set())
    dismissError(activeId)
    clearConvQueue(activeId)
    setFilePreview(null)
    updateConv(activeId, (c) => deleteTaskThread(c, threadId))
  }

  function rememberCwdLocal(cwd?: string): void {
    if (!cwd) return
    setRecentCwds((prev) => [cwd, ...prev.filter((x) => x !== cwd)].slice(0, 8))
  }

  function assignTaskGroup(c: Conversation, groupId?: string): Conversation {
    const gid = typeof groupId === 'string' ? groupId.trim() : ''
    if (!gid) {
      if (c.groupId === undefined) return c
      const { groupId: _drop, ...rest } = c
      return rest
    }
    if (!groups.some((g) => g.id === gid)) return c
    return c.groupId === gid ? c : { ...c, groupId: gid }
  }

  function mountNewTask(c: Conversation): void {
    leaveToday()
    exitOverlayModes()
    stickScrollToBottom()
    setSelectedReplies(new Set())
    const next = [...conversationsRef.current, c]
    conversationsRef.current = next
    setConversations(next)
    setActiveId(c.id)
    setNewTaskOpen(false)
    rememberCwdLocal(c.cwd)
  }

  function createChatTask(
    scenario?: TaskScenario,
    cwdOverride?: string,
    groupId?: string,
    modelRefOverride?: string
  ): void {
    const scene = scenario || BUILTIN_TASK_SCENARIOS.find((s) => s.id === 'scene-chat')!
    const cwd = (cwdOverride && cwdOverride.trim()) || defaultCwdRef.current
    const modelRef = (modelRefOverride && modelRefOverride.trim()) || defaultModelRef
    let c = newConversation(
      cwd,
      modelRef,
      scene.agentAutonomy ?? defaultAgentAutonomy
    )
    c = applyTaskScenario(c, scene)
    mountNewTask(assignTaskGroup(c, groupId))
    if (scene.seedPrompt) {
      restoreDraft(c.id, { text: scene.seedPrompt, attachments: [], skills: [] })
    }
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  function createCompareTask(
    modelRefs: string[],
    cwdOverride?: string,
    groupId?: string
  ): void {
    if (modelRefs.length < 2) return
    const cwd = (cwdOverride && cwdOverride.trim()) || defaultCwdRef.current
    const c = assignTaskGroup(
      newCompareConversation(cwd, modelRefs, defaultModelRef, defaultAgentAutonomy),
      groupId
    )
    mountNewTask(c)
    setCompareColumns(Math.min(6, Math.max(2, modelRefs.length)) as CompareColumns)
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  function createRssTask(
    feedUrls: string[],
    cwdOverride?: string,
    groupId?: string,
    modelRefOverride?: string
  ): void {
    const feeds = normalizeRssTaskFeeds(feedUrls)
    if (!feeds.length) return
    // RSS 不依赖项目目录；仅在显式传入时写入 cwd
    const cwd =
      typeof cwdOverride === 'string' && cwdOverride.trim()
        ? cwdOverride.trim()
        : undefined
    const modelRef = (modelRefOverride && modelRefOverride.trim()) || defaultModelRef
    const c = assignTaskGroup(
      newRssConversation(
        cwd,
        feeds.map((f) => f.url),
        modelRef,
        defaultAgentAutonomy
      ),
      groupId
    )
    mountNewTask(c)
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  /** 按会话写 RSS 状态（生成中切走也必须写回原任务，不能跟 activeId）。 */
  function patchRss(
    conversationId: string,
    next: RssTaskState | ((prev: RssTaskState) => RssTaskState)
  ): void {
    if (!conversationId) return
    updateConv(conversationId, (c) => {
      if (c.kind !== 'rss' || !c.rss) return c
      const rss = typeof next === 'function' ? next(c.rss) : next
      return { ...c, rss, updatedAt: Date.now() }
    })
  }

  function patchActiveRss(next: RssTaskState): void {
    if (!activeId) return
    patchRss(activeId, next)
  }

  function selectRssEntry(entry: RssTaskEntry): void {
    if (!activeId) return
    updateConv(activeId, (c) => {
      if (c.kind !== 'rss' || !c.rss) return c
      const switched = switchRssEntry(c, entry.id)
      return {
        ...switched,
        rss: switched.rss ? markRssEntryRead(switched.rss, entry.id) : switched.rss,
        updatedAt: Date.now()
      }
    })
  }

  /**
   * 选中简报写到指定任务（生成完成时即使用户已切走）。
   * 默认打开即标已读（气泡不再推）；生成刚落盘选中时传 markRead:false。
   */
  function selectRssDigestOn(
    conversationId: string,
    digestId: string,
    opts?: { markRead?: boolean }
  ): void {
    if (!conversationId || !digestId.trim()) return
    const markRead = opts?.markRead !== false
    updateConv(conversationId, (c) => {
      if (c.kind !== 'rss' || !c.rss) return c
      const switched = switchRssEntry(c, rssDigestThreadId(digestId))
      const base = markRead ? markRssDigestRead(switched.rss!, digestId) : switched.rss!
      return {
        ...switched,
        rss: {
          ...base,
          readerMode: 'digest',
          selectedDigestId: digestId,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }
    })
  }

  /** 删除简报记录，并清掉对应讨论线程。 */
  function deleteRssDigest(digestId: string): void {
    if (!activeId || !digestId.trim()) return
    updateConv(activeId, (c) => {
      if (c.kind !== 'rss' || !c.rss) return c
      const threadId = rssDigestThreadId(digestId)
      let next = syncRssActiveThread(c)
      const wasOnThread = next.rss?.selectedId === threadId
      const rss = removeRssDigest(next.rss!, digestId)
      const threads = { ...(next.rssThreads || {}) }
      delete threads[threadId]
      const sessions = { ...(next.rssSessions || {}) }
      delete sessions[threadId]
      const models = { ...(next.rssModelRefs || {}) }
      delete models[threadId]
      const autonomies = { ...(next.rssAutonomies || {}) }
      delete autonomies[threadId]
      next = {
        ...next,
        rss: { ...rss, readerMode: 'digest', updatedAt: Date.now() },
        rssThreads: threads,
        rssSessions: sessions,
        rssModelRefs: models,
        rssAutonomies: autonomies,
        updatedAt: Date.now()
      }
      if (wasOnThread) {
        if (rss.selectedDigestId) {
          return {
            ...switchRssEntry(next, rssDigestThreadId(rss.selectedDigestId)),
            rss: {
              ...rss,
              readerMode: 'digest',
              selectedDigestId: rss.selectedDigestId,
              updatedAt: Date.now()
            },
            updatedAt: Date.now()
          }
        }
        return {
          ...next,
          messages: [],
          sessionId: undefined,
          rss: { ...rss, selectedId: undefined, readerMode: 'digest', updatedAt: Date.now() },
          updatedAt: Date.now()
        }
      }
      return next
    })
  }

  function selectRssThread(threadId: string): void {
    if (!activeId || !threadId.trim()) return
    updateConv(activeId, (c) => {
      if (c.kind !== 'rss' || !c.rss) return c
      return { ...switchRssEntry(c, threadId), updatedAt: Date.now() }
    })
  }

  function createFromScenario(
    scenario: TaskScenario,
    cwdOverride?: string,
    groupId?: string,
    modelRefOverride?: string
  ): void {
    createChatTask(scenario, cwdOverride, groupId, modelRefOverride)
  }

  /** 宠物简报升级：新建对话/对比并预填草稿（不自动发送）。 */
  useEffect(() => {
    const off = window.petApi.onBriefEscalate((payload) => {
      exitOverlayModes()
      const cwd = defaultCwdRef.current
      const batchN = payload.items?.length || 0
      const titleBase =
        batchN > 1
          ? `${batchN} 条简报`
          : (payload.item.title || '资讯').slice(0, 28)
      const prompt = payload.prompt

      if (payload.mode === 'compare') {
        const refs = flattenEnabledRefs(modelProviders)
          .map((x) => x.ref)
          .slice(0, Math.min(6, Math.max(2, compareColumns)))
        if (refs.length >= 2) {
          const c = newCompareConversation(
            cwd,
            refs,
            defaultModelRef,
            defaultAgentAutonomy
          )
          c.title = `对比 · ${titleBase}`
          mountNewTask(c)
          restoreDraft(c.id, { text: prompt, attachments: [], skills: [] })
          setCompareColumns(Math.min(6, Math.max(2, refs.length)) as CompareColumns)
          setTimeout(() => inputRef.current?.focus(), 60)
          return
        }
        // 禁止静默降级：草稿抬头写明原因
        const c = newConversation(cwd, defaultModelRef, defaultAgentAutonomy)
        c.title = `资讯 · ${titleBase}`
        mountNewTask(c)
        restoreDraft(c.id, {
          text: buildBriefCompareFallbackNote() + prompt,
          attachments: [],
          skills: []
        })
        setTimeout(() => inputRef.current?.focus(), 60)
        return
      }

      const c = newConversation(cwd, defaultModelRef, defaultAgentAutonomy)
      c.title = `资讯 · ${titleBase}`
      mountNewTask(c)
      restoreDraft(c.id, { text: prompt, attachments: [], skills: [] })
      setTimeout(() => inputRef.current?.focus(), 60)
    })
    return off
    // mount/restore 随 render 更新；订阅随模型列表变化重绑即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelProviders, defaultModelRef, defaultAgentAutonomy, compareColumns])

  function beginStream(conversationId: string, assistantMsgId: string, laneId?: string): void {
    const key = makeStreamKey(conversationId, laneId)
    const epoch = (streamEpochRef.current.get(key) ?? 0) + 1
    streamEpochRef.current.set(key, epoch)
    streamsRef.current.set(key, assistantMsgId)
    const now = Date.now()
    // 按 streamKey 记时：对比多列不能共用一个 lastEvent，否则一列活动会拖死其它空列
    lastStreamEventAtRef.current.set(key, now)
    streamStartedAtRef.current.set(key, now)
    setStreamingIds((prev) => {
      // endStream 已推进 epoch → 丢弃迟到的 begin
      if (streamEpochRef.current.get(key) !== epoch) return prev
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      streamingIdsRef.current = next
      return next
    })
  }

  function clearStreamClockKey(key: string): void {
    lastStreamEventAtRef.current.delete(key)
    streamStartedAtRef.current.delete(key)
    activeWorkCountRef.current.delete(key)
  }

  function clearStreamClocksForConversation(conversationId: string): void {
    const prefix = `${conversationId}::`
    for (const k of [...lastStreamEventAtRef.current.keys()]) {
      if (k === conversationId || k.startsWith(prefix)) clearStreamClockKey(k)
    }
  }

  function noteActiveWork(
    conversationId: string,
    status: string | undefined,
    laneId?: string
  ): void {
    const key = makeStreamKey(conversationId, laneId)
    if (status === 'running') {
      const n = (activeWorkCountRef.current.get(key) ?? 0) + 1
      activeWorkCountRef.current.set(key, n)
      return
    }
    if (status === 'done' || status === 'error') {
      const n = Math.max(0, (activeWorkCountRef.current.get(key) ?? 0) - 1)
      if (n === 0) activeWorkCountRef.current.delete(key)
      else activeWorkCountRef.current.set(key, n)
    }
  }

  function endStream(
    conversationId: string,
    laneId?: string,
    opts?: { drainQueue?: boolean }
  ): void {
    const drainQueue = opts?.drainQueue !== false
    if (laneId) {
      const key = makeStreamKey(conversationId, laneId)
      streamEpochRef.current.set(key, (streamEpochRef.current.get(key) ?? 0) + 1)
      streamsRef.current.delete(key)
      // 同步更新 ref：setState updater 可能晚一拍，不能靠它判断「是否还能 drain」
      if (streamingIdsRef.current.has(key)) {
        const next = new Set(streamingIdsRef.current)
        next.delete(key)
        streamingIdsRef.current = next
      }
      setStreamingIds((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      clearStreamClockKey(key)
      // 对比：单列结束即按 FIFO 推进该列，不等同轮其它模型
      if (drainQueue) {
        queueMicrotask(() => {
          advanceCompareLane(conversationId, laneId)
        })
      }
      return
    }
    const prefix = `${conversationId}::`
    const matches = (k: string): boolean => k === conversationId || k.startsWith(prefix)
    // 作废进行中的 beginStream，避免「先 delete 空集、再 add」把 busy 锁死
    for (const k of new Set([...streamsRef.current.keys(), ...streamingIdsRef.current])) {
      if (matches(k)) {
        streamEpochRef.current.set(k, (streamEpochRef.current.get(k) ?? 0) + 1)
      }
    }
    for (const k of [...streamsRef.current.keys()]) {
      if (matches(k)) streamsRef.current.delete(k)
    }
    // 同步清 ref，再交给 React
    {
      let changed = false
      const next = new Set(streamingIdsRef.current)
      for (const k of streamingIdsRef.current) {
        if (matches(k) && next.delete(k)) changed = true
      }
      if (changed) streamingIdsRef.current = next
    }
    setStreamingIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const k of prev) {
        if (matches(k) && next.delete(k)) changed = true
      }
      return changed ? next : prev
    })
    clearStreamClocksForConversation(conversationId)
    if (drainQueue) {
      queueMicrotask(() => {
        void tryDrainQueue(conversationId)
      })
    }
  }

  function setConvQueue(
    conversationId: string,
    fn: (prev: QueuedPrompt[]) => QueuedPrompt[]
  ): void {
    setQueuesByConv((prev) => {
      const cur = prev[conversationId] ?? []
      const list = fn(cur)
      const next = { ...prev }
      if (!list.length) delete next[conversationId]
      else next[conversationId] = list
      queuesRef.current = next
      return next
    })
  }

  function clearConvQueue(conversationId: string): void {
    setQueuesByConv((prev) => {
      if (!(conversationId in prev)) return prev
      const next = { ...prev }
      delete next[conversationId]
      queuesRef.current = next
      return next
    })
  }

  function enqueuePrompt(
    conversationId: string,
    prompt: string,
    attachments: ChatAttachment[],
    skills: string[]
  ): void {
    const item: QueuedPrompt = {
      id: uid(),
      prompt,
      attachments,
      skills,
      createdAt: Date.now()
    }
    setConvQueue(conversationId, (q) => [...q, item])
  }

  quickSendRef.current = (conversationId, text, attachments = []) => {
    const prompt = (text || '').trim()
    const atts = attachments || []
    if (!prompt && !atts.length) return
    const body = prompt || (atts.length ? '请查看这些附件并给出说明。' : '')
    const run = async (): Promise<void> => {
      // 快问可能刚在主进程新建了任务，sync 事件还没进 React；先对齐 store
      if (!conversationsRef.current.some((c) => c.id === conversationId)) {
        const store = await window.petApi.getChatStore()
        if (store?.conversations?.length) {
          const chat = normalizeChatStore(store) || store
          const normalized = chat.conversations.map(normalizeCompareConversation)
          conversationsRef.current = normalized
          setConversations(normalized)
          if (chat.groups) setGroups(chat.groups)
          if (chat.ungroupedLabel != null) {
            setUngroupedLabel(normalizeUngroupedLabel(chat.ungroupedLabel))
          }
        }
      }
      if (!conversationsRef.current.some((c) => c.id === conversationId)) return
      setActiveId(conversationId)
      setLastChatInteractedId(conversationId)
      setTodayMode(false)
      setMonitorMode(false)
      setScheduleMode(false)
      setSettingsMode(false)
      monitorRef.current = false
      // 双保险：主进程已轮换时这里多为 no-op；若 store 未同步则本地再判一次
      if (!isStreamingInMap(streamsRef.current, conversationId)) {
        const cur = conversationsRef.current.find((c) => c.id === conversationId)
        if (cur) {
          const rotated = rotateQuickChatThreadIfIdle(cur)
          if (rotated !== cur) {
            updateConv(conversationId, () => rotated)
          }
        }
      }
      if (isStreamingInMap(streamsRef.current, conversationId)) {
        enqueuePrompt(conversationId, body, atts, [])
        return
      }
      void send(body, atts, [], { conversationId })
    }
    void run()
  }

  function isLaneBusy(conversationId: string, laneId: string): boolean {
    return streamsRef.current.has(makeStreamKey(conversationId, laneId))
  }

  /** 对比：空闲且已追上用户轮次的列（可立刻开下一轮）。 */
  function compareReadyLaneIds(conv: Conversation): string[] {
    const users = conv.messages.filter((m) => m.role === 'user').length
    return getCompareLanes(conv)
      .filter((l) => {
        if (isLaneBusy(conv.id, l.id)) return false
        const n = conv.lanes?.[l.id]?.messages.length ?? 0
        return n === users
      })
      .map((l) => l.id)
  }

  /**
   * 对比列收尾后的 FIFO：
   * - 若该列落后于已提交的用户轮 → 只补这一列
   * - 否则若有暂存 → 开下一轮（只拉上空闲且已对齐的列，不等慢列）
   */
  function advanceCompareLane(conversationId: string, laneId: string): void {
    const conv = conversationsRef.current.find((c) => c.id === conversationId)
    if (!conv || conv.kind !== 'compare') return
    if (isLaneBusy(conversationId, laneId)) return

    const users = conv.messages.filter((m) => m.role === 'user')
    const have = conv.lanes?.[laneId]?.messages.length ?? 0
    if (have < users.length) {
      void send('', [], [], {
        conversationId,
        laneIds: [laneId],
        addUserMessage: false,
        catchUpTurnIndex: have
      })
      return
    }

    const head = queuesRef.current[conversationId]?.[0]
    if (!head) return
    const ready = compareReadyLaneIds(conv)
    if (!ready.length) return
    setConvQueue(conversationId, (q) => q.filter((x) => x.id !== head.id))
    void send(head.prompt, head.attachments, head.skills, {
      conversationId,
      laneIds: ready,
      addUserMessage: true
    }).then((started) => {
      if (!started) {
        setConvQueue(conversationId, (q) => [head, ...q.filter((x) => x.id !== head.id)])
      }
    })
  }

  async function tryDrainQueue(conversationId: string): Promise<void> {
    const conv = conversationsRef.current.find((c) => c.id === conversationId)
    if (!conv) return

    // 对比：按列 FIFO，不要求整轮所有模型都结束
    if (conv.kind === 'compare') {
      if (drainLockRef.current.has(conversationId)) return
      const head = queuesRef.current[conversationId]?.[0]
      if (!head) return
      const ready = compareReadyLaneIds(conv)
      if (!ready.length) return
      drainLockRef.current.add(conversationId)
      setConvQueue(conversationId, (q) => q.filter((x) => x.id !== head.id))
      try {
        const started = await send(head.prompt, head.attachments, head.skills, {
          conversationId,
          laneIds: ready,
          addUserMessage: true
        })
        if (!started) {
          setConvQueue(conversationId, (q) => [head, ...q.filter((x) => x.id !== head.id)])
        }
      } finally {
        drainLockRef.current.delete(conversationId)
      }
      return
    }

    if (isStreamingInMap(streamsRef.current, conversationId)) return
    if (isConvStreaming(streamingIdsRef.current, conversationId)) return
    if (drainLockRef.current.has(conversationId)) return
    const head = queuesRef.current[conversationId]?.[0]
    if (!head) return

    drainLockRef.current.add(conversationId)
    // 一开始就出队：否则 await sendPrompt 整轮结束前，UI 一直像「暂存没启动」
    setConvQueue(conversationId, (q) => q.filter((x) => x.id !== head.id))
    let started = false
    try {
      started = await send(head.prompt, head.attachments, head.skills, {
        conversationId
      })
      if (!started) {
        // 没开跑则放回；finally 不再立刻重试，避免 cwd/空 prompt 等失败死循环
        setConvQueue(conversationId, (q) => [head, ...q.filter((x) => x.id !== head.id)])
      }
    } finally {
      drainLockRef.current.delete(conversationId)
    }
    // sendPrompt 可能阻塞到终态；done 触发的 drain 常撞上 lock。
    // 仅在成功开跑后再冲下一条。
    if (
      started &&
      queuesRef.current[conversationId]?.length &&
      !isStreamingInMap(streamsRef.current, conversationId) &&
      !isConvStreaming(streamingIdsRef.current, conversationId)
    ) {
      queueMicrotask(() => {
        void tryDrainQueue(conversationId)
      })
    }
  }

  function handleComposerSend(
    prompt: string,
    attachments: ChatAttachment[],
    skills: string[]
  ): void {
    if (!activeId) return
    clearComposerDraft(activeId)
    const conv = conversationsRef.current.find((c) => c.id === activeId)
    if (conv?.kind === 'compare') {
      const ready = compareReadyLaneIds(conv)
      if (ready.length) {
        void send(prompt, attachments, skills, { laneIds: ready, addUserMessage: true })
        return
      }
      // 所有列都在跑 → 暂存，谁先结束谁接
      enqueuePrompt(activeId, prompt, attachments, skills)
      return
    }
    if (
      isStreamingInMap(streamsRef.current, activeId) ||
      isConvStreaming(streamingIds, activeId)
    ) {
      enqueuePrompt(activeId, prompt, attachments, skills)
      return
    }
    void send(prompt, attachments, skills)
  }

  function editQueued(id: string): void {
    if (!activeId) return
    const item = (queuesRef.current[activeId] ?? []).find((x) => x.id === id)
    if (!item) return
    setConvQueue(activeId, (q) => q.filter((x) => x.id !== id))
    restoreDraft(activeId, {
      text: item.prompt,
      attachments: item.attachments,
      skills: item.skills
    })
  }

  function removeQueued(id: string): void {
    if (!activeId) return
    setConvQueue(activeId, (q) => q.filter((x) => x.id !== id))
  }

  function sendQueuedNow(id: string): void {
    if (!activeId) return
    const conv = conversationsRef.current.find((c) => c.id === activeId)
    if (conv?.kind === 'compare') {
      const ready = compareReadyLaneIds(conv)
      if (!ready.length) return
      const item = (queuesRef.current[activeId] ?? []).find((x) => x.id === id)
      if (!item) return
      setConvQueue(activeId, (q) => q.filter((x) => x.id !== id))
      void send(item.prompt, item.attachments, item.skills, {
        laneIds: ready,
        addUserMessage: true
      })
      return
    }
    if (busy) return
    const item = (queuesRef.current[activeId] ?? []).find((x) => x.id === id)
    if (!item) return
    setConvQueue(activeId, (q) => q.filter((x) => x.id !== id))
    void send(item.prompt, item.attachments, item.skills)
  }

  function closeConversation(id: string): void {
    const target = conversations.find((c) => c.id === id)
    const hasRun = [...streamsRef.current.keys()].some(
      (k) => k === id || k.startsWith(`${id}::`)
    )
    const isRss = target?.kind === 'rss'
    const hasRssData = Boolean(
      isRss &&
        ((target.rss?.feeds?.length ?? 0) > 0 ||
          (target.rss?.items?.length ?? 0) > 0 ||
          Object.keys(target.rssThreads ?? {}).length > 0)
    )
    const hasMsgs = Boolean(
      target &&
        (target.messages.length > 0 ||
          Object.values(target.lanes ?? {}).some((l) => l.messages.length > 0) ||
          hasRssData)
    )
    // RSS 即使刚建空任务也提示，避免误点 × 直接没了
    if (hasRun || hasMsgs || isRss) {
      const title = target?.title || '未命名'
      const tip = hasRun
        ? '该任务仍在运行，关闭将停止并删除记录。确定关闭？'
        : isRss
          ? `确定删除 RSS 任务「${title}」？订阅源、已抓取消息与讨论将无法恢复。`
          : `确定关闭任务「${title}」？对话记录将无法恢复。`
      if (!confirmDestructive(tip)) return
    }
    if (hasRun) {
      window.petApi.cancel(id)
      endStream(id)
    }
    clearConvQueue(id)
    dismissError(id)
    draftsRef.current.delete(id)
    if (isRss) {
      void window.petApi.deleteSchedulesForConversation(id)
    }
    const prev = conversationsRef.current
    const rest = prev.filter((c) => c.id !== id)
    if (id === activeId) setActiveId(rest.length ? rest[rest.length - 1].id : '')
    conversationsRef.current = rest
    setConversations(rest)
  }

  function applyStreamPatches(
    prev: Conversation[],
    conversationId: string,
    patches: Array<{ laneId?: string; fn: (blocks: ChatBlock[]) => ChatBlock[] }>
  ): Conversation[] {
    return prev.map((c) => {
      if (c.id !== conversationId) return c
      let next = c
      for (const patch of patches) {
        let streamLane = patch.laneId
        let mid = streamsRef.current.get(makeStreamKey(conversationId, streamLane))
        if (!mid && streamLane) {
          mid = streamsRef.current.get(makeStreamKey(conversationId))
          if (mid) streamLane = undefined
        }
        if (!mid) continue
        const targetMid = mid
        if (streamLane && next.kind === 'compare') {
          const lane = next.lanes?.[streamLane]
          if (!lane) continue
          next = {
            ...next,
            lanes: {
              ...next.lanes,
              [streamLane]: {
                ...lane,
                messages: lane.messages.map((m) =>
                  m.id === targetMid ? { ...m, blocks: patch.fn(m.blocks) } : m
                )
              }
            },
            updatedAt: Date.now()
          }
        } else {
          next = {
            ...next,
            messages: next.messages.map((m) =>
              m.id === targetMid ? { ...m, blocks: patch.fn(m.blocks) } : m
            ),
            updatedAt: Date.now()
          }
        }
      }
      return next
    })
  }

  function flushStreamPatches(): void {
    streamPatchTimerRef.current = null
    const queued = streamPatchQueueRef.current
    if (!queued.size) return
    streamPatchQueueRef.current = new Map()
    let next = conversationsRef.current
    for (const [cid, patches] of queued) {
      // 按 lane 合并成单次 fn，避免一帧内 N 次深拷贝
      const byLane = new Map<string | undefined, Array<(b: ChatBlock[]) => ChatBlock[]>>()
      for (const p of patches) {
        const arr = byLane.get(p.laneId) ?? []
        arr.push(p.fn)
        byLane.set(p.laneId, arr)
      }
      const composed = [...byLane.entries()].map(([laneId, fns]) => ({
        laneId,
        fn: (blocks: ChatBlock[]) => fns.reduce((b, f) => f(b), blocks)
      }))
      next = applyStreamPatches(next, cid, composed)
    }
    conversationsRef.current = next
    setConversations(next)
  }

  function patchStreaming(
    conversationId: string,
    fn: (blocks: ChatBlock[]) => ChatBlock[],
    laneId?: string,
    opts?: { urgent?: boolean }
  ): void {
    const list = streamPatchQueueRef.current.get(conversationId) ?? []
    list.push({ laneId, fn })
    streamPatchQueueRef.current.set(conversationId, list)
    if (opts?.urgent) {
      if (streamPatchTimerRef.current != null) {
        clearTimeout(streamPatchTimerRef.current)
        streamPatchTimerRef.current = null
      }
      flushStreamPatches()
      return
    }
    if (streamPatchTimerRef.current == null) {
      streamPatchTimerRef.current = setTimeout(() => flushStreamPatches(), 16)
    }
  }

  function handleEvent(e: AgentEvent): void {
    const cid = e.conversationId
    if (!cid) return
    // 只有对比列才带 laneId。绝不能用 modelId 冒充：
    // 普通对话也会带 modelId（如 medical:qwen…），否则流 key 对不上 → 空白回复且一直 busy。
    const laneId = e.laneId
    lastStreamEventAtRef.current.set(makeStreamKey(cid, laneId), Date.now())

    switch (e.type) {
      case 'session': {
        updateConv(cid, (c) => {
          if (laneId && c.kind === 'compare') {
            const prev = c.lanes?.[laneId] ?? { messages: [], modelId: e.modelId ?? '' }
            return {
              ...c,
              lanes: {
                ...c.lanes,
                [laneId]: { ...prev, sessionId: e.sessionId }
              }
            }
          }
          return { ...c, sessionId: e.sessionId }
        })
        break
      }
      case 'notice':
        patchStreaming(
          cid,
          (b) => {
            if (b.some((x) => x.kind === 'status' && x.pin && x.text === e.text)) return b
            return [...b, { kind: 'status' as const, text: e.text, pin: true }]
          },
          laneId,
          { urgent: true }
        )
        break
      case 'assistant-delta':
        patchStreaming(cid, (b) => appendText(b, 'text', e.text), laneId)
        if (!laneId) feedStreamTts(cid, e.text)
        break
      case 'reasoning-delta':
        patchStreaming(cid, (b) => appendText(b, 'reasoning', e.text), laneId)
        break
      case 'tool':
        noteActiveWork(cid, e.status, laneId)
        {
          const writtenRaw =
            e.status === 'done' && isWriteLikeToolName(e.name)
              ? extractFilePathFromToolPayload(e.input, e.output)
              : null
          // 只挂本回合写出的结果文件；素材目录等过程路径不挂
          const attachPath =
            writtenRaw && isResultFilePath(writtenRaw) ? writtenRaw : null
          patchStreaming(
            cid,
            (b) => {
              let next = upsertBlock(b, {
                kind: 'tool',
                id: e.id,
                name: e.name,
                input: e.input,
                output: e.output,
                status: e.status
              })
              if (attachPath) next = ensureAttachmentBlock(next, attachPath)
              if (e.status === 'done' && e.output) {
                for (const p of extractLocalImagePaths(e.output)) {
                  next = ensureAttachmentBlock(next, p)
                }
              }
              return next
            },
            laneId,
            { urgent: true }
          )
          if (attachPath && (!laneId || cid === activeIdRef.current)) {
            openFilePreview({
              path: attachPath,
              name: filePreviewBasename(attachPath),
              source: 'tool',
              toolName: e.name
            })
          } else if (
            e.status === 'done' &&
            e.output &&
            (!laneId || cid === activeIdRef.current)
          ) {
            const imgs = extractLocalImagePaths(e.output)
            const last = imgs[imgs.length - 1]
            if (last) {
              openFilePreview({
                path: last,
                name: filePreviewBasename(last),
                source: 'tool',
                toolName: e.name
              })
            }
          }
        }
        break
      case 'command':
        noteActiveWork(cid, e.status, laneId)
        {
          const delivered: string[] = []
          if (e.status === 'done' && (e.exitCode == null || e.exitCode === 0)) {
            const seen = new Set<string>()
            const pushDelivered = (raw: string): void => {
              const key = canonicalLocalPath(raw)
              if (!key || seen.has(key) || !DELIVERABLE_FILE_EXT_RE.test(key)) return
              if (!isResultFilePath(key)) return
              seen.add(key)
              delivered.push(key)
            }
            for (const p of extractShellOutputPaths(e.command || '')) pushDelivered(p)
            // node 脚本里写死的绝对路径（如 …/报告.docx）也要交付
            for (const p of extractDocumentPathsFromText(
              `${e.command || ''}\n${e.output || ''}`
            )) {
              pushDelivered(p)
            }
          }
          const previewPath = delivered[delivered.length - 1] || null
          patchStreaming(
            cid,
            (b) => {
              let next = upsertBlock(b, {
                kind: 'command',
                id: e.id,
                command: e.command,
                output: e.output,
                exitCode: e.exitCode,
                status: e.status
              })
              if (e.status === 'done' && (e.exitCode == null || e.exitCode === 0)) {
                for (const p of delivered) next = ensureAttachmentBlock(next, p)
                for (const p of extractLocalImagePaths(e.output || '')) {
                  next = ensureAttachmentBlock(next, p)
                }
                const images = extractRemoteImageUrls(e.output || '')
                if (images.length) next = ensureImageMarkdown(next, images)
              }
              return next
            },
            laneId,
            { urgent: true }
          )
          if (previewPath && (!laneId || cid === activeIdRef.current)) {
            openFilePreview({
              path: previewPath,
              name: filePreviewBasename(previewPath),
              source: 'command'
            })
          } else if (
            e.status === 'done' &&
            (e.exitCode == null || e.exitCode === 0) &&
            (!laneId || cid === activeIdRef.current)
          ) {
            const imgs = extractLocalImagePaths(e.output || '')
            const last = imgs[imgs.length - 1]
            if (last) {
              openFilePreview({
                path: last,
                name: filePreviewBasename(last),
                source: 'command'
              })
            }
          }
        }
        break
      case 'skills': {
        const text = formatSkillReportText({
          mode: e.mode,
          injected: e.injected,
          missing: e.missing,
          truncated: e.truncated
        })
        if (!text.trim()) break
        patchStreaming(
          cid,
          (b) => [
            ...b.filter((x) => x.kind !== 'skill'),
            {
              kind: 'skill' as const,
              mode: e.mode,
              injected: e.injected,
              missing: e.missing,
              truncated: e.truncated,
              text
            }
          ],
          laneId,
          { urgent: true }
        )
        break
      }
      case 'error': {
        // 原始 stderr / HTTP JSON 不能直接甩给用户：翻成人话 + 下一步，再留一份原文排查
        const conv = conversationsRef.current.find((c) => c.id === cid)
        const info = describeAgentError(e.message, engineFromAgentEvent(e, conv, laneId))
        patchStreaming(cid, (b) => [...b, { kind: 'text', text: formatAgentErrorNotice(info) }], laneId, {
          urgent: true
        })
        setErrorByConv((prev) => ({ ...prev, [cid]: info }))
        attachRunUsage(cid, laneId, e.usage)
        if (!laneId) appendReplySticker(cid)
        endStream(cid, laneId)
        if (!laneId) cancelStreamTts(cid)
        if (quickStripTtsCidRef.current === cid) quickStripTtsCidRef.current = null
        break
      }
      case 'done':
        patchStreaming(
          cid,
          (blocks) => applyDoneResult(finalizeAssistantBlocks(blocks), e.result),
          laneId,
          { urgent: true }
        )
        if (!laneId || cid === activeIdRef.current) {
          const fromResult = extractLocalImagePaths(typeof e.result === 'string' ? e.result : '')
          const last = fromResult[fromResult.length - 1]
          if (last) {
            openFilePreview({
              path: last,
              name: filePreviewBasename(last),
              source: 'attachment'
            })
          }
        }
        attachRunUsage(cid, laneId, e.usage)
        if (!laneId) appendReplySticker(cid)
        endStream(cid, laneId)
        if (!laneId) endStreamTts(cid)
        if (quickStripTtsCidRef.current === cid) quickStripTtsCidRef.current = null
        break
      case 'aborted':
        patchStreaming(cid, finalizeAssistantBlocks, laneId, { urgent: true })
        attachRunUsage(cid, laneId, e.usage)
        // 用户停止：保留暂存队列，不自动发下一条
        endStream(cid, laneId, { drainQueue: false })
        if (!laneId) cancelStreamTts(cid)
        else stopTtsPlayback()
        if (quickStripTtsCidRef.current === cid) quickStripTtsCidRef.current = null
        break
    }
  }

  function shouldStreamTts(conversationId: string): boolean {
    if (!ttsEnabledRef.current) return false
    const conv = conversationsRef.current.find((c) => c.id === conversationId)
    if (!conv || conv.kind === 'compare') return false
    if (!resolveConvTtsAutoSpeak(conv, ttsAutoSpeakDefaultRef.current)) return false
    // 快问条代发：对话窗未聚焦时让宠边播；聚焦后聊天窗夺权
    if (quickStripTtsCidRef.current === conversationId && !document.hasFocus()) {
      return false
    }
    return true
  }

  /** 流式正文 delta → 短句 TTS（与生成同步推进）。 */
  function feedStreamTts(conversationId: string, delta: string): void {
    if (!delta || !shouldStreamTts(conversationId)) return
    let ctrl = streamTtsRef.current.get(conversationId)
    if (ctrl?.active) {
      // done 之后仍可能有 ensureFinalText 迟到 delta：续用同一控制器，绝不能 new（new 会 halt 掐断）
      if (ctrl.finishing) ctrl.reopenForLateDelta()
      ctrl.push(delta)
      return
    }
    // 仅在无可用控制器时新建。发新消息前 send 已 stopTtsPlayback；此处禁止 halt。
    ctrl = new StreamTtsController(undefined, {
      maxInFlight: 1,
      role: 'chat',
      conversationId,
      haltExisting: false
    })
    streamTtsRef.current.set(conversationId, ctrl)
    ctrl.push(delta)
  }

  function endStreamTts(conversationId: string): void {
    const ctrl = streamTtsRef.current.get(conversationId)
    if (ctrl?.active) {
      const spoken = ctrl.spokenChars
      ctrl.end()
      // 不要立刻 delete：迟到 delta / 未完成合成还要靠它；idle 后再摘掉
      void ctrl.whenSynthIdle().then(() => {
        if (streamTtsRef.current.get(conversationId) === ctrl) {
          streamTtsRef.current.delete(conversationId)
        }
      })
      if (spoken > 0) return
      // 还在攒字、尚未抽出：等 idle 后若仍无声再兜底
      void ctrl.whenSynthIdle().then(() => {
        if (ctrl.spokenChars > 0) return
        if (streamTtsRef.current.get(conversationId) === ctrl) return
        fallbackSpeakReply(conversationId)
      })
      return
    }
    fallbackSpeakReply(conversationId)
  }

  function cancelStreamTts(conversationId: string): void {
    const ctrl = streamTtsRef.current.get(conversationId)
    if (ctrl) {
      ctrl.cancel()
      streamTtsRef.current.delete(conversationId)
    } else {
      stopTtsPlayback()
    }
  }

  function fallbackSpeakReply(conversationId: string): void {
    if (!shouldStreamTts(conversationId)) return
    // 已有流式控制器在干活时禁止点播：speakTextWithTts 会 new 控制器并 halt，造成「播一点被掐断」
    const living = streamTtsRef.current.get(conversationId)
    if (living?.active) return
    const conv = conversationsRef.current.find((c) => c.id === conversationId)
    if (!conv) return
    const last = [...conv.messages].reverse().find((m) => m.role === 'assistant')
    const text = last ? assistantReplyText(last) : ''
    if (!text.trim()) return
    void speakTextWithTts(text).catch((err) => {
      console.warn('[tts] fallback speak failed', err)
    })
  }

  function attachRunUsage(
    conversationId: string,
    laneId: string | undefined,
    usage?: AgentRunUsage
  ): void {
    if (!usage || !formatRunUsage(usage)) return
    const mid =
      streamsRef.current.get(makeStreamKey(conversationId, laneId)) ||
      (!laneId ? undefined : streamsRef.current.get(makeStreamKey(conversationId)))
    if (!mid) return
    updateConv(conversationId, (c) => {
      if (laneId && c.kind === 'compare') {
        const prev = c.lanes?.[laneId]
        if (!prev) return c
        return {
          ...c,
          lanes: {
            ...c.lanes,
            [laneId]: {
              ...prev,
              messages: prev.messages.map((m) => (m.id === mid ? { ...m, runUsage: usage } : m))
            }
          }
        }
      }
      return {
        ...c,
        messages: c.messages.map((m) => (m.id === mid ? { ...m, runUsage: usage } : m))
      }
    })
  }
  handleEventRef.current = handleEvent

  function appendReplySticker(conversationId: string): void {
    const mid = streamsRef.current.get(makeStreamKey(conversationId))
    if (!mid) return
    updateConv(conversationId, (c) => {
      if (c.kind === 'compare') return c
      return {
        ...c,
        messages: c.messages.map((m) => {
          if (m.id !== mid) return m
          const text = m.blocks
            .filter((b) => b.kind === 'text' || b.kind === 'reasoning')
            .map(blockText)
            .join('\n')
          const sticker = pickStickerForText(text, stickerPoolRef.current)
          if (m.blocks.some((b) => b.kind === 'sticker' && b.id === sticker.id && b.image === sticker.image))
            return m
          return {
            ...m,
            blocks: [
              ...m.blocks,
              {
                kind: 'sticker' as const,
                id: sticker.id,
                emoji: sticker.emoji,
                label: sticker.label,
                image: sticker.image
              }
            ]
          }
        }),
        updatedAt: Date.now()
      }
    })
  }

  /** 后台 session 按 thread 绑；没有就先落一条。RSS 按当前条目 + 清空 epoch 隔离。 */
  function resolveSendThreadId(conv: Conversation): string {
    const next = conv.kind === 'rss' ? conv : ensureTaskThreads(conv)
    if (next !== conv) updateConv(conv.id, () => next)
    return resolveConversationThreadId({ conversationId: next.id }, next)
  }

  async function send(
    prompt: string,
    attachments: ChatAttachment[] = [],
    skills: string[] = [],
    opts?: {
      conversationId?: string
      models?: string[]
      /** 对比：只发给这些列（FIFO 追赶/不等慢列） */
      laneIds?: string[]
      /** 对比：是否追加新的用户轮；false = 补跑已有用户轮 */
      addUserMessage?: boolean
      /** 对比补跑：回答 users[catchUpTurnIndex] */
      catchUpTurnIndex?: number
      source?: ChatMessage['source']
      summaryMeta?: ChatMessage['summaryMeta']
      /** 气泡仍用 prompt；引擎多看这一段（工作台引用等）。 */
      enginePrefix?: string
    }
  ): Promise<boolean> {
    const addUserMessage = opts?.addUserMessage !== false
    const isCatchUp = !addUserMessage
    if (!isCatchUp && !prompt.trim() && !attachments.length && !skills.length) return false
    const cid = opts?.conversationId ?? activeId
    const conv = conversationsRef.current.find((c) => c.id === cid) ?? null
    if (!conv) return false
    const sendThreadId = resolveSendThreadId(conv)
    if ((!conv.kind || conv.kind === 'chat') && !isTodayQuickTask(conv)) setLastChatInteractedId(cid)
    // 发新消息不再清空文件列表：列表覆盖本对话记录全文
    // 单聊仍互斥；对比按列并行，允许其它列还在跑时开下一轮
    if (conv.kind !== 'compare' && isStreamingInMap(streamsRef.current, conv.id)) return false
    stopTtsPlayback()

    // RSS：须先选条目；引擎带该条上下文，气泡只留用户原话；讨论按条独立
    let enginePrompt = opts?.enginePrefix?.trim()
      ? `${opts.enginePrefix.trim()}\n\n${prompt}`
      : prompt
    let remoteImages: string[] | undefined
    if (conv.kind === 'rss' && addUserMessage) {
      if (!conv.rss?.selectedId) {
        window.alert(uiText("请先从左侧选一条订阅，再提问。"))
        return false
      }
      // 新提问时确保讨论栏打开
      if (conv.rss.discussionPanel !== 'show') {
        updateConv(cid, (c) =>
          c.kind === 'rss' && c.rss
            ? { ...c, rss: { ...c.rss, discussionPanel: 'show' }, updatedAt: Date.now() }
            : c
        )
      }
      // 条目讨论：必须先拿到链接正文；抓页失败再试模型整理，仍无正文则拒发（禁止只靠标题瞎编）
      let rssForCtx = conv.rss
      if (rssForCtx.readerMode !== 'digest') {
        const entry = selectedRssEntry(rssForCtx)
        // 讨论需要抓取原文；仅有整理版时也再补抓一次原文
        if (entry?.url && !rssEntryHasSourceBody(entry)) {
          let html = ''
          let partial = false
          let title = entry.title
          let fromModel = false
          try {
            const r = await window.petApi.fetchRssArticle(entry.url, {
              fallbackHtml:
                rssEntrySourceHtml(entry) ||
                entry.contentHtml ||
                (entry.snippet?.trim() ? `<p>${entry.snippet.trim()}</p>` : undefined)
            })
            if (r.ok && r.html) {
              html = r.html
              partial = !!r.partial
              title = entry.title || r.title || entry.title
            }
          } catch {
            /* try model recover below */
          }
          if (!html.trim() && typeof window.petApi.recoverRssArticleWithModel === 'function') {
            try {
              const recovered = await window.petApi.recoverRssArticleWithModel({
                url: entry.url,
                title: entry.title,
                snippet: entry.snippet,
                contentHtml: rssEntrySourceHtml(entry) || entry.contentHtml
              })
              if (recovered?.ok && recovered.html) {
                html = recovered.html
                partial = recovered.mode !== 'extract'
                fromModel = recovered.mode === 'model'
                title = entry.title || recovered.title || entry.title
              }
            } catch {
              /* ignore */
            }
          }
          if (html.trim()) {
            updateConv(cid, (c) => {
              if (c.kind !== 'rss' || !c.rss) return c
              return {
                ...c,
                rss: {
                  ...c.rss,
                  items: c.rss.items.map((x) => {
                    if (x.id !== entry.id) return x
                    const titled = { ...x, title: title || x.title }
                    return fromModel
                      ? withRssModelHtml(titled, html)
                      : withRssExtractHtml(titled, html, partial ? 'feed' : 'extract')
                  }),
                  updatedAt: Date.now()
                },
                updatedAt: Date.now()
              }
            })
            rssForCtx =
              conversationsRef.current.find((c) => c.id === cid)?.rss ?? rssForCtx
          } else if (!rssEntryHasUsableBody(entry)) {
            window.alert(
              uiText("还没抓到这篇的网页正文，无法讨论。请先在阅读区点「用模型整理」或换一篇有正文的条目。")
            )
            return false
          }
        }
      }
      const ctx = buildRssAskContext(rssForCtx)
      if (ctx) enginePrompt = `${ctx}\n\n【用户】\n${prompt}`
      remoteImages = rssAskRemoteImageUrls(rssForCtx)
    } else if (conv.kind === 'rss') {
      remoteImages = rssAskRemoteImageUrls(conv.rss)
    }


    const sendModel = conv.modelRef || defaultModelRef
    const agentish =
      conv.kind === 'compare'
        ? getCompareLanes(conv).some((l) => isAgentModelRef(modelProviders, l.modelId))
        : isAgentModelRef(modelProviders, sendModel)
    const demoish =
      conv.kind === 'compare'
        ? getCompareLanes(conv).some(
            (l) => resolveRunMode(status, modelProviders, l.modelId) === 'demo'
          )
        : resolveRunMode(status, modelProviders, sendModel) === 'demo'
    const effectiveCwd = conv.cwd ?? defaultCwdRef.current
    if (agentish && !isSafeAgentCwd(effectiveCwd, homeDirRef.current || homeDir)) {
      window.alert(UNSAFE_CWD_MESSAGE)
      return false
    }
    if (demoish && !demoSendOkRef.current) {
      if (!window.confirm(DEMO_SEND_CONFIRM)) return false
      demoSendOkRef.current = true
    }
    dismissError(conv.id)

    const existingUsers = conv.messages.filter((m) => m.role === 'user')
    let turnPrompt = prompt
    let turnEnginePrompt = enginePrompt
    let turnAttachments = attachments
    let turnSkills = skills
    if (isCatchUp) {
      const idx = opts?.catchUpTurnIndex ?? existingUsers.length - 1
      const userTurn = existingUsers[idx]
      if (!userTurn) return false
      turnPrompt = messageUserPrompt(userTurn)
      turnEnginePrompt = turnPrompt
      turnAttachments = messageAttachments(userTurn)
      turnSkills = []
      if (!turnPrompt.trim() && !turnAttachments.length) return false
    }

    // 快问 IPC 等路径常不带 preview：发送前补齐，气泡才能直接出图
    if (turnAttachments.length) {
      turnAttachments = await Promise.all(
        turnAttachments.map(async (a) => {
          if (a.preview) return a
          const image =
            a.mime?.startsWith('image/') ||
            /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path || a.name || '')
          if (!image) return a
          try {
            const preview = await window.petApi.previewAttachment(a.path)
            return preview ? { ...a, preview } : a
          } catch {
            return a
          }
        })
      )
    }

    // 用户手选 skill（气泡展示）vs 发送时按附件补齐的 skill（仅进引擎，去重）
    const userSkills = [...new Set((turnSkills || []).map((s) => s.trim()).filter(Boolean))]
    let engineSkills = userSkills
    if (turnAttachments.length) {
      try {
        const catalog = await window.petApi.listSkills(effectiveCwd)
        const engineHint =
          parseModelRef(conv.modelRef || defaultModelRef).provider ||
          status?.backend ||
          undefined
        const known = catalog
          .filter((s) => skillUsableOnEngine(s, engineHint))
          .map((s) => s.id)
        engineSkills = mergeAttachmentSkills(userSkills, turnAttachments, known)
      } catch {
        /* 列技能失败不阻断发送 */
      }
    }
    turnSkills = engineSkills

    const displayPrompt = applySkillsToPrompt(
      turnPrompt.trim() || (userSkills.length ? '按所选技能执行。' : ''),
      userSkills
    )
    const finalPrompt = applySkillsToPrompt(
      turnEnginePrompt.trim() ||
        (userSkills.length
          ? '按所选技能执行。'
          : turnAttachments.length
            ? '请查看这些附件并给出说明。'
            : engineSkills.length
              ? '按所选技能执行。'
              : ''),
      engineSkills
    )
    const blocks: ChatBlock[] = []
    for (const a of turnAttachments) {
      blocks.push({
        kind: 'attachment',
        path: a.path,
        name: a.name,
        mime: a.mime,
        preview: a.preview
      })
    }
    // 气泡用短文案；发给引擎的是 finalPrompt（可含 RSS 上下文）
    if (displayPrompt.trim()) blocks.push({ kind: 'text', text: displayPrompt })
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      blocks,
      createdAt: Date.now(),
      ...(opts?.source ? { source: opts.source } : {}),
      ...(opts?.summaryMeta ? { summaryMeta: opts.summaryMeta } : {})
    }
    stickScrollToBottom()
    const useTitle =
      conv.title === '新对话' || conv.title === '模型对比' || conv.title === 'RSS 订阅'
    const titleSeed = turnPrompt || turnSkills[0] || turnAttachments[0]?.name || '附件'

    if (conv.kind === 'compare') {
      const allLanes = getCompareLanes(conv)
      let targetLanes = allLanes
      if (opts?.laneIds?.length) {
        const want = new Set(opts.laneIds)
        targetLanes = allLanes.filter((l) => want.has(l.id))
      } else if (opts?.models?.length) {
        const refs = opts.models
        const used = new Set<string>()
        targetLanes = []
        for (const ref of refs) {
          const match = allLanes.find((l) => l.modelId === ref && !used.has(l.id))
          if (match) {
            used.add(match.id)
            targetLanes.push(match)
          }
        }
      } else if (!isCatchUp) {
        // 默认只发给空闲且已对齐的列，慢列稍后自己补
        const ready = new Set(compareReadyLaneIds(conv))
        targetLanes = allLanes.filter((l) => ready.has(l.id))
      }
      targetLanes = targetLanes.filter((l) => !isLaneBusy(conv.id, l.id))
      if (isCatchUp) {
        const idx = opts?.catchUpTurnIndex ?? existingUsers.length - 1
        targetLanes = targetLanes.filter(
          (l) => (conv.lanes?.[l.id]?.messages.length ?? 0) === idx
        )
      } else {
        targetLanes = targetLanes.filter(
          (l) => (conv.lanes?.[l.id]?.messages.length ?? 0) === existingUsers.length
        )
      }
      if (targetLanes.length < 1) return false

      const assistants = targetLanes.map((laneRef) => ({
        laneId: laneRef.id,
        modelRef: laneRef.modelId,
        msg: {
          id: uid(),
          role: 'assistant' as const,
          blocks: [] as ChatBlock[],
          createdAt: Date.now(),
          modelId: laneRef.modelId
        }
      }))
      // 先同步插入各列 assistant 占位，再 beginStream / IPC——避免快返回引擎的 delta/done 打空
      updateConv(conv.id, (c) => {
        const lanes = { ...(c.lanes ?? {}) }
        const baseUsers = c.messages.filter((m) => m.role === 'user').length
        const userCount = addUserMessage ? baseUsers + 1 : baseUsers
        for (const a of assistants) {
          const prev = lanes[a.laneId] ?? { modelId: a.modelRef, messages: [] }
          const padded = [...prev.messages]
          // 只补齐到本轮之前；不给仍在跑的慢列盖「未参与」
          while (padded.length < userCount - 1) {
            padded.push({
              id: uid(),
              role: 'assistant',
              blocks: [{ kind: 'text', text: '（本轮未参与）' }],
              createdAt: Date.now(),
              modelId: a.modelRef
            })
          }
          if (padded.length === userCount - 1) padded.push(a.msg)
          else if (padded.length >= userCount) padded[userCount - 1] = a.msg
          else padded.push(a.msg)
          lanes[a.laneId] = { ...prev, modelId: a.modelRef, messages: padded }
        }
        return {
          ...c,
          title: useTitle ? deriveTitle(titleSeed) : c.title,
          messages: addUserMessage
            ? [
                ...(c.messages.length > 400 ? c.messages.slice(-400) : c.messages),
                userMsg
              ]
            : c.messages,
          lanes,
          updatedAt: Date.now()
        }
      })
      for (const a of assistants) beginStream(conv.id, a.msg.id, a.laneId)

      const historyUsers = addUserMessage
        ? existingUsers
        : existingUsers.slice(0, opts?.catchUpTurnIndex ?? existingUsers.length - 1)
      const compareRuns = assistants.map((a) => ({
        laneId: a.laneId,
        model: a.modelRef,
        sessionId: conv.lanes?.[a.laneId]?.sessionId,
        history: buildCompareLaneApiHistory(
          historyUsers,
          conv.lanes?.[a.laneId]?.messages?.slice(0, historyUsers.length)
        )
      }))
      // 不 await：对比 IPC 会等 Promise.all 所有列；按列 FIFO 必须立刻返回
      void window.petApi
        .sendPrompt({
          prompt: finalPrompt,
          conversationId: conv.id,
          threadId: sendThreadId,
          cwd: effectiveCwd,
          attachments: turnAttachments.map((a) => ({
            path: a.path,
            name: a.name,
            mime: a.mime
          })),
          remoteImages,
          skills: turnSkills,
          systemPrompt: conv.systemPrompt,
          enableThinking: resolveConvThinking(modelProviders, conv, defaultModelRef),
          agentAutonomy: resolveConvAutonomy(conv),
          compareRuns
        })
        .then((res) => {
          if (res.ok) return
          for (const a of assistants) {
            handleEvent({
              type: 'error',
              message: res.error ?? '发送失败',
              conversationId: conv.id,
              laneId: a.laneId,
              modelId: a.modelRef
            })
          }
        })
      return true
    }

    const assistantMsg: ChatMessage = { id: uid(), role: 'assistant', blocks: [], createdAt: Date.now() }
    updateConv(conv.id, (c) => ({
      ...c,
      title: useTitle ? deriveTitle(titleSeed) : c.title,
      messages: [...(c.messages.length > 400 ? c.messages.slice(-400) : c.messages), userMsg, assistantMsg],
      updatedAt: Date.now()
    }))
    beginStream(conv.id, assistantMsg.id)
    const model = sendModel
    if (!conv.modelRef) {
      updateConv(conv.id, (c) => ({ ...c, modelRef: model }))
    }
    // Codex 只吃 UUID thread；换模型残留的假 session 在发送前清掉
    const sendProvider = parseModelRef(model).provider
    let sendSessionId = conv.sessionId
    if (sendProvider === 'codex' && !isCodexResumableSessionId(sendSessionId)) {
      sendSessionId = undefined
      if (conv.sessionId) updateConv(conv.id, (c) => ({ ...c, sessionId: undefined }))
    }
    const res = await window.petApi.sendPrompt({
      prompt: finalPrompt,
      conversationId: conv.id,
      threadId: sendThreadId,
      sessionId: sendSessionId,
      cwd: effectiveCwd,
      attachments: turnAttachments.map((a) => ({ path: a.path, name: a.name, mime: a.mime })),
      remoteImages,
      skills: turnSkills,
      model,
      systemPrompt: conv.systemPrompt,
      enableThinking: resolveConvThinking(modelProviders, conv, defaultModelRef),
      agentAutonomy: resolveConvAutonomy(conv),
      history: buildChatApiHistory(conv.messages)
    })
    if (!res.ok) {
      handleEvent({
        type: 'error',
        message: res.error ?? '发送失败',
        conversationId: conv.id
      })
    }
    // 终态以 agent 事件为准。Cursor 已 await 子进程结束；其它 CLI 可能仍早返回。
    // 绝不能在 invoke 返回时补发 done。
    return true
  }

  function stop(): void {
    if (!activeId || !active) return
    // 即使 streamingIds 状态偶发不同步，也允许停止解锁
    const wasStreaming = isConvStreaming(streamingIds, activeId)

    if (active.kind === 'compare') {
      void window.petApi.cancel(activeId)
      // 手动停止：保留已生成内容与暂存，不自动发送下一条
      endStream(activeId, undefined, { drainQueue: false })
      return
    }

    const msgs = active.messages
    const last = msgs[msgs.length - 1]
    const prev = msgs[msgs.length - 2]
    const assistantHasContent =
      last?.role === 'assistant' &&
      last.blocks.some(
        (b) =>
          ((b.kind === 'text' || b.kind === 'reasoning' || b.kind === 'status') &&
            b.text.trim()) ||
          b.kind === 'tool' ||
          b.kind === 'command'
      )

    void window.petApi.cancel(activeId)
    // 手动停止：保留暂存，不自动发送下一条
    endStream(activeId, undefined, { drainQueue: false })

    // 已有可见回复时绝不能撤回消息（用户卡在「生成中」点停止会丢内容）
    if (assistantHasContent || !wasStreaming) return

    // 仅当助手气泡仍为空时，才把 user 撤回到输入框
    if (last?.role === 'assistant' && prev?.role === 'user') {
      const restoreText = messageUserPrompt(prev)
      const restoreAttachments = messageAttachments(prev)
      updateConv(activeId, (c) => ({
        ...c,
        messages: c.messages.slice(0, msgs.length - 2),
        updatedAt: Date.now()
      }))
      if (restoreText || restoreAttachments.length) {
        restoreDraft(activeId, { text: restoreText, attachments: restoreAttachments })
      }
    }
  }

  function clearChat(): void {
    if (busy || !active) return
    const hasContent =
      active.messages.length > 0 ||
      Object.values(active.lanes ?? {}).some((l) => l.messages.length > 0)
    if (hasContent && !confirmDestructive(uiText("确定清空当前任务的全部对话？此操作不可撤销。"))) {
      return
    }
    clearConvQueue(active.id)
    dismissError(active.id)
    // 必须换新 thread id，否则 部分引擎后台 session 会按旧 label 续上整段上下文
    updateConv(active.id, (c) => clearAllTaskThreads(c))
    if (active.kind === 'compare') setSelectedReplies(new Set())
  }

  function toggleReplyPick(laneId: string, messageId: string): void {
    const key = `${laneId}::${messageId}`
    setSelectedReplies((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function copyLane(laneId: string): void {
    if (!active?.lanes?.[laneId]) return
    const text = active.lanes[laneId].messages
      .map((m) => assistantCopyText(m))
      .filter(Boolean)
      .join('\n\n---\n\n')
    if (text) void writeClipboardText(text)
  }

  async function rerunLane(laneId: string): Promise<void> {
    if (!active || active.kind !== 'compare') return
    // 只挡本列 busy；其它列还在跑也可以重跑空闲列
    if (isLaneBusy(active.id, laneId)) return
    const laneRef = getCompareLanes(active).find((l) => l.id === laneId)
    const modelRef = active.lanes?.[laneId]?.modelId ?? laneRef?.modelId
    if (!modelRef) return
    const effectiveCwd = active.cwd ?? defaultCwdRef.current
    if (
      isAgentModelRef(modelProviders, modelRef) &&
      !isSafeAgentCwd(effectiveCwd, homeDirRef.current || homeDir)
    ) {
      window.alert(UNSAFE_CWD_MESSAGE)
      return
    }
    if (
      resolveRunMode(status, modelProviders, modelRef) === 'demo' &&
      !demoSendOkRef.current
    ) {
      if (!window.confirm(DEMO_SEND_CONFIRM)) return
      demoSendOkRef.current = true
    }
    const users = active.messages.filter((m) => m.role === 'user')
    const lastUser = users[users.length - 1]
    if (!lastUser) return
    const prompt = messageUserPrompt(lastUser)
    const attachments = messageAttachments(lastUser)
    if (!prompt.trim() && !attachments.length) return
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      blocks: [],
      createdAt: Date.now(),
      modelId: modelRef
    }
    beginStream(active.id, assistantMsg.id, laneId)
    updateConv(active.id, (c) => {
      const lane = c.lanes?.[laneId] ?? { modelId: modelRef, messages: [] }
      const msgs = [...lane.messages]
      if (msgs.length >= users.length) msgs[users.length - 1] = assistantMsg
      else msgs.push(assistantMsg)
      return {
        ...c,
        lanes: { ...c.lanes, [laneId]: { ...lane, messages: msgs } },
        updatedAt: Date.now()
      }
    })
    const res = await window.petApi.sendPrompt({
      prompt,
      conversationId: active.id,
      threadId: resolveSendThreadId(active),
      cwd: effectiveCwd,
      attachments: attachments.map((a) => ({ path: a.path, name: a.name, mime: a.mime })),
      model: modelRef,
      laneId,
      sessionId: active.lanes?.[laneId]?.sessionId,
      systemPrompt: active.systemPrompt,
      enableThinking: resolveConvThinking(modelProviders, active, defaultModelRef),
      agentAutonomy: resolveConvAutonomy(active),
      history: buildCompareLaneApiHistory(
        users.slice(0, -1),
        active.lanes?.[laneId]?.messages?.slice(0, users.length - 1)
      )
    })
    if (!res.ok) {
      handleEvent({
        type: 'error',
        message: res.error ?? '发送失败',
        conversationId: active.id,
        laneId,
        modelId: modelRef
      })
    }
  }

  function closeLane(laneId: string): void {
    if (!active || active.kind !== 'compare') return
    const laneList = getCompareLanes(active)
    if (laneList.length <= 1) return
    const lane = active.lanes?.[laneId]
    const busyLane = streamingIds.has(`${active.id}::${laneId}`)
    if (busyLane || (lane && lane.messages.length > 0)) {
      const tip = busyLane
        ? '该列仍在生成，关闭将丢弃结果。确定关闭？'
        : '确定关闭此列？该列的回复将丢失。'
      if (!confirmDestructive(tip)) return
      if (busyLane) void window.petApi.cancel(active.id, laneId)
    }
    // 不等 aborted：关列必须立刻解锁该 lane，避免整页 busy 残留
    if (busyLane) endStream(active.id, laneId, { drainQueue: false })
    updateConv(active.id, (c) => {
      const compareLanes = (c.compareLanes ?? []).filter((l) => l.id !== laneId)
      const lanes = { ...(c.lanes ?? {}) }
      delete lanes[laneId]
      return { ...c, compareLanes, lanes, updatedAt: Date.now() }
    })
    setSelectedReplies((prev) => {
      const next = new Set<string>()
      for (const k of prev) {
        if (!k.startsWith(`${laneId}::`)) next.add(k)
      }
      return next
    })
  }

  function changeLaneModel(laneId: string, newModelRef: string): void {
    if (!active || active.kind !== 'compare') return
    updateConv(active.id, (c) => {
      const compareLanes = (c.compareLanes ?? []).map((l) =>
        l.id === laneId ? { ...l, modelId: newModelRef } : l
      )
      const lane = c.lanes?.[laneId] ?? { modelId: newModelRef, messages: [] }
      return {
        ...c,
        compareLanes,
        lanes: {
          ...c.lanes,
          [laneId]: {
            ...lane,
            modelId: newModelRef,
            messages: lane.messages.map((m) => ({ ...m, modelId: newModelRef }))
          }
        },
        updatedAt: Date.now()
      }
    })
  }

  function addLane(): void {
    if (!active || active.kind !== 'compare') return
    const enabled = flattenEnabledRefs(modelProviders)
    if (!enabled.length) return
    const firstRef = enabled[0].ref
    const laneId = newLaneId()
    updateConv(active.id, (c) => {
      const compareLanes = [...(c.compareLanes ?? []), { id: laneId, modelId: firstRef }]
      const userCount = c.messages.filter((m) => m.role === 'user').length
      const placeholders: ChatMessage[] = []
      for (let i = 0; i < userCount; i++) {
        placeholders.push({
          id: uid(),
          role: 'assistant',
          blocks: [{ kind: 'text', text: '（本轮未参与）' }],
          createdAt: Date.now(),
          modelId: firstRef
        })
      }
      return {
        ...c,
        compareLanes,
        lanes: {
          ...c.lanes,
          [laneId]: { modelId: firstRef, messages: placeholders }
        },
        updatedAt: Date.now()
      }
    })
    setCompareColumns((n) =>
      Math.min(6, Math.max(n, getCompareLanes(active).length + 1)) as CompareColumns
    )
  }

  function confirmSummary(extraNote?: string): void {
    if (!active || active.kind !== 'compare' || !selectedReplies.size) return
    const note = (extraNote || '').trim()
    const users = active.messages.filter((m) => m.role === 'user')

    type Cand = {
      round: number
      question: string
      label: string
      modelRef: string
      reply: string
    }
    const cands: Cand[] = []
    for (const key of selectedReplies) {
      const sep = key.indexOf('::')
      const laneId = key.slice(0, sep)
      const msgId = key.slice(sep + 2)
      const laneMsgs = active.lanes?.[laneId]?.messages ?? []
      const round = laneMsgs.findIndex((m) => m.id === msgId)
      if (round < 0) continue
      const msg = laneMsgs[round]
      const reply = assistantReplyText(msg)
      if (!reply || reply === '（本轮未参与）') continue
      const modelRef = active.lanes?.[laneId]?.modelId ?? ''
      cands.push({
        round,
        question: compareRoundQuestionLabel(users[round]),
        label: modelRefLabel(modelProviders, modelRef),
        modelRef,
        reply
      })
    }
    if (!cands.length) return

    // 按原题轮次分组，保证「问题 ↔ 回答」一一对应（不再拆成两段无关列表）
    const byRound = new Map<number, Cand[]>()
    for (const c of cands) {
      const list = byRound.get(c.round) ?? []
      list.push(c)
      byRound.set(c.round, list)
    }
    const rounds = [...byRound.keys()].sort((a, b) => a - b)
    const multiRound = rounds.length > 1
    const parts: string[] = []
    parts.push('以下材料已按「原题 → 该题下的候选回答」配对，请严格对照，勿串题。')
    parts.push('')

    for (const round of rounds) {
      const list = byRound.get(round)!
      const q = list[0]?.question || '（未知问题）'
      if (multiRound) {
        parts.push(`## 原题 ${round + 1}`)
      } else {
        parts.push('## 原题')
      }
      parts.push(q)
      parts.push('')
      parts.push('### 候选回答')
      for (const c of list) {
        parts.push(`#### ${c.label} (\`${c.modelRef}\`)`)
        parts.push(c.reply)
        parts.push('')
      }
    }

    // 任务放最后：长候选文后更不容易丢用户指令
    parts.push('## 任务')
    if (note) {
      parts.push(note)
      parts.push('')
      parts.push('请只按上述任务作答；候选须对应其上方原题，不要串题或改写成别的题目。')
    } else if (multiRound) {
      parts.push(
        '请分别针对每一道原题，综合其下候选做汇总与取舍；不要把不同原题的答案混在一起。'
      )
    } else {
      parts.push('请根据以上候选回答做汇总与取舍，给出更优、更完整的最终答复。')
    }

    setSelectedReplies(new Set())
    void send(parts.join('\n'), [], [], {
      source: 'compare-summary',
      summaryMeta: {
        candidateCount: cands.length,
        note: note || undefined
      }
    })
  }

  /** 打开设置并滚到指定分区（错误横幅 / 空态引导共用）。 */
  function openSettingsSection(sectionId: string): void {
    setSettingsMode(true)
    setMonitorMode(false)
    setScheduleMode(false)
    monitorRef.current = false
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' })
    }, 80)
  }

  function applyErrorFix(fix: AgentErrorFix): void {
    switch (fix) {
      case 'pick-dir':
        void chooseDir()
        break
      case 'engine-setup':
        openSettingsSection('settings-setup')
        break
      case 'api-config':
        openSettingsSection('settings-api')
        break
      case 'model-config':
        openSettingsSection('settings-models')
        break
    }
  }

  function dismissError(conversationId: string): void {
    setErrorByConv((prev) => {
      if (!(conversationId in prev)) return prev
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
  }

  /** 失败后原样重发最近一轮（带回附件；与消息上的「重发」同语义，追加新一轮）。 */
  function retryLastTurn(): void {
    const conv = conversationsRef.current.find((c) => c.id === activeId)
    if (!conv || conv.kind === 'compare') return
    const users = conv.messages.filter((m) => m.role === 'user')
    const last = users[users.length - 1]
    if (!last) return
    const text = messageUserPrompt(last)
    const atts = messageAttachments(last)
    if (!text && !atts.length) return
    void send(text, atts)
  }

  async function chooseDir(): Promise<void> {
    const start = active?.cwd || defaultCwdRef.current
    const dir = await window.petApi.pickWorkingDir(start)
    if (!dir || !active) return
    if (isUserHomeDir(dir, homeDirRef.current || homeDir)) {
      window.alert(UNSAFE_CWD_MESSAGE)
      return
    }
    // 只改当前任务；全局默认目录只在设置里改，避免把临时路径写成配置
    updateConv(active.id, (c) => ({ ...c, cwd: dir, sessionId: undefined }))
    rememberCwdLocal(dir)
  }

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="brand">
          <img className="brand-mark-img" src={brandIcon} alt="" aria-hidden width={22} height={22} />
          <span className="brand-title" title={appVersion ? `CPET v${appVersion}` : 'CPET'}>
            CPET
            {appVersion ? <span className="brand-ver">v{appVersion}</span> : null}
          </span>
          {headerUpdate?.status === 'update-available' && headerUpdate.latest ? (
            <button
              type="button"
              className="brand-update-btn"
              title={uiText("有新版本 {0}（当前 {1}）。点击下载；右键打开详情。", [headerUpdate.latest, headerUpdate.current || appVersion])}
              aria-label={uiText("有新版本 {0}，点击下载", [headerUpdate.latest])}
              onClick={() => {
                const url = headerUpdate.downloadUrl || headerUpdate.releasesUrl
                if (url) {
                  window.petApi.openExternal(url)
                  return
                }
                setSettingsMode(true)
                setMonitorMode(false)
                setScheduleMode(false)
                setSettingsFocusSection('settings-about')
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setSettingsMode(true)
                setMonitorMode(false)
                setScheduleMode(false)
                setSettingsFocusSection('settings-about')
              }}
            >
              <span className="brand-update-arrow" aria-hidden>
                ↑
              </span>
              {uiText("更新")}{headerUpdate.latest}
            </button>
          ) : null}
        </div>
        <div className="header-actions">
          {!settingsMode && !monitorMode && !scheduleMode && (
            <button
              type="button"
              className={`badge badge-btn ${
                runMode === 'demo' ? 'badge-warn' : runMode === 'api' ? 'badge-muted' : 'badge-ok'
              }`}
              title={
                runMode === 'demo'
                  ? uiText("演示模式：点击打开设置配置真实引擎")
                  : runMode === 'api'
                    ? uiText("API 直连：点击打开设置")
                    : uiText("真实引擎：点击打开设置")
              }
              onClick={toggleSettings}
            >
              {runModeLabel(runMode)}
            </button>
          )}
          <button
            type="button"
            className="skin-chip-btn"
            title={uiText("外观 / 皮肤市场")}
            aria-label={uiText("外观与皮肤市场")}
            onClick={() => window.petApi.openSkins()}
          >
            {petImage ? (
              <img src={petImage} alt="" className="skin-chip-btn-img" />
            ) : (
              <span className="skin-chip-btn-emoji" aria-hidden>
                {SKIN_AVATAR[petSkin] ?? '🐾'}
              </span>
            )}
            <span className="skin-chip-btn-label">
              {
                describeAppearance({
                  skin: petSkin,
                  skinName: SKINS.find((s) => s.id === petSkin)?.name,
                  imageSkin: imageSkinId
                }).label
              }
            </span>
            <IconSkin size={14} />
          </button>
          <div className="header-tool-group" role="toolbar" aria-label={uiText("应用功能")}>
            <button
              type="button"
              className={`icon-btn ${settingsMode ? 'on' : ''}`}
              title={uiText("设置")}
              aria-label={uiText("设置")}
              onClick={toggleSettings}
            >
              <IconSettings />
            </button>
            <button
              type="button"
              className={`icon-btn ${scheduleMode ? 'on' : ''}`}
              title={uiText("定时任务")}
              aria-label={uiText("定时任务")}
              onClick={toggleSchedule}
            >
              <IconSchedule />
            </button>
            <button
              type="button"
              className={`icon-btn ${monitorMode ? 'on' : ''}`}
              title={uiText("联动活动")}
              aria-label={uiText("联动活动")}
              onClick={toggleMonitor}
            >
              <IconActivity />
            </button>
          </div>
          <button
            type="button"
            className="icon-btn icon-btn-close"
            title={uiText("关闭窗口 (Esc)")}
            aria-label={uiText("关闭窗口")}
            onClick={() => window.petApi.toggleChat()}
          >
            <IconClose />
          </button>
        </div>
      </header>

      {updateBanner ? (
        <UpdateBanner
          update={updateBanner}
          onDismiss={() => {
            if (updateBanner.latest) window.petApi.dismissUpdateBanner(updateBanner.latest)
            setUpdateBanner(null)
          }}
          onOpenAbout={() => {
            setSettingsMode(true)
            setMonitorMode(false)
            setScheduleMode(false)
            setSettingsFocusSection('settings-about')
          }}
        />
      ) : null}

      {runMode === 'demo' && !settingsMode && !monitorMode && !scheduleMode ? (
        <div className="demo-mode-banner" role="status">
          {uiText("演示模式：回复不会改文件、不会执行命令。请在设置里接上真实引擎或 IDE 联动。")}<button
            type="button"
            onClick={() => {
              setSettingsMode(true)
              setMonitorMode(false)
              setScheduleMode(false)
              setSettingsFocusSection('settings-setup')
            }}
          >
            {uiText("打开引擎设置")}</button>
        </div>
      ) : null}

      {exportHint && <div className="chat-toast" role="status">{exportHint}</div>}

      {!settingsMode && !monitorMode && !scheduleMode && (
        <ChatFindBar
          open={findOpen}
          query={findQuery}
          scope={findScope}
          hits={findAllHits}
          localCount={findLocalHits.length}
          onQueryChange={setFindQuery}
          onScopeChange={setFindScope}
          onClose={() => setFindOpen(false)}
          onJump={jumpSearchHit}
        />
      )}

      <div className={`chat-body ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="conv-sidebar" aria-label={uiText("任务列表")}>
          <div className="conv-side-head">
            {!sidebarCollapsed && <span className="conv-side-title">{uiText("任务")}</span>}
            <div className="conv-side-actions">
              {!sidebarCollapsed && (
                <button
                  type="button"
                  className="conv-group-add-btn"
                  title={uiText("新建分组")}
                  aria-label={uiText("新建分组")}
                  onClick={addGroup}
                >
                  {uiText("分组")}</button>
              )}
              <button
                type="button"
                className="conv-collapse-btn"
                title={sidebarCollapsed ? uiText("展开任务列表") : uiText("折叠任务列表")}
                aria-label={sidebarCollapsed ? uiText("展开任务列表") : uiText("折叠任务列表")}
                aria-expanded={!sidebarCollapsed}
                onClick={toggleSidebar}
              >
                {sidebarCollapsed ? '»' : '«'}
              </button>
            </div>
          </div>
          <div className="conv-list" role="tablist" aria-orientation="vertical">
            <button
              type="button"
              className={`conv-item today-nav${todayMode ? ' active' : ''}`}
              role="tab"
              aria-selected={todayMode}
              title={uiText("回到工作台")}
              onClick={showToday}
            >
              <span className="today-nav-mark" aria-hidden>
                {uiText("台")}</span>
              {!sidebarCollapsed && (
                <div className="conv-meta">
                  <span className="conv-title">{uiText("工作台")}</span>
                  <span className="conv-sub">
                    <span className="conv-sub-text">
                      {todayNeeds.length || todayReadCount
                        ? [
                            todayNeeds.length ? uiText("{0} 件要看", [todayNeeds.length]) : '',
                            todayReadCount ? uiText("{0} 条资讯", [todayReadCount]) : ''
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : uiText("随时回来")}
                    </span>
                  </span>
                </div>
              )}
            </button>
            {(() => {
              const renderConvItem = (c: Conversation): JSX.Element => {
                const routeHint = convRouteHint(modelProviders, c, defaultModelRef)
                const dirHint = c.cwd ? basename(c.cwd) : ''
                const needsAttention = Boolean(errorByConv[c.id])
                const canDrag = !sidebarCollapsed && editingId !== c.id
                const age = formatConversationAge(c.updatedAt || c.createdAt, ageNow)
                const titleText = `${kindPrefix(c.kind)}${c.title || uiText("新对话")}`
                const subText = dirHint ? `${routeHint} · ${dirHint}` : routeHint
                const tip = [
                  titleText,
                  routeHint,
                  dirHint || null,
                  age || null,
                  sidebarCollapsed ? null : uiText("点「钉」置顶 · 拖到分组 / 右键")
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <div
                    key={c.id}
                    className={`conv-item ${c.id === activeId && !todayMode ? 'active' : ''}${
                      needsAttention ? ' needs-attention' : ''
                    }${c.pinnedAt ? ' is-pinned' : ''}${dragConvId === c.id ? ' is-dragging' : ''}`}
                    role="tab"
                    aria-selected={c.id === activeId && !todayMode}
                    draggable={canDrag}
                    title={tip}
                    onClick={() => switchTo(c.id)}
                    onDragStart={(e) => {
                      if (!canDrag) {
                        e.preventDefault()
                        return
                      }
                      const t = e.target as HTMLElement | null
                      if (t?.closest('button, input, a, textarea')) {
                        e.preventDefault()
                        return
                      }
                      e.dataTransfer.setData('text/plain', c.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragConvId(c.id)
                      setMoveMenu(null)
                    }}
                    onDragEnd={() => {
                      setDragConvId(null)
                      setDropTargetKey(null)
                    }}
                    onContextMenu={(e) => {
                      if (sidebarCollapsed) return
                      e.preventDefault()
                      e.stopPropagation()
                      const MENU_W = 188
                      const MENU_H = 280
                      const pad = 8
                      const x = Math.min(
                        Math.max(pad, e.clientX),
                        window.innerWidth - MENU_W - pad
                      )
                      const y = Math.min(
                        Math.max(pad, e.clientY),
                        window.innerHeight - MENU_H - pad
                      )
                      setMoveMenu({ convId: c.id, x, y })
                    }}
                    style={{ ['--tab-color']: hashColor(c.id) } as CSSProperties}
                  >
                    <span className="conv-dot" />
                    {!sidebarCollapsed && (
                      <>
                        <div className="conv-meta">
                          {editingId === c.id ? (
                            <input
                              className="conv-edit"
                              value={editValue}
                              autoFocus
                              placeholder={uiText("任务名")}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') commitRename()
                                else if (e.key === 'Escape') setEditingId(null)
                              }}
                            />
                          ) : (
                            <span
                              className="conv-title"
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                startRename(c)
                              }}
                              title={uiText("双击重命名")}
                            >
                              {titleText}
                            </span>
                          )}
                          <span className="conv-sub">
                            {isConvStreaming(streamingIds, c.id) ? (
                              <span className="conv-busy" title={uiText("运行中")} />
                            ) : null}
                            <span
                              className={`conv-sub-text ${
                                c.kind === 'compare'
                                  ? 'is-compare'
                                  : c.kind === 'rss'
                                    ? 'is-rss'
                                    : isAgentModelRef(
                                          modelProviders,
                                          c.modelRef || defaultModelRef
                                        )
                                      ? 'is-agent'
                                      : 'is-api'
                              }`}
                            >
                              {subText}
                            </span>
                            {age ? (
                              <span className="conv-age" title={uiText("最近活动")}>
                                {age}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className="conv-item-actions">
                          <button
                            type="button"
                            className={`conv-pin${c.pinnedAt ? ' on' : ''}`}
                            aria-label={c.pinnedAt ? uiText("取消置顶") : uiText("置顶")}
                            title={c.pinnedAt ? uiText("取消置顶") : uiText("置顶")}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleConvPinned(c.id)
                            }}
                          >
                            {uiText("钉")}</button>
                          <button
                            type="button"
                            className="conv-close"
                            aria-label={uiText("关闭任务")}
                            title={uiText("关闭任务")}
                            onClick={(e) => {
                              e.stopPropagation()
                              closeConversation(c.id)
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </>
                    )}
                    {sidebarCollapsed && isConvStreaming(streamingIds, c.id) && (
                      <span className="conv-busy conv-busy-rail" title={uiText("运行中")} />
                    )}
                  </div>
                )
              }

              if (sidebarCollapsed) {
                return (
                  <>
                    {conversationPartition.pinned.map(renderConvItem)}
                    {conversationPartition.ungrouped.map(renderConvItem)}
                    {conversationPartition.sections.flatMap((s) =>
                      s.conversations.map(renderConvItem)
                    )}
                  </>
                )
              }

              const showPinnedGroup =
                conversationPartition.pinned.length > 0 || Boolean(dragConvId)

              return (
                <>
                  {showPinnedGroup ? (
                    <div
                      className={`conv-group-block is-pinned${
                        dropTargetKey === 'pinned' ? ' is-drop-target' : ''
                      }${conversationPartition.pinned.length === 0 ? ' is-drop-only' : ''}`}
                      role="group"
                      aria-label={uiText("置顶")}
                      onDragOver={(e) => onGroupDragOver(e, 'pinned')}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDropTargetKey((k) => (k === 'pinned' ? null : k))
                        }
                      }}
                      onDrop={(e) => onGroupDrop(e, 'pinned')}
                    >
                      <div className="conv-group-head">
                        <span className="conv-group-title">{uiText("置顶")}</span>
                        <span className="conv-group-count">
                          {conversationPartition.pinned.length}
                        </span>
                      </div>
                      {conversationPartition.pinned.length === 0 ? (
                        <div className="conv-group-empty">{uiText("拖到这里置顶")}</div>
                      ) : (
                        conversationPartition.pinned.map(renderConvItem)
                      )}
                    </div>
                  ) : null}
                  <div
                    className={`conv-group-block is-ungrouped${
                      dropTargetKey === 'ungrouped' ? ' is-drop-target' : ''
                    }`}
                    role="group"
                    aria-label={ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? uiText(DEFAULT_UNGROUPED_LABEL) : ungroupedLabel}
                    onDragOver={(e) => onGroupDragOver(e, 'ungrouped')}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDropTargetKey((k) => (k === 'ungrouped' ? null : k))
                      }
                    }}
                    onDrop={(e) => onGroupDrop(e, 'ungrouped')}
                  >
                    <div className="conv-group-head">
                      {editingGroupId === UNGROUPED_SECTION_ID ? (
                        <input
                          className="conv-edit conv-group-edit"
                          value={groupEditValue}
                          autoFocus
                          placeholder={DEFAULT_UNGROUPED_LABEL}
                          onChange={(e) => setGroupEditValue(e.target.value)}
                          onBlur={commitGroupRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitGroupRename()
                            else if (e.key === 'Escape') setEditingGroupId(null)
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="conv-group-title is-editable"
                          title={uiText("默认任务区，不可删除 · 点击可改显示名")}
                          onClick={() =>
                            beginGroupRename(UNGROUPED_SECTION_ID, ungroupedLabel)
                          }
                        >
                          {ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? uiText(DEFAULT_UNGROUPED_LABEL) : ungroupedLabel}
                        </button>
                      )}
                      <span className="conv-group-count">
                        {conversationPartition.ungrouped.length}
                      </span>
                    </div>
                    {conversationPartition.ungrouped.length === 0 ? (
                      <div className="conv-group-empty">
                        {uiText("默认任务区（不可删）· 拖任务到此，或右键移动")}</div>
                    ) : (
                      conversationPartition.ungrouped.map(renderConvItem)
                    )}
                  </div>
                  {conversationPartition.sections.map(({ group, conversations: items }) => {
                    const collapsed = collapsedGroupIds.has(group.id)
                    return (
                      <div
                        key={group.id}
                        className={`conv-group-block${collapsed ? ' is-collapsed' : ''}${
                          dropTargetKey === group.id ? ' is-drop-target' : ''
                        }`}
                        role="group"
                        aria-label={group.name}
                        onDragOver={(e) => onGroupDragOver(e, group.id)}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setDropTargetKey((k) => (k === group.id ? null : k))
                          }
                        }}
                        onDrop={(e) => onGroupDrop(e, group.id)}
                      >
                        <div className="conv-group-head">
                          <button
                            type="button"
                            className="conv-group-toggle"
                            aria-expanded={!collapsed}
                            title={collapsed ? uiText("展开分组") : uiText("折叠分组")}
                            onClick={() => toggleGroupCollapsed(group.id)}
                          >
                            {collapsed ? '▸' : '▾'}
                          </button>
                          {editingGroupId === group.id ? (
                            <input
                              className="conv-edit conv-group-edit"
                              value={groupEditValue}
                              autoFocus
                              placeholder={uiText("分组名")}
                              onChange={(e) => setGroupEditValue(e.target.value)}
                              onBlur={commitGroupRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitGroupRename()
                                else if (e.key === 'Escape') setEditingGroupId(null)
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="conv-group-title is-editable"
                              title={uiText("点击重命名")}
                              onClick={() => beginGroupRename(group.id, group.name)}
                            >
                              {group.name}
                            </button>
                          )}
                          <span className="conv-group-count">{items.length}</span>
                          <button
                            type="button"
                            className="conv-group-del"
                            aria-label={uiText("删除分组 {0}", [group.name])}
                            title={uiText("删除分组（任务回{0}）", [ungroupedLabel])}
                            onClick={() => void removeGroup(group.id)}
                          >
                            ×
                          </button>
                        </div>
                        {!collapsed &&
                          (items.length === 0 ? (
                            <div className="conv-group-empty">{uiText("拖任务到此")}</div>
                          ) : (
                            items.map(renderConvItem)
                          ))}
                      </div>
                    )
                  })}
                </>
              )
            })()}
          </div>
          <button
            className="conv-add"
            title={uiText("新任务 ({0}+T)", [modKey])}
            aria-label={uiText("新任务")}
            onClick={addConversation}
          >
            {sidebarCollapsed ? '＋' : uiText("＋ 新建任务")}
          </button>
          {moveMenu && !sidebarCollapsed
            ? (() => {
                const target = conversations.find((c) => c.id === moveMenu.convId)
                if (!target) return null
                const pinned = !!target.pinnedAt
                const inUngrouped = !target.groupId && !pinned
                return (
                  <div
                    className="cpet-menu conv-move-menu"
                    role="menu"
                    style={{ left: moveMenu.x, top: moveMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoveMenu(null)
                        startRename(target)
                      }}
                    >
                      <span>{uiText("重命名")}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={pinned ? 'is-current' : undefined}
                      onClick={() => toggleConvPinned(moveMenu.convId, !pinned)}
                    >
                      <span>{pinned ? uiText("取消置顶") : uiText("置顶")}</span>
                      {pinned ? <span className="cpet-menu-check">✓</span> : null}
                    </button>
                    <div className="cpet-menu-sep" role="separator" />
                    <div className="cpet-menu-label">{uiText("移动到")}</div>
                    <button
                      type="button"
                      role="menuitem"
                      className={inUngrouped ? 'is-current' : undefined}
                      onClick={() => moveConvToGroup(moveMenu.convId, undefined)}
                    >
                      <span>{ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? uiText(DEFAULT_UNGROUPED_LABEL) : ungroupedLabel}</span>
                      {inUngrouped ? <span className="cpet-menu-check">✓</span> : null}
                    </button>
                    {groups.map((g) => {
                      const on = target.groupId === g.id
                      return (
                        <button
                          key={g.id}
                          type="button"
                          role="menuitem"
                          className={on ? 'is-current' : undefined}
                          onClick={() => moveConvToGroup(moveMenu.convId, g.id)}
                        >
                          <span>{g.name}</span>
                          {on ? <span className="cpet-menu-check">✓</span> : null}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      role="menuitem"
                      className="is-muted"
                      onClick={() => {
                        setMoveMenu(null)
                        addGroup()
                      }}
                    >
                      <span>{uiText("新建分组…")}</span>
                    </button>
                    <div className="cpet-menu-sep" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => {
                        setMoveMenu(null)
                        closeConversation(moveMenu.convId)
                      }}
                    >
                      <span>{uiText("关闭任务")}</span>
                    </button>
                  </div>
                )
              })()
            : null}
        </aside>

        <section
          className={`chat-main${isRss ? ' is-rss' : ''}${fileDragOver ? ' is-file-drag' : ''}`}
          onDragEnter={(e) => {
            if (![...e.dataTransfer.types].includes('Files')) return
            e.preventDefault()
            setFileDragOver(true)
          }}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].includes('Files')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (!fileDragOver) setFileDragOver(true)
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null
            if (next && e.currentTarget.contains(next)) return
            setFileDragOver(false)
          }}
          onDrop={(e) => {
            if (![...e.dataTransfer.types].includes('Files')) return
            e.preventDefault()
            setFileDragOver(false)
            const files = Array.from(e.dataTransfer.files || [])
            if (!files.length) return
            void attachmentsFromDroppedFiles(files).then((list) => {
              if (list.length) applyIngestedAttachments(list)
            })
          }}
        >
          {sidebarCollapsed && (
            <button
              type="button"
              className="sidebar-expand-fab"
              title={uiText("展开任务列表")}
              aria-label={uiText("展开任务列表")}
              onClick={toggleSidebar}
            >
              {uiText("» 任务")}</button>
          )}
          {!monitorMode && !scheduleMode && !settingsMode && active && (() => {
            const head = (
            <div className={`session-head${todayMode && todayToolsHidden ? ' is-compact' : ''}`}>
              {!todayMode ? (
              <button
                type="button"
                className="today-back-btn"
                title={uiText("回到工作台 (Esc)")}
                onClick={showToday}
              >
                {uiText("← 工作台")}</button>
              ) : null}
              <div className="session-actions">
                <div className="session-group session-group-config" role="group" aria-label={uiText("本任务配置")}>
                  {!isCompare && (
                    <ModelPicker
                      providers={modelProviders}
                      value={active.modelRef || defaultModelRef}
                      disabled={busy}
                      onOpen={() => void syncEngineCatalog('preserve')}
                      onChange={(ref) => {
                        updateConv(active.id, (c) => {
                          const prevProv = parseModelRef(c.modelRef || defaultModelRef).provider
                          const nextProv = parseModelRef(ref).provider
                          // 跨引擎换模型必须丢掉旧 session，否则 Codex 会拿其它引擎的 session id 去 resume 直接炸
                          const sessionId = prevProv === nextProv ? c.sessionId : undefined
                          if (c.kind !== 'rss') return { ...c, modelRef: ref, sessionId }
                          // RSS：只改当前条目的讨论模型，不污染其它条 / 新讨论默认
                          const entryId = c.rss?.selectedId
                          const rssModelRefs = { ...(c.rssModelRefs || {}) }
                          if (entryId) rssModelRefs[entryId] = ref
                          return {
                            ...c,
                            modelRef: ref,
                            sessionId,
                            rssModelRefs,
                            rssDefaultModelRef: c.rssDefaultModelRef || c.modelRef || ref
                          }
                        })
                      }}
                    />
                  )}
                  <label
                    className="session-field"
                    title={
                      isRss
                        ? uiText("本条讨论的权限；换条目互不影响")
                        : uiText("问答 / 计划 / 代理：Cursor、OpenClaw、Claude、Codex 与直连 API 均生效")
                    }
                  >
                    <span className="session-field-label">{uiText("权限")}</span>
                    <select
                      className="autonomy-select"
                      value={resolveConvAutonomy(active)}
                      disabled={busy}
                      aria-label={isRss ? uiText("本条讨论权限") : uiText("任务权限（全引擎）")}
                      onChange={(e) => {
                        const v = e.target.value
                        if (!isAgentAutonomy(v)) return
                        updateConv(active.id, (c) => {
                          if (c.kind !== 'rss') return { ...c, agentAutonomy: v }
                          const entryId = c.rss?.selectedId
                          const rssAutonomies = { ...(c.rssAutonomies || {}) }
                          if (entryId) rssAutonomies[entryId] = v
                          return {
                            ...c,
                            agentAutonomy: v,
                            rssAutonomies,
                            rssDefaultAutonomy: c.rssDefaultAutonomy ?? c.agentAutonomy ?? v
                          }
                        })
                      }}
                    >
                      {AGENT_AUTONOMY_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id} title={o.desc}>
                          {o.short}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SystemPromptEditor
                    value={active.systemPrompt}
                    onChange={(text) =>
                      updateConv(active.id, (c) => ({
                        ...c,
                        systemPrompt: text.trim() ? text : undefined
                      }))
                    }
                  />
                  {ttsEnabled &&
                  (!active.kind ||
                    active.kind === 'chat' ||
                    active.kind === 'rss') ? (
                    <>
                      <button
                        type="button"
                        className={`session-tts-btn${
                          resolveConvTtsAutoSpeak(active, ttsAutoSpeakDefault) ? ' on' : ''
                        }`}
                        title={
                          resolveConvTtsAutoSpeak(active, ttsAutoSpeakDefault)
                            ? uiText("本任务已开：生成时短句流式朗读（再点关闭并停止当前朗读）")
                            : uiText("本任务：生成时短句流式朗读（再点开启）")
                        }
                        aria-pressed={resolveConvTtsAutoSpeak(active, ttsAutoSpeakDefault)}
                        aria-label={uiText("生成完成后自动朗读")}
                        onClick={() => {
                          const cur = resolveConvTtsAutoSpeak(active, ttsAutoSpeakDefault)
                          if (cur) {
                            // 关掉偏好时立刻停嘴，别等生成结束
                            cancelStreamTts(active.id)
                            stopTtsPlayback()
                          }
                          updateConv(active.id, (c) => ({
                            ...c,
                            ttsAutoSpeak: !cur,
                            updatedAt: Date.now()
                          }))
                        }}
                      >
                        {resolveConvTtsAutoSpeak(active, ttsAutoSpeakDefault) ? uiText("朗读·开") : uiText("朗读")}
                      </button>
                      {ttsSpeaking ? (
                        <button
                          type="button"
                          className="session-tts-btn is-stop"
                          title={uiText("停止当前朗读")}
                          aria-label={uiText("停止朗读")}
                          onClick={() => {
                            cancelStreamTts(active.id)
                            stopTtsPlayback()
                          }}
                        >
                          {uiText("停")}</button>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    className={`dir-btn ${cwdSafe ? '' : 'dir-btn-warn'}`}
                    title={
                      cwdSafe
                        ? uiText("工作目录：{0}（点击切换）", [cwd])
                        : UNSAFE_CWD_MESSAGE
                    }
                    aria-label={cwdSafe ? uiText("工作目录 {0}，点击切换", [cwd]) : uiText("请选择项目工作目录")}
                    onClick={chooseDir}
                    disabled={busy}
                  >
                    <IconFolder />
                    <span>{cwdSafe && cwd ? cwdShortLabel(cwd) : uiText("选目录")}</span>
                  </button>
                </div>
                <div className="session-group session-group-end" role="group" aria-label={uiText("本任务操作")}>
                  <ConvHistoryMenu
                    active={active}
                    onSwitchThread={switchThreadInActiveTask}
                    onNewThread={newThreadInActiveTask}
                    onDeleteThread={deleteThreadInActiveTask}
                    deleteDisabled={busy}
                  />
                  <div className="session-group-tools">
                    <button
                      type="button"
                      className={`${todayMode ? 'today-ask-tool' : 'icon-btn'} ${filePanelOpen ? 'on' : ''}`}
                      title={uiText("本对话文件")}
                      aria-label={uiText("本对话文件")}
                      aria-pressed={filePanelOpen}
                      onClick={() => {
                        if (filePanelOpen && !filePreview && filePanelFromList) closeFilePanel()
                        else openFileList()
                      }}
                    >
                      {todayMode ? uiText("文件") : <IconFiles />}
                    </button>
                    <button
                      type="button"
                      className={`${todayMode ? 'today-ask-tool' : 'icon-btn'} ${findOpen ? 'on' : ''}`}
                      title={uiText("搜索 ({0}+F)", [modKey])}
                      aria-label={uiText("搜索对话")}
                      onClick={() => setFindOpen((v) => !v)}
                    >
                      {todayMode ? uiText("搜索") : <IconSearch />}
                    </button>
                    <button
                      type="button"
                      className={todayMode ? 'today-ask-tool' : 'icon-btn'}
                      title={uiText("导出 Markdown ({0}+E)", [modKey])}
                      aria-label={uiText("导出对话")}
                      onClick={() => void exportActiveConversation()}
                    >
                      {todayMode ? uiText("导出") : <IconExport />}
                    </button>
                    <button
                      type="button"
                      className={todayMode ? 'today-ask-tool' : 'icon-btn'}
                      title={uiText("清空当前任务 ({0}+L)", [modKey])}
                      aria-label={uiText("清空当前任务")}
                      onClick={clearChat}
                      disabled={busy}
                    >
                      {todayMode ? uiText("清空") : <IconClear />}
                    </button>
                    {!isCompare && (
                      <AgentDetailToggles
                        visibility={detailVisibility}
                        onChange={updateDetailVisibility}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            )
            if (todayMode) {
              if (!isTodayQuickTask(active)) return null
              return todayAskBarHost && !todayToolsHidden ? createPortal(head, todayAskBarHost) : null
            }
            return head
          })()}

          {monitorMode ? (
            <MonitorFeed
              activities={activities}
              onClear={() => setActivities([])}
              onContinue={continueFromMonitor}
              focusSessionId={monitorFocus.sessionId}
              focusToken={monitorFocus.token}
            />
          ) : scheduleMode ? (
            <SchedulesPanel
              defaultCwd={defaultCwd}
              busy={busy}
              rssConversations={conversations
                .filter((c) => c.kind === 'rss')
                .map((c) => ({ id: c.id, title: c.title || 'RSS' }))}
              onPickDir={async () => {
                const dir = await window.petApi.pickWorkingDir(defaultCwdRef.current)
                return dir
              }}
              onOpenConversation={(id, opts) => {
                if (opts?.openRssDigest) openRssLatestDigest(id)
                else switchTo(id)
              }}
              onClose={() => setScheduleMode(false)}
            />
          ) : settingsMode ? (
            <SettingsPanel
              status={status}
              focusSection={settingsFocusSection}
              onFocusSectionConsumed={() => setSettingsFocusSection(null)}
              onThemeChange={setChatTheme}
              onThemeCustomChange={setChatThemeCustom}
              onUserAvatarChange={setUserAvatar}
              onProvidersChange={setModelProviders}
              onOpenSkinMarket={() => {
                window.petApi.openSkins()
              }}
              onStatusRefresh={() => {
                void window.petApi.getAgentStatus().then(setStatus)
              }}
              onQuickChatChange={(qc) => {
                const enabled = qc.tts === 'edge' || qc.tts === 'local'
                setTtsEnabled(enabled)
                setTtsAutoSpeakDefault(qc.ttsAutoSpeak === true)
                if (!enabled) {
                  // 设置关掉 TTS：立刻停播并藏任务顶栏开关
                  for (const [cid, ctrl] of streamTtsRef.current) {
                    ctrl.cancel()
                    streamTtsRef.current.delete(cid)
                  }
                  stopTtsPlayback()
                }
              }}
              onClose={(fromSettings) => {
                setSettingsMode(false)
                setSettingsFocusSection(null)
                // 以设置页带回的树为准，避免 getSettings 读到写入前的旧缓存把勾选冲掉
                if (fromSettings?.length) setModelProviders(ensureBuiltinProviders(fromSettings))
                void window.petApi.getAgentStatus().then(setStatus)
                void window.petApi.getSettings().then((s) => {
                  const next =
                    s.cwd && isSafeAgentCwd(s.cwd, homeDirRef.current || homeDir)
                      ? s.cwd
                      : undefined
                  setDefaultCwd(next)
                  defaultCwdRef.current = next
                  if (s.userAvatar) setUserAvatar(s.userAvatar)
                  if (isChatThemeId(s.chatTheme)) setChatTheme(s.chatTheme)
                  setChatThemeCustom(normalizeChatThemeCustom(s.chatThemeCustom))
                  setDetailVisibility({
                    showDetails: s.showReasoning !== false && s.showTools !== false
                  })
                  if (s.defaultModelRef) setDefaultModelRef(s.defaultModelRef)
                  if (isAgentAutonomy(s.defaultAgentAutonomy)) {
                    setDefaultAgentAutonomy(s.defaultAgentAutonomy)
                  }
                  if (s.skin) setPetSkin(s.skin)
                  setImageSkinId(s.imageSkin ?? null)
                  const qc = normalizeQuickChatSettings(s.quickChat)
                  setTtsEnabled(qc.tts === 'edge' || qc.tts === 'local')
                  setTtsAutoSpeakDefault(qc.ttsAutoSpeak === true)
                })
              }}
            />
          ) : todayMode ? (
            <TodayHome
              needs={todayNeeds}
              readLanes={todayReadLanes}
              schedules={schedules}
              conversations={conversations}
              ops={opsItems}
              hasRssTask={hasRssTask}
              now={ageNow}
              memos={todayMemos}
              laneOrder={todayReadLaneOrder}
              onLaneOrder={setTodayReadLaneOrder}
              focusMemoId={focusMemoId}
              quickMessages={
                todayQuick && active?.id === todayQuick.id ? displayMessages : todayQuick?.messages ?? []
              }
              quickBusy={!!todayQuick && isConvStreaming(streamingIds, todayQuick.id)}
              quickCwd={todayQuick?.cwd ?? defaultCwd}
              quickDraft={todayQuick ? draftsRef.current.get(todayQuick.id) ?? null : null}
              onQuickDraftChange={(d) => saveDraftFor(ensureTodayQuick(), d)}
              onQuickSend={sendTodayQuick}
              onQuickStop={stopTodayQuick}
              toolsHidden={todayToolsHidden}
              onToggleTools={() => setTodayToolsHidden((v) => !v)}
              askBarHostRef={setTodayAskBarHost}
              composerInputRef={inputRef}
              onPreviewFile={openFilePreview}
              imageSendMode={
                todayQuick ? convImageSendMode(modelProviders, todayQuick, defaultModelRef) : undefined
              }
              thinking={
                todayQuick && convUsesCustomApi(modelProviders, todayQuick, defaultModelRef)
                  ? {
                      on: resolveConvThinking(modelProviders, todayQuick, defaultModelRef),
                      onChange: (next) =>
                        updateConv(todayQuick.id, (c) => ({
                          ...c,
                          enableThinking: next
                        }))
                    }
                  : null
              }
              askThread={
                todayQuick ? (
                  <div className="messages today-ask-messages">
                    {findMatchIds && findQuery.trim() && findMatchIds.size === 0 && todayQuick.messages.length > 0 ? (
                      <div className="chat-find-empty-inline">{uiText("当前任务无匹配「")}{findQuery.trim()}」</div>
                    ) : null}
                    {findMatchIds && findMatchIds.size > 0 ? (
                      <div className="chat-find-filter-hint">
                        {uiText("已过滤为")}{displayMessages.length} / {todayQuick.messages.length} {uiText("条匹配")}<button type="button" className="msg-act" onClick={() => setFindQuery('')}>
                          {uiText("显示全部")}</button>
                      </div>
                    ) : null}
                    {(todayQuick && active?.id === todayQuick.id ? displayMessages : todayQuick.messages)
                      .slice(-36)
                      .map((m) => {
                        const streamingMsg =
                          isConvStreaming(streamingIds, todayQuick.id) &&
                          m.role === 'assistant' &&
                          streamsRef.current.get(makeStreamKey(todayQuick.id)) === m.id
                        const isLastAssistant =
                          m.id === todayQuick.messages[todayQuick.messages.length - 1]?.id &&
                          m.role === 'assistant' &&
                          !isConvStreaming(streamingIds, todayQuick.id)
                        const quickReplies = isLastAssistant ? parseOptions(messagePlainText(m)) : []
                        return (
                          <MessageView
                            key={m.id}
                            message={m}
                            streaming={streamingMsg}
                            highlight={!!findMatchIds?.has(m.id)}
                            userAvatar={userAvatar}
                            petEmoji={SKIN_AVATAR[petSkin] ?? '🐾'}
                            petImage={petImage}
                            detailVisibility={detailVisibility}
                            onUserAvatarChange={handleUserAvatarChange}
                            canResend={m.role === 'user' && !isConvStreaming(streamingIds, todayQuick.id)}
                            onResend={handleResend}
                            quickReplies={quickReplies.length ? quickReplies : undefined}
                            onPick={handlePickReply}
                            ttsEnabled={ttsEnabled}
                            onOpenFilePreview={openFilePreview}
                          />
                        )
                      })}
                  </div>
                ) : null
              }
              askFooter={
                todayQuick ? (
                  <>
                    {errorByConv[todayQuick.id] ? (
                      <AgentErrorBar
                        info={errorByConv[todayQuick.id]}
                        canRetry={todayQuick.messages.some((m) => m.role === 'user')}
                        onFix={() => applyErrorFix(errorByConv[todayQuick.id].fix)}
                        onRetry={retryLastTurn}
                        onDismiss={() => dismissError(todayQuick.id)}
                      />
                    ) : null}
                    <SendQueuePanel
                      items={queuesByConv[todayQuick.id] ?? []}
                      draining={isConvStreaming(streamingIds, todayQuick.id)}
                      onEdit={editQueued}
                      onRemove={removeQueued}
                      onClear={() => clearConvQueue(todayQuick.id)}
                      onSendNow={sendQueuedNow}
                    />
                  </>
                ) : null
              }
              askAside={
                filePanelOpen ? (
                  <FilePreviewPane
                    target={filePreview}
                    files={previewFiles}
                    attachedPaths={composerAttachedPaths}
                    onSelect={openFilePreview}
                    onShowList={filePanelFromList ? openFileList : undefined}
                    onAttach={(t) =>
                      applyIngestedAttachments([
                        { path: t.path, name: t.name, mime: t.mime, addedAt: t.addedAt }
                      ])
                    }
                    onDetach={(t) => detachFromComposer(t.path)}
                    onRemoveFromList={(t) => hidePreviewFile(t.path)}
                    onClearList={hideAllPreviewFiles}
                    onTogglePin={(t) => togglePreviewFilePin(t.path)}
                    onClose={closeFilePanel}
                    now={ageNow}
                    embed
                  />
                ) : null
              }
              onAddMemo={addTodayMemo}
              onUpsertMemo={upsertTodayMemo}
              onCompleteMemo={completeTodayMemoById}
              onRemoveMemo={(id) => setTodayMemos((prev) => prev.filter((m) => m.id !== id))}
              onOpenNeed={openTodayNeed}
              onOpenRead={openTodayRead}
              onOpenDayItem={openTodayDayItem}
              onOpenSchedules={() => {
                setScheduleMode(true)
                setMonitorMode(false)
                setSettingsMode(false)
                monitorRef.current = false
              }}
              onNewRss={() => {
                setNewTaskSeed('rss')
                setNewTaskOpen(true)
              }}
            />
          ) : (
            <div className={`chat-stage${filePanelOpen ? ' has-preview' : ''}`}>
              <div className="chat-stage-main">
              {!active ? (
                <div className="messages-wrap">
                  <div className="no-tasks-empty" role="status">
                    <p className="no-tasks-title">{uiText("暂无任务")}</p>
                    <p className="no-tasks-desc">{uiText("关掉的任务不会自动新建；需要时再开一个。")}</p>
                    <button type="button" className="settings-btn" onClick={addConversation}>
                      {uiText("新建任务")}</button>
                  </div>
                </div>
              ) : isCompare ? (
                <div className="messages-wrap compare-wrap">
                  <CompareView
                    conversation={active}
                    providers={modelProviders}
                    streamingKeys={streamingIds}
                    columns={compareColumns}
                    onColumnsChange={setCompareColumns}
                    detailVisibility={detailVisibility}
                    onDetailVisibilityChange={updateDetailVisibility}
                    selectedReplies={selectedReplies}
                    onToggleReply={toggleReplyPick}
                    onCopyLane={copyLane}
                    onRerunLane={(id) => void rerunLane(id)}
                    onCloseLane={closeLane}
                    onChangeLaneModel={changeLaneModel}
                    onAddLane={addLane}
                    userAvatar={userAvatar}
                    onSyncModels={() => void syncEngineCatalog('preserve')}
                    onOpenFilePreview={openFilePreview}
                  />
                </div>
              ) : isRss ? (
                <div className="messages-wrap rss-wrap">
                  <RssTaskView
                    key={active.id}
                    conversation={active}
                    onPatchRss={(next) => patchRss(active.id, next)}
                    onSelectEntry={selectRssEntry}
                    onSelectDigest={(digestId, opts) =>
                      selectRssDigestOn(active.id, digestId, opts)
                    }
                    onDeleteDigest={deleteRssDigest}
                    onSelectThread={selectRssThread}
                    hasDiscussion={rssHasDiscussion}
                    showDiscussion={rssShowDiscussion}
                    modelRef={activeModelRef}
                    aiScrollRef={scrollRef}
                    onAiScroll={onMessagesScroll}
                    ttsEnabled={ttsEnabled}
                    onOpenToday={showToday}
                    onOpenSchedules={() => {
                      setScheduleMode(true)
                      setMonitorMode(false)
                      setSettingsMode(false)
                      monitorRef.current = false
                    }}
                    onDiscussQuote={() => {
                      window.setTimeout(() => inputRef.current?.focus(), 60)
                    }}
                    aiChildren={displayMessages.map((m) => {
                      const streamingMsg =
                        busy &&
                        m.role === 'assistant' &&
                        streamsRef.current.get(makeStreamKey(activeId)) === m.id
                      return (
                        <MessageView
                          key={m.id}
                          message={m}
                          streaming={streamingMsg}
                          userAvatar={userAvatar}
                          petEmoji={SKIN_AVATAR[petSkin] ?? '🐾'}
                          petImage={petImage}
                          detailVisibility={detailVisibility}
                          onUserAvatarChange={handleUserAvatarChange}
                          canResend={m.role === 'user' && !busy}
                          onResend={handleResend}
                          ttsEnabled={ttsEnabled}
                          onOpenFilePreview={openFilePreview}
                        />
                      )
                    })}
                  />
                  {rssShowDiscussion && showJumpBottom ? (
                    <button
                      type="button"
                      className="jump-bottom"
                      onClick={scrollToBottom}
                      title={uiText("回到底部")}
                      aria-label={uiText("回到底部")}
                    >
                      <span aria-hidden>↓</span>
                      {uiText("最新")}</button>
                  ) : null}
                </div>
              ) : (
                <div className="messages-wrap">
                  <div
                    className="messages"
                    ref={scrollRef}
                    onScroll={onMessagesScroll}
                    role="log"
                    aria-live="polite"
                    aria-label={uiText("对话记录")}
                  >
                    {messages.length === 0 && (
                      <EmptyState
                        demoMode={runMode === 'demo'}
                        cwdSafe={cwdSafe}
                        onPickDir={() => void chooseDir()}
                        onOpenSetup={() => openSettingsSection('settings-setup')}
                      />
                    )}
                    {findMatchIds && findQuery.trim() && findMatchIds.size === 0 && messages.length > 0 && (
                      <div className="chat-find-empty-inline">{uiText("当前任务无匹配「")}{findQuery.trim()}」</div>
                    )}
                    {findMatchIds && findMatchIds.size > 0 && (
                      <div className="chat-find-filter-hint">
                        {uiText("已过滤为")}{displayMessages.length} / {messages.length} {uiText("条匹配")}<button type="button" className="msg-act" onClick={() => setFindQuery('')}>
                          {uiText("显示全部")}</button>
                      </div>
                    )}
                    {displayMessages.map((m) => {
                      const isLastAssistant =
                        m.id === messages[messages.length - 1]?.id &&
                        m.role === 'assistant' &&
                        !busy
                      const quickReplies = isLastAssistant ? parseOptions(messagePlainText(m)) : []
                      const streamingMsg =
                        busy &&
                        m.role === 'assistant' &&
                        streamsRef.current.get(makeStreamKey(activeId)) === m.id
                      return (
                        <MessageView
                          key={m.id}
                          message={m}
                          streaming={streamingMsg}
                          highlight={!!findMatchIds?.has(m.id)}
                          userAvatar={userAvatar}
                          petEmoji={SKIN_AVATAR[petSkin] ?? '🐾'}
                          petImage={petImage}
                          detailVisibility={detailVisibility}
                          onUserAvatarChange={handleUserAvatarChange}
                          canResend={m.role === 'user' && !busy}
                          onResend={handleResend}
                          quickReplies={quickReplies.length ? quickReplies : undefined}
                          onPick={handlePickReply}
                          ttsEnabled={ttsEnabled}
                          onOpenFilePreview={openFilePreview}
                        />
                      )
                    })}
                  </div>
                  {showJumpBottom && (
                    <button
                      type="button"
                      className="jump-bottom"
                      onClick={scrollToBottom}
                      title={uiText("回到底部")}
                      aria-label={uiText("回到底部")}
                    >
                      <span aria-hidden>↓</span>
                      {uiText("最新")}</button>
                  )}
                </div>
              )}

              {active && errorByConv[active.id] ? (
                <AgentErrorBar
                  info={errorByConv[active.id]}
                  canRetry={!isCompare && messages.some((m) => m.role === 'user')}
                  onFix={() => applyErrorFix(errorByConv[active.id].fix)}
                  onRetry={retryLastTurn}
                  onDismiss={() => dismissError(active.id)}
                />
              ) : null}
              {active &&
              !isSafeAgentCwd(cwd, homeDirRef.current || homeDir) &&
              (isCompare
                ? getCompareLanes(active).some((l) =>
                    isAgentModelRef(modelProviders, l.modelId)
                  )
                : isAgentModelRef(modelProviders, active.modelRef || defaultModelRef)) ? (
                <div className="cwd-guard-bar" role="alert">
                  <span>{uiText("代理任务必须先选项目目录（不能用主目录），否则无法发送。")}</span>
                  <button type="button" className="settings-btn tiny" onClick={() => void chooseDir()}>
                    {uiText("选目录")}</button>
                </div>
              ) : null}
              {active ? (
                <SendQueuePanel
                  items={activeQueue}
                  draining={busy}
                  onEdit={editQueued}
                  onRemove={removeQueued}
                  onClear={() => activeId && clearConvQueue(activeId)}
                  onSendNow={sendQueuedNow}
                />
              ) : null}
              {active ? (
                <>
                {rssQuotes.length > 0 ? (
                  <div className="rss-quote-bar" role="status">
                    <div className="rss-quote-bar-head">
                      <span className="rss-quote-bar-label">
                        {uiText("分析依赖 ·")}{rssQuotes.length} {uiText("段")}</span>
                      <button
                        type="button"
                        className="rss-quote-bar-clear"
                        title={uiText("清除全部划词")}
                        onClick={() => {
                          if (!active.rss) return
                          patchActiveRss(clearRssAnalysisQuote(active.rss))
                        }}
                      >
                        {uiText("清空")}</button>
                    </div>
                    <ul className="rss-quote-bar-list">
                      {rssQuotes.map((q, i) => (
                        <li key={q.id} className="rss-quote-bar-item">
                          <em className="rss-quote-bar-ord">{i + 1}</em>
                          <q className="rss-quote-bar-text" title={q.text}>
                            {q.text.length > 120 ? `${q.text.slice(0, 120)}…` : q.text}
                          </q>
                          <button
                            type="button"
                            className="rss-quote-bar-x"
                            title={uiText("移除这段")}
                            aria-label={uiText("移除第 {0} 段划词", [i + 1])}
                            onClick={() => {
                              if (!active.rss) return
                              patchActiveRss(removeRssAnalysisQuote(active.rss, q.id))
                            }}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {isRss && active.rss?.selectedId ? (
                  <div className="rss-quick-actions" role="group" aria-label={uiText("讨论快捷")}>
                    <span className="rss-quick-actions-label" aria-hidden="true">
                      {uiText("快捷")}</span>
                    {active.rss.readerMode !== 'digest' ? (
                      <span
                        className="rss-quick-basis"
                        title={uiText("讨论发送时附带的正文依据（来自链接抓取缓存，不是网页标签页的可视区域）")}
                      >
                        {rssDiscussionBasisLabel(selectedRssEntry(active.rss))}
                      </span>
                    ) : null}
                    {RSS_QUICK_ACTIONS.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="rss-quick-chip"
                        disabled={busy}
                        title={
                          active.rss?.readerMode === 'digest'
                            ? uiText("{0}（基于本份简报）", [action.title])
                            : `${action.title}；${rssDiscussionBasisLabel(selectedRssEntry(active.rss))}`
                        }
                        onClick={() => {
                          void send(
                            buildRssQuickActionPrompt(action.id, active.rss?.readerMode)
                          )
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Composer
                  // 按任务 key：切任务时重挂载并从草稿表恢复，避免 A 的输入串到 B
                  key={active.id}
                  busy={busy}
                  draft={draftsRef.current.get(active.id) ?? null}
                  onDraftChange={saveDraft}
                  cwd={cwd}
                  onSend={handleComposerSend}
                  onStop={stop}
                  onPreviewFile={openFilePreview}
                  imageSendMode={convImageSendMode(modelProviders, active, defaultModelRef)}
                  inputRef={inputRef}
                  placeholder={
                    isRss
                      ? rssQuotes.length > 0
                        ? uiText("针对 {0} 段划词继续提问…", [rssQuotes.length])
                        : active.rss?.readerMode === 'digest'
                          ? uiText("针对本次简报提问…")
                          : active.rss?.selectedId
                            ? uiText("针对当前条目提问…")
                            : uiText("先选一条，再提问…")
                      : undefined
                  }
                  summary={
                    isCompare
                      ? {
                          selectedCount: selectedReplies.size,
                          onSummary: confirmSummary
                        }
                      : null
                  }
                  thinking={
                    convUsesCustomApi(modelProviders, active, defaultModelRef)
                      ? {
                          on: resolveConvThinking(
                            modelProviders,
                            active,
                            defaultModelRef
                          ),
                          onChange: (next) =>
                            updateConv(active.id, (c) => ({
                              ...c,
                              enableThinking: next
                            }))
                        }
                      : null
                  }
                />
                </>
              ) : null}
              </div>
              {filePanelOpen ? (
                <FilePreviewPane
                  target={filePreview}
                  files={previewFiles}
                  attachedPaths={composerAttachedPaths}
                  onSelect={openFilePreview}
                  onShowList={filePanelFromList ? openFileList : undefined}
                  onAttach={(t) =>
                    applyIngestedAttachments([
                      { path: t.path, name: t.name, mime: t.mime, addedAt: t.addedAt }
                    ])
                  }
                  onDetach={(t) => detachFromComposer(t.path)}
                  onRemoveFromList={(t) => hidePreviewFile(t.path)}
                  onClearList={hideAllPreviewFiles}
                  onTogglePin={(t) => togglePreviewFilePin(t.path)}
                  onClose={closeFilePanel}
                  now={ageNow}
                />
              ) : null}
            </div>
          )}
        </section>
      </div>

      {newTaskOpen && (
        <NewTaskDialog
          providers={modelProviders}
          recentCwds={recentCwds}
          defaultCwd={defaultCwd}
          defaultModelRef={defaultModelRef}
          taskGroups={groups}
          defaultGroupLabel={ungroupedLabel === DEFAULT_UNGROUPED_LABEL ? uiText(DEFAULT_UNGROUPED_LABEL) : ungroupedLabel}
          onChatTemplate={createFromScenario}
          onChat={(cwd, groupId, modelRef) => createChatTask(undefined, cwd, groupId, modelRef)}
          onCompare={(refs, cwd, groupId) => createCompareTask(refs, cwd, groupId)}
          onRss={(urls, cwd, groupId, modelRef) => createRssTask(urls, cwd, groupId, modelRef)}
          onClose={() => setNewTaskOpen(false)}
          initialForm={newTaskSeed}
          onRefreshModels={() => syncEngineCatalog('enable-listed')}
          onPickCwd={async (preferred) => {
            const start = (preferred && preferred.trim()) || defaultCwdRef.current
            const dir = await window.petApi.pickWorkingDir(start)
            if (!dir) return null
            setRecentCwds((prev) => [dir, ...prev.filter((x) => x !== dir)].slice(0, 8))
            return dir
          }}
        />
      )}

    </div>
  )
}

const ACT_ICON: Record<Activity['kind'], string> = {
  prompt: '📨',
  think: '💭',
  tool: '🔧',
  edit: '✏️',
  command: '⌨️',
  wait: '🕐',
  done: '✅',
  error: '⚠️'
}

function cwdBasename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function NewTaskDialog({
  providers,
  recentCwds,
  defaultCwd,
  defaultModelRef,
  taskGroups,
  defaultGroupLabel,
  onChatTemplate,
  onChat,
  onCompare,
  onRss,
  onClose,
  initialForm = 'chat',
  onRefreshModels,
  onPickCwd
}: {
  providers: ModelProvider[]
  recentCwds: string[]
  defaultCwd?: string
  defaultModelRef: string
  taskGroups: ConversationGroup[]
  defaultGroupLabel: string
  onChatTemplate: (
    scenario: TaskScenario,
    cwd?: string,
    groupId?: string,
    modelRef?: string
  ) => void
  onChat: (cwd?: string, groupId?: string, modelRef?: string) => void
  onCompare: (modelRefs: string[], cwd?: string, groupId?: string) => void
  onRss: (feedUrls: string[], cwd?: string, groupId?: string, modelRef?: string) => void
  onClose: () => void
  initialForm?: TaskFormKind
  onRefreshModels: () => Promise<void>
  /** preferred：对话框当前选中的目录，选文件夹时应从这里打开。 */
  onPickCwd: (preferred?: string) => Promise<string | null>
}): JSX.Element {
  useUiLocale()
  const [form, setForm] = useState<TaskFormKind>(initialForm)
  const enabled = flattenEnabledRefs(providers)
  const [picked, setPicked] = useState<string[]>(() => enabled.slice(0, 2).map((m) => m.ref))
  const [refreshing, setRefreshing] = useState(false)
  const [rssDraft, setRssDraft] = useState('')
  /** 对话形态：先选模板/空白，再点页脚创建。 */
  const [chatPick, setChatPick] = useState<'blank' | string>('blank')
  /** 空 = 用设置里的工作目录；只有用户改下拉/点选才覆盖。 */
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  /** 本对话框刚选过、尚未进 recentCwds 的路径，保证下拉能立刻显示。 */
  const [pickedCwd, setPickedCwd] = useState<string | undefined>(undefined)
  const [groupId, setGroupId] = useState('')
  const [modelRef, setModelRef] = useState(defaultModelRef)
  const dialogRef = useRef<HTMLDivElement>(null)
  const scenarioGroups = groupTaskScenarios()
  const selectedScenario =
    chatPick === 'blank'
      ? null
      : BUILTIN_TASK_SCENARIOS.find((s) => s.id === chatPick) || null

  useEffect(() => {
    // 分组被删时回落到默认区
    if (groupId && !taskGroups.some((g) => g.id === groupId)) setGroupId('')
  }, [groupId, taskGroups])

  useEffect(() => {
    // 配置的默认目录变了，且用户没手选过其它路径 → 保持跟配置走
    if (cwd && defaultCwd && cwd === defaultCwd) setCwd(undefined)
  }, [defaultCwd, cwd])

  useEffect(() => {
    setModelRef((prev) => {
      if (prev && enabled.some((m) => m.ref === prev)) return prev
      if (defaultModelRef && enabled.some((m) => m.ref === defaultModelRef)) return defaultModelRef
      return enabled[0]?.ref || defaultModelRef || ''
    })
  }, [defaultModelRef, enabled])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const first = dialogRef.current?.querySelector<HTMLElement>('button, select, input, textarea')
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function addRef(ref: string): void {
    setPicked((prev) => [...prev, ref])
  }

  function removeAt(index: number): void {
    setPicked((prev) => prev.filter((_, i) => i !== index))
  }

  function resolveCwd(): string | undefined {
    const picked = typeof cwd === 'string' ? cwd.trim() : ''
    if (picked) return picked
    return defaultCwd
  }

  function resolveGroupId(): string | undefined {
    return groupId.trim() || undefined
  }

  const rssFeeds = normalizeRssTaskFeeds(rssDraft)
  const kindMeta: Array<{ id: TaskFormKind; label: string; hint: string }> = [
    { id: 'chat', label: uiText("对话"), hint: uiText("模板或空白开干") },
    { id: 'compare', label: uiText("对比"), hint: uiText("多模型并排") },
    { id: 'rss', label: 'RSS', hint: uiText("订阅阅读讨论") }
  ]

  return (
    <div
      className="new-task-overlay"
      onClick={() => {
        if (form === 'compare' && picked.length > 0) {
          if (!confirmDestructive(uiText("已选模型尚未创建，确定关闭？"))) return
        }
        onClose()
      }}
    >
      <div
        className="new-task-dialog new-task-create"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
      >
        <header className="new-task-head">
          <div className="new-task-head-text">
            <h3 id="new-task-title">{uiText("新建任务")}</h3>
            <p className="new-task-sub">
              {form === 'rss'
                ? uiText("先加订阅源，再创建")
                : form === 'compare'
                  ? uiText("选至少两个模型并排")
                  : uiText("选模板或空白开干")}
            </p>
          </div>
          <button
            type="button"
            className="new-task-close"
            aria-label={uiText("关闭")}
            title={uiText("关闭")}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="new-task-kinds" role="tablist" aria-label={uiText("任务形态")}>
          {kindMeta.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={form === k.id}
              className={`new-task-kind ${form === k.id ? 'on' : ''}`}
              onClick={() => setForm(k.id)}
            >
              <span className="new-task-kind-label">{k.label}</span>
              <span className="new-task-kind-hint">{k.hint}</span>
            </button>
          ))}
        </div>

        <div className={`new-task-body is-${form}`}>
          {form === 'rss' ? (
            <div className="new-task-scenes is-fill">
              <p className="new-task-body-lead tight">{uiText("点选目录源，或粘贴 feed 地址")}</p>
              <RssFeedPicker
                draft={rssDraft}
                onChange={setRssDraft}
                maxHint={200}
                dense
                enableDiscover
              />
            </div>
          ) : form === 'chat' ? (
            <div className="new-task-scenes is-fill">
              <p className="new-task-body-lead tight">{uiText("先选一种开法，再点下方创建")}</p>
              <button
                type="button"
                className={`new-task-scene is-primary${chatPick === 'blank' ? ' on' : ''}`}
                aria-pressed={chatPick === 'blank'}
                onClick={() => setChatPick('blank')}
              >
                <span className="new-task-scene-top">
                  <span className="new-task-scene-name">{uiText("空白对话")}</span>
                  <span className="new-task-scene-go">
                    {chatPick === 'blank' ? uiText("已选") : uiText("选这个")}
                  </span>
                </span>
                <span className="new-task-scene-desc">{uiText("立刻开干；权限跟默认设置")}</span>
              </button>
              {scenarioGroups.map((g) => {
                const items = g.items.filter((sc) => sc.id !== 'scene-chat')
                if (items.length === 0) return null
                return (
                  <div key={g.group} className="new-task-scene-group">
                    <div className="new-task-scene-group-label">{g.label}</div>
                    <ul className="new-task-scene-list">
                      {items.map((sc) => {
                        const badge = autonomyShortLabel(sc.agentAutonomy)
                        const on = chatPick === sc.id
                        return (
                          <li key={sc.id}>
                            <button
                              type="button"
                              className={`new-task-scene${on ? ' on' : ''}`}
                              aria-pressed={on}
                              onClick={() => setChatPick(sc.id)}
                            >
                              <span className="new-task-scene-top">
                                <span className="new-task-scene-name">
                                  {sc.name}
                                  {badge ? (
                                    <span
                                      className={`new-task-scene-badge mode-${sc.agentAutonomy}`}
                                    >
                                      {badge}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="new-task-scene-go">
                                  {on ? uiText("已选") : uiText("选这个")}
                                </span>
                              </span>
                              <span className="new-task-scene-desc">{sc.desc}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="new-task-models">
              <div className="new-task-body-toolbar">
                <p className="new-task-body-lead tight">{uiText("至少 2 列（可重复同一模型）")}</p>
                <button
                  type="button"
                  className="new-task-cwd-pick"
                  disabled={refreshing}
                  onClick={() => {
                    setRefreshing(true)
                    void onRefreshModels().finally(() => setRefreshing(false))
                  }}
                >
                  {refreshing ? '…' : uiText("刷新")}
                </button>
              </div>
              {enabled.length < 1 ? (
                <p className="new-task-body-lead">{uiText("请先在设置 → 模型配置中启用至少 1 个模型。")}</p>
              ) : (
                <>
                  {picked.length > 0 && (
                    <div className="new-task-picked" aria-label={uiText("已选 {0} 列", [picked.length])}>
                      <span className="new-task-picked-label">{uiText("已选")}{' '}{picked.length}</span>
                      <div className="new-task-picked-chips">
                        {picked.map((ref, i) => {
                          const label = modelRefLabel(providers, ref)
                          return (
                            <span
                              key={`${ref}-${i}`}
                              className="new-task-picked-chip"
                              title={uiText("第 {0} 列 · {1}", [i + 1, label])}
                            >
                              <em className="new-task-picked-ord">{i + 1}</em>
                              <span className="new-task-picked-name">{label}</span>
                              <button
                                type="button"
                                className="new-task-picked-x"
                                aria-label={uiText("移除第 {0} 列", [i + 1])}
                                onClick={() => removeAt(i)}
                              >
                                ×
                              </button>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <ModelTreeBrowser
                    providers={providers}
                    actionLabel={uiText("添加")}
                    onAction={addRef}
                    autoExpandSelected={false}
                  />
                </>
              )}
            </div>
          )}
        </div>

        <footer className="new-task-actions">
          <div className="new-task-meta">
            {form === 'chat' || form === 'rss' ? (
              <div className="new-task-meta-field is-model">
                <span>{uiText("模型")}</span>
                <ModelPicker
                  className="new-task-model-picker"
                  providers={providers}
                  value={modelRef}
                  onChange={setModelRef}
                  title={
                    form === 'rss'
                      ? uiText("讨论与评分/简报默认模型（创建后仍可改）")
                      : uiText("本任务使用的模型")
                  }
                  onOpen={() => {
                    void onRefreshModels()
                  }}
                  hideKind
                />
              </div>
            ) : null}
            <label className="new-task-meta-field" htmlFor="new-task-group">
              <span>{uiText("分到")}</span>
              <select
                id="new-task-group"
                className="new-task-cwd-select"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">{defaultGroupLabel}</option>
                {taskGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            {form !== 'rss' ? (
              <label className="new-task-meta-field is-cwd" htmlFor="new-task-cwd">
                <span>{uiText("目录")}</span>
                <select
                  id="new-task-cwd"
                  className="new-task-cwd-select"
                  value={cwd || ''}
                  onChange={(e) => setCwd(e.target.value || undefined)}
                  title={resolveCwd() || uiText("未在设置中配置工作目录")}
                >
                  <option value="">
                    {defaultCwd ? uiText("配置 · {0}", [cwdBasename(defaultCwd)]) : uiText("配置目录（未设置）")}
                  </option>
                  {pickedCwd &&
                  pickedCwd !== defaultCwd &&
                  !recentCwds.includes(pickedCwd) ? (
                    <option value={pickedCwd}>{uiText("已选 ·")}{' '}{cwdBasename(pickedCwd)}</option>
                  ) : null}
                  {recentCwds
                    .filter((path) => path !== defaultCwd)
                    .map((path) => (
                      <option key={path} value={path}>
                        {uiText("最近 ·")}{cwdBasename(path)}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="new-task-cwd-pick"
                  title={
                    resolveCwd()
                      ? uiText("从「{0}」打开选目录", [resolveCwd()])
                      : uiText("选择工作目录")
                  }
                  onClick={() => {
                    void onPickCwd(resolveCwd()).then((dir) => {
                      if (!dir) return
                      setPickedCwd(dir)
                      setCwd(dir === defaultCwd ? undefined : dir)
                    })
                  }}
                >
                  {uiText("选…")}</button>
              </label>
            ) : null}
          </div>
          <div className="new-task-actions-btns">
            <button type="button" className="settings-btn ghost" onClick={onClose}>
              {uiText("取消")}</button>
            {form === 'chat' ? (
              <button
                type="button"
                className="settings-btn"
                disabled={!modelRef.trim()}
                onClick={() => {
                  if (selectedScenario) {
                    onChatTemplate(selectedScenario, resolveCwd(), resolveGroupId(), modelRef)
                  } else {
                    onChat(resolveCwd(), resolveGroupId(), modelRef)
                  }
                }}
              >
                {uiText("创建对话")}{selectedScenario ? ` · ${selectedScenario.name}` : uiText(" · 空白")}
              </button>
            ) : null}
            {form === 'compare' ? (
              <button
                type="button"
                className="settings-btn"
                disabled={picked.length < 2}
                onClick={() => onCompare(picked, resolveCwd(), resolveGroupId())}
              >
                {uiText("创建对比")}{picked.length >= 2 ? `（${picked.length}）` : ''}
              </button>
            ) : null}
            {form === 'rss' ? (
              <button
                type="button"
                className="settings-btn"
                disabled={!rssFeeds.length || !modelRef.trim()}
                onClick={() =>
                  onRss(
                    rssFeeds.map((f) => f.url),
                    undefined,
                    resolveGroupId(),
                    modelRef
                  )
                }
              >
                {uiText("创建 RSS")}{rssFeeds.length ? uiText("（{0} 源）", [rssFeeds.length]) : ''}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  )
}

function MonitorFeed({
  activities,
  onClear,
  onContinue,
  focusSessionId,
  focusToken
}: {
  activities: Activity[]
  onClear: () => void
  onContinue: (a: Activity) => void
  focusSessionId?: string
  focusToken?: number
}): JSX.Element {
  useUiLocale()
  const ref = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<string | null>(null)
  // 按 sessionId（优先）或 emoji+label 分轨
  const trackKey = (a: Activity): string => activityTrackKey(a)
  const tasks = Array.from(new Map(activities.map((a) => [trackKey(a), a])).values())
  const shown = filter ? activities.filter((a) => trackKey(a) === filter) : activities
  useEffect(() => {
    if (!focusToken) return
    const sid = (focusSessionId || '').trim()
    setFilter(sid && sid !== 'default' ? `s:${sid}` : null)
  }, [focusToken, focusSessionId])
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown.length])
  return (
    <div className="monitor">
      <div className="monitor-head">
        <span>{uiText("联动活动")}</span>
        {activities.length > 0 && (
          <button
            className="msg-act"
            onClick={() => {
              if (!confirmDestructive(uiText("确定清空活动时间线？仅清除本窗显示，不影响外部引擎。"))) return
              onClear()
            }}
          >
            {uiText("清空")}</button>
        )}
      </div>
      {tasks.length > 1 && (
        <div className="monitor-filter">
          <button
            className={`mf-chip ${filter === null ? 'on' : ''}`}
            onClick={() => setFilter(null)}
          >
            {uiText("全部")}</button>
          {tasks.map((t) => {
            const k = trackKey(t)
            const sid = (t.sessionId || '').trim()
            const tip =
              sid && sid !== 'default' ? `${t.label} · ${sid.slice(0, 8)}` : t.label
            return (
              <button
                key={k}
                className={`mf-chip ${filter === k ? 'on' : ''}`}
                onClick={() => setFilter((f) => (f === k ? null : k))}
                title={tip}
              >
                {t.emoji} {t.label}
                {sid && sid !== 'default' ? (
                  <span className="mf-chip-sid">{sid.slice(0, 4)}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
      <div className="monitor-feed" ref={ref}>
        {shown.length === 0 ? (
          <div className="monitor-empty">
            {uiText("已联动的引擎（Cursor / Claude / Codex 等）在跑任务时，这里会实时显示动作：提交 · 用工具 · 改文件 · 跑命令 · 等你回复 · 完成。")}</div>
        ) : (
          shown.map((a) => {
            const sid = (a.sessionId || '').trim()
            return (
              <div
                className={`act act-${a.kind}`}
                key={a.id}
                style={{ borderLeftColor: EMOJI_COLOR[a.emoji] ?? hashColor(a.label) }}
              >
                <span
                  className="act-task"
                  title={
                    sid && sid !== 'default' ? `${a.label} · ${sid}` : a.label
                  }
                >
                  {a.emoji}
                  {!/^任务\s*\d+$/.test(a.label) && (
                    <span className="act-label">{a.label}</span>
                  )}
                </span>
                <span className="act-icon">{ACT_ICON[a.kind]}</span>
                <span className="act-text">
                  {a.text}
                  {a.cwd ? (
                    <span className="act-cwd" title={a.cwd}>
                      {' '}
                      · {a.cwd.split(/[/\\]/).filter(Boolean).pop()}
                    </span>
                  ) : null}
                  {sid && sid !== 'default' ? (
                    <span className="act-cwd" title={sid}>
                      {' '}
                      · {sid.slice(0, 6)}
                    </span>
                  ) : null}
                </span>
                {(a.kind === 'error' || a.kind === 'wait' || a.kind === 'done') && (
                  <button
                    type="button"
                    className="act-continue"
                    title={uiText("在 CPET 里续查（同会话复用对话）")}
                    onClick={() => onContinue(a)}
                  >
                    {uiText("续查")}</button>
                )}
                <span className="act-time">
                  {new Date(a.ts).toLocaleTimeString(uiLocaleTag(), { hour12: false })}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const MessageView = memo(function MessageView({
  message,
  userAvatar,
  petEmoji,
  petImage,
  detailVisibility,
  highlight,
  streaming = false,
  onUserAvatarChange,
  canResend = false,
  onResend,
  quickReplies,
  onPick,
  ttsEnabled = false,
  onOpenFilePreview
}: {
  message: ChatMessage
  userAvatar: string
  petEmoji: string
  petImage: string | null
  detailVisibility: AgentDetailVisibility
  highlight?: boolean
  streaming?: boolean
  onUserAvatarChange: (avatar: string) => void
  canResend?: boolean
  onResend?: (messageId: string) => void
  quickReplies?: string[]
  onPick?: (option: string) => void
  /** 设置里开启 TTS 后才显示朗读按钮。 */
  ttsEnabled?: boolean
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}): JSX.Element {
  useUiLocale()
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [speakHint, setSpeakHint] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [pickerHint, setPickerHint] = useState<string | null>(null)
  const [pickingImage, setPickingImage] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const role = message.role === 'assistant' || message.role === 'user' ? message.role : 'user'
  const displayBlocks = blocksForDisplay(message.blocks, detailVisibility.showDetails, role).map(
    (b) =>
      isUser && b.kind === 'text' ? { ...b, text: stripRssAskPreamble(b.text) } : b
  )
  const markdownImagePaths = useMemo(() => {
    const keys = new Set<string>()
    for (const b of displayBlocks) {
      if (b.kind !== 'text' || !b.text) continue
      for (const p of extractLocalImagePaths(b.text)) {
        const key = canonicalLocalPath(p)
        if (key) keys.add(key)
      }
    }
    return keys
  }, [displayBlocks])
  const hasContent = message.blocks.length > 0
  const hasVisibleText = displayBlocks.some(
    (b) =>
      (b.kind === 'text' && b.text.trim()) ||
      b.kind === 'attachment' ||
      b.kind === 'tool' ||
      b.kind === 'command' ||
      b.kind === 'reasoning' ||
      b.kind === 'status'
  )
  const usageText = !isUser && !streaming ? formatRunUsage(message.runUsage) || '' : ''
  const showMsgActs = !!(hasContent || hasVisibleText)
  const showMsgFooter = showMsgActs || !!usageText
  const avatarIsImage = isUserAvatarImage(userAvatar)

  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  function copy(): void {
    const text = isUser ? messagePlainText(message) : assistantCopyText(message)
    if (!text) return
    void writeClipboardText(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  async function speak(): Promise<void> {
    if (speaking) {
      stopTtsPlayback()
      setSpeaking(false)
      setSpeakHint(null)
      return
    }
    const text = isUser ? messagePlainText(message) : assistantReplyText(message)
    if (!text.trim()) return
    setSpeaking(true)
    setSpeakHint('合成中…')
    try {
      await speakTextWithTts(text, undefined, {
        onProgress: (cur, total) => {
          setSpeakHint(total > 1 ? `朗读 ${cur}/${total}` : '朗读中…')
        }
      })
      setSpeakHint(null)
    } catch (err) {
      setSpeakHint(err instanceof Error ? err.message : String(err))
    } finally {
      setSpeaking(false)
    }
  }

  async function pickImageAvatar(): Promise<void> {
    if (pickingImage) return
    setPickingImage(true)
    setPickerHint(null)
    try {
      const url = await window.petApi.pickUserAvatarImage()
      if (!url) return
      onUserAvatarChange(url)
      setPickerOpen(false)
    } catch {
      setPickerHint('选图失败')
    } finally {
      setPickingImage(false)
    }
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`msg ${isUser ? 'user' : 'assistant'}${highlight ? ' msg-hit' : ''}`}
    >
      <div className="avatar-wrap" ref={wrapRef}>
        {isUser ? (
          <button
            type="button"
            className={`avatar avatar-btn${avatarIsImage ? ' avatar-img' : ''}`}
            title={uiText("点击更换头像")}
            aria-label={uiText("更换用户头像")}
            onClick={() => setPickerOpen((v) => !v)}
          >
            {avatarIsImage ? <img src={userAvatar} alt="" draggable={false} /> : userAvatar}
          </button>
        ) : petImage ? (
          <div className="avatar avatar-img" title={uiText("跟随宠物皮肤（在宠物上右键可换）")}>
            <img src={petImage} alt="" />
          </div>
        ) : (
          <div className="avatar" title={uiText("跟随宠物皮肤（在宠物上右键可换）")}>
            {petEmoji}
          </div>
        )}
        {isUser && pickerOpen && (
          <div className="avatar-picker" role="listbox" aria-label={uiText("选择头像")}>
            {USER_AVATAR_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                className={`avatar-pick ${!avatarIsImage && e === userAvatar ? 'on' : ''}`}
                onClick={() => {
                  onUserAvatarChange(e)
                  setPickerOpen(false)
                }}
              >
                {e}
              </button>
            ))}
            <div className="avatar-picker-custom">
              <input
                placeholder={uiText("粘贴 emoji")}
                value={customDraft}
                maxLength={16}
                onChange={(e) => {
                  setCustomDraft(e.target.value)
                  setPickerHint(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const next = sanitizeUserAvatar(customDraft)
                    if (!next) {
                      setPickerHint('请贴 emoji')
                      return
                    }
                    onUserAvatarChange(next)
                    setCustomDraft('')
                    setPickerHint(null)
                    setPickerOpen(false)
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const next = sanitizeUserAvatar(customDraft)
                  if (!next) {
                    setPickerHint('请贴 emoji')
                    return
                  }
                  onUserAvatarChange(next)
                  setCustomDraft('')
                  setPickerHint(null)
                  setPickerOpen(false)
                }}
              >
                ✓
              </button>
            </div>
            <button
              type="button"
              className={`avatar-picker-image${avatarIsImage ? ' on' : ''}`}
              disabled={pickingImage}
              onClick={() => void pickImageAvatar()}
            >
              {pickingImage ? uiText("选择中…") : avatarIsImage ? uiText("更换图片") : uiText("选图片")}
            </button>
            {avatarIsImage && (
              <div className="avatar-picker-preview" title={uiText("当前图片头像")}>
                <img src={userAvatar} alt="" draggable={false} />
              </div>
            )}
            {pickerHint && <div className="avatar-picker-hint">{pickerHint}</div>}
          </div>
        )}
      </div>
      <div className="bubble-wrap">
        <div className="bubble">
          {hasVisibleText ? (
            displayBlocks.map((b, i) => (
              <Block
                key={i}
                block={b}
                visibility={detailVisibility}
                streaming={streaming}
                onOpenFilePreview={onOpenFilePreview}
                markdownImagePaths={markdownImagePaths}
              />
            ))
          ) : !streaming ? (
            <span className="muted">
              {!isUser && formatRunUsage(message.runUsage)
                ? uiText("本轮有用量但未收到正文（可重发）")
                : hasContent
                  ? uiText("（过程已隐藏，点顶栏「过程」显示工具与旁白）")
                  : uiText("（无正文）")}
            </span>
          ) : null}
          {streaming ? <TypingDots trailing={hasVisibleText} /> : null}
        </div>
        {showMsgFooter ? (
          <div
            className={`msg-footer${speaking || speakHint ? ' is-active' : ''}${
              usageText ? ' has-usage' : ''
            }`}
          >
            {showMsgActs ? (
              <div className="msg-actions">
                <button className="msg-act" title={uiText("复制")} onClick={copy}>
                  {copied ? uiText("已复制") : uiText("复制")}
                </button>
                {ttsEnabled &&
                !streaming &&
                (isUser ? messagePlainText(message) : assistantReplyText(message)) ? (
                  <button
                    className={`msg-act${speaking ? ' is-on' : ''}`}
                    title={
                      speakHint || (speaking ? uiText("停止朗读") : uiText("朗读（本机合成需几秒到几十秒）"))
                    }
                    onClick={() => void speak()}
                  >
                    {speaking ? uiText("停止") : uiText("朗读")}
                  </button>
                ) : null}
                {speakHint ? (
                  <span className="msg-act-hint" title={speakHint}>
                    {speakHint}
                  </span>
                ) : null}
                {canResend && onResend && (
                  <button
                    className="msg-act"
                    title={uiText("重新发送")}
                    onClick={() => onResend(message.id)}
                  >
                    {uiText("重发")}</button>
                )}
              </div>
            ) : null}
            {usageText ? (
              <span className="msg-run-usage" title={formatRunUsageTitle(message.runUsage)}>
                {usageText}
              </span>
            ) : null}
          </div>
        ) : null}
        {quickReplies && quickReplies.length > 0 && onPick && (
          <div className="quick-replies">
            {quickReplies.map((o, i) => (
              <button className="quick-reply" key={i} onClick={() => onPick(o)} title={o}>
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

const ERROR_FIX_LABEL: Record<AgentErrorFix, string> = {
  'engine-setup': '去装引擎 / 登录',
  'api-config': '去填 API Key',
  'model-config': '去换模型',
  'pick-dir': '选目录',
  none: ''
}

/** 失败后的自救条：一句人话 + 下一步 + 直达修复入口，不用用户自己读堆栈。 */
function AgentErrorBar({
  info,
  canRetry,
  onFix,
  onRetry,
  onDismiss
}: {
  info: AgentErrorInfo
  canRetry: boolean
  onFix: () => void
  onRetry: () => void
  onDismiss: () => void
}): JSX.Element {
  useUiLocale()
  const fixLabel = ERROR_FIX_LABEL[info.fix]
  return (
    <div className="agent-error-bar" role="alert">
      <div className="agent-error-text">
        <strong className="agent-error-summary">⚠️ {info.summary}</strong>
        {info.steps.length > 0 && (
          <ul className="agent-error-steps">
            {info.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="agent-error-acts">
        {fixLabel ? (
          <button
            type="button"
            className={`settings-btn tiny${info.retriable ? ' ghost' : ''}`}
            onClick={onFix}
          >
            {fixLabel}
          </button>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            className={`settings-btn tiny${info.retriable ? '' : ' ghost'}`}
            onClick={onRetry}
          >
            {uiText("重试")}</button>
        ) : null}
        <button
          type="button"
          className="agent-error-close"
          title={uiText("关闭提示")}
          aria-label={uiText("关闭错误提示")}
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
    </div>
  )
}

function EmptyState({
  demoMode,
  cwdSafe,
  onPickDir,
  onOpenSetup
}: {
  demoMode: boolean
  cwdSafe: boolean
  onPickDir: () => void
  onOpenSetup: () => void
}): JSX.Element {
  useUiLocale()
  return (
    <div className="empty empty-chat">
      <div className="empty-emoji" aria-hidden>
        🐾
      </div>
      <h2>{uiText("新对话")}</h2>
      <p className="muted">{uiText("直接在下方输入，Enter 发送。")}</p>

      {(!cwdSafe || demoMode) && (
        <div className="empty-soft-tips" role="note">
          {!cwdSafe && (
            <p>
              {uiText("还没选项目目录（不能用主目录）。")}<button type="button" className="empty-link" onClick={onPickDir}>
                {uiText("选目录")}</button>
            </p>
          )}
          {demoMode && (
            <p>
              {uiText("当前是演示回复。要真实引擎或 IDE 联动，去设置里的安装助手。")}<button type="button" className="empty-link" onClick={onOpenSetup}>
                {uiText("打开设置")}</button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
