import type { ChatAttachment } from '@shared/types'

/**
 * Electron 32+ 已移除 File.path，拖入文件必须经 preload 的 webUtils.getPathForFile。
 */
export function pathForDroppedFile(file: File): string {
  try {
    if (typeof window.petApi?.getPathForFile === 'function') {
      const p = window.petApi.getPathForFile(file)
      if (p) return p
    }
  } catch {
    // ignore
  }
  return (file as File & { path?: string }).path || ''
}

export function pathsFromDroppedFiles(files: ArrayLike<File>): string[] {
  const out: string[] = []
  for (let i = 0; i < files.length; i++) {
    const p = pathForDroppedFile(files[i]!)
    if (p) out.push(p)
  }
  return out
}

async function saveBlobAsTempAttachment(
  blob: Blob,
  name: string
): Promise<ChatAttachment | null> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return window.petApi.saveTempAttachment({
    name: name || `drop-${Date.now()}.bin`,
    base64: btoa(binary),
    mime: blob.type || undefined
  })
}

/** 拖入 FileList → 附件（优先原路径；无路径则落临时文件）。 */
export async function attachmentsFromDroppedFiles(
  files: ArrayLike<File>
): Promise<ChatAttachment[]> {
  const list = Array.from(files || [])
  if (!list.length) return []

  const out: ChatAttachment[] = []
  const seen = new Set<string>()
  const push = (a: ChatAttachment | null | undefined): void => {
    if (!a?.path || seen.has(a.path)) return
    seen.add(a.path)
    out.push(a)
  }

  const paths = pathsFromDroppedFiles(list)
  if (paths.length && typeof window.petApi.resolveAttachmentPaths === 'function') {
    const resolved = await window.petApi.resolveAttachmentPaths(paths)
    for (const a of resolved) push(a)
  }

  for (const file of list) {
    if (pathForDroppedFile(file)) continue
    push(await saveBlobAsTempAttachment(file, file.name || `drop-${Date.now()}.bin`))
  }

  return out.slice(0, 12)
}
