#!/usr/bin/env node
/**
 * 发版表面一致性：源码版本 ↔ OSS latest.json ↔ 下载页 ↔ 皮肤市场。
 * 任一不对齐就失败——避免「本机升了、远端还停在旧版」的假更新。
 *
 *   npm run verify:surface
 *   npm run verify:surface -- --skip-skins   # 只验安装包通道
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skipSkins = process.argv.includes('--skip-skins')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const expectVersion = String(pkg.version || '')
const baseUrl = String(pkg.cpet?.downloadBaseUrl || '').replace(/\/?$/, '/')
const catalogUrl = String(pkg.cpet?.skinCatalog || `${baseUrl}skins/catalog.json`)
const pageUrl = String(pkg.cpet?.downloadPage || `${baseUrl}index.html`)
const manifestUrl = String(pkg.cpet?.updateManifest || `${baseUrl}latest.json`)

let failed = false
function ok(msg) {
  console.log(`[verify:surface] ✓ ${msg}`)
}
function fail(msg) {
  failed = true
  console.error(`[verify:surface] FAIL: ${msg}`)
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CPET-verify-surface/1', Accept: '*/*' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.text()
}

function localDeliverableSkinIds() {
  const skinsRoot = join(root, 'assets', 'skins')
  if (!existsSync(skinsRoot)) return []
  const skip = new Set([
    '_work',
    '_preview',
    '_frames',
    '_idle_cands',
    '.cache',
    'cpet-skins'
  ])
  const ids = []
  for (const name of readdirSync(skinsRoot)) {
    if (name.startsWith('.') || skip.has(name)) continue
    const dir = join(skinsRoot, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const hasIdle = ['idle.gif', 'idle.png', 'idle.webp', 'idle.apng'].some((f) =>
      existsSync(join(dir, f))
    )
    if (hasIdle) ids.push(name)
  }
  return ids.sort()
}

console.log(`[verify:surface] 期望版本 ${expectVersion}`)
console.log(`[verify:surface] manifest ${manifestUrl}`)

if (!expectVersion) fail('package.json 没有 version')
if (!baseUrl) fail('package.json cpet.downloadBaseUrl 缺失')

// 1) OSS latest.json
let remote
try {
  remote = JSON.parse(await fetchText(manifestUrl))
  if (remote.version !== expectVersion) {
    fail(`OSS latest.json 是 ${remote.version}，源码是 ${expectVersion}`)
  } else {
    ok(`OSS latest.json = ${remote.version}`)
  }
  const assets = Array.isArray(remote.assets) ? remote.assets : []
  if (assets.length < 5) fail(`安装包资产过少（${assets.length}），四端可能没齐`)
  else ok(`安装包资产 ${assets.length} 个`)
  const names = assets.map((a) => a.name).join(' ')
  for (const need of ['arm64.dmg', 'x64.dmg', 'x64.exe', 'AppImage']) {
    if (!names.includes(need)) fail(`缺少 ${need} 类产物`)
  }
} catch (err) {
  fail(`读 latest.json 失败：${err instanceof Error ? err.message : String(err)}`)
}

// 2) 下载页含当前版本
try {
  const html = await fetchText(pageUrl)
  if (!html.includes(expectVersion)) fail(`下载页未出现版本 ${expectVersion}`)
  else ok(`下载页含 ${expectVersion}`)
  if (!/<video/i.test(html) || !/demo(?:-features|-walkthrough)?\.mp4/i.test(html)) {
    fail('下载页缺少演示视频')
  } else if (!/demo-walkthrough\.mp4/i.test(html)) {
    fail('下载页缺少产品走查演示（demo-walkthrough.mp4）')
  } else if (!/demo-features\.mp4/i.test(html)) {
    fail('下载页缺少新功能演示（demo-features.mp4）')
  } else {
    ok('下载页含演示视频（含走查片与新功能片）')
  }
} catch (err) {
  fail(`读下载页失败：${err instanceof Error ? err.message : String(err)}`)
}

// 3) 皮肤市场
if (!skipSkins) {
  const localIds = localDeliverableSkinIds()
  if (localIds.length < 2) fail(`本地交付皮肤过少（${localIds.length}）`)
  else ok(`本地交付皮肤 ${localIds.length} 款`)

  try {
    const catalog = JSON.parse(await fetchText(catalogUrl))
    const remoteIds = (catalog.skins || []).map((s) => s.id).sort()
    if (remoteIds.length !== localIds.length) {
      fail(`皮肤市场 ${remoteIds.length} 款 ≠ 本地 ${localIds.length} 款`)
    } else {
      ok(`皮肤市场 ${remoteIds.length} 款与本地一致`)
    }
    const missing = localIds.filter((id) => !remoteIds.includes(id))
    const extra = remoteIds.filter((id) => !localIds.includes(id))
    if (missing.length) fail(`远端缺皮肤：${missing.join('、')}`)
    if (extra.length) fail(`远端多出（本地无）：${extra.join('、')}`)
    if (!missing.length && !extra.length) ok('皮肤 id 集合完全对齐')
  } catch (err) {
    fail(`读皮肤 catalog 失败：${err instanceof Error ? err.message : String(err)}`)
  }

  // 仓库里交付皮肤不得仍是未跟踪（否则别人 clone 后 skins:publish 会冲掉市场）
  const { execSync } = await import('node:child_process')
  try {
    const untracked = execSync('git status --porcelain --untracked-files=all -- assets/skins', {
      cwd: root,
      encoding: 'utf8'
    })
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('??') && /idle\.(gif|png|webp|apng)$/i.test(l))
    if (untracked.length) {
      fail(
        `有未入库的交付皮肤（idle 未跟踪 ${untracked.length} 个）。先 git add 再发版，否则源码与市场会分叉。`
      )
    } else {
      ok('交付皮肤均已入库（无未跟踪 idle）')
    }
  } catch (err) {
    fail(`检查 git 皮肤跟踪失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

if (failed) {
  console.error('\n[verify:surface] 表面不一致。按顺序：升版合码 → 四端打包 → release:publish → skins:publish → 再跑本命令。')
  process.exit(1)
}
console.log('\n[verify:surface] OK：源码版本、安装包通道、下载页、皮肤市场已对齐')
