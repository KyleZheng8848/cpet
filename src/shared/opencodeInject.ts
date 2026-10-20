/**
 * CPET 自定义 API → OpenCode provider 注入（纯函数，无 Electron）。
 */
import type { ModelProvider } from './types'

/** CPET 自定义提供商 → OpenCode provider id（避免与 models.dev 撞名）。 */
export function cpetOpencodeProviderId(customId: string): string {
  const safe = customId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'custom'
  return `cpet-${safe}`
}

/**
 * 把 settings 里启用的 custom 提供商编成 OPENCODE_CONFIG_CONTENT 片段。
 * OpenAI 兼容走 @ai-sdk/openai-compatible；Anthropic 走 @ai-sdk/anthropic。
 */
export function buildOpencodeConfigContent(customs: ModelProvider[]): string | undefined {
  const enabled = customs.filter(
    (p) => p.kind === 'custom' && p.enabled !== false && p.baseUrl?.trim() && p.apiKey?.trim()
  )
  if (!enabled.length) return undefined

  const provider: Record<string, unknown> = {}
  for (const p of enabled) {
    const id = cpetOpencodeProviderId(p.id)
    const baseURL = p.baseUrl!.trim().replace(/\/+$/, '')
    const models: Record<string, { name: string }> = {}
    for (const m of p.models ?? []) {
      const mid = (m.id || '').trim()
      if (!mid) continue
      models[mid] = { name: (m.label || mid).trim() || mid }
    }
    if (!Object.keys(models).length) {
      models['default'] = { name: 'default' }
    }
    if (p.apiFormat === 'anthropic') {
      provider[id] = {
        npm: '@ai-sdk/anthropic',
        name: p.label || p.id,
        options: {
          apiKey: p.apiKey!.trim(),
          baseURL: baseURL.includes('/v1') ? baseURL : `${baseURL}/v1`
        },
        models
      }
    } else {
      provider[id] = {
        npm: '@ai-sdk/openai-compatible',
        name: p.label || p.id,
        options: {
          apiKey: p.apiKey!.trim(),
          baseURL: baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`
        },
        models
      }
    }
  }
  return JSON.stringify({ provider })
}

export function listCpetOpencodeCatalogModels(
  customs: ModelProvider[]
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  for (const p of customs) {
    if (p.kind !== 'custom' || p.enabled === false || !p.baseUrl?.trim() || !p.apiKey?.trim()) {
      continue
    }
    const pid = cpetOpencodeProviderId(p.id)
    const models = (p.models ?? []).filter((m) => m.enabled !== false && m.id?.trim())
    if (!models.length) {
      out.push({ id: `${pid}/default`, label: `${p.label || p.id}：default` })
      continue
    }
    for (const m of models) {
      out.push({
        id: `${pid}/${m.id.trim()}`,
        label: `${p.label || p.id}：${m.label || m.id}`
      })
    }
  }
  return out
}
