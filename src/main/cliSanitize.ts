/**
 * CLI 输出清洗：去掉 ANSI / 终端控制序列，过滤 TUI 装饰行。
 * Claude / Codex 在非交互模式下仍可能往 stdout 喷光标控制、品牌符号。
 */

import { engineLoginHint } from '../shared/agentErrors'

/** 去掉 CSI / OSC 等控制序列（含 \x1b[?25h 显隐光标）。 */
export function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\[[\d;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\r/g, '')
}

/** 明显不是模型正文的行（品牌、空壳、纯控制残留）。 */
export function isCliNoiseLine(line: string): boolean {
  const t = stripAnsi(line).trim()
  if (!t) return true
  // 品牌 / TUI 装饰
  // 必须带 u 标志：否则 emoji 被拆成代理对半个字符，
  // 任何共用高位代理的 emoji（如 🐽 与 🐼 同为 \ud83d 开头）都可能被误判成噪音而丢掉模型正文。
  if (/^[🐼🐾🤖✨●○◉◎]+$/u.test(t)) return true
  // 登录态黄字提示（已 strip 颜色后仍可能残留）
  if (/登录态失效|已忽略默认引擎|\/engine\s*切换/.test(t)) return true
  // 纯控制残留
  if (/^\[\??\d*[hl]$/.test(t)) return true
  return false
}

/** 清洗一行并判断是否可尝试当 JSON / 正文。 */
export function cleanCliLine(line: string): string | null {
  const t = stripAnsi(line).trim()
  if (!t || isCliNoiseLine(t)) return null
  return t
}

/**
 * 清洗整段回复：去掉品牌行 / ANSI，避免 JSON content 里夹带 🐼。
 *
 * 注意与 isCliNoiseLine 的差别：那个函数按行判断能否当 JSON/正文，空行对它是噪音；
 * 但这里处理的是整段 Markdown，空行承载分段语义（段落之间、列表之前、代码块内部）。
 * 一律按噪音删掉会把模型回复糊成一坨，代码块里的空行还会被改掉内容。
 */
export function stripContentChrome(text: string): string {
  const kept: string[] = []
  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const l = line.trimEnd()
    if (!l) {
      kept.push('')
      continue
    }
    if (isCliNoiseLine(l)) continue
    kept.push(l)
  }
  return kept.join('\n').replace(/^\s*🐼\s*/u, '').trim()
}

/**
 * 把 Agent CLI 内部噪声错误翻成用户可读说明。
 * 例如 cursor-agent / Bun：RetriableError: WritableIterable is closed
 */
export function humanizeAgentError(raw: string, engine?: string): string {
  const t = stripAnsi(raw).trim()
  if (!t) return 'Agent 出错了'

  // OpenCode 自定义 API 错误已在 runner 里写好人话，勿再改写成 Gateway/OpenAI 提示
  if (/^OpenCode\b/.test(t)) {
    return t.length > 600 ? `${t.slice(0, 600)}…` : t
  }

  if (/WritableIterable\s+is\s+closed/i.test(t) || /RetriableError/i.test(t)) {
    return (
      'Cursor Agent 对话流中断（WritableIterable closed）。' +
      '若上方已有完整回答，可忽略本提示；否则点「再试一次」，或检查 cursor-agent 登录。'
    )
  }
  if (/Quota exceeded|plan and billing|resource_exhausted|rate.?limit|429/i.test(t)) {
    if (engine === 'codex') {
      return (
        'Codex/OpenAI 额度不足或限流。请到平台充值/换套餐，或在终端执行 `codex login` 换成 ChatGPT 账号登录后重试。'
      )
    }
    return `额度不足或限流。请到对应平台处理，或重新执行 ${engineLoginHint(engine)} 后再试。`
  }
  if (/422/.test(t) && /限额|额度|token/i.test(t)) {
    return 'API 422：Token/月额度已用完或不可用，请换账号、充值，或换其它模型。'
  }
  if (/登录态失效|Authentication required|请先.*登录|\/engine\s*切换/i.test(t)) {
    return `引擎登录已失效。请执行 ${engineLoginHint(engine)} 完成鉴权后，回 CPET 刷新再试。`
  }
  if (
    /stream disconnected|Network is down|api\.openai\.com|error sending request for url|ENETUNREACH|EHOSTUNREACH/i.test(
      t
    )
  ) {
    return (
      '连不上 OpenAI（api.openai.com）。请检查代理/VPN/防火墙后重试；' +
      'ChatGPT 桌面端若能聊，确认系统代理对终端进程也生效。'
    )
  }
  if (/离线|无法连接|ECONNREFUSED|ENOTFOUND|connect\s+(E|failed)|gateway.*not|connection\s+refused/i.test(t)) {
    return (
      '本地服务连不上（Gateway / 离线引擎未启动或版本过旧）。' +
      '请先打开对应客户端或执行 gateway，再回 CPET 重跑该列。'
    )
  }
  if (
    /model .+ not found|unknown model|invalid model|不支持的模型|模型不存在|no such model/i.test(t)
  ) {
    return '当前引擎不支持该模型。请到设置「刷新并同步选单」，去掉无效模型后再对比。'
  }
  if (/ENOENT|command not found|not found|未检测到|未安装/i.test(t) && t.length < 280) {
    return `${t}\n\n提示：换机后常见 PATH/未安装。可在设置刷新引擎，或终端确认 CLI 可运行。`
  }
  if (/unauthorized|auth(entication)?\s*(failed|error)|not\s*logged\s*in|login/i.test(t)) {
    return '未登录或登录已失效，请在终端执行对应 CLI 的 login 后重试。'
  }

  // 过长 stderr 截断，避免整屏堆栈
  return t.length > 600 ? `${t.slice(0, 600)}…` : t
}

/** 子进程环境：剥离 Electron 泄漏变量，尽量抑制彩色与交互 TUI。 */
export function buildQuietCliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(env)) {
    if (key.startsWith('ELECTRON_') || key === 'ATOM_SHELL_INTERNAL_RUN_AS_NODE') {
      delete env[key]
    }
  }
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  env.TERM = 'dumb'
  env.CI = '1'
  return env
}
