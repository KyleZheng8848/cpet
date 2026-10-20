import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef } from 'react'
import {
  filePreviewBasename,
  isRemotePreviewUrl,
  localPathFromCpetFileUrl,
  type FilePreviewTarget
} from '@shared/filePreview'
import { renderMarkdown } from './markdown'
import { writeClipboardText } from '../lib/clipboard'

function markBrokenLocalImage(img: HTMLImageElement): void {
  if (img.dataset.broken === '1') return
  img.dataset.broken = '1'
  const path =
    localPathFromCpetFileUrl(img.currentSrc || img.src) ||
    localPathFromCpetFileUrl(img.getAttribute('src') || '') ||
    img.getAttribute('alt') ||
    ''
  const note = document.createElement('div')
  note.className = 'md-img-missing'
  note.textContent = path
    ? `图片文件不存在或无法读取：${path}`
    : '图片加载失败'
  img.insertAdjacentElement('afterend', note)
  img.hidden = true
}

function previewTargetFromImg(img: HTMLImageElement): FilePreviewTarget | null {
  const attr = img.getAttribute('src') || ''
  const src = (img.currentSrc || img.src || attr || '').trim()
  const local =
    localPathFromCpetFileUrl(src) ||
    localPathFromCpetFileUrl(attr) ||
    localPathFromCpetFileUrl(decodeURIComponent(attr || src))
  if (local) {
    return {
      path: local,
      name: filePreviewBasename(local),
      source: 'attachment',
      mime: 'image/*'
    }
  }
  if (isRemotePreviewUrl(src)) {
    const clean = src.split('#')[0]
    return {
      path: clean,
      remoteUrl: clean,
      name: filePreviewBasename(clean.split('?')[0]) || '图片',
      source: 'manual',
      mime: 'image/*'
    }
  }
  return null
}

/** 渲染 Markdown，并为代码块「复制」按钮 / 本地·在线图预览做事件委托。 */
export function MarkdownHtml({
  text,
  className = 'md',
  onOpenFilePreview
}: {
  text: string
  className?: string
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}): JSX.Element {
  useUiLocale()
  const html = useMemo(() => renderMarkdown(text), [text])
  const ref = useRef<HTMLDivElement>(null)
  const previewRef = useRef(onOpenFilePreview)
  previewRef.current = onOpenFilePreview

  useEffect(() => {
    const root = ref.current
    if (!root) return

    const onError = (e: Event): void => {
      const img = e.target as HTMLImageElement | null
      if (!img || img.tagName !== 'IMG' || !root.contains(img)) return
      // 在线图失败也提示；本地 404 同理
      markBrokenLocalImage(img)
    }
    root.addEventListener('error', onError, true)

    root.querySelectorAll('img').forEach((img) => {
      img.classList.add('md-img-previewable')
      if (img.complete && img.naturalWidth === 0) markBrokenLocalImage(img)
    })

    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      const img = target?.closest?.('img') as HTMLImageElement | null
      if (img && root.contains(img) && previewRef.current && !img.hidden) {
        const preview = previewTargetFromImg(img)
        if (preview) {
          e.preventDefault()
          e.stopPropagation()
          previewRef.current(preview)
          return
        }
      }
      const missing = target?.closest?.('.md-img-missing') as HTMLElement | null
      if (missing && root.contains(missing) && previewRef.current) {
        const path =
          localPathFromCpetFileUrl(missing.textContent || '') ||
          (missing.textContent || '').replace(/^图片文件不存在或无法读取：/, '').trim()
        if (path && (path.startsWith('/') || path.startsWith('~'))) {
          e.preventDefault()
          e.stopPropagation()
          previewRef.current({
            path,
            name: filePreviewBasename(path),
            source: 'attachment'
          })
          return
        }
      }
      const btn = target?.closest?.('.md-code-copy') as HTMLButtonElement | null
      if (!btn || !root.contains(btn)) return
      e.preventDefault()
      e.stopPropagation()
      const pre = btn.parentElement?.querySelector('pre')
      const code = pre?.textContent ?? ''
      if (!code) return
      const prev = btn.textContent
      void writeClipboardText(code).then((ok) => {
        btn.textContent = ok ? '已复制' : '失败'
        if (ok) btn.classList.add('copied')
        window.setTimeout(() => {
          btn.textContent = prev || '复制'
          btn.classList.remove('copied')
        }, 1200)
      })
    }

    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('error', onError, true)
    }
  }, [html])

  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
