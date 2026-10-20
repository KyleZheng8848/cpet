import { spawn } from 'node:child_process'
import { resolveCodexBin } from './codexBin'

/**
 * Codex（ChatGPT）对非托管 command hooks 有信任门禁：
 * 未信任时 hooks.json 里即使挂了 CPET 脚本也会被静默跳过，桌面联动表现为「完全没反应」。
 *
 * 信任写入 `~/.codex/config.toml` 的 `[hooks.state."<key>"] trusted_hash = "..."`
 *（与官方 TUI `/hooks` → Trust 同一路径：`config/batchWrite` + `hooks.state` + `upsert`）。
 */

type JsonRpc = {
  jsonrpc?: string
  id?: number
  method?: string
  result?: unknown
  error?: { code?: number; message?: string }
}

type HookListEntry = {
  key?: string
  command?: string
  currentHash?: string
  trustStatus?: string
}

export type CodexHookTrustSnapshot = {
  /** Unix ms；0 表示尚未探测 */
  checkedAt: number
  /** 是否找到 CPET 的 Codex hooks */
  petTotal: number
  trusted: number
  /** petTotal>0 且全部 trusted/managed */
  allTrusted: boolean
  error?: string
}

let lastSnapshot: CodexHookTrustSnapshot = {
  checkedAt: 0,
  petTotal: 0,
  trusted: 0,
  allTrusted: false
}

export function getCodexHookTrustSnapshot(): CodexHookTrustSnapshot {
  return lastSnapshot
}

function isPetCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && /cursor-pet(-approve)?\.sh/.test(cmd)
}

function writeLine(child: { stdin: NodeJS.WritableStream | null }, obj: unknown): void {
  child.stdin?.write(`${JSON.stringify(obj)}\n`)
}

async function readJsonLine(
  child: { stdout: NodeJS.ReadableStream | null },
  matchId: number,
  timeoutMs: number
): Promise<JsonRpc | null> {
  return new Promise((resolve) => {
    const stdout = child.stdout
    if (!stdout) {
      resolve(null)
      return
    }
    let buf = ''
    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line) as JsonRpc
          if (msg.id === matchId) {
            cleanup()
            resolve(msg)
            return
          }
        } catch {
          // ignore non-JSON
        }
      }
    }
    const cleanup = () => {
      clearTimeout(timer)
      stdout.off('data', onData)
    }
    stdout.on('data', onData)
  })
}

function summarizePet(hooks: HookListEntry[]): CodexHookTrustSnapshot {
  const pet = hooks.filter((h) => isPetCommand(h.command))
  const trusted = pet.filter(
    (h) => h.trustStatus === 'trusted' || h.trustStatus === 'managed'
  ).length
  return {
    checkedAt: Date.now(),
    petTotal: pet.length,
    trusted,
    allTrusted: pet.length > 0 && trusted === pet.length
  }
}

function petHooksFromListResult(result: unknown): HookListEntry[] {
  const data = (result as { data?: Array<{ hooks?: HookListEntry[] }> } | undefined)?.data
  return data?.[0]?.hooks || []
}

/**
 * 把 CPET 挂在 `~/.codex/hooks.json` 上的 hooks 标为 trusted，并回读确认。
 * 幂等；失败不抛。
 */
export async function trustCodexPetHooks(): Promise<{
  ok: boolean
  trusted: number
  skipped: number
  error?: string
}> {
  const bin = await resolveCodexBin()
  if (!bin) {
    lastSnapshot = {
      checkedAt: Date.now(),
      petTotal: 0,
      trusted: 0,
      allTrusted: false,
      error: 'no-codex-bin'
    }
    return { ok: false, trusted: 0, skipped: 0, error: 'no-codex-bin' }
  }

  const child = spawn(bin, ['app-server'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: process.env
  })

  try {
    writeLine(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'cpet', version: '0' },
        capabilities: {},
        protocolVersion: '2'
      }
    })
    const init = await readJsonLine(child, 1, 8000)
    if (!init || init.error) {
      const error = init?.error?.message || 'initialize-timeout'
      lastSnapshot = {
        checkedAt: Date.now(),
        petTotal: 0,
        trusted: 0,
        allTrusted: false,
        error
      }
      return { ok: false, trusted: 0, skipped: 0, error }
    }

    writeLine(child, { jsonrpc: '2.0', id: 2, method: 'hooks/list', params: {} })
    const listed = await readJsonLine(child, 2, 8000)
    if (!listed || listed.error) {
      const error = listed?.error?.message || 'hooks/list-timeout'
      lastSnapshot = {
        checkedAt: Date.now(),
        petTotal: 0,
        trusted: 0,
        allTrusted: false,
        error
      }
      return { ok: false, trusted: 0, skipped: 0, error }
    }

    const allHooks = petHooksFromListResult(listed.result)
    const snap0 = summarizePet(allHooks)
    const hooks = allHooks.filter((h) => isPetCommand(h.command))
    if (!hooks.length) {
      lastSnapshot = snap0
      return { ok: true, trusted: 0, skipped: 0 }
    }

    const already = hooks.filter(
      (h) => h.trustStatus === 'trusted' || h.trustStatus === 'managed'
    ).length
    const need = hooks.filter(
      (h) => h.key && h.currentHash && h.trustStatus !== 'trusted' && h.trustStatus !== 'managed'
    )
    if (!need.length) {
      lastSnapshot = snap0
      return { ok: true, trusted: already, skipped: hooks.length }
    }

    const state: Record<string, { trusted_hash: string }> = {}
    for (const h of need) {
      state[h.key!] = { trusted_hash: h.currentHash! }
    }

    writeLine(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'config/batchWrite',
      params: {
        edits: [
          {
            keyPath: 'hooks.state',
            value: state,
            mergeStrategy: 'upsert'
          }
        ]
      }
    })
    const wrote = await readJsonLine(child, 3, 8000)
    if (!wrote || wrote.error) {
      const error = wrote?.error?.message || 'batchWrite-timeout'
      lastSnapshot = { ...snap0, error }
      return {
        ok: false,
        trusted: already,
        skipped: hooks.length - need.length,
        error
      }
    }

    // 回读确认：写入成功不等于 trustStatus 已翻转为 trusted
    writeLine(child, { jsonrpc: '2.0', id: 4, method: 'hooks/list', params: {} })
    const listed2 = await readJsonLine(child, 4, 8000)
    if (!listed2 || listed2.error) {
      const error = listed2?.error?.message || 'hooks/list-verify-timeout'
      lastSnapshot = { ...snap0, trusted: already, allTrusted: false, error }
      return { ok: false, trusted: already, skipped: hooks.length - need.length, error }
    }
    const snap1 = summarizePet(petHooksFromListResult(listed2.result))
    lastSnapshot = snap1
    if (!snap1.allTrusted) {
      return {
        ok: false,
        trusted: snap1.trusted,
        skipped: Math.max(0, snap1.petTotal - snap1.trusted),
        error: `trust-incomplete:${snap1.trusted}/${snap1.petTotal}`
      }
    }
    return {
      ok: true,
      trusted: snap1.trusted,
      skipped: 0
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    lastSnapshot = {
      checkedAt: Date.now(),
      petTotal: 0,
      trusted: 0,
      allTrusted: false,
      error
    }
    return { ok: false, trusted: 0, skipped: 0, error }
  } finally {
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
}
