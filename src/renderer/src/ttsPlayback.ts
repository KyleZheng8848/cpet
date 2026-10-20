/** 渲染层播放 TTS：短句流式合成 + PCM 边收边播。 */

import {
  clipTtsInput,
  pullTtsStreamChunk,
  TTS_CHUNK_CHARS,
  TTS_CHUNK_EAGER_CHARS,
  TTS_CHUNK_FIRST_CHARS,
  TTS_CHUNK_FIRST_EAGER,
  TTS_CHUNK_FIRST_MIN_SENTENCE,
  TTS_CHUNK_FIRST_SOFT_MIN,
  TTS_CHUNK_MIN_SENTENCE,
  TTS_CHUNK_SOFT_MIN,
  TTS_MAX_CHARS,
  TTS_SYNTH_BATCH_CHARS,
  type TtsSpeakResult
} from '@shared/tts'

export type TtsSpeakFn = (chunk: string) => Promise<TtsSpeakResult>

let currentAudio: HTMLAudioElement | null = null
/** 用户点停止 / 新开一轮时递增，打断分块队列。 */
let playEpoch = 0
let sharedCtx: AudioContext | null = null
/** AudioContext 上已排程的结束时间（秒）——跨分句无缝衔接。 */
let pcmQueueEnd = 0
let scheduledSources: AudioBufferSourceNode[] = []
/** 活跃朗读控制器数（流式 / 点播）；供顶栏「停止朗读」显示。 */
let speakingControllers = 0
const speakingListeners = new Set<(speaking: boolean) => void>()

function emitSpeaking(): void {
  const on = speakingControllers > 0
  for (const cb of speakingListeners) {
    try {
      cb(on)
    } catch {
      /* ignore */
    }
  }
}

function retainSpeaking(): void {
  speakingControllers += 1
  if (speakingControllers === 1) emitSpeaking()
}

function releaseSpeaking(): void {
  if (speakingControllers <= 0) return
  speakingControllers -= 1
  if (speakingControllers === 0) emitSpeaking()
}

/** 是否正在合成或排队朗读（不含纯偏好开关）。 */
export function isTtsSpeaking(): boolean {
  return speakingControllers > 0
}

/** 订阅朗读中状态；立即回调一次当前值。 */
export function onTtsSpeakingChange(cb: (speaking: boolean) => void): () => void {
  speakingListeners.add(cb)
  try {
    cb(isTtsSpeaking())
  } catch {
    /* ignore */
  }
  return () => {
    speakingListeners.delete(cb)
  }
}

function haltCurrentOutput(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.removeAttribute('src')
      currentAudio.load()
    } catch {
      /* ignore */
    }
    currentAudio = null
  }
  for (const src of scheduledSources) {
    try {
      src.stop()
    } catch {
      /* ignore */
    }
  }
  scheduledSources = []
  pcmQueueEnd = 0
  // 停止时关掉 context；分句之间不要关，否则必磕巴
  if (sharedCtx) {
    try {
      void sharedCtx.close()
    } catch {
      /* ignore */
    }
    sharedCtx = null
  }
}

export function stopTtsPlayback(): void {
  playEpoch += 1
  haltCurrentOutput()
  if (speakingControllers !== 0) {
    speakingControllers = 0
    emitSpeaking()
  }
  if (typeof window.petApi?.ttsRelease === 'function') {
    void window.petApi.ttsRelease()
  }
}

function getAudioCtx(sampleRate: number): AudioContext {
  if (sharedCtx && sharedCtx.state !== 'closed') {
    return sharedCtx
  }
  sharedCtx = new AudioContext({ sampleRate })
  return sharedCtx
}

/**
 * 在用户点击手势里调用：解锁 AudioContext。
 * CosyVoice 合成要数秒，手势过期后 HTMLAudioElement.play() 常直接失败（表现为「音频播放失败」）。
 */
export async function unlockTtsAudio(): Promise<void> {
  try {
    const ctx = getAudioCtx(22050)
    if (ctx.state === 'suspended') await ctx.resume()
  } catch {
    /* ignore */
  }
}

/** 将 int16 PCM 帧排进共享时间轴（跨分句无缝，合成返回后播放仍继续）。 */
function pushPcmToQueue(b64: string, sampleRate: number, epoch: number): void {
  if (!b64 || playEpoch !== epoch) return
  const sr = sampleRate > 0 ? sampleRate : 22050
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  if (bytes.byteLength < 2) return

  const ctx = getAudioCtx(sr)
  if (ctx.state === 'suspended') void ctx.resume()

  const samples = Math.floor(bytes.byteLength / 2)
  const buf = ctx.createBuffer(1, samples, sr)
  const ch = buf.getChannelData(0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < samples; i++) {
    ch[i] = view.getInt16(i * 2, true) / 32768
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  const startAt = Math.max(pcmQueueEnd, ctx.currentTime + 0.02)
  src.start(startAt)
  pcmQueueEnd = startAt + buf.duration
  scheduledSources.push(src)
  src.onended = () => {
    scheduledSources = scheduledSources.filter((s) => s !== src)
  }
}

/**
 * 合成单元（抗卡顿）：
 * 本机 CosyVoice RTF 常 >4，边收边播会「念几个字就停」。
 * 因此先攒齐本段全部 PCM，合成结束后一次性挂上时间轴，再立刻返回开下一段合成
 * （播当前整段 ∥ 合成下一段）。
 */
export async function speakLiveChunk(text: string): Promise<TtsSpeakResult> {
  if (!text.trim()) return { ok: false, error: '没有可朗读的文本' }
  if (typeof window.petApi?.ttsSpeakLive !== 'function') {
    const res = await window.petApi.ttsSpeak(text)
    if (res.ok && (res.mode === 'local' || res.mode === 'edge') && res.base64) {
      await enqueueWavGapless(res.base64, res.mime || 'audio/mpeg', playEpoch)
      return { ...res, alreadyPlayed: true, base64: '' }
    }
    return res
  }

  let activeId: string | null = null
  const held: Array<{ sampleRate: number; pcm: string }> = []
  const epoch = playEpoch

  const offStart = window.petApi.onTtsPcmStart((ev) => {
    if (playEpoch !== epoch) return
    activeId = ev.id
  })
  const offFrame = window.petApi.onTtsPcmFrame((ev) => {
    if (playEpoch !== epoch) return
    if (activeId && ev.id !== activeId) return
    if (!activeId) activeId = ev.id
    held.push({ sampleRate: ev.sampleRate, pcm: ev.pcm })
  })

  try {
    const res = await window.petApi.ttsSpeakLive(text)
    if (playEpoch !== epoch) return res
    if (!res.ok) return res
    if (res.mode === 'off') return res
    if (res.mode === 'system') {
      await playTtsResult(res)
      return res
    }
    // CosyVoice：整段 PCM；EdgeTTS：整段 MP3
    if (held.length) {
      flushHeldPcm(held, epoch)
      return {
        ok: true,
        mode: 'local',
        text: res.text,
        mime: 'audio/pcm',
        base64: '',
        alreadyPlayed: true
      }
    }
    if (res.base64) {
      await enqueueWavGapless(res.base64, res.mime || 'audio/mpeg', epoch)
    }
    return {
      ok: true,
      mode: res.mode === 'edge' ? 'edge' : 'local',
      text: res.text,
      mime: res.mime || 'audio/mpeg',
      base64: '',
      alreadyPlayed: true
    }
  } finally {
    offStart()
    offFrame()
  }
}

/** 将一段合成的多帧 PCM 合并后一次排程，中间不留播放空隙。 */
function flushHeldPcm(
  held: Array<{ sampleRate: number; pcm: string }>,
  epoch: number
): void {
  if (!held.length || playEpoch !== epoch) return
  const sr = held[0]!.sampleRate || 22050
  const parts: Uint8Array[] = []
  let total = 0
  for (const h of held) {
    const bin = atob(h.pcm)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    parts.push(bytes)
    total += bytes.length
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    merged.set(p, off)
    off += p.length
  }
  // 复用 base64 推入队列（单帧）
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < merged.length; i += chunk) {
    s += String.fromCharCode(...merged.subarray(i, i + chunk))
  }
  pushPcmToQueue(btoa(s), sr, epoch)
}

/** 解码 wav 并挂到共享时间轴，不等待播放结束。 */
async function enqueueWavGapless(
  base64: string,
  _mime: string,
  epoch: number
): Promise<void> {
  if (playEpoch !== epoch || !base64) return
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const ctx = getAudioCtx(24000)
  if (ctx.state === 'suspended') await ctx.resume()
  if (playEpoch !== epoch) return
  const audioBuf = await ctx.decodeAudioData(ab.slice(0))
  if (playEpoch !== epoch) return
  if (ctx.state === 'suspended') await ctx.resume()
  const src = ctx.createBufferSource()
  src.buffer = audioBuf
  src.connect(ctx.destination)
  const startAt = Math.max(pcmQueueEnd, ctx.currentTime + 0.02)
  src.start(startAt)
  pcmQueueEnd = startAt + audioBuf.duration
  scheduledSources.push(src)
  src.onended = () => {
    scheduledSources = scheduledSources.filter((s) => s !== src)
  }
}

export async function playTtsResult(
  res: TtsSpeakResult,
  opts?: { gapless?: boolean }
): Promise<void> {
  if (!res.ok) throw new Error(res.error || '朗读失败')
  if (res.mode === 'off') return
  if ('alreadyPlayed' in res && res.alreadyPlayed) return

  const gapless = opts?.gapless === true
  if (!gapless) haltCurrentOutput()

  if (res.mode === 'system') {
    if (!gapless) haltCurrentOutput()
    if (typeof speechSynthesis === 'undefined') {
      throw new Error('当前环境不支持系统朗读')
    }
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(res.text)
      u.lang = 'zh-CN'
      u.rate = res.rate
      u.pitch = res.pitch
      if (res.voice) {
        const voices = speechSynthesis.getVoices()
        const hit =
          voices.find((v) => v.voiceURI === res.voice) ||
          voices.find((v) => v.name === res.voice)
        if (hit) u.voice = hit
      }
      u.onend = () => resolve()
      u.onerror = () => reject(new Error('系统朗读失败'))
      speechSynthesis.speak(u)
    })
    return
  }

  if (!('base64' in res) || !res.base64) {
    throw new Error('没有可播放的音频')
  }
  const bin = atob(res.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // 优先 AudioContext 无缝排程：分句之间不关 context、不从头 start
  try {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const ctx = getAudioCtx(22050)
    if (ctx.state === 'suspended') await ctx.resume()
    const audioBuf = await ctx.decodeAudioData(ab.slice(0))
    const startAt = gapless
      ? Math.max(ctx.currentTime + 0.02, pcmQueueEnd)
      : ctx.currentTime + 0.02
    await new Promise<void>((resolve, reject) => {
      const src = ctx.createBufferSource()
      src.buffer = audioBuf
      src.connect(ctx.destination)
      scheduledSources.push(src)
      src.onended = () => {
        scheduledSources = scheduledSources.filter((s) => s !== src)
        resolve()
      }
      try {
        src.start(startAt)
        pcmQueueEnd = startAt + audioBuf.duration
      } catch (err) {
        scheduledSources = scheduledSources.filter((s) => s !== src)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    return
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 再退回 <audio>；仍失败则带上原因
    const blob = new Blob([bytes], { type: res.mime || 'audio/wav' })
    const url = URL.createObjectURL(blob)
    try {
      const audio = new Audio(url)
      currentAudio = audio
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve()
        audio.onerror = () =>
          reject(new Error(`音频播放失败${msg ? `（${msg.slice(0, 80)}）` : ''}，请再点一次试听`))
        void audio.play().catch((playErr: unknown) => {
          const m = playErr instanceof Error ? playErr.message : String(playErr)
          if (/NotAllowedError|user interaction|gesture/i.test(m)) {
            reject(new Error('浏览器拦截了自动播放，请再点一次「试听」'))
          } else {
            reject(playErr instanceof Error ? playErr : new Error(m))
          }
        })
      })
    } finally {
      URL.revokeObjectURL(url)
      if (currentAudio) currentAudio = null
    }
  }
}

/**
 * 流式朗读流水线（类并行）：
 * text 队列 → 合成工人(串行，CosyVoice 锁) → PCM 时间轴(边合成边播)
 * 合成结束立刻开下一段，不等待播完 = 播 N ∥ 合成 N+1。
 */
export class StreamTtsController {
  private buffer = ''
  private pending: string[] = []
  private nextSynth = 0
  private synthInFlight = 0
  private spoken = 0
  private pulled = 0
  private claimed = false
  private streamEnded = false
  private lastSynthError: string | null = null
  private settle: { resolve: () => void; promise: Promise<void> } | null = null
  private readonly epoch: number
  private readonly speak: TtsSpeakFn
  private readonly maxInFlight: number
  private readonly maxTotal: number
  private readonly role: 'chat' | 'pet' | 'preview'
  private readonly conversationId?: string

  constructor(
    speak?: TtsSpeakFn,
    opts?: {
      maxInFlight?: number
      maxTotal?: number
      role?: 'chat' | 'pet' | 'preview'
      conversationId?: string
      /**
       * true：停掉上一段音频。
       * 默认 false——新建控制器不得 halt：否则 done 后迟到 delta / 兜底点播
       * 会把正在播的整段掐断，听起来像「播一点被强制停止」。
       * 发新消息、点停止请显式 stopTtsPlayback()。
       */
      haltExisting?: boolean
    }
  ) {
    playEpoch += 1
    this.epoch = playEpoch
    if (opts?.haltExisting === true) {
      haltCurrentOutput()
    }
    void unlockTtsAudio()
    this.role = opts?.role ?? 'chat'
    this.conversationId = opts?.conversationId
    this.speak = speak ?? speakLiveChunk
    this.maxInFlight = opts?.maxInFlight ?? 1
    this.maxTotal = opts?.maxTotal ?? TTS_MAX_CHARS
    retainSpeaking()
    void this.ensureClaim()
  }

  private droppedSpeaking = false
  private dropSpeaking(): void {
    if (this.droppedSpeaking) return
    this.droppedSpeaking = true
    releaseSpeaking()
  }

  /** 生成已结束但仍可能有迟到 delta / 合成未排空。 */
  get finishing(): boolean {
    return this.streamEnded
  }

  /** 允许 done 之后又来的正文 delta 继续推进（先取消 finishing）。 */
  reopenForLateDelta(): void {
    if (playEpoch !== this.epoch) return
    this.streamEnded = false
  }

  get synthError(): string | null {
    return this.lastSynthError
  }

  private async ensureClaim(): Promise<boolean> {
    if (this.claimed) return true
    if (typeof window.petApi?.ttsClaim !== 'function') {
      this.claimed = true
      return true
    }
    const res = await window.petApi.ttsClaim({
      role: this.role,
      conversationId: this.conversationId
    })
    if (playEpoch !== this.epoch) return false
    if (!res.ok) {
      // 认领失败：清空队列并释放等待方，避免试听卡在「合成中…」
      this.lastSynthError =
        res.reason === 'chat-owns'
          ? '对话窗正在朗读，请稍后再试'
          : res.reason === 'preview-owns'
            ? '另一处正在试听，请稍后再试'
            : '当前无法开始朗读'
      this.pending = []
      this.buffer = ''
      this.streamEnded = true
      this.dropSpeaking()
      this.releaseIfIdle()
      return false
    }
    this.claimed = true
    return true
  }

  get active(): boolean {
    return playEpoch === this.epoch
  }

  /** 已抽出并排队/合成的字数（用于收尾判断要不要点播兜底）。 */
  get spokenChars(): number {
    return this.spoken
  }

  /** 等合成队列排空（音频可能仍在播）。 */
  whenSynthIdle(): Promise<void> {
    if (this.isSynthIdle()) return Promise.resolve()
    if (!this.settle) {
      let resolve!: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      this.settle = { resolve, promise }
    }
    return this.settle.promise
  }

  private isSynthIdle(): boolean {
    return (
      this.streamEnded &&
      this.synthInFlight === 0 &&
      this.pending.length === 0 &&
      !this.buffer
    )
  }

  /** 流式追加模型输出。 */
  push(delta: string): void {
    if (!this.active || !delta) return
    if (this.spoken >= this.maxTotal) return
    this.buffer += delta
    this.drainBuffer(false)
    void this.pump()
  }

  /** 生成结束：冲刷残余。 */
  end(): void {
    if (playEpoch !== this.epoch) return
    this.streamEnded = true
    this.drainBuffer(true)
    void this.pump()
    this.releaseIfIdle()
  }

  private releaseIfIdle(): void {
    if (playEpoch !== this.epoch) return
    if (!this.isSynthIdle()) return
    if (this.claimed && typeof window.petApi?.ttsRelease === 'function') {
      void window.petApi.ttsRelease()
      this.claimed = false
    }
    // 合成排空后仍可能有 PCM 在播；等本轮时间轴空了再摘「朗读中」
    void waitForScheduledAudio(this.epoch).finally(() => {
      this.dropSpeaking()
    })
    if (this.settle) {
      this.settle.resolve()
      this.settle = null
    }
  }

  cancel(): void {
    if (playEpoch === this.epoch) playEpoch += 1
    this.buffer = ''
    this.pending = []
    haltCurrentOutput()
    this.dropSpeaking()
    if (this.claimed && typeof window.petApi?.ttsRelease === 'function') {
      void window.petApi.ttsRelease()
      this.claimed = false
    }
    if (this.settle) {
      this.settle.resolve()
      this.settle = null
    }
  }

  private drainBuffer(force: boolean): void {
    for (;;) {
      if (this.spoken >= this.maxTotal) {
        this.buffer = ''
        return
      }
      const first = this.pulled === 0
      const { chunk, rest } = pullTtsStreamChunk(this.buffer, {
        force,
        eager: !force,
        maxChunk: first ? TTS_CHUNK_FIRST_CHARS : TTS_CHUNK_CHARS,
        softMin: first ? TTS_CHUNK_FIRST_SOFT_MIN : TTS_CHUNK_SOFT_MIN,
        eagerChars: first ? TTS_CHUNK_FIRST_EAGER : TTS_CHUNK_EAGER_CHARS,
        minSentence: first ? TTS_CHUNK_FIRST_MIN_SENTENCE : TTS_CHUNK_MIN_SENTENCE
      })
      this.buffer = rest
      if (!chunk) break
      let text = chunk
      const left = this.maxTotal - this.spoken
      if (text.length > left) {
        text = `${text.slice(0, left)}…`
        this.buffer = ''
      }
      this.spoken += text.length
      this.pulled += 1
      this.pending.push(text)
      if (this.spoken >= this.maxTotal) {
        this.buffer = ''
        break
      }
    }
  }

  private pendingChars(): number {
    return this.pending.reduce((n, s) => n + s.length, 0)
  }

  /** 音频时间轴还剩多少秒（>1 时可继续攒批，避免碎请求）。 */
  private audioSecondsLeft(): number {
    if (!sharedCtx || sharedCtx.state === 'closed') return 0
    return Math.max(0, pcmQueueEnd - sharedCtx.currentTime)
  }

  /** 短句拼批再进 CosyVoice；本机 RTF 很高，绝不能一字一句请求。 */
  private takeSynthJob(): string {
    let job = this.pending.shift()!
    while (this.pending.length > 0) {
      const next = this.pending[0]!
      if (job.length >= TTS_SYNTH_BATCH_CHARS) break
      if (job.length + next.length > TTS_SYNTH_BATCH_CHARS + 32) break
      job += this.pending.shift()!
    }
    return job
  }

  private async pump(): Promise<void> {
    if (playEpoch !== this.epoch) return
    if (!(await this.ensureClaim())) return

    while (
      this.synthInFlight < this.maxInFlight &&
      this.pending.length > 0 &&
      playEpoch === this.epoch
    ) {
      const pendingLen = this.pendingChars()
      const audioLeft = this.audioSecondsLeft()
      // 首包：尽量攒到 ~半批再合成（整段播，短了必卡）
      const firstReady = Math.max(TTS_CHUNK_FIRST_MIN_SENTENCE, Math.floor(TTS_SYNTH_BATCH_CHARS * 0.45))
      if (this.nextSynth === 0 && !this.streamEnded && pendingLen < firstReady) {
        break
      }
      // 后续：播放缓冲还够且批还短 → 继续攒
      if (
        this.nextSynth > 0 &&
        !this.streamEnded &&
        pendingLen < Math.floor(TTS_SYNTH_BATCH_CHARS * 0.75) &&
        audioLeft > 3
      ) {
        break
      }
      const text = this.takeSynthJob()
      this.nextSynth += 1
      this.synthInFlight += 1
      void this.speak(text)
        .then((res) => {
          if (playEpoch !== this.epoch) return
          if (!res.ok) {
            this.lastSynthError = res.error || '合成失败'
            if (res.error === 'TTS_NOT_OWNER') this.cancel()
            else {
              console.warn('[tts] synth failed', res.error)
              // 点播/试听：失败后清空剩余，避免 whenSynthIdle 永远等
              if (this.role === 'preview') {
                this.pending = []
                this.buffer = ''
              }
            }
            return
          }
          if (res.mode === 'off') this.cancel()
        })
        .catch((err: unknown) => {
          if (playEpoch !== this.epoch) return
          const msg = err instanceof Error ? err.message : String(err)
          this.lastSynthError = msg || '合成失败'
          console.warn('[tts] synth failed', err)
          if (this.role === 'preview') {
            this.pending = []
            this.buffer = ''
          }
        })
        .finally(() => {
          this.synthInFlight -= 1
          void this.pump()
          this.releaseIfIdle()
        })
    }
    this.releaseIfIdle()
  }
}

/** 等已排程音频播完；挂起的 AudioContext 会冻住 currentTime，必须 resume，并设截止。 */
async function waitForScheduledAudio(epoch: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (playEpoch === epoch && sharedCtx && sharedCtx.state !== 'closed') {
    if (sharedCtx.state === 'suspended') {
      try {
        await sharedCtx.resume()
      } catch {
        break
      }
    }
    if (pcmQueueEnd <= sharedCtx.currentTime + 0.05) break
    if (Date.now() > deadline) break
    await new Promise<void>((r) => window.setTimeout(r, 40))
  }
}

/**
 * 点播：走同一套流水线（PCM 直播 + 合成/播放重叠）。
 */
export async function speakTextWithTts(
  text: string,
  speak?: TtsSpeakFn,
  opts?: {
    onProgress?: (current: number, total: number) => void
    /** 点播总字数上限（清洗后）；资讯正文等可调高。 */
    maxChars?: number
  }
): Promise<void> {
  const maxChars = opts?.maxChars ?? TTS_MAX_CHARS
  const cleaned = clipTtsInput(text, maxChars)
  if (!cleaned) throw new Error('没有可朗读的文本')

  const ctrl = new StreamTtsController(speak ?? speakLiveChunk, {
    maxInFlight: 1,
    maxTotal: maxChars,
    role: 'preview',
    haltExisting: true
  })
  if (!ctrl.active) throw new Error('当前另一处正在朗读，请稍后再试')
  const epoch = playEpoch

  opts?.onProgress?.(0, 1)
  ctrl.push(cleaned)
  ctrl.end()
  await Promise.race([
    ctrl.whenSynthIdle(),
    new Promise<void>((_, reject) =>
      window.setTimeout(() => reject(new Error('朗读超时，请检查网络后重试')), 55_000)
    )
  ])
  if (ctrl.synthError) throw new Error(ctrl.synthError)
  opts?.onProgress?.(1, 1)

  // 等时间轴播完，便于试听按钮状态回收（勿在 suspended 上死等）
  await waitForScheduledAudio(epoch)
}

export type SystemVoiceOption = { voiceURI: string; name: string; lang: string }

export function listSystemTtsVoices(): SystemVoiceOption[] {
  if (typeof speechSynthesis === 'undefined') return []
  return speechSynthesis.getVoices().map((v) => ({
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang
  }))
}

/** 等待 voiceschanged（部分浏览器首次为空）。 */
export function loadSystemTtsVoices(): Promise<SystemVoiceOption[]> {
  const cur = listSystemTtsVoices()
  if (cur.length || typeof speechSynthesis === 'undefined') return Promise.resolve(cur)
  return new Promise((resolve) => {
    const done = (): void => {
      speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(listSystemTtsVoices())
    }
    speechSynthesis.addEventListener('voiceschanged', done)
    window.setTimeout(done, 800)
  })
}
