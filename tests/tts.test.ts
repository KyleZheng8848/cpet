import { describe, expect, it } from 'vitest'
import {
  clipTtsInput,
  clampTtsRate,
  DEFAULT_COSYVOICE_MODEL,
  DEFAULT_EDGE_TTS_VOICE,
  isTtsEngineOn,
  normalizeCosyvoiceModel,
  normalizeCosyvoicePort,
  normalizeEdgeTtsVoice,
  normalizeTtsMode,
  prepareTtsChunks,
  pullTtsStreamChunk,
  sanitizeTtsSpeakText,
  TTS_CHUNK_CHARS
} from '../src/shared/tts'
import {
  DEFAULT_QUICK_CHAT_SETTINGS,
  normalizeQuickChatSettings
} from '../src/shared/quickChat'

describe('tts settings', () => {
  it('defaults to off', () => {
    expect(DEFAULT_QUICK_CHAT_SETTINGS.tts).toBe('off')
    expect(normalizeTtsMode(undefined)).toBe('off')
    expect(normalizeTtsMode(true)).toBe('off')
    expect(normalizeQuickChatSettings({}).tts).toBe('off')
    expect(DEFAULT_QUICK_CHAT_SETTINGS.ttsEdgeVoice).toBe(DEFAULT_EDGE_TTS_VOICE)
  })

  it('normalizes mode and clamps rate', () => {
    expect(normalizeTtsMode('edge')).toBe('edge')
    expect(normalizeTtsMode('edgetts')).toBe('edge')
    expect(normalizeTtsMode('local')).toBe('local')
    expect(normalizeTtsMode('api')).toBe('local')
    expect(normalizeTtsMode('cloud')).toBe('local')
    expect(normalizeTtsMode('off')).toBe('off')
    expect(normalizeTtsMode('system')).toBe('off')
    expect(isTtsEngineOn('edge')).toBe(true)
    expect(isTtsEngineOn('local')).toBe(true)
    expect(isTtsEngineOn('off')).toBe(false)
    expect(normalizeEdgeTtsVoice('')).toBe(DEFAULT_EDGE_TTS_VOICE)
    expect(normalizeEdgeTtsVoice('zh-CN-YunxiNeural')).toBe('zh-CN-YunxiNeural')
    // 已下架音色回落到可用默认
    expect(normalizeEdgeTtsVoice('zh-CN-XiaohanNeural')).toBe(DEFAULT_EDGE_TTS_VOICE)
    expect(normalizeEdgeTtsVoice('zh-CN-not-a-voice')).toBe(DEFAULT_EDGE_TTS_VOICE)
    expect(clampTtsRate(3)).toBe(2)
    expect(clampTtsRate(0.2)).toBe(0.5)
  })

  it('normalizes cosyvoice model and port', () => {
    expect(normalizeCosyvoiceModel('')).toBe(DEFAULT_COSYVOICE_MODEL)
    expect(normalizeCosyvoiceModel('iic/CosyVoice-300M')).toBe('iic/CosyVoice-300M')
    expect(normalizeCosyvoiceModel('tts-1-hd')).toBe(DEFAULT_COSYVOICE_MODEL)
    expect(normalizeCosyvoiceModel('tts-1')).toBe(DEFAULT_COSYVOICE_MODEL)
    expect(normalizeCosyvoicePort(80)).toBe(1024)
    expect(normalizeCosyvoicePort(18765)).toBe(18765)
  })

  it('ignores legacy openai ttsModel when normalizing quickChat', () => {
    const q = normalizeQuickChatSettings({
      tts: 'api',
      ttsModel: 'tts-1-hd',
      ttsRate: 1.2,
      cosyvoiceRoot: '/tmp/CosyVoice',
      ttsVoiceId: 'v1'
    })
    expect(q.tts).toBe('local')
    expect(q.cosyvoiceModel).toBe(DEFAULT_COSYVOICE_MODEL)
    expect(q.cosyvoiceRoot).toBe('/tmp/CosyVoice')
    expect(q.ttsVoiceId).toBe('v1')
    expect(q.ttsRate).toBe(1.2)
  })

  it('clips long input', () => {
    expect(clipTtsInput('a'.repeat(20), 10).endsWith('…')).toBe(true)
  })

  it('splits long chinese into short speakable chunks', () => {
    const text = '第一句。'.repeat(40) + '结尾！'
    const chunks = prepareTtsChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= TTS_CHUNK_CHARS)).toBe(true)
    expect(chunks.join('')).toContain('第一句')
  })

  it('pulls stream chunks at sentence then soft punctuation', () => {
    // 够长的句末才切
    const a = pullTtsStreamChunk(
      '这是一句足够长可以按句号切开的中文内容。后面还有',
      { minSentence: 10, softMin: 10 }
    )
    expect(a.chunk).toContain('。')
    expect(a.rest).toBe('后面还有')

    // 短句「好。」不切，避免 CosyVoice 一字一合成
    const short = pullTtsStreamChunk('好。继续', { minSentence: 20 })
    expect(short.chunk).toBeNull()

    const b = pullTtsStreamChunk('这是一段够长的逗号分隔内容，后面继续', { softMin: 8, minSentence: 40 })
    expect(b.chunk?.endsWith('，')).toBe(true)
    expect(b.rest).toContain('后面继续')

    // 未到 softMin 的逗号：继续等
    const wait = pullTtsStreamChunk('你好，世界还没说完', { softMin: 28, eager: true, minSentence: 40 })
    expect(wait.chunk).toBeNull()

    const c = pullTtsStreamChunk('短', { force: true })
    expect(c.chunk).toBe('短')
  })

  it('only hard-cuts unpunctuated text when too long', () => {
    // 短于硬切阈值：继续等
    const mid = '这是一段没有标点的短文'
    const hold = pullTtsStreamChunk(mid, { eager: true, eagerChars: 120, maxChunk: 120 })
    expect(hold.chunk).toBeNull()

    const raw = `${'没有标点的中文内容继续往后写'.repeat(16)}还要更多`
    expect(raw.length).toBeGreaterThan(TTS_CHUNK_CHARS)
    const r = pullTtsStreamChunk(raw, { eager: true })
    expect(r.chunk).toBeTruthy()
    expect((r.chunk || '').length).toBeLessThanOrEqual(TTS_CHUNK_CHARS)
    expect(r.rest.length).toBeGreaterThan(0)
  })

  it('strips markdown and process lines before speak', () => {
    const raw = [
      '思考：先查一下文件',
      '**你好**，这是 *测试*。',
      '```js',
      'console.log(1)',
      '```',
      '【技能 /demo】请忽略这段',
      '正文继续。',
      '- 列表一项',
      'Tool: running grep'
    ].join('\n')
    const out = sanitizeTtsSpeakText(raw)
    expect(out).toContain('你好')
    expect(out).toContain('测试')
    expect(out).toContain('正文继续')
    expect(out).toContain('列表一项')
    expect(out).not.toContain('**')
    expect(out).not.toContain('console.log')
    expect(out).not.toContain('思考：')
    expect(out).not.toContain('【技能')
    expect(out).not.toMatch(/Tool:/i)
  })

  it('strips emoji before speak', () => {
    const out = sanitizeTtsSpeakText('你好🎉世界👍！家庭👨‍👩‍👧完成✅')
    expect(out).toBe('你好世界！家庭完成')
    expect(out).not.toMatch(/🎉|👍|👨‍👩‍👧|✅/)
  })

  it('clipTtsInput also sanitizes', () => {
    expect(clipTtsInput('**加粗** 与 `code`')).toBe('加粗 与 code')
  })
})
