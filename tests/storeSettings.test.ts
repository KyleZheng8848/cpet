import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '../src/shared/types'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

beforeEach(() => {
  vi.resetModules()
  state.userData = mkdtempSync(join(tmpdir(), 'cpet-settings-test-'))
})
afterEach(() => rmSync(state.userData, { recursive: true, force: true }))

describe('设置迁移', () => {
  it('旧记录缺少 skin 时补默认矢量形象，不覆盖成新用户图片预设', async () => {
    writeFileSync(join(state.userData, 'settings.json'), JSON.stringify({ uiLanguage: 'en' }))
    const { getSettings } = await import('../src/main/store')
    expect(getSettings().skin).toBe('violet')
    expect(getSettings().imageSkin).toBeUndefined()
  })
  it('首次启动使用数字佳人，切换矢量皮肤后重启仍保留选择', async () => {
    const { getSettings, updateSettings } = await import('../src/main/store')
    expect(getSettings().imageSkin).toBe('数字佳人')
    updateSettings({ skin: 'mint', imageSkin: undefined })
    vi.resetModules()
    const restarted = await import('../src/main/store')
    expect(restarted.getSettings().skin).toBe('mint')
    expect(restarted.getSettings().imageSkin).toBeUndefined()
  })

  it('保留已有的图片皮肤选择', async () => {
    writeFileSync(join(state.userData, 'settings.json'), JSON.stringify({
      skin: 'violet', imageSkin: '赛博幽灵'
    }))
    const { getSettings } = await import('../src/main/store')
    expect(getSettings().imageSkin).toBe('赛博幽灵')
  })

  it('默认引擎及模型已移除时改用可用模型，并写回设置', async () => {
    writeFileSync(join(state.userData, 'settings.json'), JSON.stringify({
      skin: 'violet', uiLanguage: 'en', agentBackend: 'dtcoder', defaultModelRef: 'cfuse:default',
      modelProviders: [{ id: 'cfuse', kind: 'cfuse', enabled: true, models: [] }]
    }))
    const { getSettings } = await import('../src/main/store')
    const settings = getSettings()
    expect(settings.agentBackend).toBe('cursor')
    expect(settings.imageSkin).toBeUndefined()
    expect(settings.uiLanguage).toBe('en')
    expect(settings.defaultModelRef).toBe('cursor:auto')
    expect(settings.modelProviders?.some((p) => p.id === 'cfuse')).toBe(false)
    const saved = JSON.parse(readFileSync(join(state.userData, 'settings.json'), 'utf8'))
    expect(saved.defaultModelRef).toBe('cursor:auto')
  })

  it('设置更新也会过滤旧引擎，且保留可用自定义 API 的默认选择', async () => {
    const { getSettings, updateSettings } = await import('../src/main/store')
    const custom = {
      id: 'my-api', kind: 'custom' as const, label: 'My API', enabled: true, order: 0,
      baseUrl: 'https://api.example.com/v1', apiKey: 'test-key',
      models: [{ id: 'model-a', label: 'Model A', enabled: true, order: 0 }]
    }
    const legacyPatch = {
      agentBackend: 'dtcoder', defaultModelRef: 'my-api:model-a',
      modelProviders: [custom, { id: 'dtcoder', kind: 'dtcoder', models: [] }]
    } as unknown as Partial<Settings>
    updateSettings(legacyPatch)
    expect(getSettings().agentBackend).toBe('cursor')
    expect(getSettings().defaultModelRef).toBe('my-api:model-a')
    expect(getSettings().modelProviders?.find((p) => p.id === 'my-api')).toEqual({ ...custom, order: expect.any(Number) })
    expect(getSettings().modelProviders?.some((p) => p.id === 'dtcoder')).toBe(false)
  })
})
