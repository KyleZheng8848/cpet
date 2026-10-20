import { t as uiText } from './i18n'
/** RSS 自动日程：关 / 每天若干整点 / 每隔 N 小时（无 0–23 枚举墙）。 */

import {
  normalizeBriefDailyDigestHour,
  normalizeBriefDailyDigestHours
} from './briefInbox'
import { normalizeRssDigestIntervalHours } from './rssTask'

export type RssScheduleMode = 'off' | 'daily' | 'interval'

export type RssScheduleValue = {
  mode: RssScheduleMode
  /** 每天整点，最多 3 个（0–23）。 */
  hours?: number[]
  /** 每隔小时，1–168。 */
  intervalHours?: number
}

export const RSS_SCHEDULE_DAILY_MAX = 3

export function normalizeRssScheduleHours(raw: unknown): number[] | undefined {
  const hours = normalizeBriefDailyDigestHours(raw)
  if (!hours?.length) return undefined
  return hours.slice(0, RSS_SCHEDULE_DAILY_MAX)
}

export function resolveRssScheduleValue(input: {
  hours?: unknown
  legacyHour?: unknown
  intervalHours?: unknown
}): RssScheduleValue {
  const interval = normalizeRssDigestIntervalHours(input.intervalHours)
  if (interval != null) {
    return { mode: 'interval', intervalHours: interval }
  }
  const hours = normalizeRssScheduleHours(
    input.hours !== undefined
      ? input.hours
      : normalizeBriefDailyDigestHours(undefined, input.legacyHour)
  )
  if (hours?.length) return { mode: 'daily', hours }
  return { mode: 'off' }
}

export function formatRssScheduleLabel(v: RssScheduleValue): string {
  if (v.mode === 'interval' && v.intervalHours != null) {
    return uiText("每 {0} 小时", [v.intervalHours])
  }
  if (v.mode === 'daily' && v.hours?.length) {
    return v.hours.map((h) => `${h}:00`).join('、')
  }
  return uiText("关")
}

export function hourToTimeInput(hour: number): string {
  const h = normalizeBriefDailyDigestHour(hour) ?? 9
  return `${String(h).padStart(2, '0')}:00`
}

export function timeInputToHour(raw: string): number | null {
  const m = /^(\d{1,2}):/.exec((raw || '').trim())
  if (!m) return null
  return normalizeBriefDailyDigestHour(Number(m[1]))
}

/** 在每日时刻列表里替换某一项；非法则原样返回。 */
export function replaceRssScheduleHour(
  hours: number[] | undefined,
  index: number,
  nextHour: number
): number[] {
  const cur = [...(normalizeRssScheduleHours(hours) || [])]
  const h = normalizeBriefDailyDigestHour(nextHour)
  if (h == null || index < 0 || index >= cur.length) return cur
  cur[index] = h
  return [...new Set(cur)].sort((a, b) => a - b).slice(0, RSS_SCHEDULE_DAILY_MAX)
}

export function addRssScheduleHour(
  hours: number[] | undefined,
  hour = 9
): number[] {
  const cur = normalizeRssScheduleHours(hours) || []
  if (cur.length >= RSS_SCHEDULE_DAILY_MAX) return cur
  const h = normalizeBriefDailyDigestHour(hour) ?? 9
  if (cur.includes(h)) {
    // 找一个空闲整点
    for (let i = 0; i < 24; i++) {
      const cand = (h + i) % 24
      if (!cur.includes(cand)) {
        return [...cur, cand].sort((a, b) => a - b)
      }
    }
    return cur
  }
  return [...cur, h].sort((a, b) => a - b)
}

export function removeRssScheduleHour(
  hours: number[] | undefined,
  index: number
): number[] | undefined {
  const cur = [...(normalizeRssScheduleHours(hours) || [])]
  if (index < 0 || index >= cur.length) return cur.length ? cur : undefined
  cur.splice(index, 1)
  return cur.length ? cur : undefined
}
