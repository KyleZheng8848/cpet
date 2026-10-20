/**
 * TTS：EdgeTTS（默认）/ CosyVoice 本机；系统朗读参数回传渲染层。
 */
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { getSettings } from './store'
import {
  clipTtsInput,
  clampTtsPitch,
  clampTtsRate,
  normalizeTtsMode,
  type TtsSpeakResult
} from '../shared/tts'
import { normalizeQuickChatSettings } from '../shared/quickChat'
import { speakViaCosyVoice, speakViaCosyVoicePcmStream } from './cosyVoiceSidecar'
import { speakViaEdgeTts } from './edgeTts'
import { IPC } from '../shared/types'
import {
  claimTtsOwner,
  isTtsOwner,
  releaseTtsOwner,
  type TtsOwnerRole
} from './ttsOwner'

export type { TtsSpeakResult }

export function claimTtsPlayback(
  wcId: number,
  role: TtsOwnerRole,
  conversationId?: string
): { ok: true; gen: number } | { ok: false; reason: string } {
  return claimTtsOwner(wcId, role, conversationId)
}

export function releaseTtsPlayback(wcId: number): void {
  releaseTtsOwner(wcId)
}

async function speakEngineAudio(
  text: string,
  mode: 'edge' | 'local',
  qc: ReturnType<typeof normalizeQuickChatSettings>
): Promise<TtsSpeakResult> {
  if (mode === 'edge') {
    const edge = await speakViaEdgeTts({
      text,
      voice: qc.ttsEdgeVoice,
      rate: clampTtsRate(qc.ttsRate),
      pitch: clampTtsPitch(qc.ttsPitch)
    })
    if (!edge.ok) return { ok: false, error: edge.error }
    return {
      ok: true,
      mode: 'edge',
      text,
      mime: edge.mime,
      base64: edge.base64
    }
  }

  const local = await speakViaCosyVoice({ text })
  if (!local.ok) return { ok: false, error: local.error }
  return {
    ok: true,
    mode: 'local',
    text,
    mime: local.mime,
    base64: local.base64
  }
}

export async function speakTts(
  rawText: unknown,
  wc?: WebContents
): Promise<TtsSpeakResult> {
  if (wc && !isTtsOwner(wc.id)) {
    return { ok: false, error: 'TTS_NOT_OWNER' }
  }
  const text = clipTtsInput(typeof rawText === 'string' ? rawText : '')
  if (!text) return { ok: false, error: '没有可朗读的文本' }

  const qc = normalizeQuickChatSettings(getSettings().quickChat)
  const mode = normalizeTtsMode(qc.tts)
  if (mode === 'off') return { ok: true, mode: 'off' }

  if (mode === 'system') {
    return {
      ok: true,
      mode: 'system',
      text,
      voice: qc.ttsSystemVoice?.trim() || undefined,
      rate: clampTtsRate(qc.ttsRate),
      pitch: clampTtsPitch(qc.ttsPitch)
    }
  }

  if (wc && !isTtsOwner(wc.id)) {
    return { ok: false, error: 'TTS_NOT_OWNER' }
  }

  const res = await speakEngineAudio(text, mode, qc)
  if (wc && !isTtsOwner(wc.id)) {
    return { ok: false, error: 'TTS_NOT_OWNER' }
  }
  return res
}

/**
 * 流式朗读：CosyVoice 走 PCM；EdgeTTS 整段 MP3（云端本身很快）。
 * 返回 alreadyPlayed 时渲染层不必再 playTtsResult。
 */
export async function speakTtsLive(
  rawText: unknown,
  wc: WebContents
): Promise<TtsSpeakResult> {
  if (!isTtsOwner(wc.id)) {
    return { ok: false, error: 'TTS_NOT_OWNER' }
  }
  const text = clipTtsInput(typeof rawText === 'string' ? rawText : '')
  if (!text) return { ok: false, error: '没有可朗读的文本' }

  const qc = normalizeQuickChatSettings(getSettings().quickChat)
  const mode = normalizeTtsMode(qc.tts)
  if (mode === 'off') return { ok: true, mode: 'off' }

  if (mode === 'system') {
    return {
      ok: true,
      mode: 'system',
      text,
      voice: qc.ttsSystemVoice?.trim() || undefined,
      rate: clampTtsRate(qc.ttsRate),
      pitch: clampTtsPitch(qc.ttsPitch)
    }
  }

  // EdgeTTS：整段合成 MP3 交给渲染层 gapless 解码
  if (mode === 'edge') {
    const res = await speakEngineAudio(text, 'edge', qc)
    if (!isTtsOwner(wc.id)) {
      return { ok: false, error: 'TTS_NOT_OWNER' }
    }
    return res
  }

  const streamId = randomUUID()
  const send = (channel: string, payload: unknown): void => {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }

  send(IPC.ttsPcmStart, { id: streamId, sampleRate: 22050 })
  const streamed = await speakViaCosyVoicePcmStream({ text }, (pcm, sampleRate) => {
    if (!isTtsOwner(wc.id)) return
    send(IPC.ttsPcmFrame, {
      id: streamId,
      sampleRate,
      pcm: pcm.toString('base64')
    })
  })
  send(IPC.ttsPcmEnd, {
    id: streamId,
    ok: streamed.ok,
    error: streamed.ok ? undefined : streamed.error
  })

  if (!isTtsOwner(wc.id)) {
    return { ok: false, error: 'TTS_NOT_OWNER' }
  }

  if (!streamed.ok) {
    if (streamed.error === 'STREAM_FALLBACK') {
      return speakEngineAudio(text, 'local', qc)
    }
    return { ok: false, error: streamed.error }
  }

  return {
    ok: true,
    mode: 'local',
    text,
    mime: 'audio/pcm',
    base64: '',
    alreadyPlayed: true
  }
}
