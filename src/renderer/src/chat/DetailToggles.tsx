import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { IconProcess, IconThink } from './icons'

/** 过程旁白 / 思维链 / 工具 / 命令：统一由「过程」控制显隐。 */
export interface AgentDetailVisibility {
  showDetails: boolean
}

export function AgentDetailToggles({
  visibility,
  onChange
}: {
  visibility: AgentDetailVisibility
  onChange: (patch: Partial<AgentDetailVisibility>) => void
  /** @deprecated 对话中也应可切换，保留参数以免旧调用报错 */
  disabled?: boolean
}): JSX.Element {
  useUiLocale()
  const on = visibility.showDetails
  return (
    <div className="detail-toggles" role="group" aria-label={uiText("过程与工具显示")}>
      <button
        type="button"
        className={`detail-chip ${on ? 'on' : ''}`}
        title={
          on
            ? uiText("过程：开 — 点击隐藏思考 / 旁白 / 工具")
            : uiText("过程：关 — 点击显示思考 / 旁白 / 工具")
        }
        aria-pressed={on}
        aria-label={on ? uiText("隐藏过程详情") : uiText("显示过程详情")}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onChange({ showDetails: !on })
        }}
      >
        <IconProcess />
        <span>{uiText("过程")}{on ? '' : uiText("·隐")}</span>
      </button>
    </div>
  )
}

/** 直连深度思考：发请求时带思维链参数（输入区图标按钮，与附件同尺寸）。 */
export function ThinkingToggle({
  on,
  disabled,
  onChange
}: {
  on: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  useUiLocale()
  return (
    <button
      type="button"
      className={`attach-btn thinking-btn ${on ? 'on' : ''}`}
      disabled={disabled}
      title={
        on
          ? uiText("深度思考开：本次直连会请求思维链（可用「⋯ 过程」控制是否展示）")
          : uiText("深度思考关：直连只要最终回答")
      }
      aria-pressed={on}
      aria-label={uiText("深度思考")}
      onClick={() => onChange(!on)}
    >
      <IconThink />
    </button>
  )
}
