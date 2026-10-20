import { t as uiText } from './i18n'
/**
 * 轻量 Agent 联想记忆：实体边表 + 开关。
 * 图存 JSON（主进程）；设置只存 enabled / chatterHints。
 */

export type AgentMemoryNodeKind =
  | 'person'
  | 'project'
  | 'tech'
  | 'pref'
  | 'topic'
  | 'task'
  | 'other'

export interface AgentMemoryNode {
  id: string
  name: string
  kind: AgentMemoryNodeKind
  updatedAt: number
}

export interface AgentMemoryEdge {
  id: string
  subjectId: string
  predicate: string
  objectId: string
  at: number
  note?: string
  /** 被更新事实覆盖 */
  invalid?: boolean
}

export interface AgentMemoryGraph {
  nodes: AgentMemoryNode[]
  edges: AgentMemoryEdge[]
}

export interface AgentMemorySettings {
  /** 默认关：开启后对话结束异步抽边，读时注入 1 跳联想。 */
  enabled: boolean
  /** 主进程写入的短联想句，供宠物 idle 念叨。 */
  chatterHints?: string[]
}

/** 最近一次抽取结果（主进程内存；不要求落盘）。 */
export interface AgentMemoryLastStatus {
  ok: boolean
  at: number
  reason: string
  added?: number
}

/** getAgentMemoryStats / IPC 返回。 */
export interface AgentMemoryStatsResult {
  enabled: boolean
  nodes: number
  edges: number
  modelRef?: string
  lastStatus?: AgentMemoryLastStatus
  /** 最近有效边的人读短句（最多 5）。 */
  recentFacts: string[]
  /** 本次发送已注入召回时由 memory:changed 带上。 */
  usedRecall?: boolean
  preview?: string
  recallLines?: number
}

export type AgentMemoryStatusKind =
  | 'disabled'
  | 'no_conversation'
  | 'no_pending_turn'
  | 'too_short'
  | 'extract_busy'
  | 'no_model'
  | 'no_complete_fn'
  | 'no_triples'
  | 'empty_output'
  | 'error'
  | 'ok'

export interface AgentMemoryTriple {
  subject: string
  predicate: string
  object: string
  subjectKind?: AgentMemoryNodeKind
  objectKind?: AgentMemoryNodeKind
  note?: string
}

export const DEFAULT_AGENT_MEMORY_SETTINGS: AgentMemorySettings = { enabled: false }

export const EMPTY_AGENT_MEMORY_GRAPH: AgentMemoryGraph = { nodes: [], edges: [] }

const MAX_NODES = 200
const MAX_EDGES = 500
const MAX_CHATTER = 3
const MAX_TRIPLES_PER_TURN = 8
const MAX_RECALL_LINES = 8

const NODE_KINDS: ReadonlySet<string> = new Set([
  'person',
  'project',
  'tech',
  'pref',
  'topic',
  'task',
  'other'
])

export function normalizeAgentMemorySettings(raw: unknown): AgentMemorySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AGENT_MEMORY_SETTINGS }
  const o = raw as Partial<AgentMemorySettings>
  const hints = Array.isArray(o.chatterHints)
    ? o.chatterHints
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 80))
        .slice(0, MAX_CHATTER)
    : undefined
  return {
    enabled: o.enabled === true,
    ...(hints?.length ? { chatterHints: hints } : {})
  }
}

export function nodeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64)
}

function isKind(v: unknown): v is AgentMemoryNodeKind {
  return typeof v === 'string' && NODE_KINDS.has(v)
}

export function normalizeGraph(raw: unknown): AgentMemoryGraph {
  if (!raw || typeof raw !== 'object') return { nodes: [], edges: [] }
  const o = raw as Partial<AgentMemoryGraph>
  const nodes = Array.isArray(o.nodes)
    ? o.nodes
        .filter(
          (n): n is AgentMemoryNode =>
            !!n &&
            typeof n === 'object' &&
            typeof (n as AgentMemoryNode).id === 'string' &&
            typeof (n as AgentMemoryNode).name === 'string'
        )
        .map((n) => ({
          id: n.id.slice(0, 80),
          name: n.name.trim().slice(0, 64),
          kind: isKind(n.kind) ? n.kind : 'other',
          updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now()
        }))
        .filter((n) => n.id && n.name)
        .slice(0, MAX_NODES)
    : []
  const edges = Array.isArray(o.edges)
    ? o.edges
        .filter(
          (e): e is AgentMemoryEdge =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as AgentMemoryEdge).id === 'string' &&
            typeof (e as AgentMemoryEdge).subjectId === 'string' &&
            typeof (e as AgentMemoryEdge).predicate === 'string' &&
            typeof (e as AgentMemoryEdge).objectId === 'string'
        )
        .map((e) => ({
          id: e.id.slice(0, 80),
          subjectId: e.subjectId.slice(0, 80),
          predicate: e.predicate.trim().slice(0, 32),
          objectId: e.objectId.slice(0, 80),
          at: typeof e.at === 'number' ? e.at : Date.now(),
          note: typeof e.note === 'string' ? e.note.slice(0, 120) : undefined,
          invalid: e.invalid === true ? true : undefined
        }))
        .filter((e) => e.id && e.subjectId && e.predicate && e.objectId)
        .slice(0, MAX_EDGES)
    : []
  return { nodes, edges }
}

/** 从模型输出里抠三元组数组（失败返回空）。 */
function triplesFromParsed(parsed: unknown): AgentMemoryTriple[] | null {
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? [parsed]
      : null
  if (!arr) return null
  const out: AgentMemoryTriple[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const subject = String(r.s ?? r.subject ?? '').trim()
    const predicate = String(r.p ?? r.predicate ?? '').trim()
    const object = String(r.o ?? r.object ?? '').trim()
    if (!subject || !predicate || !object) continue
    if (subject.length > 64 || object.length > 64) continue
    const kindS = r.kindS ?? r.subjectKind
    const kindO = r.kindO ?? r.objectKind
    out.push({
      subject: subject.slice(0, 64),
      predicate: predicate.slice(0, 32),
      object: object.slice(0, 64),
      subjectKind: isKind(kindS) ? kindS : undefined,
      objectKind: isKind(kindO) ? kindO : undefined,
      note: typeof r.note === 'string' ? r.note.slice(0, 120) : undefined
    })
    if (out.length >= MAX_TRIPLES_PER_TURN) break
  }
  return out
}

function tryParseTriplesSlice(slice: string): AgentMemoryTriple[] | null {
  try {
    return triplesFromParsed(JSON.parse(slice) as unknown)
  } catch {
    return null
  }
}

function matchJsonBrace(text: string, from: number): number {
  if (text[from] !== '{') return -1
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = from; i < text.length; i++) {
    const c = text[i]!
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\') {
        esc = true
        continue
      }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

export function parseTriplesFromModelText(text: string): AgentMemoryTriple[] {
  const trimmed = (text || '').trim()
  if (!trimmed) return []
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence?.[1]?.trim() || trimmed
  const attempts: string[] = []
  const a0 = body.indexOf('[')
  const a1 = body.lastIndexOf(']')
  if (a0 >= 0 && a1 > a0) attempts.push(body.slice(a0, a1 + 1))
  const lastOpen = body.lastIndexOf('[')
  if (lastOpen >= 0 && a1 > lastOpen && lastOpen !== a0) {
    attempts.push(body.slice(lastOpen, a1 + 1))
  }
  attempts.push(body)
  const o0 = body.indexOf('{')
  const o1 = body.lastIndexOf('}')
  if (o0 >= 0 && o1 > o0) attempts.push(body.slice(o0, o1 + 1))
  const keyHit = body.match(/\{\s*"(?:s|subject)"\s*:/)
  if (keyHit && keyHit.index !== undefined) {
    const end = matchJsonBrace(body, keyHit.index)
    if (end > keyHit.index) attempts.push(body.slice(keyHit.index, end + 1))
  }
  for (const slice of attempts) {
    const got = tryParseTriplesSlice(slice)
    if (got) return got
  }
  return []
}

function ensureNode(
  graph: AgentMemoryGraph,
  name: string,
  kind: AgentMemoryNodeKind | undefined,
  at: number
): AgentMemoryNode {
  const id = nodeKey(name)
  const existing = graph.nodes.find((n) => n.id === id)
  if (existing) {
    existing.updatedAt = at
    if (kind && existing.kind === 'other') existing.kind = kind
    if (name.trim().length > existing.name.length) existing.name = name.trim().slice(0, 64)
    return existing
  }
  const node: AgentMemoryNode = {
    id,
    name: name.trim().slice(0, 64),
    kind: kind || 'other',
    updatedAt: at
  }
  graph.nodes.unshift(node)
  return node
}

function edgeId(subjectId: string, predicate: string, objectId: string): string {
  return `${subjectId}|${predicate}|${objectId}`.slice(0, 80)
}

/** 写入三元组：同主谓不同宾则作废旧边；超限裁剪。 */
export function upsertTriples(
  graph: AgentMemoryGraph,
  triples: AgentMemoryTriple[],
  at = Date.now()
): { graph: AgentMemoryGraph; added: AgentMemoryEdge[]; chatterHints: string[] } {
  const next: AgentMemoryGraph = {
    nodes: graph.nodes.map((n) => ({ ...n })),
    edges: graph.edges.map((e) => ({ ...e }))
  }
  const added: AgentMemoryEdge[] = []
  const chatterHints: string[] = []

  for (const t of triples) {
    const sName = t.subject.trim()
    const oName = t.object.trim()
    const pred = t.predicate.trim()
    if (!sName || !oName || !pred) continue
    const sub = ensureNode(next, sName, t.subjectKind, at)
    const obj = ensureNode(next, oName, t.objectKind, at)
    const id = edgeId(sub.id, pred, obj.id)
    if (next.edges.some((e) => e.id === id && !e.invalid)) continue

    for (const e of next.edges) {
      if (!e.invalid && e.subjectId === sub.id && e.predicate === pred && e.objectId !== obj.id) {
        e.invalid = true
      }
    }

    const edge: AgentMemoryEdge = {
      id,
      subjectId: sub.id,
      predicate: pred,
      objectId: obj.id,
      at,
      note: t.note
    }
    next.edges.unshift(edge)
    added.push(edge)
    chatterHints.push(`记得你${pred}「${obj.name}」（和「${sub.name}」有关）`)
  }

  pruneGraph(next)
  return {
    graph: next,
    added,
    chatterHints: chatterHints.slice(0, MAX_CHATTER)
  }
}

function pruneGraph(graph: AgentMemoryGraph): void {
  if (graph.edges.length > MAX_EDGES) {
    const live = graph.edges.filter((e) => !e.invalid)
    const dead = graph.edges.filter((e) => e.invalid).sort((a, b) => a.at - b.at)
    const keepLive = live.sort((a, b) => b.at - a.at).slice(0, MAX_EDGES)
    const room = Math.max(0, MAX_EDGES - keepLive.length)
    graph.edges = [...keepLive, ...dead.slice(-room)]
  }
  if (graph.nodes.length > MAX_NODES) {
    const used = new Set<string>()
    for (const e of graph.edges) {
      if (e.invalid) continue
      used.add(e.subjectId)
      used.add(e.objectId)
    }
    const keep = graph.nodes
      .filter((n) => used.has(n.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_NODES)
    const keepIds = new Set(keep.map((n) => n.id))
    graph.nodes = keep
    graph.edges = graph.edges.filter((e) => keepIds.has(e.subjectId) && keepIds.has(e.objectId))
  }
}

/** 从用户话里捞可能实体词（极简，无模型时也可种子召回）。 */
export function seedTermsFromText(text: string): string[] {
  const t = (text || '').trim()
  if (!t) return []
  const parts = t
    .split(/[\s,，。！？、；;:：\n/\\|()[\]{}「」『』"'`]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 32)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const k = nodeKey(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length >= 12) break
  }
  return out
}

function nameOf(graph: AgentMemoryGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.name || id
}

function formatFactLine(graph: AgentMemoryGraph, e: AgentMemoryEdge): string {
  return `${nameOf(graph, e.subjectId)} ${e.predicate} ${nameOf(graph, e.objectId)}${
    e.note ? `（${e.note}）` : ''
  }`
}

/** 最近有效边的人读短句，供设置页对照「记住了什么」。 */
const PREF_KINDS: ReadonlySet<AgentMemoryNodeKind> = new Set([
  'pref',
  'topic',
  'tech',
  'project',
  'task'
])

/** 评分用：从联想记忆压出用户偏好短表（关心/在做/讨厌/题目）。 */
export function formatPreferenceBrief(graph: AgentMemoryGraph, limit = 16): string {
  const live = graph.edges.filter((e) => !e.invalid)
  if (!live.length && !graph.nodes.length) return ''
  const lines: string[] = []
  const seen = new Set<string>()
  const push = (line: string): void => {
    const t = line.trim()
    if (!t || seen.has(t) || lines.length >= limit) return
    seen.add(t)
    lines.push(t)
  }
  for (const e of live) {
    const sub = graph.nodes.find((n) => n.id === e.subjectId)
    const obj = graph.nodes.find((n) => n.id === e.objectId)
    if (!sub || !obj) continue
    if (!PREF_KINDS.has(sub.kind) && !PREF_KINDS.has(obj.kind)) continue
    push(`${sub.name} ${e.predicate} ${obj.name}${e.note ? `（${e.note}）` : ''}`)
  }
  if (lines.length < Math.min(6, limit)) {
    for (const n of graph.nodes) {
      if (!PREF_KINDS.has(n.kind)) continue
      push(`${n.kind === 'pref' ? '偏好' : n.kind === 'topic' ? '题目' : n.kind === 'tech' ? '技术' : n.kind === 'project' ? '项目' : '任务'}：${n.name}`)
    }
  }
  if (!lines.length) return ''
  return uiText("【用户偏好（联想记忆）】\n{0}", [lines.map((l) => `- ${l}`).join('\n')])
}

/** 评分/启发式用的偏好词（人名项目技术题目）。 */
export function preferenceKeywordList(graph: AgentMemoryGraph, limit = 24): string[] {
  const cap = Math.max(0, limit)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string): void => {
    const t = name.trim().replace(/\s+/g, ' ')
    if (t.length < 2 || t.length > 24 || out.length >= cap) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  for (const n of graph.nodes) {
    if (!PREF_KINDS.has(n.kind)) continue
    push(n.name)
  }
  if (out.length < cap) {
    for (const e of graph.edges) {
      if (e.invalid) continue
      push(e.note || '')
    }
  }
  return out
}

export function formatRecentFactLines(graph: AgentMemoryGraph, limit = 5): string[] {
  const cap = Math.max(0, limit)
  const out: string[] = []
  for (const e of graph.edges) {
    if (e.invalid) continue
    out.push(formatFactLine(graph, e))
    if (out.length >= cap) break
  }
  return out
}

const RECALL_ASK_RE = /记得|上次|还记得|之前说过|remember/i

/** 用户在问「还记得 / 上次」时才允许退回最近边。 */
export function looksLikeRecallAsk(text: string): boolean {
  return RECALL_ASK_RE.test(text || '')
}

/** 1 跳邻居摘要；无命中时仅当用户在问「还记得」类问题时退回最近有效边。 */
export function formatRecallBlock(
  graph: AgentMemoryGraph,
  seeds: string[],
  userText = ''
): string {
  const live = graph.edges.filter((e) => !e.invalid)
  if (!live.length) return ''

  const seedKeys = seeds.map(nodeKey).filter(Boolean)
  const hitIds = new Set<string>()
  for (const n of graph.nodes) {
    for (const s of seedKeys) {
      if (!s) continue
      if (n.id === s || n.id.includes(s) || s.includes(n.id)) {
        hitIds.add(n.id)
        break
      }
      if (n.name.toLowerCase().includes(s)) {
        hitIds.add(n.id)
        break
      }
    }
  }

  const lines: string[] = []
  const pushEdge = (e: AgentMemoryEdge): void => {
    const line = `- ${formatFactLine(graph, e)}`
    if (!lines.includes(line)) lines.push(line)
  }

  if (hitIds.size) {
    for (const e of live) {
      if (hitIds.has(e.subjectId) || hitIds.has(e.objectId)) pushEdge(e)
      if (lines.length >= MAX_RECALL_LINES) break
    }
  }

  if (!lines.length && looksLikeRecallAsk(userText)) {
    for (const e of live.slice(0, MAX_RECALL_LINES)) pushEdge(e)
  }

  if (!lines.length) return ''
  return uiText("【联想记忆】（本地边表，供参考；过时可忽略）\n{0}", [lines.slice(0, MAX_RECALL_LINES).join('\n')])
}

export function mergeSystemWithAgentMemory(
  system?: string | null,
  recallBlock?: string | null
): string | undefined {
  const block = (recallBlock || '').trim()
  const sys = (system || '').trim()
  if (!block) return sys || undefined
  return sys ? `${sys}\n\n${block}` : block
}

export function mergeChatterHints(prev: string[] | undefined, next: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of [...next, ...(prev || [])]) {
    const t = x.trim().slice(0, 80)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_CHATTER) break
  }
  return out
}

export function chatterFromAgentMemoryHints(hints: string[] | undefined): Array<{
  text: string
  hint?: string
  action?: { kind: 'chat' }
}> {
  if (!hints?.length) return []
  return hints.slice(0, MAX_CHATTER).map((text) => ({
    text,
    hint: uiText("点击打开对话"),
    action: { kind: 'chat' as const }
  }))
}

/** 日记一行：便于人读 / 手改对照。 */
export function formatDiaryLines(triples: AgentMemoryTriple[], at = Date.now()): string[] {
  const stamp = new Date(at).toISOString()
  return triples.map(
    (t) => `- ${stamp} | ${t.subject} --${t.predicate}--> ${t.object}${t.note ? ` // ${t.note}` : ''}`
  )
}

export function buildExtractSystemPrompt(): string {
  return [
    '只输出 JSON 数组，禁止 markdown、禁止解释、禁止工具调用。无事实输出 []。',
    '每项: {"s":"主体","p":"关系","o":"客体","kindS":"person|project|tech|pref|topic|task|other","kindO":"...","note":"可选短注"}',
    '关系 p 用简短中文：关心/在做/用过/讨厌/相关/替代/发生于 等。',
    `最多 ${MAX_TRIPLES_PER_TURN} 条；只记稳定事实，不记一次性闲聊；无事实则 []。`
  ].join('\n')
}

export function buildExtractUserPrompt(userText: string, assistantText: string): string {
  return [
    '【用户】',
    userText.trim().slice(0, 2000),
    '',
    '【助手摘要】',
    assistantText.trim().slice(0, 2000)
  ].join('\n')
}

export function agentMemoryStats(graph: AgentMemoryGraph): { nodes: number; edges: number } {
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.filter((e) => !e.invalid).length
  }
}

const STATUS_REASON: Record<AgentMemoryStatusKind, string> = {
  disabled: '已关闭',
  no_conversation: '没有对应的对话',
  no_pending_turn: '还没聊过',
  too_short: '这轮太短',
  extract_busy: '上一轮还在记，这轮已排队',
  no_model: '没配默认引擎',
  no_complete_fn: '抽取通道未就绪',
  no_triples: '解析不到关系',
  empty_output: '模型空转',
  error: '上次出错',
  ok: 'ok'
}

/** 抽取失败原因的用户可见文案（设置页「抽不出来：…」）。 */
export function agentMemoryStatusReason(kind: AgentMemoryStatusKind): string {
  return STATUS_REASON[kind]
}

/** 设置页状态行：还没聊过 / 已记住 N 件事 / 抽不出来：原因。 */
export function formatAgentMemoryStatusLine(stats: {
  nodes: number
  edges: number
  lastStatus?: AgentMemoryLastStatus
}): string {
  const ls = stats.lastStatus
  if (ls && !ls.ok) {
    return uiText("抽不出来：{0}", [uiText(ls.reason)])
  }
  if (stats.nodes <= 0 && stats.edges <= 0) {
    return uiText("还没聊过（开启后先在这窗说一轮）")
  }
  return uiText("已记住 {0} 件事", [stats.nodes])
}
