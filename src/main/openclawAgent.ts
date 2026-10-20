import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { Socket } from 'node:net'
import type { Readable } from 'node:stream'
import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentEvent, SendPromptPayload } from '../shared/types'
import { BaseAgentRunner, RunContext, resolveRunIdentity, extractRunUsage } from './agent'
import { appendBounded } from './agent/lineStream'
import {
  OpenclawTranscriptReader,
  tryParseJsonResult
} from './agent/parse/openclawTranscript'
import { applySkillsForEngine } from './skills'
import { wrapPromptWithSystem } from '../shared/prompts'
import { parseModelRef } from '../shared/models'
import { getSettings } from './store'
import { buildAgentEnvAsync, whichBin } from './cliPath'

const execFileAsync = promisify(execFile)

/**
 * OpenClaw CLI 封装：通过 `openclaw agent --json` 跑一轮，
 * 把一次性 JSON 回复映射成与 cursor-agent 相同的 AgentEvent 流。
 */

const CANDIDATE_PATHS = [
  // 优先用户 PATH 常见安装；ClawX 捆绑 CLI 作回退
  join(homedir(), '.local', 'bin', 'openclaw'),
  join(homedir(), '.npm-global', 'bin', 'openclaw'),
  '/usr/local/bin/openclaw',
  '/opt/homebrew/bin/openclaw',
  // ClawX 实际 CLI 在 Resources/cli（bin/ 里只有 uv，没有 openclaw）
  '/Applications/ClawX.app/Contents/Resources/cli/openclaw'
]

const AGENTS_DIR = join(homedir(), '.openclaw', 'agents')
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
/** 宠物侧硬超时：避免 CLI/Gateway 挂死时聊天一直转圈。 */
const HARD_TIMEOUT_MS = 10 * 60_000
/** bin + gateway 探测缓存：避免对比/连发时每次都 resolve + TCP */
const RUNTIME_TTL_MS = 30_000
let runtimeCache: {
  at: number
  bin?: string
  probe?: { ok: boolean; detail: string }
} | null = null

type Emit = (event: AgentEvent) => void

interface ActiveRun {
  ctx: RunContext
  agentId: string
  /** CLI `--session-id`（如 cursor-pet-…），用于查 sessions.json */
  cliSessionId: string
  child: ChildProcessByStdio<null, Readable, Readable> | null
  stdout: string
  stderr: string
  watchdog: NodeJS.Timeout | null
  /** 轮询 Gateway 写入的 session jsonl，把 tool/thinking 映射成过程事件 */
  transcriptTimer: NodeJS.Timeout | null
  transcriptPath: string | null
  transcriptPos: number
  transcript: OpenclawTranscriptReader
  cleanup?: () => void
}

function resolveBinPath(): string | undefined {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p
  }
  return undefined
}

type OpenClawConfig = {
  gateway?: {
    auth?: { mode?: string; token?: string }
    remote?: { token?: string; url?: string }
    [key: string]: unknown
  }
  [key: string]: unknown
}

function readOpenclawConfig(): OpenClawConfig | null {
  try {
    return JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf8')) as OpenClawConfig
  } catch {
    return null
  }
}

/** 从本机 openclaw.json 读取 gateway token（不落日志）。 */
function readGatewayToken(): string | undefined {
  const raw = readOpenclawConfig()
  const t = raw?.gateway?.auth?.token
  return typeof t === 'string' && t.trim() ? t.trim() : undefined
}

/**
 * CLI 连 Gateway 时可能读 gateway.remote.token；若缺失/不一致会导致 401。
 * 仅在需要时把 remote.token 同步成 auth.token（不改其它字段）。
 */
function ensureRemoteTokenSynced(authToken: string): void {
  try {
    const raw = readOpenclawConfig()
    if (!raw?.gateway) return
    const remoteToken = raw.gateway.remote?.token
    if (typeof remoteToken === 'string' && remoteToken.trim() === authToken) return
    raw.gateway.remote = { ...(raw.gateway.remote || {}), token: authToken }
    writeFileSync(OPENCLAW_CONFIG, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  } catch {
    // 写配置失败不阻断；仍靠环境变量尝试鉴权
  }
}

/** Electron 子进程必须清掉 ELECTRON_RUN_AS_NODE，否则 openclaw 会异常挂起。 */
async function buildSpawnEnv(): Promise<NodeJS.ProcessEnv> {
  const env = await buildAgentEnvAsync()
  // 父进程可能带了过期/错误的 token，一律以配置文件为准，避免鉴权失败
  delete env.OPENCLAW_GATEWAY_TOKEN
  delete env.OPENCLAW_GATEWAY_PASSWORD
  const token = readGatewayToken()
  if (token) {
    ensureRemoteTokenSynced(token)
    env.OPENCLAW_GATEWAY_TOKEN = token
  }
  return env
}

function looksLikeAuthError(text: string): boolean {
  // 避免误伤请求 ID / 时间戳里偶然出现的 "401"（如 1784010...）
  return /(?:\bHTTP\/?\s*401\b|\bstatus[:\s]+401\b|\berror[:\s]+401\b|\bgot\s+401\b|\bunauthorized\b|token\s*mismatch|token\s*missing|missing gateway auth|device token mismatch)/i.test(
    text
  )
}

function formatOpenclawFailure(stderr: string, stdout: string, code: number | null): string {
  const detail = (stderr || stdout || `openclaw 退出码 ${code ?? '?'}`).trim()
  if (looksLikeAuthError(detail)) {
    return [
      'OpenClaw Gateway 鉴权失败（401）。',
      '',
      '已尝试用 `~/.openclaw/openclaw.json` 里的 gateway.auth.token 连接。',
      '请确认 ClawX / Gateway 正在运行，且 token 与配置一致：',
      '',
      '```bash',
      'openclaw gateway status',
      'openclaw config get gateway.auth.token',
      '```',
      '',
      '若仍失败，可在 ClawX 里重新登录/重启 Gateway，或暂时切回 Cursor 引擎。',
      '',
      detail.slice(0, 800)
    ].join('\n')
  }
  return `${detail}\n\n若 Gateway 未运行，请打开 ClawX 或执行 \`openclaw gateway\`。`
}

async function resolveFromPath(): Promise<string | undefined> {
  return whichBin('openclaw')
}

export function listOpenclawAgents(): string[] {
  try {
    if (!existsSync(AGENTS_DIR)) return ['main']
    const names = readdirSync(AGENTS_DIR)
      .filter((name) => {
        try {
          return statSync(join(AGENTS_DIR, name)).isDirectory()
        } catch {
          return false
        }
      })
      .sort((a, b) => a.localeCompare(b))
    return names.length ? names : ['main']
  } catch {
    return ['main']
  }
}

export async function resolveOpenclawBin(): Promise<string | undefined> {
  return resolveBinPath() ?? (await resolveFromPath())
}

export async function getOpenclawMeta(opts?: {
  includeVersion?: boolean
  probeGateway?: boolean
}): Promise<{
  installed: boolean
  binPath?: string
  version?: string
  agents: string[]
  gatewayOk?: boolean
  gatewayDetail?: string
}> {
  const binPath = await resolveOpenclawBin()
  const agents = listOpenclawAgents()
  if (!binPath) return { installed: false, agents }
  let version: string | undefined
  // --version 本机可 >10s；探测默认跳过
  if (opts?.includeVersion) {
    try {
      const { stdout } = await execFileAsync(binPath, ['--version'], {
        timeout: 2500,
        env: await buildSpawnEnv()
      })
      version = stdout.trim().split(/\r?\n/).find(Boolean)?.trim()
    } catch {
      // ignore
    }
  }
  let gatewayOk: boolean | undefined
  let gatewayDetail: string | undefined
  if (opts?.probeGateway) {
    const probe = await probeGatewayPort(true)
    gatewayOk = probe.ok
    gatewayDetail = probe.detail
  }
  return { installed: true, binPath, version, agents, gatewayOk, gatewayDetail }
}

/** 从 payloads 数组拼出可见文本（兼容 {text} / Anthropic content blocks）。 */
function textFromPayloads(payloads: unknown): string {
  if (!Array.isArray(payloads)) return ''
  return payloads
    .map((p) => {
      if (typeof p === 'string') return p
      if (!p || typeof p !== 'object') return ''
      const obj = p as { text?: unknown; type?: string; content?: unknown }
      if (typeof obj.text === 'string') return obj.text
      // Anthropic：payload 本身是 content block，或嵌套 content[]
      if (Array.isArray(obj.content)) {
        return obj.content
          .map((c) => {
            if (typeof c === 'string') return c
            if (!c || typeof c !== 'object') return ''
            const t = (c as { text?: unknown }).text
            return typeof t === 'string' ? t : ''
          })
          .filter(Boolean)
          .join('')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

/** Anthropic Messages：content: [{ type:'text', text }] */
function textFromAnthropicContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = part as { type?: string; text?: unknown }
      if (typeof p.text === 'string' && (!p.type || p.type === 'text')) return p.text
      return ''
    })
    .filter(Boolean)
    .join('')
    .trim()
}

/**
 * OpenClaw `--json` 现行结构为 `{ result: { payloads, meta } }`；
 * 旧版可能把 payloads/meta 放在顶层；亦兼容 Anthropic content 数组。
 */
function extractReplyText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  const nested =
    obj.result && typeof obj.result === 'object'
      ? (obj.result as Record<string, unknown>)
      : null

  const fromPayloads =
    textFromPayloads(obj.payloads) || (nested ? textFromPayloads(nested.payloads) : '')
  if (fromPayloads) return fromPayloads

  const fromContent =
    textFromAnthropicContent(obj.content) ||
    (nested ? textFromAnthropicContent(nested.content) : '')
  if (fromContent) return fromContent

  if (typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim()
  if (nested && typeof nested.text === 'string' && nested.text.trim()) {
    return nested.text.trim()
  }
  if (typeof obj.result === 'string') return obj.result.trim()
  return ''
}

function sessionFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const m = meta as { agentMeta?: { sessionId?: string }; sessionId?: string }
  const sid = m.agentMeta?.sessionId ?? m.sessionId
  return typeof sid === 'string' && sid.trim() ? sid.trim() : undefined
}

function extractSessionId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const top = sessionFromMeta(obj.meta)
  if (top) return top
  if (obj.result && typeof obj.result === 'object') {
    return sessionFromMeta((obj.result as { meta?: unknown }).meta)
  }
  return undefined
}

function isCompleteOkResult(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const obj = parsed as { status?: string; summary?: string }
  if (obj.status === 'ok' || obj.summary === 'completed') return true
  return Boolean(extractReplyText(parsed))
}

function isCompleteErrorResult(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const obj = parsed as { status?: string; error?: unknown; ok?: boolean }
  if (obj.status === 'error' || obj.ok === false) return true
  return false
}

function sessionIndexPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'sessions', 'sessions.json')
}

/** 由 CLI session-id 解析 Gateway 实际 transcript 路径。 */
function resolveTranscriptPath(agentId: string, cliSessionId: string): string | null {
  const key = `agent:${agentId}:explicit:${cliSessionId}`
  try {
    const raw = JSON.parse(readFileSync(sessionIndexPath(agentId), 'utf8')) as Record<
      string,
      { sessionId?: string; sessionFile?: string }
    >
    const entry = raw[key]
    if (!entry) return null
    if (typeof entry.sessionFile === 'string' && entry.sessionFile && existsSync(entry.sessionFile)) {
      return entry.sessionFile
    }
    if (typeof entry.sessionId === 'string' && entry.sessionId.trim()) {
      const p = join(AGENTS_DIR, agentId, 'sessions', `${entry.sessionId.trim()}.jsonl`)
      if (existsSync(p)) return p
    }
  } catch {
    // ignore
  }
  return null
}

/** 快速探测 Gateway 是否在听（失败不抛，供预检）。 */
async function probeGatewayPort(force = false): Promise<{ ok: boolean; detail: string }> {
  if (
    !force &&
    runtimeCache?.probe &&
    Date.now() - runtimeCache.at < RUNTIME_TTL_MS
  ) {
    return runtimeCache.probe
  }
  const raw = readOpenclawConfig()
  const portRaw = raw?.gateway ? (raw.gateway as { port?: unknown }).port : undefined
  const port = typeof portRaw === 'number' && portRaw > 0 ? portRaw : 18789
  const probe = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const sock = new Socket()
    const done = (ok: boolean, detail: string): void => {
      try {
        sock.destroy()
      } catch {
        // ignore
      }
      resolve({ ok, detail })
    }
    sock.setTimeout(800)
    sock.once('connect', () => done(true, `127.0.0.1:${port}`))
    sock.once('timeout', () => done(false, `连接 127.0.0.1:${port} 超时`))
    sock.once('error', (err) => done(false, err.message || String(err)))
    try {
      sock.connect(port, '127.0.0.1')
    } catch (err) {
      done(false, err instanceof Error ? err.message : String(err))
    }
  })
  runtimeCache = {
    at: Date.now(),
    bin: runtimeCache?.bin,
    probe
  }
  return probe
}

export class OpenClawRunner extends BaseAgentRunner<ActiveRun> {
  private killPid(pid: number, sig: NodeJS.Signals): void {
    try {
      process.kill(-pid, sig)
    } catch {
      // ignore
    }
    try {
      process.kill(pid, sig)
    } catch {
      // ignore
    }
  }

  private startTranscriptWatch(run: ActiveRun): void {
    if (run.transcriptTimer) return
    // 立刻扫一次，再定时；Gateway 写 jsonl 与 CLI JSON 收尾异步
    this.pollTranscript(run)
    run.transcriptTimer = setInterval(() => this.pollTranscript(run), 350)
  }

  private pollTranscript(run: ActiveRun): void {
    if (run.ctx.settled || run.ctx.aborting) return
    if (!run.transcriptPath) {
      run.transcriptPath = resolveTranscriptPath(run.agentId, run.cliSessionId)
      if (!run.transcriptPath) return
      run.transcriptPos = 0
      run.transcript.reset()
    }
    const chunk = this.readTranscriptDelta(run)
    // 传 Buffer 而非 toString：读取边界随时会落在一个中文字中间，
    // 逐段 toString('utf8') 会把它变成 U+FFFD，正文糊掉且按长度累计的偏移全错位。
    if (chunk?.length) run.transcript.consume(chunk, run.ctx)
  }

  /** 从上次偏移读到当前文件末尾；文件被截断则重头再来。 */
  private readTranscriptDelta(run: ActiveRun): Buffer | null {
    if (!run.transcriptPath) return null
    try {
      const st = statSync(run.transcriptPath)
      if (st.size < run.transcriptPos) {
        run.transcriptPos = 0
        run.transcript.reset()
      }
      if (st.size === run.transcriptPos) return null
      const fd = openSync(run.transcriptPath, 'r')
      try {
        const need = st.size - run.transcriptPos
        const buf = Buffer.alloc(need)
        const read = readSync(fd, buf, 0, need, run.transcriptPos)
        run.transcriptPos += read
        return read === need ? buf : buf.subarray(0, read)
      } finally {
        closeSync(fd)
      }
    } catch {
      return null
    }
  }

  /** 安静杀掉仍挂着的 CLI（OpenClaw 写完 JSON 后经常不退）。 */
  private stopChild(run: ActiveRun): void {
    const pid = run.child?.pid
    if (pid == null) return
    this.killPid(pid, 'SIGTERM')
    setTimeout(() => this.killPid(pid, 'SIGKILL'), 350)
    try {
      run.child?.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  /** 从已解析 JSON 结算成功/失败；返回是否已结算。 */
  private settleFromParsed(run: ActiveRun, runKey: string, parsed: unknown): boolean {
    if (run.ctx.settled || run.ctx.aborting) return run.ctx.settled

    if (isCompleteErrorResult(parsed) && !extractReplyText(parsed)) {
      const detail =
        typeof (parsed as { error?: unknown }).error === 'string'
          ? String((parsed as { error: string }).error)
          : JSON.stringify(parsed).slice(0, 800)
      run.ctx.error(formatOpenclawFailure(run.stderr, detail, null))
      this.stopChild(run)
      this.drop(runKey)
      return true
    }

    if (!isCompleteOkResult(parsed)) return false

    const text = extractReplyText(parsed)
    // 结算前再扫一遍 transcript，补齐工具/思考（过程开关才有内容）
    this.pollTranscript(run)

    const sid = extractSessionId(parsed)
    if (sid) run.ctx.session(sid)

    if (!text) {
      run.ctx.error(
        'OpenClaw 未返回可见内容。请确认 Gateway 正常，且所选 agent 已配置模型。'
      )
      this.stopChild(run)
      this.drop(runKey)
      return true
    }

    run.ctx.noteUsage(extractRunUsage(parsed))
    // 结算：补上 transcript 未流到的尾部
    if (!run.ctx.assistant(text, 'snapshot') && !run.ctx.lastText.trim()) {
      run.ctx.unsealContent()
      run.ctx.assistant(text, 'replace')
    }
    run.ctx.done()
    this.stopChild(run)
    this.drop(runKey)
    return true
  }

  /** 每次 stdout 增量后尝试提前收尾。 */
  private trySettleFromStdout(run: ActiveRun, runKey: string): boolean {
    if (run.ctx.settled || run.ctx.aborting) return run.ctx.settled
    const parsed = tryParseJsonResult(run.stdout)
    if (!parsed) return false
    return this.settleFromParsed(run, runKey, parsed)
  }

  async run(payload: SendPromptPayload, emit: Emit): Promise<void> {
    const identity = resolveRunIdentity(payload)
    const ctx = new RunContext(identity, emit)

    if (this.runs.has(identity.runKey)) {
      ctx.error('该对话还有请求在进行中，请先等待或取消。')
      return
    }

    let bin =
      runtimeCache && Date.now() - runtimeCache.at < RUNTIME_TTL_MS
        ? runtimeCache.bin
        : undefined
    if (!bin) {
      bin = await resolveOpenclawBin()
      runtimeCache = { at: Date.now(), bin, probe: runtimeCache?.probe }
    }
    if (!bin) {
      ctx.error('未检测到 OpenClaw。请先安装 ClawX / openclaw，并确保 Gateway 在跑。')
      return
    }

    const probe = await probeGatewayPort()
    if (!probe.ok) {
      // 失败时强制再探一次，避免缓存假阴性
      const retry = await probeGatewayPort(true)
      if (!retry.ok) {
        ctx.error(
          [
            'OpenClaw Gateway 未连通，无法发送。',
            '',
            retry.detail,
            '',
            '请打开 ClawX，或执行：',
            '```bash',
            'openclaw gateway status',
            'openclaw gateway',
            '```'
          ].join('\n')
        )
        return
      }
    }

    const settings = getSettings()
    const modelRef = identity.modelId
    const fromModel = modelRef ? parseModelRef(modelRef).model : ''
    const agentId =
      (fromModel && fromModel.trim()) ||
      (settings.openclawAgentId || 'main').trim() ||
      'main'
    const sessionId =
      (payload.sessionId && payload.sessionId.trim()) || `cursor-pet-${identity.runKey}`

    const run: ActiveRun = {
      ctx,
      agentId,
      cliSessionId: sessionId,
      child: null,
      stdout: '',
      stderr: '',
      watchdog: null,
      transcriptTimer: null,
      transcriptPath: null,
      transcriptPos: 0,
      transcript: new OpenclawTranscriptReader()
    }
    run.cleanup = () => {
      if (run.watchdog) {
        clearTimeout(run.watchdog)
        run.watchdog = null
      }
      if (run.transcriptTimer) {
        clearInterval(run.transcriptTimer)
        run.transcriptTimer = null
      }
      run.child = null
    }
    ctx.setSettleHook(() => {
      if (run.ctx.settled || run.ctx.aborting) return
      run.ctx.done()
      this.stopChild(run)
      this.drop(identity.runKey)
    })
    this.set(identity.runKey, run)

    ctx.state('thinking')
    this.startTranscriptWatch(run)

    const withSkills = applySkillsForEngine(emit, payload, 'openclaw')
    const args = [
      'agent',
      '--agent',
      agentId,
      '--session-id',
      sessionId,
      '--message',
      wrapPromptWithSystem(withSkills.prompt, withSkills.systemPrompt),
      '--json',
      '--timeout',
      '600'
    ]

    try {
      // 不使用 detached：便于回收；收尾靠 JSON 解析而非进程退出
      const cwd = payload.cwd?.trim()
      if (!cwd) {
        this.drop(identity.runKey)
        ctx.error('未设置工作目录，已取消（请选择项目目录后再发）。')
        return
      }
      run.child = spawn(bin, args, {
        cwd,
        env: await buildSpawnEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      })
    } catch (err) {
      this.drop(identity.runKey)
      ctx.error(`启动 OpenClaw 失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }

    run.watchdog = setTimeout(() => {
      if (!this.runs.has(identity.runKey) || run.ctx.settled || run.ctx.aborting) return
      // 超时前再抢一次：JSON 往往早已写完，只是进程没退
      if (this.trySettleFromStdout(run, identity.runKey)) return
      ctx.error(
        [
          'OpenClaw 长时间无响应，已自动中止。',
          '',
          'Gateway 端口可连，但 CLI 未在时限内给出完整结果。',
          '请在 ClawX 查看该 agent 是否卡住，或换一个 agent / 新开对话重试。',
          '',
          '```bash',
          'openclaw gateway status',
          '```'
        ].join('\n')
      )
      this.cancelOne(identity.runKey)
    }, HARD_TIMEOUT_MS)

    run.child.stdout.setEncoding('utf8')
    run.child.stdout.on('data', (chunk: string) => {
      if (run.ctx.aborting || run.ctx.settled) return
      run.stdout += chunk
      this.trySettleFromStdout(run, identity.runKey)
    })
    run.child.stderr.setEncoding('utf8')
    run.child.stderr.on('data', (chunk: string) => {
      run.stderr = appendBounded(run.stderr, chunk)
    })

    run.child.on('error', (err) => {
      if (run.ctx.settled || run.ctx.aborting) {
        this.drop(identity.runKey)
        return
      }
      run.ctx.error(`OpenClaw 进程错误：${err.message}`)
      this.drop(identity.runKey)
    })

    run.child.on('close', (code) => {
      if (run.ctx.settled || run.ctx.aborting) {
        this.drop(identity.runKey)
        return
      }

      const parsed = tryParseJsonResult(run.stdout)
      if (parsed && this.settleFromParsed(run, identity.runKey, parsed)) return

      if (code !== 0 && code !== null) {
        run.ctx.error(formatOpenclawFailure(run.stderr, run.stdout.trim(), code))
        this.drop(identity.runKey)
        return
      }

      run.ctx.error(
        run.stderr.trim() ||
          run.stdout.trim() ||
          'OpenClaw 未返回可见内容。请确认 Gateway 正常，且所选 agent 已配置模型。'
      )
      this.drop(identity.runKey)
    })
  }

  protected cancelOne(runKey: string): void {
    const run = this.get(runKey)
    if (!run) return
    if (run.ctx.settled) {
      this.drop(runKey)
      return
    }
    try {
      run.ctx.aborted()
    } catch {
      // ignore
    }
    this.stopChild(run)
    this.drop(runKey)
  }
}
