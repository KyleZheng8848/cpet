/** 破坏性操作二次确认（防呆）。取消返回 false。 */
export function confirmDestructive(message: string): boolean {
  return window.confirm(message)
}

/**
 * 异步确认：优先走主进程原生对话框（无边框窗里比 window.confirm 可靠）。
 */
export async function confirmDestructiveAsync(message: string): Promise<boolean> {
  try {
    if (typeof window.petApi?.confirm === 'function') {
      return !!(await window.petApi.confirm(message))
    }
  } catch {
    /* fall through */
  }
  return window.confirm(message)
}
