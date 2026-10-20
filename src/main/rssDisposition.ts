/**
 * RSS 消息处置流水线：拉取 → 评分 → 截取 → 写稿。
 * 手动「现在生成」与定时简报共用，禁止两套门禁逻辑。
 */
import { getSettings } from './store'
import { refreshRssTaskFeeds } from './rssTask'
import {
  buildRssDigestReport,
  DIGEST_MAX_ENTRIES,
  pickDigestEntries,
  scoreRssEntries
} from './rssIntelligence'
import {
  applyRssBodyPatches,
  applyRssEntryScores,
  dispositionLabel,
  entriesInTimeBounds,
  entriesNeedingScoreInBounds,
  filterEntriesByDigestScoreMin,
  mergeRssTaskItems,
  normalizeRssDigestScoreMin,
  joinRssFeedErrors,
  normalizeRssDigestTemplate,
  reconcileRssEntrySources,
  type DigestTimeBounds,
  type RssBodyPatch,
  type RssDigestRecord,
  type RssDigestTemplate,
  type RssDispositionStage,
  type RssTaskEntry,
  type RssTaskFeed,
  type RssTaskState
} from '../shared/rssTask'

export type RssDispositionStageHandler = (
  stage: RssDispositionStage,
  detail?: string
) => void

export interface RssDispositionPipelineInput {
  feeds: RssTaskFeed[]
  items: RssTaskEntry[]
  bounds: DigestTimeBounds
  /** 手动勾选；有则只处置这些 id。 */
  entryIds?: string[]
  scoreMin?: number
  modelRef?: string
  template?: RssDigestTemplate
  focusPrompt?: string
  /** 生成前先拉源（定时默认开；重生成可关）。 */
  refresh?: boolean
  /** 窗内未评分先补评（默认开）。 */
  scoreUnscored?: boolean
  /** 评分关闭时仍允许写稿，但不跑模型评分。 */
  scoreEnabled?: boolean
  onStage?: RssDispositionStageHandler
}

export interface RssDispositionPipelineResult {
  ok: boolean
  stage: RssDispositionStage
  detail?: string
  error?: string
  feeds: RssTaskFeed[]
  items: RssTaskEntry[]
  refreshErrors?: string[]
  /** 成功或骨架时有记录；空窗失败无。 */
  record?: Omit<RssDigestRecord, 'id' | 'createdAt' | 'readAt'> & {
    markdown: string
    title: string
  }
  includedCount: number
  windowCount: number
  unscoredBefore: number
  bodyPatches: RssBodyPatch[]
}

function emit(
  onStage: RssDispositionStageHandler | undefined,
  stage: RssDispositionStage,
  detail?: string
): void {
  const text = detail || dispositionLabel(stage)
  onStage?.(stage, text)
}

/**
 * 单窗处置：可选 refresh → 窗内补评 → 按分截取 → 写简报。
 * 窗内 0 条：ok=false，不写空骨架当成果。
 */
export async function runRssDispositionPipeline(
  input: RssDispositionPipelineInput
): Promise<RssDispositionPipelineResult> {
  const onStage = input.onStage
  let feeds = input.feeds || []
  let items = input.items || []
  const bodyPatches: RssBodyPatch[] = []
  const refreshErrors: string[] = []
  const template = normalizeRssDigestTemplate(input.template)
  const scoreMin = normalizeRssDigestScoreMin(input.scoreMin)
  const modelRef =
    (input.modelRef || '').trim() ||
    (getSettings().rssScoreModelRef || '').trim() ||
    undefined
  const scoreEnabled = input.scoreEnabled !== false
  const doRefresh = input.refresh === true
  const doScore = input.scoreUnscored !== false && scoreEnabled

  if (doRefresh) {
    emit(onStage, 'fetching', '正在拉取订阅…')
    if (!feeds.length) {
      return {
        ok: false,
        stage: 'idle',
        error: '没有订阅源，请先添加',
        feeds,
        items,
        includedCount: 0,
        windowCount: 0,
        unscoredBefore: 0,
        bodyPatches
      }
    }
    try {
      const res = await refreshRssTaskFeeds(feeds)
      feeds = res.feeds.length ? res.feeds : feeds
      items = mergeRssTaskItems(items, res.items)
      if (res.errors.length) refreshErrors.push(...res.errors)
    } catch (err) {
      return {
        ok: false,
        stage: 'idle',
        error: err instanceof Error ? err.message : '拉取订阅失败',
        feeds,
        items,
        includedCount: 0,
        windowCount: 0,
        unscoredBefore: 0,
        bodyPatches
      }
    }
  }

  // 与阅读区同源：源名纠偏
  const reconciled = reconcileRssEntrySources({
    feeds,
    items,
    filter: 'all',
    readerMode: 'extract',
    updatedAt: Date.now()
  } as RssTaskState)
  feeds = reconciled.feeds
  items = reconciled.items

  const pickIds = input.entryIds?.length ? new Set(input.entryIds) : null
  const inBounds = (): RssTaskEntry[] =>
    entriesInTimeBounds(
      { items, digestWindowHours: input.bounds.windowHours } as RssTaskState,
      input.bounds
    ).filter((e) => !pickIds || pickIds.has(e.id))

  let windowEntries = inBounds()
  if (!windowEntries.length) {
    const err = pickIds ? '勾选的消息不在当前时间窗内' : '收录窗内没有消息'
    emit(onStage, 'idle', err)
    return {
      ok: false,
      stage: 'idle',
      error: err,
      feeds,
      items,
      refreshErrors: refreshErrors.length ? refreshErrors : undefined,
      includedCount: 0,
      windowCount: 0,
      unscoredBefore: 0,
      bodyPatches
    }
  }

  const stateForScore: RssTaskState = {
    feeds,
    items,
    filter: 'all',
    readerMode: 'extract',
    updatedAt: Date.now()
  }
  // 先评窗内未打分，再按 scoreMin 截——否则未评分条目会被下限误杀
  const needScore = doScore
    ? entriesNeedingScoreInBounds(stateForScore, input.bounds, 80).filter(
        (e) => !pickIds || pickIds.has(e.id)
      )
    : []
  const unscoredBefore = needScore.length

  if (needScore.length) {
    emit(onStage, 'scoring', `正在评 ${needScore.length} 条未打分…`)
    const scored = await scoreRssEntries({ entries: needScore, modelRef })
    if (scored.bodyPatches?.length) {
      bodyPatches.push(...scored.bodyPatches)
      const patched = applyRssBodyPatches(stateForScore, scored.bodyPatches)
      items = patched.items
    }
    const withScores = applyRssEntryScores({ ...stateForScore, items }, scored.scores)
    items = withScores.items
    feeds = withScores.feeds
    windowEntries = inBounds()
  }

  windowEntries = filterEntriesByDigestScoreMin(windowEntries, scoreMin)
  if (!windowEntries.length) {
    const err =
      scoreMin > 0
        ? `收录窗内没有评分 ≥${scoreMin} 的消息`
        : '收录窗内没有消息'
    emit(onStage, 'idle', err)
    return {
      ok: false,
      stage: 'idle',
      error: err,
      feeds,
      items,
      refreshErrors: refreshErrors.length ? refreshErrors : undefined,
      includedCount: 0,
      windowCount: 0,
      unscoredBefore,
      bodyPatches
    }
  }

  const picked = pickDigestEntries(windowEntries, DIGEST_MAX_ENTRIES)
  const windowCount = windowEntries.length
  const includedPreview = picked.length
  emit(
    onStage,
    'picking',
    windowCount > includedPreview
      ? `按评分截取 ${includedPreview}/${windowCount} 条`
      : `纳入 ${includedPreview} 条素材`
  )

  emit(onStage, 'digesting', `正在写简报（${includedPreview} 条）…`)
  const res = await buildRssDigestReport({
    entries: windowEntries,
    windowHours: input.bounds.windowHours,
    infoWindow: input.bounds.infoWindow,
    modelRef,
    template,
    focusPrompt: input.focusPrompt
  })
  if (res.bodyPatches?.length) {
    bodyPatches.push(...res.bodyPatches)
    items = applyRssBodyPatches(
      { feeds, items, filter: 'all', readerMode: 'extract', updatedAt: Date.now() },
      res.bodyPatches
    ).items
  }

  const includedCount =
    typeof res.includedCount === 'number' ? res.includedCount : includedPreview
  const stage: RssDispositionStage = res.mode === 'model' ? 'done' : 'skeleton'
  const detail =
    stage === 'done'
      ? `模型归纳完成 · 纳入 ${includedCount}${windowCount > includedCount ? `/${windowCount}` : ''} 条`
      : `模板骨架 · 纳入 ${includedCount}${windowCount > includedCount ? `/${windowCount}` : ''} 条${
          res.error ? ` · ${res.error}` : ''
        }`
  emit(onStage, stage, detail)

  return {
    ok: true,
    stage,
    detail,
    error: res.error,
    feeds,
    items,
    refreshErrors: refreshErrors.length ? refreshErrors : undefined,
    record: {
      title: res.title,
      windowHours: input.bounds.windowHours,
      rangeFrom: input.bounds.rangeFrom,
      rangeTo: input.bounds.rangeTo,
      template: normalizeRssDigestTemplate(res.template || template),
      markdown: res.markdown,
      mode: res.mode,
      entryCount: includedCount,
      windowCount,
      error: res.error
    },
    includedCount,
    windowCount,
    unscoredBefore,
    bodyPatches
  }
}

/** 供 UI 拼状态条：拉取失败仍可能继续（有缓存条目时）。 */
export function formatDispositionRefreshNote(errors: string[] | undefined): string | undefined {
  if (!errors?.length) return undefined
  return joinRssFeedErrors(errors)
}
