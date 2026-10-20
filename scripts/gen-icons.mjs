// 纯 Node 生成图标 PNG（无需第三方依赖，产物不入库）。
// CPET 小宠脸：圆头 + 双耳 + 双眼；彩色用于 App 图标，黑剪影用于 macOS 菜单栏。
import { deflateSync } from 'node:zlib'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function blend(dst, i, r, g, b, a) {
  const ia = 1 - a
  dst[i] = Math.round(r * a + dst[i] * ia)
  dst[i + 1] = Math.round(g * a + dst[i + 1] * ia)
  dst[i + 2] = Math.round(b * a + dst[i + 2] * ia)
  dst[i + 3] = Math.min(255, Math.round(a * 255 + dst[i + 3] * ia))
}

function coverage(px, py, cx, cy, radius) {
  const d = Math.hypot(px - cx, py - cy)
  return Math.max(0, Math.min(1, radius - d + 0.5))
}

/** 椭圆覆盖度（轴对齐）。 */
function ellipseCov(px, py, cx, cy, rx, ry) {
  const nx = (px - cx) / rx
  const ny = (py - cy) / ry
  const d = Math.hypot(nx, ny)
  return Math.max(0, Math.min(1, 1 - d + 0.5 / Math.max(rx, ry)))
}

/**
 * @param {number} size
 * @param {{ mono?: boolean }} [opts]
 */
function drawMascot(size, { mono = false } = {}) {
  const buf = Buffer.alloc(size * size * 4, 0)
  const s = size
  // 头略偏下，给耳朵留空；整体更「脸」而不是一团糊。
  const head = { x: s * 0.5, y: s * 0.58, r: s * 0.36 }
  const earL = { x: s * 0.28, y: s * 0.28, r: s * 0.14 }
  const earR = { x: s * 0.72, y: s * 0.28, r: s * 0.14 }
  const eyeL = { x: s * 0.38, y: s * 0.55, rx: s * 0.07, ry: s * 0.085 }
  const eyeR = { x: s * 0.62, y: s * 0.55, rx: s * 0.07, ry: s * 0.085 }
  // 暖陶土色：贴近对话窗纸感，避开默认紫
  const body = mono ? [0, 0, 0] : [196, 92, 62]
  const belly = mono ? [0, 0, 0] : [232, 168, 120]
  const earInner = mono ? [0, 0, 0] : [232, 140, 110]
  const snout = mono ? [0, 0, 0] : [245, 220, 190]

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4
      const px = x + 0.5
      const py = y + 0.5

      const ear =
        Math.max(
          coverage(px, py, earL.x, earL.y, earL.r),
          coverage(px, py, earR.x, earR.y, earR.r)
        )
      const headCov = coverage(px, py, head.x, head.y, head.r)
      const solid = Math.max(ear, headCov)
      if (solid <= 0) continue

      if (mono) {
        // 菜单栏模板：实心剪影，眼睛挖空，小尺寸也认得是脸
        const eyeHole = Math.max(
          ellipseCov(px, py, eyeL.x, eyeL.y, eyeL.rx, eyeL.ry),
          ellipseCov(px, py, eyeR.x, eyeR.y, eyeR.rx, eyeR.ry)
        )
        if (eyeHole > 0.55) continue
        blend(buf, i, 0, 0, 0, solid)
        continue
      }

      blend(buf, i, body[0], body[1], body[2], solid)

      // 耳内
      for (const e of [earL, earR]) {
        const inner = coverage(px, py, e.x, e.y + s * 0.02, e.r * 0.55)
        if (inner > 0) blend(buf, i, earInner[0], earInner[1], earInner[2], inner * 0.85)
      }

      // 脸部亮肚
      const face = coverage(px, py, head.x, head.y + s * 0.06, head.r * 0.72)
      if (face > 0) blend(buf, i, belly[0], belly[1], belly[2], face * 0.45)

      // 口鼻
      const nosePad = ellipseCov(px, py, head.x, head.y + s * 0.12, s * 0.16, s * 0.11)
      if (nosePad > 0) blend(buf, i, snout[0], snout[1], snout[2], nosePad * 0.9)

      // 眼睛（白底 + 瞳孔）
      for (const eye of [eyeL, eyeR]) {
        const white = ellipseCov(px, py, eye.x, eye.y, eye.rx, eye.ry)
        if (white > 0) blend(buf, i, 255, 252, 248, white)
        const pupil = coverage(px, py, eye.x + s * 0.01, eye.y + s * 0.01, s * 0.035)
        if (pupil > 0) blend(buf, i, 40, 28, 22, pupil)
      }

      // 小鼻头
      const nose = coverage(px, py, head.x, head.y + s * 0.1, s * 0.028)
      if (nose > 0) blend(buf, i, 90, 50, 40, nose)
    }
  }
  return buf
}

function write(path, size, opts) {
  const full = resolve(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, encodePng(size, size, drawMascot(size, opts)))
  console.log('wrote', path, `${size}x${size}`)
}

write('resources/tray.png', 32)
write('resources/tray@2x.png', 64)
write('resources/trayTemplate.png', 32, { mono: true })
write('resources/trayTemplate@2x.png', 64, { mono: true })

// App 图标优先用现有品牌图片；没有时退回程序生成的小宠脸。
const brandIcon = resolve(root, 'assets/brand/cpet-icon-1024.png')
const outIcon = resolve(root, 'build/icon.png')
mkdirSync(dirname(outIcon), { recursive: true })
if (existsSync(brandIcon)) {
  copyFileSync(brandIcon, outIcon)
  console.log('wrote build/icon.png (from assets/brand/cpet-icon-1024.png)')
} else {
  write('build/icon.png', 512)
}
