import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { ChatBlock } from '@shared/types'
import {
  attachmentKindIcon,
  attachmentKindLabel,
  attachmentLocalUrl,
  classifyAttachmentMedia,
  type AttachmentMediaKind
} from '@shared/attachmentMedia'
import {
  canonicalLocalPath,
  extractFilePathFromToolPayload,
  extractLocalImagePaths,
  filePreviewBasename,
  isAttachableLocalPath,
  type FilePreviewTarget
} from '@shared/filePreview'
import { MarkdownHtml } from './MarkdownHtml'
import type { AgentDetailVisibility } from './DetailToggles'
import { skillReportUnfulfilled } from './processBlocks'
import { extractRemoteImageUrls } from '@shared/remoteImages'

const DEFAULT_VISIBILITY: AgentDetailVisibility = { showDetails: true }

export function Block({
  block,
  visibility = DEFAULT_VISIBILITY,
  /** 流式中：正文用纯文本，避免每帧整段 Markdown 解析卡死 */
  streaming = false,
  onOpenFilePreview,
  /** 正文已展示的本地图路径，命令区不再重复出图 */
  markdownImagePaths
}: {
  block: ChatBlock
  visibility?: AgentDetailVisibility
  streaming?: boolean
  onOpenFilePreview?: (target: FilePreviewTarget) => void
  markdownImagePaths?: Set<string>
}): JSX.Element | null {
  useUiLocale()
  switch (block.kind) {
    case 'text':
      return (
        <TextBlock text={block.text} streaming={streaming} onOpenFilePreview={onOpenFilePreview} />
      )
    case 'reasoning':
      if (!visibility.showDetails) return null
      return <ReasoningBlock text={block.text} label={uiText("思考")} defaultOpen streaming={streaming} />
    case 'status':
      if (!visibility.showDetails && !block.pin) return null
      // 过程旁白默认展开，避免「开着过程却像被藏起来」
      return <ReasoningBlock text={block.text} label={uiText("过程")} defaultOpen streaming={streaming} />
    case 'skill': {
      // 投递成功属于过程，跟随「过程」开关；没落地的技能是要求没被执行，任何时候都要报出来
      const unfulfilled = skillReportUnfulfilled(block)
      if (!visibility.showDetails && !unfulfilled) return null
      return (
        <ReasoningBlock
          text={block.text}
          label={unfulfilled ? uiText("技能未生效") : uiText("技能")}
          defaultOpen
          streaming={streaming}
        />
      )
    }
    case 'sticker':
      return <StickerBlock block={block} />
    case 'attachment':
      return <AttachmentBlock block={block} onOpenFilePreview={onOpenFilePreview} />
    case 'tool':
      if (!visibility.showDetails) return null
      return <ToolBlock block={block} onOpenFilePreview={onOpenFilePreview} />
    case 'command':
      if (!visibility.showDetails) return null
      return (
        <CommandBlock
          block={block}
          onOpenFilePreview={onOpenFilePreview}
          markdownImagePaths={markdownImagePaths}
        />
      )
    default:
      return null
  }
}

function TextBlock({
  text,
  streaming,
  onOpenFilePreview
}: {
  text: string
  streaming?: boolean
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}): JSX.Element {
  useUiLocale()
  if (streaming) {
    return <div className="md md-streaming">{text}</div>
  }
  return <MarkdownHtml text={text} className="md" onOpenFilePreview={onOpenFilePreview} />
}

function ReasoningBlock({
  text,
  label,
  defaultOpen = false,
  streaming = false
}: {
  text: string
  label: string
  defaultOpen?: boolean
  streaming?: boolean
}): JSX.Element {
  useUiLocale()
  const [open, setOpen] = useState(defaultOpen)
  const preview = text.replace(/\s+/g, ' ').trim()
  const short = preview.length > 48 ? preview.slice(0, 48) + '…' : preview
  return (
    <div className={`reasoning ${open ? 'open' : ''}`}>
      <button type="button" className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        {label}
        {!open && short ? <span className="detail-preview">{short}</span> : null}
      </button>
      {open &&
        (streaming ? (
          <div className="reasoning-body md md-streaming">{text}</div>
        ) : (
          <MarkdownHtml text={text} className="reasoning-body md" />
        ))}
    </div>
  )
}

function StickerBlock({
  block
}: {
  block: Extract<ChatBlock, { kind: 'sticker' }>
}): JSX.Element {
  useUiLocale()
  return (
    <div className="sticker-block" title={block.label}>
      {block.image ? (
        <img className="sticker-img" src={block.image} alt={block.label ?? block.emoji} draggable={false} />
      ) : (
        <span className="sticker-emoji">{block.emoji}</span>
      )}
      {block.label ? <span className="sticker-label">{block.label}</span> : null}
    </div>
  )
}

function attachmentKindOf(block: {
  mime?: string
  path?: string
  name?: string
}): AttachmentMediaKind {
  return classifyAttachmentMedia(block.path || block.name || '', block.mime)
}

function AttachmentBlock({
  block,
  onOpenFilePreview
}: {
  block: Extract<ChatBlock, { kind: 'attachment' }>
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}): JSX.Element {
  useUiLocale()
  const kind = attachmentKindOf(block)
  // 快问 IPC / 旧消息常不带 preview：按本地路径懒加载，避免只显示文件名芯片
  const [preview, setPreview] = useState<string | undefined>(block.preview)

  useEffect(() => {
    setPreview(block.preview)
  }, [block.preview, block.path])
  useEffect(() => {
    if (preview || !block.path || kind !== 'image') return
    let cancelled = false
    void window.petApi.previewAttachment(block.path).then((url) => {
      if (!cancelled && url) setPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [preview, block.path, kind])

  const mediaSrc = block.path ? attachmentLocalUrl(block.path) : preview
  const thumbSrc = preview || (kind === 'image' && block.path ? attachmentLocalUrl(block.path) : undefined)

  function openPreview(): void {
    if (!block.path || !onOpenFilePreview) return
    onOpenFilePreview({
      path: block.path,
      name: block.name || filePreviewBasename(block.path),
      mime: block.mime,
      source: 'attachment'
    })
  }

  return (
    <button
      type="button"
      className="attach-block is-clickable"
      title={block.path ? uiText("{0}\n点击右侧预览 · {1}", [block.name, block.path]) : block.name}
      onClick={() => openPreview()}
      disabled={!block.path || !onOpenFilePreview}
    >
      {thumbSrc ? (
        <img className="attach-preview" src={thumbSrc} alt={block.name} />
      ) : kind === 'video' && mediaSrc ? (
        <video className="attach-preview attach-preview-video" src={mediaSrc} muted preload="metadata" />
      ) : (
        <div className="attach-file">
          <span className="attach-file-icon">{attachmentKindIcon(kind)}</span>
          <div className="attach-file-meta">
            <div className="attach-file-name">{block.name}</div>
            <div className="attach-file-path">
              {attachmentKindLabel(kind)}
              {block.path ? uiText(" · 预览") : ''}
            </div>
          </div>
        </div>
      )}
      {thumbSrc || kind === 'video' ? (
        <div className="attach-caption">
          {block.name}
          <span className="attach-caption-hint">{uiText("点击预览")}</span>
        </div>
      ) : null}
    </button>
  )
}

function statusDot(status: string): JSX.Element {
  return <span className={`dot dot-${status}`} />
}

function MdOrPre({
  text,
  className,
  onOpenFilePreview
}: {
  text: string
  className: string
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}): JSX.Element {
  useUiLocale()
  return (
    <MarkdownHtml
      text={text}
      className={`${className} md`}
      onOpenFilePreview={onOpenFilePreview}
    />
  )
}

function shortenToolHeadline(name: string, input?: string): string {
  const raw = `${name} ${input || ''}`
  const m = raw.match(/https?:\/\/[^\s"'<>]+/i)
  if (!m) return name
  try {
    const u = new URL(m[0])
    const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 26)}…` : u.pathname
    return `${name} · ${u.hostname}${path === '/' ? '' : path}`
  } catch {
    return name
  }
}

function ToolBlock({
  block,
  onOpenFilePreview
}: {
  block: Extract<ChatBlock, { kind: 'tool' }>
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}): JSX.Element {
  useUiLocale()
  // 运行中默认展开；抓取类完成后收起，别拿整段 URL 刷屏
  const isFetch = /fetch|http|browse|web/i.test(block.name)
  const [open, setOpen] = useState(block.status === 'running' && !isFetch)
  useEffect(() => {
    if (block.status === 'running') setOpen(!isFetch)
    else if (isFetch) setOpen(false)
  }, [block.status, isFetch])
  const headline = shortenToolHeadline(block.name, block.input)
  const filePath = extractFilePathFromToolPayload(block.input, block.output)
  return (
    <div className={`tool status-${block.status}`}>
      <div className="tool-head-row">
        <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)} title={block.input}>
          {statusDot(block.status)}
          <span className="tool-name">{headline}</span>
          {block.status === 'running' && <span className="spinner" />}
          <span className="chevron">{open ? '▾' : '▸'}</span>
        </button>
        {filePath && isAttachableLocalPath(filePath) && onOpenFilePreview ? (
          <button
            type="button"
            className="tool-preview-btn"
            title={uiText("预览 {0}", [filePath])}
            onClick={() =>
              onOpenFilePreview({
                path: filePath,
                name: filePreviewBasename(filePath),
                source: 'tool',
                toolName: block.name
              })
            }
          >
            {uiText("预览")}</button>
        ) : null}
      </div>
      {open && (
        <div className="tool-body">
          {block.input && (
            <div className="io in">
              <span className="io-label">{uiText("输入")}</span>
              <MdOrPre text={block.input} className="io-md" onOpenFilePreview={onOpenFilePreview} />
            </div>
          )}
          {block.output && (
            <div className="io out">
              <span className="io-label">{uiText("输出")}</span>
              <MdOrPre text={block.output} className="io-md" onOpenFilePreview={onOpenFilePreview} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CommandBlock({
  block,
  onOpenFilePreview,
  markdownImagePaths
}: {
  block: Extract<ChatBlock, { kind: 'command' }>
  onOpenFilePreview?: (target: FilePreviewTarget) => void
  markdownImagePaths?: Set<string>
}): JSX.Element {
  useUiLocale()
  const hasBody = Boolean(block.output)
  const [open, setOpen] = useState(block.status === 'running' || hasBody)
  const shownImages = useMemo(() => {
    if (block.status === 'error') return []
    if (typeof block.exitCode === 'number' && block.exitCode !== 0) return []
    const blob = `${block.command || ''}\n${block.output || ''}`
    const remote = extractRemoteImageUrls(block.output || '').map((url) => ({
      src: url,
      caption: url,
      href: url,
      localPath: ''
    }))
    const local = extractLocalImagePaths(blob)
      .filter((path) => !markdownImagePaths?.has(canonicalLocalPath(path)))
      .map((path) => ({
        src: attachmentLocalUrl(path),
        caption: path,
        href: '',
        localPath: path
      }))
    return [...remote, ...local]
  }, [block.command, block.output, block.status, block.exitCode, markdownImagePaths])
  const openLocal = (path: string): void => {
    if (!onOpenFilePreview) return
    onOpenFilePreview({
      path,
      name: filePreviewBasename(path),
      source: 'command'
    })
  }
  const openRemote = (url: string): void => {
    if (!onOpenFilePreview) return
    onOpenFilePreview({
      path: url,
      remoteUrl: url,
      name: filePreviewBasename(url.split('?')[0]) || '图片',
      source: 'command',
      mime: 'image/*'
    })
  }
  return (
    <div className={`command status-${block.status}`}>
      <button
        type="button"
        className="command-head"
        disabled={!hasBody && block.status !== 'running'}
        onClick={() => (hasBody || block.status === 'running') && setOpen((o) => !o)}
      >
        {statusDot(block.status)}
        <span className="prompt-sign">$</span>
        <code className="command-text">{block.command}</code>
        {block.status === 'running' && <span className="spinner" />}
        {typeof block.exitCode === 'number' && (
          <span className={`exit ${block.exitCode === 0 ? 'ok' : 'bad'}`}>
            exit {block.exitCode}
          </span>
        )}
        {hasBody ? <span className="chevron">{open ? '▾' : '▸'}</span> : null}
      </button>
      {open && block.output && (
        <MdOrPre text={block.output} className="command-output" onOpenFilePreview={onOpenFilePreview} />
      )}
      {shownImages.length > 0 ? (
        <div className="command-images">
          {shownImages.map((img) => (
            <figure key={img.src} className="command-image">
              <img
                src={img.src}
                alt={uiText("生成的图片")}
                loading="lazy"
                style={
                  onOpenFilePreview && (img.localPath || img.href)
                    ? { cursor: 'zoom-in' }
                    : undefined
                }
                onClick={
                  onOpenFilePreview
                    ? () => {
                        if (img.localPath) openLocal(img.localPath)
                        else if (img.href) openRemote(img.href)
                      }
                    : undefined
                }
                onError={(e) => {
                  const el = e.currentTarget
                  el.hidden = true
                  const cap = el.parentElement?.querySelector('figcaption')
                  if (cap && !cap.dataset.missing) {
                    cap.dataset.missing = '1'
                    cap.textContent = img.localPath
                      ? `图片文件不存在：${img.localPath}`
                      : '图片加载失败'
                  }
                }}
              />
              <figcaption>
                {img.href ? (
                  <a href={img.href} target="_blank" rel="noreferrer noopener">
                    {img.caption}
                  </a>
                ) : img.localPath && onOpenFilePreview ? (
                  <button type="button" className="linkish" onClick={() => openLocal(img.localPath)}>
                    {img.caption}
                  </button>
                ) : (
                  img.caption
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  )
}
