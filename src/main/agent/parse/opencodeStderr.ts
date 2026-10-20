/**
 * OpenCode 在 API 失败时往往不写 JSONL error，只打内部 log（需 --print-logs）。
 * 从 stderr 抽取可立刻 fail-closed 的致命错误文案。
 */
import { stripAnsi } from '../../cliSanitize'

export function extractOpencodeFatalError(stderr: string): string | undefined {
  const t = stripAnsi(stderr || '')
  if (!t.trim()) return undefined

  for (const line of t.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    const api = s.match(/AI_APICallError:\s*(.+)/i)
    if (api?.[1]) {
      const detail = api[1].replace(/\s+/g, ' ').trim().slice(0, 220)
      return `OpenCode 调用模型失败：${detail}（请检查自定义 API 的 baseUrl / Key / 模型 id）`
    }
    if (/Cannot connect to API/i.test(s)) {
      return 'OpenCode 连不上自定义 API（检查 baseUrl、网络与防火墙）'
    }
    if (/invalid.?api.?key|incorrect.?api.?key|unauthorized|401\b/i.test(s)) {
      return 'OpenCode：API Key 无效或未授权，请到设置检查自定义提供商'
    }
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network.?error/i.test(s)) {
      return `OpenCode 网络错误：${s.slice(0, 200)}`
    }
    if (/model .+ not found|unknown model|provider .+ not found/i.test(s)) {
      return `OpenCode：${s.slice(0, 240)}`
    }
  }

  if (/stream error/i.test(t) && /AI_APICallError|Cannot connect|Unauthorized|ECONNREFUSED/i.test(t)) {
    return 'OpenCode 调用自定义 API 失败（请检查提供商地址与 Key）'
  }
  return undefined
}
