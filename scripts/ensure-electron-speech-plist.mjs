/**
 * 开发态 Electron.app 补齐语音/麦克风 UsageDescription，并重新 adhoc 签名。
 * 缺 key 或改 plist 未重签时，一调 requestAuthorization 会被 TCC 直接 SIGABRT（闪退）。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

function electronPaths() {
  try {
    const electronPath = require('electron')
    if (typeof electronPath !== 'string') return null
    const idx = electronPath.indexOf('Electron.app/')
    if (idx < 0) return null
    const appPath = `${electronPath.slice(0, idx)}Electron.app`
    return { appPath, plist: join(appPath, 'Contents', 'Info.plist') }
  } catch {
    return null
  }
}

const KEYS = {
  NSSpeechRecognitionUsageDescription: 'CPET 需要语音识别权限以将语音转为文字',
  NSMicrophoneUsageDescription: 'CPET 需要麦克风权限以进行语音输入'
}

if (process.platform !== 'darwin') process.exit(0)

const paths = electronPaths()
if (!paths || !existsSync(paths.plist)) {
  console.warn('[ensure-electron-speech-plist] Electron Info.plist not found, skip')
  process.exit(0)
}

let wrote = false
for (const [key, value] of Object.entries(KEYS)) {
  const read = spawnSync('defaults', ['read', paths.plist, key], { encoding: 'utf8' })
  if (read.status === 0 && String(read.stdout || '').trim()) continue
  const w = spawnSync('defaults', ['write', paths.plist, key, '-string', value], {
    encoding: 'utf8'
  })
  if (w.status !== 0) {
    console.warn(`[ensure-electron-speech-plist] write ${key} failed`, w.stderr || w.stdout)
    continue
  }
  wrote = true
  console.log(`[ensure-electron-speech-plist] wrote ${key}`)
}

// 改过 plist 或每次启动都确保签名与 plist 一致（TCC 认密封后的描述）
const sign = spawnSync(
  'codesign',
  ['--force', '--sign', '-', '--deep', '--identifier', 'com.github.Electron', paths.appPath],
  { encoding: 'utf8' }
)
if (sign.status !== 0) {
  console.warn('[ensure-electron-speech-plist] codesign failed', sign.stderr || sign.stdout)
} else if (wrote) {
  console.log('[ensure-electron-speech-plist] re-signed Electron.app')
}
