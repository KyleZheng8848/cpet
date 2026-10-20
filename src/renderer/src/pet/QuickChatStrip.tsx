import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '@shared/types'
import { TypingDots } from '../TypingDots'
import { createScrollFollow } from '../scrollFollow'
import { isTypingTarget } from '@shared/typingTarget'
import { attachmentsFromDroppedFiles } from '../lib/dropFiles'
import { classifyAttachmentMedia } from '@shared/attachmentMedia'
import {
  isNativeAudioMedia,
  isNativeVideoMedia,
  isNativeVisionMedia,
  mediaSendHint,
  nativeSizeLimit,
  oversizedMediaHint,
  unsupportedMediaHint
} from '@shared/multimodal'
import { startSpeechCapture, type SpeechCapture } from '../chat/speechCapture'
import { MarkdownHtml } from '../chat/MarkdownHtml'
import { startWebSpeechDictation, webSpeechAvailable, type WebSpeechSession } from './webSpeechDictation'

export type QuickChatSession = {
  conversationId: string
  title: string
  draft?: string
}

function isImageAttachment(a: ChatAttachment): boolean {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path || a.name || '')
}

async function withPreview(list: ChatAttachment[]): Promise<ChatAttachment[]> {
  return Promise.all(
    list.map(async (a) => {
      if (a.preview) return a
      if (!isImageAttachment(a)) return a
      const preview = await window.petApi.previewAttachment(a.path)
      return preview ? { ...a, preview } : a
    })
  )
}

async function blobToTempAttachment(blob: Blob, name: string): Promise<ChatAttachment | null> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return window.petApi.saveTempAttachment({
    name,
    base64: btoa(binary),
    mime: blob.type || undefined
  })
}

/**
 * 宠边气泡：回答中看提问 + 正文 + 暂停；空闲才露出续问输入。
 * 快捷键：Enter 发送 · Esc 关闭/暂停 · ⌘M 语音 · ⌘. 暂停
 */
export function QuickChatStrip({
  session,
  autoSend,
  autoListen,
  busy,
  ask,
  askAttachments,
  reply,
  status,
  onClose,
  onSend,
  onStop,
  onOpenFull,
  onAutoListenDone
}: {
  session: QuickChatSession
  autoSend: boolean
  autoListen?: boolean
  busy?: boolean
  ask?: string
  askAttachments?: Array<{ name: string }>
  reply?: string
  status?: string
  onClose: () => void
  onSend: (text: string, attachments: ChatAttachment[]) => void
  onStop?: () => void
  onOpenFull?: () => void
  onAutoListenDone?: () => void
}): JSX.Element {
  useUiLocale()
  const [text, setText] = useState(session.draft || '')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [listening, setListening] = useState(false)
  const [nativeOk, setNativeOk] = useState(false)
  /** 避免 webOk 先就绪就抢跑浏览器听写（国内常 network）。 */
  const [nativeChecked, setNativeChecked] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const replyScrollRef = useRef<HTMLDivElement>(null)
  const replyFollowRef = useRef<ReturnType<typeof createScrollFollow> | null>(null)
  const captureRef = useRef<SpeechCapture | null>(null)
  const webRef = useRef<WebSpeechSession | null>(null)
  const listeningRef = useRef(false)
  const offDictationRef = useRef<(() => void) | null>(null)
  const finalBuf = useRef('')
  const autoListenTried = useRef(false)
  const webOk = webSpeechAvailable()
  const micOk = nativeOk || webOk

  useEffect(() => {
    setText(session.draft || '')
  }, [session.conversationId, session.draft])

  useEffect(() => {
    const follow = createScrollFollow(() => replyScrollRef.current, {
      pxPerSec: 160,
      nearBottomPx: 48
    })
    replyFollowRef.current = follow
    return () => {
      follow.destroy()
      replyFollowRef.current = null
    }
  }, [])

  const wasBusyRef = useRef(false)
  // 仅回答中慢速追底；人手动上滑 / 回答结束 → 停
  useLayoutEffect(() => {
    const follow = replyFollowRef.current
    if (!follow) return
    if (busy) {
      if (!wasBusyRef.current) {
        follow.resume()
        follow.snapToBottom()
      }
      if (follow.isFollowing()) follow.kick()
    } else if (wasBusyRef.current) {
      follow.finish()
    }
    wasBusyRef.current = !!busy
  }, [reply, busy, status])

  useEffect(() => {
    void window.petApi.dictationAvailable().then((ok) => {
      setNativeOk(ok)
      setNativeChecked(true)
    })
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      const ae = document.activeElement
      if (ae && ae !== inputRef.current && isTypingTarget(ae)) return
      inputRef.current?.focus()
    }, 40)
    return () => window.clearTimeout(t)
    // 只在打开这条会话时落一次焦点；busy 翻转不得把用户从别处拽回来
  }, [session.conversationId])

  useEffect(() => {
    return () => {
      listeningRef.current = false
      captureRef.current?.stop()
      captureRef.current = null
      webRef.current?.stop()
      webRef.current = null
      offDictationRef.current?.()
      offDictationRef.current = null
      window.petApi.stopLiveDictation()
    }
  }, [])

  async function addAttachments(list: ChatAttachment[]): Promise<void> {
    if (!list.length) return
    const enriched = await withPreview(list)
    setAttachments((prev) => {
      const seen = new Set(prev.map((p) => p.path))
      const next = [...prev]
      for (const a of enriched) {
        if (!seen.has(a.path)) {
          seen.add(a.path)
          next.push(a)
        }
      }
      return next.slice(0, 8)
    })
    setHint(uiText("已添加附件"))
    window.setTimeout(() => setHint((h) => (h === '已添加附件' ? null : h)), 1600)
  }

  async function ingestLocalFiles(files: File[]): Promise<void> {
    if (!files.length) return
    const list = await attachmentsFromDroppedFiles(files)
    if (list.length) await addAttachments(list)
  }

  async function onPaste(e: React.ClipboardEvent<HTMLInputElement>): Promise<void> {
    if (busy) return
    const clipFiles = Array.from(e.clipboardData?.files || [])
    if (clipFiles.length) {
      e.preventDefault()
      await ingestLocalFiles(clipFiles)
      return
    }
    const items = e.clipboardData?.items
    if (!items) return
    const tasks: Promise<void>[] = []
    for (const item of Array.from(items)) {
      if (!item.type || item.kind !== 'file') continue
      const blob = item.getAsFile()
      if (!blob) continue
      e.preventDefault()
      tasks.push(
        (async () => {
          const saved = await blobToTempAttachment(
            blob,
            blob.name || `paste-${Date.now()}.bin`
          )
          if (saved) await addAttachments([saved])
        })()
      )
    }
    if (tasks.length) await Promise.all(tasks)
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    await ingestLocalFiles(Array.from(e.dataTransfer.files || []))
  }

  function submit(raw?: string): void {
    if (busy) return
    const v = (raw ?? text).trim()
    if (!v && !attachments.length) return
    const atts = attachments
    onSend(v, atts)
    setText('')
    setAttachments([])
    setHint(null)
    setDragOver(false)
  }

  function cleanupListen(): void {
    listeningRef.current = false
    setListening(false)
    captureRef.current?.stop()
    captureRef.current = null
    webRef.current?.stop()
    webRef.current = null
    offDictationRef.current?.()
    offDictationRef.current = null
    window.petApi.stopLiveDictation()
  }

  async function startNativeListen(): Promise<boolean> {
    const result = await window.petApi.startLiveDictation()
    if (!result.ok) {
      setHint(result.error || '本机听写启动失败')
      return false
    }

    listeningRef.current = true
    setListening(true)
    offDictationRef.current?.()
    offDictationRef.current = window.petApi.onDictationEvent((ev) => {
      if (!listeningRef.current && ev.type !== 'end' && ev.type !== 'error') return
      if (ev.type === 'partial' || ev.type === 'final') {
        const base = finalBuf.current
        const next = (base ? `${base} ` : '') + ev.text
        if (ev.type === 'final') finalBuf.current = next
        setText(next)
        return
      }
      if (ev.type === 'error') {
        cleanupListen()
        setHint(ev.message || '听写失败')
        return
      }
      const done = (ev.text || finalBuf.current || '').trim()
      cleanupListen()
      if (done) {
        setText(done)
        if (autoSend) submit(done)
        else setHint(uiText("说完了，按 Enter 发送"))
      } else if (ev.reason === 'nospeech') {
        setHint(uiText("没有听清，再说一次或打字"))
      } else {
        setHint(uiText("没听清，再说一次"))
      }
    })

    try {
      const capture = await startSpeechCapture((pcm) => {
        if (!listeningRef.current) return
        window.petApi.pushLiveDictationPcm(pcm)
      })
      if (!listeningRef.current) {
        capture.stop()
        return true
      }
      captureRef.current = capture
      return true
    } catch {
      cleanupListen()
      setHint(uiText("无法打开麦克风：系统设置 → 隐私与安全性 → 麦克风，允许 CPET"))
      return false
    }
  }

  function startWebListen(): boolean {
    if (!webOk) return false
    setHint(uiText("在听…"))
    finalBuf.current = text.trim()
    listeningRef.current = true
    setListening(true)
    webRef.current = startWebSpeechDictation({
      onPartial: (t) => setText(t),
      onFinal: (t) => {
        finalBuf.current = t
        setText(t)
      },
      onError: (message) => {
        cleanupListen()
        setHint(message)
      },
      onEnd: (reason) => {
        const done = (finalBuf.current || text || '').trim()
        cleanupListen()
        if (done) {
          setText(done)
          if (autoSend) submit(done)
          else setHint(uiText("说完了，按 Enter 发送"))
        } else if (reason === 'nospeech') {
          setHint(uiText("没有听清，再说一次或打字"))
        }
      }
    })
    return true
  }

  async function startListen(): Promise<void> {
    if (listeningRef.current || busy) return

    let useNative = nativeOk
    if (!nativeChecked) {
      useNative = await window.petApi.dictationAvailable()
      setNativeOk(useNative)
      setNativeChecked(true)
    }
    if (!useNative && !webOk) {
      setHint(uiText("语音不可用，请直接打字"))
      return
    }

    setHint(uiText("在听…"))
    finalBuf.current = text.trim()
    // 正式包优先本机 Speech；失败不要静默落到谷歌 Web Speech（国内常 network）
    if (useNative) {
      const ok = await startNativeListen()
      if (ok) return
      return
    }
    if (startWebListen()) return
    setHint(uiText("语音不可用，请直接打字"))
  }

  function stopListen(): void {
    cleanupListen()
    setHint(null)
  }

  useEffect(() => {
    // 必须等 dictationAvailable 回来，否则会先走浏览器听写 → network
    if (!nativeChecked || busy || !autoListen || !micOk || autoListenTried.current) return
    autoListenTried.current = true
    const t = window.setTimeout(() => {
      void startListen().finally(() => onAutoListenDone?.())
    }, 120)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen, micOk, busy, nativeChecked])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inStrip = !!(target && rootRef.current?.contains(target))
      if (!inStrip && target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        if (listeningRef.current) {
          stopListen()
          return
        }
        if (busy && onStop) {
          onStop()
          return
        }
        onClose()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        if (busy) return
        e.preventDefault()
        if (listeningRef.current) stopListen()
        else void startListen()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '.' && busy && onStop) {
        e.preventDefault()
        onStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, onClose, onStop])

  const replyText = (reply || '').trim()
  const askText = (ask || '').trim()
  const askFiles = askAttachments || []
  const showAsk = !!(askText || askFiles.length)
  const showAnswer = !!(replyText || busy || status || showAsk)
  const nativeCounts = { image: 0, audio: 0, video: 0 }
  const unsupportedCounts = { image: 0, audio: 0, video: 0 }
  const oversizedCounts = { image: 0, audio: 0, video: 0 }
  for (const a of attachments) {
    const key = a.path || a.name
    const kind = classifyAttachmentMedia(key, a.mime)
    const oversized =
      typeof a.size === 'number' &&
      (kind === 'image' || kind === 'audio' || kind === 'video') &&
      a.size > nativeSizeLimit(kind)
    if (kind === 'image') {
      if (!isNativeVisionMedia(key, a.mime)) unsupportedCounts.image++
      else if (oversized) oversizedCounts.image++
      else nativeCounts.image++
    } else if (kind === 'audio') {
      if (!isNativeAudioMedia(key, a.mime)) unsupportedCounts.audio++
      else if (oversized) oversizedCounts.audio++
      else nativeCounts.audio++
    } else if (kind === 'video') {
      if (!isNativeVideoMedia(key, a.mime)) unsupportedCounts.video++
      else if (oversized) oversizedCounts.video++
      else nativeCounts.video++
    }
  }
  const mediaHint = [
    mediaSendHint('mixed', nativeCounts),
    oversizedMediaHint(oversizedCounts),
    unsupportedMediaHint(unsupportedCounts)
  ]
    .filter(Boolean)
    .join(' · ')
  const canSend = !!(text.trim() || attachments.length)
  const openFullTitle = `打开「${session.title}」完整对话`

  /** 点气泡进对话窗对应任务；跳过按钮/输入，划选文字时也不跳。 */
  function openFullFromBubble(e: React.MouseEvent): void {
    if (!onOpenFull) return
    const t = e.target as HTMLElement
    if (t.closest('button, input, textarea, a')) return
    const sel = window.getSelection()?.toString()
    if (sel && sel.length > 0) return
    onOpenFull()
  }

  return (
    <div
      ref={rootRef}
      className={`quick-chat-strip${showAnswer ? ' has-answer' : ' ask-only'}${busy ? ' is-busy' : ''}${dragOver ? ' is-drag-over' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onDragEnter={(e) => {
        if (busy) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragOver={(e) => {
        if (busy) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragOver(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="quick-chat-strip-head">
        <span
          className={`quick-chat-phase${onOpenFull ? ' is-openable' : ''}`}
          role={onOpenFull ? 'button' : undefined}
          title={onOpenFull ? openFullTitle : undefined}
          onClick={onOpenFull ? openFullFromBubble : undefined}
        >
          {busy ? uiText("回答中") : showAnswer ? uiText("回答") : uiText("快问")}
        </span>
        <button type="button" className="quick-chat-x" aria-label={uiText("关闭")} title={uiText("关闭 Esc")} onClick={onClose}>
          ×
        </button>
      </div>

      {showAnswer ? (
        <div
          className={`quick-chat-body${onOpenFull ? ' is-openable' : ''}`}
          title={onOpenFull ? openFullTitle : undefined}
          onClick={onOpenFull ? openFullFromBubble : undefined}
        >
          {showAsk ? (
            <div className="quick-chat-ask-block">
              {askText ? <p className="quick-chat-ask">{askText}</p> : null}
              {askFiles.length > 0 ? (
                <div className="quick-chat-ask-files">
                  {askFiles.map((a) => (
                    <span key={a.name} className="quick-chat-ask-file">
                      {a.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            className="quick-chat-reply"
            ref={replyScrollRef}
            onScroll={() => replyFollowRef.current?.onScroll()}
          >
            {replyText ? (
              busy ? (
                // 流式中用纯文本，避免半截 Markdown 每帧重解析
                <p className="quick-chat-reply-text">{replyText}</p>
              ) : (
                <MarkdownHtml text={replyText} className="quick-chat-md md" />
              )
            ) : !busy && status ? (
              <p className="quick-chat-reply-text">{status}</p>
            ) : null}
            {busy ? <TypingDots trailing={!!replyText} className="quick-chat-typing" /> : null}
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="quick-chat-busy-bar">
          <button
            type="button"
            className="quick-chat-pause"
            onClick={onStop}
            title={uiText("暂停 Esc")}
          >
            {uiText("暂停")}</button>
        </div>
      ) : (
        <>
          {attachments.length > 0 ? (
            <div className="quick-chat-attach-list">
              {attachments.map((a) => (
                <div className="quick-chat-attach-chip" key={a.path} title={uiText("{0}\n点击系统打开 · {1}", [a.name, a.path])}>
                  <button
                    type="button"
                    className="quick-chat-attach-open"
                    onClick={() => void window.petApi.openAttachmentPath(a.path)}
                  >
                    {a.preview ? (
                      <img className="quick-chat-attach-thumb" src={a.preview} alt="" />
                    ) : (
                      <span className="quick-chat-attach-icon" aria-hidden>
                        📄
                      </span>
                    )}
                    <span className="quick-chat-attach-name">{a.name}</span>
                  </button>
                  <button
                    type="button"
                    className="quick-chat-attach-x"
                    aria-label={uiText("移除 {0}", [a.name])}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="quick-chat-composer">
            <input
              ref={inputRef}
              className="quick-chat-input"
              value={text}
              placeholder={showAnswer ? uiText("接着说…") : uiText("说点什么…")}
              title={uiText("粘贴或拖入可加附件 · Enter 发送 · Esc 关闭")}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => void onPaste(e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            {micOk ? (
              <button
                type="button"
                className={`quick-chat-mic${listening ? ' on' : ''}`}
                title={listening ? uiText("停止语音 ⌘M") : uiText("语音 ⌘M")}
                onClick={() => (listening ? stopListen() : void startListen())}
              >
                {listening ? uiText("停") : uiText("麦")}
              </button>
            ) : null}
            <button
              type="button"
              className="quick-chat-send"
              disabled={!canSend}
              onClick={() => submit()}
              title={uiText("发送 Enter")}
            >
              {uiText("发送")}</button>
          </div>
          {mediaHint ? <p className="quick-chat-hint">{mediaHint}</p> : null}
          {hint ? <p className="quick-chat-hint">{hint}</p> : null}
        </>
      )}
    </div>
  )
}
