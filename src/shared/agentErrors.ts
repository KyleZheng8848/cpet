/**
 * 失败文案里的登录命令必须跟实际跑的引擎一致。
 * 按已选引擎给出对应的登录命令。
 */
export function engineLoginHint(engine?: string): string {
  switch (engine) {
    case 'cursor':
      return '`cursor-agent login`'
    case 'claude-code':
      return '`claude` 登录'
    case 'codex':
      return '`codex login`'
    case 'opencode':
      return '`opencode` 登录'
    case 'openclaw':
      return '打开 ClawX 并确认 Gateway 已登录'
    default:
      return '当前任务所用引擎的登录命令（看顶栏选的是哪一个）'
  }
}

/** Agent / CLI 错误是否可建议用户「再试一次」。 */

export function isRetriableAgentError(message: string | undefined | null): boolean {
  const t = (message || '').trim()
  if (!t) return false
  return (
    /WritableIterable\s+is\s+closed/i.test(t) ||
    /RetriableError/i.test(t) ||
    /连接中断|流已关闭|网络抖动|服务端提前断开/i.test(t) ||
    /resource_exhausted|rate.?limit|429|ECONNRESET|ETIMEDOUT|socket hang up/i.test(t) ||
    /长时间无响应|fetch failed/i.test(t)
  )
}

/**
 * RSS 评分/简报模型失败 → 短中文（状态条用，勿贴整段堆栈）。
 * 常见：Node fetch 只抛 `fetch failed`，真实原因在 cause 里。
 */
export function humanizeRssIntelError(raw: string | undefined | null): string {
  const t = (raw || '').replace(/\s+/g, ' ').trim()
  if (!t) return '模型请求失败'
  if (/^fetch failed$/i.test(t) || /\bfetch failed\b/i.test(t)) {
    return '模型连不上（网络/代理/Base URL），已回退规则'
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(t)) {
    return '域名解析失败，检查网络或 Base URL'
  }
  if (/ECONNREFUSED/i.test(t)) return '连接被拒绝，检查 Base URL 端口'
  if (/ECONNRESET|socket hang up/i.test(t)) return '连接被重置，可重试或换网络'
  if (/ETIMEDOUT|aborted|AbortError|超时/i.test(t)) return '模型请求超时'
  if (/API\s*401|Unauthorized|invalid.?api.?key/i.test(t)) return 'API Key 无效或未授权'
  if (/API\s*403|Forbidden/i.test(t)) return 'API 拒绝访问（403）'
  if (/API\s*429|rate.?limit/i.test(t)) return '模型限流，稍后再试'
  if (/API\s*5\d\d/i.test(t)) return '模型服务端出错，稍后再试'
  if (/Agent 未完成|Agent 返回空内容/i.test(t)) {
    return '简报没写出来，先看简版'
  }
  if (/Agent 通道未就绪/i.test(t)) {
    return '简报服务没连上，重启应用或换个模型'
  }
  if (/Agent 超时/i.test(t)) return '写简报超时了，先看简版'
  if (t.length > 96) return `${t.slice(0, 96)}…`
  return t
}
