import { uiLocaleTag, t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
/** RSS 任务内：绑定到本任务的定时简报列表与创建表单。 */
import { useEffect, useRef, useState } from 'react'
import type { ModelProvider, ScheduleKind, ScheduledTask } from '@shared/types'
import {
  filterSchedulesForConversation,
  migrateLegacyRssDigestSchedules
} from '@shared/scheduledTask'
import {
  RSS_DIGEST_TEMPLATE_GROUPS,
  RSS_VALUABLE_MINS,
  normalizeRssDigestHours,
  normalizeRssDigestIntervalHours,
  normalizeRssDigestScoreMin,
  normalizeRssDigestTemplate,
  rssDigestScoreMinLabel,
  rssDigestScoreMinOrUndef,
  rssDigestTemplateHint,
  rssDigestTemplateLabel,
  rssDigestTemplatesInGroup,
  rssValuableFilterLabel,
  type RssDigestScoreMin,
  type RssDigestTemplate,
  type RssTaskState
} from '@shared/rssTask'
import { modelRefLabel } from '@shared/models'
import { confirmDestructive } from './confirm'
import { ModelPicker } from './ModelPicker'

const INTERVAL_OPTS = [
  { v: 30, l: '30 分钟' },
  { v: 60, l: '1 小时' },
  { v: 120, l: '2 小时' },
  { v: 360, l: '6 小时' },
  { v: 720, l: '12 小时' },
  { v: 1440, l: '每天' }
]

function uid(): string {
  return 's' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function formatSchedule(task: ScheduledTask): string {
  switch (task.kind) {
    case 'interval': {
      const m = task.intervalMinutes ?? 60
      if (m < 60) return `每 ${m} 分钟`
      if (m % 1440 === 0) return `每 ${m / 1440} 天`
      if (m % 60 === 0) return `每 ${m / 60} 小时`
      return `每 ${m} 分钟`
    }
    case 'daily':
      return `每天 ${String(task.hour ?? 9).padStart(2, '0')}:${String(task.minute ?? 0).padStart(2, '0')}`
    case 'once':
      return task.runAt
        ? `一次性 ${new Date(task.runAt).toLocaleString(uiLocaleTag(), { hour12: false })}`
        : '一次性'
    default:
      return ''
  }
}

function formatNext(task: ScheduledTask): string {
  if (!task.enabled) return '已暂停'
  if (!task.nextRunAt) return task.kind === 'once' ? '已过期' : '—'
  const d = task.nextRunAt - Date.now()
  if (d <= 0) return '即将执行'
  if (d < 60_000) return `${Math.ceil(d / 1000)} 秒后`
  if (d < 3600_000) return `${Math.ceil(d / 60_000)} 分钟后`
  if (d < 86_400_000) return `${Math.ceil(d / 3600_000)} 小时后`
  return new Date(task.nextRunAt).toLocaleString(uiLocaleTag(), { hour12: false })
}

type Draft = {
  id: string
  name: string
  prompt: string
  digestTemplate: RssDigestTemplate
  digestScoreMin: RssDigestScoreMin
  modelRef: string
  kind: ScheduleKind
  intervalMinutes: number
  hour: number
  minute: number
  runAt?: number
  enabled: boolean
  isNew: boolean
}

function emptyDraft(
  sourceLabel: string,
  template: RssDigestTemplate,
  modelRef: string,
  scoreMin: RssDigestScoreMin = 0
): Draft {
  return {
    id: uid(),
    name: `${sourceLabel || 'RSS'} · 定时简报`,
    prompt: '',
    digestTemplate: template,
    digestScoreMin: scoreMin,
    modelRef,
    kind: 'daily',
    intervalMinutes: 60,
    hour: 9,
    minute: 0,
    enabled: true,
    isNew: true
  }
}

function toLocalDatetimeValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDatetimeValue(v: string): number | undefined {
  if (!v) return undefined
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : undefined
}

export function RssDigestSchedulePanel({
  conversationId,
  sourceLabel,
  rss,
  providers,
  defaultModelRef,
  onPatchRss,
  onOpenSchedules
}: {
  conversationId: string
  sourceLabel: string
  rss: RssTaskState
  providers: ModelProvider[]
  defaultModelRef: string
  onPatchRss: (next: RssTaskState) => void
  onOpenSchedules?: () => void
}): JSX.Element {
  useUiLocale()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const migratedRef = useRef(false)

  useEffect(() => {
    migratedRef.current = false
  }, [conversationId])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const all = await window.petApi.getSchedules()
      if (cancelled) return
      let bound = filterSchedulesForConversation(all, conversationId)
      if (!migratedRef.current && !bound.length) {
        const legacyIv = normalizeRssDigestIntervalHours(rss.digestIntervalHours)
        const legacyHours = normalizeRssDigestHours(rss.digestHours, rss.digestHour)
        if (legacyIv != null || legacyHours?.length) {
          migratedRef.current = true
          const drafts = migrateLegacyRssDigestSchedules({
            conversationId,
            sourceLabel,
            digestTemplate: rss.digestTemplate,
            modelRef: rss.scoreModelRef || defaultModelRef,
            digestHours: legacyHours,
            digestIntervalHours: legacyIv
          })
          for (const d of drafts) {
            await window.petApi.saveSchedule(d)
          }
          onPatchRss({
            ...rss,
            digestHours: undefined,
            digestHour: undefined,
            digestIntervalHours: undefined,
            updatedAt: Date.now()
          })
          const next = await window.petApi.getSchedules()
          if (cancelled) return
          bound = filterSchedulesForConversation(next, conversationId)
        }
      }
      setTasks(bound)
    }
    void load()
    const off = window.petApi.onSchedulesChanged((list) => {
      setTasks(filterSchedulesForConversation(list, conversationId))
    })
    return () => {
      cancelled = true
      off()
    }
    // 仅在进入本面板 / 换任务时迁移；rss 字段变化不反复迁移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sourceLabel, defaultModelRef])

  function startCreate(): void {
    setDraft(
      emptyDraft(
        sourceLabel,
        normalizeRssDigestTemplate(rss.digestTemplate),
        (rss.scoreModelRef || defaultModelRef).trim(),
        4
      )
    )
    setError(null)
  }

  function startEdit(task: ScheduledTask): void {
    setDraft({
      id: task.id,
      name: task.name,
      prompt: task.prompt || '',
      digestTemplate: normalizeRssDigestTemplate(task.digestTemplate || rss.digestTemplate),
      digestScoreMin: normalizeRssDigestScoreMin(task.digestScoreMin),
      modelRef: task.modelRef || defaultModelRef,
      kind: task.kind,
      intervalMinutes: task.intervalMinutes ?? 60,
      hour: task.hour ?? 9,
      minute: task.minute ?? 0,
      runAt: task.runAt,
      enabled: task.enabled,
      isNew: false
    })
    setError(null)
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      setError(uiText("请填写任务名称"))
      return
    }
    if (draft.kind === 'once' && (!draft.runAt || draft.runAt <= Date.now())) {
      setError(uiText("一次性任务需要选择未来的执行时间"))
      return
    }
    if (
      draft.enabled &&
      !confirmDestructive(
        uiText("{0}定时简报「{1}」？\n到点将用所选形式与模型写入本 RSS 任务。", [draft.isNew ? '创建并启用' : '保存并保持启用', name])
      )
    ) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const now = Date.now()
      await window.petApi.saveSchedule({
        id: draft.id,
        name,
        prompt: draft.prompt.trim(),
        job: 'rss-digest',
        rssConversationId: conversationId,
        conversationId,
        sourceLabel: sourceLabel.slice(0, 80),
        digestTemplate: draft.digestTemplate,
        digestScoreMin: rssDigestScoreMinOrUndef(draft.digestScoreMin),
        modelRef: draft.modelRef.trim() || undefined,
        kind: draft.kind,
        intervalMinutes: draft.kind === 'interval' ? draft.intervalMinutes : undefined,
        hour: draft.kind === 'daily' ? draft.hour : undefined,
        minute: draft.kind === 'daily' ? draft.minute : undefined,
        runAt: draft.kind === 'once' ? draft.runAt : undefined,
        enabled: draft.enabled,
        createdAt: draft.isNew ? now : tasks.find((t) => t.id === draft.id)?.createdAt || now,
        updatedAt: now
      })
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const t = tasks.find((x) => x.id === id)
    if (!confirmDestructive(uiText("确定删除定时简报「{0}」？", [t?.name || id]))) return
    await window.petApi.deleteSchedule(id)
    if (draft?.id === id) setDraft(null)
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    const t = tasks.find((x) => x.id === id)
    if (
      enabled &&
      t &&
      !confirmDestructive(uiText("启用定时简报「{0}」？到点将自动生成本 RSS 简报。", [t.name]))
    ) {
      return
    }
    await window.petApi.toggleSchedule(id, enabled)
  }

  async function runNow(id: string): Promise<void> {
    const t = tasks.find((x) => x.id === id)
    if (t && !confirmDestructive(uiText("立即执行定时简报「{0}」？", [t.name]))) return
    setRunningId(id)
    setError(null)
    const res = await window.petApi.runScheduleNow(id)
    if (!res.ok) setError(res.error || '执行失败')
    setRunningId(null)
  }

  return (
    <section className="rss-digest-cfg-sec" aria-labelledby="rss-digest-auto-h">
      <h4 id="rss-digest-auto-h" className="rss-digest-cfg-sec-h">
        {uiText("定时简报")}</h4>
      <p className="rss-digest-cfg-sec-hint">
        {uiText("每条定时任务可有不同形式、关注问题与模型；会出现在全局「定时任务」面板，并标明来源本 RSS。删除本 RSS 任务时会一并删除。")}</p>
      <div className="rss-digest-sched-toolbar">
        <button type="button" className="rss-digest-submit" onClick={startCreate} disabled={!!draft}>
          {uiText("创建定时任务")}</button>
        {onOpenSchedules ? (
          <button type="button" className="rss-text-btn" onClick={onOpenSchedules}>
            {uiText("打开全部定时")}</button>
        ) : null}
      </div>

      {error ? <p className="rss-digest-cfg-meta is-warn">{error}</p> : null}

      {draft ? (
        <div className="rss-digest-sched-form">
          <label>
            {uiText("名称")}<input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={uiText("例如：每日决策简报")}
            />
          </label>
          <div className="rss-digest-cfg-grid">
            <label title={rssDigestTemplateHint(draft.digestTemplate)}>
              {uiText("形式")}<select
                value={draft.digestTemplate}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    digestTemplate: normalizeRssDigestTemplate(e.target.value)
                  })
                }
              >
                {RSS_DIGEST_TEMPLATE_GROUPS.map((g) => (
                  <optgroup key={g.id} label={`${g.label} · ${g.hint}`}>
                    {rssDigestTemplatesInGroup(g.id).map((t) => (
                      <option key={t} value={t}>
                        {rssDigestTemplateLabel(t)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              {uiText("模型")}<ModelPicker
                className="rss-intel-picker"
                providers={providers}
                value={draft.modelRef}
                allowEmpty
                emptyLabel={uiText("模板骨架")}
                title={uiText("定时简报模型")}
                onChange={(ref) => setDraft({ ...draft, modelRef: ref })}
              />
            </label>
            <label title={uiText("只把达到该评分的消息纳入定时简报")}>
              {uiText("收录评分")}<select
                value={draft.digestScoreMin}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    digestScoreMin: normalizeRssDigestScoreMin(Number(e.target.value))
                  })
                }
              >
                <option value={0}>{rssDigestScoreMinLabel(0)}{uiText("消息")}</option>
                {RSS_VALUABLE_MINS.map((min) => (
                  <option key={min} value={min}>
                    {rssValuableFilterLabel(min)}（≥{min}）
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {uiText("关注问题（可选）")}<textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={2}
              placeholder={uiText("例如：只盯监管与投融资；可留空")}
            />
          </label>
          <div className="rss-digest-cfg-grid">
            <label>
              {uiText("频率")}<select
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as ScheduleKind })
                }
              >
                <option value="interval">{uiText("间隔")}</option>
                <option value="daily">{uiText("每天")}</option>
                <option value="once">{uiText("一次性")}</option>
              </select>
            </label>
            {draft.kind === 'interval' ? (
              <label>
                {uiText("间隔")}<select
                  value={draft.intervalMinutes}
                  onChange={(e) =>
                    setDraft({ ...draft, intervalMinutes: Number(e.target.value) })
                  }
                >
                  {INTERVAL_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {draft.kind === 'daily' ? (
              <label>
                {uiText("时间")}<input
                  type="time"
                  value={`${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    setDraft({ ...draft, hour: h, minute: m })
                  }}
                />
              </label>
            ) : null}
            {draft.kind === 'once' ? (
              <label>
                {uiText("执行时间")}<input
                  type="datetime-local"
                  value={draft.runAt ? toLocalDatetimeValue(draft.runAt) : ''}
                  onChange={(e) =>
                    setDraft({ ...draft, runAt: fromLocalDatetimeValue(e.target.value) })
                  }
                />
              </label>
            ) : null}
          </div>
          <label className="rss-digest-sched-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            {uiText("保存后启用")}</label>
          <p className="rss-digest-cfg-meta">{uiText("来源：RSS ·")}{' '}{sourceLabel || uiText("未命名")}</p>
          <div className="rss-digest-cfg-foot">
            <button
              type="button"
              className="rss-digest-submit"
              disabled={saving}
              onClick={() => void saveDraft()}
            >
              {saving ? uiText("保存中…") : uiText("保存")}
            </button>
            <button type="button" className="rss-text-btn" onClick={() => setDraft(null)}>
              {uiText("取消")}</button>
          </div>
        </div>
      ) : null}

      <div className="rss-digest-sched-list-head">
        <span className="rss-digest-sched-list-label">{uiText("已有定时")}</span>
        <span className="rss-digest-sched-list-count">{tasks.length}</span>
      </div>
      <ul className="rss-digest-sched-list">
        {!tasks.length && !draft ? (
          <li className="rss-digest-cfg-meta">
            {uiText("还没有绑定到本 RSS 的定时简报。点「创建定时任务」，或到时钟面板新建并选择本任务。")}</li>
        ) : (
          tasks.map((t) => (
            <li key={t.id} className={`rss-digest-sched-card${t.enabled ? '' : ' is-off'}`}>
              <div className="rss-digest-sched-card-top">
                <label className="rss-digest-sched-check" title={t.enabled ? uiText("暂停") : uiText("启用")}>
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => void toggle(t.id, e.target.checked)}
                  />
                  <span className="rss-digest-sched-name">{t.name}</span>
                </label>
                <span className="rss-digest-pick-actions">
                  <button
                    type="button"
                    className="rss-text-btn"
                    disabled={runningId === t.id}
                    onClick={() => void runNow(t.id)}
                  >
                    {runningId === t.id ? '…' : uiText("执行")}
                  </button>
                  <button type="button" className="rss-text-btn" onClick={() => startEdit(t)}>
                    {uiText("编辑")}</button>
                  <button type="button" className="rss-text-btn" onClick={() => void remove(t.id)}>
                    {uiText("删除")}</button>
                </span>
              </div>
              <p className="rss-digest-cfg-meta">
                {formatSchedule(t)}
                {' · '}
                {rssDigestTemplateLabel(normalizeRssDigestTemplate(t.digestTemplate))}
                {' · '}
                {rssDigestScoreMinLabel(normalizeRssDigestScoreMin(t.digestScoreMin))}
                {' · '}
                {t.modelRef ? modelRefLabel(providers, t.modelRef) : uiText("模板骨架")}
                {uiText(" · 下次 ")}
                {formatNext(t)}
              </p>
              {t.prompt?.trim() ? (
                <p className="rss-digest-cfg-meta">{uiText("关注：")}{t.prompt.trim()}</p>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
