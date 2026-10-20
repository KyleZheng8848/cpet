import { t as uiText } from './i18n'
/** Agent 技能（Cursor `/skill-name` 调用约定）。 */

export interface AgentSkill {
  /** 调用名，对应 `/name` */
  id: string
  name: string
  description?: string
  /** project = 工作区；user = 用户全局；bundled = 安装包内置；builtin = Cursor 名录兜底 */
  source: 'project' | 'user' | 'bundled' | 'builtin'
  path?: string
  /**
   * 磁盘上能读出 SKILL.md 正文。为 false 时只有 Cursor（服务端展开）能用，
   * 其余引擎选了也是空操作。正文本身不过 IPC，选单只要这个布尔量。
   */
  hasBody?: boolean
}

/** 已加载的技能正文，只在主进程内流转。 */
export interface SkillBody {
  id: string
  body: string
  /** SKILL.md 绝对路径，截断时告诉模型去哪读全文。 */
  path?: string
}

export interface LoadedSkillBodies {
  bodies: SkillBody[]
  /** 选中了但本机读不出正文的技能 id。 */
  missing: string[]
}

export interface SkillInjection {
  prompt: string
  systemPrompt?: string
  injected: string[]
  missing: string[]
  truncated: string[]
  /** 本回合实际采用的投递方式（报告 / UI 用）。 */
  mode?: SkillReportMode
}

/** 技能目录条目（catalog 模式只塞这些，不塞正文）。 */
export interface SkillCatalogEntry {
  id: string
  description?: string
  path?: string
}

/**
 * 单个技能正文上限。多数 SKILL.md 在 4k 字符以内，12k 能完整放下带表格/示例的长技能，
 * 又不至于一个技能吃掉整段预算。
 */
export const SKILL_BODY_PER_SKILL_CHARS = 12_000

/**
 * 所有技能正文合计上限。中文按 ~1.5 字符/token、英文按 ~4 字符/token 估，
 * 24k 字符约 6k~16k token，占 128k 上下文的上限约 12%，给对话历史留足空间。
 */
export const SKILL_BODY_TOTAL_CHARS = 24_000

/** 调用标记：Claude/OpenClaw/Cursor 用 `/`；Codex 用 `$`。 */
export type SkillMarker = '/' | '$'

/**
 * 用户偏好。auto = 按引擎选最像原版且省 token 的默认：
 * Claude/Codex/OpenClaw/Cursor → native；直连 API → inject。
 */
export type SkillDeliveryPref = 'auto' | 'native' | 'catalog' | 'inject'

/** 实际落地方式（报告气泡）。 */
export type SkillReportMode = 'cursor-slash' | 'native' | 'catalog' | 'inline'

export const SKILL_DELIVERY_OPTIONS: ReadonlyArray<{
  id: SkillDeliveryPref
  label: string
  desc: string
}> = [
  {
    id: 'auto',
    get label() { return uiText("自动") },
    get desc() { return uiText("Claude/Codex/OpenClaw 点名按需加载；直连 API 才内联正文") }
  },
  {
    id: 'native',
    get label() { return uiText("原版点名") },
    get desc() { return uiText("只加 /名 或 $名，正文由引擎按需加载（最省 token）") }
  },
  {
    id: 'catalog',
    get label() { return uiText("薄目录") },
    get desc() { return uiText("只注入名字+描述+路径，需要时再读 SKILL.md") }
  },
  {
    id: 'inject',
    get label() { return uiText("全文注入") },
    get desc() { return uiText("把 SKILL.md 正文写进提示词（稳但费 token）") }
  }
]

export function isSkillDeliveryPref(v: unknown): v is SkillDeliveryPref {
  return v === 'auto' || v === 'native' || v === 'catalog' || v === 'inject'
}

/** Cursor CLI 自己会展开 `/name`（正文不进本地 prompt），别再内联一遍。 */
export function engineExpandsSkills(engine: string | undefined | null): boolean {
  return engine === 'cursor'
}

/** Codex 认 `$name`；其余引擎与 Cursor 认 `/name`。 */
export function skillMarkerForEngine(engine: string | undefined | null): SkillMarker {
  return engine === 'codex' ? '$' : '/'
}

/**
 * 按引擎解析最终投递方式。
 * custom-api没有完整 Skill 运行时：强制 native 时降为 catalog。
 */
export function resolveSkillDelivery(
  engine: string | undefined | null,
  pref: SkillDeliveryPref | undefined | null
): Exclude<SkillDeliveryPref, 'auto'> {
  const want = pref && pref !== 'auto' ? pref : null
  if (want === 'inject' || want === 'catalog') return want
  if (want === 'native') {
    if (engine === 'custom-api') return 'catalog'
    return 'native'
  }
  // auto
  if (engine === 'custom-api') return 'inject'
  if (
    engine === 'cursor' ||
    engine === 'claude-code' ||
    engine === 'codex' ||
    engine === 'openclaw' ||
    engine === 'opencode'
  ) {
    return 'native'
  }
  return 'inject'
}

/** 当前引擎下这个技能真能生效吗（选单据此过滤）。 */
export function skillUsableOnEngine(
  skill: Pick<AgentSkill, 'hasBody'>,
  engine: string | undefined | null
): boolean {
  return engineExpandsSkills(engine) || skill.hasBody === true
}

function hasSkillMarker(body: string, id: string, marker: SkillMarker): boolean {
  return new RegExp(`(^|\\s)${escapeReg(marker)}${escapeReg(id)}(\\s|$)`).test(body)
}

/** 把选中的技能写成引擎可识别的调用前缀（`/name` 或 `$name`）。 */
export function applySkillsToPrompt(
  prompt: string,
  skillIds: string[] | undefined,
  marker: SkillMarker = '/'
): string {
  const ids = [...new Set((skillIds || []).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) return prompt
  const body = prompt.trim()
  // 已手写同标记时不重复塞；若写了另一种标记，先剥再按目标标记重加
  const already = ids.every((id) => hasSkillMarker(body, id, marker))
  if (already) return prompt
  const cleared = stripSkillPrefix(prompt, ids).trim()
  const prefix = ids.map((id) => `${marker}${id}`).join(' ')
  return cleared ? `${prefix}\n${cleared}` : prefix
}

/** 与 listAgentSkills 的 id 校验同一套字符集：名字里不会出现标点，所以标点天然是边界。 */
const LEADING_SKILL_RE = /^\s*\/([A-Za-z0-9][A-Za-z0-9_-]*)/

/**
 * 解析 prompt 开头连续的 `/技能名`（定时任务没有选单，只有自由文本）。
 * 只认 knownIds 里真实存在的名字，遇到第一个不认识的斜杠词就停下，
 * 否则 `/Users/example/x` 这类绝对路径、`/abc/` 这类正则会被当成技能调用。
 */
export function parseLeadingSkillIds(
  prompt: string | undefined | null,
  knownIds: Iterable<string>
): string[] {
  const known = new Set(knownIds)
  const out: string[] = []
  let rest = prompt || ''
  for (;;) {
    const m = LEADING_SKILL_RE.exec(rest)
    if (!m) break
    const after = rest.slice(m[0].length)
    // 紧跟 `/` 说明它只是路径/正则的一段，不是斜杠命令
    if (after.startsWith('/')) break
    if (!known.has(m[1])) break
    if (!out.includes(m[1])) out.push(m[1])
    rest = after
  }
  return out
}

/** 拆出 YAML frontmatter 与正文；没有 frontmatter 时整篇都是正文。 */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const text = (raw || '').replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { frontmatter: '', body: text }
  const close = text.indexOf('\n---', 3)
  if (close < 0) return { frontmatter: '', body: text }
  const lineEnd = text.indexOf('\n', close + 1)
  const frontmatter = text.slice(3, close)
  const body = lineEnd < 0 ? '' : text.slice(lineEnd + 1)
  return { frontmatter, body: body.replace(/^\s*\n/, '') }
}

const REL_PATH_RE =
  /(?<![\w./~-])(?:\.\/)?((?:[\w.-]+\/)+[\w.-]+\.(?:md|mdx|json|jsonl|mjs|cjs|js|ts|tsx|py|sh|txt|ya?ml|toml|csv|sql))(?![\w/])/g

/**
 * 把正文里的相对路径（如 `references/bar.md`）展开成绝对路径。
 * 模型拿到相对路径无从下手，CLI 引擎有文件工具、绝对路径能直接读；
 * 直连 API 没有文件工具，展开了也读不到，但至少不会误导。
 */
export function resolveSkillRelPaths(
  body: string,
  dir: string,
  exists: (p: string) => boolean = () => true
): string {
  if (!dir) return body
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir
  // 前置 lookbehind 已挡掉 URL 与绝对路径（前一个字符是 `/` 就不匹配）
  return body.replace(REL_PATH_RE, (match, rel: string) => {
    const abs = `${base}/${rel}`
    return exists(abs) ? abs : match
  })
}

function tokenSkillId(token: string): string | null {
  if (token.startsWith('/') || token.startsWith('$')) {
    const id = token.slice(1)
    return id ? id : null
  }
  return null
}

/**
 * 去掉渲染进程拼在首行的 `/技能名` 或 `$技能名` 前缀。
 * inject 模式会剥掉（身份改写进 system）；native/catalog 会再按引擎标记加回。
 */
export function stripSkillPrefix(prompt: string, skillIds: string[] | undefined): string {
  const ids = new Set((skillIds || []).map((s) => s.trim()).filter(Boolean))
  if (!ids.size) return prompt
  const nl = prompt.indexOf('\n')
  const first = (nl < 0 ? prompt : prompt.slice(0, nl)).trim()
  if (!first) return prompt
  const tokens = first.split(/\s+/)
  if (
    !tokens.every((t) => {
      const id = tokenSkillId(t)
      return !!id && ids.has(id)
    })
  ) {
    return prompt
  }
  return nl < 0 ? '' : prompt.slice(nl + 1).replace(/^\s+/, '')
}

function truncateBody(body: string, limit: number, path?: string): { text: string; cut: boolean } {
  if (body.length <= limit) return { text: body, cut: false }
  const where = path ? `原文见 ${path}` : '原文见本机 SKILL.md'
  return {
    text: `${body.slice(0, limit)}\n\n[已截断：正文超过 ${limit} 字符预算，后续内容未注入，${where}]`,
    cut: true
  }
}

/** 组装注入 systemPrompt 的技能块；返回空串表示没有可注入内容。 */
export function buildSkillPromptBlock(
  bodies: SkillBody[],
  missing: string[] = [],
  totalLimit = SKILL_BODY_TOTAL_CHARS,
  perSkillLimit = SKILL_BODY_PER_SKILL_CHARS
): { block: string; injected: string[]; truncated: string[] } {
  const injected: string[] = []
  const truncated: string[] = []
  const parts: string[] = []
  let left = totalLimit

  for (const item of bodies) {
    const body = (item.body || '').trim()
    if (!body) continue
    if (left <= 0) {
      truncated.push(item.id)
      continue
    }
    const { text, cut } = truncateBody(body, Math.min(perSkillLimit, left), item.path)
    left -= text.length
    injected.push(item.id)
    if (cut) truncated.push(item.id)
    const head = item.path ? `【技能 /${item.id}】（${item.path}）` : `【技能 /${item.id}】`
    parts.push(`${head}\n${text}`)
  }

  const notes: string[] = []
  if (parts.length) {
    notes.push(
      '【已启用技能】以下正文来自本机 SKILL.md，请按其中的流程与约束执行；其中的相对路径已展开为绝对路径。'
    )
  }
  const gone = missing.filter(Boolean)
  if (gone.length) {
    notes.push(
      `【技能未加载】${gone.map((id) => `/${id}`).join('、')} 在本机找不到 SKILL.md，正文没有注入，不要假装已按它执行。`
    )
  }
  if (!parts.length && !gone.length) return { block: '', injected, truncated }
  return { block: [...notes, ...parts].join('\n\n'), injected, truncated }
}

/**
 * 非 Cursor 引擎的技能落地：正文进 systemPrompt，用户消息里去掉字面前缀。
 */
export function injectSkillBodies(
  prompt: string,
  systemPrompt: string | undefined,
  skillIds: string[] | undefined,
  loaded: LoadedSkillBodies,
  totalLimit = SKILL_BODY_TOTAL_CHARS,
  perSkillLimit = SKILL_BODY_PER_SKILL_CHARS
): SkillInjection {
  const ids = [...new Set((skillIds || []).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) {
    return { prompt, systemPrompt, injected: [], missing: [], truncated: [], mode: 'inline' }
  }
  const { block, injected, truncated } = buildSkillPromptBlock(
    loaded.bodies,
    loaded.missing,
    totalLimit,
    perSkillLimit
  )
  const stripped = stripSkillPrefix(prompt, ids)
  const nextPrompt = stripped.trim() ? stripped : '按所选技能执行。'
  const sys = (systemPrompt || '').trim()
  return {
    prompt: block ? nextPrompt : prompt,
    systemPrompt: block ? (sys ? `${sys}\n\n${block}` : block) : systemPrompt,
    injected,
    missing: loaded.missing,
    truncated,
    mode: 'inline'
  }
}

/** 组装薄目录：名字 + 描述 + 路径，不塞正文。 */
export function buildSkillCatalogBlock(
  entries: SkillCatalogEntry[],
  missing: string[] = [],
  marker: SkillMarker = '/'
): { block: string; injected: string[] } {
  const injected: string[] = []
  const lines: string[] = []
  for (const e of entries) {
    injected.push(e.id)
    const desc = (e.description || '').trim() || '（无描述）'
    const path = e.path ? `；路径 ${e.path}` : ''
    lines.push(`- ${marker}${e.id}：${desc}${path}`)
  }
  const notes: string[] = []
  if (lines.length) {
    notes.push(
      '【技能目录】以下技能已点名。正文未注入以节省 token；需要时请用文件工具读取对应 SKILL.md 并按其执行。'
    )
    notes.push(lines.join('\n'))
  }
  const gone = missing.filter(Boolean)
  if (gone.length) {
    notes.push(
      `【技能未找到】${gone.map((id) => `${marker}${id}`).join('、')} —— 本机没有 SKILL.md，不要假装已启用。`
    )
  }
  if (!notes.length) return { block: '', injected }
  return { block: notes.join('\n\n'), injected }
}

/** catalog 模式：目录进 system，用户消息保留调用标记。 */
export function injectSkillCatalog(
  prompt: string,
  systemPrompt: string | undefined,
  skillIds: string[] | undefined,
  entries: SkillCatalogEntry[],
  missing: string[],
  marker: SkillMarker = '/'
): SkillInjection {
  const ids = [...new Set((skillIds || []).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) {
    return { prompt, systemPrompt, injected: [], missing: [], truncated: [], mode: 'catalog' }
  }
  const { block, injected } = buildSkillCatalogBlock(entries, missing, marker)
  const base = stripSkillPrefix(prompt, ids).trim() || (ids.length ? '按所选技能执行。' : '')
  const nextPrompt = applySkillsToPrompt(base, ids, marker)
  const sys = (systemPrompt || '').trim()
  return {
    prompt: block ? nextPrompt : applySkillsToPrompt(prompt, ids, marker),
    systemPrompt: block ? (sys ? `${sys}\n\n${block}` : block) : systemPrompt,
    injected,
    missing,
    truncated: [],
    mode: 'catalog'
  }
}

/** native 模式：只保证调用标记正确，不读正文、不改 system。 */
export function applyNativeSkillInvocation(
  prompt: string,
  systemPrompt: string | undefined,
  skillIds: string[] | undefined,
  marker: SkillMarker,
  missing: string[] = []
): SkillInjection {
  const ids = [...new Set((skillIds || []).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) {
    return { prompt, systemPrompt, injected: [], missing: [], truncated: [], mode: 'native' }
  }
  const base = stripSkillPrefix(prompt, ids).trim() || '按所选技能执行。'
  return {
    prompt: applySkillsToPrompt(base, ids, marker),
    systemPrompt,
    injected: ids.filter((id) => !missing.includes(id)),
    missing,
    truncated: [],
    mode: 'native'
  }
}

/** 对话气泡里展示的技能落地说明（始终可见，不随「过程」开关藏起来）。 */
export function formatSkillReportText(report: {
  mode: SkillReportMode
  injected: string[]
  missing: string[]
  truncated: string[]
}): string {
  const lines: string[] = []
  if (report.mode === 'cursor-slash') {
    const names = report.injected.map((id) => `/${id}`).join('、') || '（无）'
    lines.push(`技能（Cursor）：已在消息前加上 ${names}，由 Cursor 服务端展开正文。`)
  } else if (report.mode === 'native') {
    const names =
      report.injected.map((id) => `/${id}`).join('、') ||
      report.missing.map((id) => `/${id}`).join('、') ||
      '（无）'
    lines.push(
      `技能（原版点名）：已加上 ${names}，正文由引擎按需加载，未内联进提示词（省 token）。`
    )
  } else if (report.mode === 'catalog') {
    if (report.injected.length) {
      lines.push(
        `技能（薄目录）：${report.injected.map((id) => `/${id}`).join('、')} —— 只注入了名字/描述/路径，需要时引擎应自行读取 SKILL.md。`
      )
    }
  } else if (report.injected.length) {
    lines.push(
      `技能（正文已注入）：${report.injected.map((id) => `/${id}`).join('、')} —— 已把 SKILL.md 正文写入提示词；文中的绝对路径可用文件工具继续读。`
    )
  }
  if (report.missing.length) {
    lines.push(
      `技能未加载：${report.missing.map((id) => `/${id}`).join('、')} —— 本机没有 SKILL.md，引擎可能看不到内容，不要以为已经启用。`
    )
  }
  if (report.truncated.length) {
    lines.push(
      `技能已截断：${report.truncated.map((id) => `/${id}`).join('、')} —— 超出注入长度上限，后半段未送进模型。`
    )
  }
  return lines.join('\n')
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
