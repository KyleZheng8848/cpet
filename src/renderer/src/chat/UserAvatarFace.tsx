import { useUiLocale } from '../i18n'
import { isUserAvatarImage } from '@shared/chatUi'

/** 用户头像：emoji 或本地图片（data URL）。 */
export function UserAvatarFace({
  avatar,
  className = '',
  title,
  as = 'div'
}: {
  avatar: string
  className?: string
  title?: string
  as?: 'div' | 'span'
}): JSX.Element {
  useUiLocale()
  const Tag = as
  const image = isUserAvatarImage(avatar)
  return (
    <Tag
      className={`${className}${image ? ' avatar-img' : ''}`.trim()}
      title={title}
    >
      {image ? <img src={avatar} alt="" draggable={false} /> : avatar}
    </Tag>
  )
}
