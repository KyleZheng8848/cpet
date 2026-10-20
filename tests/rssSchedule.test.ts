import { describe, expect, it } from 'vitest'
import {
  addRssScheduleHour,
  formatRssScheduleLabel,
  removeRssScheduleHour,
  resolveRssScheduleValue,
  timeInputToHour
} from '../src/shared/rssSchedule'

describe('rssSchedule', () => {
  it('prefers interval over daily hours', () => {
    expect(
      resolveRssScheduleValue({ hours: [9, 18], intervalHours: 12 })
    ).toEqual({ mode: 'interval', intervalHours: 12 })
  })

  it('migrates legacy single hour', () => {
    expect(resolveRssScheduleValue({ legacyHour: 8 })).toEqual({
      mode: 'daily',
      hours: [8]
    })
  })

  it('caps daily hours at 3', () => {
    const v = resolveRssScheduleValue({ hours: [6, 8, 12, 18, 21] })
    expect(v.mode).toBe('daily')
    expect(v.hours).toEqual([6, 8, 12])
  })

  it('formats labels', () => {
    expect(formatRssScheduleLabel({ mode: 'off' })).toBe('关')
    expect(formatRssScheduleLabel({ mode: 'daily', hours: [9, 18] })).toBe('9:00、18:00')
    expect(formatRssScheduleLabel({ mode: 'interval', intervalHours: 6 })).toBe(
      '每 6 小时'
    )
  })

  it('adds and removes daily hours', () => {
    expect(addRssScheduleHour([9], 18)).toEqual([9, 18])
    expect(removeRssScheduleHour([9, 18], 0)).toEqual([18])
    expect(removeRssScheduleHour([9], 0)).toBeUndefined()
  })

  it('parses time input hour', () => {
    expect(timeInputToHour('09:00')).toBe(9)
    expect(timeInputToHour('18:30')).toBe(18)
    expect(timeInputToHour('bad')).toBeNull()
  })
})
