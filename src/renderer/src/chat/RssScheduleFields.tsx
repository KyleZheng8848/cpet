import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
/** 共享：关 / 每天（time 加减，最多 3）/ 每隔 N 小时。 */
import {
  RSS_SCHEDULE_DAILY_MAX,
  addRssScheduleHour,
  formatRssScheduleLabel,
  hourToTimeInput,
  removeRssScheduleHour,
  replaceRssScheduleHour,
  timeInputToHour,
  type RssScheduleValue
} from '@shared/rssSchedule'
import { normalizeRssDigestIntervalHours } from '@shared/rssTask'

export function RssScheduleFields({
  value,
  onChange,
  offLabel = '关',
  modeLabel = '日程',
  className,
  /** 窄栏：标签在上、选项在下，不重复展示摘要文案。 */
  compact = false
}: {
  value: RssScheduleValue
  onChange: (next: RssScheduleValue) => void
  offLabel?: string
  /** 模式下拉左侧/上方标签。 */
  modeLabel?: string
  className?: string
  compact?: boolean
}): JSX.Element {
  useUiLocale()
  const hours = value.hours || []

  function setMode(mode: RssScheduleValue['mode']): void {
    if (mode === 'off') {
      onChange({ mode: 'off' })
      return
    }
    if (mode === 'interval') {
      onChange({
        mode: 'interval',
        intervalHours: value.intervalHours ?? 24
      })
      return
    }
    onChange({
      mode: 'daily',
      hours: hours.length ? hours : [9]
    })
  }

  const extras =
    value.mode === 'daily' ? (
      <div className="rss-schedule-daily">
        {hours.map((h, i) => (
          <div key={`${h}-${i}`} className="rss-schedule-daily-row">
            <input
              type="time"
              step={3600}
              value={hourToTimeInput(h)}
              onChange={(e) => {
                const nextH = timeInputToHour(e.target.value)
                if (nextH == null) return
                onChange({
                  mode: 'daily',
                  hours: replaceRssScheduleHour(hours, i, nextH)
                })
              }}
            />
            <button
              type="button"
              className="settings-btn ghost tiny"
              disabled={hours.length <= 1}
              title={uiText("移除此时刻")}
              onClick={() => {
                const next = removeRssScheduleHour(hours, i)
                onChange(next?.length ? { mode: 'daily', hours: next } : { mode: 'off' })
              }}
            >
              {uiText("移除")}</button>
          </div>
        ))}
        {hours.length < RSS_SCHEDULE_DAILY_MAX ? (
          <button
            type="button"
            className="settings-btn ghost tiny"
            onClick={() => onChange({ mode: 'daily', hours: addRssScheduleHour(hours) })}
          >
            {uiText("加一个时刻")}</button>
        ) : null}
      </div>
    ) : value.mode === 'interval' ? (
      <label className="rss-schedule-interval">
        {!compact ? <span className="rss-schedule-label">{uiText("间隔")}</span> : null}
        <span className="rss-schedule-interval-input">
          <input
            type="number"
            min={1}
            max={168}
            step={1}
            value={value.intervalHours ?? 24}
            onChange={(e) => {
              const n = normalizeRssDigestIntervalHours(Number(e.target.value))
              if (n == null) return
              onChange({ mode: 'interval', intervalHours: n })
            }}
          />
          <span>{uiText("小时")}</span>
        </span>
      </label>
    ) : null

  if (compact) {
    return (
      <div
        className={['rss-schedule-fields', 'is-compact', className].filter(Boolean).join(' ')}
      >
        <label className="rss-schedule-mode">
          <span className="rss-schedule-label">{uiText(modeLabel)}</span>
          <select
            value={value.mode}
            title={formatRssScheduleLabel(value)}
            onChange={(e) => setMode(e.target.value as RssScheduleValue['mode'])}
          >
            <option value="off">{offLabel}</option>
            <option value="daily">{uiText("每天")}</option>
            <option value="interval">{uiText("每隔…")}</option>
          </select>
        </label>
        {extras}
      </div>
    )
  }

  return (
    <div className={['rss-schedule-fields', className].filter(Boolean).join(' ')}>
      <label className="rss-schedule-mode">
        <span className="rss-schedule-label">{uiText(modeLabel)}</span>
        <select
          value={value.mode}
          onChange={(e) => setMode(e.target.value as RssScheduleValue['mode'])}
        >
          <option value="off">{offLabel}</option>
          <option value="daily">{uiText("每天")}</option>
          <option value="interval">{uiText("每隔…")}</option>
        </select>
        <span className="rss-schedule-meta">{formatRssScheduleLabel(value)}</span>
      </label>
      {extras}
    </div>
  )
}
