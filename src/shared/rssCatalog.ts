/** 千级 RSS 发现目录（懒加载 JSON，与热门 presets 合并去重）。 */

import catalogJson from './data/rss-catalog.json'
import metricsJson from './data/rss-catalog-metrics.json'
import {
  RSS_FEED_PRESETS,
  inferRssPresetCategory,
  isRssPresetCategory,
  type RssFeedPreset,
  type RssPresetCategory
} from './rssPresets'
import { filterRssPresets } from './rssBrief'
import { rssFeedMetricKey, type RssFeedMetricsMap } from './rssFeedMetrics'

type CatalogFile = {
  version: number
  count: number
  feeds: RssFeedPreset[]
}

const file = catalogJson as CatalogFile
const bundledMetrics = (metricsJson as { byUrl?: RssFeedMetricsMap })?.byUrl || {}

let cachedAll: RssFeedPreset[] | null = null
let hostIndex: Map<string, string> | null = null

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function withBundledMetrics(p: RssFeedPreset): RssFeedPreset {
  const m = bundledMetrics[rssFeedMetricKey(p.url)]
  if (!m) return p
  return {
    ...p,
    subscribers: typeof m.subscribers === 'number' ? m.subscribers : p.subscribers,
    updatedAt: typeof m.updatedAt === 'number' && m.updatedAt > 0 ? m.updatedAt : p.updatedAt
  }
}

/** 热门 presets 在前，大目录补齐；按 URL 去重。 */
export function getRssDiscoverFeeds(): ReadonlyArray<RssFeedPreset> {
  if (cachedAll) return cachedAll
  const seen = new Set<string>()
  const out: RssFeedPreset[] = []
  const push = (p: RssFeedPreset): void => {
    let key = p.url
    try {
      key = new URL(p.url).href.toLowerCase()
    } catch {
      key = p.url.toLowerCase()
    }
    if (seen.has(key)) return
    seen.add(key)
    out.push(withBundledMetrics(p))
  }
  for (const p of RSS_FEED_PRESETS) push(p)
  for (const p of file.feeds || []) {
    if (!p?.url || !p.name) continue
    const name = String(p.name).slice(0, 80)
    const desc = String(p.desc || p.name).slice(0, 120)
    push({
      id: String(p.id || '').slice(0, 48) || `c${out.length}`,
      name,
      url: p.url,
      desc,
      category: isRssPresetCategory(p.category)
        ? p.category
        : inferRssPresetCategory(name, p.url, desc)
    })
  }
  cachedAll = out
  return out
}

export function rssCatalogCount(): number {
  return getRssDiscoverFeeds().length
}

export function filterRssDiscoverFeeds(opts: {
  category?: RssPresetCategory | 'all'
  query?: string
}): RssFeedPreset[] {
  return filterRssPresets(getRssDiscoverFeeds(), opts)
}

/** 主机名 → 展示名（presets + catalog）。 */
export function rssCatalogNameForHost(host: string): string | undefined {
  if (!hostIndex) {
    hostIndex = new Map()
    for (const p of getRssDiscoverFeeds()) {
      const h = hostKey(p.url)
      if (h && !hostIndex.has(h)) hostIndex.set(h, p.name)
    }
  }
  return hostIndex.get(host.replace(/^www\./, '').toLowerCase())
}
