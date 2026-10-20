import { t as uiText } from './i18n'
/**
 * 各引擎在新环境的安装 / 登录 / 文档指引。
 * UI（设置·引擎安装助手）与空状态共用，避免新机变成「空壳」。
 */

import type { AgentBackend } from './agentBackends'

export type EngineSetupId = AgentBackend | 'custom-api'

export interface EngineSetupGuide {
  id: EngineSetupId
  label: string
  /** 一句话：这引擎干什么 */
  blurb: string
  /** 官方/文档页（可 openExternal） */
  docsUrl?: string
  /** macOS / Linux 安装命令 */
  installCmd?: string
  /** Windows 提示（多数需手动） */
  installHintWin?: string
  /** 登录 / 鉴权命令 */
  loginCmd?: string
  /** 装完还要做什么 */
  nextSteps: string
  /**
   * 应用内可代劳的动作：
   * - cli-install / cli-login：通用一键安装 / 登录（按 installCmd / loginCmd）
   * - cursor-install / cursor-login：历史别名（等同 cli，仅 Cursor 卡片）
   */
  appAssist?: Array<
    | 'cli-install'
    | 'cli-login'
    | 'cursor-install'
    | 'cursor-login'
    | 'hooks'
    | 'open-api-settings'
  >
}

export const ENGINE_SETUP_GUIDES: ReadonlyArray<EngineSetupGuide> = [
  {
    id: 'cursor',
    label: 'Cursor Agent CLI',
    get blurb() { return uiText("在 CPET 窗口里用 Cursor 引擎对话（≠ 只装 Cursor 应用）。") },
    docsUrl: 'https://cursor.com/docs',
    installCmd: 'curl https://cursor.com/install -fsS | bash',
    installHintWin: '在 Git Bash / WSL 执行官方安装脚本，或从 Cursor 文档安装 CLI。',
    loginCmd: 'cursor-agent login',
    get nextSteps() { return uiText("安装后必须再登录一次（浏览器授权）。只想让宠物跟 IDE 动：配置「联动」即可，不必装 CLI。") },
    appAssist: ['cursor-install', 'cursor-login', 'hooks']
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    get blurb() { return uiText("本机 Gateway + agent；适合已有 ClawX / openclaw 的环境。") },
    docsUrl: 'https://docs.openclaw.ai',
    installCmd: 'npm install -g openclaw',
    installHintWin: '也可安装 ClawX 桌面端；确保 Gateway 在跑。',
    loginCmd: undefined,
    get nextSteps() { return uiText("安装后必须启动 Gateway（打开 ClawX 或 `openclaw gateway`）。设置里若显示「CLI 已找到但 Gateway 未连通」，先起 Gateway 再刷新。") },
    appAssist: ['cli-install']
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    get blurb() { return uiText("Anthropic 官方 CLI。") },
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    installHintWin: '需已安装 Node.js，然后在终端执行 npm 安装命令。',
    loginCmd: 'claude auth login',
    get nextSteps() { return uiText("在终端登录后回 CPET 点「刷新并同步选单」。若终端能跑但 CPET 找不到，多半是 Dock 启动 PATH 问题——刷新即可（CPET 会合并登录 shell PATH）。") },
    appAssist: ['cli-install', 'cli-login', 'hooks']
  },
  {
    id: 'codex',
    label: 'Codex',
    get blurb() { return uiText("OpenAI / ChatGPT Codex：优先用 ChatGPT.app 内嵌 CLI；也可用独立 `@openai/codex`。") },
    docsUrl: 'https://github.com/openai/codex',
    installCmd: 'npm install -g @openai/codex',
    installHintWin: '需已安装 Node.js，然后在终端执行 npm 安装命令；或安装 ChatGPT / Codex 桌面端。',
    loginCmd: 'codex login',
    get nextSteps() { return uiText("窗内「Codex」只接 ChatGPT.app / OpenAI CLI（设置里应显示「ChatGPT.app 内嵌 CLI」）。登录后刷新模型列表，再点「配置联动」写 hooks。") },
    appAssist: ['cli-install', 'cli-login', 'hooks']
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    get blurb() { return uiText("开源 coding Agent：多模型 BYOK，支持把 CPET 自定义 API 注入为 provider。") },
    docsUrl: 'https://opencode.ai/docs/',
    installCmd: 'curl -fsSL https://opencode.ai/install | bash',
    installHintWin: '可用 npm i -g opencode-ai，或从 GitHub Releases 下载 Windows 二进制并加入 PATH。',
    loginCmd: 'opencode auth login',
    get nextSteps() { return uiText("可点「一键安装 CLI」。装好后可用「一键登录」，或只配 CPET 自定义 API（会自动注入）。刷新模型选单后选 OpenCode。") },
    appAssist: ['cli-install', 'cli-login']
  },
  {
    id: 'custom-api',
    get label() { return uiText("自定义 API") },
    get blurb() { return uiText("不装 CLI：填 OpenAI / Anthropic 兼容的 baseUrl + API Key。") },
    docsUrl: undefined,
    installCmd: undefined,
    get nextSteps() { return uiText("在设置 → API 模型提供商添加；填密钥后新建任务选对应模型。适合公司内网或云 API。") },
    appAssist: ['open-api-settings']
  }
]

export function getEngineSetupGuide(id: EngineSetupId): EngineSetupGuide | undefined {
  return ENGINE_SETUP_GUIDES.find((g) => g.id === id)
}

export function installCommandForPlatform(
  guide: EngineSetupGuide,
  platform: string
): string | undefined {
  if (platform === 'win32') {
    // Windows 一键安装优先 npm（不依赖 bash / curl 管道）
    if (guide.id === 'opencode') return 'npm install -g opencode-ai'
    if (guide.id === 'claude-code') return 'npm install -g @anthropic-ai/claude-code'
    if (guide.id === 'codex') return 'npm install -g @openai/codex'
    if (guide.id === 'openclaw') return 'npm install -g openclaw'
    if (guide.id === 'cursor') return undefined // 仍建议 WSL/文档；保留 installHintWin
    return guide.installCmd
  }
  return guide.installCmd
}

/** 是否展示一键安装（有可执行安装命令即可）。 */
export function canOneClickInstall(guide: EngineSetupGuide, platform: string): boolean {
  const assist = guide.appAssist ?? []
  if (!assist.includes('cli-install') && !assist.includes('cursor-install')) return false
  return Boolean(installCommandForPlatform(guide, platform))
}

/** 是否展示一键登录。 */
export function canOneClickLogin(guide: EngineSetupGuide): boolean {
  const assist = guide.appAssist ?? []
  if (!assist.includes('cli-login') && !assist.includes('cursor-login')) return false
  return Boolean(guide.loginCmd?.trim())
}
