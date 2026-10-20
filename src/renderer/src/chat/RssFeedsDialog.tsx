import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RssTaskFeed, RssTaskState } from '@shared/rssTask'
import {
  RSS_TASK_MAX_FEEDS,
  normalizeRssTaskFeeds,
  rssTaskFeedUnread
} from '@shared/rssTask'
import { rssSourceLabel } from '@shared/rssBrief'
import { buildOpml, mergeOpmlIntoDraft, parseOpml } from '@shared/rssOpml'
import {
  RSS_SUBSCRIBED_SORTS,
  formatRssRelativeShort,
  normalizeRssSubscribedSort,
  rssFeedLastActivityAt,
  sortRssSubscribedFeeds,
  type RssSubscribedSort
} from '@shared/rssSourceSort'
import { RssFeedPicker } from './RssFeedPicker'

/** 独立订阅源选单：左「已订阅」· 右「发现」。任务与设置共用。 */
export function RssFeedsDialog({
  open,
  draft,
  feeds: feedsProp,
  maxFeeds = RSS_TASK_MAX_FEEDS,
  saveLabel = '保存并刷新',
  subtitle = '千级目录 / 在线发现 / OPML（Folo）',
  rss,
  unread = 0,
  onDraftChange,
  onClose,
  onSave,
  onClearUnread,
  onFilterFeed,
  onRemoveFeed
}: {
  open: boolean
  draft: string
  /** 缺省由 draft 规范化生成。 */
  feeds?: RssTaskFeed[]
  maxFeeds?: number
  saveLabel?: string
  subtitle?: string
  /** 传入时显示未读/均分等任务态信息。 */
  rss?: RssTaskState
  unread?: number
  onDraftChange: (next: string) => void
  onClose: () => void
  onSave: () => void
  onClearUnread?: () => void
  onFilterFeed?: (feedId: string) => void
  onRemoveFeed: (url: string) => void
}): JSX.Element | null {
  useUiLocale()
  const panelRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [opmlMsg, setOpmlMsg] = useState<string | null>(null)
  const [subSort, setSubSort] = useState<RssSubscribedSort>('score')

  /** 左侧「已订阅」必须跟右侧草稿同步；feedsProp 只用来带标题/均分等元数据。 */
  const feeds = useMemo(() => {
    const fromDraft = normalizeRssTaskFeeds(draft)
    if (!feedsProp?.length) return fromDraft
    const byUrl = new Map(feedsProp.map((f) => [f.url, f]))
    const byKey = new Map<string, RssTaskFeed>()
    for (const f of feedsProp) {
      try {
        const u = new URL(f.url)
        u.hash = ''
        let href = u.href
        if (href.endsWith('/')) href = href.slice(0, -1)
        byKey.set(href.toLowerCase(), f)
      } catch {
        /* ignore */
      }
    }
    return fromDraft.map((f) => {
      const prev =
        byUrl.get(f.url) ||
        (() => {
          try {
            const u = new URL(f.url)
            u.hash = ''
            let href = u.href
            if (href.endsWith('/')) href = href.slice(0, -1)
            return byKey.get(href.toLowerCase())
          } catch {
            return undefined
          }
        })()
      if (!prev) return f
      return {
        ...f,
        title: prev.title || f.title,
        rating: prev.rating ?? f.rating,
        avgScore: prev.avgScore ?? f.avgScore,
        scoredCount: prev.scoredCount ?? f.scoredCount,
        id: prev.id || f.id
      }
    })
  }, [feedsProp, draft])

  const dirty = useMemo(() => {
    if (!feedsProp) return false
    const keyOf = (url: string): string => {
      try {
        const u = new URL(url)
        u.hash = ''
        let href = u.href
        if (href.endsWith('/')) href = href.slice(0, -1)
        return href.toLowerCase()
      } catch {
        return url.trim().toLowerCase()
      }
    }
    const saved = new Set(feedsProp.map((f) => keyOf(f.url)))
    const next = new Set(feeds.map((f) => keyOf(f.url)))
    if (saved.size !== next.size) return true
    for (const k of next) if (!saved.has(k)) return true
    return false
  }, [feeds, feedsProp])

  const sortedFeeds = useMemo(
    () => sortRssSubscribedFeeds(feeds, rss, subSort),
    [feeds, rss, subSort]
  )

  useEffect(() => {
    if (!open) return
    setOpmlMsg(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function importOpmlText(text: string): void {
    const parsed = parseOpml(text)
    if (!parsed.length) {
      setOpmlMsg('未识别到订阅源（需要带 xmlUrl 的 OPML）')
      return
    }
    const { draft: next, added, truncated } = mergeOpmlIntoDraft(draft, parsed, maxFeeds)
    onDraftChange(next)
    setOpmlMsg(
      truncated
        ? `已合并 ${added} 个（识别 ${parsed.length}，截断 ${truncated}，上限 ${maxFeeds}）`
        : `已合并 ${added} 个源（识别 ${parsed.length}，兼容 Folo/Feedly OPML）`
    )
  }

  function exportOpml(): void {
    const xml = buildOpml(
      feeds.map((f) => ({ title: f.title, url: f.url })),
      { title: 'CPET RSS' }
    )
    const blob = new Blob([xml], { type: 'text/x-opml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cpet-rss.opml'
    a.click()
    URL.revokeObjectURL(url)
    setOpmlMsg('已导出 OPML（可导入 Folo / Feedly）')
  }

  return (
    <div
      className="rss-feeds-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="rss-feeds-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={uiText("订阅源")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="rss-feeds-dialog-head">
          <div>
            <h3>{uiText("订阅源")}</h3>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="rss-icon-btn" aria-label={uiText("关闭")} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="rss-feeds-dialog-body">
          <aside className="rss-feeds-mine" aria-label={uiText("已订阅")}>
            <div className="rss-feeds-pane-title">
              <strong>{uiText("已订阅")}</strong>
              <span>
                {feeds.length} / {maxFeeds}
                {dirty ? uiText(" · 未保存") : ''}
              </span>
            </div>
            {feeds.length > 1 ? (
              <div className="rss-picker-sorts is-compact" role="group" aria-label={uiText("已订阅排序")}>
                {RSS_SUBSCRIBED_SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={subSort === s.id ? 'on' : undefined}
                    onClick={() => setSubSort(normalizeRssSubscribedSort(s.id))}
                    title={
                      s.id === 'fresh'
                        ? uiText("按该源最近一条更新时间")
                        : s.id === 'unread'
                          ? uiText("按未读条数")
                          : uiText("按评分均分")
                    }
                  >
                    <span className="rss-picker-sort-label">{s.label}</span>
                    <span className="rss-picker-sort-metric">{s.metric}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {sortedFeeds.length === 0 ? (
              <p className="rss-picker-empty">{uiText("还没有源，从右侧添加")}</p>
            ) : (
              <ul className="rss-feed-current">
                {sortedFeeds.map((f) => {
                  const u = rss ? rssTaskFeedUnread(rss, f.id) : 0
                  const freshAt = rss ? rssFeedLastActivityAt(rss, f.id) : 0
                  const title = f.title || rssSourceLabel(f.url) || uiText("未命名源")
                  const canFilter = typeof onFilterFeed === 'function'
                  return (
                    <li key={f.id || f.url} className="rss-feed-card">
                      <div className="rss-feed-card-top">
                        {canFilter ? (
                          <button
                            type="button"
                            className="rss-feed-current-main"
                            onClick={() => {
                              onFilterFeed(f.id)
                              onClose()
                            }}
                            title={uiText("{0} · 只看此源", [title])}
                          >
                            <strong>{title}</strong>
                          </button>
                        ) : (
                          <div className="rss-feed-current-main" title={f.url}>
                            <strong>{title}</strong>
                          </div>
                        )}
                        <button
                          type="button"
                          className="rss-icon-btn"
                          title={uiText("移除")}
                          aria-label={uiText("移除 {0}", [title])}
                          onClick={() => onRemoveFeed(f.url)}
                        >
                          ×
                        </button>
                      </div>
                      <div className="rss-feed-card-stats">
                        {typeof f.avgScore === 'number' ? (
                          <span
                            className={`rss-feed-stat${subSort === 'score' ? ' is-key' : ''}`}
                            title={uiText("条目评分均值")}
                          >
                            {uiText("均分")}<em>{f.avgScore.toFixed(1)}</em>
                            {typeof f.scoredCount === 'number' ? (
                              <i>（{f.scoredCount} {' '}{uiText("条）")}</i>
                            ) : null}
                          </span>
                        ) : (
                          <span className="rss-feed-stat is-muted" title={f.url}>
                            {f.url.replace(/^https?:\/\//, '').slice(0, 28)}
                          </span>
                        )}
                        <span
                          className={`rss-feed-stat${subSort === 'fresh' ? ' is-key' : ''}${
                            freshAt ? '' : ' is-muted'
                          }`}
                          title={uiText("该源最近一条更新时间")}
                        >
                          {uiText("更新")}<em>{freshAt ? formatRssRelativeShort(freshAt) : '—'}</em>
                        </span>
                        {rss ? (
                          <span
                            className={`rss-feed-stat${subSort === 'unread' ? ' is-key' : ''}`}
                          >
                            {u > 0 ? (
                              <>
                                {uiText("未读")}<em>{u}</em>
                              </>
                            ) : (
                              <span className="is-muted">{uiText("已读完")}</span>
                            )}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="rss-feeds-mine-foot">
              {onClearUnread && unread > 0 ? (
                <button type="button" className="rss-text-btn" onClick={onClearUnread}>
                  {uiText("全部标已读")}</button>
              ) : (
                <span />
              )}
              <div className="rss-feeds-opml-actions">
                <button
                  type="button"
                  className="rss-text-btn"
                  onClick={() => fileRef.current?.click()}
                >
                  {uiText("导入 OPML")}</button>
                <button
                  type="button"
                  className="rss-text-btn"
                  onClick={exportOpml}
                  disabled={!feeds.length}
                >
                  {uiText("导出")}</button>
              </div>
            </div>
            {opmlMsg ? <p className="rss-feeds-opml-msg">{opmlMsg}</p> : null}
            <input
              ref={fileRef}
              type="file"
              accept=".opml,.xml,text/xml,application/xml"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                void file
                  .text()
                  .then(importOpmlText)
                  .catch(() => setOpmlMsg('读取 OPML 失败'))
              }}
            />
          </aside>

          <section className="rss-feeds-discover" aria-label={uiText("发现")}>
            <RssFeedPicker
              draft={draft}
              onChange={onDraftChange}
              maxHint={maxFeeds}
              dense
              enableDiscover
            />
          </section>
        </div>

        <footer className="rss-feeds-dialog-foot">
          {dirty ? (
            <p className="rss-feeds-dirty-hint">{uiText("右侧点选已进左侧列表，点「")}{saveLabel}{uiText("」才会拉取更新")}</p>
          ) : (
            <span />
          )}
          <button type="button" className="settings-btn ghost" onClick={onClose}>
            {uiText("取消")}</button>
          <button
            type="button"
            className={`settings-btn${dirty ? ' is-emphasis' : ''}`}
            onClick={onSave}
          >
            {saveLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
