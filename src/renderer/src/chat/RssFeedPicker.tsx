import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import {
  RSS_PRESET_CATEGORIES,
  rssDraftHasUrl,
  toggleUrlInRssDraft,
  type RssPresetCategory
} from '@shared/rssBrief'
import { filterRssDiscoverFeeds, rssCatalogCount } from '@shared/rssCatalog'
import { rssFeedMetricKey, type RssFeedMetric } from '@shared/rssFeedMetrics'
import {
  RSS_DISCOVER_SORTS,
  formatRssRelativeShort,
  formatRssSubscribers,
  normalizeRssDiscoverSort,
  sortRssDiscoverItems,
  type RssDiscoverSort
} from '@shared/rssSourceSort'

type DiscoverItem = {
  id: string
  name: string
  url: string
  desc: string
  category?: string
  source: 'preset' | 'remote'
  subscribers?: number
  updatedAt?: number
}

type CatalogItem = {
  id: string
  name: string
  url: string
  desc: string
  category?: string
  subscribers?: number
  updatedAt?: number
}

type Mode = 'catalog' | 'discover'

/** 行高必须与 CSS 一致，且虚拟列表 gap=0，否则卷轴会抖。 */
const ROW_H = 56
const OVERSCAN = 8

/**
 * Folo 心智选源：千级本地目录（虚拟列表）/ 在线发现；可粘贴自定义 URL。
 */
export function RssFeedPicker({
  draft,
  onChange,
  maxHint = 12,
  dense = false,
  enableDiscover = false
}: {
  draft: string
  onChange: (next: string) => void
  maxHint?: number
  dense?: boolean
  enableDiscover?: boolean
}): JSX.Element {
  useUiLocale()
  const [mode, setMode] = useState<Mode>('catalog')
  const [category, setCategory] = useState<RssPresetCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [discoverItems, setDiscoverItems] = useState<DiscoverItem[]>([])
  const [discoverBusy, setDiscoverBusy] = useState(false)
  const [discoverHint, setDiscoverHint] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<RssDiscoverSort>('default')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(dense ? 420 : 240)
  const [metricsByUrl, setMetricsByUrl] = useState<Record<string, RssFeedMetric>>({})
  const [metricsWarming, setMetricsWarming] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const scrollWindowRef = useRef({ start: 0, end: 0 })
  const askedMetricsRef = useRef(new Set<string>())

  const showDiscover = enableDiscover && mode === 'discover'

  const selectedCount = useMemo(
    () => draft.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length,
    [draft]
  )

  const catalogTotal = useMemo(() => rssCatalogCount(), [])

  const catalogFiltered = useMemo(
    () => filterRssDiscoverFeeds({ category, query }),
    [category, query]
  )

  const list = useMemo((): CatalogItem[] => {
    const merged = catalogFiltered.map((p) => {
      const m = metricsByUrl[rssFeedMetricKey(p.url)]
      return {
        id: p.id,
        name: p.name,
        url: p.url,
        desc: p.desc,
        category: p.category,
        subscribers:
          typeof m?.subscribers === 'number'
            ? m.subscribers
            : typeof p.subscribers === 'number'
              ? p.subscribers
              : undefined,
        updatedAt:
          typeof m?.updatedAt === 'number' && m.updatedAt > 0
            ? m.updatedAt
            : typeof p.updatedAt === 'number' && p.updatedAt > 0
              ? p.updatedAt
              : undefined
      }
    })
    if (sortMode === 'default') return merged
    return sortRssDiscoverItems(merged, sortMode)
  }, [catalogFiltered, metricsByUrl, sortMode])

  const discoverSorted = useMemo(
    () => sortRssDiscoverItems(discoverItems, sortMode),
    [discoverItems, sortMode]
  )

  const metricCoverage = useMemo(() => {
    let n = 0
    for (const p of list) {
      if (typeof p.subscribers === 'number' || (typeof p.updatedAt === 'number' && p.updatedAt > 0)) {
        n++
      }
    }
    return n
  }, [list])

  const subscriberCoverage = useMemo(() => {
    let n = 0
    for (const p of list) {
      if (typeof p.subscribers === 'number') n++
    }
    return n
  }, [list])

  const freshnessCoverage = useMemo(() => {
    let n = 0
    for (const p of list) {
      if (typeof p.updatedAt === 'number' && p.updatedAt > 0) n++
    }
    return n
  }, [list])

  const metricsHint = useMemo(() => {
    if (sortMode === 'hot') {
      if (subscriberCoverage === 0) {
        return metricsWarming
          ? '正在查 Feedly 订阅数…'
          : '暂无订阅数：多数中文/RSSHub 源 Feedly 未收录，最火排序无效，请用默认或最新'
      }
      return `有订阅数 ${subscriberCoverage}/${list.length}${
        metricsWarming ? ' · 回填中…' : ''
      }`
    }
    if (sortMode === 'fresh') {
      if (freshnessCoverage === 0) {
        return metricsWarming
          ? '正在探活更新时间…'
          : '暂无更新时间：源不可达或较慢，排序等同默认'
      }
      return `有更新时间 ${freshnessCoverage}/${list.length}${
        metricsWarming ? ' · 回填中…' : ''
      }`
    }
    if (metricCoverage > 0) return `有指标 ${metricCoverage}`
    return ''
  }, [
    sortMode,
    subscriberCoverage,
    freshnessCoverage,
    metricCoverage,
    list.length,
    metricsWarming
  ])

  useEffect(() => {
    setScrollTop(0)
    scrollWindowRef.current = { start: 0, end: 0 }
    if (listRef.current) listRef.current.scrollTop = 0
  }, [category, query, mode, sortMode])

  useEffect(() => {
    if (!enableDiscover || mode !== 'discover') return
    let cancelled = false

    const seedLocal = (): DiscoverItem[] =>
      filterRssDiscoverFeeds({ category: 'all', query })
        .slice(0, 40)
        .map((p) => ({
          id: `preset:${p.id}`,
          name: p.name,
          url: p.url,
          desc: p.desc,
          category: p.category,
          source: 'preset' as const,
          subscribers: p.subscribers,
          updatedAt: p.updatedAt
        }))

    // 先秒出本地精选，绝不卡在「搜索中…」空窗（Feedly 常超时）
    const seed = seedLocal()
    setDiscoverItems(seed)
    setDiscoverHint(seed.length ? '精选库 · 正在查在线…' : '正在搜索…')
    setDiscoverBusy(true)

    const applyMetrics = (items: DiscoverItem[]): void => {
      if (!items.length) return
      setMetricsByUrl((prev) => {
        const next = { ...prev }
        const now = Date.now()
        for (const it of items) {
          const key = rssFeedMetricKey(it.url)
          if (!key) continue
          if (typeof it.subscribers !== 'number' && !(it.updatedAt && it.updatedAt > 0)) {
            continue
          }
          next[key] = {
            subscribers: it.subscribers ?? next[key]?.subscribers,
            updatedAt: it.updatedAt ?? next[key]?.updatedAt,
            fetchedAt: now
          }
        }
        return next
      })
    }
    applyMetrics(seed)

    const HARD_MS = 6000
    const handle = window.setTimeout(() => {
      const invoke = window.petApi.discoverRssFeeds({ query, limit: 40 })
      const raced = Promise.race([
        invoke,
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), HARD_MS)
        })
      ])
      void raced
        .then((res) => {
          if (cancelled) return
          if (!res) {
            setDiscoverHint(
              seed.length
                ? '在线发现超时，已显示精选库'
                : '在线发现超时，可换关键词或粘贴地址'
            )
            return
          }
          const items = res.items?.length ? res.items : seed
          setDiscoverItems(items)
          setDiscoverHint(
            res.error ||
              (res.remote ? null : seed.length ? '含精选匹配（在线未返回）' : null)
          )
          applyMetrics(items)
        })
        .catch(() => {
          if (cancelled) return
          setDiscoverItems(seed)
          setDiscoverHint(
            seed.length ? '在线发现失败，已显示精选库' : '发现请求失败'
          )
        })
        .finally(() => {
          if (!cancelled) setDiscoverBusy(false)
        })
    }, query ? 280 : 40)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [enableDiscover, mode, query])

  useEffect(() => {
    if (showDiscover) return
    const el = listRef.current
    if (!el) return
    const apply = (): void => {
      const h = Math.round(el.clientHeight)
      if (h > 0) setViewportH((prev) => (prev === h ? prev : h))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showDiscover, dense, mode])

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const visibleCount = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2
  const end = Math.min(list.length, start + visibleCount)
  const slice = list.slice(start, end)
  const padTop = start * ROW_H
  const padBottom = Math.max(0, (list.length - end) * ROW_H)
  const warmItemsKey = useMemo(() => {
    if (showDiscover) return ''
    return list
      .slice(start, Math.min(list.length, end + 20))
      .map((p) => `${p.url}\t${p.name}`)
      .join('\n')
  }, [showDiscover, list, start, end])

  // 可见行 + 预取：Feedly 订阅数 / 直拉源更新时间
  useEffect(() => {
    if (showDiscover || !warmItemsKey) return
    const batch = warmItemsKey
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [url, name] = line.split('\t')
        return { url: url || '', name }
      })
      .filter((it) => it.url)
    const fresh = batch.filter((it) => {
      const key = rssFeedMetricKey(it.url)
      if (!key || askedMetricsRef.current.has(key)) return false
      askedMetricsRef.current.add(key)
      return true
    })
    if (!fresh.length) return
    let cancelled = false
    setMetricsWarming(true)
    const handle = window.setTimeout(() => {
      void window.petApi
        .lookupRssFeedMetrics({ items: fresh, enrich: true })
        .then((res) => {
          if (cancelled || !res?.metrics) return
          setMetricsByUrl((prev) => ({ ...prev, ...res.metrics }))
        })
        .catch(() => {
          for (const it of fresh) askedMetricsRef.current.delete(rssFeedMetricKey(it.url))
        })
        .finally(() => {
          if (!cancelled) setMetricsWarming(false)
        })
    }, 100)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [showDiscover, warmItemsKey])

  // 点「最火/最新」时先暖一批，让排序尽快有数
  useEffect(() => {
    if (showDiscover) return
    if (sortMode !== 'hot' && sortMode !== 'fresh') return
    const batch = catalogFiltered.slice(0, 48).map((p) => ({ url: p.url, name: p.name }))
    const fresh = batch.filter((it) => {
      const key = rssFeedMetricKey(it.url)
      if (!key || askedMetricsRef.current.has(key)) return false
      askedMetricsRef.current.add(key)
      return true
    })
    if (!fresh.length) return
    let cancelled = false
    setMetricsWarming(true)
    void window.petApi
      .lookupRssFeedMetrics({ items: fresh, enrich: true })
      .then((res) => {
        if (cancelled || !res?.metrics) return
        setMetricsByUrl((prev) => ({ ...prev, ...res.metrics }))
      })
      .catch(() => {
        for (const it of fresh) askedMetricsRef.current.delete(rssFeedMetricKey(it.url))
      })
      .finally(() => {
        if (!cancelled) setMetricsWarming(false)
      })
    return () => {
      cancelled = true
    }
  }, [showDiscover, sortMode, catalogFiltered])

  function toggle(url: string): void {
    onChange(toggleUrlInRssDraft(draft, url))
  }

  function addCustom(): void {
    const u = customUrl.trim()
    if (!u) return
    if (!rssDraftHasUrl(draft, u)) onChange(toggleUrlInRssDraft(draft, u))
    setCustomUrl('')
  }

  function onVirtualScroll(e: UIEvent<HTMLUListElement>): void {
    const top = (e.target as HTMLUListElement).scrollTop
    const nextStart = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
    const nextVisible = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2
    const nextEnd = Math.min(list.length, nextStart + nextVisible)
    const prev = scrollWindowRef.current
    if (prev.start === nextStart && prev.end === nextEnd) return
    scrollWindowRef.current = { start: nextStart, end: nextEnd }
    setScrollTop(top)
  }

  return (
    <div className={`rss-picker${dense ? ' is-dense' : ''}`}>
      {enableDiscover ? (
        <div className="rss-picker-modes" role="tablist" aria-label={uiText("选源方式")}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'catalog'}
            className={mode === 'catalog' ? 'on' : undefined}
            onClick={() => setMode('catalog')}
          >
            <span className="rss-picker-mode-label">{uiText("目录")}</span>
            <span className="rss-picker-mode-meta">{catalogTotal}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'discover'}
            className={mode === 'discover' ? 'on' : undefined}
            onClick={() => setMode('discover')}
          >
            <span className="rss-picker-mode-label">{uiText("发现")}</span>
            <span className="rss-picker-mode-meta">{uiText("在线")}</span>
          </button>
        </div>
      ) : null}

      {!showDiscover ? (
        <div className="rss-picker-cats" role="tablist" aria-label={uiText("源分类")}>
          {RSS_PRESET_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={category === c.id ? 'on' : undefined}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <input
        className="rss-picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          showDiscover ? uiText("搜索在线源或关键词…") : uiText("搜索 {0}+ 本地目录…", [catalogTotal])
        }
        aria-label={showDiscover ? uiText("搜索发现源") : uiText("搜索订阅源")}
      />

      <div className="rss-picker-sorts" role="group" aria-label={uiText("排序")}>
        {RSS_DISCOVER_SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={sortMode === s.id ? 'on' : undefined}
            onClick={() => setSortMode(normalizeRssDiscoverSort(s.id))}
            title={
              s.id === 'hot'
                ? uiText("按订阅人数排序（Feedly）；行内显示订阅数")
                : s.id === 'fresh'
                  ? uiText("按源最近更新排序（直拉源 / Feedly）；行内显示更新时间")
                  : uiText("默认推荐顺序")
            }
          >
            <span className="rss-picker-sort-label">{s.label}</span>
            <span className="rss-picker-sort-metric">{s.metric}</span>
          </button>
        ))}
      </div>

      {showDiscover ? (
        <>
          {discoverHint ? (
            <p className="rss-picker-hint">
              {discoverHint}
              {discoverBusy && discoverSorted.length > 0 ? uiText(" · 在线补充中") : ''}
            </p>
          ) : discoverBusy && discoverSorted.length > 0 ? (
            <p className="rss-picker-hint">{uiText("在线补充中…")}</p>
          ) : null}
          <ul className="rss-picker-list">
            {discoverBusy && discoverSorted.length === 0 ? (
              <li className="rss-picker-empty">{uiText("搜索中…")}</li>
            ) : discoverSorted.length === 0 ? (
              <li className="rss-picker-empty">{uiText("没有结果，可换关键词或粘贴自定义地址")}</li>
            ) : (
              discoverSorted.map((p) => (
                <FeedRow
                  key={p.id}
                  name={p.name}
                  desc={p.desc}
                  url={p.url}
                  on={rssDraftHasUrl(draft, p.url)}
                  badge={p.source === 'remote' ? uiText("在线") : undefined}
                  metrics={rowMetrics(p, sortMode)}
                  onToggle={() => toggle(p.url)}
                />
              ))
            )}
          </ul>
        </>
      ) : (
        <>
          <p className="rss-picker-hint">
            {uiText("匹配")}{list.length} {uiText("个")}{!query && category === 'all' ? uiText("（目录共 {0}）", [catalogTotal]) : ''}
            {metricsHint ? ` · ${metricsHint}` : ''}
          </p>
          <ul
            ref={listRef}
            className="rss-picker-list is-virtual"
            onScroll={onVirtualScroll}
          >
            {list.length === 0 ? (
              <li className="rss-picker-empty">{uiText("没有匹配源，可粘贴自定义地址或导入 OPML")}</li>
            ) : (
              <>
                {padTop > 0 ? (
                  <li className="rss-picker-spacer" style={{ height: padTop }} aria-hidden />
                ) : null}
                {slice.map((p) => (
                  <FeedRow
                    key={p.id}
                    name={p.name}
                    desc={p.desc}
                    url={p.url}
                    on={rssDraftHasUrl(draft, p.url)}
                    metrics={rowMetrics(p, sortMode)}
                    onToggle={() => toggle(p.url)}
                    fixedHeight
                  />
                ))}
                {padBottom > 0 ? (
                  <li className="rss-picker-spacer" style={{ height: padBottom }} aria-hidden />
                ) : null}
              </>
            )}
          </ul>
        </>
      )}

      <div className="rss-picker-custom">
        <input
          className="rss-picker-search"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder={uiText("或粘贴 https://…/feed.xml")}
          aria-label={uiText("自定义订阅地址")}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />
        <button
          type="button"
          className="settings-btn tiny"
          disabled={!customUrl.trim()}
          onClick={addCustom}
        >
          {uiText("添加")}</button>
      </div>

      <p className="rss-picker-count">
        {uiText("已选")}{selectedCount}
        {maxHint ? uiText(" / 最多约 {0}", [maxHint]) : ''}
        {selectedCount > 0 ? uiText(" · 再点一次可取消") : ''}
      </p>
    </div>
  )
}

type FeedMetric = {
  key: 'hot' | 'fresh'
  label: string
  value: string
  emphasize?: boolean
}

function FeedRow({
  name,
  desc,
  url,
  on,
  badge,
  metrics,
  onToggle,
  fixedHeight
}: {
  name: string
  desc: string
  url: string
  on: boolean
  badge?: string
  metrics?: FeedMetric[]
  onToggle: () => void
  fixedHeight?: boolean
}): JSX.Element {
  useUiLocale()
  return (
    <li
      className={fixedHeight ? 'rss-picker-row' : undefined}
      style={fixedHeight ? { height: ROW_H } : undefined}
    >
      <button
        type="button"
        className={`rss-picker-item${on ? ' on' : ''}`}
        onClick={onToggle}
        title={url}
      >
        <span className="rss-picker-item-main">
          <strong>
            {name}
            {badge ? <em className="rss-picker-badge">{badge}</em> : null}
          </strong>
          <span>{desc}</span>
        </span>
        {metrics?.length ? (
          <span className="rss-picker-metrics" aria-label={uiText("源指标")}>
            {metrics.map((m) => (
              <span
                key={m.key}
                className={`rss-picker-metric is-${m.key}${m.emphasize ? ' is-key' : ''}`}
                title={`${m.label} ${m.value}`}
              >
                <i>{m.label}</i>
                <em>{m.value}</em>
              </span>
            ))}
          </span>
        ) : null}
        <span className="rss-picker-follow">{on ? uiText("已加") : uiText("添加")}</span>
      </button>
    </li>
  )
}

function rowMetrics(
  p: { subscribers?: number; updatedAt?: number },
  sort: RssDiscoverSort
): FeedMetric[] {
  const out: FeedMetric[] = []
  // 有数才展示；空壳「—」只会假装有指标，不如不显示
  if (typeof p.subscribers === 'number') {
    out.push({
      key: 'hot',
      label: uiText("订阅"),
      value: formatRssSubscribers(p.subscribers),
      emphasize: sort === 'hot'
    })
  }
  if (typeof p.updatedAt === 'number' && p.updatedAt > 0) {
    out.push({
      key: 'fresh',
      label: uiText("更新"),
      value: formatRssRelativeShort(p.updatedAt),
      emphasize: sort === 'fresh'
    })
  }
  return out
}
