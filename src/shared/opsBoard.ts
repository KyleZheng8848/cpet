/** 桌面「未收口作战板」：聚合等待 / 出错 / 在跑 / 定时失败。 */

export type OpsBoardKind = 'error' | 'waiting' | 'done' | 'running' | 'schedule'

export interface OpsBoardItem {
  id: string
  kind: OpsBoardKind
  title: string
  detail: string
  conversationId?: string
  /** IDE 联动：点角标要唤起的本机应用。 */
  ideApp?: string
  /** 打开对话窗时的面板；缺省 chat。 */
  panel?: 'chat' | 'schedules' | 'monitor'
  updatedAt: number
}

export interface OpsBoardSnapshot {
  items: OpsBoardItem[]
  updatedAt: number
}

const KIND_RANK: Record<OpsBoardKind, number> = {
  error: 50,
  waiting: 40,
  done: 35,
  schedule: 20,
  running: 10
}

/** 角标/待办：需要人看一眼的节点（不含「在跑」噪音）。 */
export function opsBoardNeedsAttention(kind: OpsBoardKind): boolean {
  return kind === 'error' || kind === 'waiting' || kind === 'done' || kind === 'schedule'
}

/** 点开查看后应从角标列表移除（含完成/出错/等你/定时；「在跑」本就不进角标）。 */
export function opsBoardAckOnOpen(kind: OpsBoardKind): boolean {
  return opsBoardNeedsAttention(kind)
}

/** 合并去重后按严重度排序，最多保留 limit 条。 */
export function mergeOpsBoard(items: OpsBoardItem[], limit = 12): OpsBoardSnapshot {
  const byId = new Map<string, OpsBoardItem>()
  for (const it of items) {
    if (!it?.id) continue
    const prev = byId.get(it.id)
    if (!prev || it.updatedAt >= prev.updatedAt) byId.set(it.id, it)
  }
  const sorted = [...byId.values()].sort((a, b) => {
    const rk = KIND_RANK[b.kind] - KIND_RANK[a.kind]
    if (rk !== 0) return rk
    return b.updatedAt - a.updatedAt
  })
  return { items: sorted.slice(0, limit), updatedAt: Date.now() }
}

export function opsBoardKindLabel(kind: OpsBoardKind): string {
  switch (kind) {
    case 'error':
      return '出错'
    case 'waiting':
      return '等你'
    case 'done':
      return '完成'
    case 'running':
      return '在跑'
    case 'schedule':
      return '定时'
  }
}
