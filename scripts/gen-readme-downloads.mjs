#!/usr/bin/env node
/**
 * 按分发源（OSS）的真实状态重写 README 下载区块，并同步上传 index.html。
 *
 * 数据源是「远端现在真有哪些包」，不是 package.json 的版本号 ——
 * 版本号只说明你打算发什么，用户能不能下到是另一回事。
 * 按远端来，README 上就不会出现点了 404 的链接。
 *
 * 用法：
 *   npm run docs:downloads            # 重写 README.md + 上传下载页
 *   npm run docs:downloads -- --check # 只比对 README，不一致时退出码 1（给 CI 用）
 *   npm run docs:downloads -- --page-only # 只上传下载页，不动 README
 *
 * 正常发版不用手跑，release:publish 会自动带上这一步。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OssClient, resolveOssConfig } from './lib/oss.mjs'
import { groupRemoteArtifacts, historyEntries, stableName } from './lib/release-index.mjs'
import { renderDownloadsBlock, replaceBlock } from './lib/readme-downloads.mjs'
import {
  changelogHighlights,
  DOWNLOAD_DEMO_VIDEOS,
  DOWNLOAD_SCREENSHOTS,
  renderDownloadPage
} from './lib/download-page.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const pageOnly = process.argv.includes('--page-only')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function die(msg) {
  console.error(`[docs:downloads] ${msg}`)
  process.exit(1)
}

let cfg
try {
  cfg = resolveOssConfig(root)
} catch (err) {
  die(err.message)
}
const { bucket, endpoint, keyPrefix, baseUrl, accessKeyId, accessKeySecret, keep } = cfg

const oss = new OssClient({ bucket, endpoint, accessKeyId, accessKeySecret })
const grouped = groupRemoteArtifacts(await oss.list(keyPrefix), keyPrefix)
if (!grouped.versions.length) die(`${baseUrl} 下没有任何安装包，先发一版。`)

const latest = grouped.versions[0]
const assets = grouped.byVersion
  .get(latest)
  .filter((f) => !f.name.endsWith('.blockmap'))
  .sort((a, b) => a.name.localeCompare(b.name))
const history = historyEntries(grouped, { limit: keep, baseUrl })
const highlights = changelogHighlights(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), latest)

// 发布时间取这一版最后一个文件传完的时刻：包传完了才算这一版真的能下
const publishedAt = assets
  .map((f) => f.lastModified)
  .filter(Boolean)
  .sort()
  .pop()

if (!checkOnly) {
  const iconLocal = join(root, 'build', 'icon.png')
  if (existsSync(iconLocal)) await oss.putFile(iconLocal, `${keyPrefix}assets/icon.png`)
  const demoVideos = []
  for (const demo of DOWNLOAD_DEMO_VIDEOS) {
    const local = join(root, demo.localRel)
    if (!existsSync(local)) continue
    await oss.putFile(local, `${keyPrefix}assets/${demo.remoteName}`)
    console.log(`[docs:downloads] 演示视频已上传：${baseUrl}assets/${demo.remoteName}`)
    demoVideos.push({ url: `${baseUrl}assets/${demo.remoteName}`, caption: demo.caption })
  }
  const screenshots = []
  for (const shot of DOWNLOAD_SCREENSHOTS) {
    const local = join(root, shot.localRel)
    if (!existsSync(local)) continue
    const key = `${keyPrefix}assets/screenshots/${shot.remoteName}`
    await oss.putFile(local, key)
    console.log(`[docs:downloads] 界面截图已上传：${baseUrl}assets/screenshots/${shot.remoteName}`)
    screenshots.push({
      url: `${baseUrl}assets/screenshots/${shot.remoteName}?v=${latest}`,
      alt: shot.alt,
      caption: shot.caption
    })
  }
  const html = renderDownloadPage({
    version: latest,
    publishedAt,
    assets: assets.map((a) => ({ ...a, url: `${baseUrl}${a.name}` })),
    highlights,
    manifestUrl: pkg.cpet?.updateManifest,
    repoUrl: pkg.cpet?.repoUrl,
    history,
    iconUrl: existsSync(iconLocal) ? `${baseUrl}assets/icon.png` : undefined,
    demoVideos,
    screenshots,
    stableUrl: (name) => `${baseUrl}${stableName(name)}`
  })
  const releaseDir = join(root, 'release')
  mkdirSync(releaseDir, { recursive: true })
  const pagePath = join(releaseDir, 'index.html')
  writeFileSync(pagePath, html)
  await oss.putFile(pagePath, `${keyPrefix}index.html`)
  console.log(`[docs:downloads] 下载页已上传：${baseUrl}index.html（${latest}）`)
}

if (pageOnly) process.exit(0)

const block = renderDownloadsBlock({
  version: latest,
  publishedAt,
  assets,
  stableUrl: (name) => `${baseUrl}${stableName(name)}`,
  history,
  // 远端最新版有可能比本地 CHANGELOG 还新（换台机器跑），取不到就不写要点，不编
  highlights,
  pageUrl: `${baseUrl}index.html`
})

const readmePath = join(root, 'README.md')
const before = readFileSync(readmePath, 'utf8')
let after
try {
  after = replaceBlock(before, block)
} catch (err) {
  die(err.message)
}

if (after === before) {
  console.log(`[docs:downloads] README 下载区已经是最新（${latest}）。`)
  process.exit(0)
}
if (checkOnly) {
  die(`README 下载区跟分发源对不上（远端最新 ${latest}）。跑 npm run docs:downloads 重新生成。`)
}
writeFileSync(readmePath, after)
console.log(`[docs:downloads] README 下载区已更新到 ${latest}，记得提交。`)
