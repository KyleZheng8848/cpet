/** 定时任务归一化、RSS 简报绑定与切窗。 */

import {
  formatDigestInfoWindowBounds,
  nearestDigestWindowFromMs,
  normalizeRssDigestScoreMin,
  normalizeRssDigestTemplate,
  type DigestTimeBounds,
  type RssDigestTemplate
} from './rssTask'
import type { ScheduleJob, ScheduleKind, ScheduledTask } from './types'

export type { ScheduleJob }

export function normalizeScheduleJob(raw: unknown): ScheduleJob {
  return raw === 'rss-digest' ? 'rss-digest' : 'agent'
}

export function isRssDigestSchedule(
  task: Pick<ScheduledTask, 'job'> | undefined | null
): boolean {
  return normalizeScheduleJob(task?.job) === 'rss-digest'
}

/** 读盘/保存前归一化；rss-digest 缺绑定时抛错（由调用方在 save 前校验）。 */
export function normalizeScheduledTask(raw: unknown): ScheduledTask | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<ScheduledTask>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  const kind: ScheduleKind =
    o.kind === 'daily' || o.kind === 'once' || o.kind === 'interval' ? o.kind : 'interval'
  const job = normalizeScheduleJob(o.job)
  const now = Date.now()
  const rssConversationId =
    typeof o.rssConversationId === 'string' && o.rssConversationId.trim()
      ? o.rssConversationId.trim()
      : undefined
  const conversationId =
    typeof o.conversationId === 'string' && o.conversationId.trim()
      ? o.conversationId.trim()
      : job === 'rss-digest'
        ? rssConversationId
        : undefined
  const digestTemplate =
    job === 'rss-digest'
      ? normalizeRssDigestTemplate(o.digestTemplate)
      : undefined
  const digestScoreMinRaw =
    job === 'rss-digest' ? normalizeRssDigestScoreMin(o.digestScoreMin) : 0
  const digestScoreMin: 3 | 4 | 5 | undefined =
    digestScoreMinRaw === 3 || digestScoreMinRaw === 4 || digestScoreMinRaw === 5
      ? digestScoreMinRaw
      : undefined
  return {
    id: o.id.trim(),
    name: typeof o.name === 'string' ? o.name : '',
    prompt: typeof o.prompt === 'string' ? o.prompt : '',
    cwd: typeof o.cwd === 'string' && o.cwd.trim() ? o.cwd : undefined,
    modelRef: typeof o.modelRef === 'string' && o.modelRef.trim() ? o.modelRef.trim() : undefined,
    skills: Array.isArray(o.skills)
      ? o.skills.filter((s): s is string => typeof s === 'string' && !!s.trim())
      : undefined,
    kind,
    intervalMinutes:
      typeof o.intervalMinutes === 'number' && Number.isFinite(o.intervalMinutes)
        ? Math.max(1, Math.round(o.intervalMinutes))
        : kind === 'interval'
          ? 60
          : undefined,
    hour:
      typeof o.hour === 'number' && Number.isFinite(o.hour)
        ? Math.min(23, Math.max(0, Math.round(o.hour)))
        : kind === 'daily'
          ? 9
          : undefined,
    minute:
      typeof o.minute === 'number' && Number.isFinite(o.minute)
        ? Math.min(59, Math.max(0, Math.round(o.minute)))
        : kind === 'daily'
          ? 0
          : undefined,
    runAt:
      typeof o.runAt === 'number' && Number.isFinite(o.runAt) ? o.runAt : undefined,
    enabled: !!o.enabled,
    conversationId,
    job,
    rssConversationId: job === 'rss-digest' ? rssConversationId || conversationId : undefined,
    sourceLabel:
      typeof o.sourceLabel === 'string' && o.sourceLabel.trim()
        ? o.sourceLabel.trim().slice(0, 80)
        : undefined,
    digestTemplate,
    digestScoreMin,
    lastRunAt: typeof o.lastRunAt === 'number' ? o.lastRunAt : undefined,
    lastRunOk: typeof o.lastRunOk === 'boolean' ? o.lastRunOk : undefined,
    lastRunSummary: typeof o.lastRunSummary === 'string' ? o.lastRunSummary : undefined,
    consecutiveFailures:
      typeof o.consecutiveFailures === 'number' ? o.consecutiveFailures : undefined,
    nextRunAt: typeof o.nextRunAt === 'number' ? o.nextRunAt : undefined,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now
  }
}

export function validateScheduledTask(task: ScheduledTask): string | null {
  if (!task.name.trim()) return '请填写任务名称'
  if (isRssDigestSchedule(task)) {
    if (!task.rssConversationId?.trim()) return '请选择来源 RSS 任务'
    return null
  }
  if (!task.prompt.trim()) return '请填写要执行的提示词'
  return null
}

/** 列表上来源文案。 */
export function scheduleSourceLabel(task: ScheduledTask): string | null {
  if (!isRssDigestSchedule(task)) return null
  const label = (task.sourceLabel || '').trim()
  return label ? `RSS · ${label}` : 'RSS 简报'
}

/**
 * 定时简报收录窗：interval → 近 intervalMinutes；daily/once → 近 24 小时。
 */
export function resolveScheduleRssDigestBounds(
  task: Pick<ScheduledTask, 'kind' | 'intervalMinutes'>,
  now = Date.now()
): DigestTimeBounds {
  if (task.kind === 'interval') {
    const mins = Math.max(1, Math.round(task.intervalMinutes || 60))
    const fromAt = now - mins * 60_000
    const windowHours = nearestDigestWindowFromMs(mins * 60_000)
    const label = mins < 60 ? `近 ${mins} 分钟` : `近 ${Math.round(mins / 60)} 小时`
    return {
      fromAt,
      toAt: now,
      windowHours,
      label,
      infoWindow: formatDigestInfoWindowBounds(fromAt, now)
    }
  }
  const fromAt = now - 24 * 3600_000
  return {
    fromAt,
    toAt: now,
    windowHours: 24,
    label: '近 24 小时',
    infoWindow: formatDigestInfoWindowBounds(fromAt, now)
  }
}

export function filterSchedulesForConversation(
  tasks: ScheduledTask[],
  conversationId: string
): ScheduledTask[] {
  const id = conversationId.trim()
  if (!id) return []
  return tasks.filter(
    (t) =>
      t.rssConversationId === id ||
      (isRssDigestSchedule(t) && t.conversationId === id)
  )
}

export function excludeSchedulesForConversation(
  tasks: ScheduledTask[],
  conversationId: string
): ScheduledTask[] {
  const id = conversationId.trim()
  if (!id) return tasks
  return tasks.filter(
    (t) =>
      t.rssConversationId !== id &&
      !(isRssDigestSchedule(t) && t.conversationId === id)
  )
}

/** 从旧 RSS digestHours / digestIntervalHours 迁成全局定时任务草稿。 */
export function migrateLegacyRssDigestSchedules(opts: {
  conversationId: string
  sourceLabel: string
  digestTemplate?: RssDigestTemplate
  modelRef?: string
  digestHours?: number[]
  digestIntervalHours?: number
}): ScheduledTask[] {
  const now = Date.now()
  const base = {
    prompt: '',
    job: 'rss-digest' as const,
    rssConversationId: opts.conversationId,
    conversationId: opts.conversationId,
    sourceLabel: opts.sourceLabel.slice(0, 80),
    digestTemplate: normalizeRssDigestTemplate(opts.digestTemplate),
    modelRef: opts.modelRef?.trim() || undefined,
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
  const out: ScheduledTask[] = []
  if (opts.digestIntervalHours != null && opts.digestIntervalHours > 0) {
    const hours = Math.max(1, Math.round(opts.digestIntervalHours))
    out.push({
      ...base,
      id: `s-rss-mig-iv-${opts.conversationId}-${hours}`,
      name: `${opts.sourceLabel || 'RSS'} · 每 ${hours} 小时简报`,
      kind: 'interval',
      intervalMinutes: hours * 60
    })
    return out
  }
  const hours = (opts.digestHours || []).filter(
    (h) => typeof h === 'number' && h >= 0 && h <= 23
  )
  for (const h of hours) {
    out.push({
      ...base,
      id: `s-rss-mig-d-${opts.conversationId}-${h}`,
      name: `${opts.sourceLabel || 'RSS'} · 每天 ${h}:00 简报`,
      kind: 'daily',
      hour: h,
      minute: 0
    })
  }
  return out
}
