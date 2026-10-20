import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useRef } from 'react'
import type { ChatSearchHit } from '@shared/chatExport'

export function ChatFindBar({
  open,
  query,
  scope,
  hits,
  localCount,
  onQueryChange,
  onScopeChange,
  onClose,
  onJump
}: {
  open: boolean
  query: string
  scope: 'current' | 'all'
  hits: ChatSearchHit[]
  /** 当前任务命中条数（scope=current 时用）。 */
  localCount: number
  onQueryChange: (q: string) => void
  onScopeChange: (s: 'current' | 'all') => void
  onClose: () => void
  onJump: (hit: ChatSearchHit) => void
}): JSX.Element | null {
  useUiLocale()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const countLabel =
    scope === 'current'
      ? query.trim()
        ? `${localCount} 条`
        : '当前任务'
      : query.trim()
        ? `${hits.length} 条`
        : '全部任务'

  return (
    <div className="chat-find" role="search">
      <div className="chat-find-row">
        <input
          ref={inputRef}
          className="chat-find-input"
          placeholder={uiText("搜索对话内容…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <div className="chat-find-scope" role="group" aria-label={uiText("搜索范围")}>
          <button
            type="button"
            className={scope === 'current' ? 'on' : ''}
            onClick={() => onScopeChange('current')}
          >
            {uiText("当前")}</button>
          <button
            type="button"
            className={scope === 'all' ? 'on' : ''}
            onClick={() => onScopeChange('all')}
          >
            {uiText("全部")}</button>
        </div>
        <span className="chat-find-count">{countLabel}</span>
        <button type="button" className="icon-btn" title={uiText("关闭搜索")} aria-label={uiText("关闭搜索")} onClick={onClose}>
          ✕
        </button>
      </div>
      {scope === 'all' && query.trim() && (
        <ul className="chat-find-hits">
          {hits.length === 0 ? (
            <li className="chat-find-empty">{uiText("无匹配")}</li>
          ) : (
            hits.map((h) => (
              <li key={`${h.conversationId}:${h.messageId}`}>
                <button type="button" onClick={() => onJump(h)}>
                  <strong>{h.title}</strong>
                  <span className="chat-find-role">{h.role === 'user' ? uiText("用户") : uiText("助手")}</span>
                  <span className="chat-find-snip">{h.snippet}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
