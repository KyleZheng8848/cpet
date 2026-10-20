import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import type { ChatMessage, Conversation, ModelProvider } from '@shared/types'
import { formatRunUsage, formatRunUsageTitle } from '@shared/runUsage'
import { flattenEnabledRefs, getCompareLanes, modelRefLabel } from '@shared/models'
import { Block } from './Blocks'
import { ModelPicker } from './ModelPicker'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownHtml } from './MarkdownHtml'
import {
  AgentDetailToggles,
  type AgentDetailVisibility
} from './DetailToggles'
import { blocksForDisplay } from './processBlocks'
import { UserAvatarFace } from './UserAvatarFace'
import { TypingDots } from '../TypingDots'
import type { FilePreviewTarget } from '@shared/filePreview'
import { canonicalLocalPath, extractLocalImagePaths } from '@shared/filePreview'

export type CompareColumns = 1 | 2 | 3 | 4 | 5 | 6

export interface CompareViewProps {
  conversation: Conversation
  providers: ModelProvider[]
  streamingKeys: ReadonlySet<string>
  columns: CompareColumns
  onColumnsChange: (n: CompareColumns) => void
  detailVisibility: AgentDetailVisibility
  onDetailVisibilityChange: (patch: Partial<AgentDetailVisibility>) => void
  /** 勾选的回复：`${laneId}::${messageId}` */
  selectedReplies: ReadonlySet<string>
  onToggleReply: (laneId: string, messageId: string) => void
  onCopyLane: (laneId: string) => void
  onRerunLane: (laneId: string) => void
  onCloseLane: (laneId: string) => void
  onChangeLaneModel: (laneId: string, modelRef: string) => void
  onAddLane: () => void
  userAvatar: string
  /** 展开列模型选单时同步本机引擎目录。 */
  onSyncModels?: () => void
  onOpenFilePreview?: (target: FilePreviewTarget) => void
}

function replyKey(laneId: string, messageId: string): string {
  return `${laneId}::${messageId}`
}

function streamKey(conversationId: string, laneId: string): string {
  return `${conversationId}::${laneId}`
}

function plainText(m: ChatMessage): string {
  return m.blocks
    .map((b) => {
      if (b.kind === 'text' || b.kind === 'reasoning' || b.kind === 'status') return b.text
      return ''
    })
    .join('\n')
    .trim()
}

function UserMd({ text }: { text: string }): JSX.Element {
  useUiLocale()
  return <MarkdownHtml text={text || uiText("（附件）")} className="compare-user-text md" />
}

function userAttachmentBlocks(m: ChatMessage): Extract<ChatMessage['blocks'][number], { kind: 'attachment' }>[] {
  return m.blocks.filter(
    (b): b is Extract<ChatMessage['blocks'][number], { kind: 'attachment' }> =>
      b.kind === 'attachment'
  )
}

/** 识别汇总请求（含历史未打标消息），抽出一行摘要。 */
function summarizeComparePrompt(
  msg: ChatMessage,
  text: string
): { candidateCount: number; note?: string } | null {
  if (msg.source === 'compare-summary') {
    return {
      candidateCount: msg.summaryMeta?.candidateCount ?? 0,
      note: msg.summaryMeta?.note
    }
  }
  if (!text.includes('## 候选回答') || !text.includes('## 任务')) return null
  const count = (text.match(/^### /gm) || []).length
  const taskBody = text.split(/## 任务\s*\n/)[1]?.trim() || ''
  const firstLine = taskBody.split('\n').find((l) => l.trim() && !l.startsWith('请'))?.trim()
  const defaultTask = /请根据以上候选回答做汇总/.test(taskBody)
  return {
    candidateCount: count,
    note: defaultTask ? undefined : firstLine?.slice(0, 120)
  }
}

export function CompareView({
  conversation,
  providers,
  streamingKeys,
  columns,
  onColumnsChange,
  detailVisibility,
  onDetailVisibilityChange,
  selectedReplies,
  onToggleReply,
  onCopyLane,
  onRerunLane,
  onCloseLane,
  onChangeLaneModel,
  onAddLane,
  userAvatar,
  onSyncModels,
  onOpenFilePreview
}: CompareViewProps): JSX.Element {
  useUiLocale()
  const lanes = getCompareLanes(conversation)
  const users = conversation.messages.filter((m) => m.role === 'user')
  const hasEnabled = flattenEnabledRefs(providers).length > 0
  const anyBusy = lanes.some((l) => streamingKeys.has(streamKey(conversation.id, l.id)))
  const lanesRef = useRef<HTMLDivElement>(null)
  const laneBodiesRef = useRef(new Map<string, HTMLDivElement>())
  const stickToLatestRef = useRef(true)
  const [showJumpLatest, setShowJumpLatest] = useState(false)
  /** 展开的汇总请求 id（各列同步）。默认折叠，避免长候选刷屏。 */
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(() => new Set())

  function toggleSummary(id: string): void {
    setExpandedSummaryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setLaneBodyRef = useCallback((laneId: string, el: HTMLDivElement | null) => {
    if (el) laneBodiesRef.current.set(laneId, el)
    else laneBodiesRef.current.delete(laneId)
  }, [])

  const checkScrollPosition = useCallback(() => {
    const bodies = [...laneBodiesRef.current.values()]
    if (!bodies.length || users.length === 0) {
      stickToLatestRef.current = true
      setShowJumpLatest(false)
      return
    }
    const allNearBottom = bodies.every(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80
    )
    stickToLatestRef.current = allNearBottom
    setShowJumpLatest(!allNearBottom)
  }, [users.length])

  const scrollAllToLatest = useCallback(() => {
    for (const el of laneBodiesRef.current.values()) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
    const lanesEl = lanesRef.current
    if (lanesEl && lanesEl.scrollWidth > lanesEl.clientWidth) {
      lanesEl.scrollTo({ left: lanesEl.scrollWidth, behavior: 'smooth' })
    }
    stickToLatestRef.current = true
    setShowJumpLatest(false)
  }, [])

  useEffect(() => {
    if (!stickToLatestRef.current) return
    requestAnimationFrame(() => {
      for (const el of laneBodiesRef.current.values()) {
        el.scrollTop = el.scrollHeight
      }
      checkScrollPosition()
    })
  }, [conversation.updatedAt, conversation.messages.length, streamingKeys.size, checkScrollPosition])

  useEffect(() => {
    stickToLatestRef.current = true
    setShowJumpLatest(false)
    setExpandedSummaryIds(new Set())
    requestAnimationFrame(() => {
      for (const el of laneBodiesRef.current.values()) {
        el.scrollTop = el.scrollHeight
      }
    })
  }, [conversation.id])

  return (
    <div className="compare-view">
      <div className="compare-toolbar">
        <div className="compare-cols" role="group" aria-label={uiText("列布局")}>
          <span className="compare-cols-label">{uiText("列数")}</span>
          <div className="compare-cols-step">
            {([1, 2, 3, 4, 5, 6] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`compare-col-btn ${columns === n ? 'on' : ''}`}
                title={uiText("仅改布局列数，不影响生成")}
                onClick={() => onColumnsChange(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="settings-btn ghost tiny"
          disabled={!hasEnabled}
          title={
            hasEnabled
              ? anyBusy
                ? uiText("生成中也可加列（新列本轮标记为未参与）")
                : uiText("增加一列模型")
              : uiText("没有已启用模型")
          }
          onClick={onAddLane}
        >
          {uiText("＋ 加列")}</button>
        <AgentDetailToggles
          visibility={detailVisibility}
          onChange={onDetailVisibilityChange}
        />
      </div>

      <p className="compare-hint">{uiText("勾选回答后，Enter / 发送即可汇总（有输入用你的话，无输入用默认）")}</p>

      <div className="compare-scroll-stage">
        <div
          className="compare-lanes"
          ref={lanesRef}
          style={{ ['--compare-cols' as string]: String(columns) }}
          onScroll={checkScrollPosition}
        >
          {lanes.map((laneRef) => {
            const laneId = laneRef.id
            const modelRef = laneRef.modelId
            const lane = conversation.lanes?.[laneId]
            const assistants = lane?.messages ?? []
            const busy = streamingKeys.has(streamKey(conversation.id, laneId))
            return (
              <div key={laneId} className={`compare-lane ${busy ? 'busy' : ''}`}>
                <div className="compare-lane-head">
                  <div className="compare-lane-title">
                    <ModelPicker
                      providers={providers}
                      value={modelRef}
                      disabled={busy}
                      className="compare-model-select"
                      title={modelRefLabel(providers, modelRef)}
                      onOpen={onSyncModels}
                      onChange={(ref) => {
                        if (ref && ref !== modelRef) onChangeLaneModel(laneId, ref)
                      }}
                    />
                    {busy && <span className="conv-busy" title={uiText("运行中")} />}
                  </div>
                  <div className="compare-lane-actions">
                    <button type="button" className="msg-act" title={uiText("复制本列")} onClick={() => onCopyLane(laneId)}>
                      {uiText("复制")}</button>
                    <button
                      type="button"
                      className="msg-act"
                      title={uiText("重跑本列最近一轮")}
                      disabled={busy || !users.length}
                      onClick={() => onRerunLane(laneId)}
                    >
                      {uiText("重跑")}</button>
                    <button
                      type="button"
                      className="msg-act"
                      title={uiText("关闭本列")}
                      disabled={lanes.length <= 1 || busy}
                      onClick={() => onCloseLane(laneId)}
                    >
                      {uiText("关闭")}</button>
                  </div>
                </div>
                <div
                  className="compare-lane-body"
                  ref={(el) => setLaneBodyRef(laneId, el)}
                  onScroll={checkScrollPosition}
                >
                  {users.length === 0 && (
                    <div className="compare-empty">{uiText("发送问题后，各模型将并行作答")}</div>
                  )}
                  {users.map((u, i) => {
                    const a = assistants[i]
                    const displayBlocks = a
                      ? blocksForDisplay(a.blocks, detailVisibility.showDetails, 'assistant')
                      : []
                    const markdownImagePaths = (() => {
                      const keys = new Set<string>()
                      for (const b of displayBlocks) {
                        if (b.kind !== 'text' || !b.text) continue
                        for (const p of extractLocalImagePaths(b.text)) {
                          const key = canonicalLocalPath(p)
                          if (key) keys.add(key)
                        }
                      }
                      return keys
                    })()
                    const selectable = !!(
                      a &&
                      displayBlocks.some((b) => b.kind === 'text') &&
                      !busy
                    )
                    const selected = a ? selectedReplies.has(replyKey(laneId, a.id)) : false
                    const visibleBlocks = displayBlocks
                    const userText = plainText(u)
                    const userAtts = userAttachmentBlocks(u)
                    const summaryInfo = summarizeComparePrompt(u, userText)
                    const summaryOpen = summaryInfo ? expandedSummaryIds.has(u.id) : false
                    const userAttNodes =
                      userAtts.length > 0 ? (
                        <div className="compare-user-atts">
                          {userAtts.map((b, ai) => (
                            <Block
                              key={`${b.path}-${ai}`}
                              block={b}
                              visibility={detailVisibility}
                              onOpenFilePreview={onOpenFilePreview}
                            />
                          ))}
                        </div>
                      ) : null
                    return (
                      <div
                        key={u.id}
                        className={`compare-round${summaryInfo ? ' is-summary' : ''}`}
                      >
                        <div className={`compare-user${summaryInfo ? ' compare-user-summary' : ''}`}>
                          <UserAvatarFace
                            avatar={userAvatar}
                            as="span"
                            className="compare-mini-avatar"
                          />
                          {summaryInfo ? (
                            <div className="compare-user-body">
                              <div className="compare-summary-fold">
                                <button
                                  type="button"
                                  className="compare-summary-toggle"
                                  aria-expanded={summaryOpen}
                                  title={summaryOpen ? uiText("折叠汇总原文") : uiText("展开汇总原文")}
                                  onClick={() => toggleSummary(u.id)}
                                >
                                  <span className="compare-summary-caret" aria-hidden>
                                    {summaryOpen ? '▾' : '▸'}
                                  </span>
                                  <span className="compare-summary-label">
                                    {uiText("汇总")}{summaryInfo.candidateCount > 0
                                      ? uiText(" · {0} 条候选", [summaryInfo.candidateCount])
                                      : ''}
                                  </span>
                                  {!summaryOpen && summaryInfo.note ? (
                                    <span className="compare-summary-note" title={summaryInfo.note}>
                                      {summaryInfo.note}
                                    </span>
                                  ) : !summaryOpen ? (
                                    <span className="compare-summary-note muted">{uiText("默认取舍")}</span>
                                  ) : null}
                                </button>
                                {summaryOpen && <UserMd text={userText} />}
                              </div>
                              {userAttNodes}
                            </div>
                          ) : (
                            <div className="compare-user-body">
                              {(userText || !userAtts.length) && <UserMd text={userText} />}
                              {userAttNodes}
                            </div>
                          )}
                        </div>
                        {a ? (
                          <div
                            className={`compare-assistant ${selectable ? 'pickable' : ''} ${selected ? 'picked' : ''}`}
                            onClick={
                              selectable
                                ? (e) => {
                                    const t = e.target as HTMLElement | null
                                    // 点图 / 链接 / 按钮 / 附件：交给预览，不要抢成「勾选汇总」
                                    if (
                                      t?.closest?.(
                                        'img, a, button, .md-img-missing, .attach-block, .command-image, .tool-preview-btn, input, label'
                                      )
                                    ) {
                                      return
                                    }
                                    onToggleReply(laneId, a.id)
                                  }
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              className="compare-pick"
                              checked={selected}
                              disabled={!selectable}
                              tabIndex={selectable ? 0 : -1}
                              aria-label={uiText("选中此回答，发送时一并汇总")}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => {
                                if (selectable) onToggleReply(laneId, a.id)
                              }}
                            />
                            <div className="compare-assistant-blocks">
                              {visibleBlocks.length > 0 ? (
                                visibleBlocks.map((b, bi) => (
                                  <Block
                                    key={bi}
                                    block={b}
                                    visibility={detailVisibility}
                                    streaming={busy && i === users.length - 1}
                                    onOpenFilePreview={onOpenFilePreview}
                                    markdownImagePaths={markdownImagePaths}
                                  />
                                ))
                              ) : !busy || i !== users.length - 1 ? (
                                <span className="muted">
                                  {formatRunUsage(a.runUsage)
                                    ? uiText("本轮有用量但未收到正文（可点「重跑」）")
                                    : uiText("本列未返回正文（可点「重跑」；若持续失败请检查该模型/引擎登录）")}
                                </span>
                              ) : null}
                              {busy && i === users.length - 1 ? (
                                <TypingDots trailing={visibleBlocks.length > 0} />
                              ) : null}
                              {!busy && formatRunUsage(a.runUsage) ? (
                                <div className="msg-run-usage" title={formatRunUsageTitle(a.runUsage)}>
                                  {formatRunUsage(a.runUsage)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : busy && i === users.length - 1 ? (
                          <div className="compare-assistant">
                            <TypingDots />
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        {showJumpLatest && (
          <button
            type="button"
            className="jump-bottom"
            onClick={() => scrollAllToLatest()}
            title={uiText("各列滚到最新回复")}
            aria-label={uiText("滚到最新回复")}
          >
            <span aria-hidden>↓</span>
            {uiText("最新")}</button>
        )}
      </div>
    </div>
  )
}
