import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Conversation } from '@shared/types'
import { formatConversationAge } from '@shared/conversationGroups'
import { conversationHasContent } from '@shared/conversationContent'
import { listTaskThreads } from '@shared/conversationThreads'
import { confirmDestructive } from './confirm'

export function ConvHistoryMenu(props: {
  active: Conversation | null
  /** 当前任务内切换线程 */
  onSwitchThread: (threadId: string) => void
  /** 当前任务内开新对话 */
  onNewThread: () => void
  /** 删除任务内某一轮对话 */
  onDeleteThread: (threadId: string) => void
  /** 任务正在跑时禁止删，避免冲掉流式上下文 */
  deleteDisabled?: boolean
}): JSX.Element | null {
  useUiLocale()
  const { active, onSwitchThread, onNewThread, onDeleteThread, deleteDisabled } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const supported = !!active && active.kind !== 'rss'
  const canNew = supported && conversationHasContent(active)
  const threads = useMemo(
    () => (supported && active ? listTaskThreads(active) : []),
    [supported, active]
  )
  const activeThreadId =
    active?.activeThreadId || threads.find((t) => t.messages === active?.messages)?.id || threads[0]?.id

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return threads
    return threads.filter((t) => (t.title || '新对话').toLowerCase().includes(q))
  }, [threads, query])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  if (!supported) return null

  return (
    <div className="conv-hist" ref={rootRef}>
      <div className="conv-hist-bar">
        <button
          type="button"
          className={`conv-hist-trigger${open ? ' open' : ''}`}
          title={uiText("本任务的对话记录")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="conv-hist-trigger-label">{uiText("对话记录")}</span>
          <span className="conv-hist-caret" aria-hidden>
            ▾
          </span>
        </button>
        {canNew && (
          <button
            type="button"
            className="conv-hist-new"
            title={uiText("在本任务内开一轮新对话（保留历史）")}
            onClick={() => {
              setOpen(false)
              onNewThread()
            }}
          >
            {uiText("+ 新对话")}</button>
        )}
      </div>

      {open && (
        <div className="conv-hist-pop" role="dialog" aria-label={uiText("本任务对话记录")}>
          <div className="conv-hist-tabs">
            <span className="conv-hist-tab on">{uiText("对话记录")}</span>
            {canNew && (
              <button
                type="button"
                className="conv-hist-tab action"
                onClick={() => {
                  setOpen(false)
                  onNewThread()
                }}
              >
                {uiText("+ 新对话")}</button>
            )}
          </div>
          <label className="conv-hist-search">
            <input
              ref={searchRef}
              type="search"
              placeholder={uiText("搜索本任务对话")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={uiText("搜索本任务对话")}
            />
            <span className="conv-hist-search-icon" aria-hidden>
              ⌕
            </span>
          </label>
          <ul className="conv-hist-list">
            {filtered.length === 0 && (
              <li className="conv-hist-empty">
                {query.trim() ? uiText("无匹配对话") : uiText("本任务还只有当前这一轮")}
              </li>
            )}
            {filtered.map((t) => {
              const label = t.title || uiText("新对话")
              const age = formatConversationAge(t.updatedAt || t.createdAt, Date.now())
              const on = t.id === activeThreadId
              const onlyOne = threads.length <= 1
              return (
                <li key={t.id} className={`conv-hist-row${on ? ' on' : ''}`}>
                  <button
                    type="button"
                    className={`conv-hist-item${on ? ' on' : ''}`}
                    onClick={() => {
                      setOpen(false)
                      if (!on) onSwitchThread(t.id)
                    }}
                  >
                    <span className="conv-hist-item-title" title={label}>
                      {label}
                    </span>
                    <span className="conv-hist-item-meta">
                      <span className="conv-hist-item-age">{age}</span>
                      {on && (
                        <span className="conv-hist-item-chev" aria-hidden>
                          ›
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="conv-hist-del"
                    title={
                      deleteDisabled
                        ? uiText("生成中，请先停止再删")
                        : onlyOne
                          ? uiText("清空当前对话")
                          : uiText("删除「{0}」", [label])
                    }
                    aria-label={uiText("删除对话 {0}", [label])}
                    disabled={!!deleteDisabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      const tip = onlyOne
                        ? '清空当前这一轮对话？此操作不可恢复。'
                        : `删除对话「${label}」？此操作不可恢复。`
                      if (!confirmDestructive(tip)) return
                      onDeleteThread(t.id)
                      if (threads.length <= 1) setOpen(false)
                    }}
                  >
                    {uiText("删除")}</button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
