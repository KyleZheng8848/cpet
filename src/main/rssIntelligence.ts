/**
 * RSS 轻量智能：条目价值打分 + 热点盘点（一次性 completion，不写讨论线程）。
 * 直连走 HTTP；Agent 引擎经 setRssAgentComplete 注入的通道跑 headless。
 */
import { getSettings } from './store'
import { recallAgentMemoryPrefBrief, recallAgentMemoryPrefKeywords } from './agentMemory'
import { humanizeRssIntelError } from '../shared/agentErrors'
import { groundRssTags, heuristicRssTags, normalizeRssTags, stripRssChromePlain } from '../shared/rssTags'
import { isAgentModelRef, parseModelRef } from '../shared/models'
import {
  articlePlainExcerpt,
  buildRssDigestTitle,
  clampRssScore,
  formatArticleMediaInventory,
  formatDigestInfoWindow,
  heuristicScoreEntry,
  isThinArticleHtml,
  isUsableRssDigestTitle,
  normalizeRssDigestTemplate,
  rssDigestTemplatePrimarySection,
  rssDigestTemplateShapeHint,
  rssEntryHasUsableBody,
  withRssExtractHtml,
  type RssBodyPatch,
  type RssDigestTemplate,
  type RssDigestWindowHours,
  type RssTaskEntry,
  type RssValueScore
} from '../shared/rssTask'
import { repairDigestHallucinations } from '../shared/rssDigestGuard'
import { loadRssDigestSystemPrompt } from './rssDigestSkill'
import { fetchRssArticle, sanitizeArticleHtml } from './rssTask'
import type { ModelProvider } from '../shared/types'

/** Agent headless 补全：由主进程 agentFacade 注入，避免循环依赖。 */
export type RssAgentCompleteFn = (
  modelRef: string,
  system: string,
  user: string,
  timeoutMs: number
) => Promise<string>

let rssAgentComplete: RssAgentCompleteFn | null = null

export function setRssAgentComplete(fn: RssAgentCompleteFn | null): void {
  rssAgentComplete = fn
}

const SCORE_BATCH = 20
/** 简报喂给模型/模板的上限；超出按评分优先截取，并在 UI 标明窗内总数。 */
export const DIGEST_MAX_ENTRIES = 40

/** 按价值分优先截取简报素材（同分看发布时间）。 */
export function pickDigestEntries(
  entries: RssTaskEntry[],
  limit = DIGEST_MAX_ENTRIES
): RssTaskEntry[] {
  return [...entries]
    .filter((e) => e?.id)
    .sort((a, b) => {
      const ds = (b.valueScore || 0) - (a.valueScore || 0)
      if (ds !== 0) return ds
      return (b.publishedAt || b.fetchedAt || 0) - (a.publishedAt || a.fetchedAt || 0)
    })
    .slice(0, Math.max(0, limit))
}

export type RssScoreResult = {
  id: string
  valueScore: RssValueScore
  scoreReason: string
  tags?: string[]
}

function resolveProvider(providerId: string): ModelProvider | undefined {
  return (getSettings().modelProviders ?? []).find((p) => p.id === providerId)
}

function chatCompletionsUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (b.endsWith('/v1')) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

function anthropicMessagesUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (b.endsWith('/messages')) return b
  if (b.endsWith('/v1')) return `${b}/messages`
  return `${b}/v1/messages`
}

function resolveApiFormat(provider: ModelProvider): 'openai' | 'anthropic' {
  if (provider.apiFormat === 'anthropic' || provider.apiFormat === 'openai') {
    return provider.apiFormat
  }
  const base = (provider.baseUrl || '').toLowerCase()
  if (base.includes('anthropic.com') || /\/v1\/messages\/?$/.test(base)) {
    return 'anthropic'
  }
  return 'openai'
}

/** 是否可用评分/简报模型：直连 API 或 Agent（Agent 用沙箱目录，不依赖用户项目 cwd）。 */
export function canUseRssIntelligenceModel(
  modelRef: string | undefined
): { ok: true; modelRef: string; via: 'api' | 'agent' } | { ok: false; reason: string } {
  const ref = (modelRef || '').trim()
  if (!ref) return { ok: false, reason: '未配置评分模型，使用兴趣词/规则' }
  const providers = getSettings().modelProviders ?? []
  if (isAgentModelRef(providers, ref)) {
    if (!rssAgentComplete) {
      return {
        ok: false,
        reason: 'Agent 通道未就绪（请完全退出后重开应用），已改用兴趣词/规则'
      }
    }
    return { ok: true, modelRef: ref, via: 'agent' }
  }
  const { provider: pid } = parseModelRef(ref)
  const provider = resolveProvider(pid)
  if (!provider || provider.kind !== 'custom') {
    return { ok: false, reason: '评分模型需为直连 API 或 Agent 引擎，已改用规则' }
  }
  if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) {
    return { ok: false, reason: `「${provider.label}」缺少 Base URL/Key，已改用规则` }
  }
  return { ok: true, modelRef: ref, via: 'api' }
}

function keywordOptsFromSettings(): {
  interestKeywords?: string[]
  muteKeywords?: string[]
} {
  const s = getSettings()
  const prefs = recallAgentMemoryPrefKeywords()
  const interest = [...(s.briefInterestKeywords || []), ...prefs].filter(Boolean)
  return {
    interestKeywords: interest.length ? [...new Set(interest)] : undefined,
    muteKeywords: s.briefMuteKeywords
  }
}

function tagsFromScoreHit(
  entry: RssTaskEntry,
  raw: unknown,
  interest?: readonly string[]
): string[] | undefined {
  const grounded = groundRssTags(normalizeRssTags(raw), entry)
  const next = grounded.length ? grounded : heuristicRssTags(entry, interest)
  return next.length ? next : undefined
}

function formatFetchFailure(err: unknown, label: string): Error {
  const base = err instanceof Error ? err.message : String(err)
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? err.cause.message
      : err instanceof Error && err.cause != null
        ? String(err.cause)
        : ''
  const detail = [base, cause].filter(Boolean).join(' · ')
  return new Error(`${label}请求失败：${detail || 'fetch failed'}`)
}

async function oneShotCompletion(
  modelRef: string,
  system: string,
  user: string,
  timeoutMs = 60_000,
  maxTokens = 4096
): Promise<string> {
  const providers = getSettings().modelProviders ?? []
  if (isAgentModelRef(providers, modelRef)) {
    if (!rssAgentComplete) throw new Error('Agent 通道未就绪')
    return rssAgentComplete(modelRef, system, user, timeoutMs)
  }

  const { provider: pid, model } = parseModelRef(modelRef)
  const provider = resolveProvider(pid)
  if (!provider) throw new Error('提供商不存在')
  const format = resolveApiFormat(provider)
  const apiKey = (provider.apiKey || '').trim()
  const label = provider.label || pid || '模型'
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    if (format === 'anthropic') {
      let res: Response
      try {
        res = await fetch(anthropicMessagesUrl(provider.baseUrl || ''), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }]
          }),
          signal: ctl.signal
        })
      } catch (err) {
        throw formatFetchFailure(err, label)
      }
      const text = await res.text()
      if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 240)}`)
      const json = JSON.parse(text) as {
        content?: Array<{ type?: string; text?: string }>
      }
      return (json.content || [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text || '')
        .join('\n')
        .trim()
    }

    let res: Response
    try {
      res = await fetch(chatCompletionsUrl(provider.baseUrl || ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        }),
        signal: ctl.signal
      })
    } catch (err) {
      throw formatFetchFailure(err, label)
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 240)}`)
    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((c) => (typeof c === 'object' && c && 'text' in c ? String(c.text || '') : ''))
        .join('')
        .trim()
    }
    return ''
  } finally {
    clearTimeout(timer)
  }
}

function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence?.[1]?.trim() || trimmed
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON 数组')
  const parsed = JSON.parse(body.slice(start, end + 1)) as unknown
  if (!Array.isArray(parsed)) throw new Error('模型返回不是数组')
  return parsed
}

function entryLine(it: RssTaskEntry, i: number): string {
  const src = (it.feedTitle || it.feedId || '').slice(0, 32)
  const snip = stripRssChromePlain((it.snippet || '').replace(/\s+/g, ' ')).slice(0, 140)
  const body = stripRssChromePlain(articlePlainExcerpt(it.extractHtml || it.contentHtml, 900))
  const bodyBit = body
    ? `\n   正文：${body}`
    : '\n   正文：（无网页原文，只能据标题摘要保守打分，勿臆造细节）'
  return `${i + 1}. id=${it.id}\n   标题：${it.title}\n   来源：${src}\n   摘要：${snip || '（无）'}${bodyBit}`
}

/** 简报用：标题 + URL + 正文摘录 + 媒体（优先链接正文，不是只靠摘要）。 */
function entryDigestListingLine(it: RssTaskEntry, i: number): string {
  const score = it.valueScore != null ? `分${it.valueScore}` : '未评分'
  const src = (it.feedTitle || '').slice(0, 24)
  const body = articlePlainExcerpt(it.contentHtml, 1600)
  const snip = (it.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 220)
  const bodyBit = body || (snip ? `（仅摘要）${snip}` : '（无原文——勿编造）')
  const media = formatArticleMediaInventory(it.contentHtml, 4)
  const mediaBit = media ? `\n   媒体：${media.replace(/\n/g, ' ； ')}` : ''
  return `${i + 1}. [${score}] ${it.title}（${src}）\n   URL: ${it.url}\n   正文：${bodyBit}${mediaBit}`
}

/** 评分/简报前补抓缺正文的条目（限流）；成功者带落盘补丁。 */
export async function ensureEntryBodiesForDigest(
  entries: RssTaskEntry[],
  limit = 24
): Promise<{ entries: RssTaskEntry[]; patches: RssBodyPatch[] }> {
  const out = entries.map((e) => ({ ...e }))
  const patches: RssBodyPatch[] = []
  const need = out
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.url && !rssEntryHasUsableBody(e))
    .slice(0, limit)
  const concurrency = 4
  for (let i = 0; i < need.length; i += concurrency) {
    const chunk = need.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async ({ e, i: idx }) => {
        try {
          const r = await fetchRssArticle(e.url, {
            fallbackHtml:
              e.contentHtml ||
              (e.snippet?.trim() ? `<p>${e.snippet.trim()}</p>` : undefined) ||
              e.extractHtml
          })
          if (r.ok && r.html) {
            const source: 'feed' | 'extract' = r.partial ? 'feed' : 'extract'
            const patched = withRssExtractHtml(e, r.html, source)
            const title = e.title || r.title || e.title
            out[idx] = title && title !== patched.title ? { ...patched, title } : patched
            patches.push({
              id: e.id,
              extractHtml: r.html,
              contentSource: source,
              title: r.title
            })
          }
        } catch {
          /* 单条失败不影响整份简报 */
        }
      })
    )
  }
  return { entries: out, patches }
}

async function scoreBatchWithModel(
  batch: RssTaskEntry[],
  modelRef: string
): Promise<RssScoreResult[]> {
  const kw = keywordOptsFromSettings()
  const pref = recallAgentMemoryPrefBrief()
  const system = [
    '你是资讯主编，按「对这位读者是否值得花时间」打分。',
    pref
      ? `读者偏好必须作为加/减分依据（命中关心/在做的抬到 4–5，明确讨厌的压到 1–2）：\n${pref}`
      : '没有读者偏好时，按行业通用价值打分。',
    '标尺：5=必读（突发/重大决策信息）；4=值得看（明确进展或深度）；3=一般（可扫一眼）；2=可略（汇编/软文/重复）；1=噪音（广告招聘促销）。',
    '同时打 2–5 个细标签：必须是这篇正文里出现的公司、产品、模型、人物、法案或事件名。',
    '禁止「科技/新闻/AI/热点/行业」这类粗标签；禁止把相关推荐、广告、导航、下载、订阅、热门标签等页面牛皮癣打成标签。',
    '优先依据「正文」字段；没有正文时只能保守打分，禁止脑补未给出的事实。标签必须能在标题或正文里找到原文。',
    '只输出 JSON 数组：[{"id":"...","score":4,"reason":"不超过24字","tags":["OpenAI","GPT-5"]}]。不要其它文字。'
  ].join('')
  const user = `请为以下 ${batch.length} 条打分并打标签：\n\n${batch.map(entryLine).join('\n\n')}`
  const raw = await oneShotCompletion(modelRef, system, user)
  const arr = extractJsonArray(raw)
  const byId = new Map<string, RssScoreResult>()
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue
    const o = row as { id?: unknown; score?: unknown; reason?: unknown; tags?: unknown }
    const id = typeof o.id === 'string' ? o.id : ''
    const score = clampRssScore(o.score)
    if (!id || !score) continue
    const entry = batch.find((x) => x.id === id)
    byId.set(id, {
      id,
      valueScore: score,
      scoreReason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 160) : '模型评分',
      tags: entry ? tagsFromScoreHit(entry, o.tags, kw.interestKeywords) : normalizeRssTags(o.tags)
    })
  }
  return batch.map((it) => {
    const hit = byId.get(it.id)
    if (hit) return { ...hit, tags: hit.tags?.length ? hit.tags : heuristicRssTags(it, kw.interestKeywords) }
    const h = heuristicScoreEntry(it, kw)
    return { id: it.id, valueScore: h.valueScore, scoreReason: `补全·${h.scoreReason}`, tags: h.tags }
  })
}

export async function scoreRssEntries(payload: {
  entries: RssTaskEntry[]
  /** 评分专用模型；缺省读 settings.rssScoreModelRef */
  modelRef?: string
  forceHeuristic?: boolean
}): Promise<{
  ok: boolean
  scores: RssScoreResult[]
  mode: 'model' | 'heuristic'
  error?: string
  /** 评分时补抓成功的正文，调用方应写回任务条目。 */
  bodyPatches?: RssBodyPatch[]
}> {
  const entries = (payload.entries || []).filter((e) => e?.id).slice(0, 80)
  if (!entries.length) return { ok: true, scores: [], mode: 'heuristic', bodyPatches: [] }

  const settings = getSettings()
  const modelRef =
    typeof payload.modelRef === 'string' && payload.modelRef.trim()
      ? payload.modelRef.trim()
      : (settings.rssScoreModelRef || '').trim()
  const kw = keywordOptsFromSettings()
  const check = canUseRssIntelligenceModel(modelRef)
  if (payload.forceHeuristic || !check.ok) {
    return {
      ok: true,
      scores: entries.map((e) => {
        const h = heuristicScoreEntry(e, kw)
        return { id: e.id, valueScore: h.valueScore, scoreReason: h.scoreReason, tags: h.tags }
      }),
      mode: 'heuristic',
      error: check.ok ? undefined : check.reason,
      bodyPatches: []
    }
  }

  try {
    // 评分前尽量抓网页原文，避免只对着标题瞎打
    const { entries: withBodies, patches } = await ensureEntryBodiesForDigest(entries, 40)
    const scores: RssScoreResult[] = []
    for (let i = 0; i < withBodies.length; i += SCORE_BATCH) {
      const batch = withBodies.slice(i, i + SCORE_BATCH)
      scores.push(...(await scoreBatchWithModel(batch, check.modelRef)))
    }
    return { ok: true, scores, mode: 'model', bodyPatches: patches }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: true,
      scores: entries.map((e) => {
        const h = heuristicScoreEntry(e, kw)
        return { id: e.id, valueScore: h.valueScore, scoreReason: `回退·${h.scoreReason}`, tags: h.tags }
      }),
      mode: 'heuristic',
      error: humanizeRssIntelError(msg),
      bodyPatches: []
    }
  }
}

function digestLink(entry: RssTaskEntry): string {
  const name = (entry.feedTitle || '来源').trim().slice(0, 32) || '来源'
  const title = (entry.title || '无标题').trim().slice(0, 80)
  return `[${name}：${title}](${entry.url})`
}

function digestSourceLabel(entry: RssTaskEntry): string {
  const name = (entry.feedTitle || '来源').trim().slice(0, 32) || '来源'
  const title = (entry.title || '无标题').trim().slice(0, 80)
  return `${name}：${title}`
}

/** 写稿 system：真源为内置 skill cpet-rss-digest（craft + forms/<template>）。 */
function digestSystemPrompt(template: RssDigestTemplate): string {
  return loadRssDigestSystemPrompt(template)
}

function heuristicThemeForEntry(entry: RssTaskEntry): string {
  const t = `${entry.title || ''} ${entry.snippet || ''} ${entry.feedTitle || ''}`.toLowerCase()
  if (/融资|funding|seed|series|估值|ipo|收购轮/.test(t)) return '投融资动态'
  if (/安全|security|漏洞|jailbreak|红队|治理|监管|法案|政策|合规/.test(t)) {
    return '安全、治理与政策'
  }
  if (/医疗|health|生物|science|科研|实验室/.test(t)) return 'AI + 科研 / 医疗'
  if (/机器人|robot|具身|人形/.test(t)) return '具身智能'
  if (/中国|国产|deepseek|月之暗面|kimi|通义|智谱|百度|华为|昇腾/.test(t)) {
    return '中国市场动态'
  }
  if (/发布|模型|model|gpt|claude|gemini|llama|权重|开源|api/.test(t)) {
    return '模型发布与更新'
  }
  if (/agent|产品|平台|app|助手|工作流|workflow|presence/.test(t)) return '平台与产品'
  return '其他动态'
}

function heuristicDigestMarkdown(
  hours: number,
  entries: RssTaskEntry[],
  template: RssDigestTemplate,
  note?: string,
  title?: string,
  infoWindow?: string,
  windowCount?: number
): string {
  const top = [...entries]
    .sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0))
    .slice(0, template === 'brief' ? 10 : 16)
  const heading =
    title?.trim() ||
    buildRssDigestTitle({
      windowHours: hours as RssDigestWindowHours,
      createdAt: Date.now(),
      entries: top
    })
  const titleLine = `# ${heading}`
  const windowLine = `信息窗口：${infoWindow || formatDigestInfoWindow(hours)}`
  const win = typeof windowCount === 'number' && windowCount > entries.length ? windowCount : 0
  const capBit = win ? `；窗内 ${win} 条已按评分截取前 ${entries.length} 条` : ''
  const reasonBit = note ? `；原因：${note}` : ''
  // 放在概览前：失败回退必须一眼可见，不能伪装成完整模型简报
  const noteLine = `> **模板骨架（非模型归纳）** · 纳入 ${entries.length} 条素材${capBit}${reasonBit}。点「重新生成」可再试模型。`
  const overview = top
    .slice(0, template === 'brief' ? 8 : 10)
    .map((t) => {
      const bit = (t.snippet || '').trim().slice(0, 120)
      return bit
        ? `● ${t.title} — ${bit} ${digestLink(t)}`
        : `● ${t.title}${t.feedTitle ? `（${t.feedTitle}）` : ''} ${digestLink(t)}`
    })
  const sources = top.map((t) => `● ${digestLink(t)}`)
  if (template === 'followup') {
    const signals = top.filter((t) => (t.valueScore || 0) >= 3).slice(0, 6)
    const pick = signals.length ? signals : top.slice(0, 5)
    return [
      titleLine,
      windowLine,
      '',
      '## 关键信号',
      ...pick.map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 100)
        return bit
          ? `● **${t.title}** — ${bit} ${digestLink(t)}`
          : `● **${t.title}** — ${digestLink(t)}`
      }),
      '',
      noteLine,
      '',
      '## 为什么重要',
      ...pick.slice(0, 4).map((t) => `● ${t.title}：据报道值得纳入跟踪 ${digestLink(t)}`),
      '',
      '## 该盯谁/盯什么',
      ...pick.slice(0, 4).map((t) => {
        const who = t.feedTitle?.trim() || '相关方'
        return `● ${who} / ${t.title.slice(0, 40)}${digestLink(t) ? ` ${digestLink(t)}` : ''}`
      }),
      '',
      '## 资料来源',
      ...sources
    ].join('\n')
  }
  if (template === 'brief') {
    const heads = top.filter((t) => (t.valueScore || 0) >= 3).slice(0, 10)
    const pick = heads.length ? heads : top.slice(0, 8)
    return [
      titleLine,
      windowLine,
      '',
      '## 必读头条',
      ...pick.map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 80)
        return bit
          ? `● **${t.title}** — ${bit} ${digestLink(t)}`
          : `● **${t.title}** — ${digestLink(t)}`
      }),
      '',
      noteLine,
      '',
      '## 资料来源',
      ...sources.slice(0, pick.length)
    ].join('\n')
  }
  if (template === 'daily') {
    const pick = top.filter((t) => (t.valueScore || 0) >= 3).slice(0, 3)
    const lines = (pick.length ? pick : top.slice(0, 3)).map((t) => {
      const bit = (t.snippet || '').trim().slice(0, 60)
      return bit
        ? `● ${t.title}：${bit} ${digestLink(t)}`
        : `● ${t.title} ${digestLink(t)}`
    })
    while (lines.length < 3) lines.push('● （该时段信息不足，待补充）')
    const action = top[0]
      ? `● 优先读：${top[0].title.slice(0, 40)} ${digestLink(top[0])}`
      : '● 先刷新订阅再生成'
    return [
      titleLine,
      windowLine,
      '',
      '## 今日主线',
      ...lines.slice(0, 3),
      '',
      '## 今天优先',
      action,
      '',
      noteLine,
      '',
      '## 资料来源',
      ...sources.slice(0, 6)
    ].join('\n')
  }
  if (template === 'risks') {
    const risky = top.filter((t) => {
      const s = `${t.title} ${t.snippet || ''}`.toLowerCase()
      return (
        (t.valueScore || 0) >= 3 ||
        /安全|漏洞|监管|合规|下架|故障|泄露|争议|lawsuit|breach|ban/.test(s)
      )
    })
    const pick = (risky.length ? risky : top).slice(0, 8)
    return [
      titleLine,
      windowLine,
      '',
      '## 风险与争议',
      ...pick.map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 80)
        const kind = /安全|漏洞|breach|leak/.test(`${t.title}${t.snippet || ''}`)
          ? '安全'
          : /监管|合规|法案|policy/.test(`${t.title}${t.snippet || ''}`)
            ? '合规'
            : /故障|outage|宕机/.test(`${t.title}${t.snippet || ''}`)
              ? '故障'
              : '争议'
        return bit
          ? `● **[${kind}] ${t.title}** — ${bit} ${digestLink(t)}`
          : `● **[${kind}] ${t.title}** — ${digestLink(t)}`
      }),
      '',
      '## 紧迫度',
      `● 高：${pick.slice(0, 2).map((t) => t.title.slice(0, 24)).join('；') || '暂无'}`,
      `● 中：${pick.slice(2, 5).map((t) => t.title.slice(0, 24)).join('；') || '暂无'}`,
      '',
      noteLine,
      '',
      '## 资料来源',
      ...pick.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  if (template === 'changes') {
    const pick = top.filter((t) => (t.valueScore || 0) >= 3).slice(0, 10)
    const list = pick.length ? pick : top.slice(0, 8)
    return [
      titleLine,
      windowLine,
      '',
      '## 本时段变动',
      ...list.map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 80)
        return bit
          ? `● **${t.title}** — ${bit} ${digestLink(t)}`
          : `● **${t.title}** — ${digestLink(t)}`
      }),
      '',
      noteLine,
      '',
      '## 资料来源',
      ...list.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  if (template === 'flash') {
    const list = top.slice(0, 12)
    return [
      titleLine,
      windowLine,
      '',
      '## 快讯',
      ...list.map((t) => `● ${t.title}${t.feedTitle ? `（${t.feedTitle}）` : ''} ${digestLink(t)}`),
      '',
      noteLine,
      '',
      '## 资料来源',
      ...list.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  if (template === 'action') {
    const pick = top.filter((t) => (t.valueScore || 0) >= 3).slice(0, 8)
    const list = pick.length ? pick : top.slice(0, 6)
    const watch = top.filter((t) => !list.includes(t)).slice(0, 3)
    return [
      titleLine,
      windowLine,
      '',
      '## 本周行动',
      ...list.map((t) => `● **跟进：${t.title.slice(0, 36)}** — 本周内读完并判断是否跟进 ${digestLink(t)}`),
      '',
      '## 观望项',
      ...(watch.length
        ? watch.map((t) => `● ${t.title.slice(0, 40)} — 信息不足，先观望 ${digestLink(t)}`)
        : ['● 暂无额外观望项']),
      '',
      noteLine,
      '',
      '## 资料来源',
      ...list.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  if (template === 'wechat') {
    const lead = top.slice(0, 3)
    const body = top.slice(0, 8)
    return [
      titleLine,
      windowLine,
      '',
      '## 导语',
      ...lead.map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 70)
        return bit
          ? `● ${t.title}：${bit} ${digestLink(t)}`
          : `● ${t.title} ${digestLink(t)}`
      }),
      '',
      '## 正文',
      '### 重点进展',
      ...body.slice(0, 4).map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 100)
        return bit
          ? `● **${t.title}** — ${bit} ${digestLink(t)}`
          : `● **${t.title}** ${digestLink(t)}`
      }),
      '',
      '### 延伸阅读',
      ...body.slice(4, 8).map((t) => `● ${t.title} ${digestLink(t)}`),
      '',
      '## 结语',
      '● 以上为模板骨架，选好模型后可生成完整公众号长文。',
      '',
      noteLine,
      '',
      '## 资料来源',
      ...sources.slice(0, 10)
    ].join('\n')
  }
  if (template === 'xhs') {
    const hooks = top.slice(0, 3)
    const body = top.slice(0, 8)
    return [
      titleLine,
      windowLine,
      '',
      '## 封面钩子',
      ...hooks.map((t, i) => `● ${i === 0 ? '别错过：' : ''}${t.title.slice(0, 28)}`),
      '',
      '## 正文要点',
      ...body.map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 50)
        return bit
          ? `● ${t.title.slice(0, 24)}：${bit} ${digestLink(t)}`
          : `● ${t.title.slice(0, 28)} ${digestLink(t)}`
      }),
      '',
      '## 互动引导',
      '● 你更关心哪一条？评论区聊聊',
      '● 需要我拆某一条细节吗？',
      '',
      noteLine,
      '',
      '## 资料来源',
      ...body.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  if (template === 'report') {
    const pick = top.filter((t) => (t.valueScore || 0) >= 3).slice(0, 6)
    const list = pick.length ? pick : top.slice(0, 5)
    return [
      titleLine,
      windowLine,
      '',
      '## 核心结论',
      ...list.slice(0, 5).map((t) => {
        const bit = (t.snippet || '').trim().slice(0, 80)
        return bit
          ? `● **${t.title}** — ${bit} ${digestLink(t)}`
          : `● **${t.title}** ${digestLink(t)}`
      }),
      '',
      '## 论据拆解',
      '### 事实与信号',
      ...list.map((t) => `● ${t.title}${t.snippet ? `：${t.snippet.slice(0, 90)}` : ''} ${digestLink(t)}`),
      '',
      '## 风险与不确定',
      '● 以上为模板骨架结论，细节待模型补全；证据边界以资料来源为准。',
      ...list.slice(0, 2).map((t) => `● 需二次核实：${t.title.slice(0, 32)} ${digestLink(t)}`),
      '',
      noteLine,
      '',
      '## 资料来源',
      ...list.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  if (template === 'script') {
    const pick = top.slice(0, 8)
    return [
      titleLine,
      windowLine,
      '',
      '## 开场白',
      `● 这 ${hours} 小时里，有几条值得你停下刷的信息。`,
      ...pick.slice(0, 2).map((t) => `● 先说：${t.title.slice(0, 36)}`),
      '',
      '## 分镜口播',
      ...pick.map(
        (t, i) =>
          `● 镜头${i + 1}：${t.title.slice(0, 40)}${t.snippet ? `——${t.snippet.slice(0, 40)}` : ''} ${digestLink(t)}`
      ),
      '',
      '## 收束 CTA',
      '● 觉得有用就收藏，下一条我继续帮你筛。',
      '● 想听某一条深挖，评论区留言。',
      '',
      noteLine,
      '',
      '## 资料来源',
      ...pick.map((t) => `● ${digestLink(t)}`)
    ].join('\n')
  }
  const themed = new Map<string, RssTaskEntry[]>()
  for (const e of top.slice(0, 12)) {
    const theme = heuristicThemeForEntry(e)
    const list = themed.get(theme) || []
    list.push(e)
    themed.set(theme, list)
  }
  const sections: string[] = []
  for (const [theme, list] of themed) {
    if (theme === '其他动态' && themed.size > 1) continue
    sections.push(`## ${theme}`)
    for (const e of list.slice(0, 4)) {
      sections.push(`### ${e.title}`)
      sections.push(`● ${digestLink(e)}${e.snippet ? `\n● ${e.snippet.slice(0, 160)}` : ''}`)
      sections.push('')
    }
  }
  return [
    titleLine,
    windowLine,
    '',
    noteLine,
    '',
    '## 本期概览',
    ...overview,
    '',
    ...sections,
    '## 资料来源',
    ...sources
  ].join('\n')
}

function entryByUrl(entries: RssTaskEntry[]): Map<string, RssTaskEntry> {
  const map = new Map<string, RssTaskEntry>()
  for (const e of entries) {
    const u = (e.url || '').trim()
    if (u) map.set(u, e)
    try {
      const norm = new URL(u).href
      map.set(norm, e)
    } catch {
      /* ignore */
    }
  }
  return map
}

/** 从正文抽出出现过的 URL，用于补全资料来源。 */
function urlsMentionedInMarkdown(md: string): string[] {
  const found: string[] = []
  const re = /https?:\/\/[^\s)\]>'"]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(md))) {
    const u = m[0].replace(/[.,;:!?]+$/, '')
    if (!found.includes(u)) found.push(u)
  }
  return found
}

/** 旧体例标记：出现则整篇不可用，需重排。 */
const LEGACY_DIGEST_MARKERS =
  /Top\s*话题|可略过噪音|时段概述|重点条目|热点盘点|Hot\s*Topics/i

/** 删除旧章节（从旧标题行起到下一 Markdown 标题之前）。 */
export function stripLegacyDigestSections(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const title = heading[2].trim()
      if (/^(Top\s*话题|可略过噪音|重点条目|热点盘点|Hot\s*Topics)(\s|$|：|:)/i.test(title + ' ')) {
        skipping = true
        continue
      }
      if (/^时段概述(\s|$|：|:)/.test(title + ' ')) {
        skipping = false
        out.push('## 本期概览')
        continue
      }
      skipping = false
      out.push(line)
      continue
    }
    if (/^时段概述\s*$/.test(line.trim())) {
      skipping = false
      out.push('## 本期概览')
      continue
    }
    if (/^(Top\s*话题|可略过噪音)(\s|$)/i.test(line.trim() + ' ')) {
      skipping = true
      continue
    }
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function digestPrimarySection(template: RssDigestTemplate): string {
  return rssDigestTemplatePrimarySection(template)
}

/** 主章节若是整段文字，拆成 ● 要点。 */
function ensureOverviewBullets(markdown: string, section = '本期概览'): string {
  const re = new RegExp(`(^##\\s*${section}\\s*$)`, 'm')
  const parts = markdown.split(re)
  if (parts.length < 3) return markdown
  const before = parts[0] + parts[1]
  const rest = parts.slice(2).join('')
  const nextHeading = rest.search(/^##\s+/m)
  const overviewBody = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest
  const after = nextHeading >= 0 ? rest.slice(nextHeading) : ''
  if (/[●•]/.test(overviewBody)) return markdown
  const text = overviewBody.replace(/\s+/g, ' ').trim()
  if (!text) return markdown
  const sentences = text
    .split(/[。！？]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, 10)
  if (!sentences.length) return markdown
  const bullets = sentences.map((s) => `● ${s}${/[。！？]$/.test(s) ? '' : '。'}`).join('\n')
  return `${before}\n\n${bullets}\n\n${after}`.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 是否已是对应形态体例（信息窗口 + 主章节要点 + 资料来源，且无旧结构）。
 * 失败则应丢弃模型稿、改用结构化重排。
 */
export function isDigestFormat(
  markdown: string,
  template: RssDigestTemplate = 'full'
): boolean {
  const t = (markdown || '').trim()
  if (!t) return false
  if (LEGACY_DIGEST_MARKERS.test(t)) return false
  if (!/^信息窗口：/m.test(t)) return false
  if (!/^##\s*资料来源\s*$/m.test(t)) return false
  const sources = t.split(/^##\s*资料来源\s*$/m)[1] || ''
  if (!/\[[^\]]+\]\(https?:\/\//.test(sources)) return false
  const section = digestPrimarySection(template)
  const sectionRe = new RegExp(`^##\\s*${section}\\s*$`, 'm')
  if (!sectionRe.test(t)) return false
  const body = t.split(sectionRe)[1]?.split(/^##\s+/m)[0] || ''
  return /[●•]/.test(body)
}

/** @deprecated 用 isDigestFormat(md, 'full')；保留给旧测试。 */
export function isWeeklyDigestFormat(markdown: string): boolean {
  return isDigestFormat(markdown, 'full')
}

/**
 * 按形态归一：剥旧章节、保证信息窗口/主章节/资料来源可点链接。
 */
export function normalizeDigestMarkdown(
  markdown: string,
  entries: RssTaskEntry[],
  infoWindow: string,
  template: RssDigestTemplate = 'full'
): string {
  let md = stripLegacyDigestSections(markdown.replace(/\r\n/g, '\n').trim())
  if (!md) return md
  const section = digestPrimarySection(template)

  md = md.replace(/^##\s*重点进展\s*$/gim, '## 重点进展')

  if (!/^信息窗口：/m.test(md)) {
    if (/^#\s+\S/.test(md)) {
      const lines = md.split('\n')
      lines.splice(1, 0, `信息窗口：${infoWindow}`, '')
      md = lines.join('\n')
    } else {
      md = `信息窗口：${infoWindow}\n\n${md}`
    }
  } else {
    md = md.replace(/^信息窗口：.*$/m, `信息窗口：${infoWindow}`)
  }

  const sectionBare = new RegExp(`^${section}\\s*$`, 'm')
  const sectionHead = new RegExp(`^##\\s*${section}`, 'm')
  if (!sectionHead.test(md)) {
    md = md.replace(sectionBare, `## ${section}`)
  }
  // 仍无主章节：在信息窗口后插入空壳，后续用条目填
  if (!sectionHead.test(md)) {
    md = md.replace(/^(信息窗口：.*\n)/m, `$1\n## ${section}\n\n`)
  }

  md = ensureOverviewBullets(md, section)

  // 主章节仍无要点 → 用高分条目垫几条
  if (!isDigestFormat(md, template) && entries.length) {
    const splitRe = new RegExp(`^##\\s*${section}\\s*$`, 'm')
    const overviewHasBullet = /[●•]/.test(md.split(splitRe)[1]?.split(/^##\s+/m)[0] || '')
    if (!overviewHasBullet) {
      const top = [...entries]
        .sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0))
        .slice(0, template === 'brief' ? 10 : 8)
      const bullets = top
        .map((e) => {
          const bit = (e.snippet || '').trim().slice(0, 100)
          return bit
            ? `● ${e.title} — ${bit} ${digestLink(e)}`
            : `● ${e.title} ${digestLink(e)}`
        })
        .join('\n')
      const fillRe = new RegExp(
        `(^##\\s*${section}\\s*\\n)([\\s\\S]*?)(?=^##\\s+)`,
        'm'
      )
      md = md.replace(fillRe, `$1\n${bullets}\n\n`)
    }
  }

  const byUrl = entryByUrl(entries)
  // 只认正文引用过的 URL；禁止再把未引用高分条目灌进资料来源（真实稿曾被灌到 20+ 条，读感崩掉）
  const bodyOnly = md.split(/^##\s*资料来源\s*$/m)[0] || md
  const mentioned = urlsMentionedInMarkdown(bodyOnly)
  const sourceEntries: RssTaskEntry[] = []
  const seen = new Set<string>()
  for (const u of mentioned) {
    const hit =
      byUrl.get(u) ||
      [...byUrl.values()].find((e) => u.startsWith(e.url) || e.url.startsWith(u))
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id)
      sourceEntries.push(hit)
    }
  }
  const sourceCap =
    template === 'daily' || template === 'flash' || template === 'brief'
      ? 12
      : template === 'full' || template === 'wechat' || template === 'report'
        ? 16
        : 14
  if (!sourceEntries.length) {
    sourceEntries.push(
      ...[...entries]
        .sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0))
        .slice(0, Math.min(6, entries.length))
    )
  } else if (sourceEntries.length > sourceCap) {
    sourceEntries.length = sourceCap
  }

  const sourcesBlock = [
    '## 资料来源',
    '',
    ...sourceEntries.map((e) => `● ${digestLink(e)}`)
  ].join('\n')

  if (/##\s*资料来源[\s\S]*$/i.test(md)) {
    md = md.replace(/##\s*资料来源[\s\S]*$/i, sourcesBlock)
  } else {
    md = `${md.replace(/\s*$/, '')}\n\n${sourcesBlock}`
  }

  md = md
    .split('\n')
    .map((line) => {
      const bare = line.match(/^[●•-]\s*(https?:\/\/\S+)\s*$/i)
      if (!bare) return line
      const url = bare[1].replace(/[.,;:!?]+$/, '')
      const hit =
        byUrl.get(url) ||
        [...byUrl.values()].find((e) => url.startsWith(e.url) || e.url.startsWith(url))
      if (!hit) return line
      return `● ${digestLink(hit)}`
    })
    .join('\n')

  // 行内「(来源): https://...」旧写法 → 尽量收成链接
  md = md.replace(
    /[（(]([^）)]{1,40})[）)]\s*[:：]?\s*(https?:\/\/[^\s)\]>'"]+)/g,
    (_m, name: string, url: string) => {
      const hit =
        byUrl.get(url) ||
        [...byUrl.values()].find((e) => url.startsWith(e.url) || e.url.startsWith(url))
      if (hit) return digestLink(hit)
      return `[${String(name).trim()}](${url})`
    }
  )

  return md.replace(/\n{3,}/g, '\n\n').trim()
}

/** 体例归一 + 幻觉检测；旧体例 fail-closed 整篇重排。 */
export function finalizeDigestMarkdown(
  markdown: string,
  entries: RssTaskEntry[],
  infoWindow: string,
  opts?: {
    hours?: number
    template?: RssDigestTemplate
    title?: string
  }
): { markdown: string; repairNote?: string; repaired: boolean; reformatted: boolean } {
  const notes: string[] = []
  let reformatted = false
  const template = opts?.template || 'full'
  const hadLegacy = LEGACY_DIGEST_MARKERS.test(markdown)
  let working = normalizeDigestMarkdown(markdown, entries, infoWindow, template)
  if (hadLegacy) {
    reformatted = true
    notes.push('已去除旧体例并按所选形态重排')
  }

  if (!isDigestFormat(working, template) && entries.length) {
    const title =
      opts?.title ||
      buildRssDigestTitle({
        markdown: working,
        windowHours: (opts?.hours || 24) as RssDigestWindowHours,
        createdAt: Date.now(),
        entries
      })
    working = heuristicDigestMarkdown(
      opts?.hours || 24,
      entries,
      template,
      '模型未按所选形态输出，已重排',
      title
    )
    working = normalizeDigestMarkdown(working, entries, infoWindow, template)
    reformatted = true
    notes.push('模型未按所选形态，已重排')
  }

  const guarded = repairDigestHallucinations(working, entries)
  let md = normalizeDigestMarkdown(guarded.markdown, entries, infoWindow, template)
  // 二次验收：仍不合格再强制启发式
  if (!isDigestFormat(md, template) && entries.length) {
    const title =
      opts?.title ||
      buildRssDigestTitle({
        windowHours: (opts?.hours || 24) as RssDigestWindowHours,
        createdAt: Date.now(),
        entries
      })
    md = normalizeDigestMarkdown(
      heuristicDigestMarkdown(
        opts?.hours || 24,
        entries,
        template,
        '格式校验未通过',
        title
      ),
      entries,
      infoWindow,
      template
    )
    reformatted = true
    if (!notes.length) notes.push('格式校验未通过，已按所选形态重排')
  }

  if (guarded.summary) notes.push(guarded.summary)
  const repairNote = notes.length ? notes.join(' · ') : undefined
  if (repairNote) {
    md = md.replace(/\n*_校验：.*_?\s*$/u, '').trim()
    md = md.replace(/\n*_模型未按(周报体例|所选形态).*_?\s*$/u, '').trim()
    md = `${md}\n\n_${repairNote}_`
  }
  return {
    markdown: md,
    repairNote,
    repaired: Boolean(guarded.repaired || reformatted),
    reformatted
  }
}

function ensureDigestTitleHeading(
  markdown: string,
  hours: number,
  entries: RssTaskEntry[],
  createdAt = Date.now()
): { markdown: string; title: string } {
  const title = buildRssDigestTitle({
    markdown,
    windowHours: hours as RssDigestWindowHours,
    createdAt,
    entries
  })
  const trimmed = markdown.trim()
  const lines = trimmed.split('\n')
  const first = lines[0] || ''
  const h1 = first.match(/^#\s+(.+)$/)?.[1]?.trim()
  if (h1 && isUsableRssDigestTitle(h1)) {
    // 统一收成短标题
    const short = buildRssDigestTitle({
      markdown: `# ${h1}`,
      windowHours: hours as RssDigestWindowHours,
      createdAt,
      entries
    })
    lines[0] = `# ${short}`
    return { markdown: lines.join('\n').trim(), title: short }
  }
  if (h1) {
    lines[0] = `# ${title}`
    return { markdown: lines.join('\n').trim(), title }
  }
  // 无 # 标题：插到信息窗口之前
  const infoIdx = lines.findIndex((l) => /^信息窗口：/.test(l))
  if (infoIdx >= 0) {
    lines.splice(infoIdx, 0, `# ${title}`)
    return { markdown: lines.join('\n').trim(), title }
  }
  return { markdown: `# ${title}\n${trimmed}`, title }
}

export async function buildRssDigestReport(payload: {
  entries: RssTaskEntry[]
  windowHours: number
  /** 覆盖默认「近 N 小时」信息窗口文案（自定义起止日时传入）。 */
  infoWindow?: string
  modelRef?: string
  forceHeuristic?: boolean
  /** 强制骨架时的原因（写入正文警示 + error）。 */
  skeletonReason?: string
  template?: RssDigestTemplate
  /** 可选关注问题 / 补充说明（定时简报用）。 */
  focusPrompt?: string
}): Promise<{
  ok: boolean
  markdown: string
  title: string
  mode: 'model' | 'heuristic'
  template: RssDigestTemplate
  /** 实际纳入生成的条数。 */
  includedCount: number
  /** 调用方传入的窗内候选数。 */
  windowCount: number
  error?: string
  /** 幻觉检测修复摘要（若有）。 */
  repairNote?: string
  /** 写稿前补抓成功的正文，调用方应写回任务条目。 */
  bodyPatches?: RssBodyPatch[]
}> {
  const hours = payload.windowHours || 24
  const template = normalizeRssDigestTemplate(payload.template)
  const windowCount = (payload.entries || []).filter((e) => e?.id).length
  const seeded = pickDigestEntries(payload.entries || [], DIGEST_MAX_ENTRIES)
  const createdAt = Date.now()

  const infoWindow = (payload.infoWindow || '').trim() || formatDigestInfoWindow(hours)
  if (!seeded.length) {
    const title = buildRssDigestTitle({
      windowHours: hours as RssDigestWindowHours,
      createdAt,
      markdown: ''
    })
    const emptyMd = `# ${title}\n信息窗口：${infoWindow}\n\n## 本期概览\n\n● 该时段内没有可汇总的条目。请先刷新订阅。\n\n## 资料来源\n\n● （无）`
    return {
      ok: true,
      title,
      markdown: emptyMd,
      mode: 'heuristic',
      template,
      includedCount: 0,
      windowCount,
      bodyPatches: []
    }
  }

  // 简报前尽量抓链接正文，避免模型只拿标题/短摘要编故事
  const { entries, patches: bodyPatches } = await ensureEntryBodiesForDigest(seeded)

  const listing = entries.map((it, i) => entryDigestListingLine(it, i)).join('\n')

  const check = canUseRssIntelligenceModel(payload.modelRef)
  if (payload.forceHeuristic || !check.ok) {
    const title = buildRssDigestTitle({
      windowHours: hours as RssDigestWindowHours,
      createdAt,
      entries
    })
    const reason =
      (payload.skeletonReason || '').trim() ||
      (!check.ok ? check.reason : undefined) ||
      (payload.forceHeuristic ? '未走模型归纳' : undefined)
    const finalized = finalizeDigestMarkdown(
      heuristicDigestMarkdown(
        hours,
        entries,
        template,
        reason,
        title,
        infoWindow,
        windowCount
      ),
      entries,
      infoWindow,
      { hours, template, title }
    )
    const ensured = ensureDigestTitleHeading(finalized.markdown, hours, entries, createdAt)
    return {
      ok: true,
      title: ensured.title,
      markdown: ensured.markdown,
      mode: 'heuristic',
      template,
      includedCount: entries.length,
      windowCount,
      error: reason,
      repairNote: finalized.repairNote,
      bodyPatches
    }
  }

  try {
    const shapeHint = rssDigestTemplateShapeHint(template)
    const focus = (payload.focusPrompt || '').trim()
    const user = [
      `严格按 system 中的形态文件输出；禁止「时段概述 / Top 话题 / 可略过噪音」等旧结构。`,
      `价值门槛：每条必须同时答清「新在哪」+「关你啥事」；粗体含具体对象与利害；答不清就丢掉，宁缺毋滥，禁止注水凑条数。`,
      `主线聚焦：整篇像一篇文章只讲一条主线；禁止主题沙拉；标题禁止用「与」硬拼两条无关新闻。`,
      `行文：像口述，不要生成器腔。禁用句首「值得注意的是/事实上/综上所述」；禁用赋能/闭环/本质上/未来可期；禁匀速排比三连；「不是A而是B」全文最多1次。`,
      `标题：10–22 字，用数字/对立/谁受损受益之一；禁止「动态/盘点/汇总」套话；勿照抄条目标题、勿用 · 拼接。`,
      `资料来源：只列正文引用过的 URL，禁止把未引用条目倾倒文末。`,
      `优先 [分4][分5]；同实体只留最强一条；有关注重点则主线围绕它。`,
      `第一行：# 短标题`,
      `第二行：信息窗口：${infoWindow}`,
      shapeHint,
      `时间跨度：近 ${hours} 小时；形态 id：${template}`,
      focus ? `关注重点：${focus}` : '',
      `反幻觉：链接只能用下列条目 URL；生成后系统会校验，不符形态会被整篇重排。`,
      `依据：下列「正文」来自原文链接抓取（含媒体清单），禁止只据标题发挥；无正文时才可据摘要并标明据报道。`,
      `条目（最多 ${entries.length}；格式参考 ${digestSourceLabel(entries[0])}）：`,
      '',
      listing
    ]
      .filter(Boolean)
      .join('\n')
    const markdown = await oneShotCompletion(
      check.modelRef,
      digestSystemPrompt(template),
      user,
      180_000,
      8192
    )
    if (!markdown.trim()) throw new Error('模型返回空简报')
    const seedTitle = buildRssDigestTitle({
      markdown: markdown.trim(),
      windowHours: hours as RssDigestWindowHours,
      createdAt,
      entries
    })
    const finalized = finalizeDigestMarkdown(markdown.trim(), entries, infoWindow, {
      hours,
      template,
      title: seedTitle
    })
    const ensured = ensureDigestTitleHeading(finalized.markdown, hours, entries, createdAt)
    // 最终再卡一道：阅读区绝不能再出现 Top 话题
    let outMd = ensured.markdown
    let outTitle = ensured.title
    let repairNote = finalized.repairNote
    let outMode: 'model' | 'heuristic' = finalized.reformatted ? 'heuristic' : 'model'
    let outError: string | undefined = finalized.reformatted
      ? '模型未按所选形态，已重排为模板骨架'
      : undefined
    if (!isDigestFormat(outMd, template)) {
      const rebuilt = finalizeDigestMarkdown(
        heuristicDigestMarkdown(
          hours,
          entries,
          template,
          '最终格式门禁',
          outTitle,
          infoWindow,
          windowCount
        ),
        entries,
        infoWindow,
        { hours, template, title: outTitle }
      )
      const again = ensureDigestTitleHeading(rebuilt.markdown, hours, entries, createdAt)
      outMd = again.markdown
      outTitle = again.title
      outMode = 'heuristic'
      outError = '模型未按所选形态，已重排为模板骨架'
      repairNote = [repairNote, rebuilt.repairNote, '已强制所选形态']
        .filter(Boolean)
        .join(' · ')
    }
    return {
      ok: true,
      title: outTitle,
      markdown: outMd.slice(0, 48_000),
      mode: outMode,
      template,
      includedCount: entries.length,
      windowCount,
      repairNote,
      error: outError,
      bodyPatches
    }
  } catch (err) {
    const msg = humanizeRssIntelError(err instanceof Error ? err.message : String(err))
    const fallback = await buildRssDigestReport({
      ...payload,
      template,
      forceHeuristic: true,
      skeletonReason: msg
    })
    return { ...fallback, error: msg, bodyPatches: fallback.bodyPatches || bodyPatches }
  }
}

/** 模型输出 → 简易 HTML（已是标签则原样）。 */
function modelTextToHtml(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/<[a-z][\s\S]*>/i.test(t)) return t
  // 去掉 markdown 代码围栏
  const unfenced = t.replace(/^```(?:html|markdown|md)?\s*/i, '').replace(/\s*```$/i, '')
  const blocks = unfenced
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!blocks.length) return ''
  return blocks
    .map((p) => {
      if (/^#{1,3}\s+/.test(p)) {
        const level = Math.min(3, (p.match(/^#+/) || ['#'])[0].length)
        const text = p.replace(/^#{1,3}\s+/, '').trim()
        return `<h${level}>${text}</h${level}>`
      }
      if (/^[-*●]\s+/m.test(p) && p.split('\n').every((l) => !l.trim() || /^[-*●]\s+/.test(l.trim()))) {
        const items = p
          .split('\n')
          .map((l) => l.trim().replace(/^[-*●]\s+/, ''))
          .filter(Boolean)
        return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
      }
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')
}

/**
 * 用资讯模型整理可读正文：先抓原文链接（含订阅 fallback），再把正文/媒体清单喂给模型。
 * 禁止只凭标题摘要瞎编；抓取失败时才允许「据报道」有限说明。
 */
export async function recoverRssArticleWithModel(payload: {
  url: string
  title?: string
  snippet?: string
  /** 本地已有正文/摘要 HTML，作抓取 fallback 与额外来源 */
  contentHtml?: string
  /** 缺省用 settings.rssScoreModelRef（与评分/简报同一资讯模型） */
  modelRef?: string
  /**
   * true：即使用户已有完整抓取正文，仍走模型整理（「用模型整理 / 重新整理」）。
   * false/缺省：抓到完整正文则直接返回 extract，不调模型。
   */
  forceModel?: boolean
}): Promise<{
  ok: boolean
  html?: string
  title?: string
  error?: string
  mode?: 'model' | 'extract'
}> {
  const url = typeof payload.url === 'string' ? payload.url.trim() : ''
  if (!url) return { ok: false, error: '链接无效' }

  const settings = getSettings()
  const modelRef =
    typeof payload.modelRef === 'string' && payload.modelRef.trim()
      ? payload.modelRef.trim()
      : (settings.rssScoreModelRef || '').trim()
  const check = canUseRssIntelligenceModel(modelRef)
  if (!check.ok) {
    return { ok: false, error: check.reason || '未配置可用模型' }
  }

  const title = (payload.title || '').trim().slice(0, 200)
  const snippet = (payload.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 800)
  const localHtml = typeof payload.contentHtml === 'string' ? payload.contentHtml : ''
  const fallbackHtml =
    localHtml.trim() || (snippet ? `<p>${snippet}</p>` : undefined)

  // 先拿链接里的内容（音视图文在 HTML 里），再交给模型整理
  let fetchedHtml = ''
  let fetchedTitle = title
  let fetchPartial = false
  try {
    const fetched = await fetchRssArticle(url, { fallbackHtml })
    if (fetched.ok && fetched.html) {
      fetchedHtml = fetched.html
      fetchPartial = !!fetched.partial
      if (fetched.title) fetchedTitle = fetched.title
    }
  } catch {
    /* 抓取失败则退回本地 HTML */
  }
  const sourceHtml = fetchedHtml || localHtml
  const plain = articlePlainExcerpt(sourceHtml, 9000)
  const media = formatArticleMediaInventory(sourceHtml, 16)
  const hasSource = plain.length >= 80 || !!media

  // 链接已抽出完整正文：默认直接采用；用户显式「用模型整理」时跳过
  if (
    !payload.forceModel &&
    fetchedHtml &&
    !fetchPartial &&
    rssEntryHasUsableBody({ contentHtml: fetchedHtml })
  ) {
    return {
      ok: true,
      html: sanitizeArticleHtml(fetchedHtml, url),
      title: fetchedTitle || title || undefined,
      mode: 'extract'
    }
  }

  const system = [
    '你是资讯编辑助手。根据「已从原文链接抓取的正文与媒体清单」整理一篇可供阅读的中文正文。',
    '要求：',
    '1. 只依据抓取正文与媒体清单整理；禁止编造未出现的事实、数据、引语。抓取为空时才可据标题/摘要作简要说明，并标明「据报道」。',
    '2. 输出简单 HTML（p/h2/h3/ul/li/strong/img/video/audio/source）；图/音/视频必须使用媒体清单中的原始 URL，禁止杜撰地址。',
    '3. 尽量保留原文关键配图与音视频；长度随原文，不要无故压成短摘要。',
    '4. 不要网页导航/广告/代码围栏。',
    '5. 文末单独一行：原文：后跟给定 URL。'
  ].join('\n')
  const user = [
    `标题：${fetchedTitle || title || '（无标题）'}`,
    `链接：${url}`,
    `订阅摘要：${snippet || '（无）'}`,
    hasSource
      ? `【已抓取正文】\n${plain || '（正文很少，请结合媒体清单）'}`
      : '【已抓取正文】（未能抓取有效正文；仅可据标题/摘要作有限说明并标明据报道）',
    media ? `【媒体清单】\n${media}` : '【媒体清单】（无）'
  ].join('\n\n')

  try {
    const raw = await oneShotCompletion(check.modelRef, system, user, 90_000, 4096)
    if (!raw.trim()) return { ok: false, error: '模型未返回正文' }
    const html = sanitizeArticleHtml(modelTextToHtml(raw), url)
    if (!html || isThinArticleHtml(html)) {
      // 模型失败但抓到半截：至少把抓取结果交出去
      if (sourceHtml && !isThinArticleHtml(sourceHtml)) {
        return {
          ok: true,
          html: sanitizeArticleHtml(sourceHtml, url),
          title: fetchedTitle || title || undefined,
          mode: 'extract'
        }
      }
      return { ok: false, error: '模型正文过短或不可用' }
    }
    return { ok: true, html, title: fetchedTitle || title || undefined, mode: 'model' }
  } catch (err) {
    if (sourceHtml && !isThinArticleHtml(sourceHtml)) {
      return {
        ok: true,
        html: sanitizeArticleHtml(sourceHtml, url),
        title: fetchedTitle || title || undefined,
        mode: 'extract'
      }
    }
    return {
      ok: false,
      error: humanizeRssIntelError(err instanceof Error ? err.message : String(err))
    }
  }
}
