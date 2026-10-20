import { describe, expect, it } from 'vitest'
import {
  makeScheduleDigest,
  sortSchedulesForHandoff
} from '../src/shared/scheduleDigest'
import type { ScheduledTask } from '../src/shared/types'

function task(patch: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 't',
    name: 'n',
    prompt: 'p',
    kind: 'interval',
    intervalMinutes: 60,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  }
}

describe('makeScheduleDigest', () => {
  it('压扁换行并截断', () => {
    const d = makeScheduleDigest('第一行\n\n第二行 **粗体**', 20)
    expect(d).toContain('第一行')
    expect(d.length).toBeLessThanOrEqual(20)
  })

  it('空串返回空', () => {
    expect(makeScheduleDigest('   ')).toBe('')
  })
})

describe('sortSchedulesForHandoff', () => {
  it('失败优先，其次按最近运行', () => {
    const sorted = sortSchedulesForHandoff([
      task({ id: 'ok-old', lastRunOk: true, lastRunAt: 100 }),
      task({ id: 'fail', lastRunOk: false, lastRunAt: 50 }),
      task({ id: 'ok-new', lastRunOk: true, lastRunAt: 200 })
    ])
    expect(sorted.map((t) => t.id)).toEqual(['fail', 'ok-new', 'ok-old'])
  })
})
