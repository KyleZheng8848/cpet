import { describe, expect, it } from 'vitest'
import {
  collectPreviewFiles,
  collectCurrentRoundMessages,
  extractAttachablePathsFromText,
  extractDocumentPathsFromText,
  extractFilePathFromToolPayload,
  extractLocalImagePaths,
  extractShellOutputPaths,
  filePreviewBasename,
  nextFilePanelFromList,
  formatFileAddedAt,
  isAnnouncedSavePath,
  isAttachableLocalPath,
  isCpetGeneratedPath,
  isDeliverableFilePath,
  isPlausibleLocalPath,
  isResultFilePath,
  recoverAttachablePath,
  isWriteLikeToolName,
  localPathFromCpetFileUrl,
  linkifyBareLocalImagePaths,
  looksLikeFolderPath,
  rewriteLocalImageSrc
} from '../src/shared/filePreview'

describe('isWriteLikeToolName', () => {
  it('accepts common write/edit tools', () => {
    expect(isWriteLikeToolName('Write')).toBe(true)
    expect(isWriteLikeToolName('Edit')).toBe(true)
    expect(isWriteLikeToolName('StrReplace')).toBe(true)
    expect(isWriteLikeToolName('apply_patch')).toBe(true)
  })

  it('rejects delete/read-ish names', () => {
    expect(isWriteLikeToolName('Delete')).toBe(false)
    expect(isWriteLikeToolName('Read')).toBe(false)
    expect(isWriteLikeToolName('')).toBe(false)
  })
})

describe('extractFilePathFromToolPayload', () => {
  it('reads JSON path fields', () => {
    expect(
      extractFilePathFromToolPayload(JSON.stringify({ path: '/Users/example/a.md' }))
    ).toBe('/Users/example/a.md')
    expect(
      extractFilePathFromToolPayload(JSON.stringify({ file_path: '/tmp/x.docx' }))
    ).toBe('/tmp/x.docx')
  })

  it('reads bare absolute path', () => {
    expect(extractFilePathFromToolPayload('/Users/example/Projects/n.md')).toBe(
      '/Users/example/Projects/n.md'
    )
  })
})

describe('filePreviewBasename', () => {
  it('returns last segment', () => {
    expect(filePreviewBasename('/a/b/c.txt')).toBe('c.txt')
    expect(filePreviewBasename('plain.md')).toBe('plain.md')
  })
})

describe('isDeliverableFilePath', () => {
  it('accepts office/pdf/csv/zip', () => {
    expect(isDeliverableFilePath('/tmp/a.docx')).toBe(true)
    expect(isDeliverableFilePath('/tmp/a.pdf')).toBe(true)
    expect(isDeliverableFilePath('/tmp/a.csv')).toBe(true)
  })

  it('rejects source; accepts report-like notes', () => {
    expect(isDeliverableFilePath('/tmp/a.ts')).toBe(false)
    expect(isDeliverableFilePath('/tmp/a.py')).toBe(false)
    expect(isDeliverableFilePath('/tmp/a.md')).toBe(true)
    expect(isDeliverableFilePath('/tmp/a.html')).toBe(true)
  })
})

describe('looksLikeFolderPath / isAttachableLocalPath', () => {
  it('detects folders by trailing slash or no extension', () => {
    expect(looksLikeFolderPath('/Users/example/out/')).toBe(true)
    expect(looksLikeFolderPath('/Users/example/out')).toBe(true)
    expect(looksLikeFolderPath('/Users/example/out/report.docx')).toBe(false)
  })

  it('accepts any file extension and folders; rejects bare home', () => {
    expect(isAttachableLocalPath('/Users/example/out/a.ts')).toBe(true)
    expect(isAttachableLocalPath('/Users/example/out/report.docx')).toBe(true)
    expect(isAttachableLocalPath('/Users/example/Desktop/导出')).toBe(true)
    expect(isAttachableLocalPath('/Users/example')).toBe(false)
    expect(isAttachableLocalPath('/tmp')).toBe(false)
  })
})

describe('isPlausibleLocalPath', () => {
  it('rejects LaTeX / math fragments mistaken for paths', () => {
    expect(isPlausibleLocalPath('/n)/(n+1/n)^n\\]\\).')).toBe(false)
    expect(isPlausibleLocalPath('/n)/(n+1/n)^n\\]\\). \\n\\n###')).toBe(false)
    expect(isPlausibleLocalPath('/n/}(n+1/n)^n\\).')).toBe(false)
    expect(looksLikeFolderPath('/n/}(n+1/n)^n\\).')).toBe(false)
    expect(looksLikeFolderPath('n+###')).toBe(false)
    expect(isPlausibleLocalPath('/Users/example/Desktop/比赛/报告.md')).toBe(true)
  })
})

describe('isResultFilePath', () => {
  it('files yes, folders no', () => {
    expect(isResultFilePath('/Users/example/out/a.md')).toBe(true)
    expect(isResultFilePath('/Users/example/out/exports')).toBe(false)
    expect(isResultFilePath('/Users/example/out/exports/')).toBe(false)
  })
})

describe('extractAttachablePathsFromText latex', () => {
  it('does not extract /n)/… from formula text', () => {
    const paths = extractAttachablePathsFromText(
      '极限 \\(\\lim (1+1/n)^n\\) 与路径 /Users/example/out/a.md'
    )
    expect(paths.some((p) => p.includes('/n)'))).toBe(false)
    expect(paths).toContain('/Users/example/out/a.md')
  })
})

describe('extractShellOutputPaths', () => {
  it('picks -o / redirect targets only', () => {
    expect(
      extractShellOutputPaths(
        'pandoc in.md -o /Users/example/out/report.docx && ls /Users/example/素材'
      )
    ).toEqual(['/Users/example/out/report.docx'])
    expect(extractShellOutputPaths('cat /Users/example/a.csv > /Users/example/out/b.csv')).toEqual([
      '/Users/example/out/b.csv'
    ])
  })
})

describe('extractLocalImagePaths', () => {
  it('reads image-tool localPath JSON mixed with logs', () => {
    const raw = `任务状态: success
下载图片中...
图片已保存: /Users/example/Desktop/anime-image-tool.png
{
  "localPath": "/Users/example/Desktop/anime-image-tool.png",
  "creativeId": "CF_XM286vio7Y839"
}`
    expect(extractLocalImagePaths(raw)).toEqual(['/Users/example/Desktop/anime-image-tool.png'])
  })

  it('ignores ls dumps of random pngs without save markers', () => {
    expect(
      extractLocalImagePaths(
        '-rw-r--r--  1 kyle staff  2700000 /Users/example/Pictures/old.png\n-rw-r--r--  1 kyle staff  12 /Users/example/Pictures/icon.png'
      )
    ).toEqual([])
  })

  it('reads 本地路径 label and localhost image proxy URLs', () => {
    expect(
      extractLocalImagePaths(
        '本地路径：/Users/example/Desktop/huamao-output/a.png\nURL: http://localhost:8080/image?path=%2FUsers%2Fexample%2FDesktop%2Fhuamao-output%2Fa.png'
      )
    ).toEqual(['/Users/example/Desktop/huamao-output/a.png'])
  })

  it('ignores non-image localPath', () => {
    expect(
      extractLocalImagePaths(JSON.stringify({ localPath: '/Users/example/Desktop/notes.md' }))
    ).toEqual([])
  })
  it('reads 图片已生成 with bare absolute path', () => {
    expect(
      extractLocalImagePaths(
        '图片已生成\n/Users/admin/Downloads/cpet-output/image-1698715848207.png\n在线链接: https://cdn.example.com/a.png'
      )
    ).toEqual(['/Users/admin/Downloads/cpet-output/image-1698715848207.png'])
  })

  it('reads markdown local image and localhost proxy', () => {
    expect(
      extractLocalImagePaths('![](/Users/example/Desktop/out/b.webp)')
    ).toEqual(['/Users/example/Desktop/out/b.webp'])
  })
  it('reads 本地: label used by agent metadata', () => {
    expect(
      extractLocalImagePaths(
        '本地: /Users/example/Desktop/cursor-pet/assets/memes-duck.jpg\n格式: image/jpeg'
      )
    ).toEqual(['/Users/example/Desktop/cursor-pet/assets/memes-duck.jpg'])
  })

  it('reads bare absolute image path on its own line', () => {
    expect(
      extractLocalImagePaths(
        '详情如下\n/Users/example/Documents/cursor-cpet/outputs/memes_1739021884632.jpg\n完'
      )
    ).toEqual(['/Users/example/Documents/cursor-cpet/outputs/memes_1739021884632.jpg'])
  })
})

describe('linkifyBareLocalImagePaths', () => {
  it('turns bare path lines into markdown images', () => {
    expect(
      linkifyBareLocalImagePaths(
        'ok\n/Users/example/Documents/cursor-cpet/outputs/a.jpg\nend'
      )
    ).toBe('ok\n![本地图片](/Users/example/Documents/cursor-cpet/outputs/a.jpg)\nend')
  })
  it('reads image path embedded in a shell command line', () => {
    expect(
      extractLocalImagePaths('ls -lh /Users/example/Desktop/anime-girl-sunset.png')
    ).toEqual(['/Users/example/Desktop/anime-girl-sunset.png'])
  })

  it('still ignores multi-file ls dumps without save markers', () => {
    expect(
      extractLocalImagePaths(
        '-rw-r--r--  1 kyle staff  2700000 /Users/example/Pictures/old.png\n-rw-r--r--  1 kyle staff  12 /Users/example/Pictures/icon.png'
      )
    ).toEqual([])
  })
})

describe('localPathFromCpetFileUrl', () => {
  it('round-trips cpet-file urls', () => {
    const path = '/Users/example/Desktop/out/a.png'
    const url = `cpet-file://local/?p=${encodeURIComponent(path)}`
    expect(localPathFromCpetFileUrl(url)).toBe(path)
    expect(localPathFromCpetFileUrl(path)).toBe(path)
  })
})

describe('rewriteLocalImageSrc', () => {
  it('rewrites absolute path, file url and localhost proxy to cpet-file', () => {
    const path = '/Users/example/Desktop/huamao-output/a.png'
    const encoded = encodeURIComponent(path)
    expect(rewriteLocalImageSrc(path)).toBe(`cpet-file://local/?p=${encoded}`)
    expect(rewriteLocalImageSrc(`file://${path}`)).toBe(`cpet-file://local/?p=${encoded}`)
    expect(rewriteLocalImageSrc(`http://localhost:8080/image?path=${encoded}`)).toBe(
      `cpet-file://local/?p=${encoded}`
    )
    expect(rewriteLocalImageSrc('https://cdn.example.com/a.png')).toBeNull()
  })
})

describe('extractAttachablePathsFromText', () => {
  it('can still parse paths (用于其它场景)；挂附件不直接扫正文', () => {
    const paths = extractAttachablePathsFromText(
      '报告 /Users/example/out/report.docx ，目录 /Users/example/out/exports/'
    )
    expect(paths).toContain('/Users/example/out/report.docx')
    expect(paths).toContain('/Users/example/out/exports')
    expect(extractDocumentPathsFromText('见 report.docx')).toEqual([])
  })
})

describe('collectPreviewFiles', () => {
  it('dedupes composer and message attachments and keeps current', () => {
    const files = collectPreviewFiles({
      composer: [{ path: '/Users/example/a.pptx', name: 'a.pptx' }],
      messageAttachments: [
        { path: '/Users/example/a.pptx', name: 'a.pptx' },
        { path: '/Users/example/b.gif', name: 'b.gif' }
      ],
      current: { path: '/Users/example/c.csv', name: 'c.csv', source: 'manual' }
    })
    expect(files.map((f) => f.name)).toEqual(['a.pptx', 'b.gif', 'c.csv'])
  })

  it('drops latex fragments from the preview rail', () => {
    expect(
      collectPreviewFiles({
        current: { path: '/n/}(n+1/n)^n\\).', name: 'n+###', source: 'tool' }
      })
    ).toEqual([])
  })

  it('sorts by addedAt newest first and keeps previous after detach', () => {
    const files = collectPreviewFiles({
      previous: [{ path: '/Users/example/old.docx', name: 'old.docx', source: 'attachment', addedAt: 100 }],
      composer: [{ path: '/Users/example/new.pdf', name: 'new.pdf', addedAt: 300 }],
      messageAttachments: [{ path: '/Users/example/mid.csv', name: 'mid.csv', addedAt: 200 }]
    })
    expect(files.map((f) => f.name)).toEqual(['new.pdf', 'mid.csv', 'old.docx'])
  })

  it('hidden paths leave the round list even if still in messages', () => {
    const files = collectPreviewFiles({
      previous: [{ path: '/Users/example/a.png', name: 'a.png', source: 'manual', addedAt: 1 }],
      messageAttachments: [{ path: '/Users/example/a.png', name: 'a.png' }],
      composer: [{ path: '/Users/example/b.png', name: 'b.png' }],
      hidden: ['/Users/example/a.png']
    })
    expect(files.map((f) => f.name)).toEqual(['b.png'])
  })

  it('pinned files stay above newer unpinned ones', () => {
    const files = collectPreviewFiles({
      previous: [
        { path: '/Users/example/old.docx', name: 'old.docx', source: 'attachment', addedAt: 100 },
        { path: '/Users/example/new.pdf', name: 'new.pdf', source: 'attachment', addedAt: 300 }
      ],
      pinned: [{ path: '/Users/example/old.docx', pinnedAt: 500 }]
    })
    expect(files.map((f) => f.name)).toEqual(['old.docx', 'new.pdf'])
    expect(files[0].pinnedAt).toBe(500)
  })

  it('more recently pinned file wins the top slot', () => {
    const files = collectPreviewFiles({
      previous: [
        { path: '/Users/example/a.png', name: 'a.png', source: 'manual', addedAt: 1 },
        { path: '/Users/example/b.png', name: 'b.png', source: 'manual', addedAt: 2 }
      ],
      pinned: [
        { path: '/Users/example/a.png', pinnedAt: 10 },
        { path: '/Users/example/b.png', pinnedAt: 20 }
      ]
    })
    expect(files.map((f) => f.name)).toEqual(['b.png', 'a.png'])
  })
})

describe('paths with spaces', () => {
  const img =
    '/Users/example/Library/Application Support/cursor-pet/generated/huami_1739344473211.jpg'
  const md =
    '/Users/example/Library/Application Support/cursor-pet/skills/outputs/月报_2025-02.md'

  it('accepts Application Support paths with spaces', () => {
    expect(isPlausibleLocalPath(img)).toBe(true)
    expect(isAttachableLocalPath(img)).toBe(true)
    expect(extractLocalImagePaths(`本地: ${img}\n格式: image/jpeg`)).toEqual([img])
  })

  it('recovers Write/正文里的 Application Support 文稿路径', () => {
    expect(recoverAttachablePath(md)).toBe(md)
    expect(extractFilePathFromToolPayload(md)).toBe(md)
    expect(
      extractFilePathFromToolPayload(JSON.stringify({ path: md }))
    ).toBe(md)
    expect(
      extractAttachablePathsFromText(`报告已生成，保存至：${md}`)
    ).toContain(md)
    expect(
      extractShellOutputPaths(`python write.py -o "${md}"`)
    ).toEqual([md])
  })

  it('cuts trailing words after a spaced path', () => {
    expect(recoverAttachablePath(`${md} 请查看`)).toBe(md)
  })

  it('recognizes skill output dir and 保存至 label', () => {
    expect(isCpetGeneratedPath(md)).toBe(true)
    expect(isAnnouncedSavePath(`报告已生成，保存至：${md}`, md)).toBe(true)
    expect(isAnnouncedSavePath(`结合 ${md} 继续改`, md)).toBe(false)
  })
})

describe('collectCurrentRoundMessages', () => {
  it('keeps only the latest user turn and matching compare lane replies', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      { id: 'u2', role: 'user' }
    ]
    const lanes = {
      a: {
        messages: [
          { id: 'a1', role: 'assistant' },
          { id: 'a2', role: 'assistant' }
        ]
      },
      b: {
        messages: [
          { id: 'b1', role: 'assistant' },
          { id: 'b2', role: 'assistant' }
        ]
      }
    }
    expect(collectCurrentRoundMessages({ messages, lanes }).map((m) => m.id)).toEqual([
      'u2',
      'a2',
      'b2'
    ])
  })

  it('includes main-thread assistants after the latest user', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' }
    ]
    expect(collectCurrentRoundMessages({ messages }).map((m) => m.id)).toEqual(['u2', 'a2'])
  })
})

describe('nextFilePanelFromList', () => {
  it('消息里点开文件不算列表入口，关预览不回列表', () => {
    expect(nextFilePanelFromList(false, false)).toBe(false)
    expect(nextFilePanelFromList(false, true)).toBe(false)
  })

  it('本对话文件列表里再点开，仍算列表入口', () => {
    expect(nextFilePanelFromList(true, true)).toBe(true)
    expect(nextFilePanelFromList(true, false)).toBe(false)
  })
})

describe('formatFileAddedAt', () => {
  const now = new Date(2026, 7, 13, 15, 0, 0).getTime()
  it('uses relative labels then clock', () => {
    expect(formatFileAddedAt(now - 10_000, now)).toBe('刚刚')
    expect(formatFileAddedAt(now - 3 * 60_000, now)).toBe('3分钟前')
    expect(formatFileAddedAt(new Date(2026, 7, 13, 9, 5, 0).getTime(), now)).toBe('今天 09:05')
    expect(formatFileAddedAt(new Date(2026, 7, 12, 21, 10, 0).getTime(), now)).toBe('昨天 21:10')
  })
})
