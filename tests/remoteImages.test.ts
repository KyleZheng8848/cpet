import { describe, expect, it } from 'vitest'
import { extractRemoteImageUrls, imageMarkdownForUrls } from '../src/shared/remoteImages'
import type { ChatBlock } from '../src/shared/types'
import {
  blocksForDisplay,
  finalizeAssistantBlocks,
  promoteOutputImages
} from '../src/renderer/src/chat/processBlocks'

describe('extractRemoteImageUrls', () => {
  it('reads AntV resultObj', () => {
    const raw = JSON.stringify({
      success: true,
      errorMessage: '成功',
      resultObj:
        'https://images.example.com/img/K-5fS7j7qGgAAAAAAAAAAAAAaGAoEACAQFr/original',
      traceId: 'abc'
    })
    expect(extractRemoteImageUrls(raw)).toEqual([
      'https://images.example.com/img/K-5fS7j7qGgAAAAAAAAAAAAAaGAoEACAQFr/original'
    ])
  })

  it('ignores non-image https', () => {
    expect(extractRemoteImageUrls('see https://example.com/docs')).toEqual([])
  })
})

describe('promoteOutputImages', () => {
  it('appends markdown image and raw URL when the model forgot', () => {
    const url =
      'https://images.example.com/img/x7LzSLmqua8AAAAAARoAAAAAaGAoEACAQFr/original'
    const blocks: ChatBlock[] = [
      {
        kind: 'text',
        text: '图 1：研发时间线（里程碑）'
      },
      {
        kind: 'command',
        command: 'curl -X POST https://charts.example.com/api/render -d "{}"',
        output: JSON.stringify({ success: true, resultObj: url }),
        exitCode: 0,
        status: 'done'
      }
    ]
    const out = promoteOutputImages(blocks)
    const text = out
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain(`![图表 1](${url})`)
    expect(text).toContain(url)
  })

  it('finalize still surfaces the image when process is later hidden', () => {
    const url = 'https://images.example.com/img/abc/original'
    const out = finalizeAssistantBlocks([
      { kind: 'text', text: '图 1：研发时间线' },
      {
        kind: 'command',
        command: 'curl antv',
        output: `{"success":true,"resultObj":"${url}"}`,
        exitCode: 0,
        status: 'done'
      }
    ])
    const text = out
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain(url)
    expect(imageMarkdownForUrls([url])).toContain(url)
  })

  it('关过程时仍能从命令输出里看见图片地址', () => {
    const url = 'https://images.example.com/img/hidden/original'
    const shown = blocksForDisplay(
      [
        { kind: 'text', text: '图 1：研发时间线' },
        {
          kind: 'command',
          command: 'curl antv',
          output: `{"success":true,"resultObj":"${url}"}`,
          exitCode: 0,
          status: 'done'
        }
      ],
      false,
      'assistant'
    )
    const text = shown
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(shown.some((b) => b.kind === 'command')).toBe(false)
    expect(text).toContain(url)
    expect(text).toContain(`![图表 1](${url})`)
  })

  it('promotes CDN url from plain assistant text even when URL already appears as prose', () => {
    const url = 'https://cdn.seaart.ai/static/xxx/image-tool-1738482735404.jpg'
    const out = promoteOutputImages([
      {
        kind: 'text',
        text: `图片已成功生成！\n本地路径: /Users/example/Projects/image-tool-output/image-tool-1738482735404.jpg\nCDN: ${url}`
      }
    ])
    const text = out
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain(`![图表 1](${url})`)
    // 正文只写了本地路径、没插图 → 仍要挂附件卡，否则这张图彻底看不见
    expect(
      out.some((b) => b.kind === 'attachment' && b.path.includes('image-tool-1738482735404.jpg'))
    ).toBe(true)
  })
})
