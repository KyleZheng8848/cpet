/** 用户正在打字/选字（含中文输入），此时不要抢焦点、不要换气泡。 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false
  const node = el.closest('input, textarea, select, [contenteditable="true"]')
  if (!node) return false
  if (node instanceof HTMLInputElement) {
    const t = node.type
    if (t === 'button' || t === 'submit' || t === 'reset' || t === 'checkbox' || t === 'radio' || t === 'file') {
      return false
    }
  }
  return true
}
