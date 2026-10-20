import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import type { PetMood, PetState } from '@shared/types'

type View = PetState | PetMood

interface BubbleConfig {
  tone: 'neutral' | 'ok' | 'warn' | 'bad' | 'happy'
  hint?: string
  clickable?: boolean
  /** 主标题（不含过程正文）。 */
  title: (toolLabel: string) => string
  /** 是否展示 note / 思维链区域。 */
  showBody?: boolean
}

function shortNote(text: string | undefined, max = 72): string | null {
  if (!text) return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 思维链气泡展示：取末尾一段，读起来更像「正在想」。 */
function formatProcess(text: string | undefined, max = 96): string | null {
  if (!text) return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t.length <= max) return t
  return `…${t.slice(-max)}`
}

const CONFIG: Partial<Record<View, BubbleConfig>> = {
  thinking: {
    tone: 'neutral',
    get hint() { return uiText("点击打开") },
    clickable: true,
    showBody: true,
    title: () => '思考中'
  },
  tool: {
    tone: 'neutral',
    get hint() { return uiText("点击打开") },
    clickable: true,
    showBody: true,
    title: (label) => (label.trim() ? `⚙ ${label.trim()}` : '⚙ 使用工具…')
  },
  talking: {
    tone: 'neutral',
    get hint() { return uiText("点击打开") },
    clickable: true,
    showBody: true,
    title: () => '💬 回复中'
  },
  waiting: {
    tone: 'warn',
    get hint() { return uiText("点击打开") },
    clickable: true,
    showBody: true,
    title: () => '🕐 等你回复'
  },
  done: {
    tone: 'ok',
    get hint() { return uiText("点击打开") },
    clickable: true,
    showBody: true,
    title: () => '✓ 任务完成'
  },
  error: {
    tone: 'bad',
    get hint() { return uiText("点击打开") },
    clickable: true,
    showBody: true,
    title: () => '⚠ 出错了'
  },
  petted: {
    tone: 'happy',
    title: () => '嘿嘿~'
  }
}

export function ThoughtBubble({
  view,
  toolLabel,
  note,
  processText,
  showProcess,
  hint,
  onClick,
  onDismiss
}: {
  view: View
  toolLabel: string
  /** 完成 / 等待 / 出错时的短摘要。 */
  note?: string
  /** 模型思维链 / 过程旁白（流式累积）。 */
  processText?: string
  /** 与对话窗「⋯ 过程」同步；关则不展示思维链。 */
  showProcess?: boolean
  /** 覆盖默认底部提示（如「点击打开 Cursor」）。 */
  hint?: string
  onClick?: () => void
  /** 只关气泡，不打开对话/IDE。 */
  onDismiss?: () => void
}): JSX.Element | null {
  useUiLocale()
  const cfg = CONFIG[view]
  if (!cfg) return null
  const canClick = !!(cfg.clickable && onClick)
  const title = cfg.title(toolLabel)
  const tip = cfg.showBody ? shortNote(note, view === 'error' ? 56 : 72) : null
  const process =
    cfg.showBody && showProcess !== false ? formatProcess(processText) : null
  const hasBody = !!(tip || process)
  const clickHint = hint ?? cfg.hint
  const canDismiss = !!onDismiss

  return (
    <div
      className={`thought tone-${cfg.tone}${canClick ? ' clickable' : ''}${hasBody ? ' has-body' : ''}`}
      role={canClick ? 'button' : undefined}
      title={clickHint}
      onClick={
        canClick
          ? (e) => {
              e.stopPropagation()
              onClick?.()
            }
          : undefined
      }
    >
      {canDismiss ? (
        <button
          type="button"
          className="bubble-dismiss"
          aria-label={uiText("关闭气泡")}
          title={uiText("关闭")}
          onClick={(e) => {
            e.stopPropagation()
            onDismiss?.()
          }}
        >
          <span aria-hidden>×</span>
        </button>
      ) : null}
      <div className="thought-head">
        <span className="thought-title">{title}</span>
        {view === 'thinking' || view === 'talking' || view === 'tool' ? (
          <span className="dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        ) : null}
      </div>
      {hasBody ? (
        <div className="thought-body">
          {process ? (
            <div className="thought-process" title={uiText("思维链（受「过程」开关控制）")}>
              {process}
            </div>
          ) : null}
          {tip ? <div className="thought-note">{tip}</div> : null}
        </div>
      ) : null}
      {canClick && clickHint ? <span className="bubble-hint">{clickHint}</span> : null}
      <span className="thought-tail" />
    </div>
  )
}
