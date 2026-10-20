import { t as uiText } from '@shared/i18n'
/**
 * Agent 失败信息 → 人话 + 下一步 + 可跳转的修复入口。
 *
 * 两个窗口（对话窗气泡 / 宠物头顶气泡）都从这里取文案，避免同一个故障出现两套说法。
 * 纯函数，不碰 DOM，便于在 tests/ 下直接断言。
 */

import { engineLoginHint, isRetriableAgentError } from '@shared/agentErrors'

/** 修复入口：由 UI 决定怎么跳（设置分区 / 目录选择器）。 */
export type AgentErrorFix = 'engine-setup' | 'api-config' | 'model-config' | 'pick-dir' | 'none'

export interface AgentErrorInfo {
  /** 一句话说清发生了什么（不含堆栈、不含 JSON）。 */
  summary: string
  /** 用户可以照着做的下一步，最多 3 条。 */
  steps: string[]
  fix: AgentErrorFix
  /** 是否值得原样再发一次（限流 / 抖动 / 超时）。 */
  retriable: boolean
  /** 排查用的原始信息（已抽正文、去噪、截断）；无更多信息时为空串。 */
  detail: string
}

const DETAIL_MAX = 220

/** HTTP 报错正文往往是一整个 JSON，取出人能读的那句。 */
function extractApiMessage(body: string): string {
  const t = body.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return t
  try {
    const obj = JSON.parse(t) as Record<string, any>
    const err = obj.error ?? obj
    const msg = err?.message ?? err?.msg ?? obj.message ?? (typeof err === 'string' ? err : '')
    return typeof msg === 'string' && msg.trim() ? msg.trim() : t
  } catch {
    return t
  }
}

/** `API 401: {...}` / `Anthropic API 429: …` → 状态码 + 可读正文。 */
function parseHttpFailure(raw: string): { status: number; message: string } | null {
  const m = raw.match(/^(?:[A-Za-z]+\s+)?API\s+(\d{3})\s*[:：]\s*([\s\S]*)$/)
  if (!m) return null
  return { status: Number(m[1]), message: extractApiMessage(m[2]) }
}

function clamp(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}…` : t
}

/**
 * 把任意一条失败信息归类成用户能自救的说明。
 *
 * 判定顺序即优先级：越具体、越可操作的规则必须排在通用规则前面
 * （例如 Gateway 未连通要挡在「网络不通」之前，否则用户会被引到错误的修复路径）。
 */
export function describeAgentError(raw: string | undefined | null, engine?: string): AgentErrorInfo {
  const text = (raw ?? '').trim()
  const http = parseHttpFailure(text)
  const probe = http ? `${http.status} ${http.message}` : text
  const detail = http ? clamp(`HTTP ${http.status} · ${http.message}`) : clamp(text)
  const retriable = isRetriableAgentError(text)

  if (!text) {
    return {
      summary: uiText("这一轮失败了，但引擎没说原因"),
      steps: [uiText("点「重试」再发一次"), uiText("还是失败就换个模型，或去设置检查引擎状态")],
      fix: 'none',
      retriable: true,
      detail: ''
    }
  }

  if (/未设置工作目录|选择项目工作目录/.test(text)) {
    return {
      summary: uiText("还没选好工作目录，这一轮没有真正跑起来"),
      steps: [
        uiText("点顶栏的「选目录」，挑一个具体的项目文件夹"),
        uiText("不能用用户主目录：Agent 有写权限，选主目录风险太大")
      ],
      fix: 'pick-dir',
      retriable: false,
      detail
    }
  }

  if (/还有请求在进行中/.test(text)) {
    return {
      summary: uiText("这个任务上一轮还没结束"),
      steps: [uiText("等它跑完，或先点 ■ 停止"), uiText("不想等的话，新建一个任务并行跑")],
      fix: 'none',
      retriable: false,
      detail: ''
    }
  }

  if (/Gateway|gateway/.test(text) && /未连通|连不上|not\s|refused/i.test(text)) {
    return {
      summary: uiText("本地 Gateway 没连上，请求发不出去"),
      steps: [uiText("先打开对应客户端（ClawX 等）或手动启动 gateway"), uiText("起来之后回来点「重试」")],
      fix: 'engine-setup',
      retriable: true,
      detail
    }
  }

  if (
    /需要先登录|登录态失效|登录已失效|引擎登录|未登录|请先.*登录|完成鉴权|not\s*logged\s*in|Authentication required/i.test(
      text
    )
  ) {
    const sniffed =
      engine ||
      (/cursor-agent/.test(text)
        ? 'cursor'
        : /codex/i.test(text)
          ? 'codex'
          : /claude/i.test(text)
            ? 'claude-code'
            : /opencode/i.test(text)
              ? 'opencode'
              : undefined)
    const login = engineLoginHint(sniffed)
    return {
      summary: uiText("这个引擎还没登录，或登录已过期"),
      steps: [
        uiText("在系统终端跑一次 {0}", [login]),
        uiText("登录完回设置点「刷新引擎状态」，再点「重试」")
      ],
      fix: 'engine-setup',
      retriable: false,
      detail
    }
  }

  if (/未检测到|未安装|ENOENT|command not found|no such file or directory/i.test(text)) {
    return {
      summary: uiText("找不到对应的 Agent 命令：没装，或 CPET 看不到它所在的 PATH"),
      steps: [
        uiText("去设置的「引擎与联动」用安装助手装一个"),
        uiText("已经装过：在终端确认 `--version` 能跑，再回设置点刷新"),
        uiText("不想装 CLI：在模型选单里换成直连 API 的模型")
      ],
      fix: 'engine-setup',
      retriable: false,
      detail
    }
  }

  if (/未配置 API Key|未配置 Base URL|未找到自定义提供商/.test(text)) {
    return {
      summary: uiText("这个提供商的连接信息还没填完"),
      steps: [uiText("去设置的「自定义 API」补上 Base URL 和 API Key"), uiText("保存后回来点「重试」")],
      fix: 'api-config',
      retriable: false,
      detail
    }
  }

  if (
    /invalid[_\s-]?api[_\s-]?key|incorrect api key|api key/i.test(probe) ||
    (http != null && (http.status === 401 || http.status === 403))
  ) {
    return {
      summary: uiText("API Key 被服务端拒了（填错、过期，或没有这个模型的权限）"),
      steps: [
        uiText("去设置的「自定义 API」核对 API Key 与 Base URL 是否属于同一家"),
        uiText("Key 没问题的话，确认账号是否开通了所选模型")
      ],
      fix: 'api-config',
      retriable: false,
      detail
    }
  }

  if (/429|rate.?limit|resource_exhausted|insufficient_quota|额度|限额|quota/i.test(probe)) {
    return {
      summary: uiText("被限流或额度用完了"),
      steps: [uiText("等几十秒再点「重试」"), uiText("经常撞限流就去设置换一个提供商或模型")],
      fix: 'none',
      retriable: true,
      detail
    }
  }

  if (/model .+ not found|unknown model|invalid[_\s]?model|不支持的模型|模型不存在|no such model/i.test(probe)) {
    return {
      summary: uiText("当前引擎不认识这个模型"),
      steps: [uiText("去设置的「模型配置」点刷新同步选单"), uiText("把失效的模型取消勾选，换一个再发")],
      fix: 'model-config',
      retriable: false,
      detail
    }
  }

  if (http != null && http.status >= 500) {
    return {
      summary: uiText("模型服务端自己出错了（HTTP {0}）", [http.status]),
      steps: [uiText("稍等片刻点「重试」"), uiText("持续 5xx 说明是对方的问题，可以先换个提供商")],
      fix: 'none',
      retriable: true,
      detail
    }
  }

  if (
    /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|getaddrinfo|network error/i.test(
      text
    )
  ) {
    return {
      summary: uiText("网络没通：域名解析、代理或服务端有一环断了"),
      steps: [
        uiText("确认本机能上网；挂代理/VPN 时确认 Base URL 走得通"),
        uiText("恢复后点「重试」，已生成的内容不会丢")
      ],
      fix: 'none',
      retriable: true,
      detail
    }
  }

  if (/长时间无响应|超过时限|超时未返回|自动中止/.test(text)) {
    return {
      summary: uiText("引擎太久没有任何输出，已自动中止"),
      steps: [uiText("点「重试」"), uiText("每次都卡在同一步：换个模型，或把需求拆成更小的一步")],
      fix: 'none',
      retriable: true,
      detail
    }
  }

  if (/未返回可见内容|没有可见内容/.test(text)) {
    return {
      summary: uiText("引擎跑完了，但一个字都没输出"),
      steps: [uiText("点「重试」"), uiText("仍然空白：确认所选 agent 已配好模型，或换一个模型")],
      fix: 'none',
      retriable: true,
      detail
    }
  }

  if (/WritableIterable|RetriableError|流已关闭|连接中断/i.test(text)) {
    return {
      summary: uiText("对话流被提前掐断了（上面若已有完整回答可以忽略）"),
      steps: [uiText("答案不完整就点「重试」"), uiText("反复出现：检查引擎登录状态或换个模型")],
      fix: 'none',
      retriable: true,
      detail
    }
  }

  return {
    summary: uiText("这一轮失败了"),
    steps: retriable
      ? [uiText("看起来是临时故障，点「重试」"), uiText("连续失败就换个模型，或看下面的原始信息")]
      : [uiText("点「重试」再发一次"), uiText("还是不行就换个模型，或按下面的原始信息排查")],
    fix: 'none',
    retriable,
    detail
  }
}

/** 提示段首行的特征：引用块 + ⚠️ + 加粗标题，用于把它从「模型说过的话」里剔除。 */
const ERROR_NOTICE_HEAD = /^\s*>\s*⚠️\s*\*\*/

/** 写进 assistant 气泡的提示文本（Markdown 引用块，人话在最前）。 */
export function formatAgentErrorNotice(info: AgentErrorInfo): string {
  const lines = [`> ⚠️ **${info.summary}**`]
  if (info.steps.length) {
    lines.push('>')
    for (const step of info.steps) lines.push(`> - ${step}`)
  }
  if (info.detail) {
    lines.push('>')
    lines.push(`> 原始信息：${info.detail}`)
  }
  return `\n\n${lines.join('\n')}`
}

/**
 * 剔除由 formatAgentErrorNotice 写入的提示段。
 *
 * 这段是 CPET 自己说的话，不能作为 assistant 回复喂回多轮上下文，
 * 否则模型下一轮会对着「我上次报错了」道歉或自我修正。
 */
export function stripAgentErrorNotice(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  let dropping = false
  for (const line of lines) {
    const isQuote = /^\s*>/.test(line)
    if (dropping) {
      if (isQuote) continue
      dropping = false
    }
    if (ERROR_NOTICE_HEAD.test(line)) {
      dropping = true
      continue
    }
    kept.push(line)
  }
  return kept.join('\n').trim()
}
