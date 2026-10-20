import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import type { ChatAttachment } from '@shared/types'

export interface QueuedPrompt {
  id: string
  prompt: string
  attachments: ChatAttachment[]
  skills: string[]
  createdAt: number
}

export function SendQueuePanel({
  items,
  draining,
  onEdit,
  onRemove,
  onClear,
  onSendNow
}: {
  items: QueuedPrompt[]
  /** 当前是否正在跑一轮（暂存会等它结束）。 */
  draining: boolean
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
  onSendNow: (id: string) => void
}): JSX.Element | null {
  useUiLocale()
  if (!items.length) return null

  return (
    <div className="send-queue" aria-label={uiText("暂存请求")}>
      <div className="send-queue-head">
        <span>
          {items.length} {uiText("条暂存")}{draining ? uiText(" · 有空闲列时按 FIFO 自动发送") : ''}
        </span>
        <button type="button" className="msg-act" onClick={onClear}>
          {uiText("清空")}</button>
      </div>
      <ul className="send-queue-list">
        {items.map((item, i) => (
          <li key={item.id} className="send-queue-item">
            <span className="send-queue-idx" aria-hidden>
              {i + 1}
            </span>
            <div className="send-queue-body">
              <p className="send-queue-text" title={item.prompt}>
                {item.prompt.trim() ||
                  (item.attachments.length
                    ? uiText("（{0} 个附件）", [item.attachments.length])
                    : item.skills.length
                      ? `/${item.skills.join(' /')}`
                      : uiText("（空）"))}
              </p>
              {(item.attachments.length > 0 || item.skills.length > 0) && (
                <p className="send-queue-meta">
                  {item.skills.length ? uiText("技能 {0}", [item.skills.length]) : ''}
                  {item.skills.length && item.attachments.length ? ' · ' : ''}
                  {item.attachments.length ? uiText("附件 {0}", [item.attachments.length]) : ''}
                </p>
              )}
            </div>
            <div className="send-queue-actions">
              <button
                type="button"
                className="sc-btn"
                title={uiText("编辑（取回输入框）")}
                onClick={() => onEdit(item.id)}
              >
                ✎
              </button>
              {!draining && (
                <button
                  type="button"
                  className="sc-btn"
                  title={uiText("立即发送")}
                  onClick={() => onSendNow(item.id)}
                >
                  ▶
                </button>
              )}
              <button
                type="button"
                className="sc-btn danger"
                title={uiText("删除")}
                onClick={() => onRemove(item.id)}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
