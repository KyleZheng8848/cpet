/** Chromium Web Speech：开发态 Electron 原生听写不可用时的兜底（仅需麦克风权限）。 */

export type WebSpeechSession = {
  stop: () => void
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function webSpeechAvailable(): boolean {
  return !!getSpeechRecognitionCtor()
}

export function startWebSpeechDictation(handlers: {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onEnd: (reason: string) => void
}): WebSpeechSession {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) {
    handlers.onError('当前环境不支持浏览器语音识别')
    return { stop: () => undefined }
  }

  const rec = new Ctor()
  let stopped = false
  let finalText = ''

  rec.lang = 'zh-CN'
  rec.continuous = false
  rec.interimResults = true

  rec.onresult = (ev) => {
    let interim = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i]
      if (!piece) continue
      const t = piece[0]?.transcript || ''
      if (piece.isFinal) {
        finalText = `${finalText}${t}`.trim()
        handlers.onFinal(finalText)
      } else {
        interim += t
      }
    }
    if (interim) {
      handlers.onPartial((finalText ? `${finalText} ` : '') + interim)
    }
  }

  rec.onerror = (ev) => {
    const code = String(ev.error || '')
    if (code === 'aborted' || code === 'no-speech') {
      handlers.onEnd(code === 'no-speech' ? 'nospeech' : 'stop')
      return
    }
    if (code === 'not-allowed') {
      handlers.onError('麦克风权限被拒绝：系统设置 → 隐私与安全性 → 麦克风')
      return
    }
    // Chromium Web Speech 走谷歌云端；国内/无代理时常直接 network
    if (code === 'network' || code === 'service-not-allowed') {
      handlers.onError(
        '浏览器语音需连接识别服务，当前网络不可用。请用正式版 CPET 本机听写，或直接打字。'
      )
      return
    }
    handlers.onError(code ? `语音识别失败：${code}` : '语音识别失败')
  }

  rec.onend = () => {
    if (stopped) return
    handlers.onEnd(finalText ? 'stop' : 'nospeech')
  }

  try {
    rec.start()
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : '无法启动语音识别')
  }

  return {
    stop: () => {
      stopped = true
      try {
        rec.stop()
      } catch {
        try {
          rec.abort()
        } catch {
          // ignore
        }
      }
    }
  }
}
