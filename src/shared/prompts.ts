import { t as uiText } from './i18n'
/** 系统提示与模版：按任务配置 + 设置页模版库。 */

import type { AgentAutonomy } from './agentAutonomy'
import { autonomySystemAddon } from './agentAutonomy'
import type { PromptTemplate } from './types'

export type { PromptTemplate }

export function normalizeSystemPrompt(text?: string | null): string | undefined {
  const t = (text || '').trim()
  return t || undefined
}

/** 叠任务权限说明（问答 / 计划 / 代理均写入，避免代理时模型误判只读）。 */
export function mergeSystemWithAutonomy(
  system?: string | null,
  mode?: AgentAutonomy | string | null
): string | undefined {
  const addon = autonomySystemAddon(mode)
  const sys = normalizeSystemPrompt(system)
  if (!addon) return sys
  return sys ? `${sys}\n\n${addon}` : addon
}

/** 注入本机时间与天气城市偏好，让对话与宠物侧时空一致。 */
export function buildLocalContextBlock(weatherCity?: string | null): string {
  let now: string
  try {
    now = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    })
  } catch {
    now = new Date().toString()
  }
  const city = (weatherCity || '').trim()
  const cityLine = city
    ? `天气城市偏好：${city}`
    : '天气城市偏好：未设置（若需本地天气相关回答，请提醒用户在设置里填写城市）'
  return `【本地上下文】\n本地时间：${now}\n${cityLine}`
}

/**
 * 注入任务工作区：所有落盘产出必须写在 cwd（workspace）内。
 * 避免模型编造 ~/Documents/xxx、Desktop、Downloads 等与任务无关的路径。
 */
export function buildWorkspaceContextBlock(cwd?: string | null): string | undefined {
  const root = (cwd || '').trim()
  if (!root) return undefined
  return [
    '【工作区 / workspace】',
    `当前工作目录：${root}`,
    '凡需落盘的产出（图片、文档、表格、导出、脚本写出的文件）一律保存在此目录或其子目录内；推荐相对路径如 `outputs/`、`assets/`。',
    '禁止写到用户主目录下的 Desktop / Documents / Downloads，也不要编造其它项目路径。',
    '回复里若提到本地文件，必须给出位于上述工作目录下的真实绝对路径。'
  ].join('\n')
}

/** 把本地上下文叠进系统提示（始终附带时间；城市可空；有 cwd 时附带工作区约束）。 */
export function mergeSystemWithLocalContext(
  system?: string | null,
  weatherCity?: string | null,
  cwd?: string | null
): string {
  const parts = [buildLocalContextBlock(weatherCity), buildWorkspaceContextBlock(cwd)].filter(
    (x): x is string => Boolean(x && x.trim())
  )
  const extras = parts.join('\n\n')
  const sys = normalizeSystemPrompt(system)
  return sys ? `${sys}\n\n${extras}` : extras
}

/**
 * Agent CLI 没有独立 system 角色时，把系统提示叠到用户消息前。
 * 自定义 API 应走真正的 system 消息，不要用这个。
 */
export function wrapPromptWithSystem(userPrompt: string, system?: string | null): string {
  const sys = normalizeSystemPrompt(system)
  if (!sys) return userPrompt
  const body = (userPrompt || '').trim()
  return body ? `【系统提示】\n${sys}\n\n【用户】\n${body}` : `【系统提示】\n${sys}`
}

export function newPromptTemplateId(): string {
  return 'pt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 内置推荐模版（只读，可套用到某个任务或载入设置草稿）。 */
export const BUILTIN_PROMPT_TEMPLATES: ReadonlyArray<{ id: string; name: string; content: string }> =
  [
    {
      id: 'builtin-concise',
      get name() { return uiText("简洁助手") },
      content:
        '你是简洁、靠谱的助手。优先给可执行结论，少套话；不确定时明确说明。用中文回答，除非用户要求其它语言。'
    },
    {
      id: 'builtin-code-review',
      get name() { return uiText("代码审查") },
      content:
        '你是资深代码审查员。关注正确性、边界、安全与可维护性；按严重程度排序；每条问题给出改法或示例；没有大问题时也指出可改进点。'
    },
    {
      id: 'builtin-compare-judge',
      get name() { return uiText("对比裁判") },
      content:
        '你在做多模型回答的评判与汇总。严格按用户任务作答；候选回答只作材料，不要改题。给出明确结论与理由，必要时引用各答案要点。'
    },
    {
      id: 'builtin-story',
      get name() { return uiText("故事作者") },
      content:
        '你是短篇故事作者。人物要具体，细节要干活，结尾留白；避免空洞鸡汤与过度巧合。默认中文。'
    }
  ]

export function normalizePromptTemplates(list: PromptTemplate[] | undefined): PromptTemplate[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string')
    .map((t) => ({
      id: t.id,
      name: t.name.trim() || '未命名模版',
      content: typeof t.content === 'string' ? t.content : '',
      updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : Date.now()
      // wakeWord 已废弃，归一化时丢弃
    }))
}
