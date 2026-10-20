import { mkdirSync, readdirSync, readFileSync, unlinkSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildHookEvent, type HookEvent } from './hookServer'

/**
 * 文件收件箱：hook 脚本把事件写到约定目录。
 * - ~/.cursor/cursor-pet/inbox —— Cursor / 通用
 * - ~/.codex/cpet-inbox —— ChatGPT/Codex（沙箱有时写不进 ~/.cursor）
 * 绕过对 curl/localhost 的限制，比 HTTP 更可靠。
 */

export const HOOK_INBOX_DIRS = [
  join(homedir(), '.codex', 'cpet-inbox'),
  join(homedir(), '.cursor', 'cursor-pet', 'inbox')
] as const

/** 解析收件箱 payload；容忍旧 hook printf/% 损坏导致的尾部多余 `}`。 */
export function parseHookInboxRaw(raw: string): { state?: string; body?: unknown } | null {
  const text = raw.trim()
  if (!text) return null
  try {
    return JSON.parse(text) as { state?: string; body?: unknown }
  } catch {
    // 常见：合法 JSON 后多一个 `}`（body 含 % 被 printf 吃坏）
    let t = text
    for (let i = 0; i < 3; i++) {
      if (!t.endsWith('}')) break
      t = t.slice(0, -1).trimEnd()
      try {
        return JSON.parse(t) as { state?: string; body?: unknown }
      } catch {
        // continue
      }
    }
    return null
  }
}

function isInboxName(name: string): boolean {
  return name.endsWith('.json') || name.endsWith('.json.tmp')
}

export function startHookInbox(onEvent: (e: HookEvent) => void): () => void {
  for (const dir of HOOK_INBOX_DIRS) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // ignore
    }
  }

  const seen = new Set<string>()
  const poison = new Map<string, number>()
  const watchers: FSWatcher[] = []
  let pollTimer: NodeJS.Timeout | null = null

  function drop(path: string, key: string): void {
    try {
      unlinkSync(path)
    } catch {
      // ignore
    }
    seen.delete(key)
    poison.delete(key)
  }

  function ingest(dir: string, name: string): void {
    if (!isInboxName(name)) return
    const key = `${dir}\0${name}`
    if (seen.has(key)) return
    const path = join(dir, name)
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return
    }
    // 半截写入：等下一轮
    if (!raw.trim()) return

    const parsed = parseHookInboxRaw(raw)
    if (!parsed) {
      const n = (poison.get(key) || 0) + 1
      poison.set(key, n)
      // 连续失败多次 → 毒丸，删掉以免拖垮轮询
      if (n >= 5) {
        console.warn('[cursor-pet] 收件箱毒丸已丢弃', path)
        drop(path, key)
      }
      return
    }

    seen.add(key)
    try {
      const state = parsed.state || ''
      if (state) onEvent(buildHookEvent(state, parsed.body))
    } finally {
      drop(path, key)
    }
  }

  function scan(): void {
    for (const dir of HOOK_INBOX_DIRS) {
      try {
        for (const f of readdirSync(dir)) ingest(dir, f)
      } catch {
        // ignore
      }
    }
  }

  scan()
  for (const dir of HOOK_INBOX_DIRS) {
    try {
      watchers.push(
        watch(dir, (_, f) => {
          if (f) setTimeout(() => ingest(dir, f), 8)
        })
      )
    } catch (err) {
      console.error('[cursor-pet] 收件箱 watch 失败，改用轮询', dir, err)
    }
  }
  pollTimer = setInterval(scan, 400)

  return () => {
    for (const w of watchers) {
      try {
        w.close()
      } catch {
        // ignore
      }
    }
    if (pollTimer) clearInterval(pollTimer)
  }
}
