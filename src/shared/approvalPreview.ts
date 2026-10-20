/** 审批原文往往是 `Write\n{ "content": "a\\nb" }`，直接塞进 pre 会截断、满屏 `\n`。 */

export type ApprovalPreview = {
  /** Write / Edit / 命令 / MCP */
  action: string
  /** 文件名或命令首行，给一行摘要用 */
  target: string
  path?: string
  /** 已解开转义的正文，给「看改动」 */
  body: string
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

function firstLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 96 ? `${t.slice(0, 96)}…` : t
}

function tryParseJson(s: string): unknown {
  const t = s.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

function looksLikeToolName(s: string): boolean {
  return /^[A-Za-z][\w.-]{0,40}$/.test(s.trim())
}

function prettyRest(obj: Record<string, unknown>): string {
  const skip = new Set(['file_path', 'filePath', 'path', 'content', 'command'])
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || v == null) continue
    rest[k] = v
  }
  if (!Object.keys(rest).length) return ''
  try {
    return JSON.stringify(rest, null, 2)
  } catch {
    return ''
  }
}

function fromArgs(obj: Record<string, unknown>, toolName?: string): ApprovalPreview {
  const path = str(obj.file_path) || str(obj.filePath) || str(obj.path)
  const cmd = str(obj.command)
  const content = str(obj.content) ?? str(obj.new_string) ?? str(obj.new_text)
  const old = str(obj.old_string) ?? str(obj.old_text)
  const action = (toolName || '').trim() || (cmd ? '命令' : path ? '写入' : '工具')

  if (cmd) {
    return { action: toolName || '命令', target: firstLine(cmd), body: cmd }
  }
  if (path) {
    let body = content || ''
    if (old && content) body = `--- 原文\n${old}\n\n+++ 改后\n${content}`
    const extra = prettyRest(obj)
    if (extra) body = body ? `${body}\n\n${extra}` : extra
    return {
      action,
      target: basename(path),
      path,
      body: body || path
    }
  }
  if (content) {
    return { action, target: firstLine(content), body: content }
  }
  const extra = prettyRest(obj)
  return { action, target: extra ? firstLine(extra) : action, body: extra || action }
}

export function previewApproval(kind: string, content: string): ApprovalPreview {
  const raw = (content || '').trim()
  const fallback = kind === 'mcp' ? 'MCP' : kind === 'shell' ? '命令' : '工具'
  if (!raw) return { action: fallback, target: '待批准', body: '' }

  const nl = raw.indexOf('\n')
  if (nl > 0) {
    const head = raw.slice(0, nl).trim()
    const rest = raw.slice(nl + 1)
    const parsed = tryParseJson(rest)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return fromArgs(parsed as Record<string, unknown>, looksLikeToolName(head) ? head : undefined)
    }
  }

  const parsed = tryParseJson(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return fromArgs(parsed as Record<string, unknown>)
  }

  if (kind === 'shell' || raw.startsWith('$ ')) {
    const cmd = raw.replace(/^\$\s*/, '')
    return { action: '命令', target: firstLine(cmd), body: cmd }
  }
  return { action: fallback, target: firstLine(raw), body: raw }
}

export function approvalSummary(p: ApprovalPreview): string {
  return p.target && p.target !== p.action ? `${p.action} · ${p.target}` : p.action
}

/** 宠物小卡用：收家目录；只有超出宽度才收尾段，能放下的整段留下。 */
export function compactApprovalCommand(raw: string, max = 56): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  s = s.replace(/\/Users\/[^/\s"]+/g, '~')
  if (s.length <= max) return s

  const quoted = s.match(/^(\S+)\s+"([^"]+)"(.*)$/)
  if (quoted) {
    const [, verb, path, rest] = quoted
    const parts = path.split('/').filter(Boolean)
    if (parts.length > 2) {
      const out = `${verb} "…/${parts.slice(-2).join('/')}"${rest}`.trim()
      if (out.length <= max) return out
      s = out
    }
  }

  const keep = Math.max(12, max - 1)
  const left = Math.ceil(keep * 0.55)
  return `${s.slice(0, left)}…${s.slice(-(keep - left))}`
}
