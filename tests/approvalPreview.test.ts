import { describe, expect, it } from 'vitest'
import {
  approvalSummary,
  compactApprovalCommand,
  previewApproval
} from '../src/shared/approvalPreview'

describe('previewApproval', () => {
  it('Write 参数里的 \\n 变成真换行，摘要只留文件名', () => {
    const content = `Write\n${JSON.stringify(
      {
        file_path: '/Users/example/Projects/sample-project/stages/eval_profile.py',
        content: 'import re\nfrom collections import Counter\n'
      },
      null,
      2
    )}`
    const p = previewApproval('tool', content)
    expect(p.action).toBe('Write')
    expect(p.target).toBe('eval_profile.py')
    expect(p.path).toContain('eval_profile.py')
    expect(p.body).toContain('import re\nfrom collections')
    expect(p.body).not.toContain('\\n')
    expect(approvalSummary(p)).toBe('Write · eval_profile.py')
  })

  it('shell 命令不包一层假 JSON', () => {
    const p = previewApproval('shell', 'npm run build')
    expect(p.action).toBe('命令')
    expect(p.target).toBe('npm run build')
    expect(p.body).toBe('npm run build')
  })

  it('长命令摘要能放下 pytest 整段，不在 64 字处截断', () => {
    const cmd = 'python -m pytest tests/test_eval_profile.py -k medical --tb=short'
    const p = previewApproval('shell', cmd)
    expect(p.target).toBe(cmd)
    expect(approvalSummary(p)).toBe(`命令 · ${cmd}`)
  })

  it('宠物卡把家目录收短；超宽才收尾段', () => {
    expect(
      compactApprovalCommand('cd "/Users/example/Projects/sample-project"')
    ).toBe('cd "~/Projects/sample-project"')
    expect(compactApprovalCommand('npm run build')).toBe('npm run build')
    expect(
      compactApprovalCommand(
        'cd "/Users/example/Projects/sample-project/very/deep/nested/path/to/project"'
      )
    ).toBe('cd "…/to/project"')
  })

  it('Edit 同时有新旧文本时分栏写出', () => {
    const p = previewApproval(
      'tool',
      JSON.stringify({
        file_path: 'a.ts',
        old_string: 'foo',
        new_string: 'bar'
      })
    )
    expect(p.target).toBe('a.ts')
    expect(p.body).toContain('--- 原文\nfoo')
    expect(p.body).toContain('+++ 改后\nbar')
  })
})
