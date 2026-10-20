import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  budgetVisionImages,
  buildApiChatMessages,
  classifyMediaReject,
  composeUserContent,
  formatApiHistoryAttachmentNote,
  imageSendHint,
  isNativeAudioMedia,
  isNativeVideoMedia,
  isNativeVisionMedia,
  formatInlinedDocuments,
  leftoverAttachmentNote,
  leftoverUserNotice,
  mediaSendHint,
  nativeVisionPaths,
  oversizedMediaHint,
  resolveImageSendMode,
  resolveNativePackStyle,
  unsupportedVisionHint
} from '../src/shared/multimodal'
import { attachmentReadHint } from '../src/shared/attachmentMedia'
import {
  loadInlineDocuments,
  loadNativeMedia,
  loadRemoteVisionImages,
  loadVisionImages,
  promptWithAttachmentsForLane,
  readVisionImage,
  resolveAttachmentFsPath
} from '../src/main/attachments'
import { buildCodexExecArgv } from '../src/shared/agentAutonomy'

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('native vision gate', () => {
  it('only accepts png/jpeg/gif/webp', () => {
    expect(isNativeVisionMedia('a.png')).toBe(true)
    expect(isNativeVisionMedia('a.JPG')).toBe(true)
    expect(isNativeVisionMedia('a.webp', 'image/webp')).toBe(true)
    expect(isNativeVisionMedia('a.heic', 'image/heic')).toBe(false)
    expect(isNativeVisionMedia('a.svg')).toBe(false)
    expect(isNativeVisionMedia('a.bmp')).toBe(false)
    expect(nativeVisionPaths([{ path: '/x/a.png' }, { path: '/x/b.heic' }])).toEqual(['/x/a.png'])
    expect(isNativeAudioMedia('a.mp3')).toBe(true)
    expect(isNativeAudioMedia('a.m4a')).toBe(true)
    expect(isNativeVideoMedia('clip.mp4')).toBe(true)
    expect(isNativeVideoMedia('clip.mkv')).toBe(false)
  })

  it('routes send mode without collapsing mixed compare into fake native', () => {
    expect(resolveImageSendMode({ customApiOnly: true, hasCodex: false, hasOtherAgent: false })).toBe(
      'native-api'
    )
    expect(resolveImageSendMode({ customApiOnly: false, hasCodex: true, hasOtherAgent: false })).toBe(
      'codex-flag'
    )
    expect(resolveImageSendMode({ customApiOnly: false, hasCodex: true, hasOtherAgent: true })).toBe(
      'path-read'
    )
    expect(
      resolveImageSendMode({
        customApiOnly: false,
        hasCodex: true,
        hasOtherAgent: false,
        hasCustomApi: true
      })
    ).toBe('mixed')
    expect(
      resolveImageSendMode({
        customApiOnly: false,
        hasCodex: false,
        hasOtherAgent: true,
        hasCustomApi: true
      })
    ).toBe('mixed')
  })
})

describe('attachment notes', () => {
  it('CLI image hint asks to Read pixels, not pretend the model already sees it', () => {
    expect(attachmentReadHint('shot.png')).toMatch(/Read/)
    expect(attachmentReadHint('shot.png')).not.toMatch(/请直接分析/)
    expect(attachmentReadHint('photo.heic')).toMatch(/PNG\/JPEG/)
  })

  it('history note names images without dumping paths as if they were visible', () => {
    expect(
      formatApiHistoryAttachmentNote([
        { path: '/tmp/a.png', name: 'a.png', mime: 'image/png' },
        { path: '/tmp/n.md', name: 'n.md' }
      ])
    ).toBe('[图片 a.png]\n\n[附件 n.md]')
  })

  it('history note names audio and video as their own kinds', () => {
    expect(
      formatApiHistoryAttachmentNote([
        { path: '/tmp/a.mp3', name: 'a.mp3', mime: 'audio/mpeg' },
        { path: '/tmp/b.mp4', name: 'b.mp4', mime: 'video/mp4' }
      ])
    ).toBe('[音频 a.mp3]\n\n[视频 b.mp4]')
  })

  it('leftover note keeps HEIC/oversize out of native-looking success', () => {
    const note = leftoverAttachmentNote(
      [
        { path: '/tmp/ok.png', name: 'ok.png', mime: 'image/png' },
        { path: '/tmp/x.heic', name: 'x.heic', mime: 'image/heic' },
        { path: '/tmp/n.md', name: 'n.md' }
      ],
      ['/tmp/ok.png'],
      { includeNonImages: true }
    )
    expect(note).toContain('x.heic')
    expect(note).toContain('另存为 PNG/JPEG')
    expect(note).toContain('n.md')
    expect(note).toContain('打不开本地文件')
    expect(note).not.toContain('ok.png')
    expect(note).not.toMatch(/请用 Read/)
    expect(
      leftoverUserNotice(
        [
          { path: '/tmp/ok.png', name: 'ok.png', mime: 'image/png' },
          { path: '/tmp/x.heic', name: 'x.heic', mime: 'image/heic' },
          { path: '/tmp/n.md', name: 'n.md' }
        ],
        ['/tmp/ok.png']
      )
    ).toBe('直连没有把 x.heic、n.md 发给模型（打不开本地路径）')
    expect(
      leftoverAttachmentNote(
        [
          { path: '/tmp/ok.png', name: 'ok.png', mime: 'image/png' },
          { path: '/tmp/n.md', name: 'n.md' }
        ],
        ['/tmp/ok.png'],
        { inlinedPaths: ['/tmp/n.md'] }
      )
    ).toBe('')
    expect(
      leftoverUserNotice(
        [
          { path: '/tmp/ok.png', name: 'ok.png', mime: 'image/png' },
          { path: '/tmp/n.md', name: 'n.md' }
        ],
        ['/tmp/ok.png'],
        { inlinedPaths: ['/tmp/n.md'] }
      )
    ).toBe('')
  })

  it('inlines readable document text for the model', () => {
    expect(
      formatInlinedDocuments([{ path: '/tmp/n.md', name: 'n.md', text: '# 标题\n正文' }])
    ).toBe('【文件 n.md】\n# 标题\n正文')
  })

  it('anthropic leftover tells the truth about audio instead of pretending a path is listen-able', () => {
    const note = leftoverAttachmentNote(
      [{ path: '/tmp/v.mp3', name: 'v.mp3', mime: 'audio/mpeg' }],
      [],
      { pack: 'anthropic' }
    )
    expect(note).toContain('Anthropic')
    expect(note).toContain('不能把音频当声音')
    expect(note).not.toMatch(/请用工具读取该音频/)
  })

  it('composer hints stay literal', () => {
    expect(imageSendHint('native-api', 2)).toContain('作为画面')
    expect(imageSendHint('codex-flag', 1)).toContain('Codex')
    expect(unsupportedVisionHint(1)).toContain('PNG/JPEG/GIF/WebP')
    expect(imageSendHint('native-api', 0)).toBe('')
    expect(mediaSendHint('native-api', { image: 1, audio: 1, video: 1 })).toContain('作为声音')
    expect(mediaSendHint('native-api', { image: 1, audio: 1, video: 1 })).toContain('作为影像')
    expect(mediaSendHint('mixed', { image: 1, audio: 0, video: 0 })).toContain('直连列')
    expect(mediaSendHint('mixed', { image: 1, audio: 0, video: 0 })).toContain('Agent 列')
    expect(oversizedMediaHint({ image: 1, audio: 0, video: 0 })).toContain('超过')
    expect(oversizedMediaHint({ image: 1, audio: 0, video: 0 })).toContain('不会作为画面')
  })

  it('budget-dropped leftover says context is full, not that the file is broken', () => {
    const note = leftoverAttachmentNote(
      [{ path: '/tmp/old.png', name: 'old.png', mime: 'image/png' }],
      [],
      { includeNonImages: false, budgetDropped: true }
    )
    expect(note).toContain('上下文已满')
    expect(note).toContain('未再次内嵌画面')
    expect(note).not.toContain('过大或读失败')
    const byPath = leftoverAttachmentNote(
      [{ path: '/tmp/now.png', name: 'now.png', mime: 'image/png' }],
      [],
      { includeNonImages: false, budgetDroppedPaths: ['/tmp/now.png'] }
    )
    expect(byPath).toContain('上下文已满')
  })

  it('custom-api lane keeps the prompt clean; agent lane writes Read paths', () => {
    const atts = [{ path: '/tmp/a.png', name: 'a.png', mime: 'image/png' }]
    expect(promptWithAttachmentsForLane('看这张', atts, true)).toBe('看这张')
    expect(promptWithAttachmentsForLane('看这张', atts, false)).toContain('[附件]')
    expect(promptWithAttachmentsForLane('看这张', atts, false)).toContain('/tmp/a.png')
  })
})

describe('API message assembly', () => {
  it('puts images before text for both OpenAI and Anthropic', () => {
    const img = { name: 'a.png', mime: 'image/png', base64: 'AAA' }
    const openai = composeUserContent('看这张图', [img], 'openai')
    const anthropic = composeUserContent('看这张图', [img], 'anthropic')
    expect(openai).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'text', text: '看这张图' }
    ])
    expect(anthropic).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
      { type: 'text', text: '看这张图' }
    ])
  })

  it('packs wav as input_audio and mp4 as video_url on gateways', () => {
    const mixed = composeUserContent(
      '这段里说了什么',
      [
        { kind: 'audio', name: 'a.wav', mime: 'audio/wav', base64: 'AUD', audioFormat: 'wav' },
        { kind: 'video', name: 'b.mp4', mime: 'video/mp4', base64: 'VID' }
      ],
      'openai',
      'openai-gateway',
      'video_url'
    )
    expect(mixed).toEqual([
      { type: 'input_audio', input_audio: { data: 'AUD', format: 'wav' } },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,VID' } },
      { type: 'text', text: '这段里说了什么' }
    ])
  })

  it('official OpenAI packs video as file, not video_url', () => {
    const parts = composeUserContent(
      '看这段',
      [{ kind: 'video', name: 'b.mp4', mime: 'video/mp4', base64: 'VID' }],
      'openai',
      'openai-official',
      'file'
    )
    expect(parts).toEqual([
      { type: 'file', file: { filename: 'b.mp4', file_data: 'data:video/mp4;base64,VID' } },
      { type: 'text', text: '看这段' }
    ])
    expect(resolveNativePackStyle('openai', 'https://api.openai.com/v1')).toBe('openai-official')
    expect(resolveNativePackStyle('openai', 'https://openrouter.ai/api/v1')).toBe('openai-gateway')
  })

  it('anthropic compose drops audio/video parts and keeps the image', () => {
    const parts = composeUserContent(
      '看',
      [
        { kind: 'image', name: 'a.png', mime: 'image/png', base64: 'AAA' },
        { kind: 'audio', name: 'a.wav', mime: 'audio/wav', base64: 'AUD', audioFormat: 'wav' }
      ],
      'anthropic',
      'anthropic'
    )
    expect(parts).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
      { type: 'text', text: '看' }
    ])
  })

  it('400 classifier strips audio without inventing a thinking-field retry', () => {
    expect(classifyMediaReject('unknown field input_audio', 'video_url')).toEqual({
      kind: 'drop-audio'
    })
    expect(classifyMediaReject('unsupported content type video_url', 'video_url')).toEqual({
      kind: 'switch-video',
      videoPack: 'file'
    })
    expect(classifyMediaReject('enable_thinking is not supported', 'video_url')).toBeNull()
  })

  it('keeps current-turn images first when history would overflow the budget', () => {
    const cur = ['now']
    const hist = [['old1', 'old2'], ['mid']]
    const budget = budgetVisionImages(cur, hist, 2)
    expect(budget.current).toEqual(['now'])
    expect(budget.history).toEqual([['old1'], []])
  })

  it('builds a user message with native parts and leftover file note', () => {
    const messages = buildApiChatMessages({
      format: 'openai',
      systemPrompt: 'sys',
      history: [{ role: 'user', content: '[图片 old.png]', images: [] }],
      prompt: '红色框里是什么',
      promptImages: [{ name: 'now.png', mime: 'image/png', base64: 'BBB' }],
      leftoverNote: '[附件]\n- /tmp/a.md（请用 Read 读取全文）'
    })
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(messages[1]).toEqual({ role: 'user', content: '[图片 old.png]' })
    expect(messages[2].role).toBe('user')
    expect(messages[2].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } },
      { type: 'text', text: '红色框里是什么\n\n[附件]\n- /tmp/a.md（请用 Read 读取全文）' }
    ])
  })
})

describe('direct-api file contents', () => {
  it('resolves file:// and inlines markdown instead of leftover-only', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-inline-'))
    try {
      const png = join(root, 'a.png')
      const md = join(root, 'note.md')
      writeFileSync(png, Buffer.from(PNG_B64, 'base64'))
      writeFileSync(md, '# 看这\n里面有一段说明。')
      expect(resolveAttachmentFsPath(`file://${png}`)).toBe(png)
      const images = loadVisionImages([{ path: `file://${png}`, name: 'a.png', mime: 'image/png' }])
      expect(images).toHaveLength(1)
      expect(images[0].base64.length).toBeGreaterThan(20)
      const docs = loadInlineDocuments([
        { path: md, name: 'note.md' },
        { path: png, name: 'a.png', mime: 'image/png' }
      ])
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('note.md')
      expect(docs[0].text).toContain('里面有一段说明')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not fetch localhost remote images', async () => {
    const loaded = await loadRemoteVisionImages([
      'http://127.0.0.1/secret.png',
      'https://localhost/a.jpg',
      'not-a-url'
    ])
    expect(loaded).toEqual([])
  })

  it('packs the same request shape openaiCompat sends: image_url + file body, no leftover', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-pack-'))
    try {
      const png = join(root, 'shot.png')
      const md = join(root, 'brief.md')
      writeFileSync(png, Buffer.from(PNG_B64, 'base64'))
      writeFileSync(md, '封面是一只橘猫。')
      const attachments = [
        { path: `file://${png}`, name: 'shot.png', mime: 'image/png' },
        { path: md, name: 'brief.md' }
      ]
      const media = loadNativeMedia(attachments)
      const docs = loadInlineDocuments(attachments)
      const nativePaths = new Set(media.map((m) => m.path).filter((p): p is string => !!p))
      const leftover = leftoverAttachmentNote(attachments, nativePaths, {
        inlinedPaths: docs.map((d) => d.path)
      })
      const leftoverUser = leftoverUserNotice(attachments, nativePaths, {
        inlinedPaths: docs.map((d) => d.path)
      })
      const messages = buildApiChatMessages({
        format: 'openai',
        pack: 'openai-gateway',
        prompt: ['图上是什么', formatInlinedDocuments(docs)].filter(Boolean).join('\n\n'),
        promptMedia: media,
        leftoverNote: leftover
      })
      const user = messages[messages.length - 1]
      expect(media.map((m) => m.kind)).toEqual(['image'])
      expect(docs.map((d) => d.name)).toEqual(['brief.md'])
      expect(leftover).toBe('')
      expect(leftoverUser).toBe('')
      expect(user.role).toBe('user')
      expect(Array.isArray(user.content)).toBe(true)
      const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/png;base64,'))).toBe(
        true
      )
      const text = parts.find((p) => p.type === 'text')?.text || ''
      expect(text).toContain('图上是什么')
      expect(text).toContain('【文件 brief.md】')
      expect(text).toContain('封面是一只橘猫')
      expect(text).not.toContain('打不开本地')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('loadVisionImages', () => {
  it('reads a real png and skips heic-named bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-vision-'))
    try {
      const png = join(root, 'a.png')
      const heic = join(root, 'b.heic')
      writeFileSync(png, Buffer.from(PNG_B64, 'base64'))
      writeFileSync(heic, Buffer.from(PNG_B64, 'base64'))
      const loaded = loadVisionImages([
        { path: png, name: 'a.png', mime: 'image/png' },
        { path: heic, name: 'b.heic', mime: 'image/heic' }
      ])
      expect(loaded[0].name).toBe('a.png')
      expect(loaded[0].mime).toBe('image/png')
      expect(loaded[0].base64.length).toBeGreaterThan(20)
      if (process.platform === 'darwin') {
        expect(loaded).toHaveLength(2)
        expect(loaded[1].name).toBe('b.heic')
        expect(loaded[1].mime).toBe('image/jpeg')
        expect(readVisionImage(heic)?.mime).toBe('image/jpeg')
      } else {
        expect(loaded).toHaveLength(1)
        expect(readVisionImage(heic)).toBeNull()
      }
      const mp3 = join(root, 'v.mp3')
      const mp4 = join(root, 'c.mp4')
      writeFileSync(mp3, Buffer.from('ID3fake'))
      writeFileSync(mp4, Buffer.from('ftypfake'))
      const media = loadNativeMedia([
        { path: png, name: 'a.png', mime: 'image/png' },
        { path: mp3, name: 'v.mp3', mime: 'audio/mpeg' },
        { path: mp4, name: 'c.mp4', mime: 'video/mp4' }
      ])
      expect(media.map((m) => m.kind)).toEqual(['image', 'audio', 'video'])
      expect(media[1].audioFormat).toBe('mp3')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('codex --image', () => {
  it('puts CSV --image before resume and keeps prompt after --', () => {
    const uuid = '019fcc8d-93fe-7452-ae34-4bcfd44bf2e0'
    const args = buildCodexExecArgv({
      autonomy: 'agent',
      prompt: '看图',
      sessionId: uuid,
      images: ['/tmp/a.png', '/tmp/b.jpg']
    })
    const imgAt = args.indexOf('--image')
    expect(args[imgAt + 1]).toBe('/tmp/a.png,/tmp/b.jpg')
    expect(imgAt).toBeLessThan(args.indexOf('resume'))
    expect(args.at(-2)).toBe('--')
    expect(args.at(-1)).toBe('看图')
  })
})
