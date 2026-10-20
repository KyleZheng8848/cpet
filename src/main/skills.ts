import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { resolveBundledSkillsRoots } from '../shared/bundledSkills'
import type { AgentEvent, SendPromptPayload } from '../shared/types'
import type {
  AgentSkill,
  LoadedSkillBodies,
  SkillCatalogEntry,
  SkillDeliveryPref,
  SkillInjection,
  SkillReportMode
} from '../shared/skills'
import {
  applyNativeSkillInvocation,
  applySkillsToPrompt,
  formatSkillReportText,
  injectSkillBodies,
  injectSkillCatalog,
  isSkillDeliveryPref,
  resolveSkillDelivery,
  resolveSkillRelPaths,
  skillMarkerForEngine,
  splitFrontmatter
} from '../shared/skills'
import { getSettings } from './store'

const USER_ROOTS = [
  join(homedir(), '.cursor', 'skills-cursor'),
  join(homedir(), '.cursor', 'skills'),
  join(homedir(), '.agents', 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills')
]

const PROJECT_REL = [
  join('.agents', 'skills'),
  join('.cursor', 'skills'),
  join('.claude', 'skills'),
  join('.codex', 'skills')
]

/** 文档中的内置技能兜底（磁盘扫描不到时仍可选）。 */
const BUILTIN_FALLBACK: Array<Pick<AgentSkill, 'id' | 'name' | 'description'>> = [
  { id: 'automate', name: 'automate', description: '创建 Cursor Automations' },
  { id: 'babysit', name: 'babysit', description: '照看 PR：冲突、CI、评论' },
  { id: 'canvas', name: 'canvas', description: '创建交互式 Canvas' },
  { id: 'create-hook', name: 'create-hook', description: '创建 Cursor hooks' },
  { id: 'create-rule', name: 'create-rule', description: '创建 Cursor rules' },
  { id: 'create-skill', name: 'create-skill', description: '创建 Agent Skill' },
  { id: 'create-subagent', name: 'create-subagent', description: '创建子 agent' },
  { id: 'loop', name: 'loop', description: '按间隔循环跑提示/技能' },
  { id: 'migrate-to-skills', name: 'migrate-to-skills', description: '规则/命令迁移为技能' },
  { id: 'review', name: 'review', description: '代码审查' },
  { id: 'review-bugbot', name: 'review-bugbot', description: 'Bugbot 审查' },
  { id: 'review-security', name: 'review-security', description: '安全审查' },
  { id: 'sdk', name: 'sdk', description: 'Cursor SDK 开发' },
  { id: 'shell', name: 'shell', description: '按字面执行 shell 命令' },
  { id: 'split-to-prs', name: 'split-to-prs', description: '拆成小 PR' },
  { id: 'statusline', name: 'statusline', description: '配置 CLI status line' },
  { id: 'update-cli-config', name: 'update-cli-config', description: '更新 CLI 配置' },
  { id: 'update-cursor-settings', name: 'update-cursor-settings', description: '更新 Cursor/VS Code 设置' }
]

function parseFrontmatter(block: string): { name?: string; description?: string } {
  if (!block) return {}
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const description = block
    .match(/^description:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
  return { name, description }
}

function walkSkillMds(root: string, out: string[], depth = 0): void {
  if (depth > 6 || !existsSync(root)) return
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(root, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isFile() && name === 'SKILL.md') {
      out.push(full)
    } else if (st.isDirectory()) {
      walkSkillMds(full, out, depth + 1)
    }
  }
}

function skillFromFile(file: string, source: AgentSkill['source']): AgentSkill | null {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const { frontmatter, body } = splitFrontmatter(raw)
  const fm = parseFrontmatter(frontmatter)
  const folder = basename(join(file, '..'))
  const id = (fm.name || folder).trim()
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null
  return {
    id,
    name: id,
    description: fm.description,
    source,
    path: file,
    hasBody: body.trim().length > 0
  }
}

const SOURCE_RANK: Record<AgentSkill['source'], number> = {
  project: 0,
  user: 1,
  bundled: 2,
  builtin: 3
}

function collectFromRoots(roots: string[], source: AgentSkill['source'], map: Map<string, AgentSkill>): void {
  for (const root of roots) {
    if (!existsSync(root)) continue
    const files: string[] = []
    walkSkillMds(root, files)
    for (const file of files) {
      const skill = skillFromFile(file, source)
      if (!skill) continue
      // 高优先级覆盖低优先级（project > user > bundled > builtin）
      const prev = map.get(skill.id)
      if (!prev || SOURCE_RANK[source] < SOURCE_RANK[prev.source]) {
        map.set(skill.id, skill)
      }
    }
  }
}

function bundledSkillRoots(): string[] {
  // 单测里 electron.app 可能未注入，不能直接读 isPackaged
  const isPackaged = Boolean(app?.isPackaged)
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  return resolveBundledSkillsRoots({
    isPackaged,
    resourcesPath,
    projectRoot: isPackaged ? undefined : join(__dirname, '../..')
  })
}

/** 扫描 cwd + 用户目录 + 安装包内置技能，并合并名录兜底。 */
export function listAgentSkills(cwd?: string): AgentSkill[] {
  const map = new Map<string, AgentSkill>()

  if (cwd) {
    collectFromRoots(
      PROJECT_REL.map((rel) => join(cwd, rel)),
      'project',
      map
    )
  }
  collectFromRoots(USER_ROOTS, 'user', map)
  collectFromRoots(bundledSkillRoots(), 'bundled', map)

  for (const b of BUILTIN_FALLBACK) {
    if (map.has(b.id)) continue
    map.set(b.id, { ...b, source: 'builtin' })
  }

  // skills-cursor 里扫到的标成 builtin 更贴切
  for (const [id, skill] of map) {
    if (skill.path?.includes(`${join('.cursor', 'skills-cursor')}`)) {
      map.set(id, { ...skill, source: 'builtin' })
    }
  }

  return [...map.values()].sort((a, b) => {
    const d = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    return d !== 0 ? d : a.id.localeCompare(b.id)
  })
}

interface CachedBody {
  mtimeMs: number
  size: number
  body: string
}

/** 按 mtime+size 校验的正文缓存：技能文件改了立刻失效，没改就不重复读盘/重解析。 */
const bodyCache = new Map<string, CachedBody>()
const BODY_CACHE_MAX = 64

/** 读出单个 SKILL.md 的正文（已剥 frontmatter、相对路径已绝对化）。 */
export function readSkillBody(file: string): string {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(file)
  } catch {
    bodyCache.delete(file)
    return ''
  }
  const hit = bodyCache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.body
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    bodyCache.delete(file)
    return ''
  }
  const body = resolveSkillRelPaths(splitFrontmatter(raw).body.trim(), dirname(file), existsSync)
  if (bodyCache.size >= BODY_CACHE_MAX) bodyCache.clear()
  bodyCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, body })
  return body
}

/** 取选中技能的正文；磁盘上找不到（如只存在于内置兜底）的进 missing。 */
export function loadSkillBodies(ids: string[] | undefined, cwd?: string): LoadedSkillBodies {
  const wanted = [...new Set((ids || []).map((s) => s.trim()).filter(Boolean))]
  if (!wanted.length) return { bodies: [], missing: [] }
  const byId = new Map(listAgentSkills(cwd).map((s) => [s.id, s]))
  const bodies: LoadedSkillBodies['bodies'] = []
  const missing: string[] = []
  for (const id of wanted) {
    const file = byId.get(id)?.path
    const body = file ? readSkillBody(file) : ''
    if (body) bodies.push({ id, body, path: file })
    else missing.push(id)
  }
  return { bodies, missing }
}

/** 选中技能的薄目录元数据（不读正文）。 */
export function loadSkillCatalog(
  ids: string[] | undefined,
  cwd?: string
): { entries: SkillCatalogEntry[]; missing: string[] } {
  const wanted = [...new Set((ids || []).map((s) => s.trim()).filter(Boolean))]
  if (!wanted.length) return { entries: [], missing: [] }
  const byId = new Map(listAgentSkills(cwd).map((s) => [s.id, s]))
  const entries: SkillCatalogEntry[] = []
  const missing: string[] = []
  for (const id of wanted) {
    const s = byId.get(id)
    if (s?.path && s.hasBody) {
      entries.push({ id, description: s.description, path: s.path })
    } else {
      missing.push(id)
    }
  }
  return { entries, missing }
}

/**
 * 按设置投递技能。Cursor 仍走 applyCursorSkills。
 * engine：实际子引擎（直连 API → custom-api）。
 */
export function applySkillBodies(payload: {
  prompt: string
  systemPrompt?: string
  skills?: string[]
  cwd?: string
}): SkillInjection {
  return injectSkillBodies(
    payload.prompt,
    payload.systemPrompt,
    payload.skills,
    loadSkillBodies(payload.skills, payload.cwd)
  )
}

export type SkillRunEngine =
  | 'cursor'
  | 'claude-code'
  | 'codex'
  | 'openclaw'
  | 'opencode'
  | 'custom-api'

function deliveryPref(): SkillDeliveryPref {
  const raw = getSettings().skillDelivery
  return isSkillDeliveryPref(raw) ? raw : 'auto'
}

/**
 * 非 Cursor 引擎统一入口：native（点名）/ catalog（薄目录）/ inject（全文）。
 */
export function deliverSkills(
  payload: {
    prompt: string
    systemPrompt?: string
    skills?: string[]
    cwd?: string
  },
  engine: SkillRunEngine
): SkillInjection {
  const delivery = resolveSkillDelivery(engine, deliveryPref())
  const marker = skillMarkerForEngine(engine)
  if (delivery === 'native') {
    const { missing } = loadSkillCatalog(payload.skills, payload.cwd)
    return applyNativeSkillInvocation(
      payload.prompt,
      payload.systemPrompt,
      payload.skills,
      marker,
      missing
    )
  }
  if (delivery === 'catalog') {
    const { entries, missing } = loadSkillCatalog(payload.skills, payload.cwd)
    return injectSkillCatalog(
      payload.prompt,
      payload.systemPrompt,
      payload.skills,
      entries,
      missing,
      marker
    )
  }
  return applySkillBodies(payload)
}

type SkillEmit = (event: AgentEvent) => void

/**
 * 把「本回合技能到底有没有进 prompt」打给 UI。
 * 非 Cursor：看 injected/missing；Cursor：requested 即视为斜杠已加上。
 */
export function emitSkillReport(
  emit: SkillEmit,
  payload: Pick<SendPromptPayload, 'conversationId' | 'laneId' | 'skills'>,
  report: {
    mode: SkillReportMode
    injected: string[]
    missing: string[]
    truncated: string[]
  }
): void {
  const requested = [...new Set((payload.skills || []).map((s) => s.trim()).filter(Boolean))]
  if (!requested.length && !report.injected.length && !report.missing.length) return
  emit({
    type: 'skills',
    conversationId: payload.conversationId,
    laneId: payload.laneId,
    mode: report.mode,
    injected: report.injected,
    missing: report.missing,
    truncated: report.truncated
  })
}

/** Cursor：只加 /name，服务端展开；仍发报告让用户看见「选了就算发出去了」。 */
export function applyCursorSkills(
  emit: SkillEmit,
  payload: SendPromptPayload,
  promptAlreadyWrapped: string
): string {
  const next = applySkillsToPrompt(promptAlreadyWrapped, payload.skills, '/')
  const ids = [...new Set((payload.skills || []).map((s) => s.trim()).filter(Boolean))]
  emitSkillReport(emit, payload, {
    mode: 'cursor-slash',
    injected: ids,
    missing: [],
    truncated: []
  })
  return next
}

/**
 * 非 Cursor：按 skillDelivery 设置投递，并发报告。
 * @deprecated 名称保留；请优先用 applySkillsForEngine。
 */
export function applyInlineSkills(
  emit: SkillEmit,
  payload: SendPromptPayload,
  engine: SkillRunEngine = 'custom-api'
): SkillInjection {
  return applySkillsForEngine(emit, payload, engine)
}

/** 非 Cursor：按引擎 + 用户偏好投递技能。 */
export function applySkillsForEngine(
  emit: SkillEmit,
  payload: SendPromptPayload,
  engine: SkillRunEngine
): SkillInjection {
  const withSkills = deliverSkills(payload, engine)
  const mode: SkillReportMode = withSkills.mode || 'inline'
  emitSkillReport(emit, payload, {
    mode,
    injected: withSkills.injected,
    missing: withSkills.missing,
    truncated: withSkills.truncated
  })
  return withSkills
}

/** 供测试/日志：把报告变成可读句子。 */
export function skillReportPlain(report: {
  mode: SkillReportMode
  injected: string[]
  missing: string[]
  truncated: string[]
}): string {
  return formatSkillReportText(report)
}
