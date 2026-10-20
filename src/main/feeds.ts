/**
 * 趣味信息源：天气（wttr.in + Open-Meteo 兜底）、新闻（HN + V2EX）。
 * 均为免 key 公共接口，带超时、缓存与失败回退。
 * 天气城市可读设置；空则按出口 IP（VPN 时易错位）。
 */

import type { NewsItem, WeatherInfo } from '../shared/types'
import { normalizeRssFeedUrls, parseFeedXml, rssSourceLabel } from '../shared/rssBrief'

async function fetchText(url: string, headers?: Record<string, string>, ms = 6000): Promise<string | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

let weatherCache: { key: string; info: WeatherInfo; at: number } | null = null
const WEATHER_TTL = 12 * 60 * 1000

const WTTR_HEADERS = {
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent': 'curl/8.0'
}

function localNowLabel(): string {
  try {
    return new Date().toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    })
  } catch {
    return new Date().toLocaleString()
  }
}

function pickAreaName(area: unknown): string {
  const a = area as { areaName?: unknown; region?: unknown } | null
  const names = a?.areaName
  if (Array.isArray(names) && (names[0] as { value?: string })?.value) {
    return String((names[0] as { value: string }).value)
  }
  if (typeof names === 'string') return names
  const region = a?.region
  if (Array.isArray(region) && (region[0] as { value?: string })?.value) {
    return String((region[0] as { value: string }).value)
  }
  return ''
}

function pickCountry(area: unknown): string {
  const c = (area as { country?: unknown } | null)?.country
  if (Array.isArray(c) && (c[0] as { value?: string })?.value) {
    return String((c[0] as { value: string }).value)
  }
  return ''
}

/** 常见英文国名/城市 → 更顺口的中文展示。 */
function localizePlace(place: string): string {
  const map: Record<string, string> = {
    China: '中国',
    'Hong Kong': '香港',
    Taiwan: '台湾',
    Macao: '澳门',
    Macau: '澳门',
    Japan: '日本',
    'South Korea': '韩国',
    'United States of America': '美国',
    'United States': '美国',
    Singapore: '新加坡',
    Beijing: '北京',
    Shanghai: '上海',
    Shenzhen: '深圳',
    Guangzhou: '广州',
    Hangzhou: '杭州',
    Chengdu: '成都',
    Nanjing: '南京',
    Wuhan: '武汉',
    "Xi'an": '西安',
    Chongqing: '重庆',
    Tianjin: '天津',
    Suzhou: '苏州',
    Xiamen: '厦门'
  }
  let out = place
  for (const [en, zh] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\b${en.replace(/'/g, "\\'")}\\b`, 'g'), zh)
  }
  return out.replace(/,\s*中国$/, ' · 中国').replace(/,\s*/g, ' · ')
}

function weatherPath(city?: string): string {
  const c = city?.trim()
  if (!c) return ''
  return `${encodeURIComponent(c)}`
}

/** 解析 wttr.in JSON，带上地域名。 */
async function weatherFromJson(city?: string): Promise<WeatherInfo | null> {
  const path = weatherPath(city)
  const raw = await fetchText(`https://wttr.in/${path}?format=j1`, WTTR_HEADERS)
  if (!raw) return null
  try {
    const j = JSON.parse(raw)
    const area = j?.nearest_area?.[0]
    const cur = j?.current_condition?.[0]
    if (!cur) return null
    const placePart = pickAreaName(area)
    const country = pickCountry(area)
    const rawPlace =
      [placePart, country].filter(Boolean).join(', ') || city?.trim() || '未知地点'
    const place = localizePlace(rawPlace)
    const desc =
      (Array.isArray(cur.lang_zh) && cur.lang_zh[0]?.value) ||
      (Array.isArray(cur.weatherDesc) && cur.weatherDesc[0]?.value) ||
      ''
    const temp = cur.temp_C != null ? `${cur.temp_C}°C` : ''
    const feels = cur.FeelsLikeC != null ? `体感 ${cur.FeelsLikeC}°C` : ''
    const humidity = cur.humidity != null ? `湿度 ${cur.humidity}%` : ''
    const bits = [localNowLabel(), desc, temp, feels, humidity].filter(Boolean)
    const text = `${place} · ${bits.join(' · ')}`
    const urlPlace = city?.trim() || placePart || place
    return {
      place,
      text,
      url: `https://wttr.in/${encodeURIComponent(urlPlace)}?lang=zh`
    }
  } catch {
    return null
  }
}

/** 文本格式兜底：%l 地域 · 天气 温度 */
async function weatherFromText(city?: string): Promise<WeatherInfo | null> {
  const path = weatherPath(city)
  const txt = await fetchText(`https://wttr.in/${path}?format=%l|%c|%t`, WTTR_HEADERS)
  if (!txt) return null
  const clean = txt.trim()
  if (!clean || /unknown|error/i.test(clean)) return null
  const [placeRaw, icon, temp] = clean.split('|').map((s) => s.trim())
  const place = localizePlace(placeRaw || city?.trim() || '未知地点')
  const weather = [icon, temp].filter(Boolean).join(' ')
  const bits = [localNowLabel(), weather].filter(Boolean)
  return {
    place,
    text: `${place} · ${bits.join(' · ')}`,
    url: `https://wttr.in/${encodeURIComponent(city?.trim() || placeRaw || place)}?lang=zh`
  }
}

function markApprox(info: WeatherInfo): WeatherInfo {
  const place = info.place.startsWith('约估') ? info.place : `约估·${info.place}`
  const text = info.text.startsWith('约估') ? info.text : `约估·${info.text}`
  return { ...info, place, text, approx: true }
}

/** Open-Meteo：国内网络更稳；需先地理编码。 */
async function weatherFromOpenMeteo(city: string): Promise<WeatherInfo | null> {
  const q = city.trim()
  if (!q) return null
  const geoTxt = await fetchText(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=zh&format=json`
  )
  if (!geoTxt) return null
  try {
    const geo = JSON.parse(geoTxt)
    const results = Array.isArray(geo?.results) ? geo.results : []
    const prefer = (c: string): boolean =>
      /中国|China|Hong Kong|Taiwan|Macao|日本|Japan|韩国|Korea|新加坡|Singapore/i.test(c)
    const hit =
      results.find((r: { country?: string; name?: string }) =>
        prefer(String(r?.country || '')) || prefer(String(r?.name || ''))
      ) || results[0]
    if (!hit || hit.latitude == null || hit.longitude == null) return null
    const place = localizePlace(
      [hit.name, hit.admin1, hit.country].filter(Boolean).join(' · ') || q
    )
    const wTxt = await fetchText(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&timezone=auto`
    )
    if (!wTxt) return null
    const w = JSON.parse(wTxt)
    const cur = w?.current
    if (!cur) return null
    const desc = weatherCodeZh(cur.weather_code)
    const temp = cur.temperature_2m != null ? `${Math.round(cur.temperature_2m)}°C` : ''
    const feels =
      cur.apparent_temperature != null ? `体感 ${Math.round(cur.apparent_temperature)}°C` : ''
    const humidity =
      cur.relative_humidity_2m != null ? `湿度 ${cur.relative_humidity_2m}%` : ''
    const bits = [localNowLabel(), desc, temp, feels, humidity].filter(Boolean)
    return {
      place,
      text: `${place} · ${bits.join(' · ')}`,
      url: `https://www.openstreetmap.org/#map=10/${hit.latitude}/${hit.longitude}`
    }
  } catch {
    return null
  }
}

function weatherCodeZh(code: unknown): string {
  const n = Number(code)
  const map: Record<number, string> = {
    0: '晴',
    1: '大部晴朗',
    2: '多云',
    3: '阴',
    45: '雾',
    48: '雾凇',
    51: '毛毛雨',
    53: '小雨',
    55: '中雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    80: '阵雨',
    81: '阵雨',
    82: '暴雨',
    95: '雷阵雨',
    96: '雷阵雨夹雹',
    99: '强雷暴'
  }
  return map[n] || '天气更新'
}

export function clearWeatherCache(): void {
  weatherCache = null
}

export async function getWeather(city?: string): Promise<WeatherInfo | null> {
  const key = (city || '').trim() || '__ip__'
  if (weatherCache && weatherCache.key === key && Date.now() - weatherCache.at < WEATHER_TTL) {
    return weatherCache.info
  }
  let info =
    (await weatherFromJson(city)) ||
    (await weatherFromText(city)) ||
    (key !== '__ip__' ? await weatherFromOpenMeteo(key) : null)
  // IP 模式失败：按时区约估，必须打标，不得冒充精确定位
  if (!info && key === '__ip__') {
    const guess = guessCityFromTimezone()
    if (guess) {
      const guessed = await weatherFromOpenMeteo(guess)
      if (guessed) info = markApprox(guessed)
    }
  }
  if (!info) return weatherCache?.key === key ? weatherCache.info : null
  weatherCache = { key, info, at: Date.now() }
  return info
}

/** 按本机时区粗估城市（仅作 IP/wttr 失败时的兜底，不替代用户配置）。 */
function guessCityFromTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    const map: Record<string, string> = {
      'Asia/Shanghai': '上海',
      'Asia/Chongqing': '重庆',
      'Asia/Harbin': '哈尔滨',
      'Asia/Urumqi': '乌鲁木齐',
      'Asia/Hong_Kong': '香港',
      'Asia/Taipei': '台北',
      'Asia/Macau': '澳门',
      'Asia/Tokyo': '东京',
      'Asia/Seoul': '首尔',
      'Asia/Singapore': '新加坡'
    }
    return map[tz] || null
  } catch {
    return null
  }
}

let newsCache: { source: string; ids: number[]; at: number } | null = null
const NEWS_TTL = 20 * 60 * 1000

async function newsFromHn(): Promise<NewsItem | null> {
  try {
    let ids = newsCache && newsCache.source === 'hn' && Date.now() - newsCache.at < NEWS_TTL
      ? newsCache.ids
      : null
    if (!ids) {
      const listTxt = await fetchText('https://hacker-news.firebaseio.com/v0/topstories.json')
      if (!listTxt) return null
      const parsed = JSON.parse(listTxt)
      if (!Array.isArray(parsed) || !parsed.length) return null
      ids = parsed.slice(0, 30)
      newsCache = { source: 'hn', ids, at: Date.now() }
    }
    const id = ids[Math.floor(Math.random() * ids.length)]
    const itemTxt = await fetchText(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
    if (!itemTxt) return null
    const item = JSON.parse(itemTxt)
    if (!item || typeof item.title !== 'string') return null
    const url =
      typeof item.url === 'string' && item.url
        ? item.url
        : `https://news.ycombinator.com/item?id=${id}`
    return { title: item.title, url, id, source: 'hn' }
  } catch {
    return null
  }
}

async function newsFromV2ex(): Promise<NewsItem | null> {
  const raw = await fetchText('https://www.v2ex.com/api/topics/hot.json')
  if (!raw) return null
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list) || !list.length) return null
    const item = list[Math.floor(Math.random() * Math.min(list.length, 20))]
    if (!item || typeof item.title !== 'string') return null
    const id = typeof item.id === 'number' ? item.id : Number(item.id) || Date.now()
    const url =
      typeof item.url === 'string' && item.url
        ? item.url
        : `https://www.v2ex.com/t/${id}`
    return { title: item.title, url, id, source: 'v2ex' }
  } catch {
    return null
  }
}

export type NewsSourcePref = 'auto' | 'hn' | 'v2ex'

export async function getNews(source: NewsSourcePref = 'auto'): Promise<NewsItem | null> {
  if (source === 'hn') return newsFromHn()
  if (source === 'v2ex') return newsFromV2ex()
  return (await newsFromHn()) || (await newsFromV2ex())
}

/** 一次拉多条浅资讯（简报用）；失败返回已成功的部分。 */
export async function listNewsBrief(
  source: NewsSourcePref = 'auto',
  limit = 8
): Promise<NewsItem[]> {
  const n = Math.min(12, Math.max(3, Math.floor(limit) || 8))
  if (source === 'hn') return listFromHn(n)
  if (source === 'v2ex') return listFromV2ex(n)
  const hn = await listFromHn(n)
  if (hn.length >= 3) return hn
  const v2 = await listFromV2ex(n)
  return [...hn, ...v2].slice(0, n)
}

async function listFromHn(limit: number): Promise<NewsItem[]> {
  try {
    let ids = newsCache && newsCache.source === 'hn' && Date.now() - newsCache.at < NEWS_TTL
      ? newsCache.ids
      : null
    if (!ids) {
      const listTxt = await fetchText('https://hacker-news.firebaseio.com/v0/topstories.json')
      if (!listTxt) return []
      const parsed = JSON.parse(listTxt)
      if (!Array.isArray(parsed) || !parsed.length) return []
      ids = parsed.slice(0, 40)
      newsCache = { source: 'hn', ids, at: Date.now() }
    }
    const pick = ids.slice(0, Math.min(limit, ids.length))
    const out: NewsItem[] = []
    for (const id of pick) {
      const itemTxt = await fetchText(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      if (!itemTxt) continue
      const item = JSON.parse(itemTxt)
      if (!item || typeof item.title !== 'string') continue
      const url =
        typeof item.url === 'string' && item.url
          ? item.url
          : `https://news.ycombinator.com/item?id=${id}`
      out.push({ title: item.title, url, id: Number(id) || Date.now(), source: 'hn' })
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}

async function listFromV2ex(limit: number): Promise<NewsItem[]> {
  const raw = await fetchText('https://www.v2ex.com/api/topics/hot.json')
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list) || !list.length) return []
    const out: NewsItem[] = []
    for (const item of list.slice(0, limit)) {
      if (!item || typeof item.title !== 'string') continue
      const id = typeof item.id === 'number' ? item.id : Number(item.id) || Date.now()
      const url =
        typeof item.url === 'string' && item.url ? item.url : `https://www.v2ex.com/t/${id}`
      const content =
        typeof item.content === 'string'
          ? item.content
          : typeof item.content_rendered === 'string'
            ? item.content_rendered.replace(/<[^>]+>/g, ' ')
            : ''
      const snippet = content.replace(/\s+/g, ' ').trim().slice(0, 160) || undefined
      out.push({ title: item.title, url, id, source: 'v2ex', snippet })
    }
    return out
  } catch {
    return []
  }
}

/** 拉取用户订阅的 RSS/Atom，失败的源记入 errors。 */
export async function listRssBrief(
  feedUrls: string[],
  perFeed = 5
): Promise<{ items: NewsItem[]; errors: string[] }> {
  const urls = normalizeRssFeedUrls(feedUrls)
  const items: NewsItem[] = []
  const errors: string[] = []
  for (const feedUrl of urls) {
    const raw = await fetchText(feedUrl, undefined, 8000)
    if (!raw) {
      errors.push(`无法访问 ${safeHost(feedUrl)}`)
      continue
    }
    try {
      const parsed = parseFeedXml(raw, feedUrl, perFeed)
      const label = rssSourceLabel(feedUrl, parsed.feedTitle)
      // 空 channel 不算失败（周末空窗等）；只有访问/解析失败才记 errors
      if (!parsed.entries.length) continue
      for (const e of parsed.entries) {
        items.push({
          title: e.title,
          url: e.url,
          id: e.id,
          source: 'rss',
          snippet: e.snippet,
          sourceLabel: label
        })
      }
    } catch {
      errors.push(`解析失败 ${safeHost(feedUrl)}`)
    }
  }
  return { items, errors }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'RSS'
  }
}
