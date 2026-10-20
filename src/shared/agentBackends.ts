/**
 * Agent 引擎目录：UI / 检测 / 路由共用。
 * 新增引擎：在此登记 → 实现 detect →（可选）实现 runner 并设 supported: true。
 */

export type AgentBackend =
  | 'cursor'
  | 'openclaw'
  | 'codex'
  | 'claude-code'
  | 'opencode'

export interface AgentBackendInfo {
  id: AgentBackend
  /** 菜单 / 托盘全称 */
  label: string
  /** 顶栏下拉短名 */
  shortLabel: string
  /** 是否已接入聊天（可真正跑 prompt） */
  supported: boolean
  /** 未接入时的说明 */
  comingSoon?: string
}

export const AGENT_CATALOG: ReadonlyArray<AgentBackendInfo> = [
  { id: 'cursor', label: 'Cursor Agent', shortLabel: 'Cursor', supported: true },
  { id: 'openclaw', label: 'OpenClaw', shortLabel: 'OpenClaw', supported: true },
  {
    id: 'claude-code',
    label: 'Claude Code',
    shortLabel: 'Claude',
    supported: true
  },
  {
    id: 'codex',
    label: 'Codex',
    shortLabel: 'Codex',
    supported: true
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    shortLabel: 'OpenCode',
    supported: true
  }
]

export function getBackendInfo(id: AgentBackend): AgentBackendInfo {
  return AGENT_CATALOG.find((b) => b.id === id) ?? AGENT_CATALOG[0]
}

export function isSupportedBackend(id: string): id is AgentBackend {
  return AGENT_CATALOG.some((b) => b.id === id && b.supported)
}

export function isKnownBackend(id: string): id is AgentBackend {
  return AGENT_CATALOG.some((b) => b.id === id)
}

/** 单引擎检测结果（启动扫描 + 状态面板）。 */
export interface EngineDetection {
  id: AgentBackend
  label: string
  shortLabel: string
  supported: boolean
  installed: boolean
  binPath?: string
  version?: string
  note?: string
}
