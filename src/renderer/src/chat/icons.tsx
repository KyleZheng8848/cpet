import { useUiLocale } from '../i18n'
/** 统一描边图标：与笔记本 UI 同色，避免 emoji / 杂符号混用。 */

import type { ReactNode } from 'react'

type IconProps = {
  size?: number
  className?: string
  title?: string
}

function Svg({
  size = 16,
  className,
  title,
  children
}: IconProps & { children: ReactNode }): JSX.Element {
  useUiLocale()
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function IconSearch(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" />
    </Svg>
  )
}

export function IconExport(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M8 2.5v7.5" />
      <path d="M5.2 7.2 8 10l2.8-2.8" />
      <path d="M3 13h10" />
    </Svg>
  )
}

export function IconSettings(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.7l.6 1.9c.5.1 1 .35 1.45.7l1.85-.65 1.05 1.05-.65 1.85c.35.45.6.95.7 1.45L14.3 8l-1.9.6c-.1.5-.35 1-.7 1.45l.65 1.85-1.05 1.05-1.85-.65a4 4 0 0 1-1.45.7L8 14.3l-.6-1.9a4 4 0 0 1-1.45-.7l-1.85.65-1.05-1.05.65-1.85a4 4 0 0 1-.7-1.45L1.7 8l1.9-.6c.1-.5.35-1 .7-1.45l-.65-1.85L4.7 3.05l1.85.65c.45-.35.95-.6 1.45-.7L8 1.7z" />
    </Svg>
  )
}

export function IconSchedule(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <circle cx="8" cy="8.2" r="5.2" />
      <path d="M8 5.2v3.2l2.1 1.3" />
    </Svg>
  )
}

export function IconActivity(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M1.8 8h2.4l1.6-4.2 2.4 8.4L10.4 6l1.5 2H14.2" />
    </Svg>
  )
}

export function IconClose(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  )
}

export function IconFolder(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M2.5 4.8h3.2l1.2 1.3H13.5v6.1a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V4.8z" />
    </Svg>
  )
}

/** 本对话文件列表：圆角文件夹 + 底下一短横。 */
export function IconFiles(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M2.6 6.2c0-.8.6-1.4 1.4-1.4h2.1c.3 0 .6.1.8.3l.7.8h4.4c.8 0 1.4.6 1.4 1.4v4.7c0 .8-.6 1.4-1.4 1.4H4c-.8 0-1.4-.6-1.4-1.4V6.2z" />
      <path d="M6.2 11.1h3.6" />
    </Svg>
  )
}

export function IconClear(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M3.5 4.5h9" />
      <path d="M6 4.5V3.2h4v1.3" />
      <path d="M5 4.5l.6 8.2h4.8L11 4.5" />
    </Svg>
  )
}

export function IconPrompt(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M3 3.5h10v7.2H7.2L4.2 13v-2.3H3V3.5z" />
      <path d="M5.5 6.2h5M5.5 8.6h3.5" />
    </Svg>
  )
}

export function IconProcess(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M2.8 4h10.4M2.8 8h7.2M2.8 12h10.4" />
      <circle cx="12.2" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconThink(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M8 2.8a3.6 3.6 0 0 1 2.2 6.4c-.4.3-.7.8-.7 1.3v.3H6.5v-.3c0-.5-.3-1-.7-1.3A3.6 3.6 0 0 1 8 2.8z" />
      <path d="M6.6 12.4h2.8M7 13.6h2" />
    </Svg>
  )
}

export function IconAttach(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M13.2 7.4 7.1 13.5a3.1 3.1 0 0 1-4.4-4.4l6.5-6.5a2.1 2.1 0 0 1 3 3L5.7 12" />
    </Svg>
  )
}

export function IconMic(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M8 2.8a1.8 1.8 0 0 1 1.8 1.8v3.2a1.8 1.8 0 0 1-3.6 0V4.6A1.8 1.8 0 0 1 8 2.8z" />
      <path d="M4.2 7.6a3.8 3.8 0 0 0 7.6 0M8 11.4v2.2M5.5 13.6h5" />
    </Svg>
  )
}

export function IconSlash(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <path d="M6.2 12.5 9.8 3.5" />
    </Svg>
  )
}

/** 皮肤 / 外观入口。 */
export function IconSkin(p: IconProps): JSX.Element {
  useUiLocale()
  return (
    <Svg {...p}>
      <circle cx="8" cy="7.2" r="3.2" />
      <path d="M3.2 13.2c.9-2.2 2.6-3.3 4.8-3.3s3.9 1.1 4.8 3.3" />
      <path d="M11.6 4.2c.9-.2 1.7.4 1.6 1.3-.1.6-.5 1-1.1 1.1" />
    </Svg>
  )
}
