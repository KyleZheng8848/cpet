import { t as uiText } from './i18n'
/** Agent 自治等级：任务级权限，覆盖所有引擎与直连 API。 */

export type AgentAutonomy = 'ask' | 'plan' | 'agent'

export const AGENT_AUTONOMY_OPTIONS: ReadonlyArray<{
  id: AgentAutonomy
  label: string
  short: string
  desc: string
}> = [
  {
    id: 'ask',
    get label() { return uiText("问答") },
    get short() { return uiText("问答") },
    get desc() { return uiText("只读回答：不改文件、不跑会改状态的命令（全引擎生效）") }
  },
  {
    id: 'plan',
    get label() { return uiText("计划") },
    get short() { return uiText("计划") },
    get desc() { return uiText("可分析与出方案，尽量不直接改仓库（全引擎生效）") }
  },
  {
    id: 'agent',
    get label() { return uiText("代理") },
    get short() { return uiText("代理") },
    get desc() { return uiText("可改文件并执行命令（全引擎生效）") }
  }
]

/** 默认走代理：开箱就能改文件/跑命令；需要只读时再手动降到问答/计划。 */
export const DEFAULT_AGENT_AUTONOMY: AgentAutonomy = 'agent'

export function isAgentAutonomy(v: unknown): v is AgentAutonomy {
  return v === 'ask' || v === 'plan' || v === 'agent'
}

export function normalizeAgentAutonomy(v: unknown): AgentAutonomy {
  return isAgentAutonomy(v) ? v : DEFAULT_AGENT_AUTONOMY
}

export function agentAutonomyLabel(mode: AgentAutonomy): string {
  return AGENT_AUTONOMY_OPTIONS.find((o) => o.id === mode)?.label ?? mode
}

/** 叠进系统提示：问答/计划约束行为；代理明确「已授权」，避免模型误说还在问答模式。 */
export function autonomySystemAddon(mode?: AgentAutonomy | string | null): string | undefined {
  const m = normalizeAgentAutonomy(mode)
  if (m === 'ask') {
    return (
      '【任务权限：问答】只读模式。禁止创建/修改/删除文件，禁止执行会改系统状态的命令或安装依赖。' +
      '可以阅读、检索与解释；用文字回答用户。'
    )
  }
  if (m === 'plan') {
    return (
      '【任务权限：计划】可以读代码、分析并给出可执行方案与步骤；' +
      '不要直接改仓库，也不要执行破坏性命令。交付清晰计划即可。'
    )
  }
  // 代理也要写明：Cursor CLI 已是 --force，模型常误以为还在 IDE「问答模式」而拒做
  return (
    '【任务权限：代理】你已在可写 Agent 模式（本客户端已授权改文件与执行命令）。' +
    '请直接完成用户请求；不要声称处于「问答模式」，也不要让用户去 Cursor IDE 切换 Agent 模式。' +
    '若任务属于本应用内的定时/提醒能力，说明应使用应用的「定时任务」面板，而不是推脱权限不足。'
  )
}

/** Cursor CLI：`--mode ask|plan` 或 `--force`。 */
export function cursorAutonomyArgs(mode?: AgentAutonomy | string | null): string[] {
  const m = normalizeAgentAutonomy(mode)
  if (m === 'ask') return ['--mode', 'ask', '--trust']
  if (m === 'plan') return ['--mode', 'plan', '--trust']
  return ['--force', '--trust']
}

/**
 * Claude Code：headless `-p` 不能卡在交互审批。
 * ask/plan → plan（只读）；agent → bypassPermissions（等价跳过审批，否则会一直转圈无输出）。
 */
export function claudeAutonomyArgs(mode?: AgentAutonomy | string | null): string[] {
  const m = normalizeAgentAutonomy(mode)
  if (m === 'ask') {
    return ['--permission-mode', 'plan', '--allowedTools', 'Read,Glob,Grep']
  }
  if (m === 'plan') {
    return ['--permission-mode', 'plan', '--allowedTools', 'Read,Glob,Grep,Agent']
  }
  // headless 必须跳过交互审批，否则会一直转圈且无任何正文
  return ['--dangerously-skip-permissions', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep,Agent']
}

/**
 * Codex 全局参数：必须在 `exec` **之前**。
 * 新版 CLI 把 `--ask-for-approval` 当 global；写在 `exec` 后会报 unexpected argument。
 * headless 必须 `never`，否则会挂起等批准 → 界面「一直转、没字」。
 */
export function codexGlobalAutonomyArgs(_mode?: AgentAutonomy | string | null): string[] {
  return ['--ask-for-approval', 'never']
}

/**
 * Codex `exec` 子命令参数：sandbox 可写在 `exec` 之后。
 * ask/plan → read-only；agent → workspace-write。
 */
export function codexExecAutonomyArgs(mode?: AgentAutonomy | string | null): string[] {
  const m = normalizeAgentAutonomy(mode)
  if (m === 'ask' || m === 'plan') return ['--sandbox', 'read-only']
  return ['--sandbox', 'workspace-write']
}

/**
 * Codex thread id：官方 resume 要 UUID（含 UUIDv7）。
 * CPET 里换模型后常残留 `openai-…::custom-api:…` 这类假 session —— 绝不能拿去 resume。
 */
export function isCodexResumableSessionId(id: string | undefined | null): boolean {
  if (!id || typeof id !== 'string') return false
  const s = id.trim()
  if (!s || s.includes('::') || s.includes('/') || /\s/.test(s)) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/**
 * 拼窗内 OpenAI / ChatGPT `codex … exec …` 参数表。
 *
 * 新版 CLI（ChatGPT.app 内嵌）语法：
 *   codex [global] exec [OPTIONS] [PROMPT]
 *   codex [global] exec [OPTIONS] resume [SESSION] [PROMPT]
 * `--sandbox` / `--json` 必须在 `resume` **之前**（exec 的 OPTIONS），写在 resume 后会直接报 unexpected argument。
 */
function codexImageArgs(images?: string[]): string[] {
  const list = (images || []).map((p) => p.trim()).filter(Boolean)
  if (!list.length) return []
  // 路径含逗号时不能用 CSV；重复 --image。否则用一个 CSV，避免旧 CLI 把 prompt 吞成图片路径。
  if (list.some((p) => p.includes(','))) {
    return list.flatMap((p) => ['--image', p])
  }
  return ['--image', list.join(',')]
}

export function buildCodexExecArgv(opts: {
  autonomy?: AgentAutonomy | string | null
  prompt: string
  sessionId?: string
  model?: string
  /** 如 `['--codex']`：插在全局 flag 之前。 */
  prefix?: string[]
  /** 原生看图：`codex exec --image a.png,b.png`。 */
  images?: string[]
}): string[] {
  const global = codexGlobalAutonomyArgs(opts.autonomy)
  const execFlags = codexExecAutonomyArgs(opts.autonomy)
  const model =
    opts.model && opts.model !== 'default' && opts.model !== 'auto'
      ? ['--model', opts.model]
      : []
  const resumeId = isCodexResumableSessionId(opts.sessionId) ? opts.sessionId!.trim() : undefined
  const imageArgs = codexImageArgs(opts.images)
  return [
    ...(opts.prefix || []),
    ...global,
    'exec',
    '--json',
    '--skip-git-repo-check',
    ...execFlags,
    ...model,
    ...imageArgs,
    ...(resumeId ? (['resume', resumeId] as const) : []),
    ...(imageArgs.length ? (['--'] as const) : []),
    opts.prompt
  ]
}

/** @deprecated 请用 buildCodexExecArgv / 拆开的 global+exec；顺序已不适配新 CLI。 */
export function codexAutonomyArgs(mode?: AgentAutonomy | string | null): string[] {
  return [...codexGlobalAutonomyArgs(mode), ...codexExecAutonomyArgs(mode)]
}

/**
 * OpenCode headless：
 * - agent：`--auto` 批非 deny 权限
 * - plan：走内置 plan agent（偏只读规划）
 * - ask：不加 --auto；配合 OPENCODE_PERMISSION 禁写/禁 shell，避免等人确认而挂死
 */
export function opencodeAutonomyArgs(mode?: AgentAutonomy | string | null): string[] {
  const m = normalizeAgentAutonomy(mode)
  if (m === 'plan') return ['--agent', 'plan']
  if (m === 'agent') return ['--auto']
  return []
}

/** ask 模式注入的权限 JSON；其余模式返回 undefined（不设 env）。 */
export function opencodePermissionEnv(mode?: AgentAutonomy | string | null): string | undefined {
  const m = normalizeAgentAutonomy(mode)
  if (m !== 'ask') return undefined
  return JSON.stringify({
    edit: 'deny',
    write: 'deny',
    bash: 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow'
  })
}
