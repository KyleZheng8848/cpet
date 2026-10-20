/**
 * CosyVoice 自定义音色：落盘到 userData/cosyvoice/voices。
 */
import { app, dialog, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  DEFAULT_COSYVOICE_PROMPT_TEXT,
  normalizeTtsCustomVoice,
  type TtsCustomVoice
} from '../shared/tts'
import { getChatWindow } from './windows'

function voicesRoot(): string {
  const d = join(app.getPath('userData'), 'cosyvoice', 'voices')
  mkdirSync(d, { recursive: true })
  return d
}

function indexPath(): string {
  return join(app.getPath('userData'), 'cosyvoice', 'voices.json')
}

function uid(): string {
  return 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function listTtsVoices(): TtsCustomVoice[] {
  try {
    const raw = JSON.parse(readFileSync(indexPath(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .map((x) => normalizeTtsCustomVoice(x))
      .filter((x): x is TtsCustomVoice => !!x && existsSync(x.promptWav))
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function saveIndex(list: TtsCustomVoice[]): void {
  const dir = join(app.getPath('userData'), 'cosyvoice')
  mkdirSync(dir, { recursive: true })
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf8')
}

export function getTtsVoice(id: string | undefined): TtsCustomVoice | null {
  if (!id) return null
  return listTtsVoices().find((v) => v.id === id) || null
}

/** 从 CosyVoice 仓库默认参考音种出一条可选音色（已有则跳过）。 */
export function ensureDefaultVoiceFromRepo(
  cosyRoot: string
): TtsCustomVoice | null {
  const candidates = [
    join(cosyRoot, 'asset', 'zero_shot_prompt.wav'),
    join(cosyRoot, 'assets', 'zero_shot_prompt.wav')
  ]
  const src = candidates.find((p) => existsSync(p))
  if (!src) return null
  const existing = listTtsVoices()
  if (existing.some((v) => v.name === '默认音色' || v.promptWav === src)) {
    return existing.find((v) => v.name === '默认音色') || existing[0] || null
  }
  const res = addTtsVoice({
    name: '默认音色',
    promptWav: src,
    promptText: DEFAULT_COSYVOICE_PROMPT_TEXT
  })
  return res.ok ? res.voice : null
}

export async function pickTtsPromptWav(): Promise<string | null> {
  const win = getChatWindow()
  const opts: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [
      { name: '音频', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] },
      { name: '全部', extensions: ['*'] }
    ]
  }
  const result = win && !win.isDestroyed()
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}

export function addTtsVoice(input: {
  name?: string
  promptWav?: string
  promptText?: string
}): { ok: true; voice: TtsCustomVoice } | { ok: false; error: string } {
  const name = (input.name || '').trim().slice(0, 40)
  const src = (input.promptWav || '').trim()
  const promptText =
    (input.promptText || '').trim().slice(0, 200) || DEFAULT_COSYVOICE_PROMPT_TEXT
  if (!name) return { ok: false, error: '请填写音色名称' }
  if (!src || !existsSync(src)) return { ok: false, error: '参考音频不存在' }

  const id = uid()
  const ext = extname(src) || '.wav'
  const dest = join(voicesRoot(), `${id}${ext}`)
  try {
    copyFileSync(src, dest)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `复制参考音频失败：${msg}` }
  }

  const voice: TtsCustomVoice = {
    id,
    name,
    promptWav: dest,
    promptText,
    createdAt: Date.now()
  }
  const list = listTtsVoices().filter((v) => v.id !== id)
  list.unshift(voice)
  saveIndex(list)
  return { ok: true, voice }
}

export function removeTtsVoice(
  id: unknown
): { ok: true } | { ok: false; error: string } {
  const key = typeof id === 'string' ? id.trim() : ''
  if (!key) return { ok: false, error: '缺少音色 id' }
  const list = listTtsVoices()
  const hit = list.find((v) => v.id === key)
  if (!hit) return { ok: false, error: '音色不存在' }
  const next = list.filter((v) => v.id !== key)
  saveIndex(next)
  try {
    const underVoices = hit.promptWav.startsWith(voicesRoot())
    if (existsSync(hit.promptWav) && (underVoices || basename(hit.promptWav).startsWith(key))) {
      unlinkSync(hit.promptWav)
    }
  } catch {
    /* ignore */
  }
  return { ok: true }
}

export async function pickCosyvoiceRoot(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() || getChatWindow()
  const opts: Electron.OpenDialogOptions = {
    properties: ['openDirectory']
  }
  const result = win && !win.isDestroyed()
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}
