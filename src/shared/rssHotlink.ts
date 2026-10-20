/** 图床防盗链：按目标主机推断应带的 Referer（对话窗 origin 无效时用）。 */
export function inferHotlinkReferer(imageUrl: string): string | undefined {
  try {
    const u = new URL(imageUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    const host = u.hostname.toLowerCase()
    if (host.endsWith('.qpic.cn') || host.includes('mmbiz')) {
      return 'https://mp.weixin.qq.com/'
    }
    const cdn = host.match(/^(?:i|img|imgs|image|images|static|cdn|media|pic|pics)\.(.+)$/i)
    if (cdn) {
      const root = cdn[1]
      return root.startsWith('www.') ? `https://${root}/` : `https://www.${root}/`
    }
    return `${u.protocol}//${host}/`
  } catch {
    return undefined
  }
}

export function refererLooksLikeAppShell(ref: string): boolean {
  if (!ref) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(ref)) return true
  if (/^(file|app|atom):/i.test(ref)) return true
  return false
}
