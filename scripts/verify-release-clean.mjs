/**
 * 打包后校验，两件事：
 *  1. 安装包内不得夹带本机对话 / 设置等隐私数据。
 *     对话只应存在于系统 userData（如 ~/Library/Application Support/cursor-pet/），
 *     与安装包分离——重装/分享 DMG 不会带走你的聊天，也不会把聊天发给别人。
 *  2. 皮肤中间产物（_work / _frames，本机合计 400MB+）不得进包。
 *     electron-builder.yml 里已用 filter 排除，但 glob 写错时没人会发现，
 *     只会看到 DMG 突然大了几百兆——这里直接把它变成打包失败。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const release = join(root, 'release')

const FORBIDDEN_NAMES = new Set([
  'chat-store.json',
  'chat-history.json',
  'settings.json',
  'schedules.json',
  'Cookies',
  'Preferences'
])

const FORBIDDEN_DIR_NAMES = new Set(['Local Storage', 'Session Storage', 'IndexedDB'])

/** 只该存在于开发机的皮肤中间产物 / 构建缓存。 */
const BLOAT_DIR_NAMES = new Set(['_work', '_frames', '_preview', '__pycache__', '.cache'])

function dirSizeMb(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let names
    try {
      names = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of names) {
      const p = join(cur, name)
      try {
        const st = statSync(p)
        if (st.isDirectory()) stack.push(p)
        else total += st.size
      } catch {
        // 忽略读不到的项
      }
    }
  }
  return total / 1024 / 1024
}

function walk(dir, privacy = [], bloat = []) {
  if (!existsSync(dir)) return { privacy, bloat }
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (FORBIDDEN_DIR_NAMES.has(name)) privacy.push(p)
      else if (BLOAT_DIR_NAMES.has(name)) bloat.push(p)
      else walk(p, privacy, bloat)
    } else if (FORBIDDEN_NAMES.has(name)) {
      privacy.push(p)
    }
  }
  return { privacy, bloat }
}

const targets = []
if (existsSync(release)) {
  for (const name of readdirSync(release)) {
    const p = join(release, name)
    try {
      if (!statSync(p).isDirectory()) continue
    } catch {
      continue
    }
    // 只扫 .app / linux/win 解包目录，跳过 dmg/zip 二进制
    if (name.endsWith('.app') || name.startsWith('mac') || name.startsWith('win') || name.startsWith('linux')) {
      targets.push(p)
    }
  }
}

if (!targets.length) {
  console.log('[verify-release-clean] 未找到 release 应用目录，跳过（尚未打包？）')
  process.exit(0)
}

const privacy = []
const bloat = []
for (const t of targets) {
  const r = walk(t)
  privacy.push(...r.privacy)
  bloat.push(...r.bloat)
}

let failed = false

if (privacy.length) {
  failed = true
  console.error('[verify-release-clean] 安装包内发现疑似隐私数据，禁止发布：')
  for (const h of privacy) console.error('  -', relative(root, h))
  console.error('对话/设置应只在本机 userData，不要打进包。请从打包目录移除上述文件后重试。')
}

if (bloat.length) {
  failed = true
  console.error('\n[verify-release-clean] 安装包内发现皮肤中间产物 / 构建缓存，禁止发布：')
  for (const h of bloat) {
    console.error(`  - ${relative(root, h)}  (${dirSizeMb(h).toFixed(1)} MB)`)
  }
  console.error(
    '这些目录只用于本机生成皮肤，用户不需要。请检查 electron-builder.yml 的 extraResources filter。'
  )
}

/** 安装包 Resources/skins 只允许默认内置（与 bundledSkins.ts / electron-builder.yml 一致）。 */
const ALLOWED_BUNDLED_SKINS = new Set(
  (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      const list = pkg?.cpet?.bundledSkins
      if (Array.isArray(list) && list.length) return list.map(String)
    } catch {
      // fall through
    }
    return ['赛博幽灵', '数字佳人']
  })()
)

function findExtraBundledSkins(appDir) {
  const candidates = [
    join(appDir, 'Contents', 'Resources', 'skins'),
    join(appDir, 'resources', 'skins'),
    join(appDir, 'skins')
  ]
  const extras = []
  for (const skinsDir of candidates) {
    if (!existsSync(skinsDir)) continue
    for (const name of readdirSync(skinsDir)) {
      if (name === '.DS_Store' || name.startsWith('.')) continue
      if (BLOAT_DIR_NAMES.has(name)) continue
      if (name === 'README.txt' || name.toLowerCase().endsWith('.md')) continue
      const p = join(skinsDir, name)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (!ALLOWED_BUNDLED_SKINS.has(name)) extras.push(p)
    }
  }
  return extras
}

const extraSkins = []
for (const t of targets) extraSkins.push(...findExtraBundledSkins(t))
if (extraSkins.length) {
  failed = true
  console.error('\n[verify-release-clean] 安装包内置了非默认皮肤，禁止发布：')
  for (const h of extraSkins) console.error('  -', relative(root, h))
  console.error(
    `默认内置仅允许：${[...ALLOWED_BUNDLED_SKINS].join('、')}。其余请走皮肤市场 / 导入。`
  )
}

/** 安装包须带上的内置 Skill（extraResources → Resources/skills）。 */
const REQUIRED_BUNDLED_SKILLS = [
  'cpet-cute-skins',
  'harsh-optimize-loop',
  'cpet-rss-digest'
]

function resourcesRoot(appDir) {
  const nested = join(appDir, 'CPET.app', 'Contents', 'Resources')
  if (existsSync(nested)) return nested
  const mac = join(appDir, 'Contents', 'Resources')
  if (existsSync(mac)) return mac
  const other = join(appDir, 'resources')
  if (existsSync(other)) return other
  return null
}

function missingBundledSkills(appDir) {
  const res = resourcesRoot(appDir)
  if (!res) return [...REQUIRED_BUNDLED_SKILLS]
  return REQUIRED_BUNDLED_SKILLS.filter(
    (id) => !existsSync(join(res, 'skills', id, 'SKILL.md'))
  )
}

/** 只强制校验「当前版本」产物，避免 release/ 里上版 unpacked 没有 skill 误杀。 */
function packagedVersion(appDir) {
  const plistCandidates = [
    join(appDir, 'CPET.app', 'Contents', 'Info.plist'),
    join(appDir, 'Contents', 'Info.plist')
  ]
  for (const plist of plistCandidates) {
    if (!existsSync(plist)) continue
    try {
      const text = readFileSync(plist, 'utf8')
      const m = /CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text)
      if (m) return m[1].trim()
    } catch {
      // try next
    }
  }
  return null
}

let expectVersion = ''
try {
  expectVersion = String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '')
} catch {
  expectVersion = ''
}

const missingSkill = []
for (const t of targets) {
  const miss = missingBundledSkills(t)
  if (!miss.length) continue
  const ver = packagedVersion(t)
  if (ver && expectVersion && ver !== expectVersion) {
    console.warn(
      `[verify-release-clean] 跳过旧产物 ${relative(root, t)}（v${ver} ≠ 当前 ${expectVersion}），不强制 skill`
    )
    continue
  }
  if (!ver) {
    const res = resourcesRoot(t)
    if (!res || !existsSync(join(res, 'skills'))) {
      console.warn(
        `[verify-release-clean] 跳过无版本号且无 skills/ 的旧产物 ${relative(root, t)}`
      )
      continue
    }
  }
  missingSkill.push({ dir: t, miss })
}
if (missingSkill.length) {
  failed = true
  console.error('\n[verify-release-clean] 安装包缺少内置技能，禁止发布：')
  for (const h of missingSkill) {
    console.error(`  - ${relative(root, h.dir)} 缺：${h.miss.join('、')}`)
  }
  console.error(
    '请检查 electron-builder.yml extraResources：.cursor/skills/<id> → skills/<id>'
  )
  console.error(`必带：${REQUIRED_BUNDLED_SKILLS.join('、')}`)
}

if (failed) process.exit(1)

console.log('[verify-release-clean] OK：安装包未夹带 chat-store / settings 等本机数据')
console.log('  也未夹带 _work / _frames 等皮肤中间产物')
console.log(`  已包含 skills/${REQUIRED_BUNDLED_SKILLS.join('、skills/')}`)
console.log(`  内置皮肤仅：${[...ALLOWED_BUNDLED_SKINS].join('、')}`)
console.log('  本机对话仍保留在 Application Support（与安装包分离，分享 DMG 不会带上聊天）')
