import type { ModelPref, ModelProvider, ProviderModel, Conversation, CompareLaneRef } from './types'
import { isKnownBackend } from './agentBackends'
import { emptyRssTaskState, normalizeRssTaskState } from './rssTask'

export type ModelProviderKind =
  | 'cursor'
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'custom'

export const DEFAULT_CURSOR_MODELS = ['auto', 'composer-2.5', 'composer-2.5-fast'] as const
export const DEFAULT_CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'default'] as const
export const DEFAULT_CODEX_MODELS = [
  'default',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4'
] as const
/**
 * OpenCode 模型 id 为 `provider/model`（如 anthropic/claude-sonnet-4）。
 * 默认只种 default（不传 -m，用 OpenCode 自己的默认模型）；真列表靠 catalog + 自定义 API 注入。
 */
export const DEFAULT_OPENCODE_MODELS = ['default'] as const

/**
 * 其它提供商的模型不应出现在 OpenAI Codex（`codex:`）选单。
 */
export function isForeignCodexModelId(id: string): boolean {
  const s = id.trim().toLowerCase()
  if (!s) return true
  return (
    /antchat|glink|codefuse|ling-|ring-|glm-|deepseek|minimax|kimi|qwen|doubao|moonshot/.test(
      s
    ) || s.includes('/')
  )
}

/** 去掉误加的 `provider:` 前缀（历史 listModels bug 会把 cursor:auto 存成模型 id）。 */
export function bareModelId(providerId: string, modelId: string): string {
  const id = (modelId || '').trim()
  const prefix = `${providerId}:`
  return id.startsWith(prefix) ? id.slice(prefix.length) || id : id
}

export function formatModelRef(providerId: string, modelId: string): string {
  return `${providerId}:${bareModelId(providerId, modelId)}`
}

export function parseModelRef(ref: string): { provider: string; model: string } {
  const s = (ref || '').trim()
  const i = s.indexOf(':')
  if (i <= 0) return { provider: 'cursor', model: s || 'auto' }
  return { provider: s.slice(0, i), model: s.slice(i + 1) || 'auto' }
}

export function isLegacyBareModelId(id: string): boolean {
  return Boolean(id) && !id.includes(':')
}

/** 旧扁平 ModelPref → 挂到 cursor 提供商（兼容迁移）。 */
export function migrateLegacyModelPrefs(prefs: ModelPref[] | undefined): ModelProvider[] {
  const cursorModels: ProviderModel[] = (prefs ?? []).map((p, i) => {
    const bare = isLegacyBareModelId(p.id) ? p.id : parseModelRef(p.id).model
    return {
      id: bare,
      label: p.label || bare,
      enabled: p.enabled,
      order: p.order ?? i
    }
  })
  return ensureBuiltinProviders([
    {
      id: 'cursor',
      kind: 'cursor',
      label: 'Cursor',
      enabled: true,
      order: 0,
      models: cursorModels.length
        ? cursorModels
        : DEFAULT_CURSOR_MODELS.map((id, i) => ({
            id,
            label: id,
            enabled: true,
            order: i
          }))
    }
  ])
}

export function ensureBuiltinProviders(providers: ModelProvider[] | undefined): ModelProvider[] {
  const list = (providers ?? []).filter((p) => {
    // 仅作旧设置迁移：避免已移除的内部接入被当作自定义 API 重新启用。
    if (/^(cfuse|codefuse|dtcoder|theta|antchat)$/i.test(p.id)) return false
    if (p.kind === 'custom') {
      try {
        const host = new URL(p.baseUrl || '').hostname.toLowerCase()
        if (host === 'alipay.com' || host.endsWith('.alipay.com')) return false
      } catch {
        // 未填完的 API 配置仍保留，交给设置页继续编辑。
      }
      return true
    }
    return isKnownBackend(p.id) && p.id === p.kind
  })
  const byId = new Map(list.map((p) => [p.id, p]))

  if (!byId.has('cursor')) {
    list.push({
      id: 'cursor',
      kind: 'cursor',
      label: 'Cursor',
      enabled: true,
      order: 0,
      models: DEFAULT_CURSOR_MODELS.map((id, i) => ({
        id,
        label: id,
        enabled: true,
        order: i
      }))
    })
  }
  if (!byId.has('openclaw')) {
    list.push({
      id: 'openclaw',
      kind: 'openclaw',
      label: 'OpenClaw',
      enabled: true,
      order: 1,
      models: [{ id: 'main', label: 'main', enabled: true, order: 0 }]
    })
  }
  if (!byId.has('claude-code')) {
    list.push({
      id: 'claude-code',
      kind: 'claude-code',
      label: 'Claude Code',
      enabled: true,
      order: 2,
      models: DEFAULT_CLAUDE_MODELS.map((id, i) => ({
        id,
        label: id,
        enabled: true,
        order: i
      }))
    })
  }
  if (!byId.has('codex')) {
    list.push({
      id: 'codex',
      kind: 'codex',
      label: 'Codex',
      enabled: true,
      order: 4,
      models: DEFAULT_CODEX_MODELS.map((id, i) => ({
        id,
        label: id,
        enabled: true,
        order: i
      }))
    })
  }
  if (!byId.has('opencode')) {
    list.push({
      id: 'opencode',
      kind: 'opencode',
      label: 'OpenCode',
      enabled: true,
      order: 6,
      models: DEFAULT_OPENCODE_MODELS.map((id, i) => ({
        id,
        label: id,
        enabled: true,
        order: i
      }))
    })
  }

  return list
    .map((p) => {
      const seen = new Set<string>()
      const models: ProviderModel[] = []
      for (const m of [...(p.models ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
        const id = bareModelId(p.id, m.id)
        if (!id || seen.has(id)) continue
        seen.add(id)
        models.push({
          ...m,
          id,
          label: m.label?.startsWith(`${p.id}:`) ? bareModelId(p.id, m.label) : m.label || id
        })
      }
      // 若该提供商启用但一个模型都没勾选，回退默认项，避免对话选择器整组消失
      if (p.enabled && models.length && !models.some((m) => m.enabled)) {
        const defaults = new Set(
          p.id === 'cursor'
            ? DEFAULT_CURSOR_MODELS
            : p.id === 'openclaw'
              ? ['main']
              : p.id === 'claude-code'
                ? DEFAULT_CLAUDE_MODELS
                : p.id === 'codex'
                  ? DEFAULT_CODEX_MODELS
                  : p.id === 'opencode'
                    ? DEFAULT_OPENCODE_MODELS
                    : []
        )
        for (const m of models) {
          if (defaults.has(m.id)) m.enabled = true
        }
        if (!models.some((m) => m.enabled)) models[0]!.enabled = true
      }
      return { ...p, models }
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((p, i) => ({ ...p, order: i }))
}

/** 合并本机 catalog 时对「已列出模型」的启用策略。 */
export type CatalogMergeMode =
  /** 保留原勾选；新出现的模型默认启用（对话选单能立刻看到）。 */
  | 'preserve'
  /** 本机目录里的模型全部启用（设置里点「刷新」时对齐对话侧）。 */
  | 'enable-listed'

/** 用本机/远端列表刷新某个内置提供商的模型，保留 order。 */
export function mergeProviderModels(
  provider: ModelProvider,
  listed: Array<{ id: string; label: string }>,
  defaultEnableIds?: string[],
  mode: CatalogMergeMode = 'preserve'
): ModelProvider {
  const prev = new Map(
    provider.models.map((m) => [bareModelId(provider.id, m.id), { ...m, id: bareModelId(provider.id, m.id) }])
  )
  const defaults = new Set(defaultEnableIds ?? [...DEFAULT_CURSOR_MODELS])
  const listedIds = new Set<string>()
  const models: ProviderModel[] = listed.map((raw, i) => {
    const id = bareModelId(provider.id, raw.id)
    listedIds.add(id)
    const old = prev.get(id)
    const enabled =
      mode === 'enable-listed' ? true : old ? old.enabled : true
    if (old) {
      return {
        id,
        label: raw.label || old.label || id,
        enabled,
        order: old.order
      }
    }
    return {
      id,
      label: raw.label || id,
      enabled,
      order: 1000 + i
    }
  })
  // 保留用户手动加过且仍勾选、但不在本机 catalog 里的项（避免刷新冲掉自定义 id）
  for (const [id, old] of prev) {
    if (listedIds.has(id) || !old.enabled) continue
    models.push({
      id,
      label: old.label || id,
      enabled: true,
      order: old.order ?? 2000 + models.length
    })
  }
  if (models.length && !models.some((m) => m.enabled)) {
    for (const m of models) {
      if (defaults.has(m.id)) m.enabled = true
    }
    if (!models.some((m) => m.enabled)) models[0]!.enabled = true
  }
  return {
    ...provider,
    models: models
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((m, i) => ({ ...m, order: i }))
  }
}

/** 把 catalog 合并进全部内置引擎；Cursor 空列表时也会用回退种子覆盖旧机残留。 */
export function applyModelCatalog(
  providers: ModelProvider[] | undefined,
  catalog: {
    cursor: Array<{ id: string; label: string }>
    openclaw: Array<{ id: string; label: string }>
    'claude-code'?: Array<{ id: string; label: string }>
    codex?: Array<{ id: string; label: string }>
    opencode?: Array<{ id: string; label: string }>
  },
  mode: CatalogMergeMode = 'preserve'
): ModelProvider[] {
  let next = ensureBuiltinProviders(providers)
  if (catalog.cursor.length) {
    next = next.map((p) =>
      p.id === 'cursor'
        ? mergeProviderModels(p, catalog.cursor, [...DEFAULT_CURSOR_MODELS], mode)
        : p
    )
  }
  if (catalog.openclaw.length) {
    next = next.map((p) =>
      p.id === 'openclaw' ? mergeProviderModels(p, catalog.openclaw, ['main'], mode) : p
    )
  }
  if (catalog['claude-code']?.length) {
    next = next.map((p) =>
      p.id === 'claude-code'
        ? mergeProviderModels(p, catalog['claude-code']!, ['sonnet', 'default', 'opus'], mode)
        : p
    )
  }
  if (catalog.codex?.length) {
    next = next.map((p) => {
      if (p.id !== 'codex') return p
      // 清掉历史上误同步进来的 其它提供商模型，避免刷新后仍挂在 codex:
      const cleaned = {
        ...p,
        models: p.models.filter((m) => !isForeignCodexModelId(bareModelId(p.id, m.id)))
      }
      return mergeProviderModels(cleaned, catalog.codex!, ['default'], mode)
    })
  }
  if (catalog.opencode?.length) {
    next = next.map((p) =>
      p.id === 'opencode' ? mergeProviderModels(p, catalog.opencode!, ['default'], mode) : p
    )
  }
  return next
}

export function flattenEnabledRefs(providers: ModelProvider[] | undefined): Array<{
  ref: string
  label: string
  providerId: string
  providerLabel: string
  modelId: string
}> {
  const out: Array<{
    ref: string
    label: string
    providerId: string
    providerLabel: string
    modelId: string
  }> = []
  for (const p of ensureBuiltinProviders(providers)) {
    if (!p.enabled) continue
    for (const m of p.models) {
      if (!m.enabled) continue
      out.push({
        ref: formatModelRef(p.id, m.id),
        label: m.label || m.id,
        providerId: p.id,
        providerLabel: p.label || p.id,
        modelId: m.id
      })
    }
  }
  return out
}

/** 按提供商分组的已启用模型（选择器用）。含 kind，便于 Agent / 直连分区。 */
export function groupedEnabledModels(providers: ModelProvider[] | undefined): Array<{
  providerId: string
  providerLabel: string
  kind: ModelProvider['kind']
  models: Array<{ ref: string; label: string; modelId: string }>
}> {
  const groups: Array<{
    providerId: string
    providerLabel: string
    kind: ModelProvider['kind']
    models: Array<{ ref: string; label: string; modelId: string }>
  }> = []
  for (const p of ensureBuiltinProviders(providers)) {
    if (!p.enabled) continue
    const models = p.models
      .filter((m) => m.enabled)
      .map((m) => ({
        ref: formatModelRef(p.id, m.id),
        label: m.label || m.id,
        modelId: m.id
      }))
    if (!models.length) continue
    groups.push({
      providerId: p.id,
      providerLabel: p.label || p.id,
      kind: p.kind,
      models
    })
  }
  return groups
}

/** 界面展示：供应商：模型（如 Claude Code：haiku）。 */
export function modelRefLabel(providers: ModelProvider[] | undefined, ref: string): string {
  const { provider, model } = parseModelRef(ref)
  const p = ensureBuiltinProviders(providers).find((x) => x.id === provider)
  const m = p?.models.find((x) => x.id === model)
  if (p && m) return `${p.label}：${m.label || m.id}`
  if (provider && model) return `${provider}：${model}`
  return ref
}

export function isAgentProvider(p: Pick<ModelProvider, 'kind'>): boolean {
  return p.kind !== 'custom'
}

/** 根据 modelRef 判断是 Agent 引擎还是大模型直连。 */
export function isAgentModelRef(providers: ModelProvider[] | undefined, ref: string): boolean {
  const { provider } = parseModelRef(ref)
  const p = ensureBuiltinProviders(providers).find((x) => x.id === provider)
  if (p) return isAgentProvider(p)
  // 未知提供商：内置引擎 id 当 Agent，其余当直连
  return (
    provider === 'cursor' ||
    provider === 'openclaw' ||
    provider === 'claude-code' ||
    provider === 'codex' ||
    provider === 'opencode'
  )
}

/** 兼容旧 API：扁平 prefs。 */
export function flattenToModelPrefs(providers: ModelProvider[] | undefined): ModelPref[] {
  return flattenEnabledRefs(providers).map((r, i) => ({
    id: r.ref,
    label: `${r.providerLabel}：${r.label}`,
    enabled: true,
    order: i
  }))
}

export function enabledModels(prefs: ModelPref[] | undefined): ModelPref[] {
  return (prefs ?? []).filter((p) => p.enabled).sort((a, b) => a.order - b.order)
}

export function modelLabel(prefs: ModelPref[] | undefined, id: string): string {
  return prefs?.find((p) => p.id === id)?.label || id
}

/** @deprecated 用 mergeProviderModels */
export function mergeModelPrefs(
  listed: Array<{ id: string; label: string }>,
  existing?: ModelPref[]
): ModelPref[] {
  const prev = new Map((existing ?? []).map((p) => [p.id, p]))
  const hasAnyEnabled = (existing ?? []).some((p) => p.enabled)
  return listed
    .map((m, i) => {
      const bare = isLegacyBareModelId(m.id) ? m.id : parseModelRef(m.id).model
      const ref = formatModelRef('cursor', bare)
      const old = prev.get(ref) ?? prev.get(bare) ?? prev.get(m.id)
      if (old) {
        return {
          id: ref,
          label: m.label || old.label,
          enabled: old.enabled,
          order: old.order
        }
      }
      const enabled = hasAnyEnabled ? false : (DEFAULT_CURSOR_MODELS as readonly string[]).includes(bare)
      return { id: ref, label: m.label, enabled, order: 1000 + i }
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((p, i) => ({ ...p, order: i }))
}

export function newLaneId(): string {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 规范化会话：
 * - 已撤销的 pipeline/quest 形态降级为 chat（去掉多余字段）
 * - 对比会话 compareModelIds → compareLanes
 */
export function normalizeCompareConversation(c: Conversation): Conversation {
  const rawKind = (c as { kind?: string }).kind
  // 历史短命形态：降级为普通对话，避免侧栏/主区卡死
  if (rawKind === 'pipeline' || rawKind === 'quest' || rawKind === 'doc') {
    const rest = { ...c } as Conversation & { pipeline?: unknown; quest?: unknown; doc?: unknown }
    delete rest.pipeline
    delete rest.quest
    delete rest.doc
    return normalizeCompareConversation({ ...rest, kind: 'chat' })
  }
  if (c.kind === 'rss') {
    return migrateRssThreads({ ...c, kind: 'rss', rss: normalizeRssTaskState(c.rss) || emptyRssTaskState() })
  }
  if (c.kind !== 'compare') return c
  if (c.compareLanes?.length) {
    const lanes = { ...(c.lanes ?? {}) }
    for (const ref of c.compareLanes) {
      const lane = lanes[ref.id]
      if (lane && !lane.modelId) {
        lanes[ref.id] = { ...lane, modelId: ref.modelId }
      } else if (!lane) {
        lanes[ref.id] = { modelId: ref.modelId, messages: [] }
      }
    }
    return { ...c, lanes }
  }
  const ids = c.compareModelIds ?? []
  if (!ids.length) return c
  const compareLanes: CompareLaneRef[] = ids.map((modelId, i) => {
    const bare = isLegacyBareModelId(modelId) ? formatModelRef('cursor', modelId) : modelId
    return { id: `${bare.replace(/:/g, '_')}__${i}`, modelId: bare }
  })
  const lanes: Conversation['lanes'] = {}
  for (let i = 0; i < compareLanes.length; i++) {
    const ref = compareLanes[i]
    const legacyKey = c.compareModelIds![i]
    const old = c.lanes?.[legacyKey] ?? c.lanes?.[ref.modelId]
    lanes[ref.id] = {
      modelId: ref.modelId,
      sessionId: old?.sessionId,
      messages: (old?.messages ?? []).map((m) => ({ ...m, modelId: ref.modelId }))
    }
  }
  return { ...c, compareLanes, lanes, compareModelIds: undefined }
}

export function getCompareLanes(c: Conversation): CompareLaneRef[] {
  return normalizeCompareConversation(c).compareLanes ?? []
}

/** 新 RSS 讨论回落的默认模型（不随单条讨论改模型而变）。 */
export function resolveRssDefaultModelRef(c: Conversation): string | undefined {
  return c.rssDefaultModelRef || c.modelRef
}

/** 新 RSS 讨论回落的默认权限。 */
export function resolveRssDefaultAutonomy(c: Conversation): Conversation['agentAutonomy'] {
  return c.rssDefaultAutonomy ?? c.agentAutonomy
}

/** 把当前 messages / session / 模型 / 权限镜像进选中条目的独立讨论。 */
export function syncRssActiveThread(c: Conversation): Conversation {
  if (c.kind !== 'rss') return c
  const entryId = c.rss?.selectedId
  if (!entryId) return c
  const threads = { ...(c.rssThreads || {}), [entryId]: c.messages }
  const sessions = { ...(c.rssSessions || {}) }
  if (c.sessionId) sessions[entryId] = c.sessionId
  else delete sessions[entryId]
  const models = { ...(c.rssModelRefs || {}) }
  if (c.modelRef) models[entryId] = c.modelRef
  const autonomies = { ...(c.rssAutonomies || {}) }
  if (c.agentAutonomy) autonomies[entryId] = c.agentAutonomy
  // 旧任务缺省默认值时，用当前任务级配置钉死，避免之后改条模型污染新讨论
  const rssDefaultModelRef = c.rssDefaultModelRef || c.modelRef
  const rssDefaultAutonomy = c.rssDefaultAutonomy ?? c.agentAutonomy
  return {
    ...c,
    rssThreads: threads,
    rssSessions: sessions,
    rssModelRefs: models,
    rssAutonomies: autonomies,
    rssDefaultModelRef,
    rssDefaultAutonomy
  }
}

/**
 * 加载/迁移：旧版整任务共用 messages → 挂到 selectedId；
 * 有 threads 时以选中条的线程为准；模型/权限按条恢复。
 */
export function migrateRssThreads(c: Conversation): Conversation {
  if (c.kind !== 'rss') return c
  const rss = c.rss || emptyRssTaskState()
  let threads = { ...(c.rssThreads || {}) }
  let messages = Array.isArray(c.messages) ? c.messages : []
  const selectedId = rss.selectedId
  if (messages.length && selectedId && !threads[selectedId]?.length) {
    threads = { ...threads, [selectedId]: messages }
  }
  if (selectedId && threads[selectedId]) {
    messages = threads[selectedId]
  }
  const sessions = { ...(c.rssSessions || {}) }
  const models = { ...(c.rssModelRefs || {}) }
  const autonomies = { ...(c.rssAutonomies || {}) }
  const rssDefaultModelRef = c.rssDefaultModelRef || c.modelRef
  const rssDefaultAutonomy = c.rssDefaultAutonomy ?? c.agentAutonomy
  if (selectedId && c.modelRef && !models[selectedId]) models[selectedId] = c.modelRef
  if (selectedId && c.agentAutonomy && !autonomies[selectedId]) {
    autonomies[selectedId] = c.agentAutonomy
  }
  const sessionId =
    selectedId && sessions[selectedId] ? sessions[selectedId] : selectedId ? undefined : c.sessionId
  const modelRef =
    (selectedId && models[selectedId]) || rssDefaultModelRef || c.modelRef
  const agentAutonomy =
    (selectedId && autonomies[selectedId]) || rssDefaultAutonomy || c.agentAutonomy
  return {
    ...c,
    kind: 'rss',
    rss,
    messages,
    rssThreads: threads,
    rssSessions: sessions,
    rssModelRefs: models,
    rssAutonomies: autonomies,
    rssDefaultModelRef,
    rssDefaultAutonomy,
    sessionId,
    modelRef,
    agentAutonomy
  }
}

/** 切换选中条目：落盘旧线程/模型/权限，载入新条（互不干扰）。 */
export function switchRssEntry(c: Conversation, entryId: string): Conversation {
  if (c.kind !== 'rss' || !c.rss) return c
  const next = syncRssActiveThread(c)
  const oldId = next.rss?.selectedId
  let threads = { ...(next.rssThreads || {}) }
  const sessions = { ...(next.rssSessions || {}) }
  const models = { ...(next.rssModelRefs || {}) }
  const autonomies = { ...(next.rssAutonomies || {}) }
  // 旧任务：有消息但还没挂 selectedId → 归到本次点开的条目
  if (!oldId && next.messages.length && !threads[entryId]?.length) {
    threads = { ...threads, [entryId]: next.messages }
    if (next.modelRef) models[entryId] = next.modelRef
    if (next.agentAutonomy) autonomies[entryId] = next.agentAutonomy
    if (next.sessionId) sessions[entryId] = next.sessionId
  }
  if (oldId === entryId) {
    return {
      ...next,
      rss: { ...next.rss!, selectedId: entryId },
      rssThreads: threads,
      rssModelRefs: models,
      rssAutonomies: autonomies,
      updatedAt: Date.now()
    }
  }
  const messages = threads[entryId] ? [...threads[entryId]] : []
  const sessionId = sessions[entryId]
  const modelRef =
    models[entryId] || next.rssDefaultModelRef || resolveRssDefaultModelRef(next)
  const agentAutonomy =
    autonomies[entryId] || next.rssDefaultAutonomy || resolveRssDefaultAutonomy(next)
  return {
    ...next,
    rss: { ...next.rss!, selectedId: entryId },
    messages,
    sessionId,
    modelRef,
    agentAutonomy,
    rssThreads: threads,
    rssSessions: sessions,
    rssModelRefs: models,
    rssAutonomies: autonomies,
    updatedAt: Date.now()
  }
}
