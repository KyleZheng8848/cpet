import { describe, it, expect } from 'vitest'
import {
  parseScutilProxy,
  isSocksProxyUrl,
  sanitizeProxyEnv
} from '../src/main/systemProxy'

describe('parseScutilProxy', () => {
  it('SOCKSEnable 时只注入 ALL_PROXY，不写 HTTP(S)_PROXY', () => {
    const env = parseScutilProxy(`
  SOCKSEnable : 1
  SOCKSPort : 13659
  SOCKSProxy : 127.0.0.1
`)
    expect(env.ALL_PROXY).toBe('socks5h://127.0.0.1:13659')
    expect(env.all_proxy).toBe('socks5h://127.0.0.1:13659')
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.http_proxy).toBeUndefined()
    expect(env.https_proxy).toBeUndefined()
  })

  it('仅 HTTPS 代理时用 http URL', () => {
    const env = parseScutilProxy(`
  HTTPSEnable : 1
  HTTPSPort : 8080
  HTTPSProxy : 127.0.0.1
`)
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:8080')
  })

  it('未启用时返回空', () => {
    expect(parseScutilProxy('SOCKSEnable : 0')).toEqual({})
  })
})

describe('sanitizeProxyEnv', () => {
  it('识别 socks URL', () => {
    expect(isSocksProxyUrl('socks5h://127.0.0.1:13659')).toBe(true)
    expect(isSocksProxyUrl('socks5://127.0.0.1:1080')).toBe(true)
    expect(isSocksProxyUrl('http://127.0.0.1:8080')).toBe(false)
  })

  it('清掉 HTTP_PROXY 上的 socks，保留 ALL_PROXY', () => {
    const env: NodeJS.ProcessEnv = {
      ALL_PROXY: 'socks5h://127.0.0.1:13659',
      HTTP_PROXY: 'socks5h://127.0.0.1:13659',
      HTTPS_PROXY: 'socks5h://127.0.0.1:13659',
      GLOBAL_AGENT_HTTP_PROXY: 'socks5h://127.0.0.1:13659'
    }
    sanitizeProxyEnv(env)
    expect(env.ALL_PROXY).toBe('socks5h://127.0.0.1:13659')
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.GLOBAL_AGENT_HTTP_PROXY).toBeUndefined()
  })
})
