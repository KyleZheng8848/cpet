import type { Conversation } from './types'

/** RSS 讨论的 thread：条目 id + 清空后换新的 epoch。 */
export function rssDiscussionThreadId(
  conv: Pick<Conversation, 'rss' | 'rssDiscussionEpochs'>
): string {
  const entry = conv.rss?.selectedId?.trim() || 'rss'
  const epoch = conv.rssDiscussionEpochs?.[entry]?.trim()
  return epoch || entry
}

/**
 * 发送路径漏传 threadId 时，从对话记录补，绝不落到共享的 `main`。
 * 否则清空 / 新开一轮之后，漏传的请求仍会挤进同一个 daemon session。
 */
export function resolveConversationThreadId(
  payload: { threadId?: string; conversationId?: string },
  conv?: Pick<Conversation, 'id' | 'kind' | 'activeThreadId' | 'rss' | 'rssDiscussionEpochs'> | null
): string {
  const sent = payload.threadId?.trim()
  if (sent) return sent
  if (conv?.kind === 'rss') return rssDiscussionThreadId(conv)
  const active = conv?.activeThreadId?.trim()
  if (active) return active
  return (conv?.id || payload.conversationId || '').trim() || 'main'
}
