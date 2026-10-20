/**
 * 定时任务的时间算式。
 *
 * 这里每条都对应一种用户直接看得见的故障：算错日期 → 任务没按时跑；
 * 从计划时间累加 → 开机瞬间补跑十几轮；延迟超 2^31-1 → 远期任务立刻执行。
 * 全部用固定时间戳，不依赖真实 Date.now()。
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_TIMER_DELAY,
  clampTimerDelay,
  computeNextRun,
  isWallClockDue,
  planTimerFire,
  selectDueTaskIds,
  shouldStayEnabled
} from '../src/main/scheduleTime'
import type { ScheduledTask } from '../src/shared/types'

// 用有夏令时的时区，才能验证「每天 9 点」在切换日不偏移
const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'America/New_York'
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

function task(patch: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 't1',
    name: '任务',
    prompt: '干活',
    kind: 'daily',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...patch
  }
}

const at = (iso: string): number => new Date(iso).getTime()

describe('computeNextRun / daily', () => {
  it('当天还没到点：排在今天', () => {
    const now = at('2026-07-28T08:00:00-04:00')
    const next = computeNextRun(task({ kind: 'daily', hour: 9, minute: 30 }), now)
    expect(next).toBe(at('2026-07-28T09:30:00-04:00'))
  })

  it('已经过点：排到明天同一时刻', () => {
    const now = at('2026-07-28T10:00:00-04:00')
    const next = computeNextRun(task({ kind: 'daily', hour: 9, minute: 0 }), now)
    expect(next).toBe(at('2026-07-29T09:00:00-04:00'))
  })

  it('恰好等于目标时刻：排到明天，不会在同一秒里再触发一次', () => {
    const now = at('2026-07-28T09:00:00-04:00')
    const next = computeNextRun(task({ kind: 'daily', hour: 9, minute: 0 }), now)
    expect(next).toBe(at('2026-07-29T09:00:00-04:00'))
  })

  it('跨夏令时开始日：仍是当地 9 点（毫秒加法会变成 10 点）', () => {
    // 2026-03-08 美东 02:00 跳到 03:00，这一天只有 23 小时
    const now = at('2026-03-07T09:30:00-05:00')
    const next = computeNextRun(task({ kind: 'daily', hour: 9, minute: 0 }), now)!
    const d = new Date(next)
    expect(d.getHours()).toBe(9)
    expect(d.getDate()).toBe(8)
    // 真实间隔是 23 小时；若实现用 +86400000 这里会是 24 小时
    expect(next - at('2026-03-07T09:00:00-05:00')).toBe(23 * 3_600_000)
  })

  it('跨夏令时结束日：仍是当地 9 点（这一天有 25 小时）', () => {
    const now = at('2026-10-31T09:30:00-04:00')
    const next = computeNextRun(task({ kind: 'daily', hour: 9, minute: 0 }), now)!
    expect(new Date(next).getHours()).toBe(9)
    expect(next - at('2026-10-31T09:00:00-04:00')).toBe(25 * 3_600_000)
  })
})

describe('computeNextRun / interval', () => {
  it('从当前时间推进，而不是从上次计划时间累加', () => {
    const now = at('2026-07-28T12:00:00-04:00')
    const t = task({ kind: 'interval', intervalMinutes: 30 })
    // 错过 3 天再算，结果依旧只往后排一次，不会积压出一堆补跑
    expect(computeNextRun(t, now)).toBe(now + 30 * 60_000)
  })

  it('间隔缺失或写坏（NaN）时退回 60 分钟，而不是算出 NaN 让任务永久静默', () => {
    const now = at('2026-07-28T12:00:00-04:00')
    expect(computeNextRun(task({ kind: 'interval' }), now)).toBe(now + 60 * 60_000)
    expect(computeNextRun(task({ kind: 'interval', intervalMinutes: NaN }), now)).toBe(
      now + 60 * 60_000
    )
  })

  it('间隔小于 1 分钟按 1 分钟处理，避免忙轮询', () => {
    const now = at('2026-07-28T12:00:00-04:00')
    expect(computeNextRun(task({ kind: 'interval', intervalMinutes: 0 }), now)).toBe(now + 60_000)
  })
})

describe('computeNextRun / once 与停用', () => {
  it('时间未到：就是那个时刻', () => {
    const now = at('2026-07-28T12:00:00-04:00')
    const runAt = now + 5_000
    expect(computeNextRun(task({ kind: 'once', runAt }), now)).toBe(runAt)
  })

  it('时间已过：返回 null，不再补跑', () => {
    const now = at('2026-07-28T12:00:00-04:00')
    expect(computeNextRun(task({ kind: 'once', runAt: now - 1 }), now)).toBeNull()
  })

  it('任务已停用：任何类型都不排期', () => {
    const now = at('2026-07-28T12:00:00-04:00')
    expect(computeNextRun(task({ kind: 'daily', enabled: false }), now)).toBeNull()
    expect(computeNextRun(task({ kind: 'interval', enabled: false }), now)).toBeNull()
  })
})

describe('planTimerFire', () => {
  const now = at('2026-07-28T12:00:00-04:00')

  it('远期任务（超过 24.8 天）在定时器上限醒来时续等，不提前执行', () => {
    const runAt = now + 30 * 86_400_000
    const plan = planTimerFire(runAt, now + MAX_TIMER_DELAY)
    expect(plan).toEqual({ fire: false, delay: 30 * 86_400_000 - MAX_TIMER_DELAY })
  })

  it('续等的延迟本身也被截断到 setTimeout 上限', () => {
    const plan = planTimerFire(now + 200 * 86_400_000, now)
    expect(plan).toEqual({ fire: false, delay: MAX_TIMER_DELAY })
  })

  it('计划时间已过（休眠/关机错过）：立即执行一次', () => {
    expect(planTimerFire(now - 3 * 86_400_000, now)).toEqual({ fire: true })
  })

  it('提前不到 1 秒醒来算作到点，不反复续等', () => {
    expect(planTimerFire(now + 400, now)).toEqual({ fire: true })
  })

  it('旧数据没有 nextRunAt 时照旧执行', () => {
    expect(planTimerFire(undefined, now)).toEqual({ fire: true })
  })
})

describe('clampTimerDelay', () => {
  it('负数与非法值归零，超上限截断', () => {
    expect(clampTimerDelay(-5)).toBe(0)
    expect(clampTimerDelay(NaN)).toBe(0)
    expect(clampTimerDelay(1_000)).toBe(1_000)
    expect(clampTimerDelay(MAX_TIMER_DELAY + 10_000)).toBe(MAX_TIMER_DELAY)
  })
})

describe('shouldStayEnabled', () => {
  it('once 的时间已过：落成停用，避免「显示已启用却永远不跑」', () => {
    expect(shouldStayEnabled('once', true, null)).toBe(false)
  })

  it('once 还有下次运行：保持启用', () => {
    expect(shouldStayEnabled('once', true, 1)).toBe(true)
  })

  it('周期任务即使暂时算不出下次也保持启用状态由调用方决定', () => {
    expect(shouldStayEnabled('daily', true, null)).toBe(true)
    expect(shouldStayEnabled('interval', false, 1)).toBe(false)
  })
})

describe('isWallClockDue', () => {
  const now = at('2026-03-08T10:00:00-04:00')

  it('nextRunAt 已过算到点，未到不算', () => {
    expect(isWallClockDue({ enabled: true, nextRunAt: now - 1 }, now)).toBe(true)
    expect(isWallClockDue({ enabled: true, nextRunAt: now }, now)).toBe(true)
    expect(isWallClockDue({ enabled: true, nextRunAt: now + 1 }, now)).toBe(false)
  })

  it('停用或没有 nextRunAt 的任务不参与墙钟补跑', () => {
    expect(isWallClockDue({ enabled: false, nextRunAt: now - 1 }, now)).toBe(false)
    expect(isWallClockDue({ enabled: true, nextRunAt: undefined }, now)).toBe(false)
    expect(isWallClockDue({ enabled: true, nextRunAt: NaN }, now)).toBe(false)
  })
})

describe('selectDueTaskIds', () => {
  const now = at('2026-03-08T10:00:00-04:00')

  it('只挑出已到点且启用的任务', () => {
    const ids = selectDueTaskIds(
      [
        { id: 'due', enabled: true, nextRunAt: now - 60_000 },
        { id: 'future', enabled: true, nextRunAt: now + 60_000 },
        { id: 'off', enabled: false, nextRunAt: now - 60_000 },
        { id: 'unscheduled', enabled: true, nextRunAt: undefined }
      ],
      now
    )
    expect(ids).toEqual(['due'])
  })

  it('空表返回空数组', () => {
    expect(selectDueTaskIds([], now)).toEqual([])
  })
})

describe('HEARTBEAT_INTERVAL_MS', () => {
  // 唤醒后最坏迟到一个心跳间隔，这个上限直接决定用户「准不准」的感受
  it('落在 10s~60s 之间', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(10_000)
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(60_000)
  })
})
