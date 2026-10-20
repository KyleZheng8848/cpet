import { useUiLocale } from './i18n'
/** 回答进行中的三点动效；可单独占位，也可跟在已出正文后面（不替换正文）。 */
export function TypingDots({
  trailing = false,
  className,
  label = '回答中'
}: {
  /** 已有正文时跟在后面，避免顶掉已出现的内容。 */
  trailing?: boolean
  className?: string
  label?: string
}): JSX.Element {
  useUiLocale()
  return (
    <span
      className={['typing-dots', trailing ? 'is-trailing' : '', className].filter(Boolean).join(' ')}
      aria-label={label}
      role="status"
    >
      <i />
      <i />
      <i />
    </span>
  )
}
