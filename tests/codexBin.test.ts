import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  codexCandidatePaths,
  describeCodexBin,
  isPrivateCodexPath,
  isChatGPTCodexPath,
  resolveCodexBin
} from '../src/main/codexBin'
import { isForeignCodexModelId } from '../src/shared/models'

describe('codexBin', () => {
  it('候选路径包含 ChatGPT.app 内嵌 CLI，且不含 .codefuse', () => {
    const paths = codexCandidatePaths()
    expect(paths.some((p) => /ChatGPT\.app\/Contents\/Resources\/codex$/.test(p))).toBe(true)
    expect(paths.every((p) => !isPrivateCodexPath(p))).toBe(true)
  })

  it('识别 私有包装器 私有路径', () => {
    expect(
      isPrivateCodexPath(join(homedir(), '.codefuse/fuse/engine/bin/codex/0.140.0/codex'))
    ).toBe(true)
    expect(isChatGPTCodexPath('/Applications/ChatGPT.app/Contents/Resources/codex')).toBe(true)
  })

  it('本机若已装 ChatGPT.app，resolveCodexBin 命中它而不是 私有包装器', async () => {
    const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex'
    if (!existsSync(bundled)) return
    const bin = await resolveCodexBin()
    expect(bin).toBe(bundled)
    expect(isPrivateCodexPath(bin!)).toBe(false)
    expect(describeCodexBin(bin!)).toMatch(/ChatGPT\.app/)
  })

})

describe('isForeignCodexModelId', () => {
  it('挡掉 私有包装器 系模型，放行 OpenAI 系', () => {
    expect(isForeignCodexModelId('ring-1')).toBe(true)
    expect(isForeignCodexModelId('ling-flash')).toBe(true)
    expect(isForeignCodexModelId('antchat/auto')).toBe(true)
    expect(isForeignCodexModelId('gpt-5.3-codex')).toBe(false)
    expect(isForeignCodexModelId('gpt-5.6-sol')).toBe(false)
    expect(isForeignCodexModelId('o3')).toBe(false)
    expect(isForeignCodexModelId('default')).toBe(false)
  })
})
