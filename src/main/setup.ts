import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getEngineSetupGuide,
  installCommandForPlatform,
  type EngineSetupId
} from '../shared/engineSetup'
import { buildAgentEnvAsync } from './cliPath'
import { getCodexHookTrustSnapshot } from './codexHookTrust'

/**
 * 多引擎联动：把同一套 notify/approve 脚本挂到
 * - Cursor：~/.cursor/hooks.json
 * - Claude Code：~/.claude/settings.json
 * - Codex：~/.codex/hooks.json
 *
 */

const CURSOR_DIR = join(homedir(), '.cursor')
const HOOKS_DIR = join(CURSOR_DIR, 'hooks')
const CURSOR_HOOKS_JSON = join(CURSOR_DIR, 'hooks.json')
const NOTIFY_SH = join(HOOKS_DIR, 'cursor-pet.sh')
const APPROVE_SH = join(HOOKS_DIR, 'cursor-pet-approve.sh')

const CLAUDE_DIR = join(homedir(), '.claude')
const CLAUDE_SETTINGS = join(CLAUDE_DIR, 'settings.json')
const CODEX_DIR = join(homedir(), '.codex')
const CODEX_HOOKS_JSON = join(CODEX_DIR, 'hooks.json')

const HOOK_SCRIPT_VERSION = 'cursor-pet-hook-v12'

const NOTIFY_SCRIPT = `#!/bin/bash
# ${HOOK_SCRIPT_VERSION}
# CPET 生命周期上报（Cursor / Claude Code / Codex 共用）
# 用法：cursor-pet.sh <state>
# 收件箱双写：~/.codex/cpet-inbox（ChatGPT 沙箱优先）+ ~/.cursor/cursor-pet/inbox
# 注意：
# 1) ChatGPT seatbelt 常允许写文件但禁止 mv → 直接写 .json
# 2) 禁止 body="\${payload:-{}}" —— bash 会把默认值词界解析成 "{" 再留下多余的 "}"
# 3) 写文件时 body 只用 printf '%s'，避免 body 内 % 被当成格式串
state="\${1:-}"
payload="$(cat)"
if [ -n "$payload" ]; then
  body="$payload"
else
  body='{}'
fi
first=$(printf '%s' "$body" | cut -c1)
if [ "$first" != "{" ]; then body='{}'; fi
if [ -n "$state" ]; then
  for inbox in "$HOME/.codex/cpet-inbox" "$HOME/.cursor/cursor-pet/inbox"; do
    mkdir -p "$inbox" 2>/dev/null || continue
    fname="$inbox/$(date +%s%N)-$state.json"
    prefix='{"state":"'"$state"'","body":'
    {
      printf '%s' "$prefix"
      printf '%s' "$body"
      printf '%s' '}'
    } > "$fname" 2>/dev/null || {
      tmp="$fname.tmp"
      {
        printf '%s' "$prefix"
        printf '%s' "$body"
        printf '%s' '}'
      } > "$tmp" 2>/dev/null || rm -f "$tmp" 2>/dev/null
    }
  done
  port=""
  for portfile in "$HOME/.codex/cpet-port" "$HOME/.cursor/cursor-pet/port"; do
    if [ -f "$portfile" ]; then
      port="$(cat "$portfile" 2>/dev/null)"
      [ -n "$port" ] && break
    fi
  done
  if [ -n "$port" ]; then
    curl -s -m 2 -X POST "http://127.0.0.1:\${port}/hook?state=\${state}" \\
      -H "Content-Type: application/json" --data-binary "$body" >/dev/null 2>&1 || true
  fi
fi
printf '{}'
exit 0
`

const APPROVE_SCRIPT = `#!/bin/bash
# ${HOOK_SCRIPT_VERSION}
# 用法：cursor-pet-approve.sh <kind>
# （与 notify 同版本号，便于检测是否已升级）
# kind ∈ shell|mcp|tool|codex
# Cursor 输出 permission；Codex PermissionRequest 输出 hookSpecificOutput.decision.behavior
kind="\${1:-shell}"
payload="$(cat)"
if [ -n "$payload" ]; then
  body="$payload"
else
  body='{}'
fi
port=""
for portfile in "$HOME/.codex/cpet-port" "$HOME/.cursor/cursor-pet/port"; do
  if [ -f "$portfile" ]; then
    port="$(cat "$portfile" 2>/dev/null)"
    [ -n "$port" ] && break
  fi
done
decision="allow"
if [ -n "$port" ]; then
  resp="$(curl -s -m 100 -X POST "http://127.0.0.1:\${port}/approve?kind=\${kind}" \\
    -H "Content-Type: application/json" --data-binary "$body" 2>/dev/null)"
  case "$resp" in
    *'"decision":"deny"'*) decision="deny" ;;
    *) decision="allow" ;;
  esac
fi
if [ "$kind" = "codex" ] || [ "$kind" = "permission" ]; then
  if [ "$decision" = "deny" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"User denied via CPET."}}}'
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
  fi
elif [ "$decision" = "deny" ]; then
  printf '{"permission":"deny","user_message":"你在 CPET 里拒绝了这次操作。","agent_message":"User denied via CPET."}'
else
  printf '{"permission":"allow"}'
fi
exit 0
`

interface CursorHookDef {
  event: string
  script: 'notify' | 'approve'
  arg: string
  timeout: number
  matcher?: string
}

const CURSOR_HOOK_DEFS: CursorHookDef[] = [
  { event: 'beforeSubmitPrompt', script: 'notify', arg: 'thinking', timeout: 5 },
  { event: 'preToolUse', script: 'notify', arg: 'tool', timeout: 5 },
  { event: 'postToolUse', script: 'notify', arg: 'toolresult', timeout: 5 },
  { event: 'afterFileEdit', script: 'notify', arg: 'tool', timeout: 5 },
  { event: 'afterAgentResponse', script: 'notify', arg: 'talking', timeout: 5 },
  { event: 'afterAgentThought', script: 'notify', arg: 'thought', timeout: 5 },
  { event: 'afterShellExecution', script: 'notify', arg: 'shellresult', timeout: 5 },
  { event: 'stop', script: 'notify', arg: 'done', timeout: 5 },
  { event: 'beforeShellExecution', script: 'approve', arg: 'shell', timeout: 110 },
  { event: 'beforeMCPExecution', script: 'approve', arg: 'mcp', timeout: 110 }
]

/** Claude / Codex：嵌套 hooks 格式。Codex PermissionRequest 走 approve 协议。 */
interface NestedHookDef {
  event: string
  /** notify 脚本参数（script=notify 时必填） */
  state?: string
  script?: 'notify' | 'approve'
  /** approve 脚本 kind：shell|mcp|tool|codex */
  approveKind?: string
  matcher?: string
  timeout?: number
}

const CLAUDE_NESTED_DEFS: NestedHookDef[] = [
  { event: 'UserPromptSubmit', state: 'thinking', timeout: 5 },
  { event: 'PreToolUse', state: 'tool', matcher: '.*', timeout: 5 },
  { event: 'PostToolUse', state: 'toolresult', matcher: '.*', timeout: 5 },
  { event: 'PostToolUseFailure', state: 'toolresult', matcher: '.*', timeout: 5 },
  {
    event: 'Notification',
    state: 'waiting',
    matcher: 'idle_prompt|permission_prompt|agent_needs_input|elicitation_dialog',
    timeout: 5
  },
  { event: 'Notification', state: 'done', matcher: 'agent_completed', timeout: 5 },
  { event: 'Stop', state: 'done', timeout: 5 },
  { event: 'SessionEnd', state: 'done', timeout: 5 },
  { event: 'SessionStart', state: 'thinking', matcher: 'startup|resume', timeout: 5 }
]

/**
 * Codex 官方事件面（ChatGPT.app 0.147 实测）：
 * 不含 PostToolUseFailure（二进制无此事件名，写入 hooks.json 也会被 hooks/list 丢掉）。
 * 工具失败跟态靠 PostToolUse / Stop。
 */
const CODEX_NESTED_DEFS: NestedHookDef[] = [
  { event: 'UserPromptSubmit', state: 'thinking', timeout: 5 },
  { event: 'SessionStart', state: 'thinking', matcher: 'startup|resume', timeout: 5 },
  { event: 'SubagentStart', state: 'thinking', timeout: 5 },
  { event: 'PreToolUse', state: 'tool', matcher: '.*', timeout: 5 },
  {
    event: 'PermissionRequest',
    script: 'approve',
    approveKind: 'codex',
    matcher: '.*',
    timeout: 110
  },
  { event: 'PostToolUse', state: 'toolresult', matcher: '.*', timeout: 5 },
  { event: 'Stop', state: 'done', timeout: 5 },
  { event: 'SubagentStop', state: 'done', timeout: 5 },
  // Codex SessionEnd 默认/上限约 3s，写 5 会被钳制并打 warning
  { event: 'SessionEnd', state: 'done', timeout: 3 }
]

/** Codex 不支持的旧事件：安装时剥掉 CPET 残留，避免「已挂却永不跑」。 */
const CODEX_UNSUPPORTED_PET_EVENTS = ['PostToolUseFailure'] as const

function notifyCmd(state: string): string {
  return `bash "${NOTIFY_SH}" ${state}`
}

function nestedCmd(def: NestedHookDef): string {
  if (def.script === 'approve') {
    return `bash "${APPROVE_SH}" ${def.approveKind || 'shell'}`
  }
  return notifyCmd(def.state || 'thinking')
}

function cursorHookCommand(def: CursorHookDef): string {
  const sh = def.script === 'approve' ? APPROVE_SH : NOTIFY_SH
  return `bash "${sh}" ${def.arg}`
}

function cursorHookEntry(def: CursorHookDef): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: 'command',
    command: cursorHookCommand(def),
    timeout: def.timeout
  }
  if (def.matcher) entry.matcher = def.matcher
  return entry
}

function isPetCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && /cursor-pet(-approve)?\.sh/.test(cmd)
}

function writeScripts(): void {
  mkdirSync(HOOKS_DIR, { recursive: true })
  writeFileSync(NOTIFY_SH, NOTIFY_SCRIPT)
  writeFileSync(APPROVE_SH, APPROVE_SCRIPT)
  chmodSync(NOTIFY_SH, 0o755)
  chmodSync(APPROVE_SH, 0o755)
}

function scriptsCurrent(): boolean {
  try {
    return existsSync(NOTIFY_SH) && readFileSync(NOTIFY_SH, 'utf8').includes(HOOK_SCRIPT_VERSION)
  } catch {
    return false
  }
}

function installCursorHooks(): boolean {
  let json: any = { version: 1, hooks: {} }
  if (existsSync(CURSOR_HOOKS_JSON)) {
    try {
      json = JSON.parse(readFileSync(CURSOR_HOOKS_JSON, 'utf8')) || json
    } catch {
      json = { version: 1, hooks: {} }
    }
  }
  if (typeof json !== 'object' || json === null) json = { version: 1, hooks: {} }
  if (!json.version) json.version = 1
  if (!json.hooks || typeof json.hooks !== 'object') json.hooks = {}

  const events = [...new Set(CURSOR_HOOK_DEFS.map((d) => d.event))]
  for (const ev of events) {
    const list = Array.isArray(json.hooks[ev]) ? json.hooks[ev] : []
    const kept = list.filter((h: any) => !isPetCommand(h?.command))
    for (const def of CURSOR_HOOK_DEFS.filter((d) => d.event === ev)) kept.push(cursorHookEntry(def))
    json.hooks[ev] = kept
  }
  writeFileSync(CURSOR_HOOKS_JSON, JSON.stringify(json, null, 2))
  return true
}

function nestedPetPresent(hooksRoot: any): boolean {
  if (!hooksRoot || typeof hooksRoot !== 'object') return false
  for (const arr of Object.values(hooksRoot)) {
    if (!Array.isArray(arr)) continue
    for (const group of arr) {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : []
      if (handlers.some((h: any) => isPetCommand(h?.command))) return true
      if (isPetCommand(group?.command)) return true
    }
  }
  return false
}

function mergeNestedHooks(existing: any, defs: NestedHookDef[]): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> =
    existing && typeof existing === 'object' ? { ...existing } : {}

  for (const def of defs) {
    const list = Array.isArray(hooks[def.event]) ? [...hooks[def.event]] : []
    const kept = list.filter((group: any) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : []
      if (handlers.some((h: any) => isPetCommand(h?.command))) return false
      if (isPetCommand(group?.command)) return false
      return true
    })
    const handler: Record<string, unknown> = {
      type: 'command',
      command: nestedCmd(def)
    }
    if (def.timeout) handler.timeout = def.timeout
    const group: Record<string, unknown> = { hooks: [handler] }
    if (def.matcher) group.matcher = def.matcher
    kept.push(group)
    hooks[def.event] = kept
  }
  return hooks
}

function installClaudeHooks(): boolean {
  mkdirSync(CLAUDE_DIR, { recursive: true })
  let settings: any = {}
  if (existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8')) || {}
    } catch {
      settings = {}
    }
  }
  if (typeof settings !== 'object' || settings === null) settings = {}
  settings.hooks = mergeNestedHooks(settings.hooks, CLAUDE_NESTED_DEFS)
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n')
  return true
}

function stripUnsupportedCodexPetHooks(hooksRoot: any): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> =
    hooksRoot && typeof hooksRoot === 'object' ? { ...hooksRoot } : {}
  for (const ev of CODEX_UNSUPPORTED_PET_EVENTS) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev] : []
    const kept = list.filter((group: any) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : []
      if (handlers.some((h: any) => isPetCommand(h?.command))) return false
      if (isPetCommand(group?.command)) return false
      return true
    })
    if (kept.length) hooks[ev] = kept
    else delete hooks[ev]
  }
  return hooks
}

function installCodexHooks(): boolean {
  mkdirSync(CODEX_DIR, { recursive: true })
  let json: any = { hooks: {} }
  if (existsSync(CODEX_HOOKS_JSON)) {
    try {
      json = JSON.parse(readFileSync(CODEX_HOOKS_JSON, 'utf8')) || json
    } catch {
      json = { hooks: {} }
    }
  }
  if (typeof json !== 'object' || json === null) json = { hooks: {} }
  json.hooks = mergeNestedHooks(json.hooks, CODEX_NESTED_DEFS)
  json.hooks = stripUnsupportedCodexPetHooks(json.hooks)
  writeFileSync(CODEX_HOOKS_JSON, JSON.stringify(json, null, 2) + '\n')
  return true
}

function removeNestedPetHooks(hooksRoot: any): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> = {}
  if (!hooksRoot || typeof hooksRoot !== 'object') return hooks
  for (const [ev, arr] of Object.entries(hooksRoot)) {
    if (!Array.isArray(arr)) continue
    const kept = arr.filter((group: any) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : []
      if (handlers.some((h: any) => isPetCommand(h?.command))) return false
      if (isPetCommand(group?.command)) return false
      return true
    })
    if (kept.length) hooks[ev] = kept
  }
  return hooks
}

function cursorHooksInstalled(): boolean {
  try {
    if (!existsSync(CURSOR_HOOKS_JSON)) return false
    const json = JSON.parse(readFileSync(CURSOR_HOOKS_JSON, 'utf8'))
    const hooks = json?.hooks ?? {}
    return Object.values(hooks).some(
      (arr) => Array.isArray(arr) && arr.some((h: any) => isPetCommand(h?.command))
    )
  } catch {
    return false
  }
}

function claudeHooksInstalled(): boolean {
  try {
    if (!existsSync(CLAUDE_SETTINGS)) return false
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'))
    return nestedPetPresent(settings?.hooks)
  } catch {
    return false
  }
}

function codexHooksInstalled(): boolean {
  try {
    if (!existsSync(CODEX_HOOKS_JSON)) return false
    const json = JSON.parse(readFileSync(CODEX_HOOKS_JSON, 'utf8'))
    return nestedPetPresent(json?.hooks)
  } catch {
    return false
  }
}

export interface SetupStatus {
  /** 任一 IDE hooks 已挂且脚本新鲜即算配置完成（不只 Cursor）。 */
  hooksInstalled: boolean
  scriptsInstalled: boolean
  cursor: boolean
  claudeCode: boolean
  codex: boolean
  /**
   * Codex/ChatGPT hooks 是否已通过信任门禁。
   * null=尚未探测或本机无 Codex CLI；false=已挂 hooks 但仍有未信任项（会静默不跑）。
   */
  codexTrusted: boolean | null
}

export function getSetupStatus(): SetupStatus {
  const scriptsOk = scriptsCurrent()
  const cursor = cursorHooksInstalled()
  const claudeCode = claudeHooksInstalled()
  const codex = codexHooksInstalled()
  const anyIde = cursor || claudeCode || codex
  // 快照由 trustCodexPetHooks 维护；未探测前为 null（勿假装已信任）
  let codexTrusted: boolean | null = null
  if (scriptsOk && codex) {
    const snap = getCodexHookTrustSnapshot()
    if (snap.checkedAt > 0) {
      codexTrusted = snap.petTotal > 0 ? snap.allTrusted : null
    }
  }
  return {
    hooksInstalled: scriptsOk && anyIde,
    scriptsInstalled: scriptsOk,
    cursor: scriptsOk && cursor,
    claudeCode: scriptsOk && claudeCode,
    codex: scriptsOk && codex,
    codexTrusted
  }
}

export function ensureHooksFresh(): { ok: boolean; upgraded: boolean; error?: string } {
  // scriptsInstalled 含版本号检测；过期脚本必须重写，否则 ChatGPT 沙箱仍走坏掉的 tmp+mv
  if (scriptsCurrent()) {
    const st = getSetupStatus()
    if (st.cursor && st.claudeCode && st.codex) {
      return { ok: true, upgraded: false }
    }
  }
  const r = installHooks()
  return { ...r, upgraded: r.ok }
}

/** 安装脚本 + Cursor / Claude / Codex 联动（幂等）。 */
export function installHooks(): { ok: boolean; error?: string } {
  try {
    writeScripts()
    installCursorHooks()
    installClaudeHooks()
    installCodexHooks()
    // 信任写入由调用方 await trustCodexPetHooks（配置联动 / 启动后）；此处只保证磁盘 hooks/脚本就绪
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 移除各引擎中的宠物 hook（保留脚本文件与其它 hook）。 */
export function uninstallHooks(): { ok: boolean; error?: string } {
  try {
    if (existsSync(CURSOR_HOOKS_JSON)) {
      const json = JSON.parse(readFileSync(CURSOR_HOOKS_JSON, 'utf8'))
      const hooks = json?.hooks ?? {}
      for (const key of Object.keys(hooks)) {
        if (Array.isArray(hooks[key])) {
          hooks[key] = hooks[key].filter((h: any) => !isPetCommand(h?.command))
          if (!hooks[key].length) delete hooks[key]
        }
      }
      writeFileSync(CURSOR_HOOKS_JSON, JSON.stringify(json, null, 2))
    }
    if (existsSync(CLAUDE_SETTINGS)) {
      const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'))
      settings.hooks = removeNestedPetHooks(settings.hooks)
      writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n')
    }
    if (existsSync(CODEX_HOOKS_JSON)) {
      const json = JSON.parse(readFileSync(CODEX_HOOKS_JSON, 'utf8'))
      json.hooks = removeNestedPetHooks(json.hooks)
      writeFileSync(CODEX_HOOKS_JSON, JSON.stringify(json, null, 2) + '\n')
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function runShellCommand(
  cmd: string,
  env: NodeJS.ProcessEnv,
  onDone: (ok: boolean, log: string) => void
): void {
  let log = ''
  const child =
    process.platform === 'win32'
      ? spawn(cmd, { shell: true, env })
      : spawn('bash', ['-lc', cmd], { env })
  child.stdout?.on('data', (d) => (log += d))
  child.stderr?.on('data', (d) => (log += d))
  child.on('error', (e) => onDone(false, log + '\n' + e.message))
  child.on('close', (code) => onDone(code === 0, log))
}

/** 按引擎一键安装 CLI（命令来自 engineSetup）。 */
export function installEngineCli(
  engineId: string,
  onDone: (ok: boolean, log: string) => void
): void {
  const guide = getEngineSetupGuide(engineId as EngineSetupId)
  if (!guide) {
    onDone(false, `未知引擎: ${engineId}`)
    return
  }
  const cmd = installCommandForPlatform(guide, process.platform)
  if (!cmd?.trim()) {
    onDone(false, '当前平台不支持一键安装，请按文档手动安装')
    return
  }
  // Dock 启动 PATH 缺 homebrew/nvm；安装脚本与 npm -g 都需要增强 PATH
  void buildAgentEnvAsync()
    .then((env) => runShellCommand(cmd, env, onDone))
    .catch((e) => onDone(false, e instanceof Error ? e.message : String(e)))
}

/** @deprecated 用 installEngineCli('cursor')；保留给旧 IPC。 */
export function installAgent(onDone: (ok: boolean, log: string) => void): void {
  installEngineCli('cursor', onDone)
}

/** Cursor 专用登录（已知 bin 时直调）。 */
export function agentLogin(binPath?: string): void {
  const bin = binPath || join(homedir(), '.local', 'bin', 'cursor-agent')
  const cmd = existsSync(bin) ? bin : 'cursor-agent'
  void buildAgentEnvAsync().then((env) => {
    const child = spawn(cmd, ['login'], { detached: true, stdio: 'ignore', env })
    child.unref()
  })
}

/** 按引擎一键登录（命令来自 engineSetup.loginCmd）。 */
export function engineCliLogin(engineId: string, cursorBinPath?: string): void {
  if (engineId === 'cursor') {
    agentLogin(cursorBinPath)
    return
  }
  const guide = getEngineSetupGuide(engineId as EngineSetupId)
  const loginCmd = guide?.loginCmd?.trim()
  if (!loginCmd) return
  void buildAgentEnvAsync().then((env) => {
    const child =
      process.platform === 'win32'
        ? spawn(loginCmd, { shell: true, detached: true, stdio: 'ignore', env })
        : spawn('bash', ['-lc', loginCmd], { detached: true, stdio: 'ignore', env })
    child.unref()
  })
}
