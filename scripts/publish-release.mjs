#!/usr/bin/env node
/**
 * 把当前版本发布到 OSS：上传安装包 → 更新 latest.json → 远端只留最近 N 个版本。
 *
 * 为什么顺序不能反：latest.json 是用户的更新入口。先传清单再传包，
 * 中间那几分钟里所有点「检查更新」的人都会拿到一个下载 404 的版本。
 * 所以这里固定「包全部传完 → 最后覆盖 latest.json」。
 *
 * 远端保留策略跟本地同源，都读 package.json 的 cpet.keepReleases（默认 20）：
 * 本地 release/ 由 prune-releases.mjs 清，OSS 由这里清，两边不会各说各话。
 *
 * 配置：
 *   package.json 的 cpet.ossTarget / cpet.ossEndpoint / cpet.downloadBaseUrl（不含密钥）
 *   .env.local 的 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET（已 gitignore，绝不入库）
 *
 * 用法：
 *   node scripts/publish-release.mjs            # 真的传
 *   node scripts/publish-release.mjs --dry-run  # 只列会传什么、会删什么
 *   node scripts/publish-release.mjs --backfill # 顺带把 release/ 里的历史版本补传上去
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OssClient, resolveOssConfig } from './lib/oss.mjs'
import {
  changelogHighlights,
  DOWNLOAD_DEMO_VIDEOS,
  DOWNLOAD_SCREENSHOTS,
  renderDownloadPage
} from './lib/download-page.mjs'
import {
  ARTIFACT_RE,
  compareVersions,
  groupRemoteArtifacts,
  historyEntries,
  stableName
} from './lib/release-index.mjs'
import { renderDownloadsBlock, replaceBlock } from './lib/readme-downloads.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n')
const backfill = process.argv.includes('--backfill')

function die(msg) {
  console.error(`[publish-release] ${msg}`)
  process.exit(1)
}

let cfg
try {
  cfg = resolveOssConfig(root)
} catch (err) {
  die(err.message)
}
const { cpet, version, bucket, keyPrefix, endpoint, baseUrl, accessKeyId, accessKeySecret, keep } =
  cfg

if (!existsSync(releaseDir)) die('没有 release/ 目录，先打包。')

const uploads = readdirSync(releaseDir)
  .filter((name) => {
    const hit = ARTIFACT_RE.exec(name)
    if (!hit || hit[1] !== version) return false
    try {
      return statSync(join(releaseDir, name)).size > 0
    } catch {
      return false
    }
  })
  .sort()
if (!uploads.length) die(`release/ 里没有 ${version} 的安装包，先跑 npm run package:mac。`)

const oss = new OssClient({
  bucket,
  endpoint,
  accessKeyId,
  accessKeySecret,
  onRetry: ({ key, attempt, waitMs, error }) =>
    console.log(`\n    ${key} 第 ${attempt} 次重试（${error.message}），等 ${waitMs / 1000}s`)
})
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

console.log(`[publish-release] ${version} → oss://${bucket}/${keyPrefix}${dryRun ? '（dry-run）' : ''}`)

/** 上传一个本地产物，打印进度。 */
async function upload(name, label = '上传') {
  const path = join(releaseDir, name)
  const size = statSync(path).size
  if (dryRun) {
    console.log(`  [dry-run] ${label} ${name}  ${mb(size)}`)
    return
  }
  process.stdout.write(`  ${label} ${name}  ${mb(size)} … `)
  const started = Date.now()
  await oss.putFile(path, `${keyPrefix}${name}`)
  console.log(`完成（${((Date.now() - started) / 1000).toFixed(1)}s）`)
}

// 0. 补传历史版本：远端只有最近一次发布过的版本，本地 release/ 里往往还留着更早的包。
//    不补的话下载页和 README 的「历史版本」永远是空的，用户遇到新版有问题时无处可退。
if (backfill) {
  let existing = []
  try {
    existing = await oss.list(keyPrefix)
  } catch (err) {
    die(`列不出远端对象，无法判断哪些需要补传：${err.message}`)
  }
  const remoteSize = new Map()
  for (const { key, size } of existing) {
    remoteSize.set(key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key, size)
  }

  const localByVersion = new Map()
  for (const name of readdirSync(releaseDir)) {
    const hit = ARTIFACT_RE.exec(name)
    if (!hit || hit[1] === version) continue
    if (!localByVersion.has(hit[1])) localByVersion.set(hit[1], [])
    localByVersion.get(hit[1]).push(name)
  }

  // 只补那些补完还能活下来的版本：超出保留数的传上去下一步就被删，纯属浪费带宽
  const survivors = [...localByVersion.keys()]
    .sort(compareVersions)
    .reverse()
    .slice(0, Math.max(keep - 1, 0))

  const pending = []
  for (const v of survivors) {
    for (const name of localByVersion.get(v).sort()) {
      const local = statSync(join(releaseDir, name)).size
      if (local <= 0) continue
      if (remoteSize.get(name) === local) continue // 已经一模一样，跳过
      pending.push(name)
    }
  }

  if (!pending.length) {
    console.log('  历史版本已经齐了，无需补传。')
  } else {
    const total = pending.reduce((n, f) => n + statSync(join(releaseDir, f)).size, 0)
    console.log(`  补传 ${survivors.length} 个历史版本，共 ${pending.length} 个文件 ${mb(total)}`)
    for (const name of pending) {
      try {
        await upload(name, '补传')
      } catch (err) {
        // 传过的按大小比对会被跳过，所以重跑同一条命令就是续传，不会从头再来
        die(`补传中断在 ${name}：${err.message}\n已传完的不会重复传，重跑同一条命令即可继续。`)
      }
    }
  }
}

// 1. 先把带版本号的包传完（此时还不动 latest.json，避免验不过却把用户切到坏包）
for (const name of uploads) await upload(name)

// 2. 维护不随版本变的固定名，README / 下载页链一次就够，不会每发一版变死链
const stableOf = new Map(uploads.map((name) => [name, stableName(name)]))
for (const [name, alias] of stableOf) {
  if (alias === name) continue // 认不出版本号就别乱起别名
  if (dryRun) {
    console.log(`  [dry-run] 固定名 ${alias} → ${name}`)
    continue
  }
  await oss.copy(`${keyPrefix}${name}`, `${keyPrefix}${alias}`)
  console.log(`  固定名 ${alias} → ${name}`)
}

// 3. 先生成清单到本地，用版本化 URL 做可用性预检；通过后才覆盖远端 latest.json
console.log('  生成 latest.json（先本地）')
const gen = spawnSync(process.execPath, [join(root, 'scripts', 'gen-update-manifest.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CPET_DOWNLOAD_BASE_URL: baseUrl }
})
if (gen.status !== 0) die('生成 latest.json 失败，已上传的包不会被引用，修好后重跑。')

if (!dryRun) {
  // 用本地清单 + 已上传的版本化 URL 预检；通过后才覆盖远端 latest.json
  console.log('  远端可用性预检（尚未切换 latest.json）…')
  const verify = spawnSync(
    process.execPath,
    [
      join(root, 'scripts', 'verify-published.mjs'),
      '--version',
      version,
      '--manifest-file',
      join(releaseDir, 'latest.json'),
      '--skip-stables' // 固定名刚复制完，下面通过后再最终验一次
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: (() => {
        const e = { ...process.env, CPET_DOWNLOAD_BASE_URL: baseUrl }
        delete e.ELECTRON_RUN_AS_NODE
        return e
      })()
    }
  )
  if (verify.status !== 0) {
    die(
      `可用性预检失败：未覆盖 latest.json，用户仍指向上一版。\n` +
        `修好包后重跑发布。详情见上方 verify-published 输出。`
    )
  }
  await oss.putFile(join(releaseDir, 'latest.json'), `${keyPrefix}latest.json`)
  console.log('  上传 latest.json（预检已通过）')
} else {
  console.log('  [dry-run] 跳过远端可用性验收')
}

// 4. 先把远端现有版本列出来：下载页要展示历史版本，清理也要用同一份数据
let remoteItems = []
try {
  remoteItems = await oss.list(keyPrefix)
} catch (err) {
  console.warn(`  ⚠️ 列不出远端对象：${err.message}`)
}

const grouped = groupRemoteArtifacts(remoteItems, keyPrefix)
const remote = grouped.byVersion
const versions = grouped.versions
const history = historyEntries(grouped, { limit: keep, baseUrl })

// 5. 下载页 + README 下载区：内容全部来自清单、远端列表与 CHANGELOG，不手写版本号
{
  const manifest = JSON.parse(readFileSync(join(releaseDir, 'latest.json'), 'utf8'))
  const stableUrl = (name) => `${baseUrl}${stableOf.get(name) ?? stableName(name)}`
  const iconLocal = join(root, 'build', 'icon.png')
  const iconKey = `${keyPrefix}assets/icon.png`
  if (!dryRun && existsSync(iconLocal)) await oss.putFile(iconLocal, iconKey)
  const demoVideos = []
  for (const demo of DOWNLOAD_DEMO_VIDEOS) {
    const local = join(root, demo.localRel)
    if (!existsSync(local)) continue
    const remoteKey = `${keyPrefix}assets/${demo.remoteName}`
    if (!dryRun) {
      await oss.putFile(local, remoteKey)
      console.log(`  上传演示视频：${baseUrl}assets/${demo.remoteName}`)
    }
    demoVideos.push({ url: `${baseUrl}assets/${demo.remoteName}`, caption: demo.caption })
  }
  const screenshots = []
  for (const shot of DOWNLOAD_SCREENSHOTS) {
    const local = join(root, shot.localRel)
    if (!existsSync(local)) continue
    const remoteKey = `${keyPrefix}assets/screenshots/${shot.remoteName}`
    if (!dryRun) {
      await oss.putFile(local, remoteKey)
      console.log(`  上传界面截图：${baseUrl}assets/screenshots/${shot.remoteName}`)
    }
    screenshots.push({
      url: `${baseUrl}assets/screenshots/${shot.remoteName}?v=${version}`,
      alt: shot.alt,
      caption: shot.caption
    })
  }
  const html = renderDownloadPage({
    version,
    publishedAt: manifest.publishedAt,
    assets: manifest.assets,
    highlights: changelogHighlights(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version),
    manifestUrl: cpet.updateManifest,
    repoUrl: cpet.repoUrl,
    history,
    iconUrl: existsSync(iconLocal) ? `${baseUrl}assets/icon.png` : undefined,
    demoVideos,
    screenshots,
    // 页面上的按钮一律指固定名，分享出去的链接不会随下一版失效
    stableUrl
  })
  const pagePath = join(releaseDir, 'index.html')
  writeFileSync(pagePath, html)
  if (dryRun) {
    console.log(`  [dry-run] 上传下载页 index.html（${(html.length / 1024).toFixed(1)} KB）`)
  } else {
    await oss.putFile(pagePath, `${keyPrefix}index.html`)
    console.log(`  上传下载页完成：${baseUrl}index.html`)
  }

  // README 的下载表跟下载页同源同时更新：两处对不上时，用户信的是先看到的那个。
  const readmePath = join(root, 'README.md')
  try {
    const before = readFileSync(readmePath, 'utf8')
    const after = replaceBlock(
      before,
      renderDownloadsBlock({
        version,
        publishedAt: manifest.publishedAt,
        assets: manifest.assets,
        stableUrl,
        history,
        highlights: changelogHighlights(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version),
        pageUrl: `${baseUrl}index.html`
      })
    )
    if (after === before) {
      console.log('  README 下载区无变化')
    } else if (dryRun) {
      console.log('  [dry-run] 更新 README 下载区')
    } else {
      writeFileSync(readmePath, after)
      console.log('  README 下载区已更新 —— 记得 git commit，仓库里的表才会跟着变')
    }
  } catch (err) {
    console.warn(`  ⚠️ README 下载区没更新：${err.message}`)
  }
}

// 6. 远端保留最近 N 个版本（沿用上面那份列表，不重复请求）
console.log(`  清理远端（保留最新 ${keep} 个版本）`)
const keepSet = new Set(versions.slice(0, keep))
keepSet.add(version)
const doomed = versions.filter((v) => !keepSet.has(v))
if (!doomed.length) {
  console.log(`    远端 ${versions.length} 个版本，无需清理。`)
} else {
  for (const v of doomed) {
    for (const f of remote.get(v)) {
      console.log(`    ${dryRun ? '将删除' : '删除'} ${f.name}`)
      if (!dryRun) await oss.remove(`${keyPrefix}${f.name}`)
    }
  }
}

if (!dryRun) {
  console.log('  切换 latest 后终检…')
  const final = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'verify-published.mjs'), '--version', version],
    {
      cwd: root,
      stdio: 'inherit',
      env: (() => {
        const e = { ...process.env, CPET_DOWNLOAD_BASE_URL: baseUrl }
        delete e.ELECTRON_RUN_AS_NODE
        return e
      })()
    }
  )
  if (final.status !== 0) {
    die(
      `latest.json 已指向 ${version}，但终检失败。请立刻重跑修复或回滚清单。`
    )
  }
}

console.log(
  dryRun
    ? '[publish-release] 预演完成，什么都没动。'
    : `[publish-release] 完成。用户端 ${baseUrl}latest.json 现在指向 ${version}（已验收）。`
)
