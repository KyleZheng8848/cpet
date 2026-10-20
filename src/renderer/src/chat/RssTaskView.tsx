import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type UIEventHandler
} from 'react'
import type { Conversation } from '@shared/types'
import { humanizeRssIntelError } from '@shared/agentErrors'
import { confirmDestructive, confirmDestructiveAsync } from './confirm'
import {
  rssDigestToMarkdown,
  rssEntryToMarkdown,
  safeRssExportFilename
} from '@shared/rssExport'
import {
  EMPTY_RSS_TASK,
  DEFAULT_RSS_PANE_WIDTHS,
  addRssAnalysisQuote,
  RSS_DIGEST_TEMPLATE_GROUPS,
  RSS_DIGEST_TEMPLATES,
  RSS_DIGEST_WINDOWS,
  RSS_REALTIME_FETCH_MS,
  RSS_SCORE_INTERVALS,
  applyRssBodyPatches,
  applyRssEntryScores,
  dispositionLabel,
  articleLooksLikeChrome,
  articleMissingExpectedMedia,
  articleNeedsWebHint,
  clampRssAiPct,
  clampRssListPct,
  defaultDigestCustomRange,
  entriesInTimeBounds,
  filterEntriesByDigestScoreMin,
  normalizeRssDigestScoreMin,
  rssDigestScoreMinLabel,
  entriesInDigestWindow,
  entriesNeedingScore,
  feedsMatchingOneRssFeedError,
  feedsMatchingRssFeedError,
  filterRssTaskItems,
  joinRssFeedErrors,
  splitRssFeedActionableErrors,
  summarizeRssFeedErrors,
  formatDigestDateTime,
  formatDigestRangeLabel,
  formatDigestWindow,
  groupRssEntriesByDay,
  rssDayKey,
  rssEntryTime,
  listDigestTimeChunks,
  resolveAutoDigestTimeBounds,
  resolveDigestBoundsFromRecord,
  resolveDigestTimeBounds,
  isRssDigestThreadId,
  isThinArticleHtml,
  expireStaleRssUnreadState,
  markAllRssRead,
  markRssEntryRead,
  mergeRssTaskItems,
  rssEntryDisplayHtml,
  rssEntryHasDisplayableBody,
  rssEntryHasModelBody,
  rssEntryHasSourceBody,
  rssEntryHasUsableBody,
  rssEntryIsUnread,
  rssEntryNeedsModelBody,
  rssEntrySourceHtml,
  withRssExtractHtml,
  withRssExtractPane,
  withRssModelHtml,
  newRssDigestId,
  normalizeRssDigestTemplate,
  normalizeRssPaneWidths,
  normalizeRssScoreIntervalMinutes,
  normalizeRssScoreMode,
  normalizeRssTaskFeeds,
  healRssDigestTitles,
  prependRssDigest,
  replaceRssDigest,
  reconcileRssEntrySources,
  relatedRssForEntry,
  relativeTime,
  articlePlainExcerpt,
  rssDigestDisplayTitle,
  rssDigestTemplateBlurb,
  rssDigestTemplateHint,
  rssDigestTemplateLabel,
  rssDigestTemplateShort,
  rssDigestTemplatesInGroup,
  rssDigestThreadId,
  rssEntryHasDiscussion,
  rssEntrySourceLabel,
  rssShortSourceLabel,
  rssScoreLabel,
  rssScoreThreshold,
  rssTaskUnreadCount,
  rssUnscoredCount,
  RSS_VALUABLE_MINS,
  rssValuableCount,
  rssValuableCountsByMin,
  rssValuableFilterLabel,
  selectedRssDigest,
  selectedRssEntry,
  toggleRssEntryPin,
  type DigestTimeBounds,
  type RssDigestTemplate,
  type RssDigestWindowHours,
  type RssReaderMode,
  type RssScoreMode,
  type RssTaskEntry,
  type RssTaskFilter,
  type RssTaskState
} from '@shared/rssTask'
import { groupedEnabledModels } from '@shared/models'
import { RssDigestSchedulePanel } from './RssDigestSchedulePanel'
import type { ModelProvider } from '@shared/types'
import { rssEntryTagList } from '@shared/rssTags'
import { DateTimeline } from './DateTimeline'
import { RssTagMap } from './RssTagMap'
import { formatDayCaption, localDateKey } from '@shared/todayHome'
import { rssEntryDisplayTitle } from '@shared/rssLang'
import { toggleUrlInRssDraft } from '@shared/rssBrief'
import {
  RSS_WEBVIEW_DESKTOP_UA,
  RSS_WEBVIEW_PARTITION,
  RSS_WEBVIEW_READER_SCRIPT,
  rssHostPrefersExtract,
  rssWebviewIsShellOnly,
  type RssWebviewProbe
} from '@shared/rssWebview'
import { RssFeedsDialog } from './RssFeedsDialog'
import { RssReaderBody } from './RssReaderBody'
import { RssSelectableContent } from './RssSelectableContent'
import { MarkdownHtml } from './MarkdownHtml'
import { ModelPicker } from './ModelPicker'
import { speakTextWithTts, stopTtsPlayback, onTtsSpeakingChange } from '../ttsPlayback'

type WebFailEvent = Event & {
  errorCode?: number
  isMainFrame?: boolean
  validatedURL?: string
}

type RssWebFrameProps = {
  url: string
  onPreferExtract?: () => void
  /** true：探测到空壳时只提示，不自动切回简洁（尊重用户点「网页」） */
  suppressAutoExtract?: boolean
}

function parseWebviewProbe(raw: unknown): RssWebviewProbe | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const total = typeof o.total === 'number' ? o.total : -1
  const article = typeof o.article === 'number' ? o.article : -1
  const paras = typeof o.paras === 'number' ? o.paras : 0
  return { total, article, paras }
}

function RssWebFrame({
  url,
  onPreferExtract,
  /** 用户刚点「网页」：只提示、不自动弹回简洁 */
  suppressAutoExtract = false
}: RssWebFrameProps): JSX.Element {
  useUiLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const preferExtractRef = useRef(onPreferExtract)
  preferExtractRef.current = onPreferExtract
  const suppressAutoRef = useRef(suppressAutoExtract)
  suppressAutoRef.current = suppressAutoExtract
  const fallbackOnce = useRef(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sparse, setSparse] = useState(false)

  useEffect(() => {
    setFailed(false)
    setLoading(true)
    setSparse(false)
    fallbackOnce.current = false
    const host = hostRef.current
    if (!host) return
    host.replaceChildren()

    const wv = document.createElement('webview') as HTMLElement & {
      src: string
      executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
      addEventListener: (type: string, fn: (e: Event) => void) => void
      removeEventListener: (type: string, fn: (e: Event) => void) => void
    }
    wv.setAttribute('partition', RSS_WEBVIEW_PARTITION)
    wv.setAttribute('useragent', RSS_WEBVIEW_DESKTOP_UA)
    wv.setAttribute('allowpopups', 'false')
    wv.setAttribute(
      'webpreferences',
      'contextIsolation=yes, javascript=yes, images=yes, nodeIntegration=no, webSecurity=yes'
    )
    wv.className = 'rss-webview'
    // Electron：必须保持 display:flex，否则 guest 不铺满
    wv.style.display = 'flex'
    wv.style.flex = '1 1 auto'
    wv.style.width = '100%'
    wv.style.height = '100%'
    wv.style.minWidth = '0'
    wv.style.minHeight = '0'
    wv.style.border = '0'
    wv.style.margin = '0'
    wv.style.alignSelf = 'stretch'
    // 必须先挂到 DOM，再设 src；否则 Electron 里经常整页空白
    host.appendChild(wv)

    const syncWebviewBox = (): void => {
      const r = host.getBoundingClientRect()
      const w = Math.max(1, Math.floor(r.width))
      const h = Math.max(1, Math.floor(r.height))
      if (w < 2 || h < 2) return
      wv.style.width = `${w}px`
      wv.style.height = `${h}px`
      wv.setAttribute('width', String(w))
      wv.setAttribute('height', String(h))
    }
    syncWebviewBox()
    const ro = new ResizeObserver(() => syncWebviewBox())
    ro.observe(host)

    let fallbackTimer: number | undefined
    const probeTimers: number[] = []
    const goExtract = (): void => {
      if (fallbackOnce.current) return
      fallbackOnce.current = true
      setSparse(true)
      // 用户明确要网页：停在网页，给「改看简洁 / 浏览器」按钮，别又弹回简洁
      if (suppressAutoRef.current || !preferExtractRef.current) return
      fallbackTimer = window.setTimeout(() => preferExtractRef.current?.(), 280)
    }

    const enhancePage = (): void => {
      syncWebviewBox()
      void wv
        .executeJavaScript(RSS_WEBVIEW_READER_SCRIPT)
        .then((raw) => {
          const probe = parseWebviewProbe(raw)
          if (!probe || probe.total < 0) return
          if (rssWebviewIsShellOnly(probe)) goExtract()
        })
        .catch(() => {
          /* guest 未就绪时忽略 */
        })
    }

    const onFail = (ev: Event): void => {
      const e = ev as WebFailEvent
      // 子帧失败 / 导航中止（-3）很常见，不能当成整页挂掉
      if (e.isMainFrame === false) return
      if (e.errorCode === -3) return
      setFailed(true)
      setLoading(false)
      goExtract()
    }
    const onStart = (): void => {
      setFailed(false)
      setSparse(false)
      setLoading(true)
    }
    const onStop = (): void => setLoading(false)
    const onFinish = (): void => {
      setLoading(false)
      // SPA 晚一点再出正文；仍空则切简洁
      enhancePage()
      probeTimers.push(window.setTimeout(enhancePage, 900))
      probeTimers.push(window.setTimeout(enhancePage, 2200))
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('dom-ready', enhancePage)
    wv.addEventListener('did-finish-load', onFinish)
    // 下一帧设 src，给 guest 进程一点附着时间
    const t = window.setTimeout(() => {
      syncWebviewBox()
      wv.setAttribute('src', url)
    }, 0)
    // 布局稳定后再强刷一次尺寸（分栏动画/讨论栏出现）
    const t2 = window.setTimeout(syncWebviewBox, 120)
    const t3 = window.setTimeout(syncWebviewBox, 480)

    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      ro.disconnect()
      if (fallbackTimer) window.clearTimeout(fallbackTimer)
      for (const id of probeTimers) window.clearTimeout(id)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('dom-ready', enhancePage)
      wv.removeEventListener('did-finish-load', onFinish)
      host.replaceChildren()
    }
  }, [url])

  return (
    <div className="rss-webview-wrap">
      <div className="rss-webview-frame">
        <div className="rss-webview-host" ref={hostRef} />
        {loading && !failed && !sparse ? (
          <p className="rss-reader-status rss-webview-fallback is-loading">{uiText("页面加载中…")}</p>
        ) : null}
        {!loading && !failed && sparse ? (
          <div className="rss-webview-fallback is-sparse">
            <p className="rss-reader-status">
              {suppressAutoExtract
                ? uiText("内嵌正文很少，可改简洁或系统浏览器打开。")
                : uiText("内嵌无正文，正在改用简洁…")}
            </p>
            <div className="rss-webview-fallback-actions">
              {onPreferExtract ? (
                <button type="button" className="settings-btn tiny" onClick={onPreferExtract}>
                  {suppressAutoExtract ? uiText("改看简洁") : uiText("立即简洁")}
                </button>
              ) : null}
              <button type="button" className="settings-btn tiny" onClick={() => window.petApi.openExternal(url)}>
                {uiText("系统浏览器打开")}</button>
            </div>
          </div>
        ) : null}
        {failed ? (
          <div className="rss-webview-fallback is-error">
            <p className="rss-reader-status">{uiText("网页加载失败。")}</p>
            <div className="rss-webview-fallback-actions">
              {onPreferExtract ? (
                <button type="button" className="settings-btn tiny" onClick={onPreferExtract}>
                  {uiText("改看简洁")}</button>
              ) : null}
              <button type="button" className="settings-btn tiny" onClick={() => window.petApi.openExternal(url)}>
                {uiText("系统浏览器打开")}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  const t = s.trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

function RssRelatedNews({
  items,
  onOpen,
  compact
}: {
  items: RssTaskEntry[]
  onOpen: (it: RssTaskEntry) => void
  compact?: boolean
}): JSX.Element | null {
  useUiLocale()
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <aside className={`rss-related${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}`} aria-label={uiText("相关新闻")}>
      <button
        type="button"
        className="rss-related-h"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>{uiText("相关新闻")}{' '}{items.length}</strong>
        <span>{open ? uiText("同主题对照，不是这篇正文") : uiText("展开后对照，讨论时会按需要带上")}</span>
        <em>{open ? uiText("收起") : uiText("展开")}</em>
      </button>
      {open ? (
        <ul className="rss-related-list">
          {items.map((e) => {
            const tags = rssEntryTagList(e).slice(0, compact ? 1 : 2)
            return (
              <li key={e.id}>
                <button type="button" className="rss-related-item" onClick={() => onOpen(e)}>
                  <span className="rss-related-title">{rssEntryDisplayTitle(e)}</span>
                  <span className="rss-related-meta">
                    <span>{rssShortSourceLabel(e.feedTitle || uiText("来源"))}</span>
                    <span>{relativeTime(e.publishedAt || e.fetchedAt)}</span>
                    {tags.map((tag) => (
                      <span key={tag} className="rss-entry-tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </aside>
  )
}

/** 跨切换任务仍保持中的简报/评分（组件可被 key 卸载）。 */
const rssDigestFlight = new Set<string>()
const rssScoreFlight = new Set<string>()

export function RssTaskView({
  conversation,
  onPatchRss,
  onSelectEntry,
  onSelectDigest,
  onDeleteDigest,
  onSelectThread,
  hasDiscussion,
  showDiscussion,
  modelRef,
  aiChildren,
  aiScrollRef,
  onAiScroll,
  onDiscussQuote,
  onOpenSchedules,
  onOpenToday,
  ttsEnabled = false
}: {
  conversation: Conversation
  onPatchRss: (next: RssTaskState | ((prev: RssTaskState) => RssTaskState)) => void
  onSelectEntry: (entry: RssTaskEntry) => void
  /** 选中某次盘点：切讨论线程到 digest:id；markRead 默认 true，生成落盘选中时传 false */
  onSelectDigest: (digestId: string, opts?: { markRead?: boolean }) => void
  /** 删除简报（含对应讨论线程） */
  onDeleteDigest: (digestId: string) => void
  /** 离开盘点时恢复条目讨论线程 */
  onSelectThread: (threadId: string) => void
  hasDiscussion: boolean
  showDiscussion: boolean
  /** 当前会话模型（讨论用）；打分/盘点改走评分专用模型。 */
  modelRef?: string
  aiChildren: ReactNode
  aiScrollRef?: RefObject<HTMLDivElement>
  onAiScroll?: UIEventHandler<HTMLDivElement>
  /** 划词点「讨论此段」后聚焦底部输入 */
  onDiscussQuote?: () => void
  /** 打开全局定时任务面板 */
  onOpenSchedules?: () => void
  /** 回到工作台看当天图谱 */
  onOpenToday?: () => void
  /** 设置里开启 TTS 后才显示正文朗读。 */
  ttsEnabled?: boolean
}): JSX.Element {
  useUiLocale()
  const convId = conversation.id
  const rss = conversation.rss || EMPTY_RSS_TASK
  const threads = conversation.rssThreads
  const [refreshing, setRefreshing] = useState(false)
  /** 多条拉源失败默认收成一条；点「明细」才展开。 */
  const [feedErrorsExpanded, setFeedErrorsExpanded] = useState(false)
  const [feedsOpen, setFeedsOpen] = useState(false)
  const [feedDraft, setFeedDraft] = useState(() => rss.feeds.map((f) => f.url).join('\n'))
  const [articleBusy, setArticleBusy] = useState(false)
  const [articleError, setArticleError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [digestBusyLocal, setDigestBusyLocal] = useState(false)
  const [scoreBusyLocal, setScoreBusyLocal] = useState(false)
  const digestBusy = digestBusyLocal || !!rss.digestGenerating || rssDigestFlight.has(convId)
  const scoreBusy = scoreBusyLocal || rss.scoring?.status === 'running' || rssScoreFlight.has(convId)
  const [scoreCfgOpen, setScoreCfgOpen] = useState(false)
  const [readTag, setReadTag] = useState('')
  const [mapOpen, setMapOpen] = useState(false)
  const [mapDateKey, setMapDateKey] = useState('')
  const [digestCfgOpen, setDigestCfgOpen] = useState(false)
  /** 生成面板：现在生成 ↔ 定时任务（互斥切换）。 */
  const [digestCfgTab, setDigestCfgTab] = useState<'now' | 'schedule'>('now')
  /**
   * 现在生成勾选的条目 id；null = 当前收录窗内全选。
   * 部分勾选时只生成这些条目（不再按天拆份）。
   */
  const [digestPickIds, setDigestPickIds] = useState<string[] | null>(null)
  /** 选消息列表评分快筛；0 = 不限。切换档位时同步勾选匹配项。 */
  const [digestPickScoreMin, setDigestPickScoreMin] = useState<0 | 3 | 4 | 5>(0)
  /** 简报列表按生成形式筛选；all = 全部。 */
  const [digestTemplateFilter, setDigestTemplateFilter] = useState<'all' | RssDigestTemplate>(
    'all'
  )
  const [actionFlash, setActionFlash] = useState<string | null>(null)
  /** 「模型生成已缓存」底栏提示：显示几秒后消失。 */
  const [modelCacheHint, setModelCacheHint] = useState(false)
  /** 阅读区正文点播朗读中（与全局 TTS 状态对齐，避免播完后按钮仍卡「停止」）。 */
  const [readerSpeaking, setReaderSpeaking] = useState(false)
  const readerSpeakingRef = useRef(false)
  readerSpeakingRef.current = readerSpeaking
  useEffect(() => onTtsSpeakingChange(setReaderSpeaking), [])
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [globalScoreModel, setGlobalScoreModel] = useState('')
  const [globalScoreMode, setGlobalScoreMode] = useState<RssScoreMode>('realtime')
  const [globalScoreInterval, setGlobalScoreInterval] = useState(30)
  const moreRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const refreshInFlight = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelCacheHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 本轮已提示过的「条目 + 正文长度」，避免同正文反复弹。 */
  const modelCacheHintKeyRef = useRef<string | null>(null)
  /** 离开盘点时恢复的阅读方式（盘点不是网页/简洁的第三态）。 */
  const articleModeRef = useRef<'web' | 'extract'>('web')
  /** 进入盘点前的条目 id，返回阅读时恢复讨论线程。 */
  const readingEntryIdRef = useRef<string | undefined>(undefined)
  /** 每条最多因「长文无图」自动重抓一次，避免死循环。 */
  const mediaRefetchTried = useRef(new Set<string>())
  /** 模型补全文进行中，避免点选/网页失败双触发。 */
  const modelRecoverInFlight = useRef(new Set<string>())
  /** 用户主动点「网页」/提取失败切网页：禁止 webview 自动弹回简洁。 */
  const [suppressWebAutoExtract, setSuppressWebAutoExtract] = useState(false)
  const [modelBusy, setModelBusy] = useState(false)
  const rssRef = useRef(rss)
  rssRef.current = rss
  const [listPct, setListPct] = useState(DEFAULT_RSS_PANE_WIDTHS.listPct)
  const [aiPct, setAiPct] = useState(DEFAULT_RSS_PANE_WIDTHS.aiPct)
  const [resizing, setResizing] = useState<'list' | 'ai' | null>(null)
  /** 宿主宽度：窄窗时改叠栏 / 讨论浮层，避免横向滚动条。 */
  const [hostWidth, setHostWidth] = useState(960)
  /** 叠栏模式：列表 ↔ 阅读（互斥全宽）。 */
  const [stackFocus, setStackFocus] = useState<'list' | 'detail'>('list')
  const listPctRef = useRef(listPct)
  const aiPctRef = useRef(aiPct)
  listPctRef.current = listPct
  aiPctRef.current = aiPct

  useEffect(() => {
    void window.petApi.getSettings().then((s) => {
      const w = normalizeRssPaneWidths(s.rssPaneWidths)
      setListPct(w.listPct)
      setAiPct(w.aiPct)
    })
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = (w: number): void => {
      if (w > 0) setHostWidth(w)
    }
    apply(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function beginResize(which: 'list' | 'ai', e: ReactPointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    const root = rootRef.current
    if (!root) return
    const width = root.getBoundingClientRect().width
    if (width < 80) return
    const startX = e.clientX
    const startList = listPctRef.current
    const startAi = aiPctRef.current
    setResizing(which)
    document.body.classList.add('rss-resizing')

    const onMove = (ev: PointerEvent): void => {
      const dxPct = ((ev.clientX - startX) / width) * 100
      if (which === 'list') {
        setListPct(clampRssListPct(startList + dxPct, aiPctRef.current))
      } else {
        // 拖讨论栏左缘：右移收窄讨论栏
        setAiPct(clampRssAiPct(startAi - dxPct, listPctRef.current))
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('rss-resizing')
      setResizing(null)
      const next = normalizeRssPaneWidths({
        listPct: listPctRef.current,
        aiPct: aiPctRef.current
      })
      setListPct(next.listPct)
      setAiPct(next.aiPct)
      window.petApi.setRssPaneWidths(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function flashAction(msg: string): void {
    setActionFlash(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => {
      setActionFlash((cur) => (cur === msg ? null : cur))
      flashTimer.current = null
    }, 3600)
  }

  function showModelCacheHint(entryId: string, bodyKey: string, opts?: { force?: boolean }): void {
    const key = `${entryId}:${bodyKey}`
    if (!opts?.force && modelCacheHintKeyRef.current === key) return
    modelCacheHintKeyRef.current = key
    setModelCacheHint(true)
    if (modelCacheHintTimer.current) clearTimeout(modelCacheHintTimer.current)
    modelCacheHintTimer.current = setTimeout(() => {
      setModelCacheHint(false)
      modelCacheHintTimer.current = null
    }, 3200)
  }

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      if (modelCacheHintTimer.current) clearTimeout(modelCacheHintTimer.current)
    },
    []
  )

  // 超过 24h 的未读落成已读（钉住除外）
  useEffect(() => {
    const next = expireStaleRssUnreadState(rss)
    if (next !== rss) onPatchRss(next)
  }, [rss, onPatchRss])

  async function holdBusyMin(started: number, minMs = 480): Promise<void> {
    const left = minMs - (Date.now() - started)
    if (left > 0) await new Promise((r) => setTimeout(r, left))
  }

  const list = useMemo(() => {
    const raw = filterRssTaskItems(rss)
    const tag = readTag.trim().toLowerCase()
    const tagged = tag
      ? raw.filter((e) => rssEntryTagList(e).some((t) => t.toLowerCase() === tag))
      : raw
    if (!mapDateKey) return tagged
    return tagged.filter((e) => rssDayKey(rssEntryTime(e) || 0) === mapDateKey)
  }, [rss, readTag, mapDateKey])
  const mapItems = useMemo(
    () =>
      (rss.items || []).map((e) => ({
        tags: rssEntryTagList(e),
        title: e.title,
        titleLocal: e.titleLocal,
        snippet: e.snippet,
        score: e.valueScore
      })),
    [rss.items]
  )
  const rssMarkedDays = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of rss.items || []) {
      const key = rssDayKey(rssEntryTime(e) || 0)
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [rss.items])
  const dayGroups = useMemo(() => groupRssEntriesByDay(list), [list])
  const feedErrors = useMemo(() => splitRssFeedActionableErrors(rss.lastError), [rss.lastError])
  const selected = selectedRssEntry(rss)
  const relatedNews = useMemo(() => relatedRssForEntry(rss, selected || undefined, 4), [rss, selected])
  const digests = useMemo(() => rss.digests || [], [rss.digests])
  /** 简报列表里实际出现过的形式（按目录顺序），用于二级筛选。 */
  const digestFilterChips = useMemo(() => {
    const counts = new Map<RssDigestTemplate, number>()
    for (const d of digests) {
      const t = normalizeRssDigestTemplate(d.template)
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return RSS_DIGEST_TEMPLATES.filter((t) => counts.has(t)).map((t) => ({
      t,
      n: counts.get(t) ?? 0
    }))
  }, [digests])
  const activeDigest = selectedRssDigest(rss)
  const entryNav = useMemo(() => {
    const index = selected ? list.findIndex((x) => x.id === selected.id) : -1
    return {
      index,
      total: list.length,
      prev: index > 0 ? list[index - 1] : undefined,
      next: index >= 0 && index < list.length - 1 ? list[index + 1] : undefined
    }
  }, [list, selected])
  const visibleDigests = useMemo(() => {
    if (digestTemplateFilter === 'all') return digests
    return digests.filter(
      (d) => normalizeRssDigestTemplate(d.template) === digestTemplateFilter
    )
  }, [digests, digestTemplateFilter])
  const digestNav = useMemo(() => {
    const index = activeDigest
      ? visibleDigests.findIndex((d) => d.id === activeDigest.id)
      : -1
    return {
      index,
      total: visibleDigests.length,
      prev: index > 0 ? visibleDigests[index - 1] : undefined,
      next:
        index >= 0 && index < visibleDigests.length - 1
          ? visibleDigests[index + 1]
          : undefined
    }
  }, [visibleDigests, activeDigest])
  const unread = rssTaskUnreadCount(rss)
  const valuableCount = rssValuableCount(rss)
  const valuableByMin = useMemo(() => rssValuableCountsByMin(rss), [rss])
  const unscoredCount = rssUnscoredCount(rss)
  const scoreMin = rssScoreThreshold(rss)
  const filter = rss.filter || 'all'
  const showingDigest = rss.readerMode === 'digest'
  const readerMode: RssReaderMode = showingDigest
    ? 'digest'
    : rss.readerMode === 'extract'
      ? 'extract'
      : 'web'

  // 错误集合变了就收起明细，避免刷新后又摊开一长串
  useEffect(() => {
    setFeedErrorsExpanded(false)
  }, [conversation.id, rss.lastError])

  // 气泡深链选中后，把对应条目滚进列表视野
  useEffect(() => {
    if (!selected?.id || showingDigest) return
    const el = document.querySelector(
      `[data-rss-entry-id="${CSS.escape(selected.id)}"]`
    ) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected?.id, conversation.id, showingDigest])

  // 换条目/简报或离开阅读时停掉正文朗读
  useEffect(() => {
    if (!readerSpeakingRef.current) return
    stopTtsPlayback()
    setReaderSpeaking(false)
  }, [selected?.id, activeDigest?.id, showingDigest, conversation.id])

  // 简洁·整理版：底栏提示几秒后消失
  useEffect(() => {
    if (
      readerMode !== 'extract' ||
      !selected ||
      (selected.extractPane || 'source') !== 'model' ||
      !rssEntryHasModelBody(selected)
    ) {
      setModelCacheHint(false)
      return
    }
    const html = selected.modelHtml || selected.contentHtml || ''
    showModelCacheHint(selected.id, String(html.length))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.extractPane, selected?.modelHtml, readerMode])
  const digestWindow = (RSS_DIGEST_WINDOWS.includes(rss.digestWindowHours as RssDigestWindowHours)
    ? rss.digestWindowHours
    : 24) as RssDigestWindowHours
  const digestCustomRange = !!(rss.digestRangeFrom || rss.digestRangeTo)
  const digestRangeSelect = digestCustomRange ? 'custom' : String(digestWindow)
  const digestBounds = useMemo(() => resolveDigestTimeBounds(rss), [rss])
  const digestTemplate = normalizeRssDigestTemplate(rss.digestTemplate)
  const windowEntryCount = useMemo(() => entriesInDigestWindow(rss).length, [rss])
  const digestWindowEntries = useMemo(
    () => entriesInTimeBounds(rss, digestBounds),
    // 窗界与条目变化时重算；整份 rss 入依赖会过频
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rss.items,
      digestBounds.fromAt,
      digestBounds.toAt,
      digestBounds.rangeFrom,
      digestBounds.rangeTo
    ]
  )
  const digestVisibleEntries = useMemo(
    () => filterEntriesByDigestScoreMin(digestWindowEntries, digestPickScoreMin),
    [digestWindowEntries, digestPickScoreMin]
  )
  const digestPickScoreCounts = useMemo(() => {
    const c = { 0: digestWindowEntries.length, 3: 0, 4: 0, 5: 0 }
    for (const e of digestWindowEntries) {
      const s = e.valueScore || 0
      if (s >= 3) c[3]++
      if (s >= 4) c[4]++
      if (s >= 5) c[5]++
    }
    return c
  }, [digestWindowEntries])
  const digestPickSet = useMemo(() => {
    if (digestPickIds == null) return new Set(digestWindowEntries.map((e) => e.id))
    return new Set(digestPickIds)
  }, [digestPickIds, digestWindowEntries])
  const digestPickCount = digestWindowEntries.reduce(
    (n, e) => n + (digestPickSet.has(e.id) ? 1 : 0),
    0
  )
  const digestVisiblePickCount = digestVisibleEntries.reduce(
    (n, e) => n + (digestPickSet.has(e.id) ? 1 : 0),
    0
  )
  const digestPickAll =
    digestWindowEntries.length > 0 && digestPickCount === digestWindowEntries.length
  const digestVisibleAllSelected =
    digestVisibleEntries.length > 0 && digestVisiblePickCount === digestVisibleEntries.length

  function applyDigestScoreFilter(min: 0 | 3 | 4 | 5): void {
    const nextMin = normalizeRssDigestScoreMin(min)
    setDigestPickScoreMin(nextMin)
    const matched = filterEntriesByDigestScoreMin(digestWindowEntries, nextMin)
    if (nextMin === 0) {
      setDigestPickIds(null)
      return
    }
    const ids = matched.map((e) => e.id)
    if (ids.length === digestWindowEntries.length) setDigestPickIds(null)
    else setDigestPickIds(ids)
  }

  useEffect(() => {
    setDigestPickIds(null)
    setDigestPickScoreMin(0)
  }, [
    conversation.id,
    digestBounds.fromAt,
    digestBounds.toAt,
    digestBounds.rangeFrom,
    digestBounds.rangeTo
  ])

  function rememberReadingEntry(): void {
    if (!isRssDigestThreadId(rssRef.current.selectedId)) {
      readingEntryIdRef.current = rssRef.current.selectedId
    }
  }
  const feedFilterId = filter.startsWith('feed:') ? filter.slice(5) : null
  const feedFilterTitle = feedFilterId
    ? rss.feeds.find((f) => f.id === feedFilterId)?.title || '源'
    : null

  // 仅在打开选源对话框 / 切换任务时同步草稿，避免编辑中被 rss.feeds 刷新冲掉
  useEffect(() => {
    if (!feedsOpen) return
    setFeedDraft(rss.feeds.map((f) => f.url).join('\n'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 刻意不跟 rss.feeds 联动
  }, [feedsOpen, conversation.id])

  useEffect(() => {
    let cancelled = false
    void window.petApi.getSettings().then((s) => {
      if (cancelled) return
      setProviders(s.modelProviders || [])
      setGlobalScoreModel(s.rssScoreModelRef || '')
      setGlobalScoreMode(normalizeRssScoreMode(s.rssScoreMode))
      setGlobalScoreInterval(normalizeRssScoreIntervalMinutes(s.rssScoreIntervalMinutes))
    })
    return () => {
      cancelled = true
    }
  }, [conversation.id])

  const effectiveScoreMode = normalizeRssScoreMode(rss.scoreMode ?? globalScoreMode)
  const effectiveScoreInterval = normalizeRssScoreIntervalMinutes(
    rss.scoreIntervalMinutes ?? globalScoreInterval
  )
  const effectiveScoreModel = (rss.scoreModelRef ?? globalScoreModel).trim()
  /** 评分/简报：直连或 Agent；空则规则/模板。 */
  function resolveIntelModelRef(state: RssTaskState = rssRef.current): string | undefined {
    const ref = (state.scoreModelRef ?? effectiveScoreModel).trim()
    return ref || undefined
  }
  const scoreModels = useMemo(
    () =>
      groupedEnabledModels(providers).flatMap((g) =>
        g.models.map((m) => ({ ref: m.ref, label: `${g.providerLabel}：${m.label}` }))
      ),
    [providers]
  )
  /** 简报与评分共用「资讯模型」：直连 API 或 Agent 引擎。 */
  function setIntelModel(ref: string): void {
    onPatchRss({ ...rssRef.current, scoreModelRef: ref || undefined, updatedAt: Date.now() })
    window.petApi.setRssScoreModelRef(ref)
    setGlobalScoreModel(ref)
  }

  // 旧数据 feedId 漂移 / 缺 feedTitle 时纠偏（有实际变化才写回，避免死循环）
  useEffect(() => {
    if (!rss.items.length || !rss.feeds.length) return
    const next = reconcileRssEntrySources({ ...rss, updatedAt: Date.now() })
    const changed = next.items.some(
      (it, i) =>
        it.feedId !== rss.items[i]?.feedId || it.feedTitle !== rss.items[i]?.feedTitle
    )
    if (changed) onPatchRss(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, rss.feeds.length, rss.items.length])

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  useEffect(() => {
    setMoreOpen(false)
    setArticleError(null)
  }, [selected?.id])

  function ensureRssIntelApi(): string | null {
    const api = window.petApi as Partial<typeof window.petApi> | undefined
    if (
      typeof api?.scoreRssEntries !== 'function' ||
      typeof api?.buildRssDigestReport !== 'function' ||
      typeof api?.runRssDisposition !== 'function'
    ) {
      return '评分/简报接口未加载，请完全退出后重新打开应用（需刷新 preload）'
    }
    return null
  }

  async function runScoring(
    base?: RssTaskState,
    force = false,
    /** 刷新/定时等后台触发：无事可做时不弹提示 */
    quiet = false
  ): Promise<RssTaskState> {
    const apiGap = ensureRssIntelApi()
    if (apiGap) {
      if (!quiet) flashAction(apiGap)
      return base ?? rssRef.current
    }
    const state = base ?? rssRef.current
    if (state.scoreEnabled === false) {
      if (!quiet) flashAction('评分已关闭，可在「评分」里打开节奏')
      return state
    }
    const need = force
      ? state.items.filter((x) => x.id).slice(0, 80)
      : entriesNeedingScore(state, 40)
    if (!need.length) {
      if (!quiet) flashAction(force ? '没有可评条目' : '没有未评分条目 · 可点「重评」')
      return state
    }
    if (rssScoreFlight.has(convId)) {
      if (!quiet) flashAction('评分进行中…')
      return state
    }
    rssScoreFlight.add(convId)
    setScoreBusyLocal(true)
    const started = Date.now()
    if (!quiet) {
      flashAction(force ? `正在重评 ${need.length} 条…` : `正在评 ${need.length} 条未打分…`)
    }
    onPatchRss((prev) => ({
      ...prev,
      scoring: { status: 'running', updatedAt: Date.now() },
      updatedAt: Date.now()
    }))
    try {
      const res = await window.petApi.scoreRssEntries({
        entries: need,
        modelRef: resolveIntelModelRef(state)
      })
      let patched: RssTaskState = state
      onPatchRss((latest) => {
        const withBodies = applyRssBodyPatches(latest, res.bodyPatches || [])
        const next = applyRssEntryScores(withBodies, res.scores)
        patched = {
          ...next,
          scoring: {
            status: 'idle',
            error: res.mode === 'heuristic' ? res.error : undefined,
            updatedAt: Date.now()
          },
          updatedAt: Date.now()
        }
        return patched
      })
      if (!quiet) {
        if (res.mode === 'model') {
          flashAction(`模型已评 ${res.scores.length} 条`)
        } else if (res.error) {
          flashAction(
            `规则已评 ${res.scores.length} 条 · ${humanizeRssIntelError(res.error)}`
          )
        } else {
          flashAction(`规则已评 ${res.scores.length} 条`)
        }
      }
      return patched
    } catch (err) {
      const msg = humanizeRssIntelError(err instanceof Error ? err.message : '打分失败')
      let patched: RssTaskState = state
      onPatchRss((latest) => {
        patched = {
          ...latest,
          scoring: {
            status: 'error',
            error: msg,
            updatedAt: Date.now()
          },
          updatedAt: Date.now()
        }
        return patched
      })
      if (!quiet) flashAction(`评分失败：${msg}`)
      return patched
    } finally {
      await holdBusyMin(started)
      rssScoreFlight.delete(convId)
      setScoreBusyLocal(false)
    }
  }

  /** 拉源。quiet=后台轮询（不抢按钮态、失败不盖掉已有 lastError）。 */
  async function doRefresh(opts?: { quiet?: boolean }): Promise<void> {
    const quiet = opts?.quiet === true
    const state = rssRef.current
    if (!state.feeds.length) {
      if (!quiet) setFeedsOpen(true)
      return
    }
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    if (!quiet) setRefreshing(true)
    const feedsSnapshot = state.feeds
    try {
      const res = await window.petApi.refreshRssTaskFeeds(feedsSnapshot)
      let merged: RssTaskState = state
      onPatchRss((base) => {
        const feeds = res.feeds.length ? res.feeds : base.feeds
        merged = reconcileRssEntrySources({
          ...base,
          feeds,
          items: mergeRssTaskItems(base.items, res.items),
          updatedAt: Date.now(),
          lastError: res.errors.length
            ? joinRssFeedErrors(res.errors)
            : quiet
              ? base.lastError
              : undefined
        })
        return merged
      })
      const mode = normalizeRssScoreMode(merged.scoreMode ?? globalScoreMode)
      // 后台补评：没有未评分时别弹「可点重评」，避免刷新被误会成评分失败
      if (merged.scoreEnabled !== false && mode === 'realtime') void runScoring(merged, false, true)
    } catch {
      if (!quiet) {
        onPatchRss((prev) => ({ ...prev, lastError: '刷新失败', updatedAt: Date.now() }))
      }
    } finally {
      refreshInFlight.current = false
      if (!quiet) setRefreshing(false)
    }
  }

  // 点进 / 切到该 RSS：立刻拉一轮（有条目也拉，避免一直吃旧缓存）
  useEffect(() => {
    if (!rssRef.current.feeds.length) {
      setFeedsOpen(true)
      return
    }
    void doRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id])

  /**
   * 生成简报（走消息处置流水线：拉取→评分→截取→写稿）。
   * - replaceId：按该份时间窗重写（讨论不断）
   * - auto：按频率切窗（忽略自选日期）
   * - entryIds：手动勾选条目（单窗，不按天拆）
   * - 手动 + 自选多日：按自然日拆成多份（最多 7 天）
   */
  async function runDigest(
    base?: RssTaskState,
    opts?: { replaceId?: string; auto?: boolean; entryIds?: string[] }
  ): Promise<void> {
    const apiGap = ensureRssIntelApi()
    if (apiGap) {
      flashAction(apiGap)
      return
    }
    const state = base ?? rssRef.current
    if (rssDigestFlight.has(convId)) {
      flashAction('简报生成中…')
      return
    }
    const replaceId = opts?.replaceId
    const prior = replaceId
      ? (state.digests || []).find((d) => d.id === replaceId)
      : undefined
    const pickIds = opts?.entryIds?.length ? opts.entryIds : undefined
    rememberReadingEntry()
    rssDigestFlight.add(convId)
    setDigestBusyLocal(true)
    onPatchRss((prev) => ({
      ...prev,
      digestGenerating: true,
      lastDigestError: undefined,
      disposition: { stage: 'fetching', detail: uiText("准备处置…"), updatedAt: Date.now() },
      updatedAt: Date.now()
    }))
    const started = Date.now()
    const template = normalizeRssDigestTemplate(prior?.template ?? state.digestTemplate)
    const modelRef = resolveIntelModelRef(state)

    let chunks: DigestTimeBounds[]
    if (prior) {
      chunks = [resolveDigestBoundsFromRecord(prior)]
    } else if (opts?.auto) {
      chunks = [resolveAutoDigestTimeBounds(state)]
    } else if (pickIds?.length) {
      chunks = [resolveDigestTimeBounds(state)]
    } else {
      const manual = resolveDigestTimeBounds(state)
      chunks = listDigestTimeChunks(manual, 7)
    }

    flashAction(
      prior
        ? `正在重新生成「${rssDigestDisplayTitle(prior)}」…`
        : pickIds?.length
          ? `正在处置已选 ${pickIds.length} 条…`
          : chunks.length > 1
            ? `正在按天处置 ${chunks.length} 份简报…`
            : `正在处置 ${chunks[0]!.label}…`
    )

    try {
      let made = 0
      let lastId = ''
      let lastMode: 'model' | 'heuristic' = 'heuristic'
      let lastError: string | undefined
      let totalEntries = 0
      let feeds = state.feeds
      let items = state.items
      let refreshedOnce = false

      for (let i = 0; i < chunks.length; i++) {
        const bounds = chunks[i]!
        if (chunks.length > 1) {
          flashAction(`处置 ${bounds.label}（${i + 1}/${chunks.length}）…`)
        }

        const res = await window.petApi.runRssDisposition({
          conversationId: convId,
          feeds,
          items,
          bounds,
          entryIds: pickIds,
          scoreMin: pickIds?.length ? 0 : digestPickScoreMin,
          modelRef,
          template,
          refresh: !prior && !refreshedOnce,
          scoreUnscored: state.scoreEnabled !== false,
          scoreEnabled: state.scoreEnabled !== false
        })
        refreshedOnce = true
        feeds = res.feeds
        items = res.items

        if (!res.ok || !res.record) {
          if (chunks.length > 1) continue
          onPatchRss((prev) => ({
            ...prev,
            feeds,
            items,
            readerMode: 'digest',
            lastDigestError: res.error || '收录窗内没有消息',
            disposition: {
              stage: 'idle',
              detail: res.error || '收录窗内没有消息',
              updatedAt: Date.now()
            },
            lastError: res.refreshErrors?.length
              ? joinRssFeedErrors(res.refreshErrors)
              : prev.lastError,
            updatedAt: Date.now()
          }))
          flashAction(res.error || '这些天里没有条目，请先刷新或换个日期')
          return
        }

        const createdAt = Date.now()
        const recordId = prior?.id || newRssDigestId(createdAt + i)
        const commit = prior ? replaceRssDigest : prependRssDigest
        const record = {
          id: recordId,
          ...res.record,
          createdAt
        }
        onPatchRss((prev) =>
          commit(
            {
              ...prev,
              feeds,
              items,
              readerMode: 'digest',
              digestTemplate: template,
              digestGenerating: true,
              disposition: {
                stage: res.stage,
                detail: res.detail,
                updatedAt: Date.now()
              },
              lastDigestError:
                res.stage === 'skeleton' && res.error ? res.error : undefined,
              lastError: res.refreshErrors?.length
                ? joinRssFeedErrors(res.refreshErrors)
                : prev.lastError
            },
            record
          )
        )
        lastId = record.id
        lastMode = res.record.mode
        lastError = res.error
        totalEntries += res.includedCount
        made++
        if (prior) break
      }

      if (lastId) onSelectDigest(lastId, { markRead: false })
      if (made > 0) setDigestCfgOpen(false)

      if (!made) {
        flashAction('这些天里没有条目，请先刷新或换个日期')
        onPatchRss((prev) => ({
          ...prev,
          disposition: {
            stage: 'idle',
            detail: uiText("窗内无条目"),
            updatedAt: Date.now()
          },
          updatedAt: Date.now()
        }))
        return
      }

      const errBit = lastError ? ` · ${humanizeRssIntelError(lastError)}` : ''
      if (prior) {
        flashAction(
          lastMode === 'model'
            ? `简报已重新生成（模型归纳 · ${totalEntries} 条）`
            : `模型未完成，已出模板骨架（${totalEntries} 条素材）${errBit}`
        )
      } else if (made > 1) {
        flashAction(
          lastMode === 'model'
            ? `已按天生成 ${made} 份简报（共纳入 ${totalEntries} 条）`
            : `已按天生成 ${made} 份模板骨架（共 ${totalEntries} 条素材）${errBit}`
        )
      } else {
        flashAction(
          lastMode === 'model'
            ? `简报已生成（模型归纳 · ${totalEntries} 条）`
            : `模型未完成，已出模板骨架（${totalEntries} 条素材）${errBit}`
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '简报失败'
      onPatchRss((prev) => ({
        ...prev,
        readerMode: 'digest',
        lastDigestError: msg,
        disposition: { stage: 'idle', detail: msg, updatedAt: Date.now() },
        updatedAt: Date.now()
      }))
      flashAction(`简报失败：${msg}`)
    } finally {
      await holdBusyMin(started)
      rssDigestFlight.delete(convId)
      onPatchRss((prev) => ({
        ...prev,
        digestGenerating: false,
        updatedAt: Date.now()
      }))
      setDigestBusyLocal(false)
    }
  }

  // 处置流水线进度（主进程推送）
  useEffect(() => {
    const api = window.petApi as Partial<typeof window.petApi> | undefined
    if (typeof api?.onRssDispositionStage !== 'function') return
    return api.onRssDispositionStage((payload) => {
      if (payload.conversationId !== convId) return
      const detail = payload.detail || dispositionLabel(payload.stage)
      onPatchRss((prev) => ({
        ...prev,
        disposition: {
          stage: payload.stage,
          detail,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }))
      if (
        payload.stage === 'fetching' ||
        payload.stage === 'scoring' ||
        payload.stage === 'picking' ||
        payload.stage === 'digesting'
      ) {
        flashAction(detail)
      }
    })
  }, [convId, onPatchRss])

  // 进程被杀等导致「生成中」残留且无在途任务：清掉，避免按钮永久锁死
  useEffect(() => {
    if (rss.digestGenerating && !rssDigestFlight.has(convId)) {
      onPatchRss((prev) =>
        prev.digestGenerating
          ? { ...prev, digestGenerating: false, updatedAt: Date.now() }
          : prev
      )
    }
    if (rss.scoring?.status === 'running' && !rssScoreFlight.has(convId)) {
      onPatchRss((prev) => ({
        ...prev,
        scoring: {
          status: 'idle',
          error: prev.scoring?.error,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }))
    }
    // 仅在切到本任务时检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  // 纠正历史空泛题名（如「时段概述」）
  useEffect(() => {
    if (!showingDigest) return
    const cur = rssRef.current
    const healed = healRssDigestTitles(cur)
    if (healed === cur) return
    onPatchRss(healed)
  }, [showingDigest, digests.length, activeDigest?.id, activeDigest?.title, onPatchRss])

  function openDigest(): void {
    setMapOpen(false)
    if (readerMode === 'web' || readerMode === 'extract') {
      articleModeRef.current = readerMode
    }
    rememberReadingEntry()
    setScoreCfgOpen(false)
    // 进简报默认收起生成面板；需要时点「生成」或空态「去生成」
    setDigestCfgOpen(false)
    setStackFocus('detail')
    const cur = rssRef.current
    const next = { ...cur, readerMode: 'digest' as const, updatedAt: Date.now() }
    onPatchRss(next)
    const latest = selectedRssDigest(next) || next.digests?.[0]
    if (latest) onSelectDigest(latest.id)
    const stale =
      !latest ||
      !latest.createdAt ||
      Date.now() - latest.createdAt > digestWindow * 1800_000
    if (!next.items.length) {
      flashAction('还没有条目，先刷新订阅')
      return
    }
    if (stale && !rssDigestFlight.has(convId) && !next.digestGenerating) {
      void runDigest(next)
    }
  }

  function closeDigest(extra?: Partial<RssTaskState>): void {
    const mode = articleModeRef.current
    setDigestCfgOpen(false)
    onPatchRss({ ...rss, ...extra, readerMode: mode, updatedAt: Date.now() })
    const entryId = readingEntryIdRef.current
    if (entryId) onSelectThread(entryId)
  }

  function selectDigestRecord(digestId: string): void {
    rememberReadingEntry()
    setStackFocus('detail')
    // 点历史简报 = 去读，不是去配；收起生成面板避免挡列表
    setDigestCfgOpen(false)
    onPatchRss({
      ...rss,
      readerMode: 'digest',
      selectedDigestId: digestId,
      updatedAt: Date.now()
    })
    onSelectDigest(digestId)
  }

  // 阅读区 ←/→ 或 j/k：上一篇 / 下一篇（输入框内不抢键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      const goPrev = e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K'
      const goNext = e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J'
      if (!goPrev && !goNext) return
      if (showingDigest) {
        const hit = goPrev ? digestNav.prev : digestNav.next
        if (!hit) return
        e.preventDefault()
        selectDigestRecord(hit.id)
        return
      }
      if (!selected) return
      const hit = goPrev ? entryNav.prev : entryNav.next
      if (!hit) return
      e.preventDefault()
      selectEntry(hit)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // selectEntry / selectDigestRecord 每帧重建；只跟邻接条目与模式走
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingDigest, digestNav.prev, digestNav.next, entryNav.prev, entryNav.next, selected])

  function deleteDigestRecord(digestId: string): void {
    const d = digests.find((x) => x.id === digestId)
    if (!d) return
    const title = rssDigestDisplayTitle(d)
    if (
      !confirmDestructive(
        uiText("确定删除简报「{0}」？对应讨论也会清除，此操作不可撤销。", [title])
      )
    ) {
      return
    }
    onDeleteDigest(digestId)
    flashAction('已删除简报')
  }

  async function exportMarkdown(filenameTitle: string, content: string): Promise<void> {
    if (!content.trim()) {
      flashAction('没有可导出的内容')
      return
    }
    try {
      const res = await window.petApi.saveTextFile({
        defaultPath: safeRssExportFilename(filenameTitle),
        content,
        title: uiText("导出 Markdown")
      })
      if (res.canceled) return
      if (!res.ok) {
        flashAction(res.error || '导出失败')
        return
      }
      flashAction(res.path ? `已导出：${res.path.split(/[/\\]/).pop()}` : '已导出')
    } catch (err) {
      flashAction(err instanceof Error ? err.message : '导出失败')
    }
  }

  function exportActiveDigest(): void {
    if (!activeDigest?.markdown?.trim()) {
      flashAction('当前没有可导出的简报')
      return
    }
    void exportMarkdown(rssDigestDisplayTitle(activeDigest), rssDigestToMarkdown(activeDigest))
  }

  function exportActiveEntry(): void {
    const it = selectedRssEntry(rssRef.current)
    if (!it) {
      flashAction('请先选一条内容')
      return
    }
    void exportMarkdown(
      it.title || 'RSS',
      rssEntryToMarkdown(it, { sourceLabel: rssEntrySourceLabel(rssRef.current, it) })
    )
  }

  /** 阅读区当前正文（条目或简报）→ 可朗读纯文本。 */
  function readerSpeakText(): string {
    if (showingDigest) {
      const d = activeDigest
      if (!d?.markdown?.trim()) return ''
      return `${rssDigestDisplayTitle(d)}\n\n${d.markdown}`
    }
    const it = selected
    if (!it) return ''
    const body =
      articlePlainExcerpt(rssEntryDisplayHtml(it), 4000) ||
      (it.snippet || '').replace(/\s+/g, ' ').trim()
    if (!body) return (it.title || '').trim()
    return `${(it.title || '').trim()}。${body}`
  }

  async function speakReader(): Promise<void> {
    if (readerSpeakingRef.current) {
      stopTtsPlayback()
      return
    }
    const text = readerSpeakText()
    if (!text.trim()) {
      flashAction(
        showingDigest
          ? '当前简报没有可朗读内容'
          : readerMode === 'web'
            ? '网页模式无缓存正文，请先切「简洁」再朗读'
            : '没有可朗读的正文'
      )
      return
    }
    try {
      await speakTextWithTts(text, undefined, { maxChars: 3500 })
    } catch (err) {
      flashAction(err instanceof Error ? err.message : String(err))
    }
  }

  function openTagMap(): void {
    if (mapOpen) {
      setMapOpen(false)
      return
    }
    if (showingDigest) closeDigest()
    const fallback = selected
      ? rssDayKey(rssEntryTime(selected) || Date.now())
      : localDateKey(Date.now())
    setMapDateKey((k) => k || fallback)
    setMapOpen(true)
    setStackFocus('detail')
  }

  function selectEntry(it: RssTaskEntry): void {
    setMapOpen(false)
    if (mapDateKey) setMapDateKey(rssDayKey(rssEntryTime(it) || Date.now()))
    setArticleError(null)
    setStackFocus('detail')
    setSuppressWebAutoExtract(false)
    const restore = showingDigest ? articleModeRef.current : readerMode === 'extract' ? 'extract' : 'web'
    // 先标已读再改其它字段，避免后续 patch 盖掉 readAt
    onSelectEntry(it)
    if (showingDigest) {
      onPatchRss({
        ...markRssEntryRead(rssRef.current, it.id),
        readerMode: restore,
        selectedId: it.id,
        updatedAt: Date.now()
      })
    }
    // 已有缓存正文（含模型）→ 简洁展示，不再调模型
    if (rssEntryHasUsableBody(it)) {
      if (restore !== 'web' || showingDigest) {
        onPatchRss({
          ...markRssEntryRead(rssRef.current, it.id),
          selectedId: it.id,
          readerMode: 'extract',
          updatedAt: Date.now()
        })
      }
      return
    }
    const extractMode = showingDigest ? restore === 'extract' : (rss.readerMode || 'web') === 'extract'
    // 点选且无正文：抓取 → 失败再用模型（仅一次，结果缓存）
    if (extractMode || rssEntryNeedsModelBody(it)) {
      if (
        articleMissingExpectedMedia(it.contentHtml) &&
        !isThinArticleHtml(it.contentHtml) &&
        !articleLooksLikeChrome(it.contentHtml)
      ) {
        if (mediaRefetchTried.current.has(it.id)) return
        mediaRefetchTried.current.add(it.id)
      }
      void loadArticle(it)
    }
  }

  /**
   * 用资讯模型整理正文并写入 modelHtml（不覆盖原文）。
   * @param opts.force 忽略失败缓存
   * @param opts.forceModel 强制走模型（「用模型整理」）；否则抓到完整原文可直接落 extract
   */
  async function recoverWithModel(
    it: RssTaskEntry,
    extractError?: string,
    opts?: { force?: boolean; forceModel?: boolean }
  ): Promise<boolean> {
    const force = opts?.force === true
    const forceModel = opts?.forceModel === true
    const entry = force ? { ...it, modelContentFailedAt: undefined } : it
    if (!force && !forceModel && !rssEntryNeedsModelBody(entry)) {
      return rssEntryHasUsableBody(entry)
    }
    if (modelRecoverInFlight.current.has(entry.id)) return false
    if (typeof window.petApi.recoverRssArticleWithModel !== 'function') {
      setArticleError('模型补全文接口未加载，请完全退出后重开应用')
      return false
    }
    modelRecoverInFlight.current.add(entry.id)
    setModelBusy(true)
    setArticleError(null)
    try {
      const sourceFallback = rssEntrySourceHtml(entry) || entry.contentHtml
      const r = await window.petApi.recoverRssArticleWithModel({
        url: entry.url,
        title: entry.title,
        snippet: entry.snippet,
        contentHtml: sourceFallback,
        modelRef: resolveIntelModelRef(),
        forceModel
      })
      const base = markRssEntryRead(rssRef.current, entry.id)
      if (!r.ok || !r.html) {
        const at = Date.now()
        const stillReadable = rssEntryHasDisplayableBody(it)
        onPatchRss({
          ...base,
          selectedId: it.id,
          readerMode: stillReadable ? 'extract' : 'web',
          items: base.items.map((x) =>
            x.id === it.id ? { ...x, modelContentFailedAt: at } : x
          ),
          updatedAt: at
        })
        if (!stillReadable) {
          setSuppressWebAutoExtract(true)
          setArticleError(
            [extractError, r.error || '模型未能整理正文']
              .filter(Boolean)
              .join(' · ') + '。可试网页或浏览器打开'
          )
        } else if (extractError) {
          setArticleError('未能拉全文；以下为订阅摘要')
        }
        return false
      }
      const fromExtract = r.mode === 'extract' && !forceModel
      onPatchRss({
        ...base,
        selectedId: it.id,
        readerMode: 'extract',
        items: base.items.map((x) => {
          if (x.id !== it.id) return x
          const titled = { ...x, title: x.title || r.title || x.title }
          return fromExtract
            ? withRssExtractHtml(titled, r.html!, 'extract')
            : withRssModelHtml(titled, r.html!)
        }),
        updatedAt: Date.now()
      })
      setArticleError(null)
      flashAction(fromExtract ? '已抓取原文（已缓存）' : '已生成整理版（已缓存）')
      if (!fromExtract) {
        showModelCacheHint(entry.id, String(r.html.length), { force: true })
      }
      return true
    } catch (err) {
      const base = markRssEntryRead(rssRef.current, it.id)
      const at = Date.now()
      const stillReadable = rssEntryHasDisplayableBody(it)
      onPatchRss({
        ...base,
        selectedId: it.id,
        readerMode: stillReadable ? 'extract' : 'web',
        items: base.items.map((x) =>
          x.id === it.id ? { ...x, modelContentFailedAt: at } : x
        ),
        updatedAt: at
      })
      if (!stillReadable) {
        setSuppressWebAutoExtract(true)
        setArticleError(err instanceof Error ? err.message : '模型整理失败')
      }
      return false
    } finally {
      modelRecoverInFlight.current.delete(entry.id)
      setModelBusy(false)
    }
  }

  /** 简洁：用模型整理 / 重新整理（写入整理版，不覆盖原文）。 */
  async function arrangeWithModel(): Promise<void> {
    if (!selected || modelBusy || articleBusy) return
    articleModeRef.current = 'extract'
    setSuppressWebAutoExtract(false)
    if (readerMode !== 'extract') {
      onPatchRss({ ...rssRef.current, readerMode: 'extract', updatedAt: Date.now() })
    }
    if (!rssEntryHasSourceBody(selected)) {
      await loadArticle(selected, { force: true })
    }
    const latest = selectedRssEntry(rssRef.current)
    const cur = latest?.id === selected.id ? latest : selected
    const ok = await recoverWithModel(cur, undefined, { force: true, forceModel: true })
    if (!ok && !rssEntryHasDisplayableBody(selectedRssEntry(rssRef.current) || selected)) {
      flashAction('未能生成整理版，可试网页或浏览器打开')
    }
  }

  function setExtractPane(pane: 'source' | 'model'): void {
    if (!selected) return
    onPatchRss({
      ...rssRef.current,
      items: rssRef.current.items.map((x) =>
        x.id === selected.id ? withRssExtractPane(x, pane) : x
      ),
      updatedAt: Date.now()
    })
  }

  /** 兼容旧调用名。 */
  async function generateBodyManually(): Promise<void> {
    return arrangeWithModel()
  }

  async function loadArticle(it: RssTaskEntry, opts?: { force?: boolean }): Promise<void> {
    // 已有原文或整理版且非强制重抓 → 直接展示
    if (!opts?.force && (rssEntryHasSourceBody(it) || rssEntryHasModelBody(it) || rssEntryHasUsableBody(it))) {
      const base = markRssEntryRead(rssRef.current, it.id)
      onPatchRss({
        ...base,
        selectedId: it.id,
        readerMode: 'extract',
        updatedAt: Date.now()
      })
      setArticleError(null)
      return
    }
    setArticleBusy(true)
    setArticleError(null)
    try {
      // 半截 RSS 摘要不能当「已有正文」fallback；优先用已缓存原文
      const localHtml = rssEntrySourceHtml(it) || it.contentHtml
      const localUsable =
        !!localHtml &&
        !isThinArticleHtml(localHtml) &&
        !articleLooksLikeChrome(localHtml)
      const fallbackHtml = localUsable
        ? localHtml
        : it.snippet?.trim()
          ? `<p>${it.snippet.trim()}</p>`
          : undefined
      const r = await window.petApi.fetchRssArticle(it.url, { fallbackHtml })
      // 必须以最新 state 为底，并保留 readAt——旧闭包会把未读红点写回来
      const base = markRssEntryRead(rssRef.current, it.id)
      if (r.ok && r.html) {
        onPatchRss({
          ...base,
          selectedId: it.id,
          readerMode: 'extract',
          items: base.items.map((x) =>
            x.id === it.id
              ? withRssExtractHtml(
                  { ...x, title: x.title || r.title || x.title },
                  r.html!,
                  r.partial ? 'feed' : 'extract'
                )
              : x
          ),
          updatedAt: Date.now()
        })
        // 有摘要可读 ≠ 全文失败：用提示而非红色「提取失败」
        if (r.partial) {
          setArticleError(r.error || '未能拉全文，以下为订阅摘要')
        } else {
          setArticleError(null)
          const n = articlePlainExcerpt(r.html, 20_000).length
          if (opts?.force && n > 0 && n < 320) {
            flashAction(`已抓取页面全文（短讯 ${n} 字，链接本身只有这些）`)
          }
        }
        // 摘要不够长时再异步补模型（有缓存则跳过）
        if (r.partial && rssEntryNeedsModelBody({ ...it, contentHtml: r.html, contentSource: 'feed' })) {
          void recoverWithModel(
            { ...it, contentHtml: r.html, contentSource: 'feed', modelContentFailedAt: undefined },
            undefined
          )
        }
        return
      }
      const cleared: RssTaskEntry = {
        ...it,
        contentHtml:
          it.contentHtml && articleLooksLikeChrome(it.contentHtml) ? undefined : it.contentHtml,
        modelContentFailedAt: opts?.force ? undefined : it.modelContentFailedAt
      }
      onPatchRss({
        ...base,
        selectedId: it.id,
        items: base.items.map((x) => (x.id === it.id ? { ...x, ...cleared } : x)),
        updatedAt: Date.now()
      })
      // 本地还有摘要/半截可读 → 留在简洁，别报「完全失败」
      if (rssEntryHasDisplayableBody(cleared)) {
        onPatchRss({
          ...markRssEntryRead(rssRef.current, it.id),
          selectedId: it.id,
          readerMode: 'extract',
          updatedAt: Date.now()
        })
        setArticleError('未能拉全文；以下为订阅摘要，可试网页或模型补全')
        if (rssEntryNeedsModelBody(cleared)) {
          void recoverWithModel(cleared, undefined)
        }
        return
      }
      const latest = selectedRssEntry(rssRef.current)
      const forModel = latest?.id === it.id ? { ...latest, ...cleared } : { ...it, ...cleared }
      const recovered = await recoverWithModel(forModel, r.error)
      if (recovered) return
      setSuppressWebAutoExtract(true)
      onPatchRss({
        ...markRssEntryRead(rssRef.current, it.id),
        selectedId: it.id,
        readerMode: 'web',
        updatedAt: Date.now()
      })
      if (!rssEntryHasDisplayableBody(selectedRssEntry(rssRef.current) || cleared)) {
        setArticleError(r.error || '未能提取正文，已切换网页')
      }
    } catch {
      if (rssEntryHasDisplayableBody(it)) {
        setArticleError('抓取异常；以下为已有摘要')
        return
      }
      const recovered = await recoverWithModel(it, '抓取失败')
      if (recovered) return
      const base = markRssEntryRead(rssRef.current, it.id)
      onPatchRss({
        ...base,
        selectedId: it.id,
        readerMode: 'web',
        updatedAt: Date.now()
      })
      setSuppressWebAutoExtract(true)
    } finally {
      setArticleBusy(false)
    }
  }

  function setFilter(next: RssTaskFilter): void {
    if (showingDigest) {
      closeDigest({ filter: next })
      return
    }
    onPatchRss({ ...rss, filter: next, updatedAt: Date.now() })
  }

  function setArticleReaderMode(mode: 'web' | 'extract'): void {
    articleModeRef.current = mode
    setSuppressWebAutoExtract(mode === 'web')
    if (mode === 'web' && selected && rssHostPrefersExtract(selected.url)) {
      flashAction('该站内嵌常不完整；不行再用「浏览器打开」')
    }
    onPatchRss({ ...rssRef.current, readerMode: mode, updatedAt: Date.now() })
    if (
      mode === 'extract' &&
      selected &&
      (isThinArticleHtml(selected.contentHtml) ||
        articleLooksLikeChrome(selected.contentHtml) ||
        articleMissingExpectedMedia(selected.contentHtml) ||
        !selected.contentHtml)
    ) {
      if (
        articleMissingExpectedMedia(selected.contentHtml) &&
        !isThinArticleHtml(selected.contentHtml) &&
        !articleLooksLikeChrome(selected.contentHtml) &&
        selected.contentHtml
      ) {
        if (mediaRefetchTried.current.has(selected.id)) return
        mediaRefetchTried.current.add(selected.id)
      }
      void loadArticle(selected)
    }
  }

  function setScoreThreshold(min: 3 | 4 | 5): void {
    onPatchRss({
      ...rss,
      scoreMinForValuable: min,
      filter: 'valuable',
      updatedAt: Date.now()
    })
  }

  // 已选中条在简洁模式且正文过短/导航壳/长文无图 → 自动重抓补媒体（有模型缓存则跳过）
  useEffect(() => {
    if (!selected || readerMode !== 'extract') return
    if (selected.contentSource === 'model' && rssEntryHasUsableBody(selected)) return
    const missingMedia = articleMissingExpectedMedia(selected.contentHtml)
    const need =
      isThinArticleHtml(selected.contentHtml) ||
      articleLooksLikeChrome(selected.contentHtml) ||
      missingMedia
    if (!need) return
    if (missingMedia && mediaRefetchTried.current.has(selected.id)) return
    if (articleBusy || modelBusy) return
    if (missingMedia) mediaRefetchTried.current.add(selected.id)
    void loadArticle(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, readerMode])

  function toggleDiscussion(): void {
    onPatchRss({
      ...rss,
      discussionPanel: showDiscussion ? 'hide' : 'show',
      updatedAt: Date.now()
    })
  }

  /** 划词松手：追加一段分析依赖（不强制开讨论）。 */
  function quoteFromSelection(text: string): void {
    onPatchRss(addRssAnalysisQuote(rss, text))
  }

  /** 划词点讨论：追加依赖 + 打开讨论栏 + 聚焦输入。 */
  function discussFromSelection(text: string): void {
    onPatchRss({
      ...addRssAnalysisQuote(rss, text),
      discussionPanel: 'show',
      updatedAt: Date.now()
    })
    onDiscussQuote?.()
  }

  function clearUnread(): void {
    const n = rssTaskUnreadCount(rss)
    onPatchRss({ ...markAllRssRead(rssRef.current), filter: 'all', updatedAt: Date.now() })
    if (n > 0) flashAction(`已将 ${n} 条未读标为已读`)
  }

  function saveFeeds(): void {
    const prevByUrl = new Map(rss.feeds.map((f) => [f.url, f]))
    const feeds = normalizeRssTaskFeeds(
      feedDraft.split(/\r?\n/).map((u) => {
        const url = u.trim()
        const prev = prevByUrl.get(url)
        return prev ? { url, title: prev.title, rating: prev.rating, avgScore: prev.avgScore, scoredCount: prev.scoredCount } : url
      })
    )
    const next: RssTaskState = {
      ...rss,
      feeds,
      updatedAt: Date.now(),
      lastError: feeds.length ? undefined : '请至少添加一个源'
    }
    onPatchRss(next)
    setFeedsOpen(false)
    if (!feeds.length) return
    void window.petApi.refreshRssTaskFeeds(feeds).then((res) => {
      const mergedFeeds = (res.feeds.length ? res.feeds : feeds).map((f) => {
        const prev = feeds.find((x) => x.id === f.id || x.url === f.url)
        return {
          ...f,
          rating: prev?.rating ?? f.rating,
          avgScore: prev?.avgScore ?? f.avgScore,
          scoredCount: prev?.scoredCount ?? f.scoredCount
        }
      })
      const merged = reconcileRssEntrySources({
        ...next,
        feeds: mergedFeeds,
        items: mergeRssTaskItems(rss.items, res.items),
        updatedAt: Date.now(),
        lastError: joinRssFeedErrors(res.errors)
      })
      onPatchRss(merged)
      const mode = normalizeRssScoreMode(merged.scoreMode ?? globalScoreMode)
      if (merged.scoreEnabled !== false && mode === 'realtime') void runScoring(merged, false, true)
    })
  }

  /** 关掉单条拉源提醒（其它源的错误还留着；顺带清掉空窗「无条目」）。 */
  function dismissFeedError(errorLine: string): void {
    const next = splitRssFeedActionableErrors(rss.lastError).filter((e) => e !== errorLine)
    onPatchRss({ ...rss, lastError: joinRssFeedErrors(next) })
  }

  /** 错误条「删除该源」：按单条文案匹配订阅并移除；其余错误分条保留。 */
  async function removeFailedFeeds(errorLine?: string): Promise<void> {
    const line = (errorLine || '').trim()
    const doomed = line
      ? feedsMatchingOneRssFeedError(rss.feeds, line)
      : feedsMatchingRssFeedError(rss.feeds, rss.lastError)
    if (!doomed.length) return
    const labels = doomed
      .map((f) => f.title?.trim() || (() => {
        try {
          return new URL(f.url).hostname
        } catch {
          return f.url
        }
      })())
      .slice(0, 3)
      .join('、')
    const ok = await confirmDestructiveAsync(
      doomed.length === 1
        ? `删除订阅源「${labels}」？其条目也会从本任务移除。`
        : `删除 ${doomed.length} 个失败源（${labels}${doomed.length > 3 ? '…' : ''}）？其条目也会从本任务移除。`
    )
    if (!ok) return
    const drop = new Set(doomed.map((f) => f.id))
    const feeds = rss.feeds.filter((f) => !drop.has(f.id))
    const items = rss.items.filter((it) => !drop.has(it.feedId))
    const selectedGone =
      !!rss.selectedId &&
      !isRssDigestThreadId(rss.selectedId) &&
      !items.some((it) => it.id === rss.selectedId)
    const keptErrors = splitRssFeedActionableErrors(rss.lastError).filter((e) => {
      if (line && e === line) return false
      const matched = feedsMatchingOneRssFeedError(rss.feeds, e)
      if (!matched.length) return true
      return matched.some((f) => !drop.has(f.id))
    })
    onPatchRss({
      ...rss,
      feeds,
      items,
      selectedId: selectedGone ? undefined : rss.selectedId,
      lastError: joinRssFeedErrors(keptErrors),
      updatedAt: Date.now()
    })
    setFeedDraft(feeds.map((f) => f.url).join('\n'))
    flashAction(doomed.length === 1 ? `已删除源 ${labels}` : `已删除 ${doomed.length} 个失败源`)
  }

  // 实时：有未评分条目时节流补评（打开任务 / 合并后）
  useEffect(() => {
    if (effectiveScoreMode !== 'realtime') return
    if (rss.scoreEnabled === false) return
    if (!entriesNeedingScore(rss, 1).length) return
    const t = window.setTimeout(() => {
      void runScoring(rssRef.current, false, true)
    }, 800)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, effectiveScoreMode, rss.items.length, unscoredCount])

  // 定时：按间隔批量评未打分条目
  useEffect(() => {
    if (effectiveScoreMode !== 'interval') return
    if (rss.scoreEnabled === false) return
    const ms = effectiveScoreInterval * 60_000
    const tick = (): void => {
      const cur = rssRef.current
      if (!entriesNeedingScore(cur, 1).length) return
      void runScoring(cur, false, true)
    }
    const id = window.setInterval(tick, ms)
    // 进入定时模式先跑一轮
    const first = window.setTimeout(tick, 1200)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, effectiveScoreMode, effectiveScoreInterval])

  const listSeg: 'all' | 'unread' | 'valuable' | 'feed' =
    filter === 'unread'
      ? 'unread'
      : filter === 'valuable' || filter.startsWith('score:')
        ? 'valuable'
        : feedFilterId
          ? 'feed'
          : 'all'

  // full：三栏；compact：两栏 + 讨论浮层；stack：列表/阅读互斥全宽
  const layoutMode: 'full' | 'compact' | 'stack' =
    hostWidth < 540 ? 'stack' : hostWidth < 900 ? 'compact' : 'full'
  const dockDiscussion = showDiscussion && layoutMode === 'full'
  const overlayDiscussion = showDiscussion && layoutMode !== 'full'
  const paneStyle =
    layoutMode === 'stack'
      ? ({ gridTemplateColumns: 'minmax(0, 1fr)' } as const)
      : dockDiscussion
        ? ({
            gridTemplateColumns: `minmax(0, ${listPct}%) minmax(0, 1fr) minmax(0, ${aiPct}%)`
          } as const)
        : ({
            gridTemplateColumns: `minmax(0, ${listPct}%) minmax(0, 1fr)`
          } as const)

  const aiPanel = (mode: 'dock' | 'overlay'): JSX.Element => (
    <section className="rss-col rss-col-ai" aria-label={uiText("讨论")}>
      {mode === 'dock' ? (
        <div
          className="rss-splitter rss-splitter-start"
          role="separator"
          aria-orientation="vertical"
          aria-label={uiText("调整讨论宽度")}
          title={uiText("拖动调整宽度")}
          onPointerDown={(e) => beginResize('ai', e)}
        />
      ) : null}
      <div className="rss-ai-head">
        <strong>{uiText("讨论")}</strong>
        {selected ? (
          <span className="rss-ai-sub" title={selected.title}>
            {truncate(selected.title, 28)}
          </span>
        ) : null}
        <button
          type="button"
          className="rss-icon-btn rss-ai-hide"
          title={uiText("收起")}
          aria-label={uiText("收起讨论")}
          onClick={() =>
            onPatchRss({ ...rss, discussionPanel: 'hide', updatedAt: Date.now() })
          }
        >
          ×
        </button>
      </div>
      <RssRelatedNews items={relatedNews} onOpen={selectEntry} compact />
      <div
        className="rss-ai-messages"
        ref={aiScrollRef}
        onScroll={onAiScroll}
        role="log"
        aria-live="polite"
      >
        {aiChildren}
        {!hasDiscussion ? <p className="rss-reader-status">{uiText("在下方输入框提问")}</p> : null}
      </div>
    </section>
  )

  const taskTagMap = (
    <RssTagMap
      items={mapItems}
      selected={readTag}
      onPick={setReadTag}
      emptyText={mapDateKey ? uiText("这天还没有实体") : uiText("这个任务还没有实体")}
      hint={
        readTag
          ? uiText("左侧只显示「{0}」", [readTag])
          : mapDateKey
            ? uiText("切日期时左侧资讯会跟着走 · 点节点再筛")
            : uiText("点节点筛选左侧列表 · 机构蓝 · 地名绿 · 产品紫 · 法案橙")
      }
    />
  )

  return (
    <div
      ref={rootRef}
      className={`rss-task-shell layout-${layoutMode}${
        layoutMode === 'stack' ? ` stack-${stackFocus}` : ''
      }`}
    >
    <div
      className={[
        'rss-task',
        dockDiscussion ? 'has-ai' : 'no-ai',
        resizing ? 'is-resizing' : '',
        `layout-${layoutMode}`,
        layoutMode === 'stack' ? `stack-${stackFocus}` : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={paneStyle}
    >
      <aside
        className="rss-col rss-col-list"
        aria-label={showingDigest ? uiText("简报记录") : uiText("订阅消息")}
      >
        <div
          className="rss-splitter rss-splitter-end"
          role="separator"
          aria-orientation="vertical"
          aria-label={uiText("调整列表宽度")}
          title={uiText("拖动调整宽度")}
          onPointerDown={(e) => beginResize('list', e)}
        />
        <div className="rss-list-chrome">
          <div className="rss-chrome-browse">
            <div className="rss-seg" role="group" aria-label={uiText("列表视图")}>
              <button
                type="button"
                className={!showingDigest && listSeg === 'all' ? 'on' : undefined}
                onClick={() => setFilter('all')}
              >
                {uiText("全部")}</button>
              <button
                type="button"
                className={!showingDigest && listSeg === 'unread' ? 'on' : undefined}
                onClick={() => setFilter('unread')}
              >
                {uiText("未读")}{unread ? ` ${unread}` : ''}
              </button>
              <button
                type="button"
                className={!showingDigest && listSeg === 'valuable' ? 'on' : undefined}
                onClick={() => {
                  if (showingDigest) {
                    closeDigest({ filter: 'valuable' })
                    return
                  }
                  setFilter('valuable')
                }}
                title={uiText("重点：{0}（≥{1}）", [rssValuableFilterLabel(scoreMin), scoreMin])}
              >
                {uiText("重点")}{valuableCount ? ` ${valuableCount}` : ''}
              </button>
              <button
                type="button"
                className={showingDigest ? 'on' : undefined}
                disabled={!rss.items.length && !digests.length}
                title={showingDigest ? uiText("关闭简报") : uiText("时段简报")}
                onClick={() => (showingDigest ? closeDigest() : openDigest())}
              >
                {uiText("简报")}</button>
            </div>
            <div className="rss-chrome-side">
              <button
                type="button"
                className={`rss-text-btn${mapOpen ? ' on' : ''}`}
                title={mapOpen ? uiText("关闭图谱") : uiText("打开主题知识图谱")}
                onClick={openTagMap}
              >
                {uiText("图谱")}</button>
              {mapDateKey ? (
                <button
                  type="button"
                  className="rss-text-btn"
                  title={uiText("看全部日期")}
                  onClick={() => setMapDateKey('')}
                >
                  {formatDayCaption(mapDateKey)} ×
                </button>
              ) : null}
              {onOpenToday ? (
                <button
                  type="button"
                  className="rss-text-btn"
                  title={uiText("回工作台看当天图谱")}
                  onClick={onOpenToday}
                >
                  {uiText("工作台")}</button>
              ) : null}
              <button
                type="button"
                className="rss-text-btn"
                title={uiText("管理订阅源")}
                onClick={() => setFeedsOpen(true)}
              >
                {uiText("源")}</button>
              {showingDigest ? (
                <button
                  type="button"
                  className={`rss-text-btn${digestCfgOpen ? ' on' : ''}`}
                  title={
                    digestCfgOpen ? uiText("收起生成面板") : uiText("现在生成（可选消息）或管理定时任务")
                  }
                  onClick={() => {
                    setScoreCfgOpen(false)
                    setDigestCfgOpen((v) => !v)
                  }}
                >
                  {digestCfgOpen ? uiText("收起") : uiText("生成")}
                </button>
              ) : (
                <button
                  type="button"
                  className={`rss-text-btn${scoreCfgOpen ? ' on' : ''}`}
                  title={uiText("评分节奏与模型")}
                  onClick={() => {
                    setDigestCfgOpen(false)
                    setScoreCfgOpen((v) => !v)
                  }}
                >
                  {uiText("评分")}{unscoredCount > 0 ? ` ${unscoredCount}` : ''}
                </button>
              )}
              {!showingDigest && unread > 0 ? (
                <button
                  type="button"
                  className="rss-text-btn"
                  title={uiText("一键将 {0} 条未读标为已读", [unread])}
                  onClick={() => clearUnread()}
                >
                  {uiText("全已读")}</button>
              ) : null}
              <button
                type="button"
                className="rss-icon-btn"
                disabled={refreshing}
                title={uiText("刷新")}
                aria-label={uiText("刷新")}
                onClick={() => void doRefresh()}
              >
                {refreshing ? '…' : '↻'}
              </button>
            </div>
          </div>

          {/* 重点时嵌套档位，无额外标签 */}
          {!showingDigest && listSeg === 'valuable' ? (
            <div className="rss-chrome-sub" role="group" aria-label={uiText("重点档位")}>
              <div className="rss-seg rss-seg-sm">
                {RSS_VALUABLE_MINS.map((min) => (
                  <button
                    key={min}
                    type="button"
                    className={scoreMin === min ? 'on' : undefined}
                    title={`${rssValuableFilterLabel(min)}：≥${min}`}
                    onClick={() => setScoreThreshold(min)}
                  >
                    {rssValuableFilterLabel(min)}
                    <span className="rss-seg-count">{valuableByMin[min]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {feedFilterTitle && !showingDigest ? (
            <div className="rss-chrome-sub rss-chrome-feed-filter">
              <span className="rss-list-status-text">{feedFilterTitle}</span>
              <button type="button" className="rss-text-btn" onClick={() => setFilter('all')}>
                {uiText("清除")}</button>
            </div>
          ) : null}

          {showingDigest && digestCfgOpen ? (
            <div className="rss-digest-cfg" aria-label={uiText("生成简报")}>
              <div className="rss-digest-cfg-tabs" role="tablist" aria-label={uiText("生成方式")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={digestCfgTab === 'now'}
                  className={digestCfgTab === 'now' ? 'on' : undefined}
                  onClick={() => setDigestCfgTab('now')}
                >
                  {uiText("现在生成")}</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={digestCfgTab === 'schedule'}
                  className={digestCfgTab === 'schedule' ? 'on' : undefined}
                  onClick={() => setDigestCfgTab('schedule')}
                >
                  {uiText("定时任务")}</button>
              </div>

              {digestCfgTab === 'now' ? (
                <section className="rss-digest-cfg-sec" aria-labelledby="rss-digest-now-h">
                  <h4 id="rss-digest-now-h" className="rss-digest-cfg-sec-h">
                    {uiText("一次性简报")}</h4>
                  <p className="rss-digest-cfg-sec-hint">
                    {uiText("选写法、收录范围，再勾选要纳入的消息后生成。与定时任务互不影响。")}</p>
                  <div className="rss-digest-cfg-grid">
                    <label
                      className="rss-digest-form-field"
                      title={rssDigestTemplateHint(digestTemplate)}
                    >
                      {uiText("形式")}<select
                        value={digestTemplate}
                        onChange={(e) =>
                          onPatchRss({
                            ...rss,
                            digestTemplate: normalizeRssDigestTemplate(e.target.value),
                            updatedAt: Date.now()
                          })
                        }
                      >
                        {RSS_DIGEST_TEMPLATE_GROUPS.map((g) => (
                          <optgroup key={g.id} label={`${g.label} · ${g.hint}`}>
                            {rssDigestTemplatesInGroup(g.id).map((t) => (
                              <option key={t} value={t} title={rssDigestTemplateHint(t)}>
                                {rssDigestTemplateLabel(t)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label
                      className="rss-intel-model"
                      title={uiText("与顶栏同一套模型树。可用大模型直连或 Agent 引擎。")}
                    >
                      {uiText("模型")}<ModelPicker
                        className="rss-intel-picker"
                        providers={providers}
                        value={effectiveScoreModel}
                        allowEmpty
                        emptyLabel={uiText("模板骨架")}
                        title={uiText("简报模型")}
                        onChange={setIntelModel}
                      />
                    </label>
                    <label
                      className="rss-digest-cfg-span"
                      title={uiText("先缩小候选范围，再在下方勾选消息")}
                    >
                      {uiText("收录")}<select
                        value={digestRangeSelect}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === 'custom') {
                            const def = defaultDigestCustomRange()
                            onPatchRss({
                              ...rss,
                              digestRangeFrom: rss.digestRangeFrom || def.from,
                              digestRangeTo: rss.digestRangeTo || def.to,
                              updatedAt: Date.now()
                            })
                            return
                          }
                          onPatchRss({
                            ...rss,
                            digestWindowHours: Number(v) as RssDigestWindowHours,
                            digestRangeFrom: undefined,
                            digestRangeTo: undefined,
                            updatedAt: Date.now()
                          })
                        }}
                      >
                        {RSS_DIGEST_WINDOWS.map((h) => (
                          <option key={h} value={h}>
                            {formatDigestWindow(h)}
                          </option>
                        ))}
                        <option value="custom">{uiText("自选日期")}</option>
                      </select>
                    </label>
                  </div>
                  <p className="rss-digest-form-blurb" title={rssDigestTemplateHint(digestTemplate)}>
                    {rssDigestTemplateBlurb(digestTemplate)}
                  </p>
                  {digestCustomRange ? (
                    <label className="rss-digest-date-range" title={uiText("按本地日历日筛选条目")}>
                      {uiText("自选日期")}<span className="rss-digest-dates">
                        <input
                          type="date"
                          value={rss.digestRangeFrom || ''}
                          max={rss.digestRangeTo || undefined}
                          onChange={(e) => {
                            const from = e.target.value
                            onPatchRss({
                              ...rss,
                              digestRangeFrom: from || undefined,
                              digestRangeTo: rss.digestRangeTo || defaultDigestCustomRange().to,
                              updatedAt: Date.now()
                            })
                          }}
                        />
                        <span className="rss-digest-dates-sep">{uiText("至")}</span>
                        <input
                          type="date"
                          value={rss.digestRangeTo || ''}
                          min={rss.digestRangeFrom || undefined}
                          onChange={(e) => {
                            const to = e.target.value
                            onPatchRss({
                              ...rss,
                              digestRangeFrom:
                                rss.digestRangeFrom || defaultDigestCustomRange().from,
                              digestRangeTo: to || undefined,
                              updatedAt: Date.now()
                            })
                          }}
                        />
                      </span>
                    </label>
                  ) : null}

                  <div className="rss-digest-pick">
                    <div className="rss-digest-pick-bar">
                      <span className="rss-digest-cfg-meta">
                        {uiText("消息")}{digestPickCount}/{digestWindowEntries.length}
                        {digestPickScoreMin > 0
                          ? uiText(" · 显示 {0}（{1}）", [digestVisibleEntries.length, rssDigestScoreMinLabel(digestPickScoreMin)])
                          : ''}
                        {digestBounds.label ? ` · ${digestBounds.label}` : ''}
                      </span>
                      <span className="rss-digest-pick-actions">
                        <button
                          type="button"
                          className="rss-text-btn"
                          disabled={
                            !digestVisibleEntries.length || digestVisibleAllSelected
                          }
                          title={
                            digestPickScoreMin > 0
                              ? uiText("全选当前筛选（{0}）", [rssDigestScoreMinLabel(digestPickScoreMin)])
                              : uiText("全选收录范围内全部消息")
                          }
                          onClick={() => {
                            if (digestPickScoreMin === 0) {
                              setDigestPickIds(null)
                              return
                            }
                            const ids = digestVisibleEntries.map((e) => e.id)
                            if (ids.length === digestWindowEntries.length) setDigestPickIds(null)
                            else setDigestPickIds(ids)
                          }}
                        >
                          {uiText("全选")}</button>
                        <button
                          type="button"
                          className="rss-text-btn"
                          disabled={!digestWindowEntries.length || digestPickCount === 0}
                          onClick={() => setDigestPickIds([])}
                        >
                          {uiText("清空")}</button>
                      </span>
                    </div>
                    <div
                      className="rss-seg rss-seg-sm rss-digest-pick-score"
                      role="group"
                      aria-label={uiText("按评分筛选消息")}
                    >
                      <button
                        type="button"
                        className={digestPickScoreMin === 0 ? 'on' : undefined}
                        title={uiText("显示并勾选全部消息")}
                        onClick={() => applyDigestScoreFilter(0)}
                      >
                        {uiText("全部")}<span className="rss-seg-count">{digestPickScoreCounts[0]}</span>
                      </button>
                      {RSS_VALUABLE_MINS.map((min) => (
                        <button
                          key={min}
                          type="button"
                          className={digestPickScoreMin === min ? 'on' : undefined}
                          title={uiText("显示并勾选 ≥{0}（{1}）", [min, rssValuableFilterLabel(min)])}
                          onClick={() => applyDigestScoreFilter(min)}
                        >
                          {rssValuableFilterLabel(min)}
                          <span className="rss-seg-count">{digestPickScoreCounts[min]}</span>
                        </button>
                      ))}
                    </div>
                    {digestWindowEntries.length ? (
                      digestVisibleEntries.length ? (
                        <ul className="rss-digest-pick-list" aria-label={uiText("勾选纳入简报的消息")}>
                          {digestVisibleEntries.map((e) => {
                            const on = digestPickSet.has(e.id)
                            return (
                              <li key={e.id}>
                                <label className="rss-digest-pick-row" title={e.title}>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => {
                                      const next = new Set(digestPickSet)
                                      if (on) next.delete(e.id)
                                      else next.add(e.id)
                                      const allIds = digestWindowEntries.map((x) => x.id)
                                      if (next.size === allIds.length) setDigestPickIds(null)
                                      else setDigestPickIds(allIds.filter((id) => next.has(id)))
                                    }}
                                  />
                                  <span className="rss-digest-pick-title">{e.title}</span>
                                  <span className="rss-digest-pick-meta">
                                    {rssEntrySourceLabel(rss, e) || uiText("源")}
                                    {e.valueScore ? ` · ${rssScoreLabel(e.valueScore)}` : ''}
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="rss-digest-cfg-meta is-warn">
                          {uiText("没有「")}{rssDigestScoreMinLabel(digestPickScoreMin)}{uiText("」消息。可换档位，或先去评分。")}</p>
                      )
                    ) : (
                      <p className="rss-digest-cfg-meta is-warn">
                        {uiText("该收录范围内没有消息。请先刷新订阅，或换个时间窗。")}</p>
                    )}
                  </div>

                  <div className="rss-digest-cfg-foot">
                    <p className="rss-digest-cfg-meta">
                      {uiText("将生成")}{digestPickCount} {uiText("条")}{!digestPickAll && digestPickCount > 0 ? uiText("（已勾选）") : ''}
                      {digestPickAll && digestCustomRange ? uiText(" · 自选多日按天拆份") : ''}
                      {digests.length ? uiText(" · 已有 {0} 份", [digests.length]) : ''}
                      {!effectiveScoreModel ? uiText(" · 模板骨架") : ''}
                    </p>
                    <button
                      type="button"
                      className={`rss-digest-submit${digestBusy ? ' is-busy' : ''}`}
                      disabled={digestBusy || digestPickCount === 0}
                      onClick={() => {
                        if (!digestPickAll) {
                          void runDigest(undefined, {
                            entryIds: digestWindowEntries
                              .filter((e) => digestPickSet.has(e.id))
                              .map((e) => e.id)
                          })
                          return
                        }
                        void runDigest()
                      }}
                    >
                      {digestBusy ? uiText("生成中…") : uiText("生成")}
                    </button>
                  </div>
                  {!scoreModels.length ? (
                    <p className="rss-digest-cfg-meta is-warn">
                      {uiText("还没有可用模型。请到设置添加大模型直连，或启用本机 Agent 引擎。")}</p>
                  ) : null}
                </section>
              ) : (
                <RssDigestSchedulePanel
                  conversationId={conversation.id}
                  sourceLabel={conversation.title || 'RSS'}
                  rss={rss}
                  providers={providers}
                  defaultModelRef={effectiveScoreModel || globalScoreModel}
                  onPatchRss={onPatchRss}
                  onOpenSchedules={onOpenSchedules}
                />
              )}
            </div>
          ) : null}

          {!showingDigest && scoreCfgOpen ? (
            <div className="rss-score-cfg" aria-label={uiText("评分")}>
              <div className="rss-score-cfg-grid">
                <label title={uiText("进任务会立刻拉源；之后按节奏后台再拉，并决定何时评分")}>
                  {uiText("节奏")}<select
                    value={effectiveScoreMode}
                    onChange={(e) => {
                      const mode = normalizeRssScoreMode(e.target.value)
                      onPatchRss({ ...rss, scoreMode: mode, updatedAt: Date.now() })
                      window.petApi.setRssScoreMode(mode)
                      setGlobalScoreMode(mode)
                    }}
                  >
                    <option value="realtime">{uiText("实时")}</option>
                    <option value="interval">{uiText("定时")}</option>
                    <option value="off">{uiText("仅手动")}</option>
                  </select>
                </label>
                <label
                  className="rss-intel-model"
                  title={uiText("与顶栏同一套模型树。可用大模型直连或 Agent 引擎。")}
                >
                  {uiText("模型")}<ModelPicker
                    className="rss-intel-picker"
                    providers={providers}
                    value={effectiveScoreModel}
                    allowEmpty
                    emptyLabel={uiText("规则评分")}
                    title={uiText("评分模型")}
                    onChange={setIntelModel}
                  />
                </label>
                {effectiveScoreMode === 'interval' ? (
                  <label className="rss-score-interval" title={uiText("批量补评间隔")}>
                    {uiText("间隔")}<select
                      value={effectiveScoreInterval}
                      onChange={(e) => {
                        const mins = normalizeRssScoreIntervalMinutes(Number(e.target.value))
                        onPatchRss({ ...rss, scoreIntervalMinutes: mins, updatedAt: Date.now() })
                        window.petApi.setRssScoreIntervalMinutes(mins)
                        setGlobalScoreInterval(mins)
                      }}
                    >
                      {RSS_SCORE_INTERVALS.map((m) => (
                        <option key={m} value={m}>
                          {m} {uiText("分钟")}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="rss-score-cfg-foot">
                <p className="rss-score-cfg-hint">
                  {uiText("启动后后台拉源，不必进任务")}{effectiveScoreMode === 'realtime'
                    ? uiText(" · 约 {0} 分钟再拉 · 进任务后新条目即评", [Math.round(RSS_REALTIME_FETCH_MS / 60_000)])
                    : effectiveScoreMode === 'interval'
                      ? uiText(" · 每 {0} 分后台拉 · 进任务后按间隔评", [effectiveScoreInterval])
                      : uiText(" · 仅手动刷新")}
                  {' · '}
                  {effectiveScoreModel ? uiText("模型") : uiText("规则")}
                  {unscoredCount > 0 ? uiText(" · 未评 {0}", [unscoredCount]) : ''}
                </p>
                <div className="rss-score-actions">
                  <button
                    type="button"
                    className={`rss-score-submit${scoreBusy ? ' is-busy' : ''}`}
                    disabled={scoreBusy || !rss.items.length}
                    title={
                      unscoredCount > 0
                        ? uiText("立即评 {0} 条未打分", [unscoredCount])
                        : uiText("当前没有未评分条目")
                    }
                    onClick={() => {
                      if (unscoredCount === 0) {
                        flashAction('没有未评分条目 · 可点「重评」')
                        return
                      }
                      void runScoring(undefined, false)
                    }}
                  >
                    {scoreBusy ? '…' : unscoredCount > 0 ? uiText("补评 {0}", [unscoredCount]) : uiText("补评")}
                  </button>
                  <button
                    type="button"
                    className="rss-score-submit ghost"
                    disabled={scoreBusy || !rss.items.length}
                    title={uiText("强制重评最近条目（最多 80）")}
                    onClick={() => void runScoring(undefined, true)}
                  >
                    {uiText("重评")}</button>
                </div>
              </div>
            </div>
          ) : null}

          {actionFlash ||
          scoreBusy ||
          digestBusy ||
          rss.scoring?.error ||
          (rss.disposition &&
            rss.disposition.stage !== 'idle' &&
            rss.disposition.stage !== 'done') ? (
            <div
              className={`rss-action-flash${
                rss.scoring?.status === 'error' ||
                rss.lastDigestError ||
                rss.disposition?.stage === 'skeleton' ||
                (rss.scoring?.error && !scoreBusy)
                  ? ' is-warn'
                  : ''
              }${scoreBusy || digestBusy ? ' is-busy' : ''}`}
              role="status"
            >
              {scoreBusy
                ? actionFlash || uiText("评分中…")
                : digestBusy
                  ? actionFlash ||
                    rss.disposition?.detail ||
                    dispositionLabel(rss.disposition?.stage || 'digesting') ||
                    uiText("处置中…")
                  : actionFlash ||
                    (rss.disposition?.stage === 'skeleton'
                      ? rss.disposition.detail || dispositionLabel('skeleton')
                      : null) ||
                    (rss.scoring?.error
                      ? humanizeRssIntelError(rss.scoring.error)
                      : null)}
              {!scoreBusy && !digestBusy && (rss.scoring?.error || rss.disposition?.stage === 'skeleton') ? (
                <button
                  type="button"
                  className="rss-error-x"
                  title={uiText("关闭提示")}
                  onClick={() =>
                    onPatchRss({
                      ...rss,
                      scoring: rss.scoring
                        ? { ...rss.scoring, status: 'idle', error: undefined, updatedAt: Date.now() }
                        : rss.scoring,
                      disposition:
                        rss.disposition?.stage === 'skeleton'
                          ? { stage: 'idle', updatedAt: Date.now() }
                          : rss.disposition
                    })
                  }
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!showingDigest && feedErrors.length
          ? feedErrors.length > 1 && !feedErrorsExpanded
            ? (
                <div className="rss-error" role="alert">
                  <span
                    className="rss-error-text"
                    title={feedErrors.join('\n')}
                  >
                    {summarizeRssFeedErrors(feedErrors)}
                  </span>
                  <span className="rss-error-actions">
                    <button
                      type="button"
                      className="rss-error-action"
                      onClick={() => setFeedErrorsExpanded(true)}
                    >
                      {uiText("明细")}</button>
                    {feedsMatchingRssFeedError(rss.feeds, rss.lastError).length ? (
                      <button
                        type="button"
                        className="rss-error-action is-danger"
                        onClick={() => void removeFailedFeeds()}
                      >
                        {uiText("删除失败源")}</button>
                    ) : null}
                    <button
                      type="button"
                      className="rss-error-action"
                      disabled={refreshing || !rss.feeds.length}
                      onClick={() => void doRefresh()}
                    >
                      {refreshing ? uiText("重试中…") : uiText("重试")}
                    </button>
                    <button
                      type="button"
                      className="rss-error-x"
                      title={uiText("关闭全部失败提示")}
                      aria-label={uiText("关闭全部失败提示")}
                      onClick={() => onPatchRss({ ...rss, lastError: undefined })}
                    >
                      ×
                    </button>
                  </span>
                </div>
              )
            : (
                <>
                  {feedErrors.length > 1 ? (
                    <div className="rss-error rss-error-toolbar" role="status">
                      <span className="rss-error-text">
                        {feedErrors.length} {uiText("类失败 · 明细")}</span>
                      <span className="rss-error-actions">
                        <button
                          type="button"
                          className="rss-error-action"
                          onClick={() => setFeedErrorsExpanded(false)}
                        >
                          {uiText("收起")}</button>
                        {feedsMatchingRssFeedError(rss.feeds, rss.lastError).length ? (
                          <button
                            type="button"
                            className="rss-error-action is-danger"
                            onClick={() => void removeFailedFeeds()}
                          >
                            {uiText("删除失败源")}</button>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                  {feedErrors.map((err) => {
                    const matched = feedsMatchingOneRssFeedError(rss.feeds, err)
                    return (
                      <div key={err} className="rss-error" role="alert">
                        <span className="rss-error-text" title={err}>
                          {err}
                        </span>
                        <span className="rss-error-actions">
                          {matched.length ? (
                            <button
                              type="button"
                              className="rss-error-action is-danger"
                              onClick={() => void removeFailedFeeds(err)}
                            >
                              {uiText("删除该源")}</button>
                          ) : null}
                          <button
                            type="button"
                            className="rss-error-action"
                            disabled={refreshing || !rss.feeds.length}
                            onClick={() => void doRefresh()}
                          >
                            {refreshing ? uiText("重试中…") : uiText("重试")}
                          </button>
                          <button
                            type="button"
                            className="rss-error-x"
                            title={uiText("关闭这条提示")}
                            aria-label={uiText("关闭这条提示")}
                            onClick={() => dismissFeedError(err)}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </>
              )
          : null}

        {showingDigest ? (
          <div className="rss-digest-archive">
            <div className="rss-digest-archive-head">
              <div className="rss-digest-archive-title">
                <span className="rss-digest-archive-label">{uiText("已生成")}</span>
                <span className="rss-digest-archive-count">{digests.length}</span>
              </div>
              {digestFilterChips.length > 1 ? (
                <div className="rss-seg rss-seg-sm rss-digest-type-seg" role="group" aria-label={uiText("按生成形式筛选")}>
                  <button
                    type="button"
                    className={digestTemplateFilter === 'all' ? 'on' : undefined}
                    onClick={() => setDigestTemplateFilter('all')}
                  >
                    {uiText("全部")}<span className="rss-seg-count">{digests.length}</span>
                  </button>
                  {digestFilterChips.map(({ t, n }) => (
                    <button
                      key={t}
                      type="button"
                      className={digestTemplateFilter === t ? 'on' : undefined}
                      title={rssDigestTemplateHint(t)}
                      onClick={() => setDigestTemplateFilter(t)}
                    >
                      {rssDigestTemplateShort(t)}
                      <span className="rss-seg-count">{n}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <ul className="rss-entry-list rss-digest-history">
              {!digests.length ? (
                <li className="rss-empty">
                  <span className="rss-empty-actions">
                    {uiText("还没有简报")}<button
                      type="button"
                      className="rss-text-btn"
                      disabled={digestBusy || !windowEntryCount}
                      onClick={() => {
                        setDigestCfgOpen(true)
                        setDigestCfgTab('now')
                      }}
                    >
                      {uiText("去生成")}</button>
                  </span>
                </li>
              ) : (
                (() => {
                  const visible =
                    digestTemplateFilter === 'all'
                      ? digests
                      : digests.filter(
                          (d) => normalizeRssDigestTemplate(d.template) === digestTemplateFilter
                        )
                  if (!visible.length) {
                    const filterLabel =
                      digestTemplateFilter === 'all'
                        ? uiText("简报")
                        : rssDigestTemplateLabel(digestTemplateFilter)
                    return (
                      <li className="rss-empty">
                        {uiText("没有「")}{filterLabel}{uiText("」简报")}<button
                          type="button"
                          className="rss-text-btn"
                          onClick={() => setDigestTemplateFilter('all')}
                        >
                          {uiText("看全部")}</button>
                      </li>
                    )
                  }
                  return visible.map((d) => {
                    const tmpl = normalizeRssDigestTemplate(d.template)
                    const discussed = rssEntryHasDiscussion(threads, rssDigestThreadId(d.id))
                    const on = activeDigest?.id === d.id
                    const title = rssDigestDisplayTitle(d)
                    return (
                      <li key={d.id} className="rss-digest-row">
                        <button
                          type="button"
                          className={[
                            'rss-entry',
                            'rss-digest-entry',
                            on ? 'on' : '',
                            discussed ? 'has-chat' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => selectDigestRecord(d.id)}
                          title={rssDigestTemplateBlurb(tmpl)}
                        >
                          <span className="rss-entry-meta">
                            <span className="rss-entry-source" title={rssDigestTemplateHint(tmpl)}>
                              {rssDigestTemplateShort(tmpl)}
                            </span>
                            <span>{relativeTime(d.createdAt)}</span>
                          </span>
                          <span className="rss-entry-title">
                            {discussed ? <i className="rss-dot" aria-hidden /> : null}
                            {title}
                          </span>
                          <span className="rss-digest-entry-sub">
                            {rssDigestTemplateLabel(tmpl)} · {formatDigestDateTime(d.createdAt)} ·{' '}
                            {formatDigestRangeLabel(d)}
                            {d.entryCount
                              ? d.windowCount && d.windowCount > d.entryCount
                                ? uiText(" · 纳入 {0}/{1} 条", [d.entryCount, d.windowCount])
                                : uiText(" · 纳入 {0} 条", [d.entryCount])
                              : ''}
                            {d.mode === 'heuristic' ? uiText(" · 骨架") : ''}
                            {d.error ? uiText(" · 未完成模型") : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="rss-digest-del"
                          title={uiText("删除简报")}
                          aria-label={uiText("删除简报 {0}", [title])}
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteDigestRecord(d.id)
                          }}
                        >
                          ×
                        </button>
                      </li>
                    )
                  })
                })()
              )}
            </ul>
          </div>
        ) : (
          <ul className="rss-entry-list">
            {!rss.feeds.length ? (
              <li className="rss-empty">{uiText("添加订阅源后开始阅读")}</li>
            ) : list.length === 0 ? (
              <li className="rss-empty">
                {mapDateKey ? (
                  <span className="rss-empty-actions">
                    {formatDayCaption(mapDateKey)}{uiText("没有条目")}<button type="button" className="rss-text-btn" onClick={() => setMapDateKey('')}>
                      {uiText("看全部")}</button>
                  </span>
                ) : filter === 'unread' ? (
                  uiText("没有未读")
                ) : filter === 'valuable' || filter.startsWith('score:') ? (
                  unscoredCount > 0 ? (
                    <span className="rss-empty-actions">
                      {uiText("还没有达到「")}{rssValuableFilterLabel(scoreMin)}{uiText("」的条目")}<button
                        type="button"
                        className="rss-text-btn"
                        disabled={scoreBusy}
                        onClick={() => void runScoring(rss, true)}
                      >
                        {scoreBusy ? uiText("评分中…") : uiText("先评 {0} 条", [Math.min(unscoredCount, 40)])}
                      </button>
                    </span>
                  ) : (
                    uiText("没有「{0}」条目，可点上方阈值切换", [rssValuableFilterLabel(scoreMin)])
                  )
                ) : (
                  uiText("暂无条目，点刷新")
                )}
              </li>
            ) : (
              dayGroups.map((g) => (
                <li key={g.dayKey} className="rss-day-group">
                  <div className="rss-day-label">
                    <span>{g.label}</span>
                    <span className="rss-day-count">{g.entries.length}</span>
                  </div>
                  <ul className="rss-day-entries">
                    {g.entries.map((it) => {
                      const discussed = rssEntryHasDiscussion(threads, it.id)
                      const unreadItem = rssEntryIsUnread(it)
                      return (
                        <li key={it.id}>
                          <button
                            type="button"
                            data-rss-entry-id={it.id}
                            className={[
                              'rss-entry',
                              selected?.id === it.id ? 'on' : '',
                              unreadItem ? 'unread' : 'read',
                              discussed ? 'has-chat' : '',
                              it.valueScore != null && it.valueScore >= 5
                                ? 'is-must'
                                : it.valueScore != null && it.valueScore >= 4
                                  ? 'is-worth'
                                  : '',
                              it.pinnedAt ? 'pinned' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => selectEntry(it)}
                          >
                            <span className="rss-entry-title">
                              {it.pinnedAt ? (
                                <span className="rss-pin" title={uiText("已钉")} aria-hidden>
                                  ⊙
                                </span>
                              ) : null}
                              {it.title}
                            </span>
                            <span className="rss-entry-meta">
                              {it.valueScore != null && it.valueScore >= 4 ? (
                                <span
                                  className={`rss-score-chip s${it.valueScore}`}
                                  title={`${it.valueScore} ${rssScoreLabel(it.valueScore)}${it.scoreReason ? ` · ${it.scoreReason}` : ''}`}
                                >
                                  {rssScoreLabel(it.valueScore)}
                                </span>
                              ) : null}
                              <span
                                className="rss-entry-source"
                                title={rssEntrySourceLabel(rss, it)}
                              >
                                {rssShortSourceLabel(rssEntrySourceLabel(rss, it))}
                              </span>
                              {rssEntryTagList(it)
                                .slice(0, 2)
                                .map((tag) => (
                                  <span key={tag} className="rss-entry-tag">
                                    {tag}
                                  </span>
                                ))}
                              <span className="rss-entry-time">
                                {relativeTime(it.publishedAt || it.fetchedAt)}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        )}
      </aside>

      <section className="rss-col rss-col-reader" aria-label={showingDigest ? uiText("简报内容") : mapOpen ? uiText("主题图谱") : uiText("原文")}>
        {mapOpen && !showingDigest ? (
          <div className="rss-map-view">
            <DateTimeline
              compact
              dateKey={mapDateKey || localDateKey(Date.now())}
              onChange={setMapDateKey}
              markedDays={rssMarkedDays}
            />
            {taskTagMap}
          </div>
        ) : showingDigest ? (
          <div className="rss-digest-view">
            <header className="rss-reader-head">
              {layoutMode === 'stack' ? (
                <button
                  type="button"
                  className="rss-back-btn"
                  onClick={() => setStackFocus('list')}
                >
                  {uiText("← 列表")}</button>
              ) : null}
              {activeDigest && digestNav.total > 1 ? (
                <div className="rss-reader-nav" role="group" aria-label={uiText("简报切换")}>
                  <button
                    type="button"
                    className="settings-btn tiny"
                    disabled={!digestNav.prev}
                    title={uiText("上一份简报（← / K）")}
                    onClick={() => digestNav.prev && selectDigestRecord(digestNav.prev.id)}
                  >
                    {uiText("← 上一篇")}</button>
                  <span className="rss-reader-nav-pos">
                    {digestNav.index + 1}/{digestNav.total}
                  </span>
                  <button
                    type="button"
                    className="settings-btn tiny"
                    disabled={!digestNav.next}
                    title={uiText("下一份简报（→ / J）")}
                    onClick={() => digestNav.next && selectDigestRecord(digestNav.next.id)}
                  >
                    {uiText("下一篇 →")}</button>
                </div>
              ) : null}
              <h2>
                {activeDigest ? rssDigestDisplayTitle(activeDigest) : uiText("简报")}
              </h2>
              <div className="rss-reader-toolbar rss-digest-toolbar">
                <span className="rss-reader-meta-text">
                  {activeDigest
                    ? `${formatDigestDateTime(activeDigest.createdAt)} · ${formatDigestRangeLabel(
                        activeDigest
                      )} · ${
                        activeDigest.mode === 'model' ? uiText("模型归纳") : uiText("模板骨架")
                      }${
                        activeDigest.entryCount != null
                          ? activeDigest.windowCount &&
                            activeDigest.windowCount > activeDigest.entryCount
                            ? uiText(" · 纳入 {0}/{1} 条", [activeDigest.entryCount, activeDigest.windowCount])
                            : uiText(" · 纳入 {0} 条", [activeDigest.entryCount])
                          : ''
                      }${
                        activeDigest.template
                          ? ` · ${rssDigestTemplateLabel(activeDigest.template)}`
                          : ''
                      }`
                    : uiText("窗内 {0} 条 · 在左侧点「生成」", [windowEntryCount])}
                </span>
                <div className="rss-reader-actions rss-digest-actions">
                  {activeDigest ? (
                    <button
                      type="button"
                      className={`settings-btn tiny${digestBusy ? ' is-busy' : ''}`}
                      disabled={digestBusy || !rss.items.length}
                      title={uiText("按本份的时间窗与形式重新生成（保留讨论）")}
                      onClick={() => void runDigest(undefined, { replaceId: activeDigest.id })}
                    >
                      {digestBusy ? uiText("生成中…") : uiText("重新生成")}
                    </button>
                  ) : null}
                  {activeDigest?.markdown ? (
                    <button
                      type="button"
                      className="settings-btn tiny"
                      title={uiText("导出为 Markdown")}
                      onClick={exportActiveDigest}
                    >
                      {uiText("导出")}</button>
                  ) : null}
                  {ttsEnabled && activeDigest?.markdown ? (
                    <button
                      type="button"
                      className={`settings-btn tiny${readerSpeaking ? ' is-on' : ''}`}
                      title={readerSpeaking ? uiText("停止朗读") : uiText("朗读当前简报")}
                      onClick={() => void speakReader()}
                    >
                      {readerSpeaking ? uiText("停止") : uiText("朗读")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`rss-panel-toggle${showDiscussion ? ' on' : ''}${hasDiscussion && !showDiscussion ? ' has-dot' : ''}`}
                    onClick={toggleDiscussion}
                    title={showDiscussion ? uiText("收起右侧讨论") : uiText("打开右侧讨论")}
                  >
                    {showDiscussion ? uiText("收起讨论") : uiText("讨论")}
                  </button>
                </div>
              </div>
              {activeDigest?.error || (!activeDigest?.markdown && rss.lastDigestError) ? (
                <p className="rss-error rss-digest-error" role="status">
                  {activeDigest?.mode === 'heuristic' && activeDigest?.markdown
                    ? humanizeRssIntelError(activeDigest.error || rss.lastDigestError)
                    : humanizeRssIntelError(
                        activeDigest?.error || rss.lastDigestError
                      )}
                  {activeDigest?.markdown ? (
                    <button
                      type="button"
                      className="rss-error-action"
                      disabled={digestBusy || !rss.items.length}
                      title={uiText("按本份时间窗与形式再试模型")}
                      onClick={() => void runDigest(undefined, { replaceId: activeDigest.id })}
                    >
                      {digestBusy ? uiText("生成中…") : uiText("重新生成")}
                    </button>
                  ) : null}
                </p>
              ) : null}
            </header>
            {activeDigest?.markdown ? (
              <RssSelectableContent
                className="rss-reader-body"
                onQuote={quoteFromSelection}
                onDiscuss={discussFromSelection}
              >
                <div className="rss-prose rss-digest-md">
                  <MarkdownHtml text={activeDigest.markdown} className="md" />
                </div>
              </RssSelectableContent>
            ) : (
              <div className="rss-reader-empty">
                <p className="rss-empty-title">
                  {digestBounds.label} {uiText("简报")}</p>
                <p>
                  {uiText("当前窗内")}{windowEntryCount} {uiText("条。在左侧点「生成」选范围与模型；生成后按时间列出，点开阅读与讨论。")}</p>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => {
                    setScoreCfgOpen(false)
                    setDigestCfgOpen(true)
                  }}
                >
                  {uiText("去生成")}</button>
              </div>
            )}
          </div>
        ) : !selected ? (
          <div className="rss-reader-empty">
            <p className="rss-empty-title">{uiText("选一条开始读")}</p>
            <p>{uiText("想先抓重点：用「重点」筛选，或打开「简报」看时段综述。")}</p>
            <button
              type="button"
              className="rss-text-btn"
              disabled={!rss.items.length}
              onClick={openDigest}
            >
              {uiText("打开简报")}</button>
          </div>
        ) : (
          <>
            <header className="rss-reader-head">
              {layoutMode === 'stack' ? (
                <button
                  type="button"
                  className="rss-back-btn"
                  onClick={() => setStackFocus('list')}
                >
                  {uiText("← 列表")}</button>
              ) : null}
              {entryNav.total > 0 ? (
                <div className="rss-reader-nav" role="group" aria-label={uiText("篇目切换")}>
                  <button
                    type="button"
                    className="settings-btn tiny"
                    disabled={!entryNav.prev}
                    title={uiText("上一篇（← / K）")}
                    onClick={() => entryNav.prev && selectEntry(entryNav.prev)}
                  >
                    {uiText("← 上一篇")}</button>
                  <span className="rss-reader-nav-pos">
                    {entryNav.index >= 0 ? entryNav.index + 1 : '—'}/{entryNav.total}
                  </span>
                  <button
                    type="button"
                    className="settings-btn tiny"
                    disabled={!entryNav.next}
                    title={uiText("下一篇（→ / J）")}
                    onClick={() => entryNav.next && selectEntry(entryNav.next)}
                  >
                    {uiText("下一篇 →")}</button>
                </div>
              ) : null}
              <h2>
                <button
                  type="button"
                  className="rss-title-link"
                  title={uiText("在浏览器打开")}
                  onClick={() => window.petApi.openExternal(selected.url)}
                >
                  {selected.title}
                </button>
              </h2>
              <div className="rss-reader-toolbar">
                {layoutMode === 'full' ? (
                  <span className="rss-reader-meta-text">
                    {rssEntrySourceLabel(rss, selected)} ·{' '}
                    {relativeTime(selected.publishedAt || selected.fetchedAt)}
                    {selected.valueScore != null
                      ? ` · ${rssScoreLabel(selected.valueScore)}${selected.scoreReason ? `（${selected.scoreReason}）` : ''}`
                      : ''}
                  </span>
                ) : null}
                <div className="rss-seg rss-seg-sm" role="group" aria-label={uiText("阅读方式")}>
                  <button
                    type="button"
                    className={readerMode === 'web' ? 'on' : undefined}
                    onClick={() => setArticleReaderMode('web')}
                  >
                    {uiText("网页")}</button>
                  <button
                    type="button"
                    className={readerMode === 'extract' ? 'on' : undefined}
                    disabled={articleBusy}
                    onClick={() => setArticleReaderMode('extract')}
                  >
                    {articleBusy && readerMode === 'extract'
                      ? '…'
                      : modelBusy
                        ? uiText("整理中")
                        : uiText("简洁")}
                  </button>
                </div>
                {readerMode === 'extract' && rssEntryHasModelBody(selected) ? (
                  <div className="rss-seg rss-seg-sm" role="group" aria-label={uiText("简洁正文版本")}>
                    <button
                      type="button"
                      className={
                        (selected.extractPane || 'source') !== 'model' ? 'on' : undefined
                      }
                      disabled={!rssEntryHasSourceBody(selected) && !selected.snippet}
                      title={uiText("抓取的原文")}
                      onClick={() => setExtractPane('source')}
                    >
                      {uiText("原文")}</button>
                    <button
                      type="button"
                      className={(selected.extractPane || 'source') === 'model' ? 'on' : undefined}
                      title={uiText("模型整理版（已缓存）")}
                      onClick={() => setExtractPane('model')}
                    >
                      {uiText("整理版")}</button>
                  </div>
                ) : null}
                <div className="rss-reader-actions">
                  {readerMode === 'extract' ? (
                    <button
                      type="button"
                      className={`settings-btn tiny${modelBusy ? ' is-busy' : ''}`}
                      disabled={articleBusy || modelBusy}
                      title={
                        rssEntryHasModelBody(selected)
                          ? uiText("重新用模型整理（不覆盖原文）")
                          : uiText("用模型整理排版/媒体，生成整理版并缓存")
                      }
                      onClick={() => void arrangeWithModel()}
                    >
                      {modelBusy
                        ? uiText("整理中…")
                        : rssEntryHasModelBody(selected)
                          ? uiText("重新整理")
                          : uiText("用模型整理")}
                    </button>
                  ) : null}
                  {ttsEnabled ? (
                    <button
                      type="button"
                      className={`settings-btn tiny${readerSpeaking ? ' is-on' : ''}`}
                      title={
                        readerSpeaking
                          ? uiText("停止朗读")
                          : readerMode === 'web'
                            ? uiText("朗读缓存正文（网页无缓存时请先切简洁）")
                            : uiText("朗读当前正文")
                      }
                      onClick={() => void speakReader()}
                    >
                      {readerSpeaking ? uiText("停止") : uiText("朗读")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`rss-panel-toggle${showDiscussion ? ' on' : ''}${hasDiscussion && !showDiscussion ? ' has-dot' : ''}`}
                    onClick={toggleDiscussion}
                  >
                    {showDiscussion ? uiText("收起讨论") : uiText("讨论")}
                  </button>
                  <div className="rss-more" ref={moreRef}>
                    <button
                      type="button"
                      className="rss-icon-btn"
                      aria-label={uiText("更多")}
                      aria-expanded={moreOpen}
                      onClick={() => setMoreOpen((v) => !v)}
                    >
                      ⋯
                    </button>
                    {moreOpen ? (
                      <div className="cpet-menu rss-more-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            window.petApi.openExternal(selected.url)
                            setMoreOpen(false)
                          }}
                        >
                          <span>{uiText("浏览器打开")}</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            exportActiveEntry()
                            setMoreOpen(false)
                          }}
                        >
                          <span>{uiText("导出 Markdown")}</span>
                        </button>
                        <div className="cpet-menu-sep" role="separator" />
                        <button
                          type="button"
                          role="menuitem"
                          className={selected.pinnedAt ? 'is-current' : undefined}
                          onClick={() => {
                            onPatchRss(toggleRssEntryPin(rss, selected.id))
                            setMoreOpen(false)
                          }}
                        >
                          <span>{selected.pinnedAt ? uiText("取消钉住") : uiText("钉住")}</span>
                          {selected.pinnedAt ? (
                            <span className="cpet-menu-check">✓</span>
                          ) : null}
                        </button>
                        {readerMode === 'extract' || readerMode === 'web' ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={articleBusy || modelBusy}
                            onClick={() => {
                              void loadArticle(selected, { force: true })
                              setMoreOpen(false)
                            }}
                          >
                            <span>{uiText("重新抓取网页正文")}</span>
                          </button>
                        ) : null}
                        {readerMode === 'extract' ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={articleBusy || modelBusy}
                            onClick={() => {
                              void generateBodyManually()
                              setMoreOpen(false)
                            }}
                          >
                            <span>
                              {rssEntryHasModelBody(selected) ? uiText("重新整理（模型）") : uiText("用模型整理")}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </header>
            {articleError ? (
              <p
                className={
                  selected && rssEntryHasDisplayableBody(selected) ? 'rss-web-hint' : 'rss-error'
                }
              >
                {articleError}
              </p>
            ) : null}
            {readerMode === 'extract' &&
            rssEntryDisplayHtml(selected) &&
            articleNeedsWebHint(rssEntryDisplayHtml(selected)) ? (
              <p className="rss-web-hint">
                {uiText("图表较复杂，简洁可能显示不全。")}<button type="button" onClick={() => setArticleReaderMode('web')}>
                  {uiText("改看网页")}</button>
              </p>
            ) : null}
            {readerMode === 'web' ? (
              <>
                <RssWebFrame
                  key={`${selected.id}:${suppressWebAutoExtract ? 'force' : 'auto'}`}
                  url={selected.url}
                  suppressAutoExtract={suppressWebAutoExtract}
                  onPreferExtract={() => {
                    // 网页也读不出：若无缓存则走模型补全，否则回简洁
                    if (rssEntryNeedsModelBody(selected)) {
                      void recoverWithModel(selected, '网页无正文')
                      return
                    }
                    setArticleReaderMode('extract')
                  }}
                />
              </>
            ) : articleLooksLikeChrome(rssEntryDisplayHtml(selected)) ? (
              <div className="rss-reader-status rss-reader-empty-body">
                <p>
                  {articleBusy || modelBusy
                    ? modelBusy
                      ? uiText("模型整理中…")
                      : uiText("正在提取正文…")
                    : uiText("抓取结果不可读，可用模型整理或改看网页")}
                </p>
                {!articleBusy && !modelBusy ? (
                  <button
                    type="button"
                    className="settings-btn tiny"
                    onClick={() => void arrangeWithModel()}
                  >
                    {uiText("用模型整理")}</button>
                ) : null}
              </div>
            ) : rssEntryDisplayHtml(selected) ? (
              <RssReaderBody
                key={`${selected.id}:${selected.extractPane || 'source'}`}
                html={rssEntryDisplayHtml(selected)!}
                onQuote={quoteFromSelection}
                onDiscuss={discussFromSelection}
              />
            ) : selected.snippet && !articleLooksLikeChrome(`<p>${selected.snippet}</p>`) ? (
              <RssSelectableContent
                className="rss-reader-body"
                onQuote={quoteFromSelection}
                onDiscuss={discussFromSelection}
              >
                <div className="rss-prose">
                  <p>{selected.snippet}</p>
                  {articleBusy ? <p className="rss-reader-status">{uiText("提取中…")}</p> : null}
                </div>
              </RssSelectableContent>
            ) : (
              <div className="rss-reader-status rss-reader-empty-body">
                <p>
                  {modelBusy
                    ? uiText("模型生成正文中…")
                    : articleBusy
                      ? uiText("提取中…")
                      : uiText("暂无正文")}
                </p>
                {!articleBusy && !modelBusy ? (
                  <button
                    type="button"
                    className="settings-btn tiny"
                    onClick={() => void arrangeWithModel()}
                  >
                    {uiText("用模型整理")}</button>
                ) : null}
              </div>
            )}
            {readerMode === 'extract' && modelCacheHint ? (
              <p className="rss-web-hint">{uiText("本篇正文由资讯模型生成并已缓存。")}</p>
            ) : null}
            <RssRelatedNews items={relatedNews} onOpen={selectEntry} />
          </>
        )}
      </section>

      <RssFeedsDialog
        open={feedsOpen}
        draft={feedDraft}
        feeds={rss.feeds}
        rss={rss}
        unread={unread}
        onDraftChange={setFeedDraft}
        onClose={() => {
          setFeedDraft(rss.feeds.map((f) => f.url).join('\n'))
          setFeedsOpen(false)
        }}
        onSave={saveFeeds}
        onClearUnread={clearUnread}
        onFilterFeed={(id) => setFilter(`feed:${id}`)}
        onRemoveFeed={(url) => {
          const nextDraft = toggleUrlInRssDraft(feedDraft, url)
          setFeedDraft(nextDraft)
          onPatchRss({
            ...rss,
            feeds: normalizeRssTaskFeeds(nextDraft),
            updatedAt: Date.now()
          })
        }}
      />

      {dockDiscussion ? aiPanel('dock') : null}
    </div>
      {overlayDiscussion ? (
        <div className="rss-ai-layer">
          <button
            type="button"
            className="rss-ai-backdrop"
            aria-label={uiText("关闭讨论")}
            onClick={() =>
              onPatchRss({ ...rss, discussionPanel: 'hide', updatedAt: Date.now() })
            }
          />
          {aiPanel('overlay')}
        </div>
      ) : null}
    </div>
  )
}
