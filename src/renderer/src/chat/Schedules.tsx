import { uiLocaleTag, t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { ModelProvider, ScheduleJob, ScheduleKind, ScheduledTask } from '@shared/types'
import {
  ensureBuiltinProviders,
  formatModelRef,
  migrateLegacyModelPrefs,
  modelRefLabel
} from '@shared/models'
import { sortSchedulesForHandoff } from '@shared/scheduleDigest'
import {
  isRssDigestSchedule,
  scheduleSourceLabel,
  validateScheduledTask
} from '@shared/scheduledTask'
import {
  RSS_DIGEST_TEMPLATE_GROUPS,
  RSS_VALUABLE_MINS,
  normalizeRssDigestScoreMin,
  normalizeRssDigestTemplate,
  rssDigestScoreMinLabel,
  rssDigestScoreMinOrUndef,
  rssDigestTemplateLabel,
  rssDigestTemplatesInGroup,
  rssValuableFilterLabel
} from '@shared/rssTask'
import { confirmDestructive } from './confirm'
import { ModelPicker } from './ModelPicker'

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
        : '一次性（未设时间）'
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

/** datetime-local 需要本地时区的 YYYY-MM-DDTHH:mm，不能用 toISOString（UTC）。 */
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

function emptyTask(defaultModelRef: string, job: ScheduleJob = 'agent'): ScheduledTask {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    prompt: '',
    modelRef: defaultModelRef,
    job,
    kind: job === 'rss-digest' ? 'daily' : 'interval',
    intervalMinutes: 60,
    hour: 9,
    minute: 0,
    digestTemplate: job === 'rss-digest' ? 'followup' : undefined,
    digestScoreMin: job === 'rss-digest' ? 4 : undefined,
    // RSS 简报创建即启用；Agent 任务仍默认关（可能改文件/跑命令）
    enabled: job === 'rss-digest',
    createdAt: now,
    updatedAt: now
  }
}

function scheduleRiskConfirm(action: string, name: string, rss: boolean): boolean {
  return confirmDestructive(
    `${action}定时任务「${name}」？\n\n` +
      (rss
        ? '到点后会按所选形式与模型生成简报，并写入绑定的 RSS 任务。'
        : '到点后会自动向所选模型发送提示词，并可能以「代理」权限改文件、跑命令。\n请确认工作目录是具体项目，而不是主目录。')
  )
}

const INTERVAL_OPTS = [
  { v: 5, l: '5 分钟' },
  { v: 15, l: '15 分钟' },
  { v: 30, l: '30 分钟' },
  { v: 60, l: '1 小时' },
  { v: 120, l: '2 小时' },
  { v: 360, l: '6 小时' },
  { v: 1440, l: '每天' }
]

export type RssScheduleOption = { id: string; title: string }

export function SchedulesPanel({
  defaultCwd,
  busy,
  onPickDir,
  onOpenConversation,
  onClose,
  rssConversations = []
}: {
  defaultCwd?: string
  busy: boolean
  onPickDir: () => Promise<string | undefined>
  /**
   * 打开绑定对话。
   * RSS 简报任务传 openRssDigest：进简报页并选中最新一份（没有也进简报页）。
   */
  onOpenConversation?: (
    conversationId: string,
    opts?: { openRssDigest?: boolean }
  ) => void
  /** 关闭定时任务面板，返回对话。 */
  onClose?: () => void
  /** 可选来源 RSS 任务（kind=rss）。 */
  rssConversations?: RssScheduleOption[]
}): JSX.Element {
  useUiLocale()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [defaultModelRef, setDefaultModelRef] = useState(formatModelRef('cursor', 'auto'))

  useEffect(() => {
    window.petApi.getSchedules().then(setTasks)
    const off = window.petApi.onSchedulesChanged(setTasks)
    void window.petApi.getSettings().then((s) => {
      const tree =
        s.modelProviders?.length
          ? ensureBuiltinProviders(s.modelProviders)
          : migrateLegacyModelPrefs(s.models)
      setProviders(tree)
      setDefaultModelRef(s.defaultModelRef || formatModelRef('cursor', 'auto'))
    })
    return off
  }, [])

  const orderedTasks = useMemo(() => sortSchedulesForHandoff(tasks), [tasks])
  const rssMap = useMemo(
    () => new Map(rssConversations.map((r) => [r.id, r.title])),
    [rssConversations]
  )

  function sourceText(task: ScheduledTask): string | null {
    if (!isRssDigestSchedule(task)) return null
    const live = task.rssConversationId ? rssMap.get(task.rssConversationId) : undefined
    if (live) return `RSS · ${live}`
    return scheduleSourceLabel(task)
  }

  function startAdd(job: ScheduleJob = 'agent'): void {
    const t = emptyTask(defaultModelRef, job)
    if (job === 'rss-digest' && rssConversations[0]) {
      t.rssConversationId = rssConversations[0].id
      t.conversationId = rssConversations[0].id
      t.sourceLabel = rssConversations[0].title
      t.name = `${rssConversations[0].title} · 定时简报`
    }
    setEditing(t)
    setError(null)
  }

  function startEdit(task: ScheduledTask): void {
    setEditing({
      ...task,
      job: isRssDigestSchedule(task) ? 'rss-digest' : 'agent',
      modelRef: task.modelRef || defaultModelRef,
      digestTemplate: isRssDigestSchedule(task)
        ? normalizeRssDigestTemplate(task.digestTemplate)
        : task.digestTemplate,
      digestScoreMin: isRssDigestSchedule(task)
        ? normalizeRssDigestScoreMin(task.digestScoreMin) || undefined
        : undefined
    })
    setError(null)
  }

  async function save(): Promise<void> {
    if (!editing) return
    const name = editing.name.trim()
    const job = isRssDigestSchedule(editing) ? 'rss-digest' : 'agent'
    const rssId = (editing.rssConversationId || '').trim()
    const rssTitle = rssId ? rssMap.get(rssId) || editing.sourceLabel || '' : ''
    const next: ScheduledTask = {
      ...editing,
      name,
      prompt: editing.prompt.trim(),
      job,
      modelRef: editing.modelRef?.trim() || undefined,
      cwd: job === 'agent' ? editing.cwd || defaultCwd : undefined,
      rssConversationId: job === 'rss-digest' ? rssId : undefined,
      conversationId: job === 'rss-digest' ? rssId : editing.conversationId,
      sourceLabel: job === 'rss-digest' ? rssTitle.slice(0, 80) : undefined,
      digestTemplate:
        job === 'rss-digest' ? normalizeRssDigestTemplate(editing.digestTemplate) : undefined,
      digestScoreMin:
        job === 'rss-digest' ? rssDigestScoreMinOrUndef(editing.digestScoreMin) : undefined
    }
    const verr = validateScheduledTask(next)
    if (verr) {
      setError(verr)
      return
    }
    if (job === 'agent' && !next.prompt) {
      setError(uiText("请填写要执行的提示词"))
      return
    }
    if (next.kind === 'once' && (!next.runAt || next.runAt <= Date.now())) {
      setError(uiText("一次性任务需要选择未来的执行时间"))
      return
    }
    if (job === 'agent' && !next.modelRef?.trim()) {
      setError(uiText("请选择执行模型"))
      return
    }
    const isNew = !tasks.some((t) => t.id === editing.id)
    if (next.enabled && !scheduleRiskConfirm(isNew ? '保存并启用' : '保存（保持启用）', name, job === 'rss-digest')) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await window.petApi.saveSchedule(next)
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.id === saved.id)
        if (i >= 0) return prev.map((t) => (t.id === saved.id ? saved : t))
        return [...prev, saved]
      })
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const t = tasks.find((x) => x.id === id)
    if (!confirmDestructive(uiText("确定删除定时任务「{0}」？此操作不可撤销。", [t?.name || id]))) return
    await window.petApi.deleteSchedule(id)
    setTasks((prev) => prev.filter((x) => x.id !== id))
    if (editing?.id === id) setEditing(null)
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    const t = tasks.find((x) => x.id === id)
    if (enabled && t && !scheduleRiskConfirm('启用', t.name || id, isRssDigestSchedule(t))) return
    const saved = await window.petApi.toggleSchedule(id, enabled)
    if (saved) setTasks((prev) => prev.map((x) => (x.id === id ? saved : x)))
  }

  async function runNow(id: string): Promise<void> {
    const t = tasks.find((x) => x.id === id)
    if (t && !scheduleRiskConfirm('立即执行', t.name || id, isRssDigestSchedule(t))) return
    setRunningId(id)
    setError(null)
    const res = await window.petApi.runScheduleNow(id)
    if (!res.ok) setError(res.error ?? '执行失败')
    setRunningId(null)
  }

  async function pickCwd(): Promise<void> {
    const dir = await onPickDir()
    if (dir && editing) setEditing({ ...editing, cwd: dir })
  }

  function basename(p: string): string {
    const parts = p.replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || p
  }


  const editingRss = editing ? isRssDigestSchedule(editing) : false
  const editingIsNew = editing ? !tasks.some((t) => t.id === editing.id) : false

  if (editing) {
    return (
      <div className="schedules schedules-edit-page">
        <div className="schedules-head">
          <div className="schedules-head-title">
            <button
              type="button"
              className="schedules-back"
              title={uiText("返回列表")}
              onClick={() => {
                setEditing(null)
                setError(null)
              }}
            >
              ←
            </button>
            <div>
              <h2>{editingIsNew ? uiText("新建定时任务") : uiText("编辑定时任务")}</h2>
              <p className="schedules-sub">
                {editingRss ? uiText("RSS 简报 · 到点写入绑定任务") : uiText("Agent 提示词 · 到点发给所选模型")}
              </p>
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              className="icon-btn"
              title={uiText("返回对话")}
              aria-label={uiText("返回对话")}
              onClick={onClose}
            >
              ✕
            </button>
          ) : null}
        </div>

        {error && <div className="schedules-error">{error}</div>}

        <div className="schedule-form schedule-form-page">
          <div className="sf-row">
            <span>{uiText("类型")}</span>
            <div className="sf-kinds">
              {(['agent', 'rss-digest'] as ScheduleJob[]).map((j) => (
                <button
                  key={j}
                  type="button"
                  className={`sf-kind ${editingRss === (j === 'rss-digest') ? 'on' : ''}`}
                  onClick={() => {
                    if (j === 'rss-digest') {
                      const first = rssConversations[0]
                      setEditing({
                        ...editing,
                        job: 'rss-digest',
                        digestTemplate: normalizeRssDigestTemplate(
                          editing.digestTemplate || 'followup'
                        ),
                        digestScoreMin:
                          normalizeRssDigestScoreMin(editing.digestScoreMin) || 4,
                        rssConversationId: editing.rssConversationId || first?.id,
                        conversationId: editing.rssConversationId || first?.id,
                        sourceLabel: editing.sourceLabel || first?.title || undefined,
                        cwd: undefined
                      })
                    } else {
                      setEditing({
                        ...editing,
                        job: 'agent',
                        rssConversationId: undefined,
                        sourceLabel: undefined,
                        digestTemplate: undefined,
                        digestScoreMin: undefined
                      })
                    }
                  }}
                >
                  {j === 'agent' ? uiText("Agent 提示词") : uiText("RSS 简报")}
                </button>
              ))}
            </div>
          </div>
          <label className="sf-row">
            <span>{uiText("名称")}</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={editingRss ? uiText("例如：AI 每日决策简报") : uiText("例如：每日代码审查")}
            />
          </label>
          {editingRss ? (
            <>
              <label className="sf-row">
                <span>{uiText("来源 RSS")}</span>
                <select
                  value={editing.rssConversationId || ''}
                  onChange={(e) => {
                    const id = e.target.value
                    const title = rssMap.get(id) || ''
                    setEditing({
                      ...editing,
                      rssConversationId: id,
                      conversationId: id,
                      sourceLabel: title,
                      name: editing.name.trim()
                        ? editing.name
                        : title
                          ? `${title} · 定时简报`
                          : editing.name
                    })
                  }}
                >
                  <option value="">{uiText("选择 RSS 任务…")}</option>
                  {rssConversations.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title || r.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sf-row">
                <span>{uiText("形式")}</span>
                <select
                  value={normalizeRssDigestTemplate(editing.digestTemplate)}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
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
              <label className="sf-row" title={uiText("只把达到该评分的消息纳入定时简报")}>
                <span>{uiText("收录评分")}</span>
                <select
                  value={normalizeRssDigestScoreMin(editing.digestScoreMin)}
                  onChange={(e) => {
                    setEditing({
                      ...editing,
                      digestScoreMin: rssDigestScoreMinOrUndef(Number(e.target.value))
                    })
                  }}
                >
                  <option value={0}>{rssDigestScoreMinLabel(0)}{uiText("消息")}</option>
                  {RSS_VALUABLE_MINS.map((min) => (
                    <option key={min} value={min}>
                      {rssValuableFilterLabel(min)}（≥{min}）
                    </option>
                  ))}
                </select>
              </label>
              <label className="sf-row">
                <span>{uiText("关注问题")}</span>
                <textarea
                  value={editing.prompt}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                  placeholder={uiText("可选：到点生成时额外强调的问题…")}
                  rows={3}
                />
              </label>
            </>
          ) : (
            <label className="sf-row">
              <span>{uiText("提示词")}</span>
              <textarea
                value={editing.prompt}
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                placeholder={uiText("到点后自动发给所选模型的内容…")}
                rows={4}
              />
            </label>
          )}
          <div className="sf-row">
            <span>{uiText("模型")}</span>
            <div className="sf-model">
              <ModelPicker
                providers={providers}
                value={editing.modelRef || defaultModelRef}
                allowEmpty={editingRss}
                emptyLabel={editingRss ? uiText("模板骨架") : undefined}
                onChange={(ref) => setEditing({ ...editing, modelRef: ref })}
                title={editingRss ? uiText("定时简报模型") : uiText("定时执行使用的模型")}
              />
            </div>
          </div>
          {!editingRss ? (
            <div className="sf-row">
              <span>{uiText("工作目录")}</span>
              <button type="button" className="sf-dir" onClick={pickCwd}>
                📁{' '}
                {editing.cwd
                  ? basename(editing.cwd)
                  : defaultCwd
                    ? basename(defaultCwd)
                    : uiText("默认目录")}
              </button>
            </div>
          ) : null}
          <div className="sf-row">
            <span>{uiText("频率")}</span>
            <div className="sf-kinds">
              {(['interval', 'daily', 'once'] as ScheduleKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`sf-kind ${editing.kind === k ? 'on' : ''}`}
                  onClick={() => setEditing({ ...editing, kind: k })}
                >
                  {k === 'interval' ? uiText("间隔") : k === 'daily' ? uiText("每天") : uiText("一次性")}
                </button>
              ))}
            </div>
          </div>
          {editing.kind === 'interval' && (
            <label className="sf-row">
              <span>{uiText("间隔")}</span>
              <select
                value={editing.intervalMinutes ?? 60}
                onChange={(e) =>
                  setEditing({ ...editing, intervalMinutes: Number(e.target.value) })
                }
              >
                {INTERVAL_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {editing.kind === 'daily' && (
            <label className="sf-row">
              <span>{uiText("时间")}</span>
              <input
                type="time"
                value={`${String(editing.hour ?? 9).padStart(2, '0')}:${String(editing.minute ?? 0).padStart(2, '0')}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  setEditing({ ...editing, hour: h, minute: m })
                }}
              />
            </label>
          )}
          {editing.kind === 'once' && (
            <label className="sf-row">
              <span>{uiText("执行时间")}</span>
              <input
                type="datetime-local"
                value={editing.runAt ? toLocalDatetimeValue(editing.runAt) : ''}
                onChange={(e) => {
                  setEditing({
                    ...editing,
                    runAt: fromLocalDatetimeValue(e.target.value)
                  })
                }}
              />
            </label>
          )}
          <label className="sf-check">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
            />
            {editingRss
              ? uiText("保存后启用")
              : uiText("保存后启用（默认关；Agent 任务可能改文件/跑命令）")}
          </label>
          <p className="settings-desc tight" style={{ margin: '0 0 8px' }}>
            {editingRss
              ? uiText("RSS 简报到点写入绑定任务的简报列表；删除该 RSS 时会一并删除本定时。")
              : uiText("定时任务按「代理」权限执行，可能改文件/跑命令。请选具体项目目录。")}
          </p>
          <div className="sf-actions">
            <button className="sf-save" onClick={() => void save()} disabled={saving}>
              {saving ? uiText("保存中…") : uiText("保存")}
            </button>
            <button
              className="sf-cancel"
              onClick={() => {
                setEditing(null)
                setError(null)
              }}
            >
              {uiText("取消")}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="schedules">
      <div className="schedules-head">
        <div className="schedules-head-title">
          <div>
            <h2>{uiText("定时任务")}</h2>
            <p className="schedules-sub">{uiText("Agent 提示词与 RSS 简报按时自动跑")}</p>
          </div>
        </div>
        <div className="schedules-head-actions">
          <button className="msg-act" onClick={() => startAdd('agent')}>
            ＋ Agent
          </button>
          <button
            className="msg-act"
            onClick={() => startAdd('rss-digest')}
            disabled={!rssConversations.length}
            title={
              rssConversations.length ? uiText("新建绑定 RSS 的定时简报") : uiText("请先创建 RSS 任务")
            }
          >
            {uiText("＋ RSS 简报")}</button>
          {onClose ? (
            <button
              type="button"
              className="icon-btn"
              title={uiText("返回对话")}
              aria-label={uiText("返回对话")}
              onClick={onClose}
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {error && <div className="schedules-error">{error}</div>}

      <div className="schedules-list">
        {tasks.length === 0 ? (
          <div className="schedules-empty">
            {uiText("设置定时任务：Agent 到点发提示词，或 RSS 简报到点写入对应订阅任务。")}<br />
            {uiText("支持间隔重复、每天固定时间、或一次性执行。也可在 RSS 任务的「生成 → 定时任务」里创建。")}<br />
            <span className="muted">
              {uiText("新建默认不启用；启用/立即执行会再确认一次。连续失败会自动暂停。")}</span>
          </div>
        ) : (
          orderedTasks.map((t) => {
            const src = sourceText(t)
            const openId = t.rssConversationId || t.conversationId
            return (
              <div
                className={`schedule-card ${t.enabled ? '' : 'off'}${
                  t.lastRunOk === false ? ' failed' : ''
                }`}
                key={t.id}
              >
                <div className="sc-top">
                  <div className="sc-title">
                    <label className="sc-toggle" title={t.enabled ? uiText("暂停") : uiText("启用")}>
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={(e) => toggle(t.id, e.target.checked)}
                        aria-label={t.enabled ? uiText("暂停「{0}」", [t.name]) : uiText("启用「{0}」", [t.name])}
                      />
                    </label>
                    <span className="sc-name" title={t.name}>
                      {t.name}
                    </span>
                    {isRssDigestSchedule(t) ? (
                      <span className="sc-badge" title={uiText("RSS 定时简报")}>
                        RSS
                      </span>
                    ) : null}
                    {t.lastRunOk === false ? (
                      <span className="sc-badge fail" title={uiText("最近一次失败")}>
                        {uiText("失败")}</span>
                    ) : null}
                  </div>
                  <div className="sc-actions">
                    {openId && onOpenConversation ? (
                      <button
                        className="sc-btn"
                        title={
                          isRssDigestSchedule(t) ? uiText("打开该任务最新简报") : uiText("查看运行对话")
                        }
                        onClick={() =>
                          onOpenConversation(
                            openId,
                            isRssDigestSchedule(t) ? { openRssDigest: true } : undefined
                          )
                        }
                      >
                        💬
                      </button>
                    ) : null}
                    <button
                      className="sc-btn"
                      title={uiText("立即执行")}
                      disabled={busy || runningId === t.id}
                      onClick={() => runNow(t.id)}
                    >
                      ▶
                    </button>
                    <button className="sc-btn" title={uiText("编辑")} onClick={() => startEdit(t)}>
                      ✏️
                    </button>
                    <button className="sc-btn danger" title={uiText("删除")} onClick={() => remove(t.id)}>
                      🗑
                    </button>
                  </div>
                </div>
                {src ? <div className="sc-source">{src}</div> : null}
                <div className="sc-meta">
                  <span className="sc-freq">{formatSchedule(t)}</span>
                  {isRssDigestSchedule(t) ? (
                    <span className="sc-model">
                      {rssDigestTemplateLabel(normalizeRssDigestTemplate(t.digestTemplate))}
                    </span>
                  ) : null}
                  <span className="sc-model" title={t.modelRef || defaultModelRef}>
                    {t.modelRef
                      ? modelRefLabel(providers, t.modelRef)
                      : isRssDigestSchedule(t)
                        ? uiText("模板骨架")
                        : modelRefLabel(providers, defaultModelRef)}
                  </span>
                  <span className="sc-next">{uiText("下次：")}{formatNext(t)}</span>
                </div>
                {t.prompt?.trim() ? (
                  <div className="sc-prompt">
                    {isRssDigestSchedule(t) ? uiText("关注：{0}", [t.prompt]) : t.prompt}
                  </div>
                ) : null}
                {t.lastRunAt ? (
                  <div className={`sc-last${t.lastRunOk === false ? ' fail' : ''}`}>
                    <span>
                      {uiText("上次：")}{new Date(t.lastRunAt).toLocaleString(uiLocaleTag(), { hour12: false })}
                      {typeof t.consecutiveFailures === 'number' && t.consecutiveFailures > 0
                        ? uiText(" · 连败 {0}", [t.consecutiveFailures])
                        : ''}
                    </span>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
