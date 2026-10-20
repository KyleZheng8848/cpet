import { t as uiText } from '../shared/i18n'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_CATALOG,
  type AgentBackend,
  type EngineDetection,
  isSupportedBackend
} from '../shared/agentBackends'
import { getOpenclawMeta } from './openclawAgent'
import { resolveClaudeBin } from './claudeCodeAgent'
import { getOpencodeMeta } from './opencodeAgent'
import { getSettings, updateSettings } from './store'
import { ensureAugmentedPath, whichBin } from './cliPath'

function firstExisting(paths: string[]): string | undefined {
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return undefined
}

/**
 * 本机实测：cursor-agent/openclaw 的 --version/-v 可耗时 10–40s+。
 * 探测只认「二进制在不在」，版本留给设置页按需拉，绝不能堵发送热路径。
 */
async function detectCursor(): Promise<Pick<EngineDetection, 'installed' | 'binPath' | 'version' | 'note'>> {
  const binPath =
    firstExisting([
      join(homedir(), '.local', 'bin', 'cursor-agent'),
      '/usr/local/bin/cursor-agent',
      '/opt/homebrew/bin/cursor-agent'
    ]) ?? (await whichBin('cursor-agent'))
  if (!binPath) {
    return { installed: false, note: uiText("未安装；可用内置演示模式") }
  }
  return {
    installed: true,
    binPath,
    note: uiText("已就绪")
  }
}

async function detectOpenclaw(): Promise<
  Pick<EngineDetection, 'installed' | 'binPath' | 'version' | 'note'> & { agents: string[] }
> {
  // 跳过 --version（可达 ~10s）；Gateway 探测单独标注（换机常见「有 CLI 无 Gateway」）
  const oc = await getOpenclawMeta({ includeVersion: false, probeGateway: true })
  let note = uiText("未检测到 openclaw / ClawX")
  if (oc.installed) {
    note = oc.gatewayOk
      ? uiText("已就绪（Gateway 可连）")
      : uiText("CLI 已找到，但 Gateway 未连通{0}。请打开 ClawX 或执行 openclaw gateway", [oc.gatewayDetail ? `：${oc.gatewayDetail}` : ''])
  }
  return {
    installed: oc.installed,
    binPath: oc.binPath,
    version: oc.version,
    agents: oc.agents,
    note
  }
}

/** Codex（窗内）：仅 ChatGPT.app / Codex.app / 独立 OpenAI CLI；使用官方 CLI。 */
async function detectCodex(): Promise<Pick<EngineDetection, 'installed' | 'binPath' | 'version' | 'note'>> {
  const { resolveCodexBin, describeCodexBin } = await import('./codexBin')
  const binPath = await resolveCodexBin()
  if (binPath) {
    return {
      installed: true,
      binPath,
      note: describeCodexBin(binPath)
    }
  }
  return { installed: false, note: uiText("未检测到 ChatGPT.app / OpenAI Codex CLI") }
}

/** Claude Code：原生 claude。 */
async function detectClaudeCode(): Promise<
  Pick<EngineDetection, 'installed' | 'binPath' | 'version' | 'note'>
> {
  const binPath = await resolveClaudeBin()
  if (binPath) {
    return {
      installed: true,
      binPath,
      note: uiText("已就绪")
    }
  }
  return { installed: false, note: uiText("未检测到 claude") }
}

async function detectOpencode(): Promise<
  Pick<EngineDetection, 'installed' | 'binPath' | 'version' | 'note'>
> {
  return getOpencodeMeta()
}

/** 扫描全部引擎（并行）。默认不跑 --version，通常 <100ms。 */
export async function detectAllEngines(): Promise<EngineDetection[]> {
  await ensureAugmentedPath()
  const [cursor, openclaw, codex, claude, opencode] = await Promise.all([
    detectCursor(),
    detectOpenclaw(),
    detectCodex(),
    detectClaudeCode(),
    detectOpencode()
  ])
  const byId: Record<AgentBackend, typeof cursor & { agents?: string[] }> = {
    cursor,
    openclaw,
    codex,
    'claude-code': claude,
    opencode
  }
  return AGENT_CATALOG.map((info) => {
    const d = byId[info.id]
    return {
      id: info.id,
      label: info.label,
      shortLabel: info.shortLabel,
      supported: info.supported,
      installed: d.installed,
      binPath: d.binPath,
      version: d.version,
      note: info.supported ? d.note : info.comingSoon ?? d.note
    }
  })
}

function isUsable(engine: EngineDetection): boolean {
  if (!engine.supported) return false
  // Cursor 未安装仍可用 mock
  if (engine.id === 'cursor') return true
  return engine.installed
}

/**
 * 启动时根据本机检测结果挑选 / 校正当前引擎：
 * - 已保存且仍可用 → 保留
 * - 否则优先 Cursor（已装）→ OpenClaw（已装）→ Claude → Cursor（演示）
 */
export async function bootstrapAgentBackend(): Promise<{
  backend: AgentBackend
  engines: EngineDetection[]
  changed: boolean
}> {
  const engines = await detectAllEngines()
  const byId = new Map(engines.map((e) => [e.id, e]))
  const saved = getSettings().agentBackend
  const savedOk = saved && isSupportedBackend(saved) && isUsable(byId.get(saved)!)

  let backend: AgentBackend
  if (savedOk) {
    backend = saved
  } else if (byId.get('cursor')?.installed) {
    backend = 'cursor'
  } else if (byId.get('openclaw')?.installed) {
    backend = 'openclaw'
  } else if (byId.get('claude-code')?.installed) {
    backend = 'claude-code'
  } else if (byId.get('opencode')?.installed) {
    backend = 'opencode'
  } else {
    backend = 'cursor'
  }

  const changed = getSettings().agentBackend !== backend
  if (changed) updateSettings({ agentBackend: backend })
  return { backend, engines, changed }
}
