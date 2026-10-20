import type { Conversation } from './types'

/** 当前任务是否已有实质内容（用于「非空才显示新对话」等）。 */
export function conversationHasContent(c: Conversation | undefined | null): boolean {
  if (!c) return false
  if (c.messages.length > 0) return true
  if (Object.values(c.lanes ?? {}).some((l) => l.messages.length > 0)) return true
  if (c.kind === 'rss' && ((c.rss?.items?.length || 0) > 0 || Object.keys(c.rssThreads || {}).length > 0)) {
    return true
  }
  return false
}
