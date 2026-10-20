import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AgentBackend, AgentSkill, ChatAttachment } from '@shared/types'
import { getBackendInfo, skillUsableOnEngine } from '@shared/types'
import { classifyAttachmentMedia, skillIdsForAttachments } from '@shared/attachmentMedia'
import {
  isNativeAudioMedia,
  isNativeVideoMedia,
  isNativeVisionMedia,
  mediaSendHint,
  nativeSizeLimit,
  oversizedMediaHint,
  unsupportedMediaHint,
  type ImageSendMode
} from '@shared/multimodal'
import type { FilePreviewTarget } from '@shared/filePreview'
import { canonicalLocalPath } from '@shared/filePreview'
import { isTypingTarget } from '@shared/typingTarget'
import { attachmentsFromDroppedFiles } from '../lib/dropFiles'
import { ThinkingToggle } from './DetailToggles'
import { IconAttach, IconMic, IconSlash } from './icons'
import { startSpeechCapture, type SpeechCapture } from './speechCapture'

/** 把听写结果接到已有正文后（中文紧挨，英文/数字间补空格）。 */
function joinSpeech(prefix: string, speech: string): string {
  const s = speech.trim()
  if (!s) return prefix
  if (!prefix) return s
  if (/\s$/.test(prefix)) return prefix + s
  const left = prefix[prefix.length - 1] || ''
  const right = s[0] || ''
  const needSpace =
    /[a-zA-Z0-9]$/.test(left) && /^[a-zA-Z0-9]/.test(right)
  return needSpace ? `${prefix} ${s}` : prefix + s
}

export interface ComposerDraft {
  text: string
  attachments: ChatAttachment[]
  skills?: string[]
  /** 变化时强制回填（即使文本相同）。 */
  nonce: number
}

interface Props {
  busy: boolean
  draft?: ComposerDraft | null
  /** 输入变化时回写给上层保存（切面板/切任务时 Composer 会卸载，草稿不能只存在这里）。 */
  onDraftChange?: (draft: Omit<ComposerDraft, 'nonce'>) => void
  /** 当前工作目录，用于扫描项目技能。 */
  cwd?: string
  onSend: (prompt: string, attachments: ChatAttachment[], skills: string[]) => void
  onStop: () => void
  /** 点击附件芯片 → 右侧预览该文件。 */
  onPreviewFile?: (target: FilePreviewTarget) => void
  inputRef?: RefObject<HTMLTextAreaElement>
  /** 对比任务：已勾选回答时，发送/Enter 走汇总（有输入用用户原话，无输入用默认）。 */
  summary?: {
    selectedCount: number
    onSummary: (note?: string) => void
  } | null
  /** 直连深度思考（仅自定义 API 任务显示）。 */
  thinking?: {
    on: boolean
    disabled?: boolean
    onChange: (next: boolean) => void
  } | null
  /** 覆盖默认输入框提示（如 RSS）。 */
  placeholder?: string
  /** 当前任务怎么把图片交给模型（直连 / Codex / 路径 Read）。 */
  imageSendMode?: ImageSendMode
  /** 收起技能 / 附件 / 听写等工具，只留输入和发送。 */
  toolsHidden?: boolean
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

const SOURCE_LABEL: Record<AgentSkill['source'], string> = {
  project: '项目',
  user: '用户',
  bundled: '内置',
  builtin: '名录'
}

export function Composer({
  busy,
  draft,
  onDraftChange,
  cwd,
  onSend,
  onStop,
  onPreviewFile,
  inputRef,
  summary,
  thinking,
  placeholder,
  imageSendMode,
  toolsHidden = false
}: Props): JSX.Element {
  useUiLocale()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [engine, setEngine] = useState<AgentBackend>('cursor')
  const [selected, setSelected] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [listening, setListening] = useState(false)
  const [speechHint, setSpeechHint] = useState<string | null>(null)
  const [speechSupported, setSpeechSupported] = useState(false)
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = inputRef ?? internalRef
  const pickerRef = useRef<HTMLDivElement>(null)
  const listeningRef = useRef(false)
  const captureRef = useRef<SpeechCapture | null>(null)
  const speechPrefixRef = useRef('')
  const speechErrorRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value
  const draftCbRef = useRef(onDraftChange)
  draftCbRef.current = onDraftChange
  /** 首次运行让位给下面的 draft 回填，否则会用初始空值把已存草稿删掉。 */
  const draftReportedRef = useRef(false)
  /** 刚发送过：忽略紧随其后的草稿回填，避免父级重渲染把输入框写回。 */
  const suppressDraftRef = useRef(false)

  /** 单行起步；内容多了再长高（上限见 CSS max-height）。 */
  function autoGrow(el: HTMLTextAreaElement): void {
    const max = Math.min(window.innerHeight * 0.4, 240)
    const min = 30
    // flex 同行布局下先压矮再量，避免量到被撑死的高度
    el.style.height = '0px'
    const next = Math.min(Math.max(el.scrollHeight, min), max)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }

  useEffect(() => {
    let cancelled = false
    void window.petApi.listSkills(cwd).then((list) => {
      if (!cancelled) setSkills(list)
    })
    return () => {
      cancelled = true
    }
  }, [cwd])

  // 引擎决定技能能不能生效；顶栏随时可切，每次开选单都重取
  useEffect(() => {
    let cancelled = false
    void window.petApi.getSettings().then((s) => {
      if (!cancelled) setEngine(s.agentBackend ?? 'cursor')
    })
    return () => {
      cancelled = true
    }
  }, [pickerOpen])

  useEffect(() => {
    let cancelled = false
    void window.petApi.dictationAvailable().then((ok) => {
      if (!cancelled) setSpeechSupported(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 发送后父级清掉草稿（nonce 变 undefined）：强制清空，避免流式重渲染写回
    if (!draft) {
      if (suppressDraftRef.current) {
        setValue('')
        setAttachments([])
        setSelected([])
        speechPrefixRef.current = ''
        if (textareaRef.current) autoGrow(textareaRef.current)
        suppressDraftRef.current = false
      }
      return
    }
    if (suppressDraftRef.current) {
      suppressDraftRef.current = false
      return
    }
    if (listeningRef.current) stopListening()
    setValue(draft.text)
    setAttachments(draft.attachments)
    setSelected(draft.skills ?? [])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      autoGrow(el)
      // 已经在打字：只同步高度，不要抢光标/打断输入法
      if (el === document.activeElement || isTypingTarget(document.activeElement)) return
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    })
  }, [draft?.nonce])

  useEffect(() => {
    if (!draftReportedRef.current) {
      draftReportedRef.current = true
      return
    }
    draftCbRef.current?.({ text: value, attachments, skills: selected })
  }, [value, attachments, selected])

  // 听写/草稿回填等非 onChange 路径也要跟高
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (el) autoGrow(el)
  }, [value])

  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (pickerRef.current?.contains(e.target as Node)) return
      setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  useEffect(() => {
    const unsub = window.petApi.onDictationEvent((ev) => {
      if (!listeningRef.current && ev.type !== 'end' && ev.type !== 'error') return
      if (ev.type === 'partial' || ev.type === 'final') {
        applySpeechText(ev.text)
        return
      }
      if (ev.type === 'error') {
        // 出错必须停听并露出原因（旧逻辑只 setHint 且 listening 时被 UI 挡住）
        captureRef.current?.stop()
        captureRef.current = null
        listeningRef.current = false
        setListening(false)
        speechErrorRef.current = true
        window.petApi.stopLiveDictation()
        setSpeechHint(ev.message)
        return
      }
      // end：静音 / 手动停 / 超时
      captureRef.current?.stop()
      captureRef.current = null
      listeningRef.current = false
      setListening(false)
      if (ev.text) applySpeechText(ev.text)
      if (ev.reason === 'nospeech' && !ev.text.trim()) {
        setSpeechHint('没有识别到内容，请再试一次（需允许麦克风与语音识别）')
      } else if (!speechErrorRef.current) {
        setSpeechHint(null)
      }
      speechErrorRef.current = false
    })
    return () => {
      unsub()
      if (listeningRef.current) {
        listeningRef.current = false
        captureRef.current?.stop()
        captureRef.current = null
        window.petApi.stopLiveDictation()
      }
    }
  }, [])

  // ⌘/Ctrl+Shift+M 切换流式听写
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !e.shiftKey || e.key.toLowerCase() !== 'm') return
      e.preventDefault()
      toggleListening()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function applySpeechText(speech: string): void {
    const next = joinSpeech(speechPrefixRef.current, speech)
    setValue(next)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      autoGrow(el)
      const len = el.value.length
      el.setSelectionRange(len, len)
    })
  }

  function stopListening(): void {
    if (!listeningRef.current && !captureRef.current) return
    listeningRef.current = false
    setListening(false)
    captureRef.current?.stop()
    captureRef.current = null
    window.petApi.stopLiveDictation()
  }

  async function startListening(): Promise<void> {
    if (!speechSupported) {
      setSpeechHint('语音输入不可用（需 macOS 听写组件）')
      return
    }
    if (listeningRef.current) return
    setSpeechHint(null)
    speechErrorRef.current = false
    speechPrefixRef.current = valueRef.current

    const result = await window.petApi.startLiveDictation()
    if (!result.ok) {
      setSpeechHint(result.error)
      return
    }

    listeningRef.current = true
    setListening(true)
    try {
      const capture = await startSpeechCapture((pcm) => {
        if (!listeningRef.current) return
        window.petApi.pushLiveDictationPcm(pcm)
      })
      if (!listeningRef.current) {
        capture.stop()
        return
      }
      captureRef.current = capture
    } catch (err) {
      window.petApi.stopLiveDictation()
      listeningRef.current = false
      setListening(false)
      const msg = err instanceof Error ? err.message : String(err)
      if (/Permission|NotAllowed|denied/i.test(msg)) {
        setSpeechHint('麦克风权限被拒绝：系统设置 → 隐私与安全性 → 麦克风，允许 CPET')
      } else {
        setSpeechHint('无法打开麦克风，请检查系统权限')
      }
    }
  }

  function toggleListening(): void {
    if (listeningRef.current) stopListening()
    else void startListening()
  }

  /** 本机没有 SKILL.md 正文的技能，除 Cursor 外都是空操作，不给选。 */
  const usable = useMemo(
    () => skills.filter((s) => skillUsableOnEngine(s, engine)),
    [skills, engine]
  )
  const hiddenCount = skills.length - usable.length

  useEffect(() => {
    if (!skills.length) return
    const ok = new Set(usable.map((s) => s.id))
    setSelected((prev) => (prev.every((id) => ok.has(id)) ? prev : prev.filter((id) => ok.has(id))))
  }, [usable, skills.length])

  // 按附件推断的 skill（docx/xlsx/…）不在输入区展示；发送时由 Chat 再补进引擎
  useEffect(() => {
    const auto = new Set(skillIdsForAttachments(attachments))
    if (!auto.size) return
    setSelected((prev) => {
      const next = prev.filter((id) => !auto.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [attachments])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return usable.slice(0, 40)
    return usable
      .filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q)
      )
      .slice(0, 40)
  }, [usable, query])

  async function addAttachments(list: ChatAttachment[]): Promise<void> {
    if (!list.length) return
    const enriched = await withPreview(list)
    const now = Date.now()
    const stamped = enriched.map((a) => ({ ...a, addedAt: a.addedAt || now }))
    const existing = new Set(attachments.map((a) => a.path))
    const newcomers = stamped.filter((a) => !existing.has(a.path))
    setAttachments((prev) => {
      const seen = new Set(prev.map((p) => p.path))
      const next = [...prev]
      for (const a of stamped) {
        if (seen.has(a.path)) continue
        seen.add(a.path)
        next.push(a)
      }
      return next.slice(0, 12)
    })
    const toPreview = newcomers[newcomers.length - 1] || stamped[stamped.length - 1]
    if (toPreview && onPreviewFile) {
      onPreviewFile({
        path: toPreview.path,
        name: toPreview.name,
        mime: toPreview.mime,
        source: 'attachment',
        addedAt: toPreview.addedAt
      })
    }
  }

  async function pickFiles(): Promise<void> {
    const list = await window.petApi.pickAttachments()
    await addAttachments(list)
  }

  function removeAttachment(path: string): void {
    const key = canonicalLocalPath(path)
    setAttachments((prev) => prev.filter((a) => canonicalLocalPath(a.path) !== key))
  }

  function toggleSkill(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /** 去掉输入末尾的 /token（含仅 `/`），选中技能后还给用户干净输入区。 */
  function stripTrailingSkillToken(text: string): string {
    const next = text.replace(/(^|\s)\/[a-z0-9_-]*$/i, (_m, lead: string) =>
      /\s/.test(lead) ? lead : ''
    )
    return next.replace(/[ \t]+$/, '')
  }

  /** 选定技能：写入 chip、清掉 / 联想片段、立刻收起选单（再选请再按 /）。 */
  function pickSkill(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setValue((prev) => {
      const next = stripTrailingSkillToken(prev)
      if (textareaRef.current) {
        textareaRef.current.value = next
        autoGrow(textareaRef.current)
      }
      return next
    })
    setPickerOpen(false)
    setQuery('')
    queueMicrotask(() => textareaRef.current?.focus())
  }

  function clearComposer(): void {
    suppressDraftRef.current = true
    speechPrefixRef.current = ''
    setValue('')
    setAttachments([])
    setSelected([])
    setPickerOpen(false)
    setQuery('')
    if (textareaRef.current) autoGrow(textareaRef.current)
    draftCbRef.current?.({ text: '', attachments: [], skills: [] })
  }

  function submit(): void {
    if (listeningRef.current) stopListening()
    // 忙碌时：Enter / ↑ 加入暂存队列（由 Chat.onSend 处理），不再误触停止
    if (busy) {
      const text = value.trim()
      if (!text && !attachments.length && !selected.length) return
      const prompt = text || (selected.length ? '按所选技能执行。' : '请查看这些附件并给出说明。')
      const atts = attachments
      const skills = selected
      clearComposer()
      onSend(prompt, atts, skills)
      return
    }
    // 对比：勾选了回答 → 与发送同一套操作（Enter / ↑）
    if (summary && summary.selectedCount > 0) {
      const note = value.trim()
      clearComposer()
      summary.onSummary(note || undefined)
      return
    }
    const text = value.trim()
    if (!text && !attachments.length && !selected.length) return
    const prompt = text || (selected.length ? '按所选技能执行。' : '请查看这些附件并给出说明。')
    const atts = attachments
    const skills = selected
    clearComposer()
    onSend(prompt, atts, skills)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape' && pickerOpen) {
      e.preventDefault()
      setPickerOpen(false)
      setQuery('')
      return
    }
    // 技能表打开时：Enter 选定当前第一项，禁止误发送
    if (
      pickerOpen &&
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault()
      if (filtered[0]) pickSkill(filtered[0].id)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const next = e.target.value
    setValue(next)
    autoGrow(e.target)
    // 空输入 `/`，或有正文时「空格+/」→ 打开技能表（不再用尾部空格误唤起）
    const m = next.match(/(?:^|\s)\/([a-z0-9_-]*)$/i)
    if (m) {
      setPickerOpen(true)
      setQuery(m[1] || '')
      return
    }
    if (pickerOpen) {
      setPickerOpen(false)
      setQuery('')
    }
  }

  async function saveBlobAsAttachment(blob: Blob, name: string): Promise<ChatAttachment | null> {
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return window.petApi.saveTempAttachment({
      name: name || `paste-${Date.now()}.bin`,
      base64: btoa(binary),
      mime: blob.type || undefined
    })
  }

  async function ingestLocalFiles(files: File[]): Promise<void> {
    if (!files.length) return
    const list = await attachmentsFromDroppedFiles(files)
    if (list.length) await addAttachments(list)
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
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
      // 剪贴板二进制项：图片为主，也接受其它有 getAsFile 的类型
      if (!item.type || item.kind !== 'file') continue
      const blob = item.getAsFile()
      if (!blob) continue
      e.preventDefault()
      tasks.push(
        (async () => {
          const ext =
            blob.type.startsWith('image/')
              ? blob.type.includes('jpeg')
                ? '.jpg'
                : blob.type.includes('png')
                  ? '.png'
                  : '.bin'
              : ''
          const saved = await saveBlobAsAttachment(
            blob,
            blob.name || `paste-${Date.now()}${ext || '.bin'}`
          )
          if (saved) await addAttachments([saved])
        })()
      )
    }
    if (tasks.length) await Promise.all(tasks)
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    await ingestLocalFiles(Array.from(e.dataTransfer.files || []))
  }

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
  const visionHint = [
    imageSendMode ? mediaSendHint(imageSendMode, nativeCounts) : '',
    oversizedMediaHint(oversizedCounts),
    unsupportedMediaHint(unsupportedCounts)
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={`composer${dragOver ? ' drag-over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {speechHint && (
        <div className="composer-speech-hint" role="status">
          {speechHint}
        </div>
      )}
      {listening && !speechHint && (
        <div className="composer-speech-hint is-live" role="status">
          {uiText("正在听写… 字会陆续出现；说完停一会自动结束（⌘⇧M / 再点可停）")}</div>
      )}

      {visionHint ? (
        <div className="composer-vision-hint" role="status">
          {visionHint}
        </div>
      ) : null}

      {summary && summary.selectedCount > 0 && (
        <div className="composer-summary-hint" role="status">
          <strong>{uiText("将汇总")}{' '}{summary.selectedCount} {' '}{uiText("条候选")}</strong>
          <span>
            {uiText("· Enter / 发送会把勾选回复折进汇总请求（对话里默认折叠，可点开原文）")}{value.trim() ? uiText(" · 按你下方输入取舍") : uiText(" · 无输入则用默认取舍")}
          </span>
        </div>
      )}

      {/* 一体壳 + 单行：工具 | 输入 | 发送；多行时输入增高、两侧贴底 */}
      <div className={`composer-shell${listening ? ' is-listening' : ''}`}>
        {(selected.length > 0 || attachments.length > 0) && (
          <div className="composer-tags">
            {selected.map((id) => (
              <button
                key={id}
                type="button"
                className="skill-chip on"
                title={uiText("移除 /{0}", [id])}
                onClick={() => toggleSkill(id)}
              >
                /{id}
                <span aria-hidden>×</span>
              </button>
            ))}
            {attachments.map((a) => (
              <div className="attach-chip" key={a.path} title={uiText("{0}\n点击右侧预览 · {1}", [a.name, a.path])}>
                <button
                  type="button"
                  className="attach-chip-open"
                  onClick={() => {
                    if (onPreviewFile) {
                      onPreviewFile({
                        path: a.path,
                        name: a.name,
                        mime: a.mime,
                        source: 'attachment'
                      })
                      return
                    }
                    void window.petApi.openAttachmentPath(a.path)
                  }}
                >
                  {a.preview ? (
                    <img className="attach-thumb" src={a.preview} alt={a.name} />
                  ) : (
                    <span className="attach-icon">📄</span>
                  )}
                  <span className="attach-name">{a.name}</span>
                </button>
                <button
                  type="button"
                  className="attach-remove"
                  aria-label={uiText("移除 {0}", [a.name])}
                  onClick={() => removeAttachment(a.path)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          {toolsHidden ? null : (
          <div className="composer-tools" ref={pickerRef}>
            <button
              type="button"
              className={`attach-btn ${pickerOpen ? 'on' : ''}`}
              title={uiText("指定技能")}
              aria-label={uiText("指定技能")}
              onClick={() => {
                setPickerOpen((v) => !v)
                setQuery('')
              }}
            >
              <IconSlash />
            </button>
            <button
              type="button"
              className="attach-btn"
              title={uiText("添加附件")}
              aria-label={uiText("添加附件")}
              onClick={() => void pickFiles()}
            >
              <IconAttach />
            </button>
            <button
              type="button"
              className={`attach-btn composer-mic${listening ? ' on' : ''}`}
              title={
                !speechSupported
                  ? uiText("语音输入不可用（需 macOS 听写组件）")
                  : speechHint ||
                    (listening
                      ? uiText("停止听写（⌘⇧M）")
                      : uiText("语音输入：流式听写，静音自动停（⌘⇧M）"))
              }
              aria-label={listening ? uiText("停止听写") : uiText("语音输入")}
              aria-pressed={listening}
              disabled={!speechSupported}
              onClick={() => toggleListening()}
            >
              <IconMic />
            </button>
            {thinking ? (
              <ThinkingToggle
                on={thinking.on}
                disabled={busy || thinking.disabled}
                onChange={thinking.onChange}
              />
            ) : null}
            {pickerOpen && (
              <div className="skill-picker" role="listbox" aria-label={uiText("技能列表")}>
                <input
                  className="skill-search"
                  placeholder={uiText("搜索技能…")}
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setPickerOpen(false)
                      textareaRef.current?.focus()
                    }
                    if (e.key === 'Enter' && filtered[0]) {
                      e.preventDefault()
                      pickSkill(filtered[0].id)
                    }
                  }}
                />
                {hiddenCount > 0 && (
                  <div className="skill-empty" role="status">
                    {uiText("已隐藏")}{hiddenCount} {uiText("个技能：本机找不到它们的 SKILL.md。")}{engine === 'cursor'
                      ? uiText("Cursor 仍可尝试用 /名称 让服务端展开。")
                      : uiText("{0} 需要本机有 SKILL.md 才能点名或注入。", [getBackendInfo(engine).shortLabel])}
                  </div>
                )}
                {engine !== 'cursor' && usable.length > 0 && (
                  <div className="skill-empty" role="status">
                    {getBackendInfo(engine).shortLabel}
                    {uiText("：默认只点名（/名 或 $名），由引擎按需加载正文；设置里可改成薄目录/全文注入。发送后看「技能」条确认。")}</div>
                )}
                <div className="skill-list">
                  {filtered.length === 0 ? (
                    <div className="skill-empty">{uiText("没有匹配的技能")}</div>
                  ) : (
                    filtered.map((s) => {
                      const on = selected.includes(s.id)
                      return (
                        <button
                          key={`${s.source}-${s.id}`}
                          type="button"
                          className={`skill-option ${on ? 'on' : ''}`}
                          role="option"
                          aria-selected={on}
                          title={s.description || s.path || s.id}
                          onClick={() => pickSkill(s.id)}
                        >
                          <span className="skill-option-name">/{s.id}</span>
                          <span className="skill-option-src">{SOURCE_LABEL[s.source]}</span>
                          {s.description && <span className="skill-option-desc">{s.description}</span>}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          )}
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder={
              busy
                ? uiText("生成中… Enter / ↑ 暂存下一条，点 ■ 停止")
                : summary && summary.selectedCount > 0
                  ? value.trim()
                    ? uiText("Enter / ↑ 按你的输入汇总已选回答")
                    : uiText("可写要求后发送；直接发送则用默认汇总")
                  : summary
                    ? uiText("问点什么…（勾选回答后，发送即汇总）")
                    : listening
                      ? uiText("正在听写…（停顿自动结束，Enter 发送）")
                      : placeholder ||
                        uiText("问点什么…（/ 技能，⌘⇧M 语音，可拖入图片，Enter 发送）")
            }
            aria-label={uiText("消息输入框")}
            aria-busy={busy}
            value={value}
            rows={1}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="composer-send-group">
            {busy ? (
              <>
                <button
                  className="send-btn will-queue"
                  onClick={submit}
                  disabled={!value.trim() && !attachments.length && !selected.length}
                  title={uiText("加入暂存队列 (Enter)")}
                  aria-label={uiText("暂存请求")}
                >
                  ↑
                </button>
                <button
                  className="send-btn stop"
                  onClick={onStop}
                  title={uiText("停止当前生成")}
                  aria-label={uiText("停止")}
                >
                  ■
                </button>
              </>
            ) : (
              <button
                className={`send-btn${summary && summary.selectedCount > 0 ? ' will-summary' : ''}`}
                onClick={submit}
                disabled={
                  summary && summary.selectedCount > 0
                    ? false
                    : !value.trim() && !attachments.length && !selected.length
                }
                title={
                  summary && summary.selectedCount > 0
                    ? value.trim()
                      ? uiText("按输入汇总已选 {0} 条 (Enter)", [summary.selectedCount])
                      : uiText("汇总已选 {0} 条 (Enter)", [summary.selectedCount])
                    : uiText("发送 (Enter)")
                }
                aria-label={
                  summary && summary.selectedCount > 0
                    ? uiText("汇总已选 {0} 条并发送", [summary.selectedCount])
                    : uiText("发送")
                }
              >
                ↑
                {summary && summary.selectedCount > 0 ? (
                  <span className="send-badge">{summary.selectedCount}</span>
                ) : null}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
