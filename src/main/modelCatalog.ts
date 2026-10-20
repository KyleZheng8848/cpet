/**
 * 各 Agent 引擎的本机模型目录。
 * Cursor / OpenClaw：CLI / 目录扫描；Claude / Codex：读本机配置。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { listCursorModels } from './cursorAgent'
import { listOpenclawAgents } from './openclawAgent'
import {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_CODEX_MODELS,
  DEFAULT_CURSOR_MODELS,
  DEFAULT_OPENCODE_MODELS,
  isForeignCodexModelId
} from '../shared/models'
import { listCpetOpencodeCatalogModels } from '../shared/opencodeInject'
import { getSettings } from './store'

export type CatalogEntry = { id: string; label: string }

export type ModelCatalog = {
  cursor: CatalogEntry[]
  openclaw: CatalogEntry[]
  'claude-code': CatalogEntry[]
  codex: CatalogEntry[]
  opencode: CatalogEntry[]
}

function uniqEntries(items: CatalogEntry[]): CatalogEntry[] {
  const seen = new Set<string>()
  const out: CatalogEntry[] = []
  for (const it of items) {
    const id = (it.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: (it.label || id).trim() || id })
  }
  return out
}

function readJsonFile(path: string): unknown | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown
  } catch {
    return null
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
}

function fallbackEntries(ids: readonly string[]): CatalogEntry[] {
  return ids.map((id) => ({ id, label: id }))
}

/** Claude Code：优先读原生 settings 的 availableModels。 */
export function listClaudeCodeModels(): CatalogEntry[] {
  const entries: CatalogEntry[] = [{ id: 'default', label: 'default' }]

  const paths = [
    join(homedir(), '.claude', 'settings.json')
  ]
  for (const p of paths) {
    const data = readJsonFile(p)
    if (!data || typeof data !== 'object') continue
    const obj = data as Record<string, unknown>
    for (const id of asStringArray(obj.availableModels)) {
      entries.push({ id, label: id })
    }
    if (typeof obj.model === 'string' && obj.model.trim()) {
      const id = obj.model.trim()
      entries.push({ id, label: id })
    }
  }

  const uniq = uniqEntries(entries)
  return uniq.length > 1 ? uniq : uniqEntries([...entries, ...fallbackEntries(DEFAULT_CLAUDE_MODELS)])
}

/**
 * Codex 模型列表：只读 OpenAI `~/.codex`。
 *
 * ChatGPT.app / 新版 CLI 真源是 `models_cache.json`（不是旧的 model-catalog.json）。
 */
export function listCodexModels(): CatalogEntry[] {
  const entries: CatalogEntry[] = [{ id: 'default', label: 'default（跟随 ChatGPT / ~/.codex）' }]

  const catalogPaths = [
    join(homedir(), '.codex', 'models_cache.json'),
    join(homedir(), '.codex', 'model-catalog.json'),
    join(homedir(), '.codex', 'default-model.json')
  ]
  for (const p of catalogPaths) {
    const data = readJsonFile(p)
    if (!data || typeof data !== 'object') continue
    const models = (data as { models?: unknown }).models
    if (!Array.isArray(models)) continue
    for (const raw of models) {
      if (!raw || typeof raw !== 'object') continue
      const m = raw as Record<string, unknown>
      const id = typeof m.slug === 'string' ? m.slug : typeof m.id === 'string' ? m.id : ''
      if (!id) continue
      // 再挡一层：其它提供商模型误拷进 ~/.codex 也不进选单
      if (isForeignCodexModelId(id)) continue
      const vis = typeof m.visibility === 'string' ? m.visibility : 'list'
      // hide / internal 不进选单；缺省当 list
      if (vis && vis !== 'list' && vis !== 'visible') continue
      const label =
        typeof m.display_name === 'string' && m.display_name.trim()
          ? m.display_name.trim()
          : id
      entries.push({ id, label })
    }
  }

  // config.toml 里的默认 model（如 gpt-5.6-sol）补进选单
  const cfgModel = readCodexConfigModel()
  if (cfgModel && !isForeignCodexModelId(cfgModel)) {
    entries.push({ id: cfgModel, label: cfgModel })
  }

  const uniq = uniqEntries(entries)
  return uniq.length > 1 ? uniq : uniqEntries([...entries, ...fallbackEntries(DEFAULT_CODEX_MODELS)])
}

function readCodexConfigModel(): string | undefined {
  try {
    const text = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8')
    const m = text.match(/^\s*model\s*=\s*"([^"]+)"/m)
    return m?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

/** OpenCode 模型列表：default 种子 + CPET 注入的自定义提供商模型（不跑 CLI）。 */
function listOpencodeModels(): CatalogEntry[] {
  const customs = (getSettings().modelProviders ?? []).filter((p) => p.kind === 'custom')
  const injected = listCpetOpencodeCatalogModels(customs)
  return uniqEntries([
    ...fallbackEntries(DEFAULT_OPENCODE_MODELS),
    ...injected
  ])
}

export async function listModelCatalog(): Promise<ModelCatalog> {
  const [cursorListed, agents] = await Promise.all([
    listCursorModels(),
    Promise.resolve(listOpenclawAgents())
  ])

  // Cursor 拉空时回退默认种子，避免迁机后 settings 里的旧模型永远不刷新
  const cursor = cursorListed.length
    ? cursorListed
    : fallbackEntries(DEFAULT_CURSOR_MODELS)

  return {
    cursor,
    openclaw: (agents.length ? agents : ['main']).map((id) => ({ id, label: id })),
    'claude-code': listClaudeCodeModels(),
    codex: listCodexModels(),
    opencode: listOpencodeModels()
  }
}
