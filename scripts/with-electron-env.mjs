/**
 * Cursor / 部分环境会注入 ELECTRON_RUN_AS_NODE=1，导致 require('electron')
 * 变成二进制路径字符串、app.whenReady 崩溃。启动 electron-vite 前清掉它。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

delete process.env.ELECTRON_RUN_AS_NODE

const here = dirname(fileURLToPath(import.meta.url))
// 补 Electron.app 语音/麦克风 UsageDescription，避免听写授权闪退
spawnSync(process.execPath, [join(here, 'ensure-electron-speech-plist.mjs')], {
  stdio: 'inherit'
})

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('electron-vite/package.json'))
const bin = join(pkgDir, 'bin/electron-vite.js')
const args = process.argv.slice(2)
const child = spawn(process.execPath, [bin, ...args], {
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
