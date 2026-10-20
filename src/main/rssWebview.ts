/**
 * RSS「网页」栏：桌面 UA + 去掉 Electron 指纹，按阅读栏真实宽度渲染。
 * 简洁模式外链图：对话窗 origin 是 localhost，图床防盗链会 403——按目标主机补 Referer。
 */

import { app, session, shell } from 'electron'
import type { OnBeforeSendHeadersListenerDetails } from 'electron'
import { inferHotlinkReferer, refererLooksLikeAppShell } from '../shared/rssHotlink'
import { RSS_WEBVIEW_DESKTOP_UA, RSS_WEBVIEW_PARTITION } from '../shared/rssWebview'

export { RSS_WEBVIEW_PARTITION }
export { inferHotlinkReferer } from '../shared/rssHotlink'

function attachHotlinkReferer(
  details: OnBeforeSendHeadersListenerDetails,
  baseHeaders: Record<string, string>
): Record<string, string> {
  if (details.resourceType !== 'image' && details.resourceType !== 'media') {
    return baseHeaders
  }
  const current =
    baseHeaders.Referer || baseHeaders.referer || details.requestHeaders.Referer || ''
  if (!refererLooksLikeAppShell(current)) return baseHeaders
  const spoofed = inferHotlinkReferer(details.url)
  if (!spoofed) return baseHeaders
  const next = { ...baseHeaders }
  delete next.referer
  next.Referer = spoofed
  return next
}

/** 在 app ready 后调用一次。 */
export function setupRssWebviewSession(): void {
  const ses = session.fromPartition(RSS_WEBVIEW_PARTITION)
  ses.setUserAgent(RSS_WEBVIEW_DESKTOP_UA)
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      cancel: false,
      requestHeaders: attachHotlinkReferer(details, {
        ...details.requestHeaders,
        'User-Agent': RSS_WEBVIEW_DESKTOP_UA
      })
    })
  })

  // 简洁正文在对话窗 defaultSession 里加载外链图
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      cancel: false,
      requestHeaders: attachHotlinkReferer(details, { ...details.requestHeaders })
    })
  })

  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setUserAgent(RSS_WEBVIEW_DESKTOP_UA)
    try {
      contents.setZoomFactor(1)
      contents.setVisualZoomLevelLimits(1, 3)
    } catch {
      /* older electron */
    }
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
