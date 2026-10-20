import { describe, expect, it } from 'vitest'
import {
  appendDiagnosticsExtras,
  buildSkinSubmissionClipboard,
  feedbackIssuesUrl
} from '../src/shared/feedback'
import {
  REQUIRED_BUNDLED_SKILL_IDS,
  resolveBundledSkillsRoots
} from '../src/shared/bundledSkills'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

describe('feedbackIssuesUrl', () => {
  it('拼出 /issues', () => {
    expect(feedbackIssuesUrl('https://git.example.com/org/CPET')).toBe(
      'https://git.example.com/org/CPET/issues'
    )
    expect(feedbackIssuesUrl('https://git.example.com/org/CPET/')).toBe(
      'https://git.example.com/org/CPET/issues'
    )
  })

  it('无效地址返回 undefined', () => {
    expect(feedbackIssuesUrl('')).toBeUndefined()
    expect(feedbackIssuesUrl('not-a-url')).toBeUndefined()
  })
})

describe('buildSkinSubmissionClipboard', () => {
  it('含投稿关键词与非即时上架说明', () => {
    const text = buildSkinSubmissionClipboard({
      id: '霓虹狐',
      name: '霓虹狐',
      states: ['idle', 'thinking'],
      zipPath: '/tmp/霓虹狐.zip',
      sha256: 'abc',
      appVersion: '0.4.4'
    })
    expect(text).toContain('皮肤市场投稿')
    expect(text).toContain('霓虹狐')
    expect(text).toContain('SHA256：abc')
    expect(text).toContain('不是即时上架')
  })
})

describe('appendDiagnosticsExtras', () => {
  it('追加外观与更新', () => {
    const out = appendDiagnosticsExtras('CPET v1', {
      imageSkinId: '赛博幽灵',
      vectorSkinId: 'violet',
      updateStatus: 'update-available',
      updateLatest: '0.4.4'
    })
    expect(out).toContain('赛博幽灵')
    expect(out).toContain('update-available')
    expect(out).toContain('0.4.4')
  })
})

describe('resolveBundledSkillsRoots', () => {
  it('打包态用 resources/skills', () => {
    expect(
      resolveBundledSkillsRoots({
        isPackaged: true,
        resourcesPath: '/App/Resources'
      })
    ).toEqual(['/App/Resources/skills'])
  })

  it('开发态回退仓库 .cursor/skills', () => {
    expect(
      resolveBundledSkillsRoots({
        isPackaged: false,
        resourcesPath: '/x',
        projectRoot: '/repo'
      })
    ).toEqual(['/repo/.cursor/skills'])
  })

  it('仓库内必带内置 Skill 真源（含 harsh-optimize-loop / cpet-rss-digest）', () => {
    expect(REQUIRED_BUNDLED_SKILL_IDS).toContain('harsh-optimize-loop')
    expect(REQUIRED_BUNDLED_SKILL_IDS).toContain('cpet-cute-skins')
    expect(REQUIRED_BUNDLED_SKILL_IDS).toContain('cpet-rss-digest')
    const root = join(__dirname, '..', '.cursor', 'skills')
    for (const id of REQUIRED_BUNDLED_SKILL_IDS) {
      expect(existsSync(join(root, id, 'SKILL.md')), id).toBe(true)
    }
    expect(existsSync(join(root, 'harsh-optimize-loop', 'references', 'harsh-bar.md'))).toBe(
      true
    )
    expect(existsSync(join(root, 'cpet-rss-digest', 'references', 'craft.md'))).toBe(true)
    expect(existsSync(join(root, 'cpet-rss-digest', 'forms', 'brief.md'))).toBe(true)
  })
})
