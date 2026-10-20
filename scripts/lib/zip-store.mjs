/**
 * STORE-only zip（皮肤图已压缩，再压收益小）。
 * 与 src/main/zipUtil.ts 同算法，供 Node 脚本用，不依赖 TS 编译产物。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function dosDateTime(ms = Date.now()) {
  const d = new Date(ms)
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

export function zipBuffer(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  const { time, date } = dosDateTime()

  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8')
    const data = e.data
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
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

export function zipDirectory(dir) {
  const entries = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue
      if (name === '_work' || name === '_frames' || name === '_preview' || name === '_idle_cands')
        continue
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) {
        const rel = relative(dir, full).split(sep).join('/')
        entries.push({ name: rel, data: readFileSync(full) })
      }
    }
  }
  walk(dir)
  if (!entries.length) throw new Error('目录里没有可打包的文件')
  return zipBuffer(entries)
}
