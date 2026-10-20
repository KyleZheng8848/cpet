/** 从工具/命令输出里抽出可展示的远程图片 URL（AntV resultObj 等）。 */

const IMAGE_URL_RE = /https:\/\/[^\s"'<>\\]+/gi

export function isRemoteImageUrl(url: string): boolean {
  const u = (url || '').trim()
  if (!/^https:\/\//i.test(u) || u.length > 2000) return false
  if (/\.(png|jpe?g|gif|webp|svg|bmp)(?:\?|#|$)/i.test(u)) return true
  if (/\/original(?:\?|#|$)/i.test(u)) return true
  if (
    /imgur\.com|githubusercontent|seaart\.|aliyuncs\.com|qiniucdn|cloudfront\.net/i.test(
      u
    )
  ) {
    return true
  }
  return false
}

function pushUrl(out: string[], seen: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return
  const t = raw.trim().replace(/[),.;]+$/g, '')
  if (!isRemoteImageUrl(t) || seen.has(t)) return
  seen.add(t)
  out.push(t)
}

function walkJson(value: unknown, out: string[], seen: Set<string>, depth: number): void {
  if (depth > 8 || value == null) return
  if (typeof value === 'string') {
    pushUrl(out, seen, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, out, seen, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (/^(resultObj|result_obj|url|image|img|src|imageUrl|image_url)$/i.test(key)) {
      pushUrl(out, seen, val)
    }
    walkJson(val, out, seen, depth + 1)
  }
}

export function extractRemoteImageUrls(raw: string): string[] {
  const text = (raw || '').trim()
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  try {
    walkJson(JSON.parse(text), out, seen, 0)
  } catch {
    const blob = text.match(/\{[^{}]*"success"\s*:\s*true[^{}]*\}/)
    if (blob) {
      try {
        walkJson(JSON.parse(blob[0]), out, seen, 0)
      } catch {
        /* fall through */
      }
    }
  }
  for (const m of text.matchAll(/"(?:resultObj|result_obj|imageUrl|image_url|url)"\s*:\s*"(https:\/\/[^"\\]+)"/gi)) {
    pushUrl(out, seen, m[1])
  }
  for (const m of text.matchAll(IMAGE_URL_RE)) pushUrl(out, seen, m[0])
  return out.slice(0, 8)
}

export function imageMarkdownForUrls(urls: string[]): string {
  return urls
    .map((u, i) => `![图表 ${i + 1}](${u})\n${u}`)
    .join('\n\n')
}
