/**
 * 定时任务的时间计算。
 *
 * 单独成文件而不是留在 scheduler.ts 里：scheduler.ts 依赖 electron 的 Notification，
 * 而这些算式必须能在纯 node 下用固定时间戳做契约测试（算错就是「没按时跑」或「重复跑」）。
 */

import type { ScheduleKind, ScheduledTask } from '../shared/types'

/** 超过 2^31-1 的延迟会被 Node 当成 1ms 立即触发，远期任务因此必须分段等待。 */
export const MAX_TIMER_DELAY = 2_147_483_647

/** 定时器可能比计划时间早零点几毫秒醒来；这个容差内视为已到点，避免无意义地反复续等。 */
const EARLY_TOLERANCE = 1_000

/** 计算下次执行时间；返回 null 表示不再调度（如已过期的一次性任务）。 */
export function computeNextRun(task: ScheduledTask, after = Date.now()): number | null {
  if (!task.enabled) return null
  switch (task.kind) {
    case 'interval': {
      // 从 after（当前时间）推进而不是从上次计划时间累加：错过多次也只会往后排一次，
      // 不会在开机瞬间连补十几轮。
      const raw = task.intervalMinutes
      const mins = Math.max(1, Number.isFinite(raw) ? (raw as number) : 60)
      return after + mins * 60_000
    }
    case 'daily': {
      const h = task.hour ?? 9
      const m = task.minute ?? 0
      const next = new Date(after)
      next.setHours(h, m, 0, 0)
      // 必须用 setDate 推进而不是 +86400000：夏令时切换日的当地一天是 23 或 25 小时，
      // 毫秒加法会把「每天 9 点」挪成 8 点或 10 点。
      if (next.getTime() <= after) next.setDate(next.getDate() + 1)
      return next.getTime()
    }
    case 'once': {
      const at = task.runAt ?? 0
      return at > after ? at : null
    }
    default:
      return null
  }
}

/** setTimeout 能安全接受的延迟。 */
export function clampTimerDelay(delay: number): number {
  if (!Number.isFinite(delay) || delay <= 0) return 0
  return Math.min(delay, MAX_TIMER_DELAY)
}

export type TimerPlan = { fire: true } | { fire: false; delay: number }

/**
 * 定时器醒来时该真执行还是继续等。
 * 延迟被 MAX_TIMER_DELAY 截断过的远期任务会在第 24.8 天醒来，此时必须按墙上时钟续等。
 */
export function planTimerFire(nextRunAt: number | undefined, now: number): TimerPlan {
  if (nextRunAt == null || !Number.isFinite(nextRunAt)) return { fire: true }
  const remain = nextRunAt - now
  if (remain <= EARLY_TOLERANCE) return { fire: true }
  return { fire: false, delay: clampTimerDelay(remain) }
}

/**
 * 墙钟心跳间隔。
 *
 * 取值权衡：唤醒后最坏迟到一个间隔，所以不能太疏；而一次核查只是对内存里的任务表做一遍过滤，
 * 再密下去只是白白唤醒主进程、妨碍 macOS App Nap，换不来可感知的准点度。30s 是两边的折中。
 */
export const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * 墙钟判定：这个任务此刻是否已过 nextRunAt。
 *
 * setTimeout 走的是单调时钟，机器休眠期间不计时：合盖 9 小时后，为「10 小时后」挂的定时器
 * 醒来时仍剩 10 小时。所以「该不该跑」必须另有一条只看 Date.now() 的判定，不能只信定时器。
 */
export function isWallClockDue(
  task: Pick<ScheduledTask, 'enabled' | 'nextRunAt'>,
  now: number
): boolean {
  if (!task.enabled) return false
  const next = task.nextRunAt
  if (next == null || !Number.isFinite(next)) return false
  return next <= now
}

/**
 * 挑出按墙钟已经该跑的任务 id。
 * 只负责「提名候选」；真正要不要执行仍由 planTimerFire 在读取最新任务后裁决，避免多路径重复执行。
 */
export function selectDueTaskIds(
  tasks: readonly Pick<ScheduledTask, 'id' | 'enabled' | 'nextRunAt'>[],
  now: number
): string[] {
  const due: string[] = []
  for (const task of tasks) {
    if (isWallClockDue(task, now)) due.push(task.id)
  }
  return due
}

/**
 * 保存/启用后是否还该维持 enabled。
 * once 的时间已过时算不出下次运行，留着 enabled 会变成「界面显示已启用但永远不跑」。
 */
export function shouldStayEnabled(
  kind: ScheduleKind,
  enabled: boolean,
  next: number | null
): boolean {
  if (!enabled) return false
  return !(kind === 'once' && next == null)
}
