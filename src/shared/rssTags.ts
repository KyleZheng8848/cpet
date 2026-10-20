import type { RssTaskEntry, RssValueScore } from './rssTask'

/** 太粗、不能当摄取入口的标签。 */
const COARSE_TAGS = new Set(
  [
    '科技',
    '新闻',
    '资讯',
    '热点',
    '行业',
    '互联网',
    '商业',
    '财经',
    '综合',
    '国内',
    '国际',
    '世界',
    '要闻',
    '快讯',
    'ai',
    '人工智能',
    'tech',
    'news',
    'update',
    'blog',
    'weekly',
    'newsletter'
  ].map((x) => x.toLowerCase())
)

/** 页面牛皮癣 / 导航 / 广告，绝不能当标签。 */
const CHROME_TAGS = new Set(
  [
    '订阅',
    '登录',
    '注册',
    '客户端',
    '下载',
    '分享',
    '关注',
    '推荐',
    '热门',
    '相关',
    '下一篇',
    '上一篇',
    '评论',
    '点赞',
    '收藏',
    '扫码',
    '微信',
    '微博',
    '首页',
    '频道',
    '栏目',
    '专题',
    '更多',
    '原文',
    '转载',
    '广告',
    '推广',
    '赞助',
    '合作',
    '入驻',
    '详情',
    '网站地图',
    '友情链接',
    '媒体矩阵',
    '企业服务',
    '政府服务',
    '会员中心',
    '我的订阅',
    '关注我们',
    '下载app',
    '相关阅读',
    '相关新闻',
    '热门推荐',
    '猜你喜欢',
    '大家都在看',
    '热门标签',
    '文章标签',
    '关键词'
  ].map((x) => x.toLowerCase())
)

const CHROME_PLAIN_RE =
  /登录|注册|搜索|媒体品牌|媒体矩阵|企业服务|政府服务|网站地图|客户端|关注我们|投诉|举报|友情链接|热门推荐|相关阅读|相关新闻|相关文章|推荐阅读|热门文章|热门资讯|热门标签|文章标签|关键词|大家都在看|大家都在搜|猜你喜欢|分享到|扫码|下载APP|会员中心|我的订阅|下一篇|上一篇|项目推荐|我要入驻|城市合作/

const CHROME_TAIL_RE =
  /下一篇|相关阅读|相关文章|相关新闻|相关资讯|推荐阅读|热门文章|热门资讯|热门标签|文章标签|关键词[:：]|大家都在看|大家都在搜|猜你喜欢|项目推荐|编辑推荐/

const MAX_TAGS = 8
const MAX_TAG_LEN = 18
const MIN_TAG_LEN = 2

/** 句子谓语 / 动作，出现就不是名词实体。 */
const PHRASE_VERB_RE =
  /回应|表示|宣布|发布|扩大|覆盖|影响|呼吁|要求|批评|会见|访问|举行|召开|通过|完成|开始|结束|进行|加强|推动|促进|反对|支持|认为|指出|强调|称|说|谈及|提及/

const PHRASE_PARTICLE_RE = /的|了|着|过|与|和|及|对|向|就|将|已|正/

/** 英文冠词 / 介词 / 公司后缀：标题切开后最容易混进图谱。 */
const EN_STOP_TAGS = new Set(
  [
    'the',
    'a',
    'an',
    'of',
    'in',
    'on',
    'at',
    'to',
    'for',
    'and',
    'or',
    'but',
    'with',
    'from',
    'by',
    'as',
    'is',
    'are',
    'was',
    'were',
    'be',
    'this',
    'that',
    'these',
    'those',
    'its',
    'vs',
    'via',
    'new',
    'old',
    'first',
    'last',
    'next',
    'after',
    'before',
    'over',
    'into',
    'about',
    'than',
    'more',
    'most',
    'such',
    'only',
    'also',
    'just',
    'not',
    'no',
    'yes',
    'inc',
    'inc.',
    'ltd',
    'ltd.',
    'llc',
    'corp',
    'corp.',
    'co',
    'co.',
    'plc',
    'gmbh',
    'pty',
    'sa',
    'nv',
    'ag',
    'jp',
    'j.p',
    'j.p.'
  ].map((x) => x.toLowerCase())
)

const GENERIC_NOUNS = new Set(
  [
    '投资',
    '合作',
    '市场',
    '企业',
    '信心',
    '技术',
    '经济',
    '发展',
    '政策',
    '问题',
    '影响',
    '模式',
    '系统',
    '服务',
    '产品',
    '项目',
    '计划',
    '数据',
    '安全',
    '网络',
    '行业',
    '公司',
    '集团',
    '发布',
    '声明',
    '协议'
  ].map((x) => x.toLowerCase())
)

const PLACE_WORDS = new Set([
  '香港',
  '台湾',
  '澳门',
  '东盟',
  '欧盟',
  '美国',
  '中国',
  '日本',
  '英国',
  '韩国',
  '印度',
  '俄罗斯',
  '中东',
  '欧洲',
  '亚洲',
  '非洲',
  '北京',
  '上海',
  '深圳',
  '广州'
])

const ENTITY_ORG_RE = /(?:部|委|会|署|局|院|司|厅|集团|公司|银行|大学|党|组织)$/
const ENTITY_PLACE_RE = /(?:市|省|州|邦|县|国|盟)$/
const ENTITY_LAW_RE = /(?:法案|协议|声明|条约|法)$/
const ENTITY_TOPIC_RE = /(?:主义)$/

export type RssTagKind = 'org' | 'place' | 'product' | 'law' | 'topic'

export function classifyRssTag(tag: string): RssTagKind {
  const t = tag.trim()
  if (ENTITY_ORG_RE.test(t) || /OpenAI|Google|DeepSeek|微软|苹果|Meta|Nvidia|英伟达|Anthropic/i.test(t)) {
    return 'org'
  }
  if (ENTITY_PLACE_RE.test(t) || PLACE_WORDS.has(t)) return 'place'
  if (ENTITY_LAW_RE.test(t)) return 'law'
  if (ENTITY_TOPIC_RE.test(t)) return 'topic'
  if (/^[A-Z][A-Za-z0-9.+-]{1,17}$/.test(t) || /GPT|Sora|iPhone|Android|Claude|Gemini/i.test(t)) {
    return 'product'
  }
  return 'topic'
}

function latinTagCore(tag: string): string {
  return tag
    .trim()
    .replace(/[.'’]+$/g, '')
    .toLowerCase()
}

/** 只要能当图谱节点的名词实体：机构 / 地名 / 产品 / 法案，不要整句谓语。 */
export function isNounEntityTag(tag: string): boolean {
  const t = (tag || '').trim().replace(/\s+/g, ' ')
  if (t.length < MIN_TAG_LEN || t.length > MAX_TAG_LEN) return false
  if (/^[#@]/.test(t)) return false
  if (/\.\.\.$|…$/.test(t)) return false
  const key = t.toLowerCase()
  const core = latinTagCore(t)
  if (COARSE_TAGS.has(key) || CHROME_TAGS.has(key) || GENERIC_NOUNS.has(key)) return false
  if (EN_STOP_TAGS.has(key) || EN_STOP_TAGS.has(core)) return false
  if (/^\d+([.-]\d+)*$/.test(t)) return false
  if (/^[各该本其]/.test(t) || /有关|相关/.test(t)) return false
  if (PHRASE_VERB_RE.test(t)) return false
  if (PHRASE_PARTICLE_RE.test(t) && t.length >= 5) return false
  const words = t.split(/[\s,，、]+/).filter(Boolean)
  if (words.length >= 3) return false
  if (words.length === 2 && !words.every((w) => /^[A-Z]/.test(w) || PLACE_WORDS.has(w))) return false
  if (words.some((w) => EN_STOP_TAGS.has(latinTagCore(w)))) return false
  if (/^[a-z]+$/.test(t)) return false
  const letters = (t.match(/[A-Za-z]/g) || []).length
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length
  if (!cjk && letters > 0 && letters < 3 && !/\d/.test(t)) return false
  const named =
    ENTITY_ORG_RE.test(t) ||
    ENTITY_PLACE_RE.test(t) ||
    ENTITY_LAW_RE.test(t) ||
    ENTITY_TOPIC_RE.test(t) ||
    PLACE_WORDS.has(t)
  if (cjk >= 8 && !named) return false
  if (cjk >= 5 && !named) return false
  return true
}

export function normalizeRssTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const it of raw) {
    const t = typeof it === 'string' ? it.trim().replace(/\s+/g, ' ') : ''
    if (!isNounEntityTag(t)) continue
    if (CHROME_PLAIN_RE.test(t) && t.length <= 6) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return dropSupersetTags(out)
}

/** 「外交部回应欧盟…」这种长串里若已有「外交部」，只留短的。 */
function dropSupersetTags(tags: string[]): string[] {
  return tags.filter((t) => !tags.some((o) => o !== t && t.includes(o) && o.length >= MIN_TAG_LEN))
}

function htmlToPlain(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 从纯文本里砍掉相关推荐 / 广告尾巴和导航词。 */
export function stripRssChromePlain(text: string): string {
  let s = (text || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const cut = s.search(CHROME_TAIL_RE)
  if (cut >= 0) s = s.slice(0, cut)
  s = s.replace(new RegExp(CHROME_PLAIN_RE.source, 'g'), ' ')
  return s.replace(/\s+/g, ' ').trim()
}

function isFeedBrandTag(tag: string, feedTitle?: string): boolean {
  const f = (feedTitle || '').trim().toLowerCase()
  const t = tag.trim().toLowerCase()
  if (!f || !t) return false
  if (f === t) return true
  if (f.startsWith(t) && t.length >= 2) return true
  if (t.startsWith(f) && f.length >= 2) return true
  return f.includes(t) && t.length <= 4 && /网|新闻|日报|时报|周刊|频道|通讯/.test(f)
}

export type RssTagSourceEntry = Partial<
  Pick<RssTaskEntry, 'title' | 'titleLocal' | 'snippet' | 'feedTitle' | 'contentHtml' | 'extractHtml'>
>

/** 打标签只用标题 + 清洗后的正文，不用源名、不用页面牛皮癣。 */
export function rssTagSourceText(entry: RssTagSourceEntry): string {
  const title = `${entry.titleLocal || ''} ${entry.title || ''}`.trim()
  const snippet = stripRssChromePlain(entry.snippet || '')
  const body = stripRssChromePlain(htmlToPlain(entry.extractHtml || entry.contentHtml || ''))
  const lead = body.length >= 80 ? body.slice(0, 1000) : [snippet, body].filter(Boolean).join(' ').slice(0, 1000)
  return stripRssChromePlain(`${title} ${lead}`)
}

function sourceHasTag(source: string, tag: string): boolean {
  const s = source.toLowerCase()
  const t = tag.toLowerCase()
  if (!t) return false
  if (s.includes(t)) return true
  return s.includes(t.replace(/\s+/g, ''))
}

export function groundRssTags(tags: readonly string[], entry: RssTagSourceEntry): string[] {
  const feed = entry.feedTitle
  const cleaned = normalizeRssTags(tags).filter((t) => !isFeedBrandTag(t, feed))
  if (!cleaned.length) return []
  const source = rssTagSourceText(entry)
  // 标题极短、还没抓到正文时，先信模型标签，只丢掉牛皮癣词
  if (source.length < 24) return cleaned
  return cleaned.filter((t) => sourceHasTag(source, t))
}

function titleBits(title: string): string[] {
  const t = title.trim()
  if (!t) return []
  const bits: string[] = []
  for (const m of t.matchAll(/《([^》]{2,18})》/g)) bits.push(m[1])
  const lead = t.split(/[:：]/)[0]?.trim()
  if (lead && isNounEntityTag(lead)) bits.push(lead)
  bits.push(...t.split(/[\s,，、|/｜·•:;；。！？!?()[\]【】「」《》]+/))
  for (const m of t.matchAll(/([\u4e00-\u9fff]{2,6}(?:部|委|会|署|局|院|司|厅|集团|公司|银行|大学))/g)) {
    bits.push(m[1])
  }
  for (const m of t.matchAll(/([\u4e00-\u9fff]{2,6}(?:主义|法案|协议|声明|条约|法))/g)) bits.push(m[1])
  for (const place of PLACE_WORDS) {
    if (t.includes(place)) bits.push(place)
  }
  return bits
}

/** 无模型时从标题 + 清洗正文抽名词实体，不收整句谓语。 */
export function heuristicRssTags(entry: RssTagSourceEntry, extra: readonly string[] = []): string[] {
  const source = rssTagSourceText(entry)
  const title = `${entry.titleLocal || ''} ${entry.title || ''}`.trim()
  const bits = titleBits(title)
  for (const m of source.matchAll(/《([^》]{2,18})》/g)) bits.push(m[1])
  for (const m of source.matchAll(/([\u4e00-\u9fff]{2,6}(?:部|委|会|署|局|院|司|厅|集团|公司|银行|大学))/g)) {
    bits.push(m[1])
  }
  for (const m of source.matchAll(/([\u4e00-\u9fff]{2,6}(?:主义|法案|协议|声明|条约|法))/g)) bits.push(m[1])
  for (const place of PLACE_WORDS) {
    if (source.includes(place)) bits.push(place)
  }
  const extras = extra
    .map((x) => x.trim())
    .filter((x) => isNounEntityTag(x) && sourceHasTag(source, x))
  const grounded = groundRssTags([...bits, ...extras].slice(0, 24), entry)
  return grounded.length ? grounded : normalizeRssTags(bits.slice(0, 16))
}

export function rssEntryTagList(entry: RssTagSourceEntry & { tags?: string[] }): string[] {
  const tagged = groundRssTags(entry.tags || [], entry)
  return tagged.length ? tagged : heuristicRssTags(entry)
}

export function relatedRssScore(seed: readonly string[], other: readonly string[]): number {
  if (!seed.length || !other.length) return 0
  const a = new Set(seed.map((x) => x.toLowerCase()))
  let n = 0
  for (const t of other) {
    if (a.has(t.toLowerCase())) n += 1
  }
  return n
}

function titleOverlapScore(a: RssTagSourceEntry, b: RssTagSourceEntry): number {
  const left = new Set(
    titleBits(`${a.titleLocal || ''} ${a.title || ''}`)
      .map((x) => x.toLowerCase())
      .filter((x) => x.length >= 2 && x.length <= 12 && !COARSE_TAGS.has(x) && !CHROME_TAGS.has(x))
  )
  if (!left.size) return 0
  let n = 0
  for (const t of titleBits(`${b.titleLocal || ''} ${b.title || ''}`)) {
    if (left.has(t.toLowerCase())) n += 1
  }
  return n
}

export function relatedEntryScore(
  seed: Pick<RssTaskEntry, 'id' | 'tags' | 'title' | 'titleLocal' | 'valueScore'> & RssTagSourceEntry,
  other: Pick<RssTaskEntry, 'tags' | 'title' | 'titleLocal' | 'valueScore'> & RssTagSourceEntry
): number {
  const tagN = relatedRssScore(rssEntryTagList(seed), rssEntryTagList(other))
  const titleN = titleOverlapScore(seed, other)
  if (tagN + titleN <= 0) return 0
  return tagN * 3 + titleN + (other.valueScore || 0) * 0.4
}

export function pickRelatedRssEntries(
  entries: readonly RssTaskEntry[],
  seed: Pick<RssTaskEntry, 'id' | 'tags' | 'title' | 'titleLocal'> & RssTagSourceEntry,
  limit = 4
): RssTaskEntry[] {
  return [...entries]
    .filter((e) => e.id && e.id !== seed.id)
    .map((e) => ({ e, n: relatedEntryScore(seed, e) }))
    .filter((x) => x.n > 0)
    .sort(
      (a, b) =>
        b.n - a.n || (b.e.valueScore || 0) - (a.e.valueScore || 0) || (b.e.publishedAt || 0) - (a.e.publishedAt || 0)
    )
    .slice(0, Math.max(0, limit))
    .map((x) => x.e)
}

export type RssTagCloudItem = {
  tag: string
  count: number
  scoreSum: number
  weight: number
  kind: RssTagKind
}

export function tagCloudMass(count: number, scoreSum: number): number {
  const n = Math.max(0, count)
  const avg = n ? scoreSum / n : 0
  return n * (1 + avg)
}

/** 图谱/词云：已经打好的标签不要再用残缺标题回滤掉。 */
function tagsForCloud(entry: {
  tags?: string[]
  title?: string
  titleLocal?: string
  snippet?: string
  contentHtml?: string
  extractHtml?: string
  feedTitle?: string
}): string[] {
  const given = normalizeRssTags(entry.tags || [])
  if (given.length) return given
  return rssEntryTagList(entry)
}

export function buildRssTagCloud(
  entries: ReadonlyArray<{
    tags?: string[]
    score?: RssValueScore
    valueScore?: RssValueScore
    title?: string
    titleLocal?: string
    snippet?: string
    contentHtml?: string
    extractHtml?: string
    feedTitle?: string
  }>,
  limit = 28
): RssTagCloudItem[] {
  const map = new Map<string, { tag: string; count: number; scoreSum: number }>()
  for (const e of entries) {
    const tags = tagsForCloud(e)
    const score = e.score || e.valueScore || 0
    for (const tag of tags) {
      const key = tag.toLowerCase()
      const cur = map.get(key)
      if (cur) {
        cur.count += 1
        cur.scoreSum += score
      } else {
        map.set(key, { tag, count: 1, scoreSum: score })
      }
    }
  }
  const raw = [...map.values()].sort(
    (a, b) => tagCloudMass(b.count, b.scoreSum) - tagCloudMass(a.count, a.scoreSum) || b.count - a.count
  )
  const top = raw.slice(0, Math.max(1, limit))
  const max = tagCloudMass(top[0]?.count || 1, top[0]?.scoreSum || 0) || 1
  return top.map((x) => ({
    ...x,
    weight: tagCloudMass(x.count, x.scoreSum) / max,
    kind: classifyRssTag(x.tag)
  }))
}

export type RssTagGraphNode = {
  id: string
  tag: string
  count: number
  kind: RssTagKind
  x: number
  y: number
  r: number
  lx: number
  ly: number
  anchor: 'start' | 'middle' | 'end'
}

export type RssTagGraphEdge = {
  a: string
  b: string
  n: number
}

export type RssTagGraph = {
  nodes: RssTagGraphNode[]
  edges: RssTagGraphEdge[]
}

function tagGraphComponents(ids: string[], edges: RssTagGraphEdge[]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (x: string): string => {
    let cur = x
    while (parent.get(cur) !== cur) cur = parent.get(cur) || cur
    let walk = x
    while (walk !== cur) {
      const next = parent.get(walk) || walk
      parent.set(walk, cur)
      walk = next
    }
    return cur
  }
  for (const e of edges) {
    if (!parent.has(e.a) || !parent.has(e.b)) continue
    const pa = find(e.a)
    const pb = find(e.b)
    if (pa !== pb) parent.set(pa, pb)
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const root = find(id)
    const list = groups.get(root) || []
    list.push(id)
    groups.set(root, list)
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

/** 图谱上实际画出的字宽（和 RssTagMap clip 7 字对齐）。 */
function tagLabelWidth(tag: string): number {
  const t = tag.trim()
  const shown = t.length <= 7 ? t : `${t.slice(0, 7)}…`
  let w = 0
  for (const ch of shown) {
    w += /[\u4e00-\u9fff]/.test(ch) ? 3.55 : 2.15
  }
  return w + 1.4
}

type GraphLabelPos = {
  x: number
  y: number
  lx: number
  ly: number
  anchor: 'start' | 'middle' | 'end'
}

function nodeClearance(radii: number[], labels: string[], i: number, j: number): number {
  const li = tagLabelWidth(labels[i])
  const lj = tagLabelWidth(labels[j])
  return radii[i] + radii[j] + Math.max(7.2, (li + lj) * 0.22)
}

/** 每簇一个中心、邻居按字宽排环；碰撞按标签盒子推开，最后铺满画布而不是缩回一团。 */
function layoutRssTagGraph(
  ids: string[],
  radii: number[],
  edges: RssTagGraphEdge[],
  labels: string[]
): GraphLabelPos[] {
  const n = ids.length
  const at = new Map(ids.map((id, i) => [id, i]))
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const deg = new Float64Array(n)
  const toHub = new Map<string, number>()
  for (const e of edges) {
    const i = at.get(e.a)
    const j = at.get(e.b)
    if (i == null || j == null) continue
    deg[i] += e.n
    deg[j] += e.n
    toHub.set(`${e.a}|${e.b}`, e.n)
    toHub.set(`${e.b}|${e.a}`, e.n)
  }
  const comps = tagGraphComponents(ids, edges)
  const clusters = comps.filter((c) => c.length > 1)
  const loners = comps.filter((c) => c.length === 1).map((c) => c[0])
  const home = new Map<string, { cx: number; cy: number; hub: boolean }>()
  const placeRing = (cx: number, cy: number, members: number[], startAng: number, baseR: number): number => {
    if (!members.length) return baseR
    const slots = members.map((i) => Math.max(radii[i] * 2 + 7, tagLabelWidth(labels[i]) + 7.2))
    const circ = slots.reduce((s, w) => s + w, 0)
    const r = Math.max(baseR, circ / (2 * Math.PI))
    let acc = 0
    members.forEach((i, idx) => {
      const a = startAng + ((acc + slots[idx] / 2) / circ) * Math.PI * 2
      x[i] = cx + Math.cos(a) * r
      y[i] = cy + Math.sin(a) * r
      acc += slots[idx]
    })
    return r
  }

  const packed: { cx: number; cy: number; r: number; hub: number; idxs: number[]; leaves: number[] }[] = []
  clusters.forEach((comp, ci) => {
    const idxs = comp.map((id) => at.get(id)).filter((i): i is number => i != null)
    const hub = idxs.reduce(
      (best, i) => (deg[i] > deg[best] || (deg[i] === deg[best] && radii[i] > radii[best]) ? i : best),
      idxs[0]
    )
    const leaves = idxs
      .filter((i) => i !== hub)
      .sort(
        (a, b) =>
          (toHub.get(`${ids[hub]}|${ids[b]}`) || 0) - (toHub.get(`${ids[hub]}|${ids[a]}`) || 0) || deg[b] - deg[a]
      )
    const inner = leaves.slice(0, 7)
    const outer = leaves.slice(7)
    const r1 = placeRing(0, 0, inner, -Math.PI / 2 + ci * 0.31, 16 + radii[hub])
    const r2 = outer.length ? placeRing(0, 0, outer, -Math.PI / 2 + 0.22 + ci * 0.17, r1 + 15) : r1
    x[hub] = 0
    y[hub] = 0
    packed.push({ cx: 0, cy: 0, r: r2 + 9, hub, idxs, leaves })
  })
  packed.sort((a, b) => b.idxs.length - a.idxs.length || b.r - a.r)
  const mainR = packed.length <= 1 ? 28 : packed.length === 2 ? 24 : 22
  const sideR = packed.length >= 4 ? 10 : 12
  packed.forEach((c, ci) => {
    const cap = ci === 0 ? mainR : sideR
    const k = Math.min(1, cap / Math.max(8, c.r))
    for (const i of c.idxs) {
      x[i] *= k
      y[i] *= k
    }
    c.r *= k
  })
  const sideSlots = [
    [16, 82],
    [84, 82],
    [12, 66],
    [88, 64],
    [50, 90]
  ]
  packed.forEach((c, ci) => {
    if (ci === 0) {
      c.cx = 50
      c.cy = packed.length <= 1 ? 48 : 30
      return
    }
    const slot = sideSlots[(ci - 1) % sideSlots.length]
    c.cx = slot[0]
    c.cy = slot[1]
  })
  for (const c of packed) {
    for (const i of c.idxs) {
      x[i] += c.cx
      y[i] += c.cy
      home.set(ids[i], { cx: c.cx, cy: c.cy, hub: i === c.hub })
    }
  }

  loners.forEach((id, i) => {
    const j = at.get(id)
    if (j == null) return
    const a = Math.PI / 6 + (i / Math.max(1, loners.length)) * Math.PI * 1.7
    const orbit = 38 + Math.min(8, loners.length)
    x[j] = 50 + Math.cos(a) * orbit
    y[j] = 48 + Math.sin(a) * (orbit * 0.8)
    home.set(id, { cx: x[j], cy: y[j], hub: true })
  })

  const sameCluster = new Array<string>(n)
  for (const c of packed) {
    for (const i of c.idxs) sameCluster[i] = ids[c.hub]
  }
  for (let iter = 0; iter < 40; iter++) {
    const cool = 1.8 * Math.pow(0.92, iter)
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (sameCluster[i] && sameCluster[i] !== sameCluster[j]) continue
        let vx = x[i] - x[j]
        let vy = y[i] - y[j]
        let dist = Math.hypot(vx, vy)
        if (dist < 0.2) {
          vx = 0.4
          vy = 0.25
          dist = 0.47
        }
        const minGap = nodeClearance(radii, labels, i, j)
        if (dist >= minGap) continue
        const push = (minGap - dist) * 0.55
        const fx = (vx / dist) * push
        const fy = (vy / dist) * push
        dx[i] += fx
        dy[i] += fy
        dx[j] -= fx
        dy[j] -= fy
      }
    }
    for (let i = 0; i < n; i++) {
      const step = Math.hypot(dx[i], dy[i]) || 1
      const t = Math.min(cool, step)
      x[i] += (dx[i] / step) * t
      y[i] += (dy[i] / step) * t
    }
  }

  const pad = 11
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const hw = tagLabelWidth(labels[i]) / 2
    minX = Math.min(minX, x[i] - Math.max(radii[i], hw * 0.7))
    maxX = Math.max(maxX, x[i] + Math.max(radii[i], hw * 0.7))
    minY = Math.min(minY, y[i] - radii[i] - 2)
    maxY = Math.max(maxY, y[i] + radii[i] + 6.4)
  }
  const spanX = Math.max(8, maxX - minX)
  const spanY = Math.max(8, maxY - minY)
  const sFit = Math.min((100 - pad * 2) / spanX, (84 - pad) / spanY)
  let minPair = Infinity
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      minPair = Math.min(minPair, Math.hypot(x[i] - x[j], y[i] - y[j]))
    }
  }
  const sGap = 13 / Math.max(0.6, minPair)
  const s = Math.min(sFit, Math.max(1, sGap))
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  const packedByHub = new Map(packed.map((c) => [c.hub, c]))
  const main = packed[0]
  const out: GraphLabelPos[] = []
  for (let i = 0; i < n; i++) {
    const px = 50 + (x[i] - mx) * s
    const py = 49 + (y[i] - my) * s
    const origin = home.get(ids[i])
    const inMain = Boolean(main && origin && origin.cx === main.cx && origin.cy === main.cy)
    let ux = 0
    let uy = 1
    if (inMain && origin?.hub) {
      const ring = packedByHub.get(i)
      if (ring && ring.leaves.length) {
        const angs = ring.leaves
          .map((j) => Math.atan2(y[j] - y[i], x[j] - x[i]))
          .sort((a, b) => a - b)
        let best = 0
        let gap = 0
        for (let k = 0; k < angs.length; k++) {
          const a0 = angs[k]
          const a1 = angs[(k + 1) % angs.length] + (k + 1 === angs.length ? Math.PI * 2 : 0)
          if (a1 - a0 > gap) {
            gap = a1 - a0
            best = (a0 + a1) / 2
          }
        }
        ux = Math.cos(best)
        uy = Math.sin(best)
      }
    } else if (inMain && origin) {
      const dist = Math.max(0.4, Math.hypot(x[i] - origin.cx, y[i] - origin.cy))
      ux = (x[i] - origin.cx) / dist
      uy = (y[i] - origin.cy) / dist
    } else if (main) {
      const dist = Math.max(0.4, Math.hypot(x[i] - main.cx, y[i] - main.cy))
      ux = (x[i] - main.cx) / dist
      uy = (y[i] - main.cy) / dist
    }
    const lift = radii[i] * s + (origin?.hub ? 5.6 : 4.8)
    let anchor: GraphLabelPos['anchor'] = 'middle'
    if (ux > 0.42) anchor = 'start'
    else if (ux < -0.42) anchor = 'end'
    out.push({
      x: px,
      y: py,
      lx: px + ux * lift,
      ly: py + uy * lift + (anchor === 'middle' ? (uy >= 0 ? 1.15 : -0.35) : 0.25),
      anchor
    })
  }
  return out
}

/** 共现聚类布局 + 边，给工作台图谱用（确定性力导向）。 */
export function buildRssTagGraph(
  entries: ReadonlyArray<{
    tags?: string[]
    score?: RssValueScore
    valueScore?: RssValueScore
    title?: string
    titleLocal?: string
    snippet?: string
    contentHtml?: string
    extractHtml?: string
    feedTitle?: string
  }>,
  limit = 24
): RssTagGraph {
  const cloud = buildRssTagCloud(entries, limit)
  if (!cloud.length) return { nodes: [], edges: [] }
  const ids = cloud.map((c) => c.tag.toLowerCase())
  const idSet = new Set(ids)
  const pair = new Map<string, number>()
  for (const e of entries) {
    const tags = tagsForCloud(e)
      .map((t) => t.toLowerCase())
      .filter((t) => idSet.has(t))
    const uniq = [...new Set(tags)]
    const mass = 1 + (e.score || e.valueScore || 0) / 5
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const key = uniq[i] < uniq[j] ? `${uniq[i]}|${uniq[j]}` : `${uniq[j]}|${uniq[i]}`
        pair.set(key, (pair.get(key) || 0) + mass)
      }
    }
  }
  const edges: RssTagGraphEdge[] = [...pair.entries()]
    .filter(([, w]) => w >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([key, w]) => {
      const [a, b] = key.split('|')
      return { a, b, n: w }
    })
  const radii = cloud.map((c) => 2.15 + c.weight * 2.1)
  const pos = layoutRssTagGraph(
    ids,
    radii,
    edges,
    cloud.map((c) => c.tag)
  )
  const nodes: RssTagGraphNode[] = cloud.map((c, i) => ({
    id: ids[i],
    tag: c.tag,
    count: c.count,
    kind: c.kind,
    x: pos[i]?.x ?? 50,
    y: pos[i]?.y ?? 48,
    r: radii[i],
    lx: pos[i]?.lx ?? 50,
    ly: pos[i]?.ly ?? 54,
    anchor: pos[i]?.anchor ?? 'middle'
  }))
  return { nodes, edges }
}
