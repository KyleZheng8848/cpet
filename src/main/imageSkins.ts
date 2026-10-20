import { app, clipboard, dialog, BrowserWindow, shell } from 'electron'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { ImagePack, LoadedImageSkin } from '../shared/types'
import type { LocalSkinPack, SkinPackSource } from '../shared/skinMarket'
import { isSafeSkinPackId, normalizeSkinPackId } from '../shared/skinMarket'
import { isBundledImageSkinId } from '../shared/bundledSkins'
import { buildSkinSubmissionClipboard } from '../shared/feedback'
import { checkSkinStemCoverage } from '../shared/skinLifecycle'
import { unzipToDirectory, writeZipFile, zipDirectory } from './zipUtil'

/**
 * 图片皮肤：唯一目录 = userData/skins。
 * 从安装包 Resources/skins（开发态 assets/skins）同步默认内置包；用户自建包不覆盖。
 * 默认内置仅 BUNDLED_IMAGE_SKIN_IDS（赛博幽灵 / 数字佳人），其余走市场或导入。
 */

const IMG_EXTS = ['.png', '.gif', '.jpg', '.jpeg', '.webp', '.apng']
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const STATE_ALIASES: Record<string, string> = {
  working: 'tool',
  run: 'tool',
  happy: 'petted',
  sleep: 'sleeping',
  ready: 'waiting'
}
const KNOWN_STATES = [
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
]

const MAX_BYTES = 8 * 1024 * 1024
let seeded = false

/** 安装包内置皮肤（只作种子来源，不直接给 UI 打开）。 */
function getBundledSkinsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'skins')
    : join(__dirname, '../../assets/skins')
}

const README = `CPET · 图片皮肤目录
============================

这是应用唯一的图片皮肤目录（可写）。
设置 / 托盘里的「打开目录」都会打开这里。

内置皮肤包会在安装/升级后自动同步到这里（带 .cpet-bundled 标记）。
可在皮肤市场卸载内置包；卸载后写入 .cpet-unbundled，不会再自动同步回来。
自定义皮肤请用不同文件夹名，避免被同名内置包覆盖。

两种用法：

1) 单图包：直接把一张 png/gif 放在本目录，例如 doge.gif
   → 该图会用于宠物的所有状态。

2) 状态包（推荐，能表现不同动作）：新建一个子文件夹，里面按状态命名图片：
   my-pet/
     idle.gif        待机
     thinking.gif    思考中
     tool.gif        干活/用工具（别名 working）
     talking.gif     说话/回复
     done.gif        完成
     error.gif       出错
     sleeping.gif    睡觉（别名 sleep）
     waiting.gif     等待批准（别名 ready）
     petted.gif      被摸（别名 happy）
     dragged.gif     被拖拽
     docked.gif      贴边半隐藏（推荐至少提供；默认按右边）
     docked-left.gif / docked-right.gif
                     可选，覆盖左右贴边（建议左=右镜像，勿预裁切）
     docked-top.gif  可选；缺省回退 docked / idle
   缺哪个状态就自动回退到 idle（贴边时优先 docked-边 / docked）。

3) 动作图（可选）：文件夹里任何「不是状态名」的图片都会进「动作池」。

支持格式：png / gif / apng / jpg / webp（GIF/APNG 会动）。单图建议 <8MB。
放好后：托盘 / 宠物右键「外观」快切，或打开「皮肤市场」窗选用（或先点「刷新」）。
`

const BUNDLED_MARKER = '.cpet-bundled'
const MARKET_MARKER = '.cpet-market'
/** 用户主动卸载过的内置包：阻止 seedBundledPacks 再拷回。 */
const UNBUNDLED_DIR = '.cpet-unbundled'
/** 预览图上限：过大则市场列表不带 data URL，避免 IPC 膨胀。 */
const PREVIEW_MAX_BYTES = 512 * 1024

function unbundledMarkerPath(userDir: string, id: string): string {
  return join(userDir, UNBUNDLED_DIR, normalizeSkinPackId(id))
}

function isUnbundledByUser(userDir: string, id: string): boolean {
  try {
    return existsSync(unbundledMarkerPath(userDir, id))
  } catch {
    return false
  }
}

function markUnbundled(userDir: string, id: string): void {
  const dir = join(userDir, UNBUNDLED_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(unbundledMarkerPath(userDir, id), `${Date.now()}\n`, 'utf8')
}

function clearUnbundled(userDir: string, id: string): void {
  const p = unbundledMarkerPath(userDir, id)
  try {
    if (existsSync(p)) rmSync(p, { force: true })
  } catch {
    // ignore
  }
}

function isSkippableBundledEntry(name: string): boolean {
  if (name.startsWith('.')) return true
  if (name === '_work' || name === '_preview' || name === '_frames') return true
  if (name === 'README.txt' || name.toLowerCase().endsWith('.md')) return true
  return false
}

/** Content fingerprint for a skin pack directory (stable across copy). */
function packFingerprint(dir: string): string {
  const hash = createHash('sha1')
  let files: string[]
  try {
    files = readdirSync(dir)
      .filter((f) => IMG_EXTS.includes(extname(f).toLowerCase()))
      .sort()
  } catch {
    return ''
  }
  for (const f of files) {
    try {
      const st = statSync(join(dir, f))
      hash.update(`${f}:${st.size}\n`)
    } catch {
      // ignore
    }
  }
  return hash.digest('hex')
}

function readBundledMarker(dir: string): string | null {
  try {
    const raw = readFileSync(join(dir, BUNDLED_MARKER), 'utf8').trim()
    return raw || null
  } catch {
    return null
  }
}

function writeBundledMarker(dir: string, fingerprint: string): void {
  try {
    writeFileSync(join(dir, BUNDLED_MARKER), `${fingerprint}\n`, 'utf8')
  } catch {
    // ignore
  }
}

function copyBundledPack(src: string, dest: string, fingerprint: string): void {
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  cpSync(src, dest, { recursive: true })
  // drop work folders if they slipped through
  for (const junk of ['_frames', '_work', '_preview']) {
    const p = join(dest, junk)
    if (existsSync(p)) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
  writeBundledMarker(dest, fingerprint)
}

/**
 * Sync builtin packs into userData/skins.
 * - Missing packs: copy（除非用户写过 .cpet-unbundled）
 * - Packs previously seeded by CPET (have .cpet-bundled): refresh when fingerprint changes
 * - Legacy same-name packs without marker: one-time adopt+refresh (so upgrades replace stale seeds)
 * - User-created packs with different names: never touched
 */
function seedBundledPacks(userDir: string): void {
  if (seeded) return
  seeded = true
  const bundled = getBundledSkinsDir()
  if (!existsSync(bundled) || bundled === userDir) return
  let entries: string[]
  try {
    entries = readdirSync(bundled)
  } catch {
    return
  }
  for (const name of entries) {
    if (isSkippableBundledEntry(name)) continue
    // 开发态 assets/skins 里可能有很多包；种子只同步默认内置名单。
    if (!isBundledImageSkinId(name)) continue
    if (isUnbundledByUser(userDir, name)) continue
    const src = join(bundled, name)
    let st
    try {
      st = statSync(src)
    } catch {
      continue
    }
    if (!st.isDirectory() && !IMG_EXTS.includes(extname(name).toLowerCase())) continue

    const dest = join(userDir, name)
    const fp = packFingerprint(src)
    if (!fp && st.isDirectory()) continue

    try {
      if (!existsSync(dest)) {
        copyBundledPack(src, dest, fp)
        continue
      }
      // single-file "pack" at root: only seed if missing (handled above)
      if (!st.isDirectory()) continue

      const marker = readBundledMarker(dest)
      const shouldRefresh = marker === null || marker !== fp
      if (!shouldRefresh) continue
      // If marker is null: legacy seed or user pack with the same builtin name.
      // Builtin names always refresh from the install so upgrades aren't sticky-old.
      // Truly custom packs should use a unique folder name.
      copyBundledPack(src, dest, fp)
    } catch {
      // ignore single pack failures
    }
  }
}

/** 唯一皮肤目录（userData/skins）；确保存在并补齐缺失的内置包。 */
export function getSkinsDir(): string {
  const dir = join(app.getPath('userData'), 'skins')
  try {
    mkdirSync(dir, { recursive: true })
    const readme = join(dir, 'README.txt')
    // 旧版 README 若仍写「两个目录」，一并刷新说明
    if (!existsSync(readme) || !readFileSync(readme, 'utf8').includes('唯一的图片皮肤目录')) {
      writeFileSync(readme, README)
    }
  } catch {
    // ignore
  }
  seedBundledPacks(dir)
  return dir
}

function detectSource(full: string, isFile: boolean): SkinPackSource {
  if (isFile) return 'user'
  if (existsSync(join(full, MARKET_MARKER))) return 'market'
  // 仅默认内置名单算 bundled；历史误种子的其它包可卸载
  if (existsSync(join(full, BUNDLED_MARKER)) && isBundledImageSkinId(basename(full))) {
    return 'bundled'
  }
  return 'user'
}

function packMetaFromDir(
  id: string,
  dir: string,
  includePreview: boolean
): LocalSkinPack | null {
  let states: string[] = []
  let actionCount = 0
  try {
    for (const f of readdirSync(dir)) {
      const ext = extname(f).toLowerCase()
      if (!IMG_EXTS.includes(ext)) continue
      const base = basename(f, extname(f)).toLowerCase()
      const state = STATE_ALIASES[base] ?? base
      if (KNOWN_STATES.includes(state)) states.push(state)
      else actionCount++
    }
  } catch {
    return null
  }
  states = [...new Set(states)]
  if (!states.length && !actionCount) return null
  return {
    id,
    name: id,
    states,
    source: detectSource(dir, false),
    actionCount,
    preview: includePreview ? (previewDataUrlForPack(dir) ?? undefined) : undefined
  }
}

function packMetaFromFile(name: string, full: string, includePreview: boolean): LocalSkinPack {
  return {
    id: name,
    name,
    states: ['idle'],
    source: 'user',
    actionCount: 0,
    preview: includePreview ? (fileToDataUrl(full) ?? undefined) : undefined
  }
}

function previewDataUrlForPack(dirOrFile: string): string | null {
  try {
    const st = statSync(dirOrFile)
    if (st.isFile()) {
      if (st.size > PREVIEW_MAX_BYTES) return null
      return fileToDataUrl(dirOrFile)
    }
  } catch {
    return null
  }
  for (const state of ['idle', 'talking', 'waiting', 'petted']) {
    const f = findStateFile(dirOrFile, state)
    if (!f) continue
    try {
      if (statSync(f).size > PREVIEW_MAX_BYTES) return null
    } catch {
      continue
    }
    return fileToDataUrl(f)
  }
  return null
}

function collectLocalPacks(
  dir: string,
  into: Map<string, LocalSkinPack>,
  includePreview: boolean
): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    if (isSkippableBundledEntry(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      const p = packMetaFromDir(name, full, includePreview)
      if (p) into.set(p.id, p)
    } else if (IMG_EXTS.includes(extname(name).toLowerCase())) {
      into.set(name, packMetaFromFile(name, full, includePreview))
    }
  }
}

/** 列出唯一目录下的图片皮肤包（兼容旧 ImagePack）。 */
export function listImagePacks(): ImagePack[] {
  return listLocalSkinPacks({ includePreview: false }).map(({ id, name, states }) => ({
    id,
    name,
    states
  }))
}

/** 列出本地包（来源；预览可选，默认开给市场 UI）。 */
export function listLocalSkinPacks(opts?: { includePreview?: boolean }): LocalSkinPack[] {
  const includePreview = opts?.includePreview !== false
  const byId = new Map<string, LocalSkinPack>()
  collectLocalPacks(getSkinsDir(), byId, includePreview)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 写入市场安装标记。 */
export function markMarketPack(dir: string, meta?: { id: string; from?: string }): void {
  try {
    writeFileSync(
      join(dir, MARKET_MARKER),
      JSON.stringify({ id: meta?.id, from: meta?.from, at: Date.now() }, null, 2) + '\n',
      'utf8'
    )
  } catch {
    // ignore
  }
}

/**
 * 卸载本地图片皮肤（含内置）。
 * - 内置：删目录并写 .cpet-unbundled，避免下次启动被种子同步回来
 * - 当前正在使用的包：调用方应先切走
 */
export function uninstallImagePack(id: string): { ok: true } | { ok: false; error: string } {
  if (!isSafeSkinPackId(id)) return { ok: false, error: '非法皮肤 id' }
  const nid = normalizeSkinPackId(id)
  const userDir = getSkinsDir()
  const full = join(userDir, nid)
  if (!existsSync(full)) return { ok: false, error: '皮肤不存在' }
  let st
  try {
    st = statSync(full)
  } catch {
    return { ok: false, error: '无法读取皮肤' }
  }
  const wasBundled =
    isBundledImageSkinId(nid) ||
    (st.isDirectory() && detectSource(full, false) === 'bundled')
  try {
    // 先打 tombstone，再删目录，避免中途 getSkinsDir/seed 又拷回来
    if (wasBundled) markUnbundled(userDir, nid)
    rmSync(full, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 把外部文件夹安装进 userData/skins（覆盖同名非内置包需 caller 确认）。 */
export function installPackFromDirectory(
  srcDir: string,
  id: string,
  source: SkinPackSource = 'user'
): { ok: true; id: string } | { ok: false; error: string } {
  if (!isSafeSkinPackId(id)) return { ok: false, error: '非法皮肤 id' }
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    return { ok: false, error: '源目录无效' }
  }
  const meta = packMetaFromDir(id, srcDir, false)
  if (!meta) return { ok: false, error: '目录里没有可用的状态图或动作图' }
  const nid = normalizeSkinPackId(id)
  const userDir = getSkinsDir()
  const dest = join(userDir, nid)
  if (existsSync(dest)) {
    try {
      const st = statSync(dest)
      if (st.isDirectory() && detectSource(dest, false) === 'bundled') {
        return { ok: false, error: '与内置皮肤同名，请换文件夹名后再导入' }
      }
    } catch {
      // continue and try overwrite
    }
  }
  try {
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    cpSync(srcDir, dest, { recursive: true })
    for (const junk of ['_frames', '_work', '_preview']) {
      const p = join(dest, junk)
      if (existsSync(p)) rmSync(p, { recursive: true, force: true })
    }
    if (source === 'market') markMarketPack(dest, { id })
    // 用户主动再装回同名包（含市场下载内置款）→ 清 tombstone，允许后续升级种子刷新
    clearUnbundled(userDir, nid)
    return { ok: true, id: nid }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 从 zip 安装（zip 根下为状态图，或单一顶层文件夹）。 */
export function installPackFromZip(
  zipPath: string,
  id: string,
  source: SkinPackSource = 'user'
): { ok: true; id: string } | { ok: false; error: string } {
  if (!isSafeSkinPackId(id)) return { ok: false, error: '非法皮肤 id' }
  const tmp = join(tmpdir(), `cpet-skin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  try {
    mkdirSync(tmp, { recursive: true })
    unzipToDirectory(zipPath, tmp)
    return installPackFromDirectory(tmp, id, source)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

/** 弹出选择框：导入本地皮肤文件夹或 zip。 */
export async function importSkinPackDialog(
  parent?: BrowserWindow | null
): Promise<{ ok: true; id: string } | { ok: false; error: string; canceled?: boolean }> {
  const opts: Electron.OpenDialogOptions = {
    title: '导入皮肤包',
    properties: ['openFile', 'openDirectory'],
    filters: [
      { name: '皮肤包', extensions: ['zip'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const r = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: '已取消', canceled: true }
  const picked = r.filePaths[0]
  const st = statSync(picked)
  if (st.isDirectory()) {
    const id = basename(picked)
    return installPackFromDirectory(picked, id, 'user')
  }
  if (extname(picked).toLowerCase() !== '.zip') {
    return { ok: false, error: '请选择皮肤文件夹或 .zip 包' }
  }
  const id = basename(picked, '.zip')
  return installPackFromZip(picked, id, 'user')
}

/** 导出已安装包为 zip。 */
export async function exportSkinPackDialog(
  id: string,
  parent?: BrowserWindow | null
): Promise<{ ok: true; path: string } | { ok: false; error: string; canceled?: boolean }> {
  if (!isSafeSkinPackId(id)) return { ok: false, error: '非法皮肤 id' }
  const full = join(getSkinsDir(), normalizeSkinPackId(id))
  if (!existsSync(full)) return { ok: false, error: '皮肤不存在' }
  const saveOpts: Electron.SaveDialogOptions = {
    title: '导出皮肤包',
    defaultPath: `${normalizeSkinPackId(id)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  }
  const r = parent
    ? await dialog.showSaveDialog(parent, saveOpts)
    : await dialog.showSaveDialog(saveOpts)
  if (r.canceled || !r.filePath) return { ok: false, error: '已取消', canceled: true }
  try {
    const st = statSync(full)
    if (st.isFile()) {
      await writeZipFile(r.filePath, [{ name: basename(full), data: readFileSync(full) }])
    } else {
      const buf = zipDirectory(full)
      writeFileSync(r.filePath, buf)
    }
    return { ok: true, path: r.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 打开唯一皮肤目录。 */
export async function openSkinsLocation(): Promise<string> {
  const path = getSkinsDir()
  await shell.openPath(path)
  return path
}

export type SkinSubmissionResult =
  | {
      ok: true
      zipPath: string
      clipboardText: string
      issueUrl?: string
      revealed: boolean
    }
  | { ok: false; error: string; canceled?: boolean }

/**
 * 投稿制：校验包 → 导出 zip → 剪贴板模板 → 供打开 Issue。
 * 不上传 OSS；审核通过后由维护者 skins:publish。
 */
export async function prepareSkinMarketSubmission(
  id: string,
  opts: { issueUrl?: string; parent?: BrowserWindow | null } = {}
): Promise<SkinSubmissionResult> {
  if (!isSafeSkinPackId(id)) return { ok: false, error: '非法皮肤 id' }
  const packId = normalizeSkinPackId(id)
  const packs = listLocalSkinPacks({ includePreview: false })
  const meta = packs.find((p) => p.id === packId)
  if (!meta) return { ok: false, error: '皮肤未安装' }
  if (meta.source === 'bundled') {
    return { ok: false, error: '内置皮肤无需投稿（已在市场/安装包内）' }
  }
  if (!meta.states.includes('idle') && !meta.states.length) {
    return { ok: false, error: '皮肤包缺少可用状态图，请补齐后再投稿' }
  }
  const coverage = checkSkinStemCoverage(meta.states)
  if (!coverage.ok) {
    return {
      ok: false,
      error:
        `皮肤缺核心 lifecycle 态，无法投稿：${coverage.missingRequired.join('、')}。` +
        '至少需要 idle / thinking / tool / talking / done / error / waiting。'
    }
  }

  const exported = await exportSkinPackDialog(packId, opts.parent)
  if (!exported.ok) return exported

  let sha256: string | undefined
  let bytes: number | undefined
  try {
    const data = readFileSync(exported.path)
    bytes = data.length
    sha256 = createHash('sha256').update(data).digest('hex')
  } catch {
    // 模板仍可投稿，只是没有校验指纹
  }

  const clipboardText = buildSkinSubmissionClipboard({
    id: packId,
    name: meta.name,
    states: meta.states,
    actionCount: meta.actionCount,
    missingRecommended: coverage.missingRecommended,
    sha256,
    bytes,
    zipPath: exported.path,
    appVersion: app.getVersion()
  })
  clipboard.writeText(clipboardText)

  let revealed = false
  try {
    await shell.showItemInFolder(exported.path)
    revealed = true
  } catch {
    // 揭示失败不挡投稿
  }

  return {
    ok: true,
    zipPath: exported.path,
    clipboardText,
    issueUrl: opts.issueUrl,
    revealed
  }
}

function fileToDataUrl(file: string): string | null {
  try {
    const st = statSync(file)
    if (st.size > MAX_BYTES) return null
    const ext = extname(file).toLowerCase()
    const mime = MIME[ext] ?? 'image/png'
    const b64 = readFileSync(file).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}

function findStateFile(dir: string, state: string): string | null {
  for (const ext of IMG_EXTS) {
    const f = join(dir, state + ext)
    if (existsSync(f)) return f
  }
  for (const [alias, target] of Object.entries(STATE_ALIASES)) {
    if (target !== state) continue
    for (const ext of IMG_EXTS) {
      const f = join(dir, alias + ext)
      if (existsSync(f)) return f
    }
  }
  return null
}

function resolvePackPath(id: string): string | null {
  const full = join(getSkinsDir(), id)
  return existsSync(full) ? full : null
}

/** 加载指定图片皮肤包，返回各状态的 data URL。 */
export function loadImageSkin(id: string): LoadedImageSkin | null {
  const full = resolvePackPath(id)
  if (!full) return null
  let stat
  try {
    stat = statSync(full)
  } catch {
    return null
  }

  const images: Record<string, string> = {}
  const actions: string[] = []

  if (stat.isFile()) {
    const url = fileToDataUrl(full)
    if (!url) return null
    images.idle = url
    return { id, images, actions }
  }

  for (const state of KNOWN_STATES) {
    const f = findStateFile(full, state)
    if (f) {
      const url = fileToDataUrl(f)
      if (url) images[state] = url
    }
  }
  try {
    for (const f of readdirSync(full)) {
      const ext = extname(f).toLowerCase()
      if (!IMG_EXTS.includes(ext)) continue
      const base = basename(f, ext).toLowerCase()
      const state = STATE_ALIASES[base] ?? base
      if (KNOWN_STATES.includes(state)) continue
      const url = fileToDataUrl(join(full, f))
      if (url) actions.push(url)
    }
  } catch {
    // ignore
  }

  if (!images.idle) {
    const first = Object.values(images)[0] ?? actions[0]
    if (first) images.idle = first
  }
  return Object.keys(images).length || actions.length ? { id, images, actions } : null
}
