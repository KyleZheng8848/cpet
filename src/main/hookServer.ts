import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 本地 HTTP 服务：接收 hook 脚本上报的 IDE agent 生命周期事件。
 * 端口双写：~/.cursor/cursor-pet/port（Cursor）+ ~/.codex/cpet-port（ChatGPT/Codex 沙箱更易读）。
 */

const PORT_DIR = join(homedir(), '.cursor', 'cursor-pet')
const PORT_FILE = join(PORT_DIR, 'port')
/** ChatGPT/Codex 侧优先读这个；seatbelt 有时读不到 ~/.cursor。 */
const CODEX_PORT_FILE = join(homedir(), '.codex', 'cpet-port')

function writePortFiles(port: number): void {
  for (const [dir, file] of [
    [PORT_DIR, PORT_FILE],
    [join(homedir(), '.codex'), CODEX_PORT_FILE]
  ] as const) {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, String(port))
    } catch (err) {
      console.error('[cursor-pet] 写端口文件失败:', file, err)
    }
  }
}

function clearPortFiles(): void {
  for (const file of [PORT_FILE, CODEX_PORT_FILE]) {
    try {
      rmSync(file, { force: true })
    } catch {
      // ignore
    }
  }
}

export interface HookEvent {
  state: string
  /** 简短说明（工具名 / 命令），用于气泡。 */
  detail?: string
  /** 较长文本（agent 回复 / 结果），用于完成通知摘要。 */
  text?: string
  /** 原始 payload，供需要更多字段的场景使用。 */
  raw?: any
}

export interface HookHandlers {
  onEvent: (e: HookEvent) => void
  /** 处理阻塞式审批：返回 'allow' | 'deny'。 */
  onApproval: (req: { kind: string; content: string; raw: any }) => Promise<'allow' | 'deny'>
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 2_000_000) req.destroy()
    })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(body))
  })
}

export function startHookServer(handlers: HookHandlers): () => void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    // --- 阻塞式审批：hook 脚本 POST 到这里，等用户在宠物里决定后才响应 ---
    if (req.method === 'POST' && url.pathname === '/approve') {
      const kind = url.searchParams.get('kind') || 'shell'
      const body = await readBody(req)
      let raw: any = {}
      try {
        raw = JSON.parse(body)
      } catch {
        // ignore
      }
      const content = extractApprovalContent(kind, raw)
      let decision: 'allow' | 'deny'
      try {
        decision = await handlers.onApproval({ kind, content, raw })
      } catch {
        decision = 'allow'
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ decision }))
      return
    }

    // --- 普通事件上报 ---
    if (req.method === 'POST' && url.pathname === '/hook') {
      const state = url.searchParams.get('state') || ''
      const body = await readBody(req)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      if (!state) return
      let raw: any
      try {
        raw = JSON.parse(body)
      } catch {
        raw = undefined
      }
      handlers.onEvent(buildHookEvent(state, raw))
      return
    }

    res.writeHead(404)
    res.end()
  })

  server.on('error', (err) => {
    console.error('[cursor-pet] hook server error:', err)
  })

  // 监听随机可用端口，写入端口文件
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    if (port) writePortFiles(port)
  })

  return () => {
    clearPortFiles()
    server.close()
  }
}

const BASE_FIELDS = new Set([
  'conversation_id',
  'generation_id',
  'session_id',
  'hook_event_name',
  'workspace_roots',
  'model',
  'cursor_version',
  'user_email',
  'cwd',
  'sandbox'
])

/**
 * 审批卡片要展示的「完整」内容（不做 40 字截断）。
 * 提取不到任何有意义内容时返回空串 —— 调用方据此跳过审批、直接放行。
 */
function extractApprovalContent(kind: string, raw: any): string {
  if (!raw || typeof raw !== 'object') return ''

  // shell：完整命令
  if (typeof raw.command === 'string' && raw.command.trim()) {
    const c = raw.command
    return c.length > 1500 ? c.slice(0, 1500) + '\n…(已截断)' : c
  }

  // Codex PermissionRequest / 嵌套 tool_input.command
  const nestedCmd = raw.tool_input?.command ?? raw.toolInput?.command
  if (typeof nestedCmd === 'string' && nestedCmd.trim()) {
    const c = nestedCmd
    const name = raw.tool_name ?? raw.toolName ?? kind
    const body = c.length > 1500 ? c.slice(0, 1500) + '\n…(已截断)' : c
    return typeof name === 'string' && name.trim() ? `${name}\n${body}` : body
  }

  // MCP / 工具：server · tool + 参数（至少要有工具名/服务名/参数才提示）
  const md = raw.metadata ?? {}
  const server = md.server ?? raw.server
  const tool = md.tool_name ?? md.toolName ?? raw.tool_name ?? raw.name
  const args = raw.tool_input ?? raw.arguments ?? md.arguments ?? md.tool_input
  if (server || tool || args != null) {
    let s = `${server ? server + ' · ' : ''}${tool ?? 'MCP 工具'}`
    if (args != null) {
      try {
        s += '\n' + (typeof args === 'string' ? args : JSON.stringify(args, null, 2))
      } catch {
        // ignore
      }
    }
    return s
  }

  // 兜底：展示除基础字段以外的内容；没有则返回空串
  const rest: Record<string, unknown> = {}
  for (const k of Object.keys(raw)) if (!BASE_FIELDS.has(k)) rest[k] = raw[k]
  try {
    const s = JSON.stringify(rest, null, 2)
    return s && s !== '{}' ? (s.length > 800 ? s.slice(0, 800) + '\n…' : s) : ''
  } catch {
    return ''
  }
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 保留完整文字，只做空白归一化（气泡/活动展示用）。 */
function fullText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function stringifyInput(v: unknown, n = 0): string {
  if (v == null) return ''
  if (typeof v === 'string') return n > 0 ? clip(v, n) : fullText(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['command', 'path', 'file_path', 'filePath', 'query', 'pattern', 'url', 'target']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) {
        const s = String(o[k])
        return n > 0 ? clip(s, n) : fullText(s)
      }
    }
    try {
      const s = JSON.stringify(v)
      return n > 0 ? clip(s, n) : s
    } catch {
      return ''
    }
  }
  return n > 0 ? clip(String(v), n) : fullText(String(v))
}

/** 用户提交的提示词（beforeSubmitPrompt）。 */
export function extractPrompt(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const raw = payload.prompt ?? payload.user_prompt ?? payload.message ?? payload.text
  if (raw == null) return undefined
  const s = fullText(String(raw))
  return s || undefined
}

/** 从各类 hook payload 里尽量提取一段可读的「正在做什么」。 */
function extractDetail(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined

  const tool =
    payload.tool_name ??
    payload.toolName ??
    payload.metadata?.tool_name ??
    payload.tool ??
    payload.name
  const input = payload.tool_input ?? payload.arguments ?? payload.input
  const cmd =
    payload.command ??
    (input && typeof input === 'object' ? (input as any).command : undefined) ??
    payload.tool_input?.command
  const file =
    payload.file_path ??
    payload.filePath ??
    payload.path ??
    (input && typeof input === 'object'
      ? (input as any).path ?? (input as any).file_path ?? (input as any).filePath
      : undefined)

  if (cmd) {
    const c = fullText(String(cmd))
    return tool ? `${tool}: $ ${c}` : `$ ${c}`
  }
  if (file) {
    const f = fullText(String(file))
    return tool ? `${tool}: ${f}` : f
  }
  if (tool) {
    const extra = stringifyInput(input, 0)
    return extra ? `${tool}: ${extra}` : String(tool)
  }

  const server = payload.metadata?.server ?? payload.server
  if (server) return fullText(`MCP · ${server}`)

  return undefined
}

/** 从 agent 回复 / 结束事件里提取文本（完整内容，不做省略）。 */
function extractText(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  let raw =
    payload.response ??
    payload.text ??
    payload.message ??
    payload.content ??
    payload.agent_response ??
    payload.assistant_message ??
    payload.last_assistant_message ??
    payload.lastAssistantMessage ??
    payload.result ??
    payload.summary ??
    payload.prompt ??
    // Claude Code Stop / Notification
    payload.reason ??
    payload.notification ??
    payload.message_text
  if (raw && typeof raw === 'object') {
    raw =
      raw.text ??
      raw.content ??
      raw.message ??
      (Array.isArray(raw) ? raw.map((x: any) => x?.text ?? '').join('') : undefined)
  }
  if (raw == null) return undefined
  const s = fullText(String(raw))
  return s || undefined
}

/** 把 state + payload 规范成 HookEvent（HTTP 与文件收件箱共用）。 */
export function buildHookEvent(state: string, body?: any): HookEvent {
  let raw: any
  try {
    raw = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    raw = undefined
  }
  return { state, detail: extractDetail(raw), text: extractText(raw), raw }
}

export { extractApprovalContent }
