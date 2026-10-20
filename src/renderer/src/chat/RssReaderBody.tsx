import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef } from 'react'
import { reviveEscapedMediaInHtml } from '@shared/rssTask'
import { RssSelectableContent } from './RssSelectableContent'

const ICON_SRC_RE =
  /avatar|favicon|emoji|sprite|huggingface\.co\/.*\.(svg|png)|\/icons?\/|\/icon[-_]/i

/** 简洁正文：正常渲染图/音/视频；裂图若 alt 是长文则改成段落，避免灰条怪盒。 */
export function RssReaderBody({
  html,
  onQuote,
  onDiscuss
}: {
  html: string
  onQuote?: (text: string) => void
  onDiscuss?: (text: string) => void
}): JSX.Element {
  useUiLocale()
  const ref = useRef<HTMLDivElement>(null)
  const safeHtml = useMemo(() => reviveEscapedMediaInHtml(html), [html])

  useEffect(() => {
    const root = ref.current
    if (!root) return

    const imgs = Array.from(root.querySelectorAll('img'))
    const onErr = (e: Event): void => {
      const img = e.currentTarget as HTMLImageElement
      const alt = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim()
      // CMS 常把摘要塞进 alt；裂图会变成灰底怪盒 + 横条
      if (alt.length >= 36) {
        const p = document.createElement('p')
        p.className = 'rss-alt-fallback'
        p.textContent = alt
        img.replaceWith(p)
        return
      }
      // 正文大图加载失败：保留占位，别整图消失让人以为「简洁没图」
      const looksContent =
        !img.classList.contains('rss-img-icon') &&
        (/\/uploads?\//i.test(img.src) || /\.(?:webp|png|jpe?g|gif)(?:$|\?)/i.test(img.src))
      if (looksContent) {
        img.classList.add('rss-img-broken')
        img.alt = alt || '图片加载失败'
        return
      }
      img.style.display = 'none'
    }
    const tuneImg = (img: HTMLImageElement): void => {
      img.loading = 'lazy'
      img.decoding = 'async'
      // 勿设 no-referrer：量子位等 CDN 要站点 Referer；主进程会按主机补全
      img.removeAttribute('referrerpolicy')
      img.removeAttribute('width')
      img.removeAttribute('height')
      // 仅明确小图标 URL 先标；含 logo 的正文大图等 natural size 再判定
      if (ICON_SRC_RE.test(img.src) || ICON_SRC_RE.test(img.getAttribute('alt') || '')) {
        img.classList.add('rss-img-icon')
      }
      const applyNatural = (): void => {
        if (img.naturalWidth === 0) {
          onErr({ currentTarget: img } as unknown as Event)
          return
        }
        // 细长占位条 / 进度条图：直接隐藏
        if (img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight >= 7) {
          img.style.display = 'none'
          return
        }
        const ratio = img.naturalWidth / Math.max(1, img.naturalHeight)
        const looksIcon =
          img.naturalWidth <= 128 && img.naturalHeight <= 128 && ratio > 0.6 && ratio < 1.5
        if (looksIcon) {
          img.classList.add('rss-img-icon')
        } else {
          // 正文大图不要因 URL 含 logo 被缩成图标
          img.classList.remove('rss-img-icon')
          if (ratio >= 1.6 || img.naturalWidth >= 480) {
            img.classList.add('rss-img-chart')
          }
        }
      }
      if (img.complete) applyNatural()
      else img.addEventListener('load', applyNatural, { once: true })
      img.addEventListener('error', onErr)
    }
    for (const img of imgs) tuneImg(img)

    for (const v of Array.from(root.querySelectorAll('video'))) {
      v.controls = true
      v.setAttribute('playsinline', '')
      v.removeAttribute('autoplay')
      v.preload = v.preload || 'metadata'
      if (!v.getAttribute('src') && !v.querySelector('source[src]')) {
        v.remove()
      }
    }
    for (const a of Array.from(root.querySelectorAll('audio'))) {
      a.controls = true
      a.removeAttribute('autoplay')
      a.preload = a.preload || 'metadata'
      if (!a.getAttribute('src') && !a.querySelector('source[src]')) {
        a.remove()
      }
    }
    for (const frame of Array.from(root.querySelectorAll('iframe.rss-embed'))) {
      frame.setAttribute('loading', 'lazy')
    }

    return () => {
      for (const img of imgs) img.removeEventListener('error', onErr)
    }
  }, [safeHtml])

  const body = (
    <div ref={ref} className="rss-prose" dangerouslySetInnerHTML={{ __html: safeHtml }} />
  )

  if (!onQuote || !onDiscuss) {
    return <div className="rss-reader-body">{body}</div>
  }

  return (
    <RssSelectableContent className="rss-reader-body" onQuote={onQuote} onDiscuss={onDiscuss}>
      {body}
    </RssSelectableContent>
  )
}
