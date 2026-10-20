/**
 * 从内置 skill `cpet-rss-digest` 加载简报写稿 system prompt。
 * 真源：.cursor/skills/cpet-rss-digest/{references/craft.md, forms/<template>.md}
 */
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBundledSkillsRoots } from '../shared/bundledSkills'
import {
  RSS_DIGEST_TEMPLATES,
  type RssDigestTemplate
} from '../shared/rssTask'

const SKILL_ID = 'cpet-rss-digest'

const promptCache = new Map<RssDigestTemplate, string>()

function projectRootFallback(): string {
  // electron-vite 打包后 __dirname ≈ out/main；vitest 下 ≈ src/main → 上两级都是仓库根
  return join(__dirname, '../..')
}

function skillRoots(): string[] {
  // 单测里 electron.app 可能未注入
  const isPackaged = Boolean(app?.isPackaged)
  const roots = resolveBundledSkillsRoots({
    isPackaged,
    resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    projectRoot: isPackaged ? undefined : projectRootFallback()
  })
  const cwdRoot = join(process.cwd(), '.cursor', 'skills')
  if (!roots.includes(cwdRoot)) roots.push(cwdRoot)
  return roots
}

function readSkillRel(rel: string): string | null {
  for (const root of skillRoots()) {
    const full = join(root, SKILL_ID, rel)
    if (!existsSync(full)) continue
    try {
      const text = readFileSync(full, 'utf8').trim()
      if (text) return text
    } catch {
      /* try next root */
    }
  }
  return null
}

/** 磁盘缺失时的紧凑回落（保持可生成；正式环境应始终命中 skill 文件）。 */
function fallbackPrompt(template: RssDigestTemplate): string {
  const common = [
    '你是资深科技/行业资讯主编。根据给定条目写中文 Markdown「简报」，不是条目清单。',
    '硬性要求：',
    '1. 第一行 # 短标题（10–22 字，自拟主线，禁套话与 · 拼接）。',
    '2. 第二行 信息窗口：……（照抄用户消息）。',
    '3. 要点只用 ●；文内与文末资料来源均用 Markdown 链接；禁止编造 URL。',
    '4. 禁止 Top 话题 / 可略过噪音 / 空洞「持续关注」。',
    '',
    `（警告：未找到 skill ${SKILL_ID}/forms/${template}.md，使用回落提示。）`
  ].join('\n')
  const shapes: Record<RssDigestTemplate, string> = {
    brief:
      '形态 brief：## 必读头条（4–10，● **对象+利害** — 背景 + 链接；宁缺毋滥）→ ## 资料来源',
    daily:
      '形态 daily：## 今日主线（恰好 3）→ ## 今天优先（1）→ ## 资料来源（3–6）',
    flash: '形态 flash：## 快讯（5–12 行一事；宁缺毋滥）→ ## 资料来源',
    followup:
      '形态 followup：## 关键信号 → ## 为什么重要 → ## 该盯谁/盯什么 → ## 资料来源',
    risks: '形态 risks：## 风险与争议（● **[类型] …**）→ ## 紧迫度 → ## 资料来源',
    action: '形态 action：## 本周行动（动词开头）→ ## 观望项 → ## 资料来源',
    full: '形态 full：## 本期概览（6–10）→ 若干 ## 主题 + ### 事件 → ## 资料来源',
    changes: '形态 changes：## 本时段变动（强调变了什么）→ ## 资料来源',
    wechat: '形态 wechat：## 导语 → ## 正文（###）→ ## 结语 → ## 资料来源',
    xhs: '形态 xhs：## 封面钩子（3）→ ## 正文要点 → ## 互动引导 → ## 资料来源',
    report: '形态 report：## 核心结论 → ## 论据拆解 → ## 风险与不确定 → ## 资料来源',
    script: '形态 script：## 开场白 → ## 分镜口播 → ## 收束 CTA → ## 资料来源'
  }
  return `${common}\n${shapes[template]}`
}

/**
 * 拼装写稿 system prompt = craft + 形态文件。
 * 结果按模板缓存；测试可调用 clearRssDigestSkillCache。
 */
export function loadRssDigestSystemPrompt(template: RssDigestTemplate): string {
  const cached = promptCache.get(template)
  if (cached) return cached

  const craft = readSkillRel('references/craft.md')
  const form = readSkillRel(`forms/${template}.md`)
  const prompt =
    craft && form
      ? `${craft}\n\n---\n\n${form}`
      : fallbackPrompt(template)

  promptCache.set(template, prompt)
  return prompt
}

export function clearRssDigestSkillCache(): void {
  promptCache.clear()
}

/** 供测试：确认 12 形态文件均可读。 */
export function assertRssDigestSkillFilesPresent(): {
  ok: boolean
  missing: string[]
} {
  const missing: string[] = []
  if (!readSkillRel('references/craft.md')) missing.push('references/craft.md')
  if (!readSkillRel('SKILL.md')) missing.push('SKILL.md')
  for (const id of RSS_DIGEST_TEMPLATES) {
    if (!readSkillRel(`forms/${id}.md`)) missing.push(`forms/${id}.md`)
  }
  return { ok: missing.length === 0, missing }
}
