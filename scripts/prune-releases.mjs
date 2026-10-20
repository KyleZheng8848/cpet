#!/usr/bin/env node
/**
 * 只保留最近 N 个版本的安装包，其余从 release/ 删掉。
 *
 * 为什么必须是脚本：打包流程只往 release/ 里加东西，从来不删。
 * 实测这台机器上堆了 50 个版本、12GB——没人会手动去数哪些能删，
 * 也没人敢删（怕误删当前版本），于是它只会一直涨。
 *
 * 规则（故意保守，宁可少删）：
 *  - 只认 `CPET-<版本>-<平台>.<dmg|zip|exe|AppImage>` 及其 .blockmap
 *  - 按语义化版本排序，保留最新 N 个「版本」（不是 N 个文件：同一版本的
 *    dmg/zip/blockmap 算一份，删就整份删）
 *  - package.json 当前版本永远保留，哪怕它不在最新 N 个里
 *  - latest.json、mac-arm64/ 这类非版本化产物一律不碰
 *  - 认不出版本号的文件一律不碰，只在末尾列出来让人自己看
 *
 * 用法：
 *   node scripts/prune-releases.mjs              # 按 cpet.keepReleases（默认 20）清理
 *   node scripts/prune-releases.mjs --keep 5
 *   node scripts/prune-releases.mjs --dry-run    # 只列要删什么
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const releaseDir = join(root, 'release')

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run') || argv.includes('-n')
const keepArgIdx = argv.findIndex((a) => a === '--keep' || a === '-k')
const keepArg = keepArgIdx >= 0 ? Number.parseInt(argv[keepArgIdx + 1] ?? '', 10) : NaN
const configured = Number.parseInt(String(pkg.cpet?.keepReleases ?? ''), 10)
const keep = Number.isFinite(keepArg) && keepArg > 0 ? keepArg : Number.isFinite(configured) && configured > 0 ? configured : 20

if (!existsSync(releaseDir)) {
  console.log('[prune-releases] 没有 release/ 目录，无需清理。')
  process.exit(0)
}

/** `CPET-0.3.99-arm64.dmg` / `...dmg.blockmap` → 0.3.99 */
const ARTIFACT_RE = /^CPET-(\d+\.\d+\.\d+(?:-[\w.]+)?)-.+\.(?:dmg|zip|exe|AppImage)(?:\.blockmap)?$/i

function compareVersions(a, b) {
  const split = (v) => {
    const [core, ...pre] = v.split('-')
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre.join('-') }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

const byVersion = new Map()
const untouched = []
for (const name of readdirSync(releaseDir)) {
  const full = join(releaseDir, name)
  let st
  try {
    st = statSync(full)
  } catch {
    continue
  }
  if (!st.isFile()) continue
  const m = ARTIFACT_RE.exec(name)
  if (!m) {
    untouched.push(name)
    continue
  }
  const v = m[1]
  if (!byVersion.has(v)) byVersion.set(v, [])
  byVersion.get(v).push({ name, size: st.size })
}

if (!byVersion.size) {
  console.log('[prune-releases] release/ 里没有版本化安装包，无需清理。')
  process.exit(0)
}

const versions = [...byVersion.keys()].sort(compareVersions).reverse()
const keepSet = new Set(versions.slice(0, keep))
// 当前版本永远留着：刚打完包就被自己的清理脚本删掉是最蠢的失败
keepSet.add(pkg.version)

const doomed = versions.filter((v) => !keepSet.has(v))
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
const sizeOf = (v) => byVersion.get(v).reduce((s, f) => s + f.size, 0)

console.log(
  `[prune-releases] release/ 共 ${versions.length} 个版本，保留最新 ${keep} 个` +
    `（当前 ${pkg.version} 强制保留）`
)
if (!doomed.length) {
  console.log('  没有需要清理的版本。')
  process.exit(0)
}

let freed = 0
for (const v of doomed) {
  const files = byVersion.get(v)
  freed += sizeOf(v)
  console.log(`  ${dryRun ? '将删除' : '删除'} ${v}  ${mb(sizeOf(v))}  (${files.length} 个文件)`)
  if (dryRun) continue
  for (const f of files) {
    rmSync(join(releaseDir, f.name), { force: true })
  }
}

console.log(
  `[prune-releases] ${dryRun ? '预计可释放' : '已释放'} ${mb(freed)}；` +
    `保留 ${[...keepSet].sort(compareVersions).reverse().join(', ')}`
)
if (untouched.length) {
  console.log(`  未识别版本号、原样保留：${untouched.join(', ')}`)
}
