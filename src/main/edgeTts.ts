/**
 * EdgeTTS：微软 Edge 在线朗读（小智默认引擎）。
 * 主进程合成 MP3，渲染层解码播放；无需本机模型。
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { Readable } from 'node:stream'
import {
  clampTtsPitch,
  clampTtsRate,
  DEFAULT_EDGE_TTS_VOICE,
  normalizeEdgeTtsVoice
} from '../shared/tts'

export type EdgeTtsSpeakOk = { ok: true; mime: string; base64: string }
export type EdgeTtsSpeakFail = { ok: false; error: string }

type CachedClient = {
  voice: string
  tts: MsEdgeTTS
  ready: Promise<void>
}

let cached: CachedClient | null = null

function rateToProsody(rate: number): number {
  return clampTtsRate(rate)
}

/** pitch 1 → +0Hz；相对默认按半音近似（Edge 认 Hz / 相对值，不认任意 % 时更稳） */
function pitchToProsody(pitch: number): string {
  const p = clampTtsPitch(pitch)
  const hz = Math.round((p - 1) * 50)
  return hz >= 0 ? `+${hz}Hz` : `${hz}Hz`
}

/** 从 ShortName 推断 xml:lang（msedge-tts 切换音色时若不传会炸）。 */
function voiceLocaleOf(shortName: string): string {
  const m = /^([a-z]{2}-[A-Z]{2})/i.exec(shortName)
  return m?.[1] || 'zh-CN'
}

async function getClient(voice: string): Promise<MsEdgeTTS> {
  const v = normalizeEdgeTtsVoice(voice)
  if (cached?.voice === v) {
    await cached.ready
    return cached.tts
  }
  if (cached) {
    try {
      cached.tts.close()
    } catch {
      /* ignore */
    }
    cached = null
  }
  const tts = new MsEdgeTTS()
  // 显式带 voiceLocale，避免库在二次 setMetadata 时读 undefined
  const ready = tts.setMetadata(v, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    voiceLocale: voiceLocaleOf(v)
  })
  cached = { voice: v, tts, ready }
  await ready
  return tts
}

function collectStream(stream: Readable, timeoutMs = 45_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try {
        stream.destroy()
      } catch {
        /* ignore */
      }
      reject(new Error('EdgeTTS 合成超时'))
    }, timeoutMs)

    stream.on('data', (c: Buffer | string) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    })
    stream.on('end', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(Buffer.concat(chunks))
    })
    stream.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })
  })
}

export async function speakViaEdgeTts(opts: {
  text: string
  voice?: string
  rate?: number
  pitch?: number
}): Promise<EdgeTtsSpeakOk | EdgeTtsSpeakFail> {
  const text = (opts.text || '').trim()
  if (!text) return { ok: false, error: '没有可朗读的文本' }

  try {
    const tts = await getClient(opts.voice || DEFAULT_EDGE_TTS_VOICE)
    const { audioStream } = tts.toStream(text, {
      rate: rateToProsody(opts.rate ?? 1),
      pitch: pitchToProsody(opts.pitch ?? 1)
    })
    const buf = await collectStream(audioStream)
    if (!buf.length) return { ok: false, error: 'EdgeTTS 未返回音频' }
    return {
      ok: true,
      mime: 'audio/mpeg',
      base64: buf.toString('base64')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: /ENOTFOUND|ECONN|network|fetch|websocket|timeout|超时/i.test(msg)
        ? `EdgeTTS 需要联网：${msg}`
        : `EdgeTTS 失败：${msg}`
    }
  }
}
