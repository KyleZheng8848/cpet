#!/usr/bin/env node
/**
 * 把 assets/skins 里的交付皮肤包上传到 OSS，并写 skins/catalog.json。
 *
 * 存储结构（与安装包分发隔离，同桶不同前缀）：
 *   …/CPET/skins/catalog.json          ← 应用拉的目录（匿名可读）
 *   …/CPET/skins/packs/<id>.zip        ← 可下载的包
 *   …/CPET/skins/previews/<id>.gif|png ← 列表缩略图（idle）
 *
 * 上传密钥只在维护者机器 / CI 的 .env.local；Electron 应用只做匿名下载。
 * 用户侧「导入」走本地 zip，不碰 OSS 写权限。
 *
 * 用法：
 *   npm run skins:publish
 *   npm run skins:publish -- --dry-run
 *   npm run skins:publish -- 云朵羊 仙人掌盆栽
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OssClient, resolveOssConfig } from './lib/oss.mjs'
import { zipDirectory } from './lib/zip-store.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skinsRoot = join(root, 'assets', 'skins')
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n')
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))

const SKIP_TOP = new Set([
  '_work',
  '_preview',
  '_frames',
  '_idle_cands',
  '.cache',
  'ACTION_CATALOG.json',
  'LIFECYCLE.json',
  'CUTE-SERIES.md',
  'README.txt'
])
const PREVIEW_NAMES = ['idle.gif', 'idle.png', 'idle.webp', 'idle.apng']
const STATE_NAMES = new Set([
  'idle',
  'thinking',
  'tool',
  'talking',
  'done',
  'error',
  'sleeping',
  'waiting',
  'petted',
  'dragged',
  'docked',
  'docked-left',
  'docked-right',
  'docked-top'
])

function die(msg) {
  console.error(`[skins:publish] ${msg}`)
  process.exit(1)
}

function mb(n) {
  return `${(n / 1048576).toFixed(1)} MB`
}

function isPackDir(dir) {
  try {
    return readdirSync(dir).some((n) => /\.(gif|png|webp|jpe?g|apng)$/i.test(n))
  } catch {
    return false
  }
}

function listPackIds() {
  return readdirSync(skinsRoot)
    .filter((name) => {
      if (name.startsWith('.') || SKIP_TOP.has(name)) return false
      if (/\.(md|json|txt)$/i.test(name)) return false
      const full = join(skinsRoot, name)
      try {
        return statSync(full).isDirectory() && isPackDir(full)
      } catch {
        return false
      }
    })
    .sort((a, b) => a.localeCompare(b, 'zh'))
}

/** 只拷贝市场需要的文件到 staging，再打 zip。 */
function stagePack(id, stagingRoot) {
  const src = join(skinsRoot, id)
  const staging = join(stagingRoot, id)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue
    if (name === '_work' || name === '_frames' || name === '_preview' || name === '_idle_cands')
      continue
    if (/\.md$/i.test(name)) continue
    const from = join(src, name)
    if (!statSync(from).isFile()) continue
    if (!/\.(gif|png|webp|jpe?g|apng|json)$/i.test(name)) continue
    copyFileSync(from, join(staging, name))
  }
  if (!readdirSync(staging).length) throw new Error(`${id}：没有可打包的图片`)
  return staging
}

function pickPreview(staging, id) {
  for (const cand of PREVIEW_NAMES) {
    const p = join(staging, cand)
    if (existsSync(p)) return { local: p, name: `${id}${extname(cand)}` }
  }
  const first = readdirSync(staging).find((n) => /\.(gif|png|webp)$/i.test(n))
  if (!first) return null
  return { local: join(staging, first), name: `${id}${extname(first)}` }
}

function collectStates(staging) {
  return readdirSync(staging)
    .filter((n) => /\.(gif|png|webp|jpe?g|apng)$/i.test(n))
    .map((n) => basename(n, extname(n)).toLowerCase())
    .filter((s) => STATE_NAMES.has(s))
}

async function main() {
  let cfg
  try {
    cfg = resolveOssConfig(root)
  } catch (err) {
    die(err.message)
  }
  const { bucket, endpoint, keyPrefix, baseUrl, accessKeyId, accessKeySecret } = cfg
  const skinsPrefix = `${keyPrefix}skins/`
  const oss = new OssClient({
    bucket,
    endpoint,
    accessKeyId,
    accessKeySecret,
    onRetry: ({ key, attempt, waitMs, error }) =>
      console.log(`\n    ${key} 第 ${attempt} 次重试（${error.message}），等 ${waitMs / 1000}s`)
  })

  let ids = listPackIds()
  if (only.length) {
    const want = new Set(only)
    ids = ids.filter((id) => want.has(id))
    const missing = only.filter((id) => !ids.includes(id))
    if (missing.length) die(`找不到这些皮肤包：${missing.join('、')}`)
  }
  if (!ids.length) die('assets/skins 下没有可发布的皮肤包')

  console.log(
    `[skins:publish] ${ids.length} 个包 → oss://${bucket}/${skinsPrefix}${dryRun ? '（dry-run）' : ''}`
  )

  const stagingRoot = join(root, 'release', '_skin-staging')
  mkdirSync(stagingRoot, { recursive: true })
  const catalogSkins = []

  for (const id of ids) {
    const staging = stagePack(id, stagingRoot)
    const zipBuf = zipDirectory(staging)
    const sha256 = createHash('sha256').update(zipBuf).digest('hex')
    const zipLocal = join(stagingRoot, `${id}.zip`)
    writeFileSync(zipLocal, zipBuf)
    const preview = pickPreview(staging, id)
    const states = collectStates(staging)

    console.log(`  ${id}  ${mb(zipBuf.length)}  states=${states.length}  sha256=${sha256.slice(0, 12)}…`)
    if (!dryRun) {
      process.stdout.write(`    packs/${id}.zip … `)
      await oss.putFile(zipLocal, `${skinsPrefix}packs/${id}.zip`)
      console.log('ok')
      if (preview) {
        process.stdout.write(`    previews/${preview.name} … `)
        await oss.putFile(preview.local, `${skinsPrefix}previews/${preview.name}`)
        console.log('ok')
      }
    }

    catalogSkins.push({
      id,
      name: id,
      description: `CPET 图片皮肤 · ${states.length} 个状态`,
      author: 'CPET',
      packUrl: `packs/${id}.zip`,
      previewUrl: preview ? `previews/${preview.name}` : undefined,
      sha256,
      bytes: zipBuf.length,
      states
    })
  }

  const catalog = {
    version: 1,
    updatedAt: new Date().toISOString(),
    skins: catalogSkins
  }
  const catalogPath = join(stagingRoot, 'catalog.json')
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')

  // 仓库种子：无网 / 未发目录时也能看见结构（下载仍依赖 OSS 上的 zip）
  const seedDir = join(root, 'assets', 'skins-market')
  mkdirSync(seedDir, { recursive: true })
  writeFileSync(join(seedDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')

  if (dryRun) {
    console.log(`[skins:publish] 预演完成。将发布到 ${baseUrl}skins/catalog.json`)
    console.log(`[skins:publish] 已写种子 ${join(seedDir, 'catalog.json')}`)
    return
  }

  await oss.putFile(catalogPath, `${skinsPrefix}catalog.json`)
  console.log(`[skins:publish] 完成：${baseUrl}skins/catalog.json（${catalogSkins.length} 款）`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
