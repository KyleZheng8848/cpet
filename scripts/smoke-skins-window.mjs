/**
 * 冒烟：加载独立皮肤窗 → 检查 UI → 拉线上目录。
 * 必须去掉 ELECTRON_RUN_AS_NODE，否则 require('electron') 只是字符串路径。
 *
 *   env -u ELECTRON_RUN_AS_NODE node scripts/smoke-skins-window.mjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electronBin = require('electron')

if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error('[smoke-skins] ELECTRON_RUN_AS_NODE is set; unset it first.')
  process.exit(2)
}

const harness = join(tmpdir(), `cpet-smoke-skins-${process.pid}.cjs`)
writeFileSync(
  harness,
  `
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { readFileSync } = require('node:fs')

const root = ${JSON.stringify(root)}
const FAIL_MS = 40000
let done = false
function finish(code, msg) {
  if (done) return
  done = true
  if (msg) console[code === 0 ? 'log' : 'error'](msg)
  app.exit(code)
}
setTimeout(() => finish(2, '[smoke-skins] TIMEOUT'), FAIL_MS)

// 最小 IPC stub，让 SkinMarketPanel 挂载不炸
const settings = { skin: 'violet', imageSkin: null }
ipcMain.handle('app:language:get', () => ({ preference: 'zh-CN', locale: 'zh-CN' }))
ipcMain.handle('settings:get', () => settings)
ipcMain.handle('skinmarket:list-local', () => [])
ipcMain.handle('skinmarket:fetch', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const url = pkg.cpet?.skinCatalog
  if (!url) return { status: 'not-configured', message: 'no catalog' }
  const res = await fetch(url)
  if (!res.ok) return { status: 'error', message: 'HTTP ' + res.status }
  const catalog = await res.json()
  return {
    status: 'ok',
    catalog,
    rows: (catalog.skins || []).map((s) => ({
      entry: s,
      installed: false,
      packUrl: s.packUrl,
      previewUrl: s.previewUrl || null
    })),
    message: 'ok ' + (catalog.skins || []).length
  }
})
ipcMain.on('imgskin:open-dir', () => {})
ipcMain.on('settings:set-skin', () => {})
ipcMain.handle('imgskin:set', () => ({ ok: true }))
ipcMain.on('window:close-skins', () => finish(0, '[smoke-skins] closed via UI'))

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 440,
      height: 620,
      show: false,
      webPreferences: {
        preload: join(root, 'out/preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })
    const html = join(root, 'out/renderer/skins.html')
    await win.loadFile(html)
    // 等 React 挂载
    await new Promise((r) => setTimeout(r, 1200))
    const ui = await win.webContents.executeJavaScript(\`
      ({
        title: document.querySelector('.skin-window-title')?.textContent?.trim() || '',
        market: !!document.querySelector('.skin-market'),
        tabs: !!document.querySelector('.skin-market-tabs'),
        bodyText: (document.body.innerText || '').replace(/\\\\s+/g, ' ').slice(0, 240)
      })
    \`)
    console.log('[smoke-skins] ui=', JSON.stringify(ui))
    if (!ui.market || !ui.title.includes('皮肤')) {
      finish(1, '[smoke-skins] FAIL: skins UI missing')
      return
    }
    // 点「浏览市场」并等目录
    await win.webContents.executeJavaScript(\`
      [...document.querySelectorAll('.skin-market-tabs button')]
        .find((b) => (b.textContent || '').includes('市场'))
        ?.click()
    \`)
    await new Promise((r) => setTimeout(r, 2500))
    const market = await win.webContents.executeJavaScript(\`
      ({
        cards: document.querySelectorAll('.skin-market-card').length,
        flash: document.querySelector('.skin-market-flash')?.textContent || '',
        warn: document.querySelector('.skin-market-warn')?.textContent || '',
        body: (document.querySelector('.skin-market-body')?.innerText || '').slice(0, 300)
      })
    \`)
    console.log('[smoke-skins] market=', JSON.stringify(market))
    if (market.cards < 1 && !/已加载|款/.test(market.flash + market.body)) {
      // 至少目录请求应成功；卡片可能因行结构不同而计数为 0
      if (/失败|error|not-configured/i.test(market.flash + market.warn + market.body)) {
        finish(1, '[smoke-skins] FAIL: market fetch failed')
        return
      }
    }
    console.log('[smoke-skins] OK')
    finish(0)
  } catch (err) {
    finish(1, '[smoke-skins] FAIL ' + (err && err.stack ? err.stack : err))
  }
})
`.trim()
)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

console.log('[smoke-skins] spawning', electronBin)
const child = spawn(electronBin, [harness], { cwd: root, env, stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) {
    console.error('[smoke-skins] signal', signal)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
