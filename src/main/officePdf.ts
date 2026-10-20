/**
 * 有 LibreOffice 时把 Office 转成 PDF，用 Chromium 内置阅读器看原版式。
 * 无 soffice 时回退结构化 HTML。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import { readOfficePreviewText, type OfficeHtmlResult } from './officePreview'

const CONVERT_MS = 50_000
const OFFICE_EXT = new Set(['.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.xlsm'])

const SOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
]

let cachedBin: string | null | undefined

export function findSofficeBin(): string | null {
  if (cachedBin !== undefined) return cachedBin
  for (const p of SOFFICE_CANDIDATES) {
    if (existsSync(p)) {
      cachedBin = p
      return p
    }
  }
  cachedBin = null
  return null
}

function cacheDir(): string {
  const d = join(app.getPath('userData'), 'office-preview')
  mkdirSync(d, { recursive: true })
  return d
}

function cacheKey(src: string): string {
  const st = statSync(src)
  return createHash('sha1')
    .update(`${src}|${st.size}|${st.mtimeMs}`)
    .digest('hex')
    .slice(0, 20)
}

function runSoffice(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (b) => {
      err += String(b)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('转换超时'))
    }, CONVERT_MS)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(err.trim() || `soffice 退出 ${code}`))
    })
  })
}

export async function convertOfficeToPdf(
  src: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const ext = extname(src).toLowerCase()
    if (!OFFICE_EXT.has(ext)) return { ok: false, error: '不是 Office 文件' }
    if (!existsSync(src)) return { ok: false, error: '文件不存在' }
    const bin = findSofficeBin()
    if (!bin) return { ok: false, error: '未安装 LibreOffice' }

    const dir = cacheDir()
    const key = cacheKey(src)
    const out = join(dir, `${key}.pdf`)
    if (existsSync(out) && statSync(out).size > 32) return { ok: true, path: out }

    const work = join(dir, key)
    mkdirSync(work, { recursive: true })
    const profile = join(dir, 'lo-profile')
    mkdirSync(profile, { recursive: true })
    const profileUrl = `file://${profile}`
    await runSoffice(
      bin,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        `--env:UserInstallation=${profileUrl}`,
        '--convert-to',
        'pdf',
        '--outdir',
        work,
        src
      ],
      work
    )
    const produced = join(work, basename(src, ext) + '.pdf')
    if (!existsSync(produced) || statSync(produced).size < 32) {
      return { ok: false, error: '未生成 PDF' }
    }
    copyFileSync(produced, out)
    return { ok: true, path: out }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export type OfficePreviewResult =
  | {
      ok: true
      html: string
      truncated: boolean
      format: string
      pdfPath?: string
      mode: 'pdf' | 'html'
    }
  | { ok: false; error: string }

/** 优先原版式 PDF；没有 LibreOffice 时回退结构化 HTML。 */
export async function previewOffice(path: string): Promise<OfficePreviewResult> {
  const pdf = await convertOfficeToPdf(path)
  if (pdf.ok) {
    const ext = extname(path).toLowerCase().replace(/^\./, '') || 'office'
    return {
      ok: true,
      html: '',
      truncated: false,
      format: ext,
      pdfPath: pdf.path,
      mode: 'pdf'
    }
  }
  const html: OfficeHtmlResult = readOfficePreviewText(path)
  if (!html.ok) return html
  return { ...html, mode: 'html' }
}
