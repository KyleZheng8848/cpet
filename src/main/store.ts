import { normalizeUiLanguage } from '../shared/i18n'
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatHistory, ChatStore, ScheduledTask, Settings, TodayMemo } from '../shared/types'

function keepFiredMemos(incoming: TodayMemo[], prev?: TodayMemo[]): TodayMemo[] {
  if (!prev?.length) return incoming
  const old = new Map(prev.map((m) => [m.id, m]))
  return incoming.map((m) => {
    const p = old.get(m.id)
    if (p?.firedAt && !m.firedAt) return { ...m, firedAt: p.firedAt }
    return m
  })
}
import {
  ensureBuiltinProviders,
  migrateLegacyModelPrefs,
  formatModelRef
} from '../shared/models'
import { isKnownBackend } from '../shared/agentBackends'
import { normalizePromptTemplates } from '../shared/prompts'
import { isUserHomeDir } from '../shared/cwd'
import { isChatThemeId, isNewsSourceId, normalizeChatThemeCustom } from '../shared/chatUi'
import { normalizeRssFeedUrls } from '../shared/rssBrief'
import {
  normalizeRssPaneWidths,
  normalizeRssScoreIntervalMinutes,
  normalizeRssScoreMode
} from '../shared/rssTask'
import { normalizeRssOrganizeLang } from '../shared/rssLang'
import { normalizeRssPetPushMinScore } from '../shared/petBubblePolicy'
import { normalizeBriefDailyDigestHours, normalizeInterestKeywords } from '../shared/briefInbox'
import { normalizeRssDigestIntervalHours } from '../shared/rssTask'
import { isAgentAutonomy } from '../shared/agentAutonomy'
import { isSkillDeliveryPref } from '../shared/skills'
import { normalizeWorkMemory } from '../shared/workMemory'
import { normalizeAgentMemorySettings } from '../shared/agentMemory'
import { normalizeChatStore } from '../shared/conversationGroups'
import { normalizeQuickChatSettings } from '../shared/quickChat'
import {
  excludeSchedulesForConversation,
  normalizeScheduledTask
} from '../shared/scheduledTask'
import { homedir } from 'node:os'

/**
 * 极简 JSON 持久化：设置与对话历史各存一个文件到 userData 目录。
 * 不引第三方依赖，读写都做容错。
 */

const DEFAULT_SETTINGS: Settings = { skin: 'violet', imageSkin: '数字佳人' }

function dir(): string {
  const d = app.getPath('userData')
  try {
    mkdirSync(d, { recursive: true })
  } catch {
    // ignore
  }
  return d
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(join(dir(), file), 'utf8')) }
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    writeFileSync(join(dir(), file), JSON.stringify(value, null, 2))
  } catch (err) {
    console.error('[cursor-pet] 写入失败', file, err)
  }
}

let settings: Settings | null = null

function normalizeSettings(raw: Settings): Settings {
  let modelProviders = raw.modelProviders
  if (!modelProviders?.length && raw.models?.length) {
    modelProviders = migrateLegacyModelPrefs(raw.models)
  } else {
    modelProviders = ensureBuiltinProviders(modelProviders)
  }
  let defaultModelRef = raw.defaultModelRef || formatModelRef('cursor', 'auto')
  // 纠正历史坏引用 cursor:cursor:xxx
  if (defaultModelRef.startsWith('cursor:cursor:')) {
    defaultModelRef = `cursor:${defaultModelRef.slice('cursor:cursor:'.length)}`
  }
  const defaultAvailable = modelProviders.some(
    (p) => p.enabled && p.models.some((m) => m.enabled && formatModelRef(p.id, m.id) === defaultModelRef)
  )
  if (!defaultAvailable) {
    const provider = modelProviders.find((p) => p.enabled && p.models.some((m) => m.enabled))
    defaultModelRef = provider
      ? formatModelRef(provider.id, provider.models.find((m) => m.enabled)!.id)
      : formatModelRef('cursor', 'auto')
  }
  const home = homedir()
  const cwd =
    typeof raw.cwd === 'string' && raw.cwd.trim() && !isUserHomeDir(raw.cwd, home)
      ? raw.cwd.trim()
      : undefined
  return {
    ...raw,
    uiLanguage: normalizeUiLanguage(raw.uiLanguage),
    cwd,
    modelProviders,
    agentBackend: raw.agentBackend && isKnownBackend(raw.agentBackend) ? raw.agentBackend : 'cursor',
    defaultModelRef,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    promptTemplates: normalizePromptTemplates(raw.promptTemplates),
    activePromptTemplateId: raw.activePromptTemplateId ?? null,
    quickChat: normalizeQuickChatSettings(raw.quickChat),
    chatTheme: isChatThemeId(raw.chatTheme) ? raw.chatTheme : undefined,
    chatThemeCustom: normalizeChatThemeCustom(raw.chatThemeCustom),
    weatherCity: typeof raw.weatherCity === 'string' ? raw.weatherCity.trim() : undefined,
    newsSource: isNewsSourceId(raw.newsSource) ? raw.newsSource : 'auto',
    briefRssFeeds: normalizeRssFeedUrls(raw.briefRssFeeds),
    briefInterestKeywords: normalizeInterestKeywords(raw.briefInterestKeywords),
    briefMuteKeywords: normalizeInterestKeywords(raw.briefMuteKeywords),
    briefDigestIntervalHours: normalizeRssDigestIntervalHours(raw.briefDigestIntervalHours),
    briefDailyDigestHours: normalizeRssDigestIntervalHours(raw.briefDigestIntervalHours)
      ? null
      : normalizeBriefDailyDigestHours(raw.briefDailyDigestHours, raw.briefDailyDigestHour),
    briefDailyDigestHour: undefined,
    rssScoreModelRef:
      typeof raw.rssScoreModelRef === 'string' ? raw.rssScoreModelRef.trim() : undefined,
    rssScoreMode: normalizeRssScoreMode(raw.rssScoreMode ?? 'realtime'),
    rssScoreIntervalMinutes: normalizeRssScoreIntervalMinutes(raw.rssScoreIntervalMinutes),
    rssOrganizeLang: normalizeRssOrganizeLang(raw.rssOrganizeLang),
    rssPetPushMinScore: normalizeRssPetPushMinScore(raw.rssPetPushMinScore),
    rssPaneWidths: normalizeRssPaneWidths(raw.rssPaneWidths),
    defaultAgentAutonomy: isAgentAutonomy(raw.defaultAgentAutonomy)
      ? raw.defaultAgentAutonomy
      : undefined,
    skillDelivery: isSkillDeliveryPref(raw.skillDelivery) ? raw.skillDelivery : 'auto',
    workMemory: normalizeWorkMemory(raw.workMemory),
    agentMemory: normalizeAgentMemorySettings(raw.agentMemory)
  }
}

export function getSettings(): Settings {
  if (!settings) {
    // 图片预设只用于首次启动，不能覆盖已保存的矢量或自定义皮肤选择。
    const saved = readJson<Settings | null>('settings.json', null)
    const loaded = normalizeSettings(Object.assign({ skin: 'violet' }, saved ?? DEFAULT_SETTINGS))
    settings = loaded
    // 启动时写回规范化结果（修复 cursor: 前缀 / 零启用等坏数据）
    writeJson('settings.json', loaded)
  }
  return settings
}

export function updateSettings(patch: Partial<Settings>): Settings {
  settings = normalizeSettings({ ...getSettings(), ...patch })
  writeJson('settings.json', settings)
  return settings
}

export function getHistory(): ChatHistory {
  return readJson<ChatHistory>('chat-history.json', { messages: [] })
}

export function saveHistory(history: ChatHistory): void {
  // 只保留最近 200 条，避免文件无限增长
  const trimmed: ChatHistory = {
    ...history,
    messages: history.messages.slice(-200)
  }
  writeJson('chat-history.json', trimmed)
}

const STORE_FILE = 'chat-store.json'

/** 读取多会话存储；不存在时尝试从旧的单会话历史迁移，否则返回 null。 */
export function getChatStore(): ChatStore | null {
  try {
    const raw = readFileSync(join(dir(), STORE_FILE), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    // 允许空列表（用户关掉全部任务）；勿当成「无文件」再自动塞一个
    const normalized = normalizeChatStore(parsed)
    if (normalized) return normalized
  } catch {
    // 无 store 文件，尝试迁移
  }
  const legacy = getHistory()
  if (legacy.messages && legacy.messages.length) {
    const now = Date.now()
    const id = 'c' + now.toString(36)
    return {
      conversations: [
        {
          id,
          title: '对话',
          messages: legacy.messages,
          sessionId: legacy.sessionId,
          createdAt: now,
          updatedAt: now
        }
      ],
      activeId: id,
      groups: []
    }
  }
  return null
}

export function saveChatStore(store: ChatStore): void {
  const normalized = normalizeChatStore(store) || {
    conversations: store.conversations || [],
    activeId: store.activeId || '',
    groups: []
  }
  const prev = readJson<ChatStore | null>(STORE_FILE, null)
  const todayMemos =
    store.todayMemos !== undefined
      ? keepFiredMemos(normalized.todayMemos || [], prev?.todayMemos)
      : prev?.todayMemos
  const todayReadLaneOrder =
    store.todayReadLaneOrder !== undefined
      ? normalized.todayReadLaneOrder || []
      : prev?.todayReadLaneOrder
  const todayHeldDones =
    store.todayHeldDones !== undefined ? normalized.todayHeldDones || [] : prev?.todayHeldDones
  const trimmed: ChatStore = {
    activeId: normalized.activeId,
    groups: normalized.groups || [],
    ungroupedLabel: normalized.ungroupedLabel,
    lastChatInteractedId: normalized.lastChatInteractedId,
    ...(todayMemos?.length ? { todayMemos } : {}),
    ...(todayReadLaneOrder?.length ? { todayReadLaneOrder } : {}),
    ...(todayHeldDones?.length ? { todayHeldDones } : {}),
    // 每会话最多留 200 条；整体最多 30 个会话
    conversations: normalized.conversations.slice(-30).map((c) => ({
      ...c,
      messages: c.messages.slice(-200),
      lanes: c.lanes
        ? Object.fromEntries(
            Object.entries(c.lanes).map(([mid, lane]) => [
              mid,
              { ...lane, messages: lane.messages.slice(-200) }
            ])
          )
        : c.lanes
    }))
  }
  writeJson(STORE_FILE, trimmed)
}

const SCHEDULES_FILE = 'schedules.json'

export function getSchedules(): ScheduledTask[] {
  try {
    const raw = readFileSync(join(dir(), SCHEDULES_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => normalizeScheduledTask(x))
      .filter((x): x is ScheduledTask => !!x)
  } catch {
    return []
  }
}

export function saveSchedules(tasks: ScheduledTask[]): void {
  writeJson(SCHEDULES_FILE, tasks.slice(-50))
}

export function upsertSchedule(task: ScheduledTask): ScheduledTask {
  const normalized = normalizeScheduledTask(task) || task
  const tasks = getSchedules()
  const i = tasks.findIndex((t) => t.id === normalized.id)
  if (i >= 0) tasks[i] = normalized
  else tasks.push(normalized)
  saveSchedules(tasks)
  return normalized
}

export function removeSchedule(id: string): void {
  saveSchedules(getSchedules().filter((t) => t.id !== id))
}

export function removeSchedulesForConversation(conversationId: string): number {
  const before = getSchedules()
  const next = excludeSchedulesForConversation(before, conversationId)
  const removed = before.length - next.length
  if (removed > 0) saveSchedules(next)
  return removed
}
