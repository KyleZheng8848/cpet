/** 对话导出 Markdown / 本地搜索（纯函数，主进程与渲染均可复用）。 */

import type { ChatBlock, ChatMessage, Conversation } from './types'

function blockPlain(b: ChatBlock): string {
  switch (b.kind) {
    case 'text':
    case 'reasoning':
    case 'status':
    case 'skill':
      return b.text
    case 'sticker':
      return b.label ?? b.emoji
    case 'attachment':
      return `[附件] ${b.name}`
    case 'tool':
      return `[工具 ${b.name}] ${b.input || ''}\n${b.output || ''}`.trim()
    case 'command':
      return `[命令] ${b.command}\n${b.output || ''}`.trim()
    default:
      return ''
  }
}

export function messagePlainSearchText(m: ChatMessage): string {
  return m.blocks.map(blockPlain).join('\n')
}

/** 导出用：用户全文；助手只取最终 text（不含过程）。 */
function messageExportBody(m: ChatMessage): string {
  if (m.role === 'user') {
    if (m.source === 'compare-summary') {
      const n = m.summaryMeta?.candidateCount
      const note = m.summaryMeta?.note?.trim()
      const countBit = typeof n === 'number' && n > 0 ? `${n} 条候选` : '多条候选'
      return note ? `（汇总请求：${countBit}；${note}）` : `（汇总请求：${countBit}）`
    }
    return m.blocks
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
  }
  if (m.role === 'assistant') {
    return m.blocks
      .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
  }
  return messagePlainSearchText(m)
}

export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title || '对话'}`,
    '',
    `- 任务 id：\`${conv.id}\``,
    `- 类型：${conv.kind === 'compare' ? '模型对比' : '普通对话'}`,
    conv.modelRef ? `- 模型：\`${conv.modelRef}\`` : '',
    conv.cwd ? `- 目录：\`${conv.cwd}\`` : '',
    `- 导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '---',
    ''
  ].filter(Boolean) as string[]

  if (conv.kind === 'compare') {
    const users = conv.messages.filter((m) => m.role === 'user')
    const laneEntries = Object.entries(conv.lanes || {})
    for (let i = 0; i < users.length; i++) {
      const u = users[i]
      lines.push(`## 轮次 ${i + 1}`)
      lines.push('')
      lines.push('### 用户')
      lines.push('')
      lines.push(messageExportBody(u) || '（空）')
      lines.push('')
      for (const [laneId, lane] of laneEntries) {
        const a = lane.messages[i]
        if (!a) continue
        lines.push(`### ${lane.modelId || laneId}`)
        lines.push('')
        lines.push(messageExportBody(a) || '（空）')
        lines.push('')
      }
    }
  } else {
    for (const m of conv.messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue
      const head = m.role === 'user' ? '## 用户' : '## 助手'
      lines.push(head)
      lines.push('')
      lines.push(messageExportBody(m) || '（空）')
      lines.push('')
    }
  }

  return lines.join('\n').trim() + '\n'
}

export interface ChatSearchHit {
  conversationId: string
  title: string
  messageId: string
  role: string
  snippet: string
}

function snippetAround(text: string, query: string, radius = 48): string {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const i = lower.indexOf(q)
  if (i < 0) return text.slice(0, radius * 2).trim()
  const start = Math.max(0, i - radius)
  const end = Math.min(text.length, i + q.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/** 在当前任务消息里搜索（按消息）。 */
export function searchInMessages(
  messages: ChatMessage[],
  query: string
): Array<{ messageId: string; role: string; snippet: string }> {
  const q = query.trim()
  if (!q) return []
  const out: Array<{ messageId: string; role: string; snippet: string }> = []
  for (const m of messages) {
    const text = messagePlainSearchText(m)
    if (!text.toLowerCase().includes(q.toLowerCase())) continue
    out.push({ messageId: m.id, role: m.role, snippet: snippetAround(text, q) })
  }
  return out
}

/** 在全部任务中搜索。 */
export function searchInConversations(
  conversations: Conversation[],
  query: string
): ChatSearchHit[] {
  const q = query.trim()
  if (!q) return []
  const hits: ChatSearchHit[] = []
  for (const c of conversations) {
    const pool: ChatMessage[] = [...c.messages]
    if (c.kind === 'compare' && c.lanes) {
      for (const lane of Object.values(c.lanes)) pool.push(...lane.messages)
    }
    for (const m of pool) {
      const text = messagePlainSearchText(m)
      if (!text.toLowerCase().includes(q.toLowerCase())) continue
      hits.push({
        conversationId: c.id,
        title: c.title || '未命名',
        messageId: m.id,
        role: m.role,
        snippet: snippetAround(text, q)
      })
      if (hits.length >= 80) return hits
    }
  }
  return hits
}

export function safeExportFilename(title: string): string {
  const base = (title || '对话')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  const stamp = new Date().toISOString().slice(0, 10)
  return `CPET-${base || 'chat'}-${stamp}.md`
}
