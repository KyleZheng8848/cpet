import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import type { UpdateCheckResult } from '../../../shared/types'
import { recentChangelog } from '../../../shared/changelog'

export function UpdateBanner({
  update,
  onDismiss,
  onOpenAbout
}: {
  update: UpdateCheckResult
  onDismiss: () => void
  onOpenAbout: () => void
}): JSX.Element | null {
  useUiLocale()
  if (update.status !== 'update-available' || !update.latest) return null
  const highlights = recentChangelog(1).find((e) => e.version === update.latest)?.highlights ?? []

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-main">
        <strong>{uiText("有新版本")}{' '}{update.latest}</strong>
        <span className="update-banner-sub">
          {uiText("当前")}{update.current} {uiText("· 浏览器下载后按平台安装（不会静默替换）")}</span>
        {highlights.length ? (
          <ul className="update-banner-points">
            {highlights.slice(0, 3).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="update-banner-actions">
        <button
          type="button"
          className="settings-btn tiny"
          onClick={() => {
            const url = update.downloadUrl || update.releasesUrl
            if (url) {
              window.petApi.openExternal(url)
            } else onOpenAbout()
          }}
        >
          {uiText("更新")}</button>
        <button type="button" className="settings-btn ghost tiny" onClick={onOpenAbout}>
          {uiText("详情")}</button>
        <button type="button" className="settings-btn ghost tiny" onClick={onDismiss}>
          {uiText("稍后")}</button>
      </div>
    </div>
  )
}
