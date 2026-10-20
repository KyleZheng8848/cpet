/**
 * Agent 联想记忆：JSON 边表 + 日记 Markdown；异步抽取，失败不影响对话。
 */

import { app } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMPTY_AGENT_MEMORY_GRAPH,
  agentMemoryStats,
  agentMemoryStatusReason,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  formatDiaryLines,
  formatPreferenceBrief,
  preferenceKeywordList,
  formatRecallBlock,
  formatRecentFactLines,
  mergeChatterHints,
  normalizeAgentMemorySettings,
  normalizeGraph,
  parseTriplesFromModelText,
  seedTermsFromText,
  upsertTriples,
  type AgentMemoryGraph,
  type AgentMemoryLastStatus,
  type AgentMemorySettings,
  type AgentMemoryStatsResult,
  type AgentMemoryStatusKind
} from '../shared/agentMemory'
import { IPC } from '../shared/types'
import { getSettings, updateSettings } from './store'
import { getChatWindow } from './windows'

export type AgentMemoryCompleteFn = (
  modelRef: string,
  system: string,
  user: string,
  timeoutMs: number
) => Promise<string>

let completeFn: AgentMemoryCompleteFn | null = null
let graphCache: AgentMemoryGraph | null = null
let extractBusy = false
const pendingTurns = new Map<string, { user: string; at: number }>()
/** 抽取进行中时最多再挂一轮，避免直接丢掉。 */
let queuedExtract: { conversationId: string; assistantText: string } | null = null
let lastStatus: AgentMemoryLastStatus | null = null

const GRAPH_FILE = 'agent-memory.json'
const DIARY_DIR = 'memory'

export function setAgentMemoryComplete(fn: AgentMemoryCompleteFn | null): void {
  completeFn = fn
}

function userDataDir(): string {
  const d = app.getPath('userData')
  try {
    mkdirSync(d, { recursive: true })
  } catch {
    // ignore
  }
  return d
}

function graphPath(): string {
  return join(userDataDir(), GRAPH_FILE)
}

function diaryPath(at = Date.now()): string {
  const d = join(userDataDir(), DIARY_DIR)
  try {
    mkdirSync(d, { recursive: true })
  } catch {
    // ignore
  }
  const day = new Date(at).toISOString().slice(0, 10)
  return join(d, `${day}.md`)
}

function pushMemoryChanged(extra?: {
  usedRecall?: boolean
  preview?: string
  recallLines?: number
}): void {
  try {
    getChatWindow()?.webContents.send(IPC.memoryChanged, {
      ...getAgentMemoryStats(),
      ...extra
    })
  } catch {
    // 窗未就绪时忽略
  }
}

function setLastStatus(kind: AgentMemoryStatusKind, extra?: { added?: number }): void {
  lastStatus = {
    ok: kind === 'ok',
    at: Date.now(),
    reason: agentMemoryStatusReason(kind),
    ...(extra?.added !== undefined ? { added: extra.added } : {})
  }
  pushMemoryChanged()
}

export function loadAgentMemoryGraph(): AgentMemoryGraph {
  if (graphCache) return graphCache
  try {
    const raw = JSON.parse(readFileSync(graphPath(), 'utf8')) as unknown
    graphCache = normalizeGraph(raw)
  } catch {
    graphCache = { nodes: [], edges: [] }
  }
  return graphCache
}

function saveAgentMemoryGraph(graph: AgentMemoryGraph): void {
  const normalized = normalizeGraph(graph)
  graphCache = normalized
  try {
    writeFileSync(graphPath(), JSON.stringify(normalized, null, 2), 'utf8')
  } catch (err) {
    console.error('[cursor-pet] agent-memory 写入失败', err)
  }
}

export function clearAgentMemoryGraph(): { ok: true; nodes: number; edges: number } {
  graphCache = { ...EMPTY_AGENT_MEMORY_GRAPH, nodes: [], edges: [] }
  saveAgentMemoryGraph(graphCache)
  pendingTurns.clear()
  queuedExtract = null
  lastStatus = null
  const cur = normalizeAgentMemorySettings(getSettings().agentMemory)
  updateSettings({
    agentMemory: { enabled: cur.enabled, chatterHints: [] }
  })
  return { ok: true, nodes: 0, edges: 0 }
}

export function getAgentMemoryStats(): AgentMemoryStatsResult {
  const enabled = normalizeAgentMemorySettings(getSettings().agentMemory).enabled
  const stats = agentMemoryStats(loadAgentMemoryGraph())
  const modelRef = resolveExtractModelRef()
  return {
    enabled,
    ...stats,
    recentFacts: formatRecentFactLines(loadAgentMemoryGraph(), 5),
    ...(modelRef ? { modelRef } : {}),
    ...(lastStatus ? { lastStatus } : {})
  }
}

export function isAgentMemoryEnabled(): boolean {
  return normalizeAgentMemorySettings(getSettings().agentMemory).enabled
}

/** 发送前记下用户话，供 done 时抽取。 */
export function noteAgentMemoryTurn(conversationId: string | undefined, userText: string): void {
  if (!isAgentMemoryEnabled()) return
  const id = (conversationId || '').trim()
  const user = (userText || '').trim()
  if (!id || !user) return
  if (id.startsWith('rss-intel-')) return
  pendingTurns.set(id, { user: user.slice(0, 4000), at: Date.now() })
  // 防止泄漏：最多挂 40 条
  if (pendingTurns.size > 40) {
    const oldest = [...pendingTurns.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) pendingTurns.delete(oldest[0])
  }
}

/** 资讯评分用：偏好短表。记忆关着也给，空则返回空串。 */
export function recallAgentMemoryPrefBrief(): string {
  try {
    const graph = loadAgentMemoryGraph()
    return formatPreferenceBrief(graph)
  } catch {
    return ''
  }
}

/** 资讯启发式：偏好词表。 */
export function recallAgentMemoryPrefKeywords(): string[] {
  try {
    return preferenceKeywordList(loadAgentMemoryGraph())
  } catch {
    return []
  }
}

/** 读路径：按用户话种子做 1 跳联想摘要。 */
export function recallAgentMemoryBlock(userText: string): string {
  if (!isAgentMemoryEnabled()) return ''
  try {
    const graph = loadAgentMemoryGraph()
    const block = formatRecallBlock(graph, seedTermsFromText(userText), userText)
    if (block) {
      const facts = block
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
        .filter(Boolean)
      pushMemoryChanged({
        usedRecall: true,
        preview: facts[0] || '',
        recallLines: facts.length
      })
    }
    return block
  } catch {
    return ''
  }
}

function resolveExtractModelRef(): string | undefined {
  const s = getSettings()
  const ref = (s.rssScoreModelRef || s.defaultModelRef || '').trim()
  return ref || undefined
}

function appendDiary(lines: string[], at: number): void {
  if (!lines.length) return
  try {
    const path = diaryPath(at)
    const header = existsSync(path) ? '' : `# CPET 记忆日记 ${new Date(at).toISOString().slice(0, 10)}\n\n`
    appendFileSync(path, header + lines.join('\n') + '\n', 'utf8')
  } catch (err) {
    console.error('[cursor-pet] agent-memory 日记写入失败', err)
  }
}

/**
 * 对话结束后异步抽边。不 await；失败写入 lastStatus，不影响对话。
 */
export function scheduleAgentMemoryExtract(opts: {
  conversationId?: string
  assistantText?: string
}): void {
  if (!isAgentMemoryEnabled()) {
    setLastStatus('disabled')
    return
  }
  const id = (opts.conversationId || '').trim()
  if (!id || id.startsWith('rss-intel-')) {
    setLastStatus('no_conversation')
    return
  }
  if (extractBusy) {
    queuedExtract = { conversationId: id, assistantText: opts.assistantText || '' }
    setLastStatus('extract_busy')
    return
  }
  const pending = pendingTurns.get(id)
  pendingTurns.delete(id)
  if (!pending?.user) {
    setLastStatus('no_pending_turn')
    return
  }
  const assistant = (opts.assistantText || '').trim()
  if (pending.user.length < 4 && assistant.length < 20) {
    setLastStatus('too_short')
    return
  }

  const modelRef = resolveExtractModelRef()
  if (!modelRef) {
    setLastStatus('no_model')
    return
  }
  if (!completeFn) {
    setLastStatus('no_complete_fn')
    return
  }

  extractBusy = true
  const at = Date.now()
  const runComplete = completeFn
  void (async () => {
    try {
      // 再次确认开关（期间可能被关掉）
      if (!isAgentMemoryEnabled()) {
        setLastStatus('disabled')
        return
      }
      const raw = await runComplete(
        modelRef,
        buildExtractSystemPrompt(),
        buildExtractUserPrompt(pending.user, assistant),
        45_000
      )
      const trimmed = (raw || '').trim()
      if (!trimmed) {
        setLastStatus('empty_output')
        return
      }
      const triples = parseTriplesFromModelText(raw)
      if (!triples.length) {
        setLastStatus('no_triples')
        return
      }
      const { graph, added, chatterHints } = upsertTriples(loadAgentMemoryGraph(), triples, at)
      if (!added.length) {
        setLastStatus('ok', { added: 0 })
        return
      }
      saveAgentMemoryGraph(graph)
      appendDiary(formatDiaryLines(triples, at), at)
      const cur = normalizeAgentMemorySettings(getSettings().agentMemory)
      updateSettings({
        agentMemory: {
          enabled: cur.enabled,
          chatterHints: mergeChatterHints(cur.chatterHints, chatterHints)
        }
      })
      setLastStatus('ok', { added: added.length })
    } catch (err) {
      console.warn('[cursor-pet] agent-memory 抽取跳过', err instanceof Error ? err.message : err)
      setLastStatus('error')
    } finally {
      extractBusy = false
      const next = queuedExtract
      queuedExtract = null
      if (next) {
        scheduleAgentMemoryExtract(next)
      }
    }
  })()
}

export function setAgentMemoryEnabled(enabled: boolean): AgentMemorySettings {
  const cur = normalizeAgentMemorySettings(getSettings().agentMemory)
  const next: AgentMemorySettings = {
    enabled: !!enabled,
    ...(cur.chatterHints?.length ? { chatterHints: cur.chatterHints } : {})
  }
  updateSettings({ agentMemory: next })
  return next
}
