#!/usr/bin/env node
/**
 * 从 package.json + release/ 里的真实产物生成 release/latest.json。
 *
 * 为什么必须是脚本：手写清单一定会漂移，而漂移的后果是静默且彻底的——
 * 版本号写小了用户永远收不到更新，写大了会提示一个下载不到的版本。
 * 让它从「已经打出来的包」倒推，就没有手抄环节。
 *
 * 下载地址前缀取 cpet.downloadBaseUrl（package.json），例如：
 *   "cpet": {
 *     "updateManifest": "https://your-host/cpet/latest.json",
 *     "downloadBaseUrl": "https://your-host/cpet/",
 *     "downloadPage": "https://your-host/cpet/download"
 *   }
 *
 * 退出码：0 成功；1 没找到当前版本的产物或缺少 downloadBaseUrl。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const cpet = pkg.cpet ?? {}

const releaseDir = join(root, 'release')
if (!existsSync(releaseDir)) {
  console.error('[gen-update-manifest] 没有 release/ 目录，先打包再生成清单。')
  process.exit(1)
}

const INSTALLER_RE = /\.(dmg|exe|AppImage)$/i
const ZIP_RE = /\.zip$/i

/** 只收当前版本的产物：release/ 里往往堆着历史版本，混进去就是发错包。 */
function collectAssets() {
  const out = []
  for (const name of readdirSync(releaseDir)) {
    if (!name.includes(version)) continue
    if (name.endsWith('.blockmap')) continue
    if (!INSTALLER_RE.test(name) && !ZIP_RE.test(name)) continue
    let st
    try {
      st = statSync(join(releaseDir, name))
    } catch {
      continue
    }
    if (!st.isFile() || st.size === 0) continue
    out.push({ name, size: st.size })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const found = collectAssets()
if (!found.length) {
  console.error(
    `[gen-update-manifest] release/ 里没有 ${version} 的安装包。\n` +
      '  先跑 npm run package:mac / package:win / package:linux，再生成清单。'
  )
  process.exit(1)
}

// CI 里通常不想把主机地址写进 package.json，用环境变量覆盖。
const base = (process.env.CPET_DOWNLOAD_BASE_URL || cpet.downloadBaseUrl || '').trim()
if (!base) {
  console.error(
    '[gen-update-manifest] 缺少下载地址前缀。二选一：\n' +
      '  package.json: "cpet": { "downloadBaseUrl": "https://your-host/cpet/" }\n' +
      '  环境变量:      CPET_DOWNLOAD_BASE_URL=https://your-host/cpet/\n' +
      `  （已找到 ${found.length} 个 ${version} 的产物：${found.map((f) => f.name).join(', ')}）`
  )
  process.exit(1)
}
const prefix = base.endsWith('/') ? base : `${base}/`

const page = (process.env.CPET_DOWNLOAD_PAGE || cpet.downloadPage || '').trim()
const manifest = {
  version,
  ...(page ? { releasesUrl: page } : {}),
  publishedAt: new Date().toISOString(),
  assets: found.map((f) => ({
    name: f.name,
    url: prefix + encodeURIComponent(f.name),
    size: f.size
  }))
}

const outPath = join(releaseDir, 'latest.json')
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`[gen-update-manifest] 已写出 release/latest.json（版本 ${version}）`)
for (const a of manifest.assets) {
  console.log(`  - ${a.name}  ${(a.size / 1024 / 1024).toFixed(1)} MB`)
}
console.log(`把这个文件上传到 ${cpet.updateManifest || '<cpet.updateManifest 配的地址>'} 即可发布。`)
