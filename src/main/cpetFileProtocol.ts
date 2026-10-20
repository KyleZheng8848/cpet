import { net, protocol } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 本地附件媒体协议：渲染进程用 cpet-file://local/?p=<encodeURIComponent(absPath)>
 * 必须在 app ready 前 registerSchemesAsPrivileged，ready 后 handle。
 */

export const CPET_FILE_SCHEME = 'cpet-file'

function resolveCpetFilePath(raw: string): string {
  const p = (raw || '').trim()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function registerCpetFileSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CPET_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true
      }
    }
  ])
}

export function registerCpetFileProtocolHandler(): void {
  protocol.handle(CPET_FILE_SCHEME, (request) => {
    try {
      const u = new URL(request.url)
      const raw = u.searchParams.get('p')
      if (!raw) return new Response('missing path', { status: 400 })
      const filePath = resolveCpetFilePath(decodeURIComponent(raw))
      if (!filePath || filePath.includes('\0')) {
        return new Response('bad path', { status: 400 })
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).href)
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 500 })
    }
  })
}
