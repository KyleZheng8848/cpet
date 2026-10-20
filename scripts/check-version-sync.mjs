#!/usr/bin/env node
/**
 * 校验版本信息一致：
 *   package.json 的 version
 *   CHANGELOG.md 的首条 "## <版本> — <日期>"
 *   src/shared/changelog.ts 的 CHANGELOG[0]
 *   release/latest.json 的 version（存在才校验）
 *
 * 为什么需要它：应用内「关于 → 更新日志」读的是 changelog.ts，仓库读的是 CHANGELOG.md，
 * 安装包版本号来自 package.json，用户的更新提示来自 latest.json。
 * 四处靠人手同步，漏一处用户就会看到与实际不符的版本，或者永远收不到更新。
 *
 * 退出码：0 通过；1 发现不一致。警告（文案措辞差异）不阻断。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

/** 版本串归一：'0.3.64 – 0.3.67' 与 '0.3.64–0.3.67' 视为同一条。 */
const normVersion = (s) => s.replace(/\s*[–—-]\s*/g, '-').trim()
/** 只比较主版本号数字；相等返回 0，a 更新返回正数。 */
const compareSemver = (a, b) => {
  const nums = (v) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const x = nums(a)
  const y = nums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}
/** 文案归一：只比语义，不比 markdown 修饰与空白。 */
const normText = (s) =>
  s
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function parseMarkdown(src) {
  const entries = []
  const lines = src.split('\n')
  let current = null
  for (const line of lines) {
    const head = /^##\s+(.+?)\s+[—–]\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line)
    if (head) {
      current = { version: head[1].trim(), date: head[2], highlights: [] }
      entries.push(current)
      continue
    }
    if (/^##\s/.test(line)) {
      current = null
      continue
    }
    const bullet = /^[-*]\s+(.*\S)\s*$/.exec(line)
    if (bullet && current) current.highlights.push(bullet[1])
  }
  return entries
}

function parseChangelogTs(src) {
  const start = src.indexOf('CHANGELOG')
  const body = start >= 0 ? src.slice(start) : src
  const entries = []
  const blockRe = /\{\s*version:\s*'([^']+)',\s*date:\s*'([^']+)',\s*highlights:\s*(\[[\s\S]*?\])\s*\}/g
  for (const m of body.matchAll(blockRe)) {
    const highlights = [...m[3].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((h) =>
      h[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    )
    entries.push({ version: m[1].trim(), date: m[2].trim(), highlights })
  }
  return entries
}

const errors = []
const warnings = []

const pkgVersion = JSON.parse(read('package.json')).version
const md = parseMarkdown(read('CHANGELOG.md'))
const ts = parseChangelogTs(read('src/shared/changelog.ts'))

if (!md.length) errors.push('CHANGELOG.md 里没解析到任何 "## <版本> — <日期>" 标题')
if (!ts.length) errors.push('src/shared/changelog.ts 里没解析到任何条目')

if (md.length && ts.length) {
  const mdTop = normVersion(md[0].version)
  const tsTop = normVersion(ts[0].version)
  if (mdTop !== pkgVersion) {
    errors.push(
      `package.json 是 ${pkgVersion}，但 CHANGELOG.md 首条是 ${md[0].version}` +
        `（发版前请补上 ${pkgVersion} 的条目）`
    )
  }
  if (tsTop !== pkgVersion) {
    errors.push(
      `package.json 是 ${pkgVersion}，但 changelog.ts 首条是 ${ts[0].version}` +
        `（应用内「关于」会显示旧版本）`
    )
  }

  if (md.length !== ts.length) {
    errors.push(`条目数不一致：CHANGELOG.md ${md.length} 条，changelog.ts ${ts.length} 条`)
  }

  const n = Math.min(md.length, ts.length)
  for (let i = 0; i < n; i++) {
    const a = md[i]
    const b = ts[i]
    if (normVersion(a.version) !== normVersion(b.version)) {
      errors.push(`第 ${i + 1} 条版本不一致：CHANGELOG.md "${a.version}" vs changelog.ts "${b.version}"`)
      continue
    }
    if (a.date !== b.date) {
      errors.push(`${a.version} 日期不一致：CHANGELOG.md ${a.date} vs changelog.ts ${b.date}`)
    }
    const at = a.highlights.map(normText)
    const bt = b.highlights.map(normText)
    if (at.length !== bt.length || at.some((t, k) => t !== bt[k])) {
      warnings.push(
        `${a.version} 文案不同：\n    CHANGELOG.md: ${at.join(' / ') || '(空)'}\n    changelog.ts: ${bt.join(' / ') || '(空)'}`
      )
    }
  }

  const dup = (list, name) => {
    const seen = new Set()
    for (const e of list) {
      const v = normVersion(e.version)
      if (seen.has(v)) errors.push(`${name} 里 ${e.version} 出现多次`)
      seen.add(v)
    }
  }
  dup(md, 'CHANGELOG.md')
  dup(ts, 'changelog.ts')
}

// release/latest.json 是用户真正拿到的更新提示来源，但它跟 package.json 的关系是有方向的：
//
//   落后（清单 < package.json）：刚 bump 完版本、包还没打出来的正常中间态。
//     曾经把它判成 error，结果是「改完版本号就再也过不了 verify，必须先打一次包」——
//     死锁。而且现在 release:publish 每次都会重新生成清单，
//     「发了新包却忘了更新清单」这条路已经堵死了，不需要在这里再拦一次。
//
//   超前（清单 > package.json）：清单指向一个仓库里根本不存在的版本，
//     用户点更新会下到对不上号的包。这个必须拦。
const manifestPath = join(root, 'release', 'latest.json')
let manifestVersion = null
if (existsSync(manifestPath)) {
  try {
    manifestVersion = String(JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? '').trim()
  } catch (err) {
    errors.push(`release/latest.json 解析失败：${err.message}`)
  }
  if (manifestVersion && manifestVersion !== pkgVersion) {
    const cmp = compareSemver(manifestVersion, pkgVersion)
    if (cmp > 0) {
      errors.push(
        `release/latest.json 是 ${manifestVersion}，比 package.json 的 ${pkgVersion} 还新` +
          '（用户会被指向一个仓库里不存在的版本）。确认 package.json 的 version 是不是被改回去了。'
      )
    } else {
      warnings.push(
        `release/latest.json 还停在 ${manifestVersion}，package.json 已是 ${pkgVersion}。` +
          '打包并 npm run release:publish 之后它会自动刷新；只想本地生成清单用 npm run manifest。'
      )
    }
  }
}

for (const w of warnings) console.warn(`⚠️  ${w}`)

if (errors.length) {
  console.error(`\n❌ 版本信息不同步（${errors.length} 处）：`)
  for (const e of errors) console.error(`  - ${e}`)
  console.error(
    '\n发版流程：改 package.json → CHANGELOG.md 加一条 → changelog.ts 加同一条 → 打包 → npm run manifest。'
  )
  process.exit(1)
}

console.log(
  `✅ 版本同步：${pkgVersion}（CHANGELOG.md 与 changelog.ts 共 ${md.length} 条一致${
    manifestVersion === pkgVersion ? '，latest.json 一致' : ''
  }${warnings.length ? `，${warnings.length} 处文案措辞不同` : ''}）`
)
