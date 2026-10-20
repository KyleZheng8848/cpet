/** 定时任务摘要：列表排序与正文截取。 */

import type { ScheduledTask } from './types'

/** 连续失败达到此次数后自动暂停任务，避免静默烧额度。 */
export const SCHEDULE_AUTO_DISABLE_FAILURES = 3

/** 从流式/结果文本抽出短摘要（通知用）。 */
export function makeScheduleDigest(text: string, maxLen = 180): string {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, maxLen - 1)}…`
}

/** 失败优先，其次最近跑过的在前。 */
export function sortSchedulesForHandoff(tasks: ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((a, b) => {
    const af = a.lastRunOk === false ? 0 : 1
    const bf = b.lastRunOk === false ? 0 : 1
    if (af !== bf) return af - bf
    return (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0)
  })
}
