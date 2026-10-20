import { describe, expect, it } from 'vitest'
import {
  buildOpencodeConfigContent,
  cpetOpencodeProviderId,
  listCpetOpencodeCatalogModels
} from '../src/shared/opencodeInject'
import type { ModelProvider } from '../src/shared/types'
import {
  opencodeAutonomyArgs,
  opencodePermissionEnv
} from '../src/shared/agentAutonomy'

function custom(partial: Partial<ModelProvider> & { id: string }): ModelProvider {
  return {
    kind: 'custom',
    label: partial.label || partial.id,
    enabled: true,
    order: 0,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    models: [{ id: 'gpt-x', label: 'GPT-X', enabled: true, order: 0 }],
    ...partial
  }
}

describe('OpenCode 自定义 API 注入', () => {
  it('provider id 加 cpet- 前缀并清洗非法字符', () => {
    expect(cpetOpencodeProviderId('My API!')).toBe('cpet-My-API')
  })

  it('openai 兼容写进 OPENCODE_CONFIG_CONTENT', () => {
    const raw = buildOpencodeConfigContent([custom({ id: 'corp' })])
    expect(raw).toBeTruthy()
    const cfg = JSON.parse(raw!) as {
      provider: Record<string, { npm: string; options: { baseURL: string; apiKey: string } }>
    }
    expect(cfg.provider['cpet-corp']?.npm).toBe('@ai-sdk/openai-compatible')
    expect(cfg.provider['cpet-corp']?.options.apiKey).toBe('sk-test')
    expect(cfg.provider['cpet-corp']?.options.baseURL).toBe('https://api.example.com/v1')
  })

  it('缺 key/url 的提供商不注入', () => {
    expect(
      buildOpencodeConfigContent([custom({ id: 'x', apiKey: '', baseUrl: '' })])
    ).toBeUndefined()
  })

  it('catalog 列出 cpet-id/model', () => {
    const list = listCpetOpencodeCatalogModels([custom({ id: 'corp', label: '公司网关' })])
    expect(list).toEqual([{ id: 'cpet-corp/gpt-x', label: '公司网关：GPT-X' }])
  })
})

describe('OpenCode 自治', () => {
  it('agent 用 --auto；plan 用 --agent plan；ask 不挂确认', () => {
    expect(opencodeAutonomyArgs('agent')).toEqual(['--auto'])
    expect(opencodeAutonomyArgs('plan')).toEqual(['--agent', 'plan'])
    expect(opencodeAutonomyArgs('ask')).toEqual([])
  })

  it('ask 权限禁写禁 shell，避免 headless 挂死', () => {
    const raw = opencodePermissionEnv('ask')
    expect(raw).toBeTruthy()
    const p = JSON.parse(raw!) as Record<string, string>
    expect(p.bash).toBe('deny')
    expect(p.edit).toBe('deny')
    expect(p.read).toBe('allow')
    expect(opencodePermissionEnv('agent')).toBeUndefined()
  })
})
