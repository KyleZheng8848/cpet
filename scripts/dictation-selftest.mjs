/**
 * 以 CPET.app 身份跑听写助手自测（TCC 归因到 com.cpet.app）。
 *
 * 用法:
 *   ELECTRON_RUN_AS_NODE=1 /Applications/CPET.app/Contents/MacOS/CPET \
 *     scripts/dictation-selftest.mjs [/path/to.wav]
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appBin =
  process.env.CPET_APP_BIN ||
  '/Applications/CPET.app/Contents/Resources/bin/cpet-dictation'
const releaseBin = join(
  root,
  'release/mac-arm64/CPET.app/Contents/Resources/bin/cpet-dictation'
)
const bin = existsSync(appBin) ? appBin : releaseBin
const wavPath = process.argv[2] || '/tmp/cpet-tone.wav'

function readWavPcm(path) {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not wav')
  let off = 12
  let sampleRate = 16000
  let dataStart = -1
  let dataSize = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      sampleRate = buf.readUInt32LE(body + 4)
    } else if (id === 'data') {
      dataStart = body
      dataSize = size
      break
    }
    off = body + size + (size % 2)
  }
  if (dataStart < 0) throw new Error('no data chunk')
  return { sampleRate, pcm: buf.subarray(dataStart, dataStart + dataSize) }
}

if (!existsSync(bin)) {
  console.error('[selftest] missing helper', bin)
  process.exit(2)
}
if (!existsSync(wavPath)) {
  console.error('[selftest] missing wav', wavPath)
  process.exit(2)
}

const { sampleRate, pcm } = readWavPcm(wavPath)
console.log('[selftest] bin=', bin)
console.log('[selftest] wav=', wavPath, 'sr=', sampleRate, 'bytes=', pcm.length)

const child = spawn(bin, ['--live'], { stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
const events = []

child.stdout.on('data', (d) => {
  stdout += String(d)
  const lines = stdout.split('\n')
  stdout = lines.pop() ?? ''
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    console.log('[stdout]', t)
    try {
      events.push(JSON.parse(t))
    } catch {
      // ignore
    }
  }
})
child.stderr.on('data', (d) => {
  const s = String(d)
  stderr += s
  console.error('[stderr]', s.trim())
})

const started = Date.now()
await new Promise((r) => setTimeout(r, 800))

const chunk = sampleRate // 1s
for (let i = 0; i < pcm.length; i += chunk * 2) {
  const slice = pcm.subarray(i, Math.min(pcm.length, i + chunk * 2))
  const b64 = Buffer.from(slice).toString('base64')
  child.stdin.write(`AUDIO ${sampleRate} ${b64}\n`)
  await new Promise((r) => setTimeout(r, 200))
}
child.stdin.write('STOP\n')

const code = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
    resolve(-1)
  }, 25_000)
  child.on('close', (c) => {
    clearTimeout(timer)
    resolve(c ?? -1)
  })
})

const partials = events.filter((e) => e.t === 'partial' || e.t === 'final')
const end = events.find((e) => e.t === 'end')
const ready = events.some((e) => e.t === 'ready' || e.t === 'status')
console.log('[selftest] exit=', code, 'ms=', Date.now() - started)
console.log('[selftest] ready=', ready, 'partials=', partials.length, 'end=', end || null)
if (stderr.trim()) console.log('[selftest] stderr_full=', stderr.trim())

if (!ready && !partials.length) {
  console.error('[selftest] FAIL: helper never became ready / no transcript')
  process.exit(1)
}
if (code !== 0 && !end) {
  console.error('[selftest] FAIL: non-zero exit without end event')
  process.exit(1)
}
console.log('[selftest] OK (pipeline responded; tone wav may yield empty text)')
process.exit(0)
