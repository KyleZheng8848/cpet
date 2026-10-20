/**
 * macOS 原生听写：渲染进程采音 → 主进程加载 libCpetSpeech.dylib（Speech 框架）。
 * 识别在宿主进程内跑，TCC 归因到 CPET/Electron（子进程助手常被拒权 → 在听不出字）。
 */

import { app, shell, systemPreferences } from 'electron'
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

function dictationLog(line: string): void {
  try {
    const dir = join(homedir(), 'Library/Logs/CPET')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'dictation.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // ignore
  }
}

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

export type DictationLiveEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'end'; reason: string; text: string }
  | { type: 'error'; message: string }

type SpeechLib = {
  start: (cb: (json: string | null) => void) => number
  push: (pcm: Buffer, sampleRate: number) => number
  stop: () => number
}

let speechLib: SpeechLib | null = null
let liveRunning = false
let liveOnEvent: ((ev: DictationLiveEvent) => void) | null = null
/** koffi.register 返回的回调句柄（bigint） */
let registeredCb: bigint | null = null
/** 开发态 Electron：进程内 Speech TCC 对不上 CPET，改走独立助手 */
let liveHelper: ChildProcessWithoutNullStreams | null = null
let liveMode: 'lib' | 'helper' | null = null
let liveHelperStdoutBuf = ''

export function speechBridgePath(): string {
  const rel = join('bin', 'libCpetSpeech.dylib')
  return app.isPackaged
    ? join(process.resourcesPath, rel)
    : join(__dirname, '../../resources', rel)
}

/** 听写助手：优先真 .app（开发态 TCC 才稳定），否则裸二进制 */
export function dictationBinPath(): string {
  const root = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  const appExe = join(root, 'bin', 'CPET Dictation.app', 'Contents', 'MacOS', 'cpet-dictation')
  if (existsSync(appExe)) return appExe
  return join(root, 'bin', 'cpet-dictation')
}

export function dictationAvailable(): boolean {
  if (process.platform !== 'darwin') return false
  return existsSync(speechBridgePath()) || existsSync(dictationBinPath())
}

export async function ensureMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    if (status === 'denied' || status === 'restricted') return false
    return await systemPreferences.askForMediaAccess('microphone')
  } catch {
    return false
  }
}

/** 打开 macOS「语音识别」隐私页，方便用户一键授权。 */
export function openSpeechRecognitionPrivacySettings(): void {
  if (process.platform !== 'darwin') return
  const urls = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition'
  ]
  for (const url of urls) {
    try {
      void shell.openExternal(url)
      return
    } catch {
      /* try next */
    }
  }
}

function humanizeDictationError(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('duplicate cpet tcc') || s.includes('toggle off all cpet')) {
    openSpeechRecognitionPrivacySettings()
    return '语音识别未生效：系统里可能有多个 CPET。请在「语音识别」里把所有 CPET / CPET Dictation 先关掉，再只打开当前正在用的那一项，然后重试麦克风'
  }
  if (s.includes('authorization timeout') || s.includes('click allow')) {
    return '等待语音识别授权超时：若弹出权限框请点「允许」；没有弹窗再到系统设置 → 语音识别里打开 CPET'
  }
  if (
    s.includes('not determined') ||
    s.includes('authorization required') ||
    s.includes('allow speech recognition') ||
    s.includes('unavailable in this host')
  ) {
    return '语音识别权限未就绪。请重试麦克风；若仍失败，到系统设置 → 语音识别，关掉多余的 CPET 后只保留一项再开'
  }
  if (s.includes('authorization denied') || s.includes('notauthorized')) {
    openSpeechRecognitionPrivacySettings()
    return '语音识别权限被拒绝：系统设置 → 隐私与安全性 → 语音识别，允许 CPET'
  }
  if (s.includes('unavailable') || s.includes('not available')) {
    return '系统语音识别不可用，请在「键盘 → 听写」中开启听写，并检查网络'
  }
  if (s.includes('timeout')) {
    return '识别超时，请再说短一点或重试'
  }
  if (s.includes('empty transcript') || s.includes('nospeech')) {
    return '没有识别到内容，请重试'
  }
  if (s.includes('microphone')) {
    return '无法打开麦克风，请检查系统权限'
  }
  if (s.includes('load') || s.includes('dylib') || s.includes('koffi')) {
    return '听写组件加载失败，请重装 CPET'
  }
  return raw.slice(0, 200) || '听写失败'
}

function isAuthFailure(message: string): boolean {
  const s = message.toLowerCase()
  return (
    s.includes('authorization') ||
    s.includes('not determined') ||
    s.includes('语音识别') ||
    s.includes('duplicate cpet')
  )
}

function loadSpeechLib(): SpeechLib {
  if (speechLib) return speechLib
  const path = speechBridgePath()
  if (!existsSync(path)) {
    throw new Error(`missing speech bridge: ${path}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const lib = koffi.load(path)
  const EventCb = koffi.proto('void (const char *json)')
  const EventCbPtr = koffi.pointer(EventCb)
  const startFn = lib.func('cpet_speech_live_start', 'int', [EventCbPtr])
  const pushFn = lib.func('cpet_speech_live_push', 'int', ['void *', 'int', 'double'])
  const stopFn = lib.func('cpet_speech_live_stop', 'int', [])

  speechLib = {
    start: (cb) => {
      if (registeredCb != null) {
        try {
          koffi.unregister(registeredCb)
        } catch {
          // ignore
        }
        registeredCb = null
      }
      registeredCb = koffi.register((json: string | null) => {
        cb(json)
      }, EventCbPtr)
      return startFn(registeredCb) as number
    },
    push: (pcm, sampleRate) => pushFn(pcm, pcm.byteLength, sampleRate) as number,
    stop: () => stopFn() as number
  }
  return speechLib
}

function handleBridgeJson(raw: string | null): void {
  if (!raw || !liveOnEvent) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const t = String(parsed.t || '')
  if (t === 'authorizing' || t === 'status' || t === 'ready') return
  if (t === 'partial' || t === 'final') {
    liveOnEvent({ type: t, text: String(parsed.text || '') })
    return
  }
  if (t === 'end') {
    liveRunning = false
    liveOnEvent({
      type: 'end',
      reason: String(parsed.reason || 'end'),
      text: String(parsed.text || '')
    })
    return
  }
  if (t === 'error') {
    liveOnEvent({
      type: 'error',
      message: humanizeDictationError(String(parsed.message || ''))
    })
  }
}

export function isLiveDictationRunning(): boolean {
  return liveRunning
}

function stopLiveHelper(): void {
  const child = liveHelper
  liveHelper = null
  liveHelperStdoutBuf = ''
  if (!child) return
  try {
    child.stdin?.write('STOP\n')
  } catch {
    // ignore
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // ignore
  }
}

export function stopLiveDictation(): void {
  if (liveMode === 'helper' || liveHelper) {
    stopLiveHelper()
    liveMode = null
    liveRunning = false
    return
  }
  if (!liveRunning && !speechLib) return
  try {
    loadSpeechLib().stop()
  } catch {
    // ignore
  }
  liveMode = null
  liveRunning = false
}

/** 推送一帧 PCM（int16 mono base64）。 */
export function pushLiveDictationPcm(base64: string, sampleRate: number): void {
  if (!liveRunning) return
  if (!base64 || !(sampleRate > 0)) return
  if (liveMode === 'helper') {
    const child = liveHelper
    if (!child || child.killed) return
    try {
      child.stdin?.write(`AUDIO ${sampleRate} ${base64}\n`)
    } catch {
      // ignore
    }
    return
  }
  try {
    const pcm = Buffer.from(base64, 'base64')
    if (!pcm.byteLength) return
    loadSpeechLib().push(pcm, sampleRate)
  } catch {
    // ignore
  }
}

function ingestHelperLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  dictationLog(`helper ${trimmed}`)
  try {
    handleBridgeJson(trimmed)
  } catch {
    // ignore
  }
}

/**
 * 开发态 Electron：进程内 Speech 权限与系统里「CPET」开关不是同一身份。
 * 走独立助手（Info.plist = com.cpet.app），可复用已打开的 CPET 语音识别权限，且不会拖垮 Electron。
 */
async function startLiveViaHelper(
  onEvent: (ev: DictationLiveEvent) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bin = dictationBinPath()
  if (!existsSync(bin)) {
    return { ok: false, error: '听写组件未编译。开发时请运行 npm run build:dictation' }
  }

  stopLiveDictation()
  liveOnEvent = onEvent
  liveMode = 'helper'
  liveHelperStdoutBuf = ''

  dictationLog(`live_start helper=${bin}`)
  const child = spawn(bin, ['--live'], {
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams
  liveHelper = child

  const result = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    let settled = false
    const finish = (value: { ok: true } | { ok: false; error: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      finish({
        ok: false,
        error:
          '听写等待授权超时。若弹出权限框请点允许；或到设置 → 隐私与安全性 → 语音识别，打开 CPET'
      })
      stopLiveHelper()
    }, 90000)

    child.stdout.on('data', (chunk: Buffer) => {
      liveHelperStdoutBuf += chunk.toString('utf8')
      const parts = liveHelperStdoutBuf.split('\n')
      liveHelperStdoutBuf = parts.pop() || ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed) continue
        dictationLog(`helper ${trimmed}`)
        let ev: { t?: string; message?: string }
        try {
          ev = JSON.parse(trimmed) as { t?: string; message?: string }
        } catch {
          continue
        }
        if (ev.t === 'ready') {
          finish({ ok: true })
          // 后续 partial/final/end 继续喂给 onEvent
          ingestHelperLine(trimmed)
          continue
        }
        if (ev.t === 'error') {
          finish({
            ok: false,
            error: humanizeDictationError(String(ev.message || 'error'))
          })
          stopLiveHelper()
          return
        }
        if (settled) ingestHelperLine(trimmed)
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      dictationLog(`helper stderr ${chunk.toString('utf8').trim()}`)
    })

    child.on('error', (err) => {
      finish({ ok: false, error: humanizeDictationError(err.message) })
      stopLiveHelper()
    })

    child.on('exit', (code) => {
      if (!settled) {
        finish({
          ok: false,
          error:
            code === 0
              ? '听写助手已退出'
              : '听写助手启动失败。请到系统设置 → 语音识别，确认 CPET 已打开'
        })
      } else if (liveRunning) {
        liveRunning = false
        liveOnEvent?.({ type: 'end', reason: 'stop', text: '' })
      }
      if (liveHelper === child) {
        liveHelper = null
        liveMode = null
      }
    })
  })

  if (!result.ok) {
    liveRunning = false
    liveMode = null
    dictationLog(`live_start helper failed ${result.error}`)
    return result
  }

  liveRunning = true
  dictationLog('live_start helper ok')
  return { ok: true }
}

async function startLiveViaLib(
  onEvent: (ev: DictationLiveEvent) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!existsSync(speechBridgePath())) {
    return { ok: false, error: '听写组件未编译。开发时请运行 npm run build:dictation' }
  }

  stopLiveDictation()
  liveOnEvent = onEvent
  liveMode = 'lib'

  try {
    let lib: SpeechLib
    try {
      lib = loadSpeechLib()
    } catch (err) {
      dictationLog(`loadSpeechLib failed ${err instanceof Error ? err.message : String(err)}`)
      return { ok: false, error: humanizeDictationError(String(err)) }
    }
    let sawReady = false
    let sawError: string | null = null

    dictationLog(`live_start bridge=${speechBridgePath()}`)
    let code = -1
    // 握手阶段的 error 只走 Promise 返回值，避免 UI 先亮黄条、随后 helper 回退已来不及
    let handshakeDone = false
    try {
      code = lib.start((json) => {
        if (!json) return
        dictationLog(`bridge ${json}`)
        try {
          const ev = JSON.parse(json) as { t?: string; message?: string }
          if (ev.t === 'ready' || ev.t === 'status') sawReady = true
          if (ev.t === 'error') {
            sawError = humanizeDictationError(String(ev.message || 'error'))
            if (!handshakeDone) return
          }
        } catch {
          // ignore
        }
        if (!handshakeDone) {
          // ready 也会在下面 liveRunning=true 后由后续事件继续；握手期不转发
          return
        }
        try {
          handleBridgeJson(json)
        } catch {
          // 回调里绝不能抛到原生栈
        }
      })
    } catch (err) {
      liveRunning = false
      liveMode = null
      dictationLog(`live_start threw ${err instanceof Error ? err.message : String(err)}`)
      return {
        ok: false,
        error: humanizeDictationError(err instanceof Error ? err.message : String(err))
      }
    }

    if (code !== 0) {
      liveRunning = false
      liveMode = null
      dictationLog(`live_start failed code=${code} err=${sawError || ''}`)
      return {
        ok: false,
        error: sawError || '听写启动失败（语音识别权限或组件异常）'
      }
    }
    if (sawError) {
      liveRunning = false
      liveMode = null
      dictationLog(`live_start error ${sawError}`)
      return { ok: false, error: sawError }
    }

    liveRunning = true
    handshakeDone = true
    if (!sawReady) {
      await new Promise((r) => setTimeout(r, 300))
    }
    dictationLog(`live_start ok ready=${sawReady}`)
    return { ok: true }
  } catch (err) {
    liveRunning = false
    liveMode = null
    const msg = humanizeDictationError(err instanceof Error ? err.message : String(err))
    dictationLog(`live_start exception ${msg}`)
    return { ok: false, error: msg }
  }
}

/** 启动流式听写；采音由渲染进程负责。 */
export async function startLiveDictation(
  onEvent: (ev: DictationLiveEvent) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.platform !== 'darwin') {
    return { ok: false, error: '语音输入目前仅支持 macOS' }
  }
  if (!(await ensureMicrophoneAccess())) {
    return {
      ok: false,
      error: '麦克风权限被拒绝：系统设置 → 隐私与安全性 → 麦克风，允许 CPET'
    }
  }

  // 开发态 Electron 与系统里「CPET」语音权限不是同一身份；走独立助手（com.cpet.speech）。
  if (!app.isPackaged) {
    if (existsSync(dictationBinPath())) {
      return startLiveViaHelper(onEvent)
    }
    dictationLog('live_start skipped: unpackaged electron, no dictation helper')
    return {
      ok: false,
      error:
        '开发态语音请先 npm run build:dictation，或改用「应用程序」里的 CPET。这里也可直接打字发送。'
    }
  }

  // 正式包：进程内 Speech（TCC 归因 CPET.app，可弹系统授权框）。
  // 嵌套 CPET Dictation.app 在 notDetermined 时 requestAuthorization 会被 TCC SIGABRT，
  // 仅当助手已授权时才值得回退。
  const viaLib = await startLiveViaLib(onEvent)
  if (viaLib.ok) return viaLib
  if (existsSync(dictationBinPath()) && isAuthFailure(viaLib.error)) {
    dictationLog(`live_start lib auth failed → helper: ${viaLib.error}`)
    const viaHelper = await startLiveViaHelper(onEvent)
    if (viaHelper.ok) return viaHelper
  }
  return viaLib
}

/** 识别一段 base64 音频（wav）——走旧助手文件模式。 */
export async function transcribeAudioBase64(
  base64: string,
  ext = 'wav'
): Promise<TranscribeResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, error: '语音输入目前仅支持 macOS' }
  }
  const bin = dictationBinPath()
  if (!existsSync(bin)) {
    return { ok: false, error: '听写组件未编译。开发时请运行 npm run build:dictation' }
  }
  if (!(await ensureMicrophoneAccess())) {
    return {
      ok: false,
      error: '麦克风权限被拒绝：系统设置 → 隐私与安全性 → 麦克风，允许 CPET'
    }
  }

  const dir = join(tmpdir(), 'cpet-dictation')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // ignore
  }
  const file = join(dir, `rec-${Date.now()}.${ext.replace(/^\./, '')}`)
  try {
    writeFileSync(file, Buffer.from(base64, 'base64'))
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        reject(new Error('speech recognition timeout'))
      }, 45_000)
      child.stdout.on('data', (d) => {
        stdout += String(d)
      })
      child.stderr.on('data', (d) => {
        stderr += String(d)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timer)
        const out = stdout.trim()
        if (code === 0 && out) {
          resolve(out)
          return
        }
        reject(new Error(humanizeDictationError((stderr || out || `exit ${code}`).trim())))
      })
    })
    return { ok: true, text }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    try {
      unlinkSync(file)
    } catch {
      // ignore
    }
  }
}
