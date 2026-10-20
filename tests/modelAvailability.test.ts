import { describe, expect, it } from 'vitest'
import { ensureBuiltinProviders, flattenEnabledRefs } from '../src/shared/models'
import type { ModelProvider } from '../src/shared/types'

function provider(id: string, baseUrl?: string): ModelProvider {
  return {
    id, kind: 'custom', label: id, enabled: true, order: 0, baseUrl,
    apiKey: 'test-key', models: [{ id: 'model-a', label: 'Model A', enabled: true, order: 0 }]
  }
}

describe('模型可用性迁移', () => {
  it('旧内部引擎和内部 API 不会因读取旧设置重新出现在模型选单', () => {
    const legacy = [
      { ...provider('cfuse'), kind: 'cfuse' },
      { ...provider('dtcoder'), kind: 'dtcoder' },
      provider('theta'),
      provider('renamed-api', 'https://example.alipay.com/v1')
    ] as ModelProvider[]
    const refs = flattenEnabledRefs(ensureBuiltinProviders(legacy))
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((entry) => !legacy.some((p) => p.id === entry.providerId))).toBe(true)
  })

  it('保留公开自定义 API、用户模型及密钥，重复迁移结果一致', () => {
    const custom = provider('my-api', 'https://api.example.com/v1')
    const migrated = ensureBuiltinProviders([custom])
    expect(migrated.find((p) => p.id === custom.id)).toEqual({ ...custom, order: expect.any(Number) })
    expect(ensureBuiltinProviders(migrated)).toEqual(migrated)
    expect(flattenEnabledRefs(migrated).some((entry) => entry.ref === 'my-api:model-a')).toBe(true)
  })
})
