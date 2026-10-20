#!/usr/bin/env node
/**
 * 真实跑 CPET AgentRunner（不是只测裸 CLI）。
 * 断言：短问候能收尾、不会空转数分钟、done 后不再收事件。
 *
 *   node scripts/smoke-cpet-runner.mjs
 *   node scripts/smoke-cpet-runner.mjs --only=cursor
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REPORT = join(ROOT, 'release', 'smoke-reports')
mkdirSync(REPORT, { recursive: true })

const only = new Set(
  (process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)

const results = []
function pass(name, detail = '') {
  results.push({ name, ok: true, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail) {
  results.push({ name, ok: false, detail })
  console.log(`  ✗ ${name} — ${detail}`)
}
function skip(name, detail) {
  results.push({ name, ok: true, detail, skip: true })
  console.log(`  ○ ${name} — SKIP: ${detail}`)
}

async function loadRunners() {
  // 用 tsx 跑 TypeScript 源，保证测到现行 RunContext / AgentRunner
  const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (!existsSync(tsx) && !existsSync(join(ROOT, 'node_modules', 'tsx'))) {
    // 无 tsx：用动态编译入口
    const loader = join(ROOT, 'scripts', '_smoke-load-runners.mjs')
    writeFileSync(
      loader,
      `
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
// fallback: spawn ts-node/esm not available — use built bundle introspection
console.error('NEED_TSX')
process.exit(2)
`
    )
  }
  const { spawnSync } = await import('node:child_process')
  const probe = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `
      import { AgentRunner } from ${JSON.stringify(join(ROOT, 'src/main/cursorAgent.ts'))}
      import { OpenClawRunner } from ${JSON.stringify(join(ROOT, 'src/main/openclawAgent.ts'))}
      console.log(JSON.stringify({
        cursor: typeof AgentRunner,
        openclaw: typeof OpenClawRunner,
      }))
      `
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  )
  if (probe.status !== 0) {
    return { ok: false, err: probe.stderr || probe.stdout || 'tsx import failed' }
  }
  return { ok: true }
}

/** 通过子进程跑一段 TS，避免主进程 ESM/CJS 纠缠。 */
function runTsProbe(code, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '-e', code],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CPET_SMOKE_CWD: ROOT
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let out = ''
    let err = ''
    const t = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, out, err: err + '\nTIMEOUT', code: -1, ms: timeoutMs })
    }, timeoutMs)
    const t0 = Date.now()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve({ ok: code === 0, out, err, code, ms: Date.now() - t0 })
    })
  })
}

const cursorProbe = `
import cursorMod from ${JSON.stringify(join(ROOT, 'src/main/cursorAgent.ts'))}
const { AgentRunner } = cursorMod

const runner = new AgentRunner()
const events = []
const t0 = Date.now()
let firstContentAt = 0
let doneAt = 0

const payload = {
  conversationId: 'smoke-cursor-' + Date.now().toString(36),
  prompt: '只回复两个字：你好。不要用工具，不要解释。',
  cwd: process.env.CPET_SMOKE_CWD,
  model: 'cursor:auto',
  agentAutonomy: 'agent'
}

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    runner.cancel(payload.conversationId)
    reject(new Error('timeout'))
  }, 110_000)
  runner.run(payload, (e) => {
    events.push({ ...e, _t: Date.now() - t0 })
    if (!firstContentAt && (e.type === 'assistant-delta' || e.type === 'reasoning-delta')) {
      firstContentAt = Date.now() - t0
    }
    if (e.type === 'done' || e.type === 'error' || e.type === 'aborted') {
      doneAt = Date.now() - t0
      clearTimeout(timer)
      setTimeout(resolve, 50)
    }
  }).catch((err) => { clearTimeout(timer); reject(err) })
}).catch(() => {})

const text = events.filter(e => e.type === 'assistant-delta').map(e => e.text).join('')
const reason = events.filter(e => e.type === 'reasoning-delta').map(e => e.text).join('')
const types = events.map(e => e.type)
const settled = types.includes('done') || types.includes('error') || types.includes('aborted')
const afterDone = events.findIndex(e => e.type === 'done' || e.type === 'error' || e.type === 'aborted')
const trailing = afterDone >= 0 ? events.slice(afterDone + 1).filter(e => e.type === 'assistant-delta' || e.type === 'reasoning-delta') : []
const again = /用户再次问候|用户发来了问候/.test(reason)
const settleLag = firstContentAt && doneAt ? doneAt - firstContentAt : null

const report = {
  settled,
  ms: Date.now() - t0,
  firstContentAt,
  doneAt,
  settleLag,
  text: text.slice(0, 200),
  reasonHead: reason.slice(0, 120),
  again,
  trailingAfterDone: trailing.length,
  types: [...new Set(types)],
  busyAfter: runner.isBusy
}
console.log('__REPORT__' + JSON.stringify(report))
process.exit(settled && !runner.isBusy ? 0 : 1)
`

const openclawProbe = `
import openclawMod from ${JSON.stringify(join(ROOT, 'src/main/openclawAgent.ts'))}
const { OpenClawRunner } = openclawMod

const runner = new OpenClawRunner()
const events = []
const t0 = Date.now()
let doneAt = 0
const payload = {
  conversationId: 'smoke-oc-' + Date.now().toString(36),
  prompt: '只回复两个字：你好。不要用工具。',
  cwd: process.env.CPET_SMOKE_CWD,
  model: 'openclaw:main',
  agentAutonomy: 'ask'
}
await runner.run(payload, (e) => {
  events.push(e)
  if (e.type === 'done' || e.type === 'error' || e.type === 'aborted') doneAt = Date.now() - t0
})
const text = events.filter(e => e.type === 'assistant-delta').map(e => e.text).join('')
const settled = events.some(e => e.type === 'done' || e.type === 'error' || e.type === 'aborted')
console.log('__REPORT__' + JSON.stringify({
  settled, ms: Date.now()-t0, doneAt, text: text.slice(0,200),
  types: [...new Set(events.map(e=>e.type))], busyAfter: runner.isBusy,
  err: events.find(e=>e.type==='error')?.message?.slice(0,160)
}))
process.exit(settled && !runner.isBusy ? 0 : 1)
`

function parseReport(out) {
  const line = out.split('\n').find((l) => l.startsWith('__REPORT__'))
  if (!line) return null
  try {
    return JSON.parse(line.slice('__REPORT__'.length))
  } catch {
    return null
  }
}

async function testCursor() {
  console.log('\n## Cursor AgentRunner（真实 spawn）')
  if (only.size && !only.has('cursor')) return skip('cursor runner', '--only')
  const r = await runTsProbe(cursorProbe, 90_000)
  const report = parseReport(r.out)
  writeFileSync(join(REPORT, 'cpet-runner-cursor.json'), JSON.stringify({ r, report }, null, 2))
  if (!report) {
    fail('cursor runner 产出报告', (r.err || r.out).slice(0, 400))
    return
  }
  if (report.settled) pass('cursor 收到终态 done/error/aborted', `${report.ms}ms`)
  else fail('cursor 收到终态 done/error/aborted', JSON.stringify(report.types))

  if (!report.busyAfter) pass('cursor 结束后 isBusy=false')
  else fail('cursor 结束后 isBusy=false', '仍 busy')

  if (report.text.trim() || report.reasonHead.trim()) {
    pass('cursor 有可见输出', (report.text || report.reasonHead).slice(0, 40))
  } else {
    fail('cursor 有可见输出', '空')
  }

  // 关键：首包内容后应很快收尾（重连空转被掐掉）
  if (report.settleLag != null && report.settleLag <= 20_000) {
    pass('cursor 首包后≤20s 收尾', `${report.settleLag}ms`)
  } else if (report.settleLag != null) {
    fail('cursor 首包后≤20s 收尾', `${report.settleLag}ms（仍在空转）`)
  } else {
    fail('cursor 首包后≤20s 收尾', '无 firstContent/done 时间戳')
  }

  // 冷启动常 >45s；关键断言是首包后≤20s 收尾（上面）
  if (report.ms <= 120_000) pass('cursor 整轮≤120s（含冷启动）', `${report.ms}ms`)
  else fail('cursor 整轮≤120s（含冷启动）', `${report.ms}ms`)

  if (!report.again) pass('cursor 思考无「再次问候」循环')
  else fail('cursor 思考无「再次问候」循环', report.reasonHead)

  if (report.trailingAfterDone === 0) pass('cursor done 后无追加 delta')
  else fail('cursor done 后无追加 delta', String(report.trailingAfterDone))
}

async function testOpenclaw() {
  console.log('\n## OpenClaw AgentRunner')
  if (only.size && !only.has('openclaw')) return skip('openclaw runner', '--only')
  const r = await runTsProbe(openclawProbe, 100_000)
  const report = parseReport(r.out)
  writeFileSync(join(REPORT, 'cpet-runner-openclaw.json'), JSON.stringify({ r, report }, null, 2))
  if (!report) {
    fail('openclaw runner 产出报告', (r.err || r.out).slice(0, 400))
    return
  }
  if (report.settled) pass('openclaw 收到终态', `${report.ms}ms`)
  else fail('openclaw 收到终态', JSON.stringify(report.types))
  if (!report.busyAfter) pass('openclaw 结束后 isBusy=false')
  else fail('openclaw 结束后 isBusy=false', '仍 busy')
  if (report.text.trim() || report.err) {
    pass('openclaw 有正文或明确错误', (report.text || report.err || '').slice(0, 60))
  } else {
    fail('openclaw 有正文或明确错误', '空')
  }
}

async function main() {
  console.log('CPET Runner 真实冒烟')
  console.log(`cwd=${ROOT}`)

  // 确保 tsx 可用
  let hasTsx = false
  try {
    await import('tsx/esm/api')
    hasTsx = true
  } catch {
    try {
      const req = createRequire(import.meta.url)
      req.resolve('tsx')
      hasTsx = true
    } catch {
      hasTsx = false
    }
  }
  if (!hasTsx) {
    console.log('安装 tsx 以便加载 TypeScript runner…')
    const { spawnSync } = await import('node:child_process')
    const inst = spawnSync('npm', ['install', '-D', 'tsx', '--no-fund', '--no-audit'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env
    })
    if (inst.status !== 0) {
      console.error(inst.stderr || inst.stdout)
      process.exit(2)
    }
  }

  // 探测 --import tsx
  const probe = await runTsProbe('console.log("__OK__")', 15_000)
  if (!probe.out.includes('__OK__')) {
    console.error('tsx 无法启动:\n', probe.err || probe.out)
    process.exit(2)
  }

  await testCursor()
  await testOpenclaw()

  const failed = results.filter((r) => !r.ok && !r.skip)
  const passed = results.filter((r) => r.ok && !r.skip)
  console.log(`\n== 汇总: ${passed.length} passed, ${failed.length} failed, ${results.filter((r) => r.skip).length} skipped ==`)
  writeFileSync(
    join(REPORT, `cpet-runner-summary.json`),
    JSON.stringify({ passed: passed.length, failed, results }, null, 2)
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
