/**
 * 流式输出时按「阅读速度」追滚动条底部。
 * 内容慢：跟得上就贴底；内容突增：不瞬移，按上限 px/s 慢慢滚下去。
 *
 * 调度用 setTimeout，不用 rAF：宠边/失焦窗 rAF 会被节流到几乎不动。
 *
 * 规则：
 * - 仅在「跟随中」且被 kick 时慢速追底
 * - 用户往上拖 → 停止跟随与动画
 * - finish()：回答结束 → 停动画；若仍跟随则贴一次底，之后不再 chase
 */

export type ScrollFollow = {
  /** 内容变了：若仍在跟随则启动/续跑追底动画 */
  kick: () => void
  /** 立刻贴底并恢复跟随（切会话 / 点「回到底部」/ 刚发出消息） */
  snapToBottom: () => void
  /** 回答结束：停止慢速追底；若仍跟随则贴一次底 */
  finish: () => void
  /** 绑定到 scroll 事件：用户往上拖就暂停跟随 */
  onScroll: () => void
  /** 是否仍自动跟随 */
  isFollowing: () => boolean
  /** 强制恢复跟随（不立刻改 scrollTop，等下一次 kick） */
  resume: () => void
  /** 停止跟随与动画（等同用户上滑） */
  pause: () => void
  destroy: () => void
}

export type ScrollFollowOptions = {
  /** 阅读追底速度（px/s）。中文对话区约 5 行/秒。 */
  pxPerSec?: number
  /** 距底小于此值视为「还在底部」，可恢复跟随 */
  nearBottomPx?: number
}

const DEFAULT_PX_PER_SEC = 110
const DEFAULT_NEAR = 72
/** ~60fps；后台窗也能跑，只是略费一点定时器 */
const TICK_MS = 16

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function createScrollFollow(
  getEl: () => HTMLElement | null,
  opts: ScrollFollowOptions = {}
): ScrollFollow {
  const pxPerSec = opts.pxPerSec ?? DEFAULT_PX_PER_SEC
  const nearBottomPx = opts.nearBottomPx ?? DEFAULT_NEAR

  let following = true
  /** finish 后禁止再 kick，直到 resume/snapToBottom */
  let chaseAllowed = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastTs = 0
  let programmatic = false
  /** 程序滚动后短暂忽略 scroll 事件（Chromium 常异步派发） */
  let ignoreScrollUntil = 0
  let alive = true
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  function gap(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }

  function stopTimer(): void {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    lastTs = 0
  }

  function clearSettle(): void {
    if (settleTimer != null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  function setScrollTop(el: HTMLElement, top: number): void {
    programmatic = true
    ignoreScrollUntil = performance.now() + 120
    el.scrollTop = top
    queueMicrotask(() => {
      programmatic = false
    })
  }

  function tick(): void {
    timer = null
    if (!alive || !following || !chaseAllowed) {
      lastTs = 0
      return
    }
    const el = getEl()
    if (!el) {
      lastTs = 0
      return
    }
    const dist = gap(el)
    if (dist <= 1.5) {
      setScrollTop(el, el.scrollHeight)
      lastTs = 0
      return
    }
    if (prefersReducedMotion()) {
      setScrollTop(el, el.scrollHeight)
      lastTs = 0
      return
    }
    const ts = performance.now()
    if (!lastTs) lastTs = ts
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000))
    lastTs = ts
    const step = Math.max(0.5, pxPerSec * dt)
    setScrollTop(el, Math.min(el.scrollTop + step, el.scrollHeight - el.clientHeight))
    if (gap(el) > 1.5) {
      timer = setTimeout(tick, TICK_MS)
    } else {
      lastTs = 0
    }
  }

  function ensureTicking(): void {
    if (timer != null) return
    lastTs = 0
    timer = setTimeout(tick, TICK_MS)
  }

  function kick(): void {
    if (!alive || !following || !chaseAllowed) return
    const el = getEl()
    if (!el) return
    if (gap(el) <= 1.5) {
      setScrollTop(el, el.scrollHeight)
    } else if (prefersReducedMotion()) {
      setScrollTop(el, el.scrollHeight)
    } else {
      ensureTicking()
    }
    clearSettle()
    settleTimer = setTimeout(() => {
      settleTimer = null
      if (!alive || !following || !chaseAllowed) return
      const node = getEl()
      if (!node) return
      if (gap(node) > 1.5) ensureTicking()
    }, 32)
  }

  function snapToBottom(): void {
    if (!alive) return
    following = true
    chaseAllowed = true
    stopTimer()
    clearSettle()
    const el = getEl()
    if (!el) return
    setScrollTop(el, el.scrollHeight)
  }

  /** 回答结束：停掉慢速动画；仍在底部跟随则贴一次底。 */
  function finish(): void {
    if (!alive) return
    chaseAllowed = false
    stopTimer()
    clearSettle()
    const el = getEl()
    if (el && following) {
      setScrollTop(el, el.scrollHeight)
    }
  }

  function pause(): void {
    following = false
    chaseAllowed = false
    stopTimer()
    clearSettle()
  }

  function onScroll(): void {
    if (!alive || programmatic || performance.now() < ignoreScrollUntil) return
    const el = getEl()
    if (!el) return
    const near = gap(el) < nearBottomPx
    if (near) {
      following = true
      // 用户滚回底部：允许 chase，由外层在 streaming 时再 kick
      chaseAllowed = true
    } else {
      following = false
      chaseAllowed = false
      stopTimer()
      clearSettle()
    }
  }

  return {
    kick,
    snapToBottom,
    finish,
    onScroll,
    isFollowing: () => following,
    resume: () => {
      following = true
      chaseAllowed = true
    },
    pause,
    destroy: () => {
      alive = false
      stopTimer()
      clearSettle()
    }
  }
}
