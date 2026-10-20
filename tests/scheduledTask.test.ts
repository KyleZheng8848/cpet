import { describe, expect, it } from 'vitest'
import {
  excludeSchedulesForConversation,
  filterSchedulesForConversation,
  isRssDigestSchedule,
  migrateLegacyRssDigestSchedules,
  normalizeScheduleJob,
  normalizeScheduledTask,
  resolveScheduleRssDigestBounds,
  scheduleSourceLabel,
  validateScheduledTask
} from '../src/shared/scheduledTask'
import type { ScheduledTask } from '../src/shared/types'

function agentTask(patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'a1',
    name: 'agent',
    prompt: 'hello',
    kind: 'interval',
    intervalMinutes: 60,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  }
}

function rssTask(patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'r1',
    name: 'rss dig',
    prompt: '',
    job: 'rss-digest',
    rssConversationId: 'c-rss',
    conversationId: 'c-rss',
    sourceLabel: 'AI',
    digestTemplate: 'followup',
    kind: 'daily',
    hour: 9,
    minute: 0,
    enabled: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  }
}

describe('normalizeScheduleJob', () => {
  it('缺省与未知视为 agent', () => {
    expect(normalizeScheduleJob(undefined)).toBe('agent')
    expect(normalizeScheduleJob('foo')).toBe('agent')
    expect(normalizeScheduleJob('rss-digest')).toBe('rss-digest')
  })
})

describe('normalizeScheduledTask', () => {
  it('旧数据无 job 视为 agent', () => {
    const n = normalizeScheduledTask(agentTask({ job: undefined }))
    expect(n?.job).toBe('agent')
    expect(isRssDigestSchedule(n)).toBe(false)
  })

  it('rss-digest 对齐 conversationId', () => {
    const n = normalizeScheduledTask(
      rssTask({ conversationId: undefined, rssConversationId: 'c1' })
    )
    expect(n?.job).toBe('rss-digest')
    expect(n?.conversationId).toBe('c1')
    expect(n?.digestTemplate).toBe('followup')
  })

  it('rss-digest 保留收录评分下限', () => {
    const n = normalizeScheduledTask(rssTask({ digestScoreMin: 5 }))
    expect(n?.digestScoreMin).toBe(5)
    const all = normalizeScheduledTask(rssTask({ digestScoreMin: undefined }))
    expect(all?.digestScoreMin).toBeUndefined()
  })
})

describe('validateScheduledTask', () => {
  it('rss-digest 必须绑定', () => {
    expect(validateScheduledTask(rssTask({ rssConversationId: '', conversationId: '' }))).toMatch(
      /RSS/
    )
    expect(validateScheduledTask(rssTask())).toBeNull()
  })

  it('agent 必须有提示词', () => {
    expect(validateScheduledTask(agentTask({ prompt: '  ' }))).toMatch(/提示词/)
  })
})

describe('schedule filters', () => {
  it('按 conversation 过滤与排除', () => {
    const list = [
      agentTask({ id: 'a', conversationId: 'c-rss' }),
      rssTask({ id: 'r', rssConversationId: 'c-rss' }),
      rssTask({ id: 'r2', rssConversationId: 'other', conversationId: 'other' })
    ]
    expect(filterSchedulesForConversation(list, 'c-rss').map((t) => t.id)).toEqual(['r'])
    expect(excludeSchedulesForConversation(list, 'c-rss').map((t) => t.id)).toEqual(['a', 'r2'])
  })
})

describe('resolveScheduleRssDigestBounds', () => {
  it('interval 用分钟窗', () => {
    const b = resolveScheduleRssDigestBounds(
      { kind: 'interval', intervalMinutes: 120 },
      1_000_000
    )
    expect(b.toAt - b.fromAt).toBe(120 * 60_000)
    expect(b.label).toContain('小时')
  })

  it('daily/once 近 24 小时', () => {
    const b = resolveScheduleRssDigestBounds({ kind: 'daily', intervalMinutes: 60 }, 1_000_000)
    expect(b.windowHours).toBe(24)
    expect(b.label).toContain('24')
  })
})

describe('migrateLegacyRssDigestSchedules', () => {
  it('间隔迁移一条', () => {
    const m = migrateLegacyRssDigestSchedules({
      conversationId: 'c1',
      sourceLabel: 'AI',
      digestIntervalHours: 6,
      digestTemplate: 'brief'
    })
    expect(m).toHaveLength(1)
    expect(m[0]!.job).toBe('rss-digest')
    expect(m[0]!.kind).toBe('interval')
    expect(m[0]!.intervalMinutes).toBe(360)
  })

  it('每日多点迁多条', () => {
    const m = migrateLegacyRssDigestSchedules({
      conversationId: 'c1',
      sourceLabel: 'AI',
      digestHours: [9, 18]
    })
    expect(m).toHaveLength(2)
    expect(m.map((x) => x.hour).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([9, 18])
  })
})

describe('scheduleSourceLabel', () => {
  it('rss 显示来源', () => {
    expect(scheduleSourceLabel(rssTask())).toBe('RSS · AI')
    expect(scheduleSourceLabel(agentTask())).toBeNull()
  })
})
