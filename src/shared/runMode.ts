import { t as uiText } from './i18n'
/** 当前任务会走真实引擎 / API，还是演示（Mock）。 */

import { ensureBuiltinProviders, isAgentModelRef, parseModelRef } from './models'
import type { AgentStatus, ModelProvider } from './types'

export type RunMode = 'demo' | 'agent' | 'api'

export function resolveRunMode(
  status: AgentStatus | null | undefined,
  providers: ModelProvider[] | undefined,
  modelRef: string
): RunMode {
  const ref = (modelRef || '').trim()
  if (!ref) return status?.usingMock ? 'demo' : 'agent'

  if (!isAgentModelRef(providers, ref)) {
    const { provider } = parseModelRef(ref)
    const p = ensureBuiltinProviders(providers).find((x) => x.id === provider)
    return p?.apiKey?.trim() ? 'api' : 'demo'
  }

  const { provider } = parseModelRef(ref)
  const eng = status?.engines?.find((e) => e.id === provider)
  if (eng?.installed) return 'agent'
  // 兼容旧字段：cursor 的 installed
  if (provider === 'cursor' && status?.installed) return 'agent'
  if (provider === 'openclaw' && status?.openclawInstalled) return 'agent'
  return 'demo'
}

export function runModeLabel(mode: RunMode): string {
  if (mode === 'demo') return uiText("演示模式")
  if (mode === 'api') return uiText("API 直连")
  return uiText("真实引擎")
}

export const DEMO_SEND_CONFIRM =
  uiText("当前选的引擎在本机未就绪，将使用演示回复（不会改文件）。\n\n只装了 Cursor？配置 IDE 联动即可让宠物跟着 IDE 动，不必装 cursor-agent。\n想在本窗口真实对话：换其它引擎，或安装并登录 cursor-agent CLI。\n\n仍要发送演示回复吗？")
