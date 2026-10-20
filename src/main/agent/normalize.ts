/**
 * 流式文本归一化（纯函数）。
 * 只处理「累计快照 / 真增量」两种形态，不做任何语义猜测。
 */

/** 超过此长度且非前缀 → 不当作 token 拼接（防整包重贴循环）。 */
export const SMALL_DELTA_MAX = 64

export type TextMode = 'delta' | 'snapshot' | 'replace'

export function sliceCumulativeDelta(
  prev: string,
  incoming: string
): { delta: string; accumulated: string } | null {
  if (!incoming) return null
  if (incoming === prev) return null
  if (prev && incoming.startsWith(prev)) {
    const delta = incoming.slice(prev.length)
    if (!delta) return null
    return { delta, accumulated: incoming }
  }
  // 累计快照缩水：incoming 已是 prev 的实质前缀才丢弃。
  // 短片（如中文「你」）碰巧等于文首时必须当真增量拼接，否则会吞字。
  if (prev && prev.startsWith(incoming)) {
    const substantial =
      incoming.length >= 8 || (incoming.length >= 4 && incoming.length * 2 >= prev.length)
    if (substantial) return null
  }

  if (prev.length >= 4) {
    const idx = incoming.indexOf(prev)
    if (idx >= 0) {
      const delta = incoming.slice(idx + prev.length)
      if (!delta) return null
      return { delta, accumulated: prev + delta }
    }
  }

  if (prev.length >= 4 && incoming.length > SMALL_DELTA_MAX) return null
  return { delta: incoming, accumulated: prev + incoming }
}

/** snapshot：只补后缀；replace：仅在尚无正文时接受整包。 */
export function resolveTextPiece(
  prev: string,
  incoming: string,
  mode: TextMode
): { delta: string; accumulated: string } | null {
  if (!incoming) return null
  if (incoming === prev) return null

  if (mode === 'replace') {
    if (!prev) return { delta: incoming, accumulated: incoming }
    if (incoming.startsWith(prev) || incoming.includes(prev)) {
      return resolveTextPiece(prev, incoming, 'snapshot')
    }
    return null
  }

  if (mode === 'snapshot') {
    if (!prev) return { delta: incoming, accumulated: incoming }
    if (incoming.startsWith(prev)) {
      const delta = incoming.slice(prev.length)
      return delta ? { delta, accumulated: incoming } : null
    }
    const idx = incoming.indexOf(prev)
    if (idx >= 0) {
      const delta = incoming.slice(idx + prev.length)
      return delta ? { delta, accumulated: prev + delta } : null
    }
    return null
  }

  return sliceCumulativeDelta(prev, incoming)
}
