#!/usr/bin/env node
/**
 * 发布后可用性验收（fail-closed）。
 *
 * 只认 OSS 上真实可下载的对象，不认本机 release/。
 * macOS：模拟浏览器 quarantine → 挂载 DMG → 跑「安装并打开」路径 → 确认进程能起来。
 *
 * 用法：
 *   node scripts/verify-published.mjs              # 验 package.json 当前版 / latest.json
 *   node scripts/verify-published.mjs --version 0.4.2
 *   node scripts/verify-published.mjs --skip-launch  # 只验 HTTP/体积/DMG 结构（CI 无 GUI 时）
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skipLaunch = process.argv.includes('--skip-launch')
const versionArg = (() => {
  const i = process.argv.indexOf('--version')
  return i >= 0 ? process.argv[i + 1] : null
})()
const manifestFile = (() => {
  const i = process.argv.indexOf('--manifest-file')
  return i >= 0 ? process.argv[i + 1] : null
})()
const skipStables = process.argv.includes('--skip-stables')
const skipSkins = process.argv.includes('--skip-skins')

function die(msg) {
  console.error(`[verify-published] FAIL: ${msg}`)
  process.exit(1)
}

function ok(msg) {
  console.log(`[verify-published] ✓ ${msg}`)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const baseUrl = (
  process.env.CPET_DOWNLOAD_BASE_URL ||
  pkg.cpet?.downloadBaseUrl ||
  ''
).replace(/\/?$/, '/')
if (!baseUrl) die('没有 downloadBaseUrl')

const expectVersion = versionArg || pkg.version
const work = join(tmpdir(), `cpet-verify-${process.pid}`)
mkdirSync(work, { recursive: true })

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CPET-verify-published/1' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CPET-verify-published/1' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  const size = statSync(dest).size
  if (len && size !== len) throw new Error(`${url} 体积不符：头 ${len} vs 本地 ${size}`)
  if (size < 1024 * 1024) throw new Error(`${url} 体积异常偏小：${size}`)
  return size
}

async function headOk(url, expectSize) {
  const res = await fetch(url, {
    method: 'HEAD',
    headers: { 'User-Agent': 'CPET-verify-published/1' }
  })
  if (!res.ok) throw new Error(`HEAD ${url} → HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (expectSize && len && len !== expectSize) {
    throw new Error(`${url} Content-Length ${len} ≠ manifest ${expectSize}`)
  }
  return len || expectSize || 0
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return r
}

function quarantine(path) {
  // 模拟 Chrome 下载标记；没有这步就测不出「已损坏」路径
  const stamp = Math.floor(Date.now() / 1000).toString(16)
  const r = run('xattr', ['-w', 'com.apple.quarantine', `0081;${stamp};Chrome;CPETVERIFY`, path])
  if (r.status !== 0) throw new Error(`打 quarantine 失败：${r.stderr || r.stdout}`)
}

async function verifyMacDmg(url, label) {
  const dmg = join(work, `${label}.dmg`)
  process.stdout.write(`  下载 ${label} … `)
  const size = await download(url, dmg)
  console.log(`${(size / 1048576).toFixed(1)} MB`)
  quarantine(dmg)

  const attach = run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-plist'])
  if (attach.status !== 0) throw new Error(`挂载失败：${attach.stderr || attach.stdout}`)
  const m = /<string>(\/Volumes\/[^<]+)<\/string>/.exec(attach.stdout || '')
  const vol = m?.[1]
  if (!vol || !existsSync(vol)) throw new Error('挂载后找不到卷标')

  const detach = () => {
    run('hdiutil', ['detach', vol, '-force'])
  }

  try {
    const app = join(vol, 'CPET.app')
    const installer = join(vol, '安装并打开.command')
    if (!existsSync(app)) throw new Error('DMG 内没有 CPET.app')
    if (!existsSync(installer)) {
      throw new Error('DMG 内没有「安装并打开.command」——用户会撞上「已损坏」误报，禁止发布')
    }
    ok(`${label}: DMG 含 CPET.app + 安装并打开.command`)

    // 走安装脚本同一路径：拷贝 → 清隔离 → ad-hoc → 检查二进制
    const dest = join(work, 'CPET.app')
    rmSync(dest, { recursive: true, force: true })
    const cp = run('cp', ['-R', app, dest])
    if (cp.status !== 0) throw new Error(`复制 app 失败：${cp.stderr}`)
    run('xattr', ['-cr', dest])
    run('codesign', ['--force', '--deep', '--sign', '-', dest])

    const bin = join(dest, 'Contents/MacOS/CPET')
    if (!existsSync(bin)) throw new Error('缺少 Contents/MacOS/CPET')

    // 与「安装并打开.command」一致：清隔离后用二进制启动，禁止用 open（会弹 Gatekeeper）
    if (!skipLaunch && process.platform === 'darwin') {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      // 确认隔离已清干净
      const xa = run('xattr', ['-lr', dest])
      if ((xa.stdout || '').includes('com.apple.quarantine')) {
        throw new Error('安装后仍残留 com.apple.quarantine')
      }
      const alive = spawnSync(
        process.execPath,
        [
          '-e',
          `
          const { spawn } = require('child_process');
          const { execSync } = require('child_process');
          const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
          const p = spawn(${JSON.stringify(bin)}, [], { env, stdio: 'ignore', detached: true });
          p.unref();
          let ok = false;
          for (let i = 0; i < 15; i++) {
            try { execSync('sleep 0.2'); } catch {}
            try { process.kill(p.pid, 0); ok = true; break; } catch {}
          }
          try { process.kill(p.pid); } catch {}
          process.exit(ok ? 0 : 2);
          `
        ],
        { encoding: 'utf8', timeout: 15000, env }
      )
      if (alive.status !== 0) {
        throw new Error(`二进制短跑失败：${alive.stderr || alive.stdout || alive.status}`)
      }
      ok(`${label}: 清隔离后二进制可启动（非 open）`)
    } else {
      ok(`${label}: 安装路径结构 OK（跳过启动）`)
    }
  } finally {
    detach()
  }
}

async function main() {
  console.log(`[verify-published] 验收 ${expectVersion} @ ${baseUrl}`)
  const manifest = manifestFile
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : await fetchJson(`${baseUrl}latest.json`)
  if (manifest.version !== expectVersion) {
    die(`清单版本是 ${manifest.version}，期望 ${expectVersion}`)
  }
  ok(`清单版本 ${manifest.version}${manifestFile ? '（本地预检）' : ''}`)
  const assets = Array.isArray(manifest.assets) ? manifest.assets : []
  if (!assets.length) die('清单没有 assets')

  for (const a of assets) {
    if (!a?.url || !a?.name) die('asset 缺 name/url')
    await headOk(a.url, a.size)
    ok(`可达 ${a.name}${a.size ? ` (${(a.size / 1048576).toFixed(1)} MB)` : ''}`)
  }

  if (!skipStables) {
    const stables = [
      'CPET-latest-arm64.dmg',
      'CPET-latest-x64.dmg',
      'CPET-latest-x64.exe',
      'CPET-latest-arm64.AppImage',
      'CPET-latest-x86_64.AppImage'
    ]
    for (const name of stables) {
      const url = `${baseUrl}${name}`
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'CPET-verify-published/1' }
      })
      if (res.status === 404) continue
      if (!res.ok) die(`固定名 ${name} → HTTP ${res.status}`)
      ok(`固定名 ${name}`)
    }
  }

  if (process.platform === 'darwin') {
    const arm = assets.find((a) => /arm64\.dmg$/i.test(a.name))
    const intel = assets.find((a) => /(x64|intel)\.dmg$/i.test(a.name))
    if (!arm && !intel) die('没有 macOS DMG 可验')
    if (arm) await verifyMacDmg(arm.url, 'arm64')
    if (intel) await verifyMacDmg(intel.url, 'x64')
  } else {
    console.log('  （非 macOS 主机，跳过 DMG 安装路径 / 启动验收）')
  }

  if (!skipSkins) {
    const catalogUrl = pkg.cpet?.skinCatalog || `${baseUrl}skins/catalog.json`
    try {
      const cat = await fetchJson(catalogUrl)
      const n = Array.isArray(cat.skins) ? cat.skins.length : 0
      if (!n) throw new Error('catalog.skins 为空')
      ok(`皮肤目录 ${n} 款`)
    } catch (err) {
      die(`皮肤目录不可用：${err.message}`)
    }
  }

  rmSync(work, { recursive: true, force: true })
  console.log(`[verify-published] OK：${expectVersion} 远端可用`)
}

main().catch((err) => {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // ignore
  }
  die(err instanceof Error ? err.message : String(err))
})
