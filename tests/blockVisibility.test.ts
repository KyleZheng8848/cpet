/**
 * 「过程」开关到底该藏什么。
 * 历史 bug 是技能块被写成永远可见：关了过程，气泡里还挂着一条「技能（原版点名）：已加上 /foo」，
 * 看起来像过程没关干净。反过来也不能一刀切全藏——用户勾了技能却没找到时，
 * 那是要求没被执行，藏起来等于让用户拿着一份没上技能的回答还以为上了。
 */
import { describe, it, expect } from 'vitest'
import type { ChatBlock } from '@shared/types'
import { attachmentLocalUrl } from '@shared/attachmentMedia'
import {
  applyDoneResult,
  blocksForDisplay,
  finalizeAssistantBlocks,
  promoteOutputAttachments,
  skillReportUnfulfilled
} from '../src/renderer/src/chat/processBlocks'

function skillBlock(over: Partial<Extract<ChatBlock, { kind: 'skill' }>> = {}): ChatBlock {
  return {
    kind: 'skill',
    mode: 'native',
    injected: ['foo'],
    missing: [],
    truncated: [],
    text: '技能（原版点名）：已加上 /foo',
    ...over
  }
}

const reply: ChatBlock = { kind: 'text', text: '好了' }

describe('技能块跟随「过程」开关', () => {
  it('过程打开：技能块照常显示', () => {
    const out = blocksForDisplay([skillBlock(), reply], true, 'assistant')
    expect(out.map((b) => b.kind)).toEqual(['skill', 'text'])
  })

  it('过程关闭且技能已落地：收起来，只剩正文', () => {
    const out = blocksForDisplay([skillBlock(), reply], false, 'assistant')
    expect(out.map((b) => b.kind)).toEqual(['text'])
  })

  it('过程关闭但技能没找到：仍然显示，用户必须知道要求没被执行', () => {
    const out = blocksForDisplay(
      [skillBlock({ injected: [], missing: ['foo'] }), reply],
      false,
      'assistant'
    )
    expect(out.map((b) => b.kind)).toEqual(['skill', 'text'])
  })

  it('过程关闭但技能正文被截断：同样显示', () => {
    const out = blocksForDisplay([skillBlock({ truncated: ['foo'] }), reply], false, 'assistant')
    expect(out.map((b) => b.kind)).toEqual(['skill', 'text'])
  })

  it('关过程仍显示钉住的直连附件说明', () => {
    const out = blocksForDisplay(
      [
        { kind: 'status', text: '直连没有把 x.heic 发给模型（打不开本地路径）', pin: true },
        reply
      ],
      false,
      'assistant'
    )
    expect(out.map((b) => b.kind)).toEqual(['status', 'text'])
  })

  it('关过程仍然藏掉思考/工具/命令', () => {
    const blocks: ChatBlock[] = [
      { kind: 'reasoning', text: '想一想' },
      { kind: 'tool', name: 'read', status: 'error' },
      { kind: 'command', command: 'ls', status: 'error', exitCode: 1 },
      reply
    ]
    expect(blocksForDisplay(blocks, false, 'assistant').map((b) => b.kind)).toEqual(['text'])
  })

  it('助手气泡藏掉假路径与文件夹附件', () => {
    const blocks: ChatBlock[] = [
      reply,
      {
        kind: 'attachment',
        path: '/n)/(n+1/n)^n\\]\\).',
        name: 'n###'
      },
      {
        kind: 'attachment',
        path: '/Users/example/Projects/sample-data/n+++',
        name: 'n+++',
        mime: 'inode/directory'
      },
      {
        kind: 'attachment',
        path: '/Users/example/Projects/sample-data/_报告/a.md',
        name: 'a.md'
      }
    ]
    const shown = blocksForDisplay(blocks, true, 'assistant')
    expect(shown.filter((b) => b.kind === 'attachment').map((b) => (b as { path: string }).path)).toEqual([
      '/Users/example/Projects/sample-data/_报告/a.md'
    ])
  })

  it('只有非技能块时判定为不需要强制显示', () => {
    expect(skillReportUnfulfilled(reply)).toBe(false)
  })
})

describe('applyDoneResult 终局正文覆盖半截流式', () => {
  it('无正文时写入 result', () => {
    const out = applyDoneResult([{ kind: 'tool', name: 'x', status: 'done' }], '完整答案')
    expect(out.some((b) => b.kind === 'text' && b.text === '完整答案')).toBe(true)
  })

  it('终局更长时覆盖短流式', () => {
    const out = applyDoneResult(
      [{ kind: 'text', text: '文件已写好。' }],
      '文件已写好。项目1=85，项目2=77，详见表格。'
    )
    const texts = out.filter((b) => b.kind === 'text').map((b) => b.text)
    expect(texts).toEqual(['文件已写好。项目1=85，项目2=77，详见表格。'])
  })

  it('流式已不短于终局则保留', () => {
    const out = applyDoneResult(
      [{ kind: 'text', text: '已经很长的完整流式正文内容在这里' }],
      '短终局'
    )
    expect(out).toEqual([{ kind: 'text', text: '已经很长的完整流式正文内容在这里' }])
  })
})

describe('产出文件挂成附件', () => {
  it('Write 结果文件 → attachment；关过程仍可见', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        name: 'Write',
        input: JSON.stringify({ path: '/Users/example/out/report.docx' }),
        status: 'done'
      },
      { kind: 'text', text: '已生成 Word 报告。' }
    ]
    const promoted = promoteOutputAttachments(blocks)
    expect(promoted.some((b) => b.kind === 'attachment' && b.path.endsWith('report.docx'))).toBe(
      true
    )
    const shown = blocksForDisplay(finalizeAssistantBlocks(blocks), false, 'assistant')
    expect(shown.some((b) => b.kind === 'attachment')).toBe(true)
    expect(shown.some((b) => b.kind === 'tool')).toBe(false)
  })

  it('正文里提到的素材路径不挂；只保留 Write 结果', () => {
    const out = promoteOutputAttachments([
      {
        kind: 'tool',
        name: 'Edit',
        input: JSON.stringify({
          path: '/Users/example/Projects/sample-data/_报告/比赛素材内容分析报告-20260813.md'
        }),
        status: 'done'
      },
      {
        kind: 'text',
        text: '结合 origin.csv 与 /Users/example/Projects/sample-data/n+++ 等目录，已写好：/Users/example/Projects/sample-data/_报告/比赛素材内容分析报告-20260813.md'
      },
      {
        kind: 'attachment',
        path: '/Users/example/Projects/sample-data/origin.csv',
        name: 'origin.csv'
      },
      {
        kind: 'attachment',
        path: '/Users/example/Projects/sample-data/n+++',
        name: 'n+++',
        mime: 'inode/directory'
      }
    ])
    const paths = out
      .filter((b): b is Extract<ChatBlock, { kind: 'attachment' }> => b.kind === 'attachment')
      .map((b) => b.path)
    expect(paths).toEqual([
      '/Users/example/Projects/sample-data/_报告/比赛素材内容分析报告-20260813.md'
    ])
  })

  it('源码 Write 也挂（结果文件）；文件夹不挂', () => {
    const out = promoteOutputAttachments([
      {
        kind: 'tool',
        name: 'Write',
        input: JSON.stringify({ path: '/Users/example/proj/a.ts' }),
        status: 'done'
      },
      { kind: 'text', text: '输出目录：/Users/example/proj/dist/' }
    ])
    const paths = out
      .filter((b): b is Extract<ChatBlock, { kind: 'attachment' }> => b.kind === 'attachment')
      .map((b) => b.path)
    expect(paths).toEqual(['/Users/example/proj/a.ts'])
  })

  it('Read 工具不刷附件', () => {
    const out = promoteOutputAttachments([
      {
        kind: 'tool',
        name: 'Read',
        input: JSON.stringify({ path: '/Users/example/proj/secret.ts' }),
        status: 'done'
      },
      { kind: 'text', text: '看过了' }
    ])
    expect(out.some((b) => b.kind === 'attachment')).toBe(false)
  })

  it('失败命令的 -o 目标不挂空附件', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'command',
        command: 'pandoc "/Users/example/a.docx" -o /tmp/aoe_supplement.md',
        output: 'zsh:1: command not found: pandoc',
        exitCode: 1,
        status: 'done'
      },
      {
        kind: 'attachment',
        path: '/tmp/aoe_supplement.md',
        name: 'aoe_supplement.md'
      },
      { kind: 'text', text: '换一种办法。' }
    ]
    const promoted = promoteOutputAttachments(blocks)
    expect(promoted.some((b) => b.kind === 'attachment')).toBe(false)
    const shown = blocksForDisplay(blocks, true, 'assistant')
    expect(shown.some((b) => b.kind === 'attachment')).toBe(false)
  })

  it('成功命令的 -o 仍挂附件', () => {
    const out = promoteOutputAttachments([
      {
        kind: 'command',
        command: 'pandoc a.docx -o /tmp/ok.md',
        exitCode: 0,
        status: 'done'
      },
      { kind: 'text', text: '转好了' }
    ])
    expect(out.some((b) => b.kind === 'attachment' && b.path === '/tmp/ok.md')).toBe(true)
  })

  it('image-tool 输出 localPath 时挂图；关过程仍看得见', () => {
    const blocks: ChatBlock[] = [
      { kind: 'text', text: '用 image-tool 画好了。' },
      {
        kind: 'command',
        command: 'python generate.py',
        output: `任务状态: success
图片已保存: /Users/example/Desktop/anime-image-tool.png
{"localPath":"/Users/example/Desktop/anime-image-tool.png","creativeId":"CF_XM286vio7Y839"}`,
        exitCode: 0,
        status: 'done'
      }
    ]
    const promoted = promoteOutputAttachments(blocks)
    expect(
      promoted.some(
        (b) => b.kind === 'attachment' && b.path === '/Users/example/Desktop/anime-image-tool.png'
      )
    ).toBe(true)
    // 展示层把图插进正文 Markdown（而不是再挂一张附件卡，否则同图显示两遍）
    const shown = blocksForDisplay(blocks, false, 'assistant')
    const shownText = shown
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(shownText).toContain(attachmentLocalUrl('/Users/example/Desktop/anime-image-tool.png'))
    expect(
      shown.some(
        (b) => b.kind === 'attachment' && b.path === '/Users/example/Desktop/anime-image-tool.png'
      )
    ).toBe(false)
    expect(shown.some((b) => b.kind === 'command')).toBe(false)
  })

  it('正文「保存至」Application Support 的 md 也挂卡片', () => {
    const md =
      '/Users/example/Library/Application Support/cursor-pet/skills/outputs/月报_2025-02.md'
    const out = promoteOutputAttachments([
      { kind: 'text', text: `报告已生成，保存至：${md}` }
    ])
    expect(out.some((b) => b.kind === 'attachment' && b.path === md)).toBe(true)
  })

  it('工具返回的裸路径 Write（含空格）挂 md 卡片', () => {
    const md =
      '/Users/example/Library/Application Support/cursor-pet/skills/outputs/月报_2025-02.md'
    const out = promoteOutputAttachments([
      { kind: 'tool', name: 'write', input: md, status: 'done' },
      { kind: 'text', text: '写好了。' }
    ])
    expect(out.some((b) => b.kind === 'attachment' && b.path === md)).toBe(true)
  })
})
