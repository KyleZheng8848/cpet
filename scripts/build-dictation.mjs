#!/usr/bin/env node
/**
 * 编译 macOS 听写组件：
 * 1) resources/bin/libCpetSpeech.dylib — 正式版主进程内加载
 * 2) resources/bin/CPET Dictation.app — 开发态 Electron 用的听写助手（真 .app，TCC 才能活）
 * 3) resources/bin/cpet-dictation — 裸二进制（调试用）
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources/bin')
const legacyApp = join(root, 'resources/cpet-dictation.app')
const bridgeSrc = join(root, 'tools/cpet-speech/SpeechBridge.swift')
const bridgeOut = join(outDir, 'libCpetSpeech.dylib')
const helperSrc = join(root, 'tools/cpet-dictation/main.swift')
const helperPlist = join(root, 'tools/cpet-dictation/Info.plist')
const appPlistSrc = join(root, 'tools/cpet-dictation/App-Info.plist')
const helperOut = join(outDir, 'cpet-dictation')
const helperApp = join(outDir, 'CPET Dictation.app')

if (process.platform !== 'darwin') {
  console.log('[build-dictation] skip (not macOS)')
  process.exit(0)
}

rmSync(legacyApp, { recursive: true, force: true })
rmSync(helperApp, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`[build-dictation] ${cmd} failed`)
    if (r.stderr) console.error(r.stderr)
    if (r.stdout) console.error(r.stdout)
    process.exit(1)
  }
  return r
}

// Both Electron architectures share resources/. Ship universal native components
// so cross-packaging cannot silently include a helper for the build host only.
function compileUniversal(output, args) {
  const stage = mkdtempSync(join(tmpdir(), 'cpet-dictation-build-'))
  try {
    const slices = ['arm64', 'x86_64'].map((arch) => {
      const slice = join(stage, arch)
      run('swiftc', ['-O', '-target', `${arch}-apple-macos13.0`, ...args, '-o', slice])
      return slice
    })
    run('lipo', ['-create', ...slices, '-output', output])
    const arches = run('lipo', ['-archs', output]).stdout.trim().split(/\s+/)
    if (!['arm64', 'x86_64'].every((arch) => arches.includes(arch))) {
      throw new Error(`Incomplete universal binary: ${output}`)
    }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

if (!existsSync(bridgeSrc)) {
  console.error('[build-dictation] missing', bridgeSrc)
  process.exit(1)
}

const exportsList = join(root, 'tools/cpet-speech/exports.txt')
compileUniversal(bridgeOut, [
  '-parse-as-library',
  '-emit-library',
  '-module-name',
  'CpetSpeech',
  bridgeSrc,
  '-Xlinker',
  '-exported_symbols_list',
  '-Xlinker',
  exportsList
])
run('codesign', ['--force', '--sign', '-', '--identifier', 'Electron', bridgeOut])
console.log('[build-dictation] wrote', bridgeOut, '(dylib, Identifier=Electron)')

if (existsSync(helperSrc)) {
  // 仅依赖 .app/Contents/Info.plist（TCC 认这个）；裸跑调试才用 sectcreate
  compileUniversal(helperOut, [helperSrc])

  const macosDir = join(helperApp, 'Contents', 'MacOS')
  mkdirSync(macosDir, { recursive: true })
  const appExe = join(macosDir, 'cpet-dictation')
  copyFileSync(helperOut, appExe)
  const plistBody = existsSync(appPlistSrc)
    ? null
    : null
  if (existsSync(appPlistSrc)) {
    copyFileSync(appPlistSrc, join(helperApp, 'Contents', 'Info.plist'))
  } else if (existsSync(helperPlist)) {
    copyFileSync(helperPlist, join(helperApp, 'Contents', 'Info.plist'))
  } else {
    writeFileSync(
      join(helperApp, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.cpet.speech</string>
  <key>CFBundleName</key><string>CPET</string>
  <key>CFBundleExecutable</key><string>cpet-dictation</string>
  <key>LSUIElement</key><true/>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>CPET 需要语音识别权限以将语音转为文字</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>CPET 需要麦克风权限以进行语音输入</string>
</dict></plist>
`
    )
  }
  void plistBody
  run('chmod', ['+x', appExe])
  run('codesign', [
    '--force',
    '--sign',
    '-',
    '--identifier',
    'com.cpet.speech',
    '--deep',
    helperApp
  ])
  run('codesign', ['--force', '--sign', '-', '--identifier', 'com.cpet.speech', helperOut])
  console.log('[build-dictation] wrote', helperApp)
  console.log('[build-dictation] wrote', helperOut, '(bare helper)')
}
