/**
 * 极小 ZIP 读写：解压支持 STORE / DEFLATE；打包用 STORE（皮肤图已压缩，再压收益小）。
 * 不引入第三方依赖，便于主进程与单测共用。
 */
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { finished } from 'node:stream/promises'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

function u16(buf: Buffer, o: number): number {
  return buf.readUInt16LE(o)
}
function u32(buf: Buffer, o: number): number {
  return buf.readUInt32LE(o)
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function dosDateTime(ms = Date.now()): { time: number; date: number } {
  const d = new Date(ms)
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

export type ZipEntry = { name: string; data: Buffer }

export type UnzipOptions = {
  /** 为 false 时跳过该条目（不解压），用于大 Office 包只抽正文 XML。 */
  accept?: (name: string) => boolean
  /** 单条目解压上限（字节）；超出则跳过该条目。 */
  maxEntryBytes?: number
}

/** 从 zip 缓冲解出文件条目（忽略目录项）。 */
export function unzipBuffer(buf: Buffer, opts?: UnzipOptions): ZipEntry[] {
  const out: ZipEntry[] = []
  const accept = opts?.accept
  const maxEntry = opts?.maxEntryBytes ?? 0
  let o = 0
  while (o + 4 <= buf.length && u32(buf, o) === SIG_LOCAL) {
    const flags = u16(buf, o + 6)
    const method = u16(buf, o + 8)
    const compSize = u32(buf, o + 18)
    const uncompSize = u32(buf, o + 22)
    const nameLen = u16(buf, o + 26)
    const extraLen = u16(buf, o + 28)
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString('utf8')
    const dataStart = o + 30 + nameLen + extraLen
    // bit3：尺寸在 data descriptor；本地头可能为 0，无法安全跳过时整包失败
    const hasDescriptor = (flags & 0x8) !== 0
    if (hasDescriptor && (compSize === 0 || uncompSize === 0)) {
      throw new Error('不支持带 data descriptor 的 zip（请换系统打开）')
    }
    if (dataStart + compSize > buf.length) throw new Error('zip 数据损坏或截断')
    const compressed = buf.subarray(dataStart, dataStart + compSize)
    o = dataStart + compSize
    if (hasDescriptor && o + 16 <= buf.length) {
      // data descriptor: optional sig + crc + comp + uncomp
      if (u32(buf, o) === 0x08074b50) o += 16
      else o += 12
    }
    if (name.endsWith('/')) continue
    const norm = name.replace(/\\/g, '/')
    // 防 zip-slip：解压侧再校验一遍路径
    if (norm.includes('..') || norm.startsWith('/')) {
      throw new Error(`不安全的 zip 路径：${name}`)
    }
    if (accept && !accept(norm)) continue
    if (maxEntry > 0 && uncompSize > maxEntry) continue
    let data: Buffer
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) data = inflateRawSync(compressed)
    else throw new Error(`不支持的 zip 压缩方式：${method}`)
    if (maxEntry > 0 && data.length > maxEntry) continue
    if (uncompSize && data.length !== uncompSize) {
      // 部分工具写 0 大小；有值则核对
      throw new Error(`zip 条目大小不符：${name}`)
    }
    out.push({ name: norm, data })
  }
  if (!out.length) throw new Error('zip 里没有可用文件')
  return out
}

/** 把条目写成 STORE zip。 */
export function zipBuffer(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const { time, date } = dosDateTime()

  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8')
    const data = e.data
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // utf-8 flag
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    locals.push(local, data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(SIG_END, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, ...centrals, end])
}

/** 把目录打成 zip（根下直接是文件，不含外层文件夹名时由 caller 决定 name 前缀）。 */
export function zipDirectory(dir: string, { rootPrefix = '' }: { rootPrefix?: string } = {}): Buffer {
  const entries: ZipEntry[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue
      if (name === '_work' || name === '_frames' || name === '_preview') continue
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) {
        const rel = relative(dir, full).split(sep).join('/')
        const zipName = rootPrefix ? `${rootPrefix.replace(/\/$/, '')}/${rel}` : rel
        entries.push({ name: zipName, data: readFileSync(full) })
      }
    }
  }
  walk(dir)
  if (!entries.length) throw new Error('目录里没有可打包的文件')
  return zipBuffer(entries)
}

/** 解压 zip 到目标目录（自动剥掉单一顶层文件夹）。 */
export function unzipToDirectory(zipPath: string, destDir: string): void {
  const buf = readFileSync(zipPath)
  let entries = unzipBuffer(buf)
  // 单一顶层目录：剥掉，避免 skins/foo/foo/idle.gif
  const tops = new Set(entries.map((e) => e.name.split('/')[0]).filter(Boolean))
  if (tops.size === 1) {
    const top = [...tops][0]!
    const allUnder = entries.every((e) => e.name === top || e.name.startsWith(`${top}/`))
    if (allUnder) {
      entries = entries
        .filter((e) => e.name !== top && e.name.startsWith(`${top}/`))
        .map((e) => ({ ...e, name: e.name.slice(top.length + 1) }))
    }
  }
  mkdirSync(destDir, { recursive: true })
  for (const e of entries) {
    if (!e.name || e.name.includes('..')) throw new Error(`不安全的 zip 路径：${e.name}`)
    const out = join(destDir, ...e.name.split('/'))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, e.data)
  }
}

/** 流式写出 zip 文件。 */
export async function writeZipFile(zipPath: string, entries: ZipEntry[]): Promise<void> {
  mkdirSync(dirname(zipPath), { recursive: true })
  const buf = zipBuffer(entries)
  const ws = createWriteStream(zipPath)
  ws.end(buf)
  await finished(ws)
}

// 供打包时可选压缩（当前未用；保留给大文本）
export function _deflateRaw(data: Buffer): Buffer {
  return deflateRawSync(data)
}
