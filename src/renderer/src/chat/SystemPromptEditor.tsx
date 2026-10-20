import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PromptTemplate } from '@shared/types'
import { IconPrompt } from './icons'
import {
  BUILTIN_PROMPT_TEMPLATES,
  newPromptTemplateId,
  normalizePromptTemplates,
  normalizeSystemPrompt
} from '@shared/prompts'

export function SystemPromptEditor({
  value,
  disabled,
  onChange
}: {
  value?: string
  disabled?: boolean
  onChange: (text: string) => void
}): JSX.Element {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [saveName, setSaveName] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const active = Boolean(normalizeSystemPrompt(value))

  function placePanel(): void {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(420, Math.max(280, window.innerWidth - 24))
    let left = r.right - width
    if (left < 8) left = 8
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
    const panelH = Math.min(520, window.innerHeight * 0.7)
    const below = r.bottom + 6
    const top =
      below + panelH > window.innerHeight - 8 ? Math.max(8, r.top - panelH - 6) : below
    setPanelPos({ top, left, width })
  }

  useEffect(() => {
    if (!open) return
    setDraft(value || '')
    void window.petApi.getSettings().then((s) => {
      setTemplates(normalizePromptTemplates(s.promptTemplates))
    })
  }, [open, value])

  useEffect(() => {
    if (!open) return
    placePanel()
    function onDoc(e: MouseEvent): void {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    function onReposition(): void {
      placePanel()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  function flash(msg: string): void {
    setHint(msg)
    window.setTimeout(() => setHint(null), 1600)
  }

  function commit(text: string): void {
    setDraft(text)
    onChange(text)
  }

  function applyTemplate(name: string, content: string): void {
    commit(content)
    flash(uiText("已套用「{0}」", [name]))
  }

  function persistTemplates(next: PromptTemplate[]): void {
    const normalized = normalizePromptTemplates(next)
    setTemplates(normalized)
    window.petApi.setPromptTemplates(normalized)
  }

  function saveAsTemplate(): void {
    const name = saveName.trim() || '未命名模版'
    const content = draft
    if (!content.trim()) {
      flash(uiText("请先填写系统提示再保存"))
      return
    }
    const now = Date.now()
    const existing = templates.find((t) => t.name === name)
    let next: PromptTemplate[]
    if (existing) {
      next = templates.map((t) =>
        t.id === existing.id ? { ...t, content, updatedAt: now } : t
      )
      flash(uiText("已更新模版「{0}」", [name]))
    } else {
      next = [...templates, { id: newPromptTemplateId(), name, content, updatedAt: now }]
      flash(uiText("已保存模版「{0}」", [name]))
    }
    persistTemplates(next)
    setSaveName('')
  }

  return (
    <div className="sys-prompt-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dir-btn sys-prompt-trigger ${active ? 'on' : ''}`}
        title={active ? uiText("本任务系统提示（{0} 字）", [(value || '').trim().length]) : uiText("为本任务配置系统提示")}
        aria-label={uiText("本任务系统提示")}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <IconPrompt />
        <span>{uiText("提示")}{active ? uiText("·开") : ''}</span>
      </button>
      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="sys-prompt-pop"
              role="dialog"
              aria-label={uiText("本任务系统提示")}
              style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
            >
          <div className="sys-prompt-pop-head">
            <strong>{uiText("本任务系统提示")}</strong>
            <span>{uiText("仅当前对话/对比生效")}</span>
          </div>
          <textarea
            className="system-prompt-editor"
            rows={5}
            placeholder={uiText("例如：你是简洁的中文助手，优先给结论…")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onChange(draft)}
          />
          <div className="sys-prompt-pop-actions">
            <span className="settings-desc tight">
              {hint || (draft.trim() ? uiText("已填写 · {0} 字", [draft.trim().length]) : uiText("未启用"))}
            </span>
            <div className="settings-row" style={{ gap: 6 }}>
              <button
                type="button"
                className="settings-btn ghost tiny"
                disabled={!draft.trim()}
                onClick={() => {
                  commit('')
                  flash(uiText("已清空"))
                }}
              >
                {uiText("清空")}</button>
              <button
                type="button"
                className="settings-btn tiny"
                onClick={() => {
                  onChange(draft)
                  flash(uiText("已保存到本任务"))
                }}
              >
                {uiText("保存")}</button>
            </div>
          </div>

          <h4 className="about-block-title" style={{ marginTop: 10 }}>
            {uiText("推荐模版")}</h4>
          <div className="prompt-template-chips">
            {BUILTIN_PROMPT_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="prompt-chip"
                title={t.content}
                onClick={() => applyTemplate(t.name, t.content)}
              >
                {t.name}
              </button>
            ))}
          </div>

          <h4 className="about-block-title" style={{ marginTop: 10 }}>
            {uiText("我的模版")}</h4>
          <div className="prompt-save-row">
            <input
              className="settings-input"
              placeholder={uiText("另存为模版名称")}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveAsTemplate()
              }}
            />
            <button type="button" className="settings-btn tiny" onClick={saveAsTemplate}>
              {uiText("另存为")}</button>
          </div>
          {templates.length === 0 ? (
            <p className="settings-desc tight" style={{ marginTop: 8 }}>
              {uiText("还没有模版。可在此另存，或到设置里管理模版库。")}</p>
          ) : (
            <ul className="prompt-template-list sys-prompt-template-list">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="prompt-template-main"
                    onClick={() => applyTemplate(t.name, t.content)}
                    title={t.content}
                  >
                    <strong>{t.name}</strong>
                    <span>
                      {t.content.replace(/\s+/g, ' ').slice(0, 48)}
                      {t.content.length > 48 ? '…' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
