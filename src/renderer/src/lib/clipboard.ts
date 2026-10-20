/** 优先主进程剪贴板；失败再降级到浏览器 API / execCommand。 */
export async function writeClipboardText(text: string): Promise<boolean> {
  const value = text ?? ''
  if (!value) return false
  try {
    if (typeof window !== 'undefined' && window.petApi?.writeClipboard) {
      const ok = await window.petApi.writeClipboard(value)
      if (ok) return true
    }
  } catch {
    // fall through
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
