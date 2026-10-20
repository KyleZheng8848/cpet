import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceContextBlock,
  mergeSystemWithLocalContext
} from '../src/shared/prompts'

describe('buildWorkspaceContextBlock', () => {
  it('requires saves under the task cwd', () => {
    const block = buildWorkspaceContextBlock('/Users/example/Projects/cursor-pet/skins')
    expect(block).toContain('/Users/example/Projects/cursor-pet/skins')
    expect(block).toMatch(/工作区|workspace/)
    expect(block).toMatch(/Desktop|Documents|Downloads/)
    expect(block).toMatch(/outputs/)
  })

  it('skips empty cwd', () => {
    expect(buildWorkspaceContextBlock('')).toBeUndefined()
    expect(buildWorkspaceContextBlock(null)).toBeUndefined()
  })
})

describe('mergeSystemWithLocalContext', () => {
  it('appends workspace when cwd is set', () => {
    const merged = mergeSystemWithLocalContext('你好', '上海', '/tmp/project')
    expect(merged).toContain('你好')
    expect(merged).toContain('上海')
    expect(merged).toContain('/tmp/project')
    expect(merged).toContain('【工作区 / workspace】')
  })
})
