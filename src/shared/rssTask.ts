/** RSS 订阅任务：多源配置、长期归档、筛选与 AI 上下文。 */

import { RSS_FEED_PRESETS, normalizeRssFeedUrls, rssSourceLabel } from './rssBrief'
import { rssCatalogNameForHost } from './rssCatalog'
import { heuristicRssTags, normalizeRssTags, pickRelatedRssEntries, rssEntryTagList } from './rssTags'
import { rssEntryDisplayTitle } from './rssLang'

export const RSS_TASK_MAX_FEEDS = 200
export const RSS_TASK_MAX_ITEMS = 1000
export const RSS_TASK_PER_FEED = 40
/** 多源刷新并发上限，避免一次打爆网络。 */
export const RSS_TASK_REFRESH_CONCURRENCY = 6
/** 未读超过此时长（按发布时间，缺省用拉取时间）自动视为已读。 */
export const RSS_UNREAD_TTL_MS = 24 * 60 * 60 * 1000

export type RssValueScore = 1 | 2 | 3 | 4 | 5
export type RssDigestWindowHours = 6 | 12 | 24 | 48 | 72 | 168
export const RSS_DIGEST_WINDOWS: ReadonlyArray<RssDigestWindowHours> = [6, 12, 24, 48, 72, 168]
/**
 * 简报生成形式（存档 id 稳定，勿改字符串）：
 * 速览 brief/daily/flash · 决策 followup/risks/action ·
 * 存档 full/changes · 成稿 wechat/xhs/report/script
 */
export type RssDigestTemplate =
  | 'brief'
  | 'daily'
  | 'flash'
  | 'followup'
  | 'risks'
  | 'action'
  | 'full'
  | 'changes'
  | 'wechat'
  | 'xhs'
  | 'report'
  | 'script'
/** 选择器 / 列表分类用的大组。 */
export type RssDigestTemplateGroup = 'scan' | 'decide' | 'archive' | 'publish'

export type RssDigestTemplateMeta = {
  id: RssDigestTemplate
  group: RssDigestTemplateGroup
  /** 选择器与列表展示名。 */
  label: string
  /** 列表角标短名。 */
  short: string
  /** 一行用途（下拉 title / 列表提示）。 */
  hint: string
  /** 面板里展开的说明。 */
  blurb: string
  /** 形态门禁用的主章节名（须含 ● 要点）。 */
  primarySection: string
  /** 发给模型的结构提示（接在信息窗口之后）。 */
  shapeHint: string
}

export const RSS_DIGEST_TEMPLATE_GROUPS: ReadonlyArray<{
  id: RssDigestTemplateGroup
  label: string
  hint: string
}> = [
  { id: 'scan', label: '速览', hint: '短、快扫' },
  { id: 'decide', label: '决策', hint: '要不要跟、盯谁' },
  { id: 'archive', label: '存档', hint: '留档对照' },
  { id: 'publish', label: '成稿', hint: '可直接发布的文体' }
]

/**
 * UI 元数据。写稿真源在 skill `cpet-rss-digest`（craft + forms/<id>.md）；
 * shapeHint 仍会进 user prompt，作结构清单，须与 forms 一致。
 */
export const RSS_DIGEST_TEMPLATE_META: Record<RssDigestTemplate, RssDigestTemplateMeta> = {
  brief: {
    id: 'brief',
    group: 'scan',
    label: '头条速览',
    short: '头条',
    hint: '只抓高价值头条，一条一句结论',
    blurb:
      '约 60 秒扫完。结论先行：每条粗体写「新在哪 + 为何重要」，再补半句背景；不写长叙事、不拆主题。',
    primarySection: '必读头条',
    shapeHint:
      '然后：## 必读头条（4–10 条 ● **具体对象+利害** — 半句背景 + 链接；宁缺毋滥，禁止注水凑数）→ ## 资料来源'
  },
  daily: {
    id: 'daily',
    group: 'scan',
    label: '三句话日报',
    short: '日报',
    hint: '今日主线三句 + 一条行动建议',
    blurb:
      '约 30 秒口头同步：恰好三句不同侧面主线，再加一条今天就能勾选的行动。',
    primarySection: '今日主线',
    shapeHint:
      '然后：## 今日主线（恰好 3 条 ●，侧面不重复）→ ## 今天优先（1 条动词行动）→ ## 资料来源（3–6）'
  },
  flash: {
    id: 'flash',
    group: 'scan',
    label: '60秒快讯',
    short: '快讯',
    hint: '极短条目流，一条一事、可刷屏',
    blurb: '刷屏快讯：一行「主体+动作」，适合锁屏或群转发；不要背景长文。',
    primarySection: '快讯',
    shapeHint:
      '然后：## 快讯（5–12 行「主体+动作+结果」；禁气氛组；仅正文引用进资料来源）→ ## 资料来源'
  },
  followup: {
    id: 'followup',
    group: 'decide',
    label: '决策简报',
    short: '决策',
    hint: '信号 → 为什么重要 → 该盯谁',
    blurb:
      '拍板用：先点名关键变化，再写影响面（竞争/成本/合规/节奏），最后落到具体对象或指标；禁止「持续关注」。',
    primarySection: '关键信号',
    shapeHint:
      '然后：## 关键信号（同一决策主题）→ ## 为什么重要（二阶影响）→ ## 该盯谁/盯什么（决定|批准|仅知情|监控）→ ## 资料来源（仅正文引用）'
  },
  risks: {
    id: 'risks',
    group: 'decide',
    label: '风险雷达',
    short: '风险',
    hint: '安全、合规、争议、故障优先',
    blurb: '围着一条风险主线：每条标明类型与后果，再按本周是否要动作分高/中/低紧迫度。',
    primarySection: '风险与争议',
    shapeHint:
      '然后：## 风险与争议（● **[类型] 对象+后果**）→ ## 紧迫度（按本周是否要动作）→ ## 资料来源（仅正文引用）'
  },
  action: {
    id: 'action',
    group: 'decide',
    label: '行动清单',
    short: '行动',
    hint: '可执行待办 + 明确负责人视角',
    blurb: '一条行动主题下的可勾选待办（动词+对象+时限+验收）；禁「关注/评估」；观望项写清触发条件。',
    primarySection: '本周行动',
    shapeHint:
      '然后：## 本周行动（● **动词** — 对象/验收/时限）→ ## 观望项（缺什么信号才动）→ ## 资料来源（仅正文引用）'
  },
  full: {
    id: 'full',
    group: 'archive',
    label: '主题周报',
    short: '周报',
    hint: '概览 + 按主题分类深读',
    blurb: '有主线的周记：跨来源概览 + 有料才开的主题节；禁止空壳分类和条目 dump。',
    primarySection: '本期概览',
    shapeHint:
      '然后：## 本期概览（综合要点，非标题复读，一条主线）→ 最多 3 个有料 ## 主题 + ### 事件 → ## 资料来源（仅正文引用）'
  },
  changes: {
    id: 'changes',
    group: 'archive',
    label: '变动清单',
    short: '变动',
    hint: '本时段新增、转向、值得对照的变化',
    blurb: 'changelog：每条写清从旧到新；写不出对比就丢掉。',
    primarySection: '本时段变动',
    shapeHint:
      '然后：## 本时段变动（● **从旧到新** — 对比点 + 链接；宁缺毋滥）→ ## 资料来源（仅正文引用）'
  },
  wechat: {
    id: 'wechat',
    group: 'publish',
    label: '公众号长文',
    short: '公号',
    hint: '导语 + 小标题正文 + 收束，适合公众号',
    blurb: '一条主线写透：导语反差 → 2–4 节叙事 → 结语可带走；禁止拼盘与祝福收尾。',
    primarySection: '导语',
    shapeHint:
      '然后：## 导语（2–3 钩子，同一主线）→ ## 正文（2–4 个具体 ###）→ ## 结语（判断/下一步）→ ## 资料来源（仅正文引用）'
  },
  xhs: {
    id: 'xhs',
    group: 'publish',
    label: '小红书笔记',
    short: '小红书',
    hint: '钩子标题感 + 短句分点 + 互动引导',
    blurb: '单主题笔记：3 条封面钩子停得住，正文短句，互动好接话；禁止多领域拼盘。',
    primarySection: '封面钩子',
    shapeHint:
      '然后：## 封面钩子（恰好 3，同一主题）→ ## 正文要点（5–8）→ ## 互动引导（好接话）→ ## 资料来源（仅正文引用）'
  },
  report: {
    id: 'report',
    group: 'publish',
    label: '行业研报',
    short: '研报',
    hint: '结论先行 + 论据 + 风险不确定',
    blurb: '短研报：一个总命题 → 可引用结论 → 主张-证据-推理 → 风险边界；禁止多命题拼盘。',
    primarySection: '核心结论',
    shapeHint:
      '然后：## 核心结论（3–5，同一总命题）→ ## 论据拆解（### 主张→证据→推理）→ ## 风险与不确定 → ## 资料来源（仅正文引用）'
  },
  script: {
    id: 'script',
    group: 'publish',
    label: '口播脚本',
    short: '口播',
    hint: '开场 → 分镜台词 → 收束 CTA',
    blurb: '单主线口播：开场 10 秒抓住人，分镜有增量，单一 CTA；念出来不像念稿。',
    primarySection: '开场白',
    shapeHint:
      '然后：## 开场白（反差/数字）→ ## 分镜口播（4–8，每条有增量）→ ## 收束 CTA（单一）→ ## 资料来源（仅正文引用）'
  }
}

export const RSS_DIGEST_TEMPLATES: ReadonlyArray<RssDigestTemplate> = [
  'brief',
  'daily',
  'flash',
  'followup',
  'risks',
  'action',
  'full',
  'changes',
  'wechat',
  'xhs',
  'report',
  'script'
]

export const RSS_DIGEST_MAX_RECORDS = 60
export type RssScoreMode = 'realtime' | 'interval' | 'off'
export const RSS_SCORE_INTERVALS = [15, 30, 60, 120] as const
/** 「实时」节奏下后台拉源间隔（进任务会立刻拉一轮，不靠这个）。 */
export const RSS_REALTIME_FETCH_MS = 8 * 60_000

export function normalizeRssDigestTemplate(raw: unknown): RssDigestTemplate {
  // 兼容旧存档/笔误
  if (raw === 'headlines' || raw === 'brief') return 'brief'
  if (raw === 'radar' || raw === 'followup' || raw === 'impact') return 'followup'
  if (raw === 'full' || raw === 'themed' || raw === 'weekly') return 'full'
  if (raw === 'daily' || raw === 'standup') return 'daily'
  if (raw === 'risks' || raw === 'risk') return 'risks'
  if (raw === 'changes' || raw === 'delta' || raw === 'diff') return 'changes'
  if (raw === 'flash' || raw === 'newsflash' || raw === 'ticker') return 'flash'
  if (raw === 'action' || raw === 'todo' || raw === 'todos') return 'action'
  if (raw === 'wechat' || raw === 'mp' || raw === 'gongzhonghao') return 'wechat'
  if (raw === 'xhs' || raw === 'xiaohongshu' || raw === 'red') return 'xhs'
  if (raw === 'report' || raw === 'research' || raw === 'yanbao') return 'report'
  if (raw === 'script' || raw === 'oral' || raw === 'podcast') return 'script'
  return 'full'
}

export function rssDigestTemplateMeta(t: RssDigestTemplate): RssDigestTemplateMeta {
  return RSS_DIGEST_TEMPLATE_META[normalizeRssDigestTemplate(t)]
}

export function rssDigestTemplateLabel(t: RssDigestTemplate): string {
  return rssDigestTemplateMeta(t).label
}

export function rssDigestTemplateShort(t: RssDigestTemplate): string {
  return rssDigestTemplateMeta(t).short
}

export function rssDigestTemplateHint(t: RssDigestTemplate): string {
  return rssDigestTemplateMeta(t).hint
}

export function rssDigestTemplateBlurb(t: RssDigestTemplate): string {
  return rssDigestTemplateMeta(t).blurb
}

export function rssDigestTemplatePrimarySection(t: RssDigestTemplate): string {
  return rssDigestTemplateMeta(t).primarySection
}

export function rssDigestTemplateShapeHint(t: RssDigestTemplate): string {
  return rssDigestTemplateMeta(t).shapeHint
}

export function rssDigestTemplatesInGroup(
  group: RssDigestTemplateGroup
): RssDigestTemplate[] {
  return RSS_DIGEST_TEMPLATES.filter((id) => RSS_DIGEST_TEMPLATE_META[id].group === group)
}

/** 讨论线程键：digest:${recordId} */
export function rssDigestThreadId(digestId: string): string {
  const id = digestId.trim()
  return id.startsWith('digest:') ? id : `digest:${id}`
}

export function isRssDigestThreadId(id: string | undefined | null): boolean {
  return !!id && id.startsWith('digest:')
}

export function parseRssDigestRecordId(threadOrId: string | undefined | null): string | undefined {
  if (!threadOrId) return undefined
  return threadOrId.startsWith('digest:') ? threadOrId.slice('digest:'.length) : threadOrId
}

export function formatDigestDateTime(ts: number): string {
  try {
    const d = new Date(ts)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${mi}`
  } catch {
    return ''
  }
}

/** 本地日历日 YYYY-MM-DD。 */
export function toLocalYmd(ts = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isDigestYmd(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
}

/** 本地日 00:00:00.000；非法返回 undefined。 */
export function localYmdStartMs(ymd: string): number | undefined {
  if (!isDigestYmd(ymd)) return undefined
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime()
  return Number.isFinite(t) ? t : undefined
}

/** 本地日 23:59:59.999。 */
export function localYmdEndMs(ymd: string): number | undefined {
  if (!isDigestYmd(ymd)) return undefined
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime()
  return Number.isFinite(t) ? t : undefined
}

/** 默认自定义范围：近 7 个自然日（含今天）。 */
export function defaultDigestCustomRange(now = Date.now()): { from: string; to: string } {
  const to = toLocalYmd(now)
  const from = toLocalYmd(now - 6 * 86_400_000)
  return { from, to }
}

export type DigestTimeBounds = {
  fromAt: number
  toAt: number
  /** 预设小时；自定义时为跨度估算（展示兼容）。 */
  windowHours: RssDigestWindowHours
  rangeFrom?: string
  rangeTo?: string
  label: string
  infoWindow: string
}

function formatDigestDayParts(d: Date, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value || ''
  const m = parts.find((p) => p.type === 'month')?.value || ''
  const day = parts.find((p) => p.type === 'day')?.value || ''
  return withYear ? `${y} 年 ${m} 月 ${day} 日` : `${m} 月 ${day} 日`
}

/** 由起止时间戳生成「信息窗口」行。 */
export function formatDigestInfoWindowBounds(fromAt: number, toAt: number): string {
  const start = new Date(Math.min(fromAt, toAt))
  const end = new Date(Math.max(fromAt, toAt))
  return `${formatDigestDayParts(start, true)}—${formatDigestDayParts(end, false)}（北京时间）`
}

/** 简报抬头用的北京时间信息窗口，如「2026 年 7 月 22 日—7 月 28 日（北京时间）」。 */
export function formatDigestInfoWindow(hours: number, now = Date.now()): string {
  const end = now
  const start = now - Math.max(1, hours) * 3600_000
  return formatDigestInfoWindowBounds(start, end)
}

/** 把任意时长（毫秒）收成最接近的预设简报窗（小时）。 */
export function nearestDigestWindowFromMs(spanMs: number): RssDigestWindowHours {
  const hours = Math.max(1, Math.round(spanMs / 3600_000))
  let best: RssDigestWindowHours = 24
  let bestDiff = Infinity
  for (const h of RSS_DIGEST_WINDOWS) {
    const d = Math.abs(h - hours)
    if (d < bestDiff) {
      best = h
      bestDiff = d
    }
  }
  return best
}

function nearestDigestWindowHours(spanMs: number): RssDigestWindowHours {
  return nearestDigestWindowFromMs(spanMs)
}

/**
 * 解析简报时间窗：有合法起止日则用自定义，否则用预设「近 N 小时」。
 * 只填一侧日期时，另一侧用默认近 7 日补齐。
 */
export function resolveDigestTimeBounds(
  state: Pick<RssTaskState, 'digestWindowHours' | 'digestRangeFrom' | 'digestRangeTo'>,
  now = Date.now()
): DigestTimeBounds {
  const rawFrom = isDigestYmd(state.digestRangeFrom) ? state.digestRangeFrom!.trim() : ''
  const rawTo = isDigestYmd(state.digestRangeTo) ? state.digestRangeTo!.trim() : ''
  if (rawFrom || rawTo) {
    const def = defaultDigestCustomRange(now)
    let fromY = rawFrom || def.from
    let toY = rawTo || def.to
    let fromAt = localYmdStartMs(fromY)
    let toAt = localYmdEndMs(toY)
    if (fromAt != null && toAt != null) {
      if (fromAt > toAt) {
        ;[fromY, toY] = [toY, fromY]
        fromAt = localYmdStartMs(fromY)!
        toAt = localYmdEndMs(toY)!
      }
      return {
        fromAt,
        toAt,
        windowHours: nearestDigestWindowHours(toAt - fromAt),
        rangeFrom: fromY,
        rangeTo: toY,
        label: `${fromY} ~ ${toY}`,
        infoWindow: formatDigestInfoWindowBounds(fromAt, toAt)
      }
    }
  }
  const hours = RSS_DIGEST_WINDOWS.includes(state.digestWindowHours as RssDigestWindowHours)
    ? (state.digestWindowHours as RssDigestWindowHours)
    : 24
  const fromAt = now - hours * 3600_000
  return {
    fromAt,
    toAt: now,
    windowHours: hours,
    label: `近 ${formatDigestWindow(hours)}`,
    infoWindow: formatDigestInfoWindow(hours, now)
  }
}

/** 从简报快照还原时间窗（重生成用）。 */
export function resolveDigestBoundsFromRecord(
  record: Pick<RssDigestRecord, 'windowHours' | 'rangeFrom' | 'rangeTo'>,
  now = Date.now()
): DigestTimeBounds {
  return resolveDigestTimeBounds(
    {
      digestWindowHours: record.windowHours,
      digestRangeFrom: record.rangeFrom,
      digestRangeTo: record.rangeTo
    },
    now
  )
}

/**
 * 自动简报切窗：只按频率，不用「这次生成」的自选日期。
 * - 每隔 N 小时 → 近 N 小时
 * - 每天 → 近 24 小时
 */
export function resolveAutoDigestTimeBounds(
  state: Pick<RssTaskState, 'digestIntervalHours' | 'digestHours' | 'digestHour'>,
  now = Date.now()
): DigestTimeBounds {
  const iv = normalizeRssDigestIntervalHours(state.digestIntervalHours)
  if (iv != null) {
    const fromAt = now - iv * 3600_000
    const windowHours = (
      RSS_DIGEST_WINDOWS.includes(iv as RssDigestWindowHours)
        ? iv
        : nearestDigestWindowHours(iv * 3600_000)
    ) as RssDigestWindowHours
    return {
      fromAt,
      toAt: now,
      windowHours,
      label: `近 ${iv} 小时`,
      infoWindow: formatDigestInfoWindowBounds(fromAt, now)
    }
  }
  const fromAt = now - 24 * 3600_000
  return {
    fromAt,
    toAt: now,
    windowHours: 24,
    label: '近 24 小时',
    infoWindow: formatDigestInfoWindow(24, now)
  }
}

/** 自选多日：按自然日拆成多窗（新→旧），最多 maxDays；非自选或单日则原样一份。 */
export function listDigestTimeChunks(
  bounds: DigestTimeBounds,
  maxDays = 7
): DigestTimeBounds[] {
  if (!bounds.rangeFrom || !bounds.rangeTo) return [bounds]
  const fromY = bounds.rangeFrom
  const toY = bounds.rangeTo
  const chunks: DigestTimeBounds[] = []
  // 从结束日往回走到开始日
  let cursor = localYmdStartMs(toY)
  const start = localYmdStartMs(fromY)
  if (cursor == null || start == null) return [bounds]
  while (cursor >= start && chunks.length < maxDays) {
    const ymd = toLocalYmd(cursor)
    const fromAt = localYmdStartMs(ymd)!
    const toAt = localYmdEndMs(ymd)!
    chunks.push({
      fromAt,
      toAt,
      windowHours: 24,
      rangeFrom: ymd,
      rangeTo: ymd,
      label: ymd,
      infoWindow: formatDigestInfoWindowBounds(fromAt, toAt)
    })
    cursor = fromAt - 12 * 3600_000 // 跳到前一天中午再取 ymd，避开 DST 边界
    cursor = localYmdStartMs(toLocalYmd(cursor))!
  }
  return chunks.length ? chunks : [bounds]
}

/** 在给定时间窗内筛条目（评分高优先）。 */
export function entriesInTimeBounds(
  state: RssTaskState,
  bounds: Pick<DigestTimeBounds, 'fromAt' | 'toAt'>
): RssTaskEntry[] {
  return state.items
    .filter((x) => {
      const t = x.publishedAt || x.fetchedAt
      return t >= bounds.fromAt && t <= bounds.toAt
    })
    .sort((a, b) => {
      const as = a.valueScore || 0
      const bs = b.valueScore || 0
      if (as !== bs) return bs - as
      const ar = rssEntryIsUnread(a) ? 1 : 0
      const br = rssEntryIsUnread(b) ? 1 : 0
      if (ar !== br) return br - ar
      return (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt)
    })
}

export function normalizeRssScoreMode(raw: unknown): RssScoreMode {
  if (raw === 'interval' || raw === 'off' || raw === 'realtime') return raw
  return 'realtime'
}

export function normalizeRssScoreIntervalMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 30
  const clamped = Math.round(n)
  if (clamped <= 15) return 15
  if (clamped <= 30) return 30
  if (clamped <= 60) return 60
  return 120
}

/** RSS 三栏宽度（占任务区百分比）；全局设置，新建任务共用。 */
export interface RssPaneWidths {
  /** 左栏列表，默认 22。 */
  listPct: number
  /** 右栏讨论，默认 32。 */
  aiPct: number
}

export const DEFAULT_RSS_PANE_WIDTHS: RssPaneWidths = { listPct: 22, aiPct: 32 }

const RSS_LIST_PCT_MIN = 16
const RSS_LIST_PCT_MAX = 40
const RSS_AI_PCT_MIN = 20
const RSS_AI_PCT_MAX = 45
/** 列表+讨论上限，给中间阅读区留空。 */
const RSS_SIDE_PCT_MAX = 78

function clampPct(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function normalizeRssPaneWidths(raw: unknown): RssPaneWidths {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  let listPct = clampPct(Number(o.listPct), RSS_LIST_PCT_MIN, RSS_LIST_PCT_MAX, DEFAULT_RSS_PANE_WIDTHS.listPct)
  let aiPct = clampPct(Number(o.aiPct), RSS_AI_PCT_MIN, RSS_AI_PCT_MAX, DEFAULT_RSS_PANE_WIDTHS.aiPct)
  if (listPct + aiPct > RSS_SIDE_PCT_MAX) {
    const scale = RSS_SIDE_PCT_MAX / (listPct + aiPct)
    listPct = clampPct(listPct * scale, RSS_LIST_PCT_MIN, RSS_LIST_PCT_MAX, DEFAULT_RSS_PANE_WIDTHS.listPct)
    aiPct = clampPct(aiPct * scale, RSS_AI_PCT_MIN, RSS_AI_PCT_MAX, DEFAULT_RSS_PANE_WIDTHS.aiPct)
  }
  return { listPct, aiPct }
}

/** 拖拽左栏时钳制，尽量不挤爆阅读区。 */
export function clampRssListPct(listPct: number, aiPct: number): number {
  const maxByReader = RSS_SIDE_PCT_MAX - clampPct(aiPct, RSS_AI_PCT_MIN, RSS_AI_PCT_MAX, DEFAULT_RSS_PANE_WIDTHS.aiPct)
  return clampPct(listPct, RSS_LIST_PCT_MIN, Math.min(RSS_LIST_PCT_MAX, maxByReader), DEFAULT_RSS_PANE_WIDTHS.listPct)
}

/** 拖拽讨论栏时钳制。 */
export function clampRssAiPct(aiPct: number, listPct: number): number {
  const maxByReader = RSS_SIDE_PCT_MAX - clampPct(listPct, RSS_LIST_PCT_MIN, RSS_LIST_PCT_MAX, DEFAULT_RSS_PANE_WIDTHS.listPct)
  return clampPct(aiPct, RSS_AI_PCT_MIN, Math.min(RSS_AI_PCT_MAX, maxByReader), DEFAULT_RSS_PANE_WIDTHS.aiPct)
}

export interface RssTaskFeed {
  id: string
  url: string
  title?: string
  /** 用户手标 1–5。 */
  rating?: RssValueScore
  /** 由条目 valueScore 聚合。 */
  avgScore?: number
  scoredCount?: number
}

export type RssEntryContentSource = 'feed' | 'extract' | 'model'
/** 简洁模式下当前看的是抓取原文还是模型整理版。 */
export type RssExtractPane = 'source' | 'model'

export interface RssTaskEntry {
  id: string
  feedId: string
  title: string
  url: string
  /** 抓取时落盘的源名，避免 feedId 对不上时全显示成「RSS」。 */
  feedTitle?: string
  snippet?: string
  /** 订阅里带的封面/enclosure，给工作台资讯缩略图。 */
  imageUrl?: string
  /** 评分/整理译出的展示标题；列表与工作台优先用这个。 */
  titleLocal?: string
  /** 评分打的细标签（实体/事件/产品，不当类目）。 */
  tags?: string[]
  /**
   * 当前展示用正文（兼容旧字段）。
   * 新逻辑优先读写 extractHtml / modelHtml；此字段由同步函数维护。
   */
  contentHtml?: string
  /** 抓取原文缓存（订阅内嵌或网页提取）。 */
  extractHtml?: string
  /** 模型整理版缓存（排版/媒体清单整理，不覆盖原文）。 */
  modelHtml?: string
  /** 简洁子态：原文 | 整理版。 */
  extractPane?: RssExtractPane
  /** 正文来源；model = 当前展示为模型整理版。 */
  contentSource?: RssEntryContentSource
  /**
   * 模型补全文失败时间。有值则不再自动重试（用户点「重新整理」可清）。
   */
  modelContentFailedAt?: number
  fetchedAt: number
  publishedAt?: number
  readAt?: number
  pinnedAt?: number
  valueScore?: RssValueScore
  scoreReason?: string
  scoredAt?: number
}

function htmlPlainEnough(html: string | undefined, min = 80): boolean {
  if (!html || articleLooksLikeChrome(html)) return false
  return articlePlainTextLen(html) >= min
}

/** 旧条目 → 拆出 extractHtml / modelHtml，并同步 contentHtml。 */
export function migrateRssEntryBodies(entry: RssTaskEntry): RssTaskEntry {
  let extractHtml = entry.extractHtml
  let modelHtml = entry.modelHtml
  const legacy = entry.contentHtml
  if (!extractHtml && !modelHtml && legacy) {
    if (entry.contentSource === 'model') modelHtml = legacy
    else extractHtml = legacy
  }
  // 整理版门槛低于「可讨论原文」：短整理也要能切过去，不能被 isThin 打回 source
  const hasModel = htmlPlainEnough(modelHtml, 80)
  const hasExtract = htmlPlainEnough(extractHtml, 40)
  let extractPane: RssExtractPane =
    entry.extractPane === 'model' || entry.extractPane === 'source'
      ? entry.extractPane
      : hasModel && !hasExtract
        ? 'model'
        : 'source'
  if (extractPane === 'model' && !hasModel) extractPane = 'source'
  if (extractPane === 'source' && !hasExtract && hasModel) extractPane = 'model'
  const contentHtml =
    extractPane === 'model' ? modelHtml || extractHtml : extractHtml || modelHtml || legacy
  const contentSource: RssEntryContentSource | undefined =
    extractPane === 'model' && modelHtml
      ? 'model'
      : extractHtml
        ? entry.contentSource === 'feed'
          ? 'feed'
          : 'extract'
        : entry.contentSource
  return {
    ...entry,
    extractHtml,
    modelHtml,
    extractPane,
    contentHtml,
    contentSource
  }
}

/** 抓取原文 HTML（不含模型版）。 */
export function rssEntrySourceHtml(
  entry: Pick<RssTaskEntry, 'extractHtml' | 'contentHtml' | 'contentSource'>
): string | undefined {
  if (entry.extractHtml) return entry.extractHtml
  if (entry.contentSource !== 'model') return entry.contentHtml
  return undefined
}

/** 模型整理版 HTML。 */
export function rssEntryModelHtml(
  entry: Pick<RssTaskEntry, 'modelHtml' | 'contentHtml' | 'contentSource'>
): string | undefined {
  if (entry.modelHtml) return entry.modelHtml
  if (entry.contentSource === 'model') return entry.contentHtml
  return undefined
}

/** 简洁区当前应展示的 HTML。 */
export function rssEntryDisplayHtml(entry: RssTaskEntry): string | undefined {
  const e = migrateRssEntryBodies(entry)
  return e.extractPane === 'model'
    ? rssEntryModelHtml(e) || rssEntrySourceHtml(e)
    : rssEntrySourceHtml(e) || rssEntryModelHtml(e)
}

export function rssEntryHasModelBody(entry: RssTaskEntry): boolean {
  return htmlPlainEnough(rssEntryModelHtml(entry), 80)
}

export function rssEntryHasSourceBody(entry: RssTaskEntry): boolean {
  const html = rssEntrySourceHtml(entry)
  if (!html || articleLooksLikeChrome(html)) return false
  // 完整短讯也算原文
  return !isThinArticleHtml(html) || articlePlainTextLen(html) >= 100
}

/** 写入抓取原文，保留模型版。 */
export function withRssExtractHtml(
  entry: RssTaskEntry,
  html: string,
  source: 'feed' | 'extract' = 'extract'
): RssTaskEntry {
  return migrateRssEntryBodies({
    ...entry,
    extractHtml: html,
    contentHtml: html,
    contentSource: source,
    extractPane: 'source',
    modelContentFailedAt: undefined
  })
}

/** 写入模型整理版，保留原文；并切到整理版。 */
export function withRssModelHtml(entry: RssTaskEntry, html: string): RssTaskEntry {
  const base = migrateRssEntryBodies(entry)
  return migrateRssEntryBodies({
    ...base,
    modelHtml: html,
    contentHtml: html,
    contentSource: 'model',
    extractPane: 'model',
    modelContentFailedAt: undefined
  })
}

/** 切换简洁子态。 */
export function withRssExtractPane(entry: RssTaskEntry, pane: RssExtractPane): RssTaskEntry {
  const base = migrateRssEntryBodies(entry)
  if (pane === 'model' && !rssEntryModelHtml(base)) return base
  if (pane === 'source' && !rssEntrySourceHtml(base) && rssEntryModelHtml(base)) {
    return migrateRssEntryBodies({ ...base, extractPane: 'model' })
  }
  return migrateRssEntryBodies({ ...base, extractPane: pane })
}

/** 条目是否已有可展示正文（原文或模型版任一可用）。 */
export function rssEntryHasUsableBody(
  entry: Pick<RssTaskEntry, 'contentHtml'> &
    Partial<Pick<RssTaskEntry, 'extractHtml' | 'modelHtml' | 'contentSource' | 'extractPane'>>
): boolean {
  const full = entry as RssTaskEntry
  const html =
    rssEntryDisplayHtml(full) ||
    rssEntrySourceHtml(full) ||
    rssEntryModelHtml(full) ||
    entry.contentHtml
  if (!html) return false
  if (isThinArticleHtml(html)) return false
  if (articleLooksLikeChrome(html)) return false
  return true
}

/**
 * 是否有「能先读着」的内容：完整正文，或非导航壳的半截正文 / 订阅摘要。
 * 用于避免「明明有摘要却报提取失败」。
 */
export function rssEntryHasDisplayableBody(
  entry: Pick<RssTaskEntry, 'contentHtml' | 'snippet'> &
    Partial<Pick<RssTaskEntry, 'extractHtml' | 'modelHtml' | 'contentSource'>>
): boolean {
  if (rssEntryHasUsableBody(entry)) return true
  const html = rssEntrySourceHtml(entry as RssTaskEntry) || entry.contentHtml
  if (html && !articleLooksLikeChrome(html) && articlePlainTextLen(html) >= 80) return true
  const snip = (entry.snippet || '').replace(/\s+/g, ' ').trim()
  return snip.length >= 40
}

/** 是否还应尝试模型补全文（点选时；已有整理版/已失败则跳过）。 */
export function rssEntryNeedsModelBody(entry: RssTaskEntry): boolean {
  if (entry.modelContentFailedAt) return false
  if (rssEntryHasModelBody(entry)) return false
  // 已有可用原文时不自动调模型；用户点「用模型整理」再生成
  if (rssEntryHasSourceBody(entry)) return false
  return !rssEntryHasUsableBody(entry)
}

export type RssTaskFilter = 'all' | 'unread' | 'valuable' | `score:${RssValueScore}` | `feed:${string}`

export type RssReaderMode = 'web' | 'extract' | 'digest'

export interface RssScoringState {
  status: 'idle' | 'running' | 'error'
  error?: string
  updatedAt?: number
}

/** 消息处置流水线阶段（简报生成门禁）。 */
export type RssDispositionStage =
  | 'idle'
  | 'fetching'
  | 'scoring'
  | 'picking'
  | 'digesting'
  | 'done'
  | 'skeleton'

export interface RssDispositionState {
  stage: RssDispositionStage
  /** 给人看的进度：正在评 12 条 / 纳入 40/188 */
  detail?: string
  updatedAt: number
}

/** 补抓正文落盘补丁。 */
export interface RssBodyPatch {
  id: string
  extractHtml: string
  contentSource: 'feed' | 'extract'
  title?: string
}

export function dispositionLabel(stage: RssDispositionStage): string {
  switch (stage) {
    case 'fetching':
      return '正在拉取订阅'
    case 'scoring':
      return '正在评分'
    case 'picking':
      return '正在截取素材'
    case 'digesting':
      return '正在写简报'
    case 'done':
      return '模型归纳完成'
    case 'skeleton':
      return '简报还没写好，先看简版'
    default:
      return ''
  }
}

/** 一次简报快照（历史列表项）。 */
export interface RssDigestRecord {
  id: string
  /** 列表/阅读区标题；缺省由正文首行或时间窗生成。 */
  title?: string
  createdAt: number
  windowHours: RssDigestWindowHours
  /** 自定义起止日（YYYY-MM-DD）；有则优先于 windowHours。 */
  rangeFrom?: string
  rangeTo?: string
  template: RssDigestTemplate
  markdown: string
  mode: 'model' | 'heuristic'
  /** 实际纳入生成的条数（截取后）。 */
  entryCount: number
  /** 时间窗内候选条数；大于 entryCount 表示已截取。 */
  windowCount?: number
  error?: string
  /** 打开/阅读后写入；已读简报不再进宠物气泡。 */
  readAt?: number
}

/** 自动简报：常用间隔预设（小时）；也支持 1–168 自定义。 */
export const RSS_DIGEST_INTERVALS = [6, 12, 24, 48] as const
/** 每隔 N 小时自动生成；合法范围 1–168。 */
export type RssDigestIntervalHours = number

export function normalizeRssDigestIntervalHours(raw: unknown): RssDigestIntervalHours | undefined {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return undefined
  const h = Math.round(n)
  if (h < 1 || h > 168) return undefined
  return h
}

/** 每日定点小时 0–23。 */
export function normalizeRssDigestHour(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return undefined
  const h = Math.floor(n)
  if (h < 0 || h > 23) return undefined
  return h
}

/**
 * 每日多选整点（0–23，升序去重）。
 * 兼容旧字段 digestHour（单点）。
 */
export function normalizeRssDigestHours(
  raw: unknown,
  legacyHour?: unknown
): number[] | undefined {
  const fromArr = Array.isArray(raw)
    ? raw
        .map((x) => normalizeRssDigestHour(x))
        .filter((x): x is number => x != null)
    : []
  const unique = [...new Set(fromArr)].sort((a, b) => a - b)
  if (unique.length) return unique
  const one = normalizeRssDigestHour(legacyHour)
  return one != null ? [one] : undefined
}

export function formatRssDigestHoursLabel(hours: number[] | undefined): string {
  if (!hours?.length) return ''
  return hours.map((h) => `${String(h).padStart(2, '0')}:00`).join('、')
}

export function toggleRssDigestHour(hours: number[] | undefined, hour: number): number[] {
  const h = normalizeRssDigestHour(hour)
  if (h == null) return normalizeRssDigestHours(hours) || []
  const cur = new Set(normalizeRssDigestHours(hours) || [])
  if (cur.has(h)) cur.delete(h)
  else cur.add(h)
  return [...cur].sort((a, b) => a - b)
}

/** 体例固定章节名，不能当简报题目。 */
const RSS_DIGEST_SECTION_TITLES = new Set([
  '本期概览',
  '必读头条',
  '关键信号',
  '为什么重要',
  '该盯谁/盯什么',
  '资料来源',
  '值得跟进',
  '可暂缓',
  '重点条目',
  '信息窗口',
  '简报',
  '热点',
  '盘点',
  '时段概述',
  '时段总结',
  '时段汇总',
  '资讯概述',
  '资讯汇总',
  '热点概述',
  '热点汇总',
  '内容概述',
  '本周概述',
  '今日概述',
  '每日概述',
  '周报',
  '日报'
])

function cleanDigestTitleCandidate(raw: string): string {
  return raw
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUrlishTitle(t: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t)
}

/** 套话 / 章节名 / 空泛题：不当作每份简报的题目。 */
export function isBoilerplateRssDigestTitle(raw: string | undefined | null): boolean {
  const t = cleanDigestTitleCandidate(raw || '')
  if (!t) return true
  if (RSS_DIGEST_SECTION_TITLES.has(t)) return true
  if (/^信息窗口/.test(t)) return true
  if (/^(完整|精简|跟进)?\s*简报$/.test(t)) return true
  // 「时段概述」「近一周汇总」等空泛题（不含「今日要闻」这类尚可的题）
  if (
    /^(近?\s*(一周|一日|一天|24\s*小时|6\s*小时|12\s*小时|48\s*小时)?|[本今昨][日天周]|时段|热点|资讯|新闻|内容|订阅)?(概述|汇总|综述|盘点|简报|总结)$/.test(
      t
    )
  ) {
    return true
  }
  if (t.length <= 6 && /(概述|汇总|综述|盘点)$/.test(t)) return true
  return false
}

/** 列表/阅读区题名最长字数（短标题，避免一长串）。 */
export const RSS_DIGEST_TITLE_MAX = 28

/** 收成短标题：去掉「A · B」拼接与过长从句。 */
export function compactDigestTitle(raw: string): string {
  let t = cleanDigestTitleCandidate(raw)
  if (!t) return ''
  if (t.includes(' · ')) t = t.split(' · ')[0]?.trim() || t
  if (t.includes(' | ')) t = t.split(' | ')[0]?.trim() || t
  // 长句只取首分句
  if (t.length > RSS_DIGEST_TITLE_MAX) {
    const clause = t.split(/[。！？!?；;\n]/)[0]?.trim() || t
    t = clause
  }
  if (t.length > RSS_DIGEST_TITLE_MAX) {
    const clause = t.split(/[，、：:]/)[0]?.trim() || t
    if (clause.length >= 6) t = clause
  }
  if (t.length > RSS_DIGEST_TITLE_MAX) {
    t = t.slice(0, RSS_DIGEST_TITLE_MAX).replace(/[·\-\s,:，、：:]+$/u, '')
  }
  return t.trim()
}

/** 是否适合当列表题名（非套话、非纯链接、非长串）。 */
export function isUsableRssDigestTitle(raw: string | undefined | null): boolean {
  const t = cleanDigestTitleCandidate(raw || '')
  if (!t || t.length < 4) return false
  if (isBoilerplateRssDigestTitle(t)) return false
  if (isUrlishTitle(t)) return false
  if (!/[\u4e00-\u9fffA-Za-z]/.test(t)) return false
  // 「A · B · C」或明显段落不当题
  if (/ · /.test(t) && t.length > 20) return false
  if (t.length > RSS_DIGEST_TITLE_MAX + 8) return false
  return true
}

function clipDigestTitlePart(raw: string, max: number): string {
  const t = compactDigestTitle(raw) || raw.trim()
  if (t.length <= max) return t
  return t.slice(0, max).replace(/[·\-\s,:，、：:的与和]+$/u, '') || t.slice(0, max)
}

/**
 * 多条时的回落题名：用「首题等 N 则」。
 * 禁止「A与B」硬拼两条无关新闻——那会让用户以为在读单篇文章。
 */
function titleFromDigestEntries(entries: Array<{ title?: string }> | undefined): string | undefined {
  if (!entries?.length) return undefined
  const usable: string[] = []
  for (const e of entries) {
    const compact = compactDigestTitle(e.title || '')
    if (isUsableRssDigestTitle(compact)) usable.push(compact)
    if (usable.length >= 4) break
  }
  if (!usable.length) return undefined
  if (usable.length === 1) return usable[0]
  const a = clipDigestTitlePart(usable[0], 16)
  return compactDigestTitle(`${a}等${usable.length}则`) || usable[0]
}

/** 模型若照抄首条目标题，不当作融合题名。 */
function isCopiedEntryDigestTitle(
  title: string,
  entries: Array<{ title?: string }> | undefined
): boolean {
  if (!entries || entries.length < 2) return false
  const t = compactDigestTitle(title)
  if (!t) return false
  const first = compactDigestTitle(entries[0]?.title || '')
  if (!first) return false
  return t === first || first.startsWith(t) || t.startsWith(first.slice(0, Math.min(10, first.length)))
}

/** 从正文抽题：优先短 # 标题，再 ### 事件名，再要点首句。 */
export function extractRssDigestTitleFromMarkdown(markdown: string | undefined): string | undefined {
  if (!markdown?.trim()) return undefined
  const lines = markdown.split(/\r?\n/)
  let h1: string | undefined
  let h3: string | undefined
  let h2Event: string | undefined
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)$/)
    if (!m) continue
    const level = m[1].length
    const cand = compactDigestTitle(m[2].replace(/^\d+\.\s*/, ''))
    if (!isUsableRssDigestTitle(cand)) continue
    if (level === 1) {
      h1 = cand
      break
    }
    if (level === 3 && !h3) h3 = cand
    // 跳过体例章节，其它 ## 也可作题
    if (level === 2 && !h2Event && !isBoilerplateRssDigestTitle(cand)) h2Event = cand
  }
  if (h1) return h1
  if (h3) return h3
  if (h2Event) return h2Event

  for (const line of lines) {
    const bold = line.match(/^[●•-]\s+\*\*(.+?)\*\*/)
    if (bold) {
      const cand = compactDigestTitle(bold[1])
      if (isUsableRssDigestTitle(cand)) return cand
    }
    const plain = line.match(/^[●•]\s+(.+)$/)
    if (plain) {
      let cand = cleanDigestTitleCandidate(plain[1])
      cand = cand
        .replace(/\s*\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/\s*[（(][^）)]{0,40}[）)]\s*$/, '')
        .trim()
      cand = compactDigestTitle(cand)
      if (isUsableRssDigestTitle(cand)) return cand
    }
  }
  return undefined
}

/** 从正文标题、条目或时间窗拼出短题名（每份不同，避免一长串）。 */
export function buildRssDigestTitle(opts: {
  markdown?: string
  windowHours: number
  createdAt: number
  /** 生成时可传入窗内条目，作启发式题名。 */
  entries?: Array<{ title?: string }>
}): string {
  // 正文短标题优先（须是融合题，不能照抄首条）；再回落多条融合
  const fromMd = extractRssDigestTitleFromMarkdown(opts.markdown)
  if (fromMd && !isCopiedEntryDigestTitle(fromMd, opts.entries)) return fromMd
  const fromEntries = titleFromDigestEntries(opts.entries)
  if (fromEntries) return fromEntries
  if (fromMd) return fromMd
  const d = new Date(opts.createdAt)
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return compactDigestTitle(`${md} ${hm} 简报`) || `${md} 简报`
}

export function rssDigestDisplayTitle(d: RssDigestRecord): string {
  const t = d.title?.trim()
  if (isUsableRssDigestTitle(t)) return compactDigestTitle(t!)
  const built = buildRssDigestTitle(d)
  return compactDigestTitle(built) || built
}

/** 纠正套话/长串题名，并保证正文有短 # 标题。 */
export function healRssDigestTitle(d: RssDigestRecord): RssDigestRecord {
  const title = rssDigestDisplayTitle(d)
  const lines = (d.markdown || '').split('\n')
  const h1 = lines[0]?.match(/^#\s+(.+)$/)?.[1]?.trim()
  let markdown = d.markdown || ''
  if (h1) {
    if (!isUsableRssDigestTitle(h1) || compactDigestTitle(h1) !== h1) {
      lines[0] = `# ${title}`
      markdown = lines.join('\n')
    }
  } else if (markdown.trim()) {
    const infoIdx = lines.findIndex((l) => /^信息窗口：/.test(l))
    if (infoIdx >= 0) lines.splice(infoIdx, 0, `# ${title}`)
    else lines.unshift(`# ${title}`)
    markdown = lines.join('\n')
  }
  if (d.title === title && d.markdown === markdown) return d
  return { ...d, title, markdown }
}

export interface RssTaskState {
  feeds: RssTaskFeed[]
  items: RssTaskEntry[]
  selectedId?: string
  filter?: RssTaskFilter
  /** 中间栏：默认简洁（正文提取）；网页为备选；digest 为热点盘点。 */
  readerMode?: RssReaderMode
  /**
   * 右侧讨论栏：
   * - auto（默认）：该条有消息才显示
   * - show：手动打开（可空讨论）
   * - hide：手动隐藏
   * 新提问会回到 show。
   */
  discussionPanel?: 'auto' | 'show' | 'hide'
  /**
   * 正文多段划词分析依赖：进引擎上下文；切条目/简报时须与 selectedId 对齐否则忽略。
   * （兼容旧字段 analysisQuote 单段）
   */
  analysisQuotes?: RssAnalysisQuote[]
  /** @deprecated 用 analysisQuotes */
  analysisQuote?: RssAnalysisQuote
  /** 是否自动对未打分条目调用模型/启发式。 */
  scoreEnabled?: boolean
  /**
   * 本任务评分模型覆盖（空=用全局 rssScoreModelRef；再空=规则）。
   * 勿与对话 Agent 混用。
   */
  scoreModelRef?: string
  /** 本任务评分节奏覆盖；空=用全局 rssScoreMode。 */
  scoreMode?: 'realtime' | 'interval' | 'off'
  /** 本任务定时评分间隔（分钟）；空=用全局。 */
  scoreIntervalMinutes?: number
  /** 「高价值」筛选阈值，默认 4。 */
  scoreMinForValuable?: 3 | 4 | 5
  digestWindowHours?: RssDigestWindowHours
  /** 自定义简报起止日（YYYY-MM-DD）；与 digestRangeTo 成对时优先生效。 */
  digestRangeFrom?: string
  digestRangeTo?: string
  /**
   * 自动简报：每日定点小时（可多选，0–23）。
   * 与 digestIntervalHours 互斥；都空 = 不定时。
   */
  digestHours?: number[]
  /** @deprecated 旧单点字段，读取时迁入 digestHours。 */
  digestHour?: number
  /** 自动简报：每隔 N 小时（任务打开时检查）。与 digestHours 互斥。 */
  digestIntervalHours?: RssDigestIntervalHours
  /** 简报报告形态。 */
  digestTemplate?: RssDigestTemplate
  /** 简报历史（新在前）。 */
  digests?: RssDigestRecord[]
  /** 当前查看的简报记录 id。 */
  selectedDigestId?: string
  lastDigestAt?: number
  lastDigestMarkdown?: string
  lastDigestError?: string
  /** 简报正在生成（可跨切换任务持久化；切走不应取消）。 */
  digestGenerating?: boolean
  /** 消息处置流水线进度（拉取→评分→截取→写稿）。 */
  disposition?: RssDispositionState
  scoring?: RssScoringState
  updatedAt: number
  lastError?: string
}

export const EMPTY_RSS_TASK: RssTaskState = {
  feeds: [],
  items: [],
  filter: 'all',
  readerMode: 'extract',
  scoreEnabled: true,
  scoreMode: 'realtime',
  scoreIntervalMinutes: 30,
  scoreMinForValuable: 4,
  digestWindowHours: 24,
  digestTemplate: 'full',
  digests: [],
  updatedAt: 0
}

export function clampRssScore(n: unknown): RssValueScore | undefined {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN
  if (!Number.isFinite(v)) return undefined
  const r = Math.round(v)
  if (r < 1 || r > 5) return undefined
  return r as RssValueScore
}

/** 分值语义：5 必读 · 4 值得看 · 3 一般 · 2 可略 · 1 噪音 */
export const RSS_SCORE_LABELS: Record<RssValueScore, string> = {
  5: '必读',
  4: '值得看',
  3: '一般',
  2: '可略',
  1: '噪音'
}

export function rssScoreLabel(score: RssValueScore | undefined | null): string {
  if (score == null) return '未评'
  return RSS_SCORE_LABELS[score] || '未评'
}

export function rssScoreThreshold(state: RssTaskState | undefined): 3 | 4 | 5 {
  const m = state?.scoreMinForValuable
  return m === 3 || m === 5 ? m : 4
}

/** 「重点」筛选文案：值得看及以上 / 仅必读 等 */
export function rssValuableFilterLabel(min: 3 | 4 | 5): string {
  if (min === 5) return '必读'
  if (min === 3) return '一般+'
  return '值得看+'
}

/** 简报勾选/定时收录用的评分下限；0 = 不限。 */
export type RssDigestScoreMin = 0 | 3 | 4 | 5

export function normalizeRssDigestScoreMin(raw: unknown): RssDigestScoreMin {
  return raw === 3 || raw === 4 || raw === 5 ? raw : 0
}

/** 写入 ScheduledTask 时：0 / 无效 → undefined。 */
export function rssDigestScoreMinOrUndef(
  raw: unknown
): 3 | 4 | 5 | undefined {
  const min = normalizeRssDigestScoreMin(raw)
  return min === 0 ? undefined : min
}

export function rssDigestScoreMinLabel(min: RssDigestScoreMin): string {
  if (min === 0) return '全部'
  return rssValuableFilterLabel(min)
}

/** 按评分下限过滤条目（0 = 原列表）。 */
export function filterEntriesByDigestScoreMin<T extends { valueScore?: RssValueScore | null }>(
  entries: ReadonlyArray<T>,
  min: RssDigestScoreMin
): T[] {
  if (min === 0) return [...entries]
  return entries.filter((e) => (e.valueScore || 0) >= min)
}

export function formatDigestWindow(hours: number): string {
  if (hours < 24) return `${hours} 小时`
  if (hours === 24) return '今天'
  if (hours === 48) return '两天'
  if (hours === 72) return '三天'
  if (hours === 168) return '一周'
  return `${Math.round(hours / 24)} 天`
}

/** 列表/工具栏用的范围短标签。 */
export function formatDigestRangeLabel(
  source:
    | Pick<RssTaskState, 'digestWindowHours' | 'digestRangeFrom' | 'digestRangeTo'>
    | Pick<RssDigestRecord, 'windowHours' | 'rangeFrom' | 'rangeTo'>
): string {
  if ('windowHours' in source && !('digestWindowHours' in source)) {
    return resolveDigestBoundsFromRecord(
      source as Pick<RssDigestRecord, 'windowHours' | 'rangeFrom' | 'rangeTo'>
    ).label
  }
  return resolveDigestTimeBounds(
    source as Pick<RssTaskState, 'digestWindowHours' | 'digestRangeFrom' | 'digestRangeTo'>
  ).label
}

export function isEntryValuable(
  entry: RssTaskEntry,
  min: 3 | 4 | 5 = 4
): boolean {
  return (entry.valueScore || 0) >= min
}

export function rssValuableCount(state: RssTaskState | undefined): number {
  if (!state?.items?.length) return 0
  const min = rssScoreThreshold(state)
  return state.items.filter((x) => isEntryValuable(x, min)).length
}

/** 各重点阈值下的条数（≥3 / ≥4 / ≥5），供列表头罗列。 */
export function rssValuableCountsByMin(
  state: RssTaskState | undefined
): Record<3 | 4 | 5, number> {
  const empty = { 3: 0, 4: 0, 5: 0 } as Record<3 | 4 | 5, number>
  if (!state?.items?.length) return empty
  for (const x of state.items) {
    const s = x.valueScore || 0
    if (s >= 3) empty[3]++
    if (s >= 4) empty[4]++
    if (s >= 5) empty[5]++
  }
  return empty
}

export const RSS_VALUABLE_MINS = [3, 4, 5] as const

export function rssUnscoredCount(state: RssTaskState | undefined): number {
  if (!state?.items?.length) return 0
  return state.items.filter((x) => x.valueScore == null).length
}

export function isRssTaskFilter(raw: unknown): raw is RssTaskFilter {
  if (raw === 'all' || raw === 'unread' || raw === 'valuable') return true
  if (typeof raw !== 'string') return false
  if (raw.startsWith('feed:') && raw.length > 5) return true
  if (raw.startsWith('score:')) {
    const n = Number(raw.slice(6))
    return n === 1 || n === 2 || n === 3 || n === 4 || n === 5
  }
  return false
}

export function feedIdFromUrl(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0
  return `f${(h >>> 0).toString(36)}`
}

type FeedMeta = {
  title?: string
  rating?: RssValueScore
  avgScore?: number
  scoredCount?: number
}

/** 任务级源列表（允许多于全局简报的 6 个）。 */
export function normalizeRssTaskFeeds(raw: unknown): RssTaskFeed[] {
  const urls: string[] = []
  const metaByUrl = new Map<string, FeedMeta>()
  const putMeta = (url: string, meta: FeedMeta): void => {
    let key = url
    try {
      key = new URL(url).href
    } catch {
      /* keep */
    }
    const prev = metaByUrl.get(key) || {}
    metaByUrl.set(key, {
      title: meta.title || prev.title,
      rating: meta.rating ?? prev.rating,
      avgScore: meta.avgScore ?? prev.avgScore,
      scoredCount: meta.scoredCount ?? prev.scoredCount
    })
  }
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (typeof row === 'string') urls.push(row)
      else if (row && typeof row === 'object' && typeof (row as RssTaskFeed).url === 'string') {
        const f = row as RssTaskFeed
        urls.push(f.url)
        putMeta(f.url, {
          title: typeof f.title === 'string' && f.title.trim() ? f.title.trim().slice(0, 48) : undefined,
          rating: clampRssScore(f.rating),
          avgScore: typeof f.avgScore === 'number' && Number.isFinite(f.avgScore) ? f.avgScore : undefined,
          scoredCount:
            typeof f.scoredCount === 'number' && Number.isFinite(f.scoredCount)
              ? Math.max(0, Math.floor(f.scoredCount))
              : undefined
        })
      }
    }
  } else if (typeof raw === 'string') {
    urls.push(...raw.split(/\r?\n/))
  }
  const all = normalizeRssFeedUrls(urls, RSS_TASK_MAX_FEEDS)
  for (const p of RSS_FEED_PRESETS) {
    try {
      const href = new URL(p.url).href
      if (!metaByUrl.get(href)?.title) putMeta(href, { title: p.name })
      if (!metaByUrl.get(p.url)?.title) putMeta(p.url, { title: p.name })
    } catch {
      if (!metaByUrl.get(p.url)?.title) putMeta(p.url, { title: p.name })
    }
  }
  return all.map((url) => {
    let meta = metaByUrl.get(url)
    if (!meta) {
      try {
        meta = metaByUrl.get(new URL(url).href)
      } catch {
        /* ignore */
      }
    }
    return {
      id: feedIdFromUrl(url),
      url,
      title: meta?.title || rssSourceLabel(url),
      rating: meta?.rating,
      avgScore: meta?.avgScore,
      scoredCount: meta?.scoredCount
    }
  })
}

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** 拉源错误最多保留几条（按源分条；列表多条时收成摘要）。 */
export const RSS_TASK_MAX_FEED_ERRORS = 8

/**
 * 拉源失败条上展示的源名：有标题用标题；否则 host + 路径尾，避免同主机多源撞名连坐。
 */
export function rssFeedPullErrorLabel(feed: { url: string; title?: string }): string {
  const title = feed.title?.trim()
  if (title) return title.slice(0, 32)
  try {
    const u = new URL(feed.url)
    const host = u.hostname.replace(/^www\./i, '')
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    const tail = parts.slice(-2).join('/')
    if (tail) return `${host}/${tail}`.slice(0, 48)
    return host || rssSourceLabel(feed.url)
  } catch {
    return rssSourceLabel(feed.url, feed.title)
  }
}

/** 主进程写的单源失败文案。 */
export function formatRssFeedPullError(
  kind: 'access' | 'parse',
  feed: { url: string; title?: string }
): string {
  const label = rssFeedPullErrorLabel(feed)
  return kind === 'parse' ? `解析失败 ${label}` : `无法访问 ${label}`
}

/** 去重键：整句（每源一条，不再按主机合并）。 */
export function rssFeedErrorDedupeKey(errorLine: string): string {
  const line = errorLine.trim()
  return line ? `line:${line.toLowerCase()}` : ''
}

/** 同文案只留首条，顺序不变。 */
export function dedupeRssFeedErrors(errors: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of errors || []) {
    const line = raw.trim()
    if (!line) continue
    const key = rssFeedErrorDedupeKey(line)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

/** 把 lastError 拆成单源提醒（主进程用「；」拼接；读时去重）。 */
export function splitRssFeedErrors(lastError: string | undefined): string[] {
  if (!lastError?.trim()) return []
  return dedupeRssFeedErrors(
    lastError
      .split(/[；;]/)
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/** 多条错误压成持久化字符串；空则 undefined。 */
export function joinRssFeedErrors(errors: string[] | undefined): string | undefined {
  const parts = dedupeRssFeedErrors(errors).slice(0, RSS_TASK_MAX_FEED_ERRORS)
  if (!parts.length) return undefined
  return parts.join('；')
}

/** 摘要条文案：条数 + 前两条预览。 */
export function summarizeRssFeedErrors(errors: string[] | undefined): string {
  const parts = dedupeRssFeedErrors(errors)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  const head = parts.slice(0, 2).join('；')
  const more = parts.length > 2 ? ` 等 ${parts.length} 个` : ''
  return `${parts.length} 个源异常：${head}${more}`
}

/**
 * 从拉源失败文案里抠「纯主机名」（旧版「无法访问 host」）。
 * 新版标签可能含路径，不算主机名。
 */
export function hostsFromRssFeedError(lastError: string): string[] {
  const out: string[] = []
  const re = /(?:无法访问|解析失败)\s+([^\s；;，,]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lastError))) {
    const token = m[1].trim()
    // 含路径或空格的是源标签，不是旧版纯主机
    if (!token || token.includes('/')) continue
    const h = token.replace(/^www\./i, '').toLowerCase()
    if (!h || h === 'rss' || !h.includes('.')) continue
    if (!out.includes(h)) out.push(h)
  }
  return out
}

/** 访问/解析失败匹配用：只用源专属标签，不含裸主机名（防同主机连坐）。 */
function feedLabelsForPullErrorMatch(feed: RssTaskFeed): string[] {
  const out: string[] = []
  const title = feed.title?.trim()
  if (title) {
    out.push(title)
    out.push(title.slice(0, 24))
    out.push(title.slice(0, 32))
  }
  const pull = rssFeedPullErrorLabel(feed)
  if (pull) out.push(pull)
  return [...new Set(out.map((s) => s.trim().toLowerCase()).filter(Boolean))]
}

/** 旧版「标签 无条目」：空窗提示，不是拉源失败，禁止当失败源删除。 */
export function isRssFeedEmptyPullNotice(errorLine: string | undefined): boolean {
  return /^(.+?)\s*无条目$/.test((errorLine || '').trim())
}

/**
 * 单条失败文案对应哪些订阅源（删除必须精确，禁止同主机连坐）。
 * - 「无法访问 / 解析失败 标签」按源标签精确匹配
 * - 旧版纯主机名：仅当该主机下只有 1 个源时才可删
 * - 「标签 无条目」一律不匹配（空窗 ≠ 可删失败）
 */
export function feedsMatchingOneRssFeedError(
  feeds: RssTaskFeed[],
  errorLine: string | undefined
): RssTaskFeed[] {
  const line = (errorLine || '').trim()
  if (!line || !feeds.length) return []
  if (isRssFeedEmptyPullNotice(line)) return []

  const pull = line.match(/^(?:无法访问|解析失败)\s+(.+)$/)
  if (pull) {
    const label = pull[1].trim().toLowerCase()
    if (!label) return []
    const byLabel = feeds.filter((f) => feedLabelsForPullErrorMatch(f).includes(label))
    if (byLabel.length === 1) return byLabel
    if (byLabel.length > 1) {
      const exact = byLabel.filter((f) => rssFeedPullErrorLabel(f).toLowerCase() === label)
      // 标题撞车时只删一条，绝不按主机清空
      return exact.length ? [exact[0]!] : [byLabel[0]!]
    }
    // 旧版「无法访问 host」：同主机多源时不匹配，避免连坐
    const hosts = hostsFromRssFeedError(line)
    if (hosts.length === 1) {
      const host = hosts[0]!
      const byHost = feeds.filter((f) => hostKey(f.url) === host)
      if (byHost.length === 1) return byHost
    }
    return []
  }

  return []
}

/** 失败条用的分条：去掉「无条目」空窗提示，只留可操作的访问/解析失败。 */
export function splitRssFeedActionableErrors(lastError: string | undefined): string[] {
  return splitRssFeedErrors(lastError).filter((e) => !isRssFeedEmptyPullNotice(e))
}

/** 找出 lastError 里点名的失败源（可多条；不含空窗「无条目」）。 */
export function feedsMatchingRssFeedError(
  feeds: RssTaskFeed[],
  lastError: string | undefined
): RssTaskFeed[] {
  const lines = splitRssFeedActionableErrors(lastError)
  if (!lines.length) return []
  const seen = new Set<string>()
  const out: RssTaskFeed[] = []
  for (const line of lines) {
    for (const f of feedsMatchingOneRssFeedError(feeds, line)) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push(f)
    }
  }
  return out
}

/** 列表/阅读头用来源名：条目落盘名 → 订阅源 → 主机名/预设。 */
export function rssEntrySourceLabel(
  state: RssTaskState | undefined,
  entry: RssTaskEntry | undefined
): string {
  if (!entry) return 'RSS'
  const stamped = entry.feedTitle?.trim()
  if (stamped && stamped !== 'RSS') return stamped.slice(0, 32)
  const feed = state?.feeds.find((f) => f.id === entry.feedId)
  if (feed?.title?.trim()) return feed.title.trim().slice(0, 32)
  const entryHost = hostKey(entry.url)
  if (entryHost && state?.feeds?.length) {
    const byHost = state.feeds.find((f) => hostKey(f.url) === entryHost)
    if (byHost?.title?.trim()) return byHost.title.trim().slice(0, 32)
  }
  if (entryHost) {
    const preset = RSS_FEED_PRESETS.find((p) => hostKey(p.url) === entryHost)
    if (preset) return preset.name
    const fromCatalog = rssCatalogNameForHost(entryHost)
    if (fromCatalog) return fromCatalog
    return entryHost
  }
  return 'RSS'
}

/** 列表用短来源名：去掉频道后缀、过长尾巴，避免胶囊挤成一团。 */
export function rssShortSourceLabel(label: string): string {
  let s = (label || '').trim().replace(/\s+/g, ' ')
  if (!s) return 'RSS'
  if (/^hacker\s*news\b/i.test(s)) return 'HN'
  if (/^product\s*hunt\b/i.test(s)) return 'PH'
  // 「某某 - Newest: 'A'」「某某 – 频道名」只留主名
  s = s.replace(/\s+[–—|:·]\s+.+$/, '').trim() || s
  s = s.replace(/\s+-\s+.+$/, '').trim() || s
  if (s.length > 12) s = `${s.slice(0, 11)}…`
  return s
}

/** 刷新后纠偏：feedId 漂移时按主机名挂回，并补 feedTitle。 */
export function reconcileRssEntrySources(state: RssTaskState): RssTaskState {
  const items = state.items.map((it) => {
    let feed = state.feeds.find((f) => f.id === it.feedId)
    if (!feed) {
      const h = hostKey(it.url)
      if (h) feed = state.feeds.find((f) => hostKey(f.url) === h)
    }
    const feedTitle = rssEntrySourceLabel(
      { ...state, items: [] },
      feed ? { ...it, feedId: feed.id, feedTitle: it.feedTitle || feed.title } : it
    )
    return {
      ...it,
      feedId: feed?.id || it.feedId,
      feedTitle
    }
  })
  return { ...state, items }
}

export function emptyRssTaskState(feeds: RssTaskFeed[] = []): RssTaskState {
  return {
    feeds,
    items: [],
    filter: 'all',
    readerMode: 'extract',
    scoreEnabled: true,
    scoreMode: 'realtime',
    scoreIntervalMinutes: 30,
    scoreMinForValuable: 4,
    digestWindowHours: 24,
    digestTemplate: 'full',
    digests: [],
    updatedAt: Date.now()
  }
}

function normalizeRssDigestRecord(raw: unknown): RssDigestRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return undefined
  if (typeof o.markdown !== 'string' || !o.markdown.trim()) return undefined
  const createdAt = typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now()
  const windowHours = RSS_DIGEST_WINDOWS.includes(o.windowHours as RssDigestWindowHours)
    ? (o.windowHours as RssDigestWindowHours)
    : 24
  const entryCount =
    typeof o.entryCount === 'number' && Number.isFinite(o.entryCount)
      ? Math.max(0, Math.floor(o.entryCount))
      : 0
  const windowCount =
    typeof o.windowCount === 'number' && Number.isFinite(o.windowCount)
      ? Math.max(entryCount, Math.floor(o.windowCount))
      : undefined
  const markdown = o.markdown.slice(0, 48_000)
  const titleRaw = typeof o.title === 'string' ? o.title.trim().slice(0, 72) : ''
  const title = isUsableRssDigestTitle(titleRaw)
    ? titleRaw
    : buildRssDigestTitle({ markdown, windowHours, createdAt })
  const rangeFrom = isDigestYmd(o.rangeFrom) ? o.rangeFrom.trim() : undefined
  const rangeTo = isDigestYmd(o.rangeTo) ? o.rangeTo.trim() : undefined
  return {
    id: o.id.trim(),
    title,
    createdAt,
    windowHours,
    rangeFrom,
    rangeTo,
    template: normalizeRssDigestTemplate(o.template),
    markdown,
    mode: o.mode === 'model' ? 'model' : 'heuristic',
    entryCount,
    windowCount,
    error: typeof o.error === 'string' ? o.error : undefined,
    readAt:
      typeof o.readAt === 'number' && Number.isFinite(o.readAt) && o.readAt > 0
        ? o.readAt
        : undefined
  }
}

export function selectedRssDigest(state: RssTaskState | undefined): RssDigestRecord | undefined {
  if (!state?.digests?.length) return undefined
  const id = state.selectedDigestId
  if (id) {
    const hit = state.digests.find((d) => d.id === id)
    if (hit) return hit
  }
  return state.digests[0]
}

/** 新盘点插到队首，同步 lastDigest*，可选选中。 */
export function prependRssDigest(
  state: RssTaskState,
  record: RssDigestRecord,
  opts?: { select?: boolean }
): RssTaskState {
  const healed = healRssDigestTitle(record)
  const digests = [healed, ...(state.digests || []).filter((d) => d.id !== healed.id)].slice(
    0,
    RSS_DIGEST_MAX_RECORDS
  )
  const select = opts?.select !== false
  return {
    ...state,
    digests,
    selectedDigestId: select ? healed.id : state.selectedDigestId,
    lastDigestAt: healed.createdAt,
    lastDigestMarkdown: healed.markdown,
    lastDigestError: healed.error,
    updatedAt: Date.now()
  }
}

/**
 * 原地重写一份简报（保留 id，讨论线程不断）。
 * 列表位置提到最前。
 */
export function replaceRssDigest(
  state: RssTaskState,
  record: RssDigestRecord,
  opts?: { select?: boolean }
): RssTaskState {
  return prependRssDigest(state, record, opts)
}

/** 纠正历史简报里的空泛题名（进入简报栏时调用）。 */
export function healRssDigestTitles(state: RssTaskState): RssTaskState {
  const prev = state.digests || []
  if (!prev.length) return state
  let changed = false
  const digests = prev.map((d) => {
    const next = healRssDigestTitle(d)
    if (next !== d) changed = true
    return next
  })
  if (!changed) return state
  const head = digests[0]
  return {
    ...state,
    digests,
    lastDigestMarkdown: head?.markdown ?? state.lastDigestMarkdown,
    updatedAt: Date.now()
  }
}

/** 删除一份简报；选中项被删时回落到下一份，并同步 lastDigest*。 */
export function removeRssDigest(state: RssTaskState, digestId: string): RssTaskState {
  const id = digestId.trim()
  if (!id) return state
  const prev = state.digests || []
  const digests = prev.filter((d) => d.id !== id)
  if (digests.length === prev.length) return state
  const keepSelected =
    state.selectedDigestId &&
    state.selectedDigestId !== id &&
    digests.some((d) => d.id === state.selectedDigestId)
      ? state.selectedDigestId
      : digests[0]?.id
  const head = digests[0]
  return {
    ...state,
    digests,
    selectedDigestId: keepSelected,
    lastDigestAt: head?.createdAt,
    lastDigestMarkdown: head?.markdown,
    lastDigestError: head?.error,
    updatedAt: Date.now()
  }
}

export function newRssDigestId(at = Date.now()): string {
  return `d_${at.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeRssEntry(raw: RssTaskEntry): RssTaskEntry {
  const score = clampRssScore(raw.valueScore)
  const titleLocal =
    typeof raw.titleLocal === 'string' && raw.titleLocal.trim()
      ? raw.titleLocal.trim().slice(0, 80)
      : undefined
  const tags = normalizeRssTags(raw.tags)
  return migrateRssEntryBodies({
    ...raw,
    titleLocal,
    tags: tags.length ? tags : undefined,
    valueScore: score,
    scoreReason:
      typeof raw.scoreReason === 'string' && raw.scoreReason.trim()
        ? raw.scoreReason.trim().slice(0, 160)
        : undefined,
    scoredAt: typeof raw.scoredAt === 'number' && Number.isFinite(raw.scoredAt) ? raw.scoredAt : undefined
  })
}

/** 合并拉取结果；钉住优先，超限裁最旧未钉。保留已有价值分。 */
export function mergeRssTaskItems(
  prev: RssTaskEntry[],
  incoming: RssTaskEntry[],
  limit = RSS_TASK_MAX_ITEMS
): RssTaskEntry[] {
  const byId = new Map<string, RssTaskEntry>()
  for (const it of prev) {
    if (it?.id) byId.set(it.id, normalizeRssEntry(it))
  }
  for (const it of incoming) {
    if (!it?.id) continue
    const next = normalizeRssEntry(it)
    const old = byId.get(it.id)
    if (old) {
      const pubChanged =
        typeof next.publishedAt === 'number' &&
        typeof old.publishedAt === 'number' &&
        next.publishedAt !== old.publishedAt
      // 入站刷新只更新抓取侧；模型整理版始终保留
      const incomingExtract =
        next.extractHtml ||
        (next.contentHtml && next.contentSource !== 'model' ? next.contentHtml : undefined)
      const prevExtract =
        old.extractHtml ||
        (old.contentSource !== 'model' ? old.contentHtml : undefined)
      const mergedExtract = incomingExtract || prevExtract
      const mergedModel =
        old.modelHtml || (old.contentSource === 'model' ? old.contentHtml : undefined)
      byId.set(
        it.id,
        migrateRssEntryBodies({
          ...old,
          title: next.title || old.title,
          url: next.url || old.url,
          snippet: next.snippet || old.snippet,
          extractHtml: mergedExtract,
          modelHtml: mergedModel,
          extractPane: old.extractPane,
          contentSource: incomingExtract
            ? next.contentSource === 'feed'
              ? 'feed'
              : 'extract'
            : old.contentSource,
          modelContentFailedAt:
            typeof next.modelContentFailedAt === 'number'
              ? next.modelContentFailedAt
              : old.modelContentFailedAt,
          imageUrl: next.imageUrl || old.imageUrl,
          titleLocal: next.titleLocal || old.titleLocal,
          feedId: next.feedId || old.feedId,
          feedTitle: next.feedTitle || old.feedTitle,
          fetchedAt: Math.max(old.fetchedAt, next.fetchedAt),
          publishedAt: next.publishedAt ?? old.publishedAt,
          valueScore: next.valueScore ?? (pubChanged ? undefined : old.valueScore),
          scoreReason: next.valueScore
            ? next.scoreReason
            : pubChanged
              ? undefined
              : old.scoreReason,
          scoredAt: next.valueScore
            ? next.scoredAt ?? Date.now()
            : pubChanged
              ? undefined
              : old.scoredAt
        })
      )
    } else {
      byId.set(it.id, next)
    }
  }
  return expireStaleRssUnread(
    [...byId.values()]
      .sort((a, b) => {
        const ap = a.pinnedAt ? 1 : 0
        const bp = b.pinnedAt ? 1 : 0
        if (ap !== bp) return bp - ap
        return (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt)
      })
      .slice(0, limit)
  )
}

/** 条目时间锚点：优先发布时间。 */
export function rssEntryTime(entry: Pick<RssTaskEntry, 'publishedAt' | 'fetchedAt'>): number {
  return entry.publishedAt || entry.fetchedAt || 0
}

/** 是否仍算未读：已读或超 24h（钉住除外）都不算。 */
export function rssEntryIsUnread(entry: RssTaskEntry, now = Date.now()): boolean {
  if (entry.readAt) return false
  if (entry.pinnedAt) return true
  const t = rssEntryTime(entry)
  if (!t) return true
  return now - t < RSS_UNREAD_TTL_MS
}

/** 简报是否未读（打开过即已读；供气泡过滤）。 */
export function rssDigestIsUnread(digest: RssDigestRecord): boolean {
  return !digest.readAt
}

/** 把超龄未读写成 readAt（钉住保留未读）。 */
export function expireStaleRssUnread(items: RssTaskEntry[], now = Date.now()): RssTaskEntry[] {
  let changed = false
  const next = items.map((it) => {
    if (it.readAt || it.pinnedAt) return it
    const t = rssEntryTime(it)
    if (!t || now - t < RSS_UNREAD_TTL_MS) return it
    changed = true
    return { ...it, readAt: now }
  })
  return changed ? next : items
}

/** 状态级过期；无变化时返回原引用。 */
export function expireStaleRssUnreadState(state: RssTaskState, now = Date.now()): RssTaskState {
  const items = expireStaleRssUnread(state.items, now)
  if (items === state.items) return state
  return { ...state, items, updatedAt: now }
}

/** 应用打分结果（按 id）。 */
export function applyRssEntryScores(
  state: RssTaskState,
  scores: ReadonlyArray<{
    id: string
    valueScore: RssValueScore
    scoreReason?: string
    titleLocal?: string
    tags?: string[]
  }>,
  at = Date.now()
): RssTaskState {
  const map = new Map(scores.map((s) => [s.id, s]))
  const items = state.items.map((it) => {
    const s = map.get(it.id)
    if (!s) return it
    const titleLocal =
      typeof s.titleLocal === 'string' && s.titleLocal.trim()
        ? s.titleLocal.trim().slice(0, 80)
        : it.titleLocal
    const tags = normalizeRssTags(s.tags)
    const nextTags = tags.length ? tags : it.tags
    return {
      ...it,
      valueScore: s.valueScore,
      scoreReason: s.scoreReason?.trim().slice(0, 160) || it.scoreReason,
      scoredAt: at,
      ...(titleLocal ? { titleLocal } : {}),
      ...(nextTags?.length ? { tags: nextTags } : {})
    }
  })
  return recomputeFeedScoreStats({ ...state, items, updatedAt: at })
}

/** 补抓正文写回条目（评分/简报处置链与阅读区同源）。 */
export function applyRssBodyPatches(
  state: RssTaskState,
  patches: ReadonlyArray<RssBodyPatch>,
  at = Date.now()
): RssTaskState {
  if (!patches.length) return state
  const map = new Map(patches.map((p) => [p.id, p]))
  let changed = false
  const items = state.items.map((it) => {
    const p = map.get(it.id)
    if (!p?.extractHtml) return it
    changed = true
    const next = withRssExtractHtml(it, p.extractHtml, p.contentSource)
    return p.title?.trim() ? { ...next, title: it.title || p.title.trim() } : next
  })
  return changed ? { ...state, items, updatedAt: at } : state
}

export function setRssFeedRating(
  state: RssTaskState,
  feedId: string,
  rating: RssValueScore | undefined
): RssTaskState {
  return {
    ...state,
    updatedAt: Date.now(),
    feeds: state.feeds.map((f) => (f.id === feedId ? { ...f, rating } : f))
  }
}

/** 用条目分回写各源 avgScore / scoredCount。 */
export function recomputeFeedScoreStats(state: RssTaskState): RssTaskState {
  const buckets = new Map<string, { sum: number; n: number }>()
  for (const it of state.items) {
    if (!it.valueScore) continue
    const b = buckets.get(it.feedId) || { sum: 0, n: 0 }
    b.sum += it.valueScore
    b.n += 1
    buckets.set(it.feedId, b)
  }
  const feeds = state.feeds.map((f) => {
    const b = buckets.get(f.id)
    if (!b || b.n === 0) return { ...f, avgScore: undefined, scoredCount: undefined }
    return {
      ...f,
      avgScore: Math.round((b.sum / b.n) * 10) / 10,
      scoredCount: b.n
    }
  })
  return { ...state, feeds }
}

export function entriesNeedingScore(
  state: RssTaskState,
  limit = 40
): RssTaskEntry[] {
  return state.items.filter((x) => !x.valueScore).slice(0, limit)
}

/** 时间窗内尚未评分的条目（生成前门禁用）。 */
export function entriesNeedingScoreInBounds(
  state: RssTaskState,
  bounds: DigestTimeBounds,
  limit = 80
): RssTaskEntry[] {
  return entriesInTimeBounds(state, bounds)
    .filter((x) => x.valueScore == null)
    .slice(0, limit)
}

export function entriesInDigestWindow(
  state: RssTaskState,
  now = Date.now()
): RssTaskEntry[] {
  return entriesInTimeBounds(state, resolveDigestTimeBounds(state, now))
}

export function rssTaskUnreadCount(state: RssTaskState | undefined, now = Date.now()): number {
  if (!state?.items?.length) return 0
  return state.items.filter((x) => rssEntryIsUnread(x, now)).length
}

export function rssTaskFeedUnread(
  state: RssTaskState,
  feedId: string,
  now = Date.now()
): number {
  return state.items.filter((x) => x.feedId === feedId && rssEntryIsUnread(x, now)).length
}

export function filterRssTaskItems(state: RssTaskState, now = Date.now()): RssTaskEntry[] {
  const f = state.filter || 'all'
  let list = state.items
  if (f === 'unread') list = list.filter((x) => rssEntryIsUnread(x, now))
  else if (f === 'valuable') {
    // 重点：评分只决定进不进列表；顺序与全部/未读一致（钉住优先，再按时间新→旧）
    const min = rssScoreThreshold(state)
    list = list.filter((x) => isEntryValuable(x, min))
  } else if (f.startsWith('score:')) {
    const min = clampRssScore(f.slice(6)) || 4
    list = list.filter((x) => (x.valueScore || 0) >= min)
  } else if (f.startsWith('feed:')) {
    const id = f.slice(5)
    list = list.filter((x) => x.feedId === id)
  }
  return list
}

export function selectedRssEntry(state: RssTaskState | undefined): RssTaskEntry | undefined {
  if (!state?.selectedId || isRssDigestThreadId(state.selectedId)) return undefined
  return state.items.find((x) => x.id === state.selectedId)
}

function articlePlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function articlePlainTextLen(html: string): number {
  return articlePlainText(html).length
}

/** 讨论上下文用的正文摘录（剥标签）。 */
export function articlePlainExcerpt(html: string | undefined, maxLen = 2500): string {
  const t = articlePlainText(html || '')
  if (!t) return ''
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`
}

export type ArticleMediaHint = {
  kind: 'image' | 'video' | 'audio' | 'embed'
  url: string
  caption?: string
}

/**
 * 从正文 HTML 抽图/音/视频清单（URL + 说明）。
 * 文本 prompt 仍列 URL；直连发送时主进程再把图片拉下来内嵌。
 */
export function listArticleMediaForPrompt(
  html: string | undefined,
  max = 12
): ArticleMediaHint[] {
  if (!html || max <= 0) return []
  const out: ArticleMediaHint[] = []
  const push = (kind: ArticleMediaHint['kind'], url: string, caption?: string): void => {
    const u = url.trim()
    if (!u || /^data:/i.test(u)) return
    if (out.some((x) => x.url === u)) return
    out.push({ kind, url: u, caption: caption?.trim() || undefined })
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (out.length >= max) break
    const tag = m[0]
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    if (!src) continue
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1]
    push('image', src, alt)
  }
  for (const m of html.matchAll(/<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
    if (out.length >= max) break
    const kind = m[1].toLowerCase() === 'audio' ? 'audio' : 'video'
    const block = m[0]
    const src =
      block.match(/\bsrc=["']([^"']+)["']/i)?.[1] ||
      block.match(/<source\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]
    if (!src) continue
    push(kind, src)
  }
  for (const m of html.matchAll(/<iframe\b[^>]*class=["'][^"']*rss-embed[^"']*["'][^>]*>/gi)) {
    if (out.length >= max) break
    const src = m[0].match(/\bsrc=["']([^"']+)["']/i)?.[1]
    if (src) push('embed', src)
  }
  return out.slice(0, max)
}

function absolutizeHttpUrl(url: string, base?: string): string | undefined {
  const raw = url.trim()
  if (!raw || /^data:/i.test(raw)) return undefined
  try {
    const resolved = base ? new URL(raw, base) : new URL(raw)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined
    return resolved.href
  } catch {
    return undefined
  }
}

/** 工作台资讯条左边用的封面：enclosure 优先，否则正文第一张图。 */
export function rssEntryImageUrl(
  entry: Pick<RssTaskEntry, 'imageUrl' | 'extractHtml' | 'contentHtml' | 'modelHtml' | 'url'>
): string | undefined {
  const pinned = entry.imageUrl ? absolutizeHttpUrl(entry.imageUrl, entry.url) : undefined
  if (pinned) return pinned
  const html = entry.extractHtml || entry.contentHtml || entry.modelHtml || ''
  for (const it of listArticleMediaForPrompt(html, 8)) {
    if (it.kind !== 'image') continue
    const url = absolutizeHttpUrl(it.url, entry.url)
    if (url) return url
  }
  return undefined
}

/** 讨论直连用：封面 + 正文图，绝对 URL，最多 max 张。 */
export function rssAskRemoteImageUrls(
  state: RssTaskState | undefined,
  max = 4
): string[] {
  if (!state || state.readerMode === 'digest') return []
  const it = selectedRssEntry(state)
  if (!it) return []
  const html = rssEntrySourceHtml(it) || it.contentHtml
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw?: string): void => {
    const url = raw ? absolutizeHttpUrl(raw, it.url) : undefined
    if (!url || seen.has(url) || out.length >= max) return
    seen.add(url)
    out.push(url)
  }
  push(it.imageUrl)
  for (const m of listArticleMediaForPrompt(html, 12)) {
    if (m.kind !== 'image') continue
    push(m.url)
    if (out.length >= max) break
  }
  return out
}

/** 媒体清单 → prompt 文本块。 */
export function formatArticleMediaInventory(html: string | undefined, max = 12): string {
  const items = listArticleMediaForPrompt(html, max)
  if (!items.length) return ''
  return items
    .map((it, i) => {
      const cap = it.caption ? `「${it.caption.slice(0, 80)}」 ` : ''
      return `${i + 1}. [${it.kind}] ${cap}${it.url}`
    })
    .join('\n')
}

/**
 * 显示前把实体转义的媒体标签救回真正节点（不解码 script 等）。
 * 用于旧缓存仍含 `&lt;img…&gt;` 的条目。
 */
export function reviveEscapedMediaInHtml(html: string): string {
  if (!html || !/&lt;\s*(?:\/?(?:img|video|audio|source|iframe|figure|picture))\b/i.test(html)) {
    return html
  }
  let s = html
  for (let i = 0; i < 3; i++) {
    const next = s.replace(
      /&lt;(\/?(?:img|video|audio|source|iframe|figure|picture)\b[\s\S]*?)&gt;/gi,
      (_m, inner: string) => {
        const decoded = String(inner)
          .replace(/&amp;/gi, '&')
          .replace(/&quot;/gi, '"')
          .replace(/&#0*39;/g, "'")
          .replace(/&apos;/gi, "'")
        return `<${decoded}>`
      }
    )
    if (next === s) break
    s = next
  }
  return s
}

/**
 * 短文是否已完整收束（快讯/短评常见 100–320 字）。
 * 用于区分「页面上的完整短讯」与「RSS 半截截断到介词/逗号」。
 */
export function articleLooksComplete(html: string | undefined | null): boolean {
  const t = articlePlainText(html || '')
  if (t.length < 80) return false
  // 正常中文收尾；允许「……（中新经纬）」这类来源括注
  if (/[。！？…」』）】!.?]$/.test(t)) return true
  return false
}

/** 正文过短（摘要或只截到标题栏）→ 应重新抓页。完整短讯不算薄。 */
export function isThinArticleHtml(html: string | undefined | null): boolean {
  if (!html) return true
  const len = articlePlainTextLen(html)
  if (len >= 320) return false
  // 界面快讯等：页上全文常不足 320，但已句号收束；勿当半截摘要丢掉
  if (len >= 100 && articleLooksComplete(html)) return false
  return true
}

/** 是否含可展示的图/音/视频/白名单嵌入。 */
export function articleHasMedia(html: string | undefined | null): boolean {
  if (!html) return false
  return /<(?:img|video|audio)\b/i.test(html) || /<iframe\b[^>]*class=["'][^"']*rss-embed/i.test(html)
}

/**
 * 长文却几乎无媒体：多半是 RSS 纯文本壳，简洁模式应再抓页面补图/音视频。
 */
export function articleMissingExpectedMedia(html: string | undefined | null): boolean {
  if (!html) return true
  if (articleHasMedia(html)) return false
  return articlePlainTextLen(html) >= 400
}

/** 正文偏图/图表、文字很少时，提示改用网页阅读。 */
export function articleNeedsWebHint(html: string | undefined | null): boolean {
  if (!html) return false
  const textLen = articlePlainTextLen(html)
  const imgCount = (html.match(/<img\b/gi) || []).length
  const svgCount = (html.match(/<svg\b/gi) || []).length
  if (svgCount >= 1 && textLen < 280) return true
  if (imgCount >= 2 && textLen < 200) return true
  if (imgCount + svgCount >= 1 && textLen < 80) return true
  return false
}

const CHROME_TEXT_RE =
  /登录|注册|搜索|媒体品牌|媒体矩阵|企业服务|政府服务|网站地图|友情链接|热门推荐|相关阅读|相关新闻|分享到|下载APP|会员中心|我的订阅|客户端|关注我们|下一篇|项目推荐|我要入驻|城市合作|猜你喜欢|热门标签|文章标签|大家都在搜/

/** 正文像站点导航壳 / SPA 空壳（不可当有效简洁正文）。 */
export function articleLooksLikeChrome(html: string | undefined | null): boolean {
  if (!html) return false
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return true
  const noise = (text.match(new RegExp(CHROME_TEXT_RE.source, 'g')) || []).length
  const links = (html.match(/<a\b/gi) || []).length
  const paras = (html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).filter((p) => {
    const t = p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return t.length >= 40
  }).length
  // 典型门户顶栏：登录+搜索+栏目
  if (/登录/.test(text) && /搜索/.test(text) && paras < 3) return true
  // 短摘要 + 「下一篇」相关链瀑布（36氪等常见失败形态）
  if (/下一篇/.test(text) && links >= 5 && paras < 3) return true
  if (noise >= 2 && paras < 2) return true
  if (noise >= 3 && paras < 4) return true
  if (noise >= 2 && links >= 8 && paras < 3) return true
  if (links >= 12 && text.length < 800 && paras < 2) return true
  // 字不少但几乎全是短词导航
  if (paras === 0 && noise >= 1 && text.length < 1200) return true
  return false
}

/** 反爬验证页 / 空壳，不应当正文。 */
export function articleLooksLikeBlocked(html: string | undefined | null): boolean {
  if (!html) return false
  const head = html.slice(0, 4000)
  return /sec_sdk|captcha|人机验证|验证码|access denied|just a moment|cf-browser-verification/i.test(
    head
  )
}

export function markRssEntryRead(state: RssTaskState, id: string, at = Date.now()): RssTaskState {
  return {
    ...state,
    updatedAt: at,
    items: state.items.map((x) => (x.id === id ? { ...x, readAt: x.readAt || at } : x))
  }
}

/** 打开简报时标已读，之后不再进宠物气泡。 */
export function markRssDigestRead(state: RssTaskState, digestId: string, at = Date.now()): RssTaskState {
  const id = digestId.startsWith('digest:') ? digestId.slice('digest:'.length) : digestId
  if (!id || !state.digests?.length) return state
  let changed = false
  const digests = state.digests.map((d) => {
    if (d.id !== id || d.readAt) return d
    changed = true
    return { ...d, readAt: at }
  })
  if (!changed) return state
  return { ...state, digests, updatedAt: at }
}

export function markAllRssRead(state: RssTaskState, at = Date.now()): RssTaskState {
  return {
    ...state,
    updatedAt: at,
    items: state.items.map((x) => (x.readAt ? x : { ...x, readAt: at })),
    digests: (state.digests || []).map((d) => (d.readAt ? d : { ...d, readAt: at }))
  }
}

export function toggleRssEntryPin(state: RssTaskState, id: string, at = Date.now()): RssTaskState {
  return {
    ...state,
    updatedAt: at,
    items: state.items.map((x) => {
      if (x.id !== id) return x
      return x.pinnedAt ? { ...x, pinnedAt: undefined } : { ...x, pinnedAt: at, readAt: undefined }
    })
  }
}

export interface RssAnalysisQuote {
  id: string
  text: string
  /** 绑定的 selectedId（条目 id 或 digest:…） */
  forId: string
  at: number
}

const RSS_QUOTE_MAX_SEGMENTS = 8
const RSS_QUOTE_MAX_CHARS = 2000

export function normalizeRssAnalysisQuote(raw: unknown): RssAnalysisQuote | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Partial<RssAnalysisQuote>
  const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim().slice(0, RSS_QUOTE_MAX_CHARS) : ''
  const forId = typeof o.forId === 'string' ? o.forId.trim() : ''
  if (!text || !forId) return undefined
  const id =
    typeof o.id === 'string' && o.id.trim()
      ? o.id.trim()
      : `q-${forId}-${typeof o.at === 'number' ? o.at : Date.now()}`
  return {
    id,
    text,
    forId,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now()
  }
}

export function normalizeRssAnalysisQuotes(raw: unknown, legacy?: unknown): RssAnalysisQuote[] {
  const out: RssAnalysisQuote[] = []
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const q = normalizeRssAnalysisQuote(x)
      if (q) out.push(q)
    }
  }
  if (!out.length) {
    const one = normalizeRssAnalysisQuote(legacy)
    if (one) out.push(one)
  }
  return out.slice(0, RSS_QUOTE_MAX_SEGMENTS)
}

/** 当前选中对象上的有效划词列表（切条后旧划词自动失效）。 */
export function activeRssAnalysisQuotes(
  state: RssTaskState | undefined
): RssAnalysisQuote[] {
  const sid = state?.selectedId?.trim()
  if (!sid) return []
  const list = normalizeRssAnalysisQuotes(state?.analysisQuotes, state?.analysisQuote)
  return list.filter((q) => q.forId === sid)
}

/** @deprecated 用 activeRssAnalysisQuotes */
export function activeRssAnalysisQuote(
  state: RssTaskState | undefined
): RssAnalysisQuote | undefined {
  return activeRssAnalysisQuotes(state)[0]
}

/** 追加一段划词（同文去重；最多 8 段）。 */
export function addRssAnalysisQuote(state: RssTaskState, text: string): RssTaskState {
  const forId = state.selectedId?.trim()
  const t = text.replace(/\s+/g, ' ').trim().slice(0, RSS_QUOTE_MAX_CHARS)
  if (!forId || t.length < 8) return state
  const prev = activeRssAnalysisQuotes(state)
  if (prev.some((q) => q.text === t)) return state
  const next: RssAnalysisQuote = {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text: t,
    forId,
    at: Date.now()
  }
  const keptOthers = normalizeRssAnalysisQuotes(state.analysisQuotes, state.analysisQuote).filter(
    (q) => q.forId !== forId
  )
  const merged = [...prev, next].slice(-RSS_QUOTE_MAX_SEGMENTS)
  const { analysisQuote: _legacy, ...rest } = state
  return {
    ...rest,
    analysisQuotes: [...keptOthers, ...merged],
    updatedAt: Date.now()
  }
}

/** @deprecated 用 addRssAnalysisQuote */
export function setRssAnalysisQuote(state: RssTaskState, text: string): RssTaskState {
  return addRssAnalysisQuote(state, text)
}

export function removeRssAnalysisQuote(state: RssTaskState, quoteId: string): RssTaskState {
  const id = quoteId.trim()
  if (!id) return state
  const list = normalizeRssAnalysisQuotes(state.analysisQuotes, state.analysisQuote)
  const next = list.filter((q) => q.id !== id)
  if (next.length === list.length) return state
  const { analysisQuote: _legacy, ...rest } = state
  if (!next.length) {
    const { analysisQuotes: _drop, ...bare } = rest
    return { ...bare, updatedAt: Date.now() }
  }
  return { ...rest, analysisQuotes: next, updatedAt: Date.now() }
}

export function clearRssAnalysisQuote(state: RssTaskState): RssTaskState {
  const sid = state.selectedId?.trim()
  const list = normalizeRssAnalysisQuotes(state.analysisQuotes, state.analysisQuote)
  if (!list.length) {
    if (!state.analysisQuote && !state.analysisQuotes) return state
    const { analysisQuote: _a, analysisQuotes: _b, ...rest } = state
    return { ...rest, updatedAt: Date.now() }
  }
  // 只清当前条目的划词；其它条目的保留
  const kept = sid ? list.filter((q) => q.forId !== sid) : []
  const { analysisQuote: _legacy, ...rest } = state
  if (!kept.length) {
    const { analysisQuotes: _drop, ...bare } = rest
    return { ...bare, updatedAt: Date.now() }
  }
  return { ...rest, analysisQuotes: kept, updatedAt: Date.now() }
}

function formatRssAskQuoteBlock(state: RssTaskState | undefined): string {
  const quotes = activeRssAnalysisQuotes(state)
  if (!quotes.length) return ''
  if (quotes.length === 1) {
    return (
      `\n\n【用户划词】\n${quotes[0].text}` +
      `\n\n请优先依据划词段落回答；不要编造未给出的事实。`
    )
  }
  const body = quotes.map((q, i) => `${i + 1}. ${q.text}`).join('\n')
  return (
    `\n\n【用户划词 · ${quotes.length} 段】\n${body}` +
    `\n\n请综合以上划词段落回答；不要编造未给出的事实。`
  )
}

/** RSS 讨论区一键快捷动作（写入气泡短指令；上下文仍由 buildRssAskContext 提供）。 */
export type RssQuickActionId = 'interpret' | 'risks' | 'follow' | 'tldr'

export type RssQuickAction = {
  id: RssQuickActionId
  label: string
  /** 悬停副说明（UI 不直接展示） */
  hint: string
  /** 悬停完整说明 */
  title: string
}

/** 讨论栏提示：当前条目上下文依据（页面全文 / 订阅截断）。 */
export function rssDiscussionBasisLabel(
  entry:
    | (Pick<RssTaskEntry, 'contentHtml' | 'contentSource'> &
        Partial<Pick<RssTaskEntry, 'extractHtml' | 'modelHtml'>>)
    | undefined
): string {
  if (!entry) return '未选条目'
  const source = rssEntrySourceHtml(entry) || entry.contentHtml
  const body = articlePlainExcerpt(source, 28_000)
  if (!body) return '尚无正文'
  const fromPage =
    !!rssEntrySourceHtml(entry) ||
    entry.contentSource === 'extract' ||
    (body.length >= 100 && articleLooksComplete(source))
  return fromPage ? `依据页面正文 ${body.length} 字` : `依据订阅正文 ${body.length} 字（可能截断）`
}

export const RSS_QUICK_ACTIONS: readonly RssQuickAction[] = [
  {
    id: 'interpret',
    label: '解读',
    hint: '要点 · 风险 · 跟进',
    title: '基于页面正文做结构化解读（背景/事实/技术/风险/跟进），不是三句话导语'
  },
  {
    id: 'risks',
    label: '风险',
    hint: '争议与不确定',
    title: '只挖争议、风险与不确定处，不展开全面综述'
  },
  {
    id: 'follow',
    label: '跟进',
    hint: '值不值得跟',
    title: '判断是否值得跟进，并给一句话理由'
  },
  {
    id: 'tldr',
    label: '摘要',
    hint: '一两句说清',
    title: '极简摘要：一两句话说清核心'
  }
] as const

const RSS_QUICK_PROMPTS: Record<
  RssQuickActionId,
  { entry: string; digest: string }
> = {
  interpret: {
    entry:
      [
        '请基于上下文里的「页面正文」与媒体清单做条目解读（紧贴原文，不是导语复读）：',
        '1. 背景与动机（2–4 句）',
        '2. 关键事实与数字（型号/参数/开源范围/成本/对比等，尽量从正文摘）',
        '3. 技术要点（架构/训练/推理等正文有的才写）',
        '4. 争议、风险或未证实处',
        '5. 是否值得跟进（一句结论 + 理由）',
        '要求：正文较长时覆盖主要段落信息，不要压成三五句空话；可引用图/音/视频说明；禁止编造未给出的事实。若已标明是快讯且正文偏短，按快讯解读，不要声称「没拿到全文」。'
      ].join('\n'),
    digest:
      '请基于本份简报做解读：概括结构、关键数字/结论，并标出最值得跟进的 2–3 点与风险。不要编造简报外事实。'
  },
  risks: {
    entry:
      '请只依据页面正文与媒体清单列出争议、风险与不确定处（条目化，尽量短）；没有则明确说「未见明显风险」。不要编造未给出的事实。',
    digest:
      '请只从本份简报中列出争议、风险与不确定处（条目化）；没有则明确说「未见明显风险」。不要编造简报外事实。'
  },
  follow: {
    entry:
      '请依据页面正文与媒体清单判断这篇是否值得跟进：先给结论（值得 / 观望 / 可略过），再用一句话说理由。不要编造未给出的事实。',
    digest:
      '请判断本份简报是否值得深挖：先给结论（值得 / 观望 / 可略过），再用一句话说理由。不要编造简报外事实。'
  },
  tldr: {
    entry:
      '请依据页面正文与媒体清单用一两句话做极简摘要，只保留核心事实与结论。不要编造未给出的事实。',
    digest: '请用一两句话概括本份简报的核心结论。不要编造简报外事实。'
  }
}

/** 讨论快捷按钮 → 用户气泡短指令。 */
export function buildRssQuickActionPrompt(
  action: RssQuickActionId,
  readerMode?: RssTaskState['readerMode']
): string {
  const pack = RSS_QUICK_PROMPTS[action] ?? RSS_QUICK_PROMPTS.interpret
  return readerMode === 'digest' ? pack.digest : pack.entry
}

/** @deprecated 使用 buildRssQuickActionPrompt('interpret', …) */
export function buildRssQuickInterpretUserPrompt(
  readerMode?: RssTaskState['readerMode']
): string {
  return buildRssQuickActionPrompt('interpret', readerMode)
}

function relatedAskExcerpt(entry: RssTaskEntry): string {
  const body = articlePlainExcerpt(rssEntrySourceHtml(entry) || entry.contentHtml, 240)
    .replace(/\s+/g, ' ')
    .trim()
  if (body.length >= 20) return body
  return (entry.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

/** 讨论时把有正文/摘要的相关新闻带上；空壳标题不占上下文。 */
export function formatRelatedAskBlock(
  state: RssTaskState | undefined,
  seed?: RssTaskEntry,
  limit = 3
): string {
  const related = relatedRssForEntry(state, seed, limit)
  const lines = related
    .map((e) => {
      const lead = relatedAskExcerpt(e)
      if (!lead) return ''
      return `- ${rssEntryDisplayTitle(e)} ${e.url}\n  ${lead}`
    })
    .filter(Boolean)
  if (!lines.length) return ''
  return `\n相关新闻（同主题对照，需要时引用，勿当成这篇的事实）：\n${lines.join('\n')}`
}

/** 发给引擎的当前条目上下文（仅 IPC，不进气泡展示）。 */
export function buildRssAskContext(state: RssTaskState | undefined): string {
  const quote = formatRssAskQuoteBlock(state)
  if (state?.readerMode === 'digest') {
    const dig = selectedRssDigest(state)
    const md = (dig?.markdown || state.lastDigestMarkdown || '').trim()
    if (md) {
      const rangeLabel = dig
        ? formatDigestRangeLabel(dig)
        : formatDigestRangeLabel(state)
      const when = dig?.createdAt ? `\n生成于：${formatDigestDateTime(dig.createdAt)}` : ''
      return (
        `【RSS 热点盘点】\n时间窗：${rangeLabel}${when}\n\n` +
        md.slice(0, 6000) +
        quote +
        `\n\n请基于以上盘点回答用户问题（不要编造未给出的事实）。`
      )
    }
  }
  const it = selectedRssEntry(state)
  if (!it) {
    if (!quote) return ''
    const qs = activeRssAnalysisQuotes(state)
    if (qs.length === 1) {
      return `【用户划词】\n${qs[0].text}\n\n请优先依据划词段落回答。`
    }
    return (
      `【用户划词 · ${qs.length} 段】\n` +
      qs.map((q, i) => `${i + 1}. ${q.text}`).join('\n') +
      `\n\n请综合以上划词段落回答。`
    )
  }
  // 讨论默认吃抓取原文；整理版仅作展示，避免模型改写污染依据
  const sourceHtml = rssEntrySourceHtml(it) || it.contentHtml
  const body = articlePlainExcerpt(sourceHtml, 28_000)
  const fromPage =
    !!rssEntrySourceHtml(it) ||
    it.contentSource === 'extract' ||
    (body.length >= 100 && articleLooksComplete(sourceHtml))
  const snip = it.snippet?.trim() ? it.snippet.trim().slice(0, 280) : ''
  // 已抓到页面正文时不再把 RSS 摘要并列塞进上下文，避免模型误以为「只有摘要」
  const snipBlock =
    !fromPage && snip ? `\n订阅摘要（非页面全文）：${snip}` : ''
  const bodyMeta = body
    ? fromPage
      ? `\n页面正文（来自链接网页，约 ${body.length} 字；若偏短说明源站本身是快讯/短讯，不是抓取失败）：\n${body}`
      : `\n订阅正文（约 ${body.length} 字；尚未确认等同页面全文，可能被源站截断）：\n${body}`
    : '\n页面正文：（尚未抓到——请明确告知用户缺少原文，禁止编造事实、数字或引言）'
  const media = formatArticleMediaInventory(sourceHtml || it.modelHtml, 20)
  const mediaBlock = media ? `\n媒体清单（图/音/视频，可引用说明）：\n${media}` : ''
  const score =
    it.valueScore != null
      ? `\n阅读价值：${it.valueScore}/5 ${rssScoreLabel(it.valueScore)}${it.scoreReason ? `（${it.scoreReason}）` : ''}`
      : ''
  const tags = rssEntryTagList(it)
  const tagBit = tags.length ? `\n标签：${tags.join('、')}` : ''
  const relatedBlock = formatRelatedAskBlock(state, it)
  return (
    `【RSS 条目】\n标题：${it.title}\n来源：${rssEntrySourceLabel(state, it)}\n链接：${it.url}` +
    score +
    tagBit +
    snipBlock +
    bodyMeta +
    mediaBlock +
    relatedBlock +
    quote +
    `\n\n硬性要求：只依据上方页面/订阅正文与媒体清单作答；回答须覆盖正文里的关键事实与数字，不要只复述标题导语；不要把「源站快讯偏短」说成「没抓到全文」。正文缺失时不要补故事。相关新闻只作对照。`
  )
}

/** 同任务里按细标签推荐相关条目。 */
export function relatedRssForEntry(
  state: RssTaskState | undefined,
  seed?: RssTaskEntry,
  limit = 4
): RssTaskEntry[] {
  const it = seed || selectedRssEntry(state)
  if (!state || !it) return []
  return pickRelatedRssEntries(state.items || [], it, limit)
}

export type HeuristicScoreOpts = {
  /** 用户兴趣词（设置里的历史关键词），命中抬到「值得看」档。 */
  interestKeywords?: readonly string[]
  /** 屏蔽词，命中压到「噪音」。 */
  muteKeywords?: readonly string[]
}

function matchKeyword(text: string, keywords: readonly string[] | undefined): string | undefined {
  if (!keywords?.length) return undefined
  for (const raw of keywords) {
    const k = raw.trim().toLowerCase()
    if (k.length >= 2 && text.includes(k)) return raw.trim()
  }
  return undefined
}

/**
 * 规则/关键词打分（未配评分模型或模型不可用时）。
 * 标尺：5 必读 · 4 值得看 · 3 一般 · 2 可略 · 1 噪音。
 * 优先：屏蔽词 → 兴趣词 → 内置信号词。
 */
export function heuristicScoreEntry(
  entry: RssTaskEntry,
  opts?: HeuristicScoreOpts
): {
  valueScore: RssValueScore
  scoreReason: string
  tags: string[]
} {
  const title = (entry.title || '').toLowerCase()
  const snip = (entry.snippet || '').toLowerCase()
  const text = `${title} ${snip}`
  let score = 3
  const reasons: string[] = []

  const tags = heuristicRssTags(entry, opts?.interestKeywords)

  const muted = matchKeyword(text, opts?.muteKeywords)
  if (muted) {
    return {
      valueScore: 1,
      scoreReason: `规则：噪音 · 命中屏蔽「${muted.slice(0, 24)}」`.slice(0, 160),
      tags
    }
  }

  const interested = matchKeyword(text, opts?.interestKeywords)
  if (interested) {
    score = 4
    reasons.push(`兴趣「${interested.slice(0, 24)}」`)
  }

  if (/广告|优惠券|促销|打折|招聘|求职|sponsored|newsletter sponsor|subscribe now|限时/.test(text)) {
    score = Math.min(score, 1)
    reasons.push('营销/招聘噪音')
  } else if (
    /breaking|重大|突发|漏洞|cve|0-day|勒索|融资[轮]|series [abc]|acquired|发布会/.test(text)
  ) {
    score = Math.max(score, 5)
    reasons.push('突发或硬新闻信号')
  } else if (
    !interested &&
    /\b(gpt|llm|openai|claude|gemini|deepseek|launch|release)\b|发布|开源|论文|benchmark|融资/.test(
      text
    )
  ) {
    score = Math.max(score, 4)
    reasons.push('行业/产品动态')
  } else if (!interested && /周报|weekly|digest|newsletter|圆桌|播客|podcast/.test(text)) {
    score = Math.min(score, 2)
    reasons.push('汇编/通讯类')
  }

  if (score >= 3 && !entry.snippet && !interested) {
    score = Math.max(2, score - 1)
    reasons.push('缺摘要，降一档')
  }

  const clamped = clampRssScore(score) || 3
  return {
    valueScore: clamped,
    scoreReason: `规则：${rssScoreLabel(clamped)} · ${reasons.join('；') || '默认一般'}`.slice(0, 160),
    tags
  }
}

/** 气泡里去掉已写入存档的 RSS 全量上下文，只留用户原话。 */
export function stripRssAskPreamble(text: string): string {
  if (!text.includes('【RSS 条目】')) return text
  const marker = '【用户】\n'
  const i = text.indexOf(marker)
  if (i >= 0) return text.slice(i + marker.length)
  // 旧格式：整段都是上下文时给短提示
  const title = text.match(/标题：([^\n]+)/)?.[1]?.trim()
  return title ? `（关于：${title.slice(0, 48)}）` : '（RSS 条目）'
}

export function relativeTime(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000))
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} 天前`
  try {
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  } catch {
    return ''
  }
}

/** 本地日历日键：YYYY-MM-DD。 */
export function rssDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 列表分组标题：今天 / 昨天 / M月D日 / YYYY年M月D日。 */
export function formatRssDayLabel(dayKey: string, now = Date.now()): string {
  const today = rssDayKey(now)
  const yest = new Date(now)
  yest.setHours(12, 0, 0, 0)
  yest.setDate(yest.getDate() - 1)
  const yesterday = rssDayKey(yest.getTime())
  if (dayKey === today) return '今天'
  if (dayKey === yesterday) return '昨天'
  const parts = dayKey.split('-').map((x) => Number(x))
  const Y = parts[0]
  const M = parts[1]
  const D = parts[2]
  if (!Y || !M || !D) return dayKey
  if (Y === new Date(now).getFullYear()) return `${M}月${D}日`
  return `${Y}年${M}月${D}日`
}

export type RssDayGroup = {
  dayKey: string
  label: string
  entries: RssTaskEntry[]
}

/** 按发布/抓取日分组；日期新→旧，组内保持传入顺序。 */
export function groupRssEntriesByDay(
  entries: RssTaskEntry[],
  now = Date.now()
): RssDayGroup[] {
  const map = new Map<string, RssTaskEntry[]>()
  for (const e of entries) {
    const t = rssEntryTime(e) || now
    const key = rssDayKey(t)
    const bucket = map.get(key)
    if (bucket) bucket.push(e)
    else map.set(key, [e])
  }
  return [...map.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((dayKey) => ({
      dayKey,
      label: formatRssDayLabel(dayKey, now),
      entries: map.get(dayKey) || []
    }))
}

export function normalizeRssDisposition(raw: unknown): RssDispositionState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Partial<RssDispositionState>
  const stage = o.stage
  const ok =
    stage === 'idle' ||
    stage === 'fetching' ||
    stage === 'scoring' ||
    stage === 'picking' ||
    stage === 'digesting' ||
    stage === 'done' ||
    stage === 'skeleton'
  if (!ok) return undefined
  return {
    stage,
    detail: typeof o.detail === 'string' ? o.detail.slice(0, 200) : undefined,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now()
  }
}

export function normalizeRssTaskState(raw: unknown): RssTaskState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Partial<RssTaskState>
  const feeds = normalizeRssTaskFeeds(o.feeds)
  const items = Array.isArray(o.items)
    ? o.items.filter((x): x is RssTaskEntry => !!x && typeof x === 'object' && typeof x.id === 'string')
    : []
  const filter = isRssTaskFilter(o.filter) ? o.filter : 'all'
  const readerMode =
    o.readerMode === 'web' || o.readerMode === 'digest' ? o.readerMode : 'extract'
  const digestWindowHours = RSS_DIGEST_WINDOWS.includes(o.digestWindowHours as RssDigestWindowHours)
    ? (o.digestWindowHours as RssDigestWindowHours)
    : 24
  const digestRangeFrom = isDigestYmd(o.digestRangeFrom) ? o.digestRangeFrom.trim() : undefined
  const digestRangeTo = isDigestYmd(o.digestRangeTo) ? o.digestRangeTo.trim() : undefined
  const digestIntervalHours = normalizeRssDigestIntervalHours(o.digestIntervalHours)
  const digestHours =
    digestIntervalHours != null
      ? undefined
      : normalizeRssDigestHours(o.digestHours, o.digestHour)
  const digestTemplate = normalizeRssDigestTemplate(o.digestTemplate)
  const lastDigestAt = typeof o.lastDigestAt === 'number' ? o.lastDigestAt : undefined
  const lastDigestMarkdown =
    typeof o.lastDigestMarkdown === 'string' ? o.lastDigestMarkdown.slice(0, 48_000) : undefined
  const lastDigestError = typeof o.lastDigestError === 'string' ? o.lastDigestError : undefined
  let digests = Array.isArray(o.digests)
    ? o.digests
        .map((x) => normalizeRssDigestRecord(x))
        .filter((x): x is RssDigestRecord => !!x)
        .slice(0, RSS_DIGEST_MAX_RECORDS)
    : []
  // 旧版仅有 lastDigest* → 迁成一条历史
  if (!digests.length && lastDigestMarkdown?.trim()) {
    const at = lastDigestAt || Date.now()
    digests = [
      {
        id: newRssDigestId(at),
        title: buildRssDigestTitle({
          markdown: lastDigestMarkdown,
          windowHours: digestWindowHours,
          createdAt: at
        }),
        createdAt: at,
        windowHours: digestWindowHours,
        template: digestTemplate,
        markdown: lastDigestMarkdown,
        mode: 'heuristic',
        entryCount: 0,
        error: lastDigestError
      }
    ]
  }
  const selectedDigestId =
    typeof o.selectedDigestId === 'string' && digests.some((d) => d.id === o.selectedDigestId)
      ? o.selectedDigestId
      : digests[0]?.id
  const scoreMinForValuable =
    o.scoreMinForValuable === 3 || o.scoreMinForValuable === 5 ? o.scoreMinForValuable : 4
  const scoring =
    o.scoring && typeof o.scoring === 'object'
      ? {
          status:
            o.scoring.status === 'running' || o.scoring.status === 'error'
              ? o.scoring.status
              : ('idle' as const),
          error: typeof o.scoring.error === 'string' ? o.scoring.error : undefined,
          updatedAt: typeof o.scoring.updatedAt === 'number' ? o.scoring.updatedAt : undefined
        }
      : undefined
  const base: RssTaskState = {
    feeds,
    items: mergeRssTaskItems([], items),
    selectedId: typeof o.selectedId === 'string' ? o.selectedId : undefined,
    filter,
    readerMode,
    discussionPanel:
      o.discussionPanel === 'show' || o.discussionPanel === 'hide'
        ? o.discussionPanel
        : (o as { discussionCollapsed?: boolean }).discussionCollapsed === true
          ? 'hide'
          : 'auto',
    scoreEnabled: o.scoreEnabled !== false,
    scoreModelRef: typeof o.scoreModelRef === 'string' ? o.scoreModelRef.trim() : undefined,
    scoreMode: o.scoreMode ? normalizeRssScoreMode(o.scoreMode) : undefined,
    scoreIntervalMinutes:
      typeof o.scoreIntervalMinutes === 'number'
        ? normalizeRssScoreIntervalMinutes(o.scoreIntervalMinutes)
        : undefined,
    scoreMinForValuable,
    digestWindowHours,
    digestRangeFrom,
    digestRangeTo,
    digestHours,
    digestIntervalHours,
    digestTemplate,
    digests,
    selectedDigestId,
    lastDigestAt,
    lastDigestMarkdown: digests[0]?.markdown || lastDigestMarkdown,
    lastDigestError: digests[0]?.error || lastDigestError,
    digestGenerating: o.digestGenerating === true,
    disposition: normalizeRssDisposition(o.disposition),
    scoring,
    analysisQuotes: normalizeRssAnalysisQuotes(o.analysisQuotes, o.analysisQuote),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    lastError: typeof o.lastError === 'string' ? o.lastError : undefined
  }
  // 归一化后不再保留废弃单段字段
  delete (base as { analysisQuote?: unknown }).analysisQuote
  return recomputeFeedScoreStats(base)
}

/** 是否该在右侧打开讨论栏（该条已有独立消息）。 */
export function rssEntryHasDiscussion(
  threads: Record<string, unknown[]> | undefined,
  entryId: string | undefined
): boolean {
  if (!entryId || !threads) return false
  const t = threads[entryId]
  return Array.isArray(t) && t.length > 0
}
