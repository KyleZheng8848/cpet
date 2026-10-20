#!/usr/bin/env node
/**
 * CPET Agent 引擎自动化冒烟（无需人肉点 UI）。
 *
 * 覆盖：
 * 1) 过程显隐纯逻辑（processBlocks）
 * 2) Cursor 流式去重逻辑（对实测 stream-json 样本 / 现场短跑）
 * 3) 各已安装引擎端到端：发短 prompt → 收集 AgentEvent 等价信号 → 断言
 *
 * 用法：
 *   node scripts/smoke-agents.mjs
 *   node scripts/smoke-agents.mjs --only=cursor,openclaw
 *   node scripts/smoke-agents.mjs --quick   # 跳过慢引擎工具轮
 *
 * 退出码：0 全过；1 有失败；2 无引擎可测
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CWD = ROOT
const REPORT_DIR = join(ROOT, 'release', 'smoke-reports')
const NOW = new Date().toISOString().replace(/[:.]/g, '-')

const args = process.argv.slice(2)
const only = new Set(
  (args.find((a) => a.startsWith('--only='))?.slice('--only='.length) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)
const QUICK = args.includes('--quick')
const TIMEOUT_MS = Number(
  args.find((a) => a.startsWith('--timeout='))?.slice('--timeout='.length) || 120_000
)

/** @typedef {{ name: string, ok: boolean, detail: string, skip?: boolean }} CaseResult */

/** @type {CaseResult[]} */
const results = []

function log(msg) {
  process.stdout.write(`${msg}\n`)
}

function pass(name, detail = '') {
  results.push({ name, ok: true, detail })
  log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name, detail) {
  results.push({ name, ok: false, detail })
  log(`  ✗ ${name} — ${detail}`)
}

function skip(name, detail) {
  results.push({ name, ok: true, detail, skip: true })
  log(`  ○ ${name} — SKIP: ${detail}`)
}

function which(name) {
  const dirs = [
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(process.env.PATH || '').split(':').filter(Boolean)
  ]
  for (const d of dirs) {
    if (!d) continue
    const p = join(d, name)
    if (existsSync(p)) return p
  }
  return null
}

function firstExisting(paths) {
  for (const p of paths) {
    if (typeof p === 'string' && p && existsSync(p)) return p
  }
  return null
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function probePort(port, host = '127.0.0.1', ms = 800) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host })
    const done = (ok) => {
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    sock.setTimeout(ms)
    sock.on('connect', () => done(true))
    sock.on('timeout', () => done(false))
    sock.on('error', () => done(false))
  })
}

/** 跑子进程，按行回调 stdout JSON；超时杀进程。 */
function runCli(bin, cliArgs, { cwd = CWD, timeoutMs = TIMEOUT_MS, env = {} } = {}) {
  return new Promise((resolve) => {
    const lines = []
    let stdoutAll = ''
    let lineBuf = ''
    let stderr = ''
    let settled = false
    const childEnv = { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' }
    delete childEnv.ELECTRON_RUN_AS_NODE
    const child = spawn(bin, cliArgs, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout: stdoutAll, stderr, lines })
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 400)
      finish(null)
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutAll += chunk
      lineBuf += chunk
      const parts = lineBuf.split('\n')
      lineBuf = parts.pop() || ''
      for (const line of parts) {
        const t = line.trim()
        if (!t) continue
        lines.push(t)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c) => {
      stderr += c
    })
    child.on('error', (err) => {
      stderr += String(err.message || err)
      finish(1)
    })
    child.on('close', (code) => {
      if (lineBuf.trim()) lines.push(lineBuf.trim())
      finish(code)
    })
  })
}

// ─── 1) processBlocks 纯逻辑 ───────────────────────────────────────────

function demoteProcessText(blocks) {
  if (!blocks.length) return blocks
  let lastAction = -1
  let lastText = -1
  let textCount = 0
  for (let i = 0; i < blocks.length; i++) {
    const k = blocks[i].kind
    if (k === 'tool' || k === 'command') lastAction = i
    if (k === 'text') {
      lastText = i
      textCount += 1
    }
  }
  if (lastAction < 0) return blocks
  let changed = false
  const next = blocks.map((b, i) => {
    if (b.kind !== 'text') return b
    const beforeAction = i < lastAction
    const notFinalText = textCount > 1 && i !== lastText
    if (beforeAction || notFinalText) {
      changed = true
      return { kind: 'status', text: b.text }
    }
    return b
  })
  return changed ? next : blocks
}

function blocksForDisplay(blocks, showDetails) {
  const base = blocks.filter((b) => b.kind !== 'sticker')
  if (showDetails) return base
  return base.filter((b) => b.kind === 'text' || b.kind === 'attachment')
}

function testProcessBlocks() {
  log('\n## 1) 过程显隐逻辑 (processBlocks)')
  const blocks = [
    { kind: 'text', text: '先看看文件' },
    { kind: 'tool', id: '1', name: 'read', status: 'done' },
    { kind: 'text', text: '内容是 foo' }
  ]
  const demoted = demoteProcessText(blocks)
  if (demoted[0].kind === 'status' && demoted[2].kind === 'text') {
    pass('demote：工具前旁白降为 status，保留最终正文')
  } else {
    fail('demote：工具前旁白降为 status，保留最终正文', JSON.stringify(demoted))
  }

  const shown = blocksForDisplay(demoted, true)
  const hidden = blocksForDisplay(demoted, false)
  if (shown.some((b) => b.kind === 'tool') && shown.some((b) => b.kind === 'status')) {
    pass('showDetails=true：工具+过程可见')
  } else {
    fail('showDetails=true：工具+过程可见', JSON.stringify(shown.map((b) => b.kind)))
  }
  if (
    !hidden.some((b) => b.kind === 'tool' || b.kind === 'status' || b.kind === 'reasoning') &&
    hidden.some((b) => b.kind === 'text' && b.text.includes('foo'))
  ) {
    pass('showDetails=false：藏工具/过程，正文仍在')
  } else {
    fail('showDetails=false：藏工具/过程，正文仍在', JSON.stringify(hidden))
  }

  // 展示路径不 demote：关过程时若误 demote 会掏空气泡
  const midStream = [
    { kind: 'text', text: '旁白' },
    { kind: 'tool', id: 't', name: 'read', status: 'running' }
  ]
  const displayMid = blocksForDisplay(midStream, false)
  if (displayMid.some((b) => b.kind === 'text')) {
    pass('流式中关过程：仍保留 text（不掏空）')
  } else {
    fail('流式中关过程：仍保留 text（不掏空）', JSON.stringify(displayMid))
  }
}

// ─── 2) Cursor 流式去重（对齐现行 emitAssistantText） ─────────────────

function emitAssistantSim(events) {
  let last = ''
  const pieces = []
  let droppedBad = 0
  for (const ev of events) {
    if (ev.type !== 'assistant') continue
    const isStream =
      (ev.model_call_id == null || ev.partial === true) &&
      (ev.timestamp_ms != null ||
        ev.partial === true ||
        ev.subtype === 'delta' ||
        ev.subtype === 'partial')
    if (!isStream) continue
    const content = ev.message?.content
    let raw = ''
    if (Array.isArray(content)) {
      raw = content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('')
    }
    // delta 模式：不 trim
    const cleaned = String(raw).replace(/\r/g, '')
    if (!cleaned || cleaned === last) continue
    if (last && cleaned.startsWith(last)) {
      const piece = cleaned.slice(last.length)
      if (!piece) continue
      last = cleaned
      pieces.push(piece)
    } else if (last && last.startsWith(cleaned)) {
      continue
    } else {
      // 旧 bug：>=80 非前缀直接丢 — 这里必须追加
      if (last && cleaned.length >= 80 && !cleaned.startsWith(last)) {
        // 新逻辑：当 delta 仍追加；仅 snapshot 才丢。样本里都是 delta。
      }
      pieces.push(cleaned)
      last += cleaned
    }
  }
  return { text: pieces.join(''), pieces, droppedBad }
}

function testCursorStreamLogic() {
  log('\n## 2) Cursor 流式去重逻辑')
  // 构造：逐字 delta + 结尾无 timestamp 整包
  const events = []
  const full = '春风轻拂，柳梢发芽。'
  let ts = 1
  for (const ch of full) {
    events.push({
      type: 'assistant',
      timestamp_ms: ts++,
      message: { content: [{ type: 'text', text: ch }] }
    })
  }
  events.push({
    type: 'assistant',
    message: { content: [{ type: 'text', text: full }] }
  })
  const sim = emitAssistantSim(events)
  if (sim.text === full && sim.pieces.length >= full.length) {
    pass('逐字 delta 拼出全文，终态整包被跳过', `${sim.pieces.length} pieces`)
  } else {
    fail('逐字 delta 拼出全文，终态整包被跳过', `got=${JSON.stringify(sim.text)}`)
  }

  // 回归：>=80 非前缀累计块在 delta 模式不得吞掉后续小片
  const big = 'x'.repeat(100)
  const mixed = [
    {
      type: 'assistant',
      timestamp_ms: 1,
      message: { content: [{ type: 'text', text: 'ab' }] }
    },
    {
      type: 'assistant',
      timestamp_ms: 2,
      message: { content: [{ type: 'text', text: big }] }
    },
    {
      type: 'assistant',
      timestamp_ms: 3,
      message: { content: [{ type: 'text', text: 'c' }] }
    }
  ]
  const sim2 = emitAssistantSim(mixed)
  if (sim2.text.includes('ab') && sim2.text.includes('c') && sim2.text.includes(big)) {
    pass('大块非前缀 delta 不被 >=80 逻辑吞掉')
  } else {
    fail('大块非前缀 delta 不被 >=80 逻辑吞掉', sim2.text.slice(0, 80))
  }
}

// ─── 3) 引擎探测 + E2E ────────────────────────────────────────────────

function resolveCursor() {
  return firstExisting([
    join(homedir(), '.local', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
    which('cursor-agent')
  ])
}

function resolveOpenclaw() {
  return firstExisting([
    join(homedir(), '.local', 'bin', 'openclaw'),
    '/Applications/ClawX.app/Contents/Resources/cli/openclaw',
    which('openclaw')
  ])
}

function resolveClaude() {
  return firstExisting([
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    which('claude')
  ])
}

function resolveCodex() {
  return firstExisting([
    join(homedir(), '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    join(homedir(), 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
    which('codex')
  ])
}

function parseJsonLines(lines) {
  const objs = []
  for (const line of lines) {
    if (!line.startsWith('{')) continue
    try {
      objs.push(JSON.parse(line))
    } catch {
      /* ignore */
    }
  }
  return objs
}

function extractAssistantText(objs) {
  let text = ''
  let deltas = 0
  for (const o of objs) {
    if (o.type === 'assistant') {
      const content = o.message?.content
      let piece = ''
      if (Array.isArray(content)) {
        piece = content.map((c) => c?.text || '').join('')
      } else if (typeof o.text === 'string') piece = o.text
      if (piece) {
        if (o.timestamp_ms != null && o.model_call_id == null) {
          text += piece
          deltas += 1
        } else if (!text) {
          text = piece
        }
      }
    }
    if (o.type === 'result' && typeof o.result === 'string' && !text) text = o.result
    if (o.type === 'content' && typeof o.content === 'string') {
      text += o.content
      deltas += 1
    }
    // claude stream-json content_block_delta
    if (o.type === 'stream_event' || o.event === 'content_block_delta') {
      const d = o.delta?.text || o.event?.delta?.text
      if (typeof d === 'string' && d) {
        text += d
        deltas += 1
      }
    }
    if (o.type === 'item.completed' || o.type === 'agent_message') {
      const t = o.item?.text || o.text
      if (typeof t === 'string' && t) text = text || t
    }
  }
  return { text, deltas }
}

async function testCursorE2E(bin) {
  log('\n## 3a) Cursor Agent E2E')
  if (only.size && !only.has('cursor')) return skip('cursor', '--only 过滤')

  // 短答：必须有 result / assistant
  const short = await runCli(
    bin,
    [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--workspace',
      CWD,
      '--force',
      '--trust',
      '--model',
      'auto',
      '只回复两个字：你好。不要用工具。'
    ],
    { timeoutMs: Math.min(TIMEOUT_MS, 60_000) }
  )
  const objs = parseJsonLines(short.lines)
  const { text, deltas } = extractAssistantText(objs)
  const types = objs.map((o) => o.type)
  writeDebug('cursor-short.json', { types, text, deltas, stderr: short.stderr.slice(0, 500) })

  if (!objs.length) {
    fail('cursor 短答有 JSON 事件', short.stderr.slice(0, 200) || 'stdout 空')
    return
  }
  pass('cursor 短答有 JSON 事件', `${objs.length} lines`)

  if (/你好|您好/.test(text) || text.trim().length > 0) {
    pass('cursor 短答有可见正文', text.slice(0, 40))
  } else {
    fail('cursor 短答有可见正文', `text=${JSON.stringify(text)} types=${types.join(',')}`)
  }

  if (types.includes('result') || types.includes('assistant')) {
    pass('cursor 有 assistant/result 收尾')
  } else {
    fail('cursor 有 assistant/result 收尾', types.join(','))
  }

  // 流式：稍长一点，要求多个带 timestamp 的 assistant delta
  if (QUICK) {
    skip('cursor 长答流式 delta≥5', '--quick')
    return
  }
  const long = await runCli(
    bin,
    [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--workspace',
      CWD,
      '--force',
      '--trust',
      '--model',
      'auto',
      '用中文写约80字春天描写，不要用工具，不要列表。'
    ],
    { timeoutMs: Math.min(TIMEOUT_MS, 75_000) }
  )
  const lobjs = parseJsonLines(long.lines)
  const streamDeltas = lobjs.filter(
    (o) => o.type === 'assistant' && o.timestamp_ms != null && o.model_call_id == null
  )
  writeDebug('cursor-long.json', {
    deltaCount: streamDeltas.length,
    types: lobjs.map((o) => o.type)
  })
  if (streamDeltas.length >= 5) {
    pass('cursor 长答流式 delta≥5', `${streamDeltas.length} deltas`)
  } else {
    fail('cursor 长答流式 delta≥5', `only ${streamDeltas.length}`)
  }

  // 工具轮：读 package.json name
  const tool = await runCli(
    bin,
    [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--workspace',
      CWD,
      '--force',
      '--trust',
      '--model',
      'auto',
      '用工具读取 package.json 里的 name 字段，只回答那个字符串。'
    ],
    { timeoutMs: Math.min(TIMEOUT_MS, 90_000) }
  )
  const tobjs = parseJsonLines(tool.lines)
  const hasTool = tobjs.some((o) => o.type === 'tool_call')
  const ttext = extractAssistantText(tobjs).text
  writeDebug('cursor-tool.json', {
    hasTool,
    types: [...new Set(tobjs.map((o) => o.type))],
    text: ttext.slice(0, 200)
  })
  if (hasTool) pass('cursor 工具轮发出 tool_call')
  else fail('cursor 工具轮发出 tool_call', `types=${[...new Set(tobjs.map((o) => o.type))]}`)
  if (/cursor-pet/.test(ttext)) pass('cursor 工具轮读到 name=cursor-pet')
  else fail('cursor 工具轮读到 name=cursor-pet', ttext.slice(0, 120))
}

function openclawSessionIndex(agentId) {
  return join(homedir(), '.openclaw', 'agents', agentId, 'sessions', 'sessions.json')
}

function resolveOcTranscript(agentId, cliSessionId) {
  const key = `agent:${agentId}:explicit:${cliSessionId}`
  try {
    const raw = JSON.parse(readFileSync(openclawSessionIndex(agentId), 'utf8'))
    const entry = raw[key]
    if (!entry) return null
    if (entry.sessionFile && existsSync(entry.sessionFile)) return entry.sessionFile
    if (entry.sessionId) {
      const p = join(
        homedir(),
        '.openclaw',
        'agents',
        agentId,
        'sessions',
        `${entry.sessionId}.jsonl`
      )
      if (existsSync(p)) return p
    }
  } catch {
    /* ignore */
  }
  return null
}

function scanTranscriptProcess(path, afterUser = true) {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim())
  let lastUser = -1
  const parsed = []
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      parsed.push(o)
      if (o?.type === 'message' && o?.message?.role === 'user') lastUser = parsed.length - 1
    } catch {
      parsed.push(null)
    }
  }
  const start = afterUser && lastUser >= 0 ? lastUser + 1 : 0
  let tools = 0
  let thinking = 0
  for (let i = start; i < parsed.length; i++) {
    const o = parsed[i]
    if (!o || o.type !== 'message') continue
    const msg = o.message
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const p of msg.content) {
        if (p?.type === 'thinking') thinking += 1
        if (p?.type === 'toolCall') tools += 1
      }
    }
    if (msg.role === 'toolResult') tools += 1
  }
  return { tools, thinking, sessionLines: lines.length }
}

async function testOpenclawE2E(bin) {
  log('\n## 3b) OpenClaw E2E')
  if (only.size && !only.has('openclaw')) return skip('openclaw', '--only 过滤')

  const gwOk = await probePort(18789)
  if (!gwOk) {
    // try read config port
    let port = 18789
    try {
      const cfg = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
      if (typeof cfg?.gateway?.port === 'number') port = cfg.gateway.port
    } catch {
      /* ignore */
    }
    const ok2 = await probePort(port)
    if (!ok2) {
      fail('openclaw Gateway 可连通', `port ${port} 无响应`)
      return
    }
  }
  pass('openclaw Gateway 可连通')

  const sid = `cursor-pet-smoke-${Date.now().toString(36)}`
  const short = await runCli(
    bin,
    [
      'agent',
      '--agent',
      'main',
      '--session-id',
      sid,
      '--message',
      '只回复：pong，不要用工具。',
      '--json',
      '--timeout',
      '60'
    ],
    {
      cwd: join(homedir(), '.openclaw', 'workspace'),
      timeoutMs: Math.min(TIMEOUT_MS, 75_000),
      env: { ELECTRON_RUN_AS_NODE: '' }
    }
  )
  const jsonStart = short.stdout.indexOf('{')
  let parsed = null
  if (jsonStart >= 0) {
    try {
      parsed = JSON.parse(short.stdout.slice(jsonStart))
    } catch {
      /* ignore */
    }
  }
  // 有时 JSON 在 lines 拼起来的 stdout 缓冲里——runCli 最后把残留拼进 lines
  if (!parsed) {
    const blob = short.lines.filter((l) => l.includes('{')).join('\n')
    const i = blob.indexOf('{')
    if (i >= 0) {
      try {
        parsed = JSON.parse(blob.slice(i))
      } catch {
        /* ignore */
      }
    }
  }
  writeDebug('openclaw-short.json', {
    code: short.code,
    parsedStatus: parsed?.status,
    stderr: short.stderr.slice(0, 600),
    stdoutHead: short.stdout.slice(0, 400)
  })

  const reply =
    parsed?.result?.payloads?.[0]?.text ||
    parsed?.payloads?.[0]?.text ||
    parsed?.result?.meta?.finalAssistantVisibleText ||
    ''
  if (parsed && (parsed.status === 'ok' || reply)) {
    pass('openclaw --json 返回 ok/正文', String(reply).slice(0, 40))
  } else {
    fail(
      'openclaw --json 返回 ok/正文',
      `code=${short.code} err=${short.stderr.slice(0, 180)} out=${short.stdout.slice(0, 120)}`
    )
  }
  if (/pong/i.test(String(reply))) pass('openclaw 短答含 pong')
  else if (reply) pass('openclaw 短答有正文（非严格 pong）', String(reply).slice(0, 40))
  else fail('openclaw 短答含 pong', 'empty')

  // 工具轮 + transcript 过程事件（CPET 依赖 sessions.jsonl）
  if (QUICK) {
    skip('openclaw 工具轮 transcript', '--quick')
    return
  }
  const sid2 = `cursor-pet-smoke-tool-${Date.now().toString(36)}`
  const toolRun = await runCli(
    bin,
    [
      'agent',
      '--agent',
      'main',
      '--session-id',
      sid2,
      '--message',
      `用 read 工具读取 ${join(ROOT, 'package.json')} 的 name 字段，只回答那个字符串。`,
      '--json',
      '--timeout',
      '90'
    ],
    {
      cwd: join(homedir(), '.openclaw', 'workspace'),
      timeoutMs: Math.min(TIMEOUT_MS, 100_000)
    }
  )
  // 等 index 落盘
  let transcript = null
  for (let i = 0; i < 20; i++) {
    transcript = resolveOcTranscript('main', sid2)
    if (transcript) break
    await sleep(250)
  }
  writeDebug('openclaw-tool.json', {
    code: toolRun.code,
    transcript,
    stderr: toolRun.stderr.slice(0, 400),
    stdoutHead: toolRun.stdout.slice(0, 500)
  })
  if (!transcript) {
    fail('openclaw 工具轮可解析 transcript 路径', 'sessions.json 无映射')
    return
  }
  pass('openclaw 工具轮可解析 transcript 路径', transcript.split('/').pop())
  const proc = scanTranscriptProcess(transcript)
  if (proc.tools > 0) {
    pass('openclaw transcript 含 toolCall/toolResult', `${proc.tools} tool events`)
  } else {
    fail('openclaw transcript 含 toolCall/toolResult', `tools=${proc.tools} thinking=${proc.thinking}`)
  }
  // 模拟 CPET settle 前应能 emit 过程
  if (proc.tools > 0 || proc.thinking > 0) {
    pass('openclaw 过程事件源非空（可供「过程」开关显隐）')
  } else {
    fail('openclaw 过程事件源非空（可供「过程」开关显隐）', 'empty process')
  }
}

async function testNativeClaude(bin) {
  log('\n## 3c) Claude Code 原生 E2E')
  if (only.size && !only.has('claude-code')) return skip('claude-code', '--only 过滤')
  const run = await runCli(
    bin,
    [
      '-p',
      '只回复两个字：你好。不要用工具。',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits'
    ],
    { cwd: CWD, timeoutMs: Math.min(TIMEOUT_MS, 90_000) }
  )
  const objs = parseJsonLines(run.lines)
  writeDebug('claude-native.json', {
    code: run.code,
    n: objs.length,
    stderr: run.stderr.slice(0, 300)
  })
  if (objs.length) pass('claude 原生有 stream-json 事件', `${objs.length}`)
  else fail('claude 原生有 stream-json 事件', run.stderr.slice(0, 160) || 'empty')
}

async function testNativeCodex(bin) {
  log('\n## 3d) Codex 原生 E2E')
  if (only.size && !only.has('codex')) return skip('codex', '--only 过滤')
  // 与 CPET CodexRunner 生产 argv 对齐：--ask-for-approval 必须在 exec 前
  const run = await runCli(
    bin,
    [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '只回复两个字：你好。不要用工具。'
    ],
    { cwd: CWD, timeoutMs: Math.min(TIMEOUT_MS, 90_000) }
  )
  const objs = parseJsonLines(run.lines)
  writeDebug('codex-native.json', {
    code: run.code,
    n: objs.length,
    stderr: run.stderr.slice(0, 300)
  })
  if (objs.length || /你好/.test(run.stdout)) pass('codex 原生有输出')
  else fail('codex 原生有输出', run.stderr.slice(0, 160) || 'empty')
}

function writeDebug(name, data) {
  try {
    mkdirSync(REPORT_DIR, { recursive: true })
    writeFileSync(join(REPORT_DIR, `${NOW}-${name}`), JSON.stringify(data, null, 2))
  } catch {
    /* ignore */
  }
}

async function testOpenclawTranscriptParserAsync() {
  log('\n## 2b) OpenClaw transcript 解析（本机历史会话）')
  const sessionsDir = join(homedir(), '.openclaw', 'agents', 'main', 'sessions')
  if (!existsSync(sessionsDir)) {
    skip('openclaw transcript 样本', '无 sessions 目录')
    return
  }
  const { readdirSync } = await import('node:fs')
  let hit = null
  try {
    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl') && !f.includes('trajectory'))
      .map((f) => join(sessionsDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      .slice(0, 60)
    for (const f of files) {
      const head = readFileSync(f, 'utf8').slice(0, 400_000)
      // 必须是 content block type，避免 skills 文案里的 toolCall 字样误匹配
      if (/"type"\s*:\s*"toolCall"/.test(head)) {
        hit = f
        break
      }
    }
  } catch (e) {
    fail('扫描 sessions', String(e))
    return
  }
  if (!hit) {
    skip('openclaw transcript 含 toolCall 样本', '最近会话无工具')
    return
  }
  // 历史样本：全文件扫描（最后一轮 user 可能只是闲聊无工具）
  const proc = scanTranscriptProcess(hit, false)
  if (proc.tools > 0) {
    pass('历史 transcript 能扫出工具事件', `${proc.tools} @ ${hit.split('/').pop()}`)
  } else {
    fail('历史 transcript 能扫出工具事件', hit)
  }
}

async function main() {
  log(`CPET Agent 冒烟 ${NOW}`)
  log(`cwd=${CWD} timeout=${TIMEOUT_MS}ms quick=${QUICK}`)
  mkdirSync(REPORT_DIR, { recursive: true })

  testProcessBlocks()
  testCursorStreamLogic()
  await testOpenclawTranscriptParserAsync()

  const cursor = resolveCursor()
  const openclaw = resolveOpenclaw()
  const claude = resolveClaude()
  const codex = resolveCodex()

  log('\n## 引擎探测')
  log(`  cursor-agent: ${cursor || 'MISSING'}`)
  log(`  openclaw:     ${openclaw || 'MISSING'}`)
  log(`  claude:       ${claude || 'MISSING'}`)
  log(`  codex:        ${codex || 'MISSING'}`)

  let ran = 0
  if (cursor) {
    ran++
    await testCursorE2E(cursor)
  } else if (!only.size || only.has('cursor')) {
    fail('cursor 已安装', '未找到 cursor-agent')
  }

  if (openclaw) {
    ran++
    await testOpenclawE2E(openclaw)
  } else if (!only.size || only.has('openclaw')) {
    fail('openclaw 已安装', '未找到 openclaw')
  }

  if (claude) {
    ran++
    await testNativeClaude(claude)
  } else if (!only.size || only.has('claude-code')) {
    skip('claude-code', '无 claude')
  }


  if (codex) {
    ran++
    await testNativeCodex(codex)
  } else if (!only.size || only.has('codex')) {
    skip('codex', '无 codex')
  }


  // 汇总
  const failed = results.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skip)
  const passed = results.filter((r) => r.ok && !r.skip)
  log('\n## 汇总')
  log(`  pass=${passed.length} fail=${failed.length} skip=${skipped.length} enginesTouched=${ran}`)
  if (failed.length) {
    log('\n失败项：')
    for (const f of failed) log(`  - ${f.name}: ${f.detail}`)
  }

  const summary = {
    at: NOW,
    pass: passed.length,
    fail: failed.length,
    skip: skipped.length,
    results
  }
  const summaryPath = join(REPORT_DIR, `${NOW}-summary.json`)
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  log(`\n报告: ${summaryPath}`)

  if (ran === 0) process.exit(2)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
