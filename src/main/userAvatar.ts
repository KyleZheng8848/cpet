import { app, dialog } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
  copyFileSync
} from 'node:fs'
import { extname, join } from 'node:path'
import { getChatWindow } from './windows'
import { updateSettings } from './store'
import { USER_AVATAR_IMAGE_PREFIX } from '../shared/chatUi'

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}
const MAX_BYTES = 2_500_000

function avatarDir(): string {
  const d = join(app.getPath('userData'), 'avatars')
  mkdirSync(d, { recursive: true })
  return d
}

function clearAvatarFiles(): void {
  const dir = avatarDir()
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('user.')) {
        try {
          unlinkSync(join(dir, name))
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

function fileToDataUrl(file: string): string | null {
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size > MAX_BYTES) return null
    const ext = extname(file).toLowerCase()
    if (!IMG_EXTS.has(ext)) return null
    const mime = MIME[ext] ?? 'image/png'
    return `data:${mime};base64,${readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

/** 将 settings 里的头像值解析为界面可用值（emoji 或 data URL）。 */
export function resolveUserAvatarDisplay(stored?: string): string | undefined {
  if (!stored) return undefined
  if (stored.startsWith('data:image/')) return stored
  if (stored.startsWith(USER_AVATAR_IMAGE_PREFIX)) {
    const name = stored.slice(USER_AVATAR_IMAGE_PREFIX.length)
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return undefined
    }
    return fileToDataUrl(join(avatarDir(), name)) ?? undefined
  }
  return stored
}

/** 选图并落盘，写入 settings（img:…），返回 data URL。取消则 null。 */
export async function pickUserAvatarImage(): Promise<string | null> {
  const win = getChatWindow()
  const opts: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: '全部', extensions: ['*'] }
    ]
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) return null

  const src = result.filePaths[0]
  const ext = extname(src).toLowerCase()
  if (!IMG_EXTS.has(ext)) return null
  try {
    const st = statSync(src)
    if (!st.isFile() || st.size > MAX_BYTES) return null
  } catch {
    return null
  }

  clearAvatarFiles()
  const name = `user${ext}`
  const dest = join(avatarDir(), name)
  try {
    copyFileSync(src, dest)
  } catch {
    // 跨卷失败时读写一遍
    writeFileSync(dest, readFileSync(src))
  }
  if (!existsSync(dest)) return null

  const token = `${USER_AVATAR_IMAGE_PREFIX}${name}`
  updateSettings({ userAvatar: token })
  return fileToDataUrl(dest)
}

/** 切回 emoji 时清掉本地头像文件。 */
export function clearUserAvatarImage(): void {
  clearAvatarFiles()
}
