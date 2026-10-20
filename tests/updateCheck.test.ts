/**
 * 更新检查契约。
 * 两个必须钉死的点：
 *   1. 版本号按数字比，不能按字符串（否则 0.3.9 会被判成比 0.3.10 新，用户永远收不到更新）
 *   2. 绝不能把 arm64 的包推给 Intel 机器（README 专门警告过别混装）
 */
import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  evaluateUpdate,
  latestReleaseApiUrl,
  normalizeVersion,
  parseGitHubRepo,
  parseUpdateManifest,
  pickReleaseAsset,
  releasesPageUrl,
  shouldNotifyUpdate,
  shouldShowUpdateBanner
} from '../src/shared/updateCheck'

describe('compareVersions', () => {
  it('按数字逐段比：0.3.9 小于 0.3.10（字符串比会判反）', () => {
    expect(compareVersions('0.3.10', '0.3.9')).toBe(1)
    expect(compareVersions('0.3.9', '0.3.10')).toBe(-1)
  })

  it('本项目真实场景：0.3.97 → 0.3.100 是升级', () => {
    expect(compareVersions('0.3.100', '0.3.97')).toBe(1)
  })

  it('相等', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('主次版本优先于修订号', () => {
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.4.0', '0.3.97')).toBe(1)
  })

  it('段数不同按缺省 0 处理', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })

  it('预发布版低于同号正式版', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1)
  })

  it('非法段不抛异常，按 0 处理', () => {
    expect(compareVersions('1.x.3', '1.0.3')).toBe(0)
    expect(compareVersions('', '')).toBe(0)
  })
})

describe('normalizeVersion', () => {
  it.each([
    ['v0.3.97', '0.3.97'],
    ['  0.3.97 ', '0.3.97'],
    ['V1.0.0', '1.0.0'],
    ['', '']
  ])('%s → %s', (input, want) => {
    expect(normalizeVersion(input)).toBe(want)
  })
})

describe('parseGitHubRepo', () => {
  it.each([
    ['owner/repo 简写', 'kyle/cursor-pet'],
    ['https', 'https://github.com/kyle/cursor-pet'],
    ['https 带 .git', 'https://github.com/kyle/cursor-pet.git'],
    ['git+https', 'git+https://github.com/kyle/cursor-pet.git'],
    ['ssh 形式', 'git@github.com:kyle/cursor-pet.git'],
    ['npm github: 简写', 'github:kyle/cursor-pet'],
    ['带结尾斜杠', 'https://github.com/kyle/cursor-pet/'],
    ['带 query', 'https://github.com/kyle/cursor-pet?tab=readme']
  ])('%s', (_label, input) => {
    expect(parseGitHubRepo(input)).toEqual({ owner: 'kyle', repo: 'cursor-pet' })
  })

  it('package.json 的对象写法', () => {
    expect(parseGitHubRepo({ type: 'git', url: 'git+https://github.com/kyle/cursor-pet.git' })).toEqual({
      owner: 'kyle',
      repo: 'cursor-pet'
    })
  })

  it.each([
    ['未配置', undefined],
    ['空串', ''],
    ['只有空白', '   '],
    ['非 GitHub 地址', 'https://gitlab.com/kyle/cursor-pet'],
    ['缺 repo', 'https://github.com/kyle'],
    ['数字', 123]
  ])('%s → null', (_label, input) => {
    expect(parseGitHubRepo(input)).toBeNull()
  })

  it('拼出的地址可用', () => {
    const repo = { owner: 'kyle', repo: 'cursor-pet' }
    expect(releasesPageUrl(repo)).toBe('https://github.com/kyle/cursor-pet/releases')
    expect(latestReleaseApiUrl(repo)).toBe(
      'https://api.github.com/repos/kyle/cursor-pet/releases/latest'
    )
  })
})

describe('pickReleaseAsset', () => {
  const assets = [
    { name: 'CPET-0.4.0-arm64.dmg', url: 'u/arm64-dmg' },
    { name: 'CPET-0.4.0-x64.dmg', url: 'u/x64-dmg' },
    { name: 'CPET-0.4.0-arm64.zip', url: 'u/arm64-zip' },
    { name: 'CPET-0.4.0-setup.exe', url: 'u/exe' },
    { name: 'CPET-0.4.0.AppImage', url: 'u/appimage' },
    { name: 'CPET-0.4.0-arm64.dmg.blockmap', url: 'u/blockmap' }
  ]

  it('Apple Silicon 拿 arm64 dmg', () => {
    expect(pickReleaseAsset(assets, 'darwin', 'arm64')?.url).toBe('u/arm64-dmg')
  })

  it('Intel Mac 拿 x64 dmg，绝不能拿到 arm64', () => {
    expect(pickReleaseAsset(assets, 'darwin', 'x64')?.url).toBe('u/x64-dmg')
  })

  it('Windows 拿 exe', () => {
    expect(pickReleaseAsset(assets, 'win32', 'x64')?.url).toBe('u/exe')
  })

  it('Linux 拿 AppImage（无架构后缀时仍能匹配）', () => {
    expect(pickReleaseAsset(assets, 'linux', 'x64')?.url).toBe('u/appimage')
  })

  it('Linux 有两个 AppImage 时按架构挑，绝不能混装', () => {
    const both = [
      { name: 'CPET-0.4.0-arm64.AppImage', url: 'u/linux-arm' },
      { name: 'CPET-0.4.0-x86_64.AppImage', url: 'u/linux-x64' }
    ]
    expect(pickReleaseAsset(both, 'linux', 'x64')?.url).toBe('u/linux-x64')
    expect(pickReleaseAsset(both, 'linux', 'arm64')?.url).toBe('u/linux-arm')
  })

  it('只有 zip 时退到 zip', () => {
    const zipOnly = [{ name: 'CPET-0.4.0-arm64.zip', url: 'u/zip' }]
    expect(pickReleaseAsset(zipOnly, 'darwin', 'arm64')?.url).toBe('u/zip')
  })

  it('架构对不上时返回 undefined，让用户自己去 Release 页选', () => {
    const armOnly = [{ name: 'CPET-0.4.0-arm64.dmg', url: 'u/arm' }]
    expect(pickReleaseAsset(armOnly, 'darwin', 'x64')).toBeUndefined()
  })

  it('空列表与未知平台不抛异常', () => {
    expect(pickReleaseAsset([], 'darwin', 'arm64')).toBeUndefined()
    expect(pickReleaseAsset(assets, 'freebsd', 'x64')).toBeUndefined()
  })
})

describe('parseUpdateManifest', () => {
  it('自托管清单（私有仓库 / 内网适用）', () => {
    expect(
      parseUpdateManifest({
        version: '0.4.0',
        releasesUrl: 'https://intra/cpet/download',
        assets: [{ name: 'CPET-0.4.0-arm64.dmg', url: 'https://intra/a.dmg' }]
      })
    ).toEqual({
      version: '0.4.0',
      releasesUrl: 'https://intra/cpet/download',
      assets: [{ name: 'CPET-0.4.0-arm64.dmg', url: 'https://intra/a.dmg' }]
    })
  })

  it('同一份代码也能吃 GitHub Releases API 的形状', () => {
    expect(
      parseUpdateManifest({
        tag_name: 'v0.4.0',
        html_url: 'https://github.com/o/r/releases/tag/v0.4.0',
        assets: [
          { name: 'CPET-0.4.0-arm64.dmg', browser_download_url: 'https://gh/a.dmg' },
          { name: '缺 url 的条目' }
        ]
      })
    ).toEqual({
      version: '0.4.0',
      releasesUrl: 'https://github.com/o/r/releases/tag/v0.4.0',
      assets: [{ name: 'CPET-0.4.0-arm64.dmg', url: 'https://gh/a.dmg' }]
    })
  })

  it('只有版本号也能用（没有安装包就只提示有新版）', () => {
    expect(parseUpdateManifest({ version: '1.0.0' })).toEqual({
      version: '1.0.0',
      releasesUrl: undefined,
      assets: []
    })
  })

  it.each([
    ['null', null],
    ['字符串', 'oops'],
    ['空对象', {}],
    ['版本号不是数字开头', { version: 'latest' }],
    ['assets 不是数组', { version: '1.0.0', assets: 'x' }]
  ])('脏输入不抛异常：%s', (_label, input) => {
    expect(() => parseUpdateManifest(input)).not.toThrow()
  })

  it('无版本号 → null（不能谎称已是最新）', () => {
    expect(parseUpdateManifest({ assets: [] })).toBeNull()
    expect(parseUpdateManifest({ version: 'latest' })).toBeNull()
  })

  it('assets 不是数组时降级为空列表而不是崩', () => {
    expect(parseUpdateManifest({ version: '1.0.0', assets: 'x' })?.assets).toEqual([])
  })
})

describe('shouldNotifyUpdate：主动提示的纪律', () => {
  it('有新版且从未提示过 → 提示', () => {
    expect(shouldNotifyUpdate({ status: 'update-available', latest: '0.4.0' })).toBe(true)
  })

  it('同一个版本不重复提示（CPET 常驻托盘，重复弹会被用户直接关掉）', () => {
    expect(
      shouldNotifyUpdate({ status: 'update-available', latest: '0.4.0', seenVersion: '0.4.0' })
    ).toBe(false)
  })

  it('又出了更高的版本 → 重新提示', () => {
    expect(
      shouldNotifyUpdate({ status: 'update-available', latest: '0.4.1', seenVersion: '0.4.0' })
    ).toBe(true)
  })

  it('提示过的版本号带 v 前缀也算同一个', () => {
    expect(
      shouldNotifyUpdate({ status: 'update-available', latest: '0.4.0', seenVersion: 'v0.4.0' })
    ).toBe(false)
  })

  it('比已提示版本更低 → 不提示（不能提示降级）', () => {
    expect(
      shouldNotifyUpdate({ status: 'update-available', latest: '0.3.9', seenVersion: '0.4.0' })
    ).toBe(false)
  })

  it.each(['up-to-date', 'error', 'not-configured'] as const)(
    '%s 一律不打扰用户（离线、没配发布源都不该弹窗）',
    (status) => {
      expect(shouldNotifyUpdate({ status, latest: '0.4.0' })).toBe(false)
    }
  )

  it('状态说有新版但没版本号 → 不提示（宁可不弹，也不弹个空的）', () => {
    expect(shouldNotifyUpdate({ status: 'update-available' })).toBe(false)
    expect(shouldNotifyUpdate({ status: 'update-available', latest: '  ' })).toBe(false)
  })
})

describe('shouldShowUpdateBanner', () => {
  it('有新版且未稍后 → 显示', () => {
    expect(shouldShowUpdateBanner({ status: 'update-available', latest: '0.4.4' })).toBe(true)
  })

  it('点过稍后的同一版 → 不显示', () => {
    expect(
      shouldShowUpdateBanner({
        status: 'update-available',
        latest: '0.4.4',
        dismissedVersion: '0.4.4'
      })
    ).toBe(false)
  })

  it('稍后过旧版、线上又更新 → 再显示', () => {
    expect(
      shouldShowUpdateBanner({
        status: 'update-available',
        latest: '0.4.5',
        dismissedVersion: '0.4.4'
      })
    ).toBe(true)
  })
})

describe('evaluateUpdate', () => {
  it('线上更高 → 提示有新版本，并带上下载直链', () => {
    const r = evaluateUpdate({
      current: '0.3.97',
      latest: 'v0.4.0',
      releasesUrl: 'https://github.com/o/r/releases',
      downloadUrl: 'u/dmg'
    })
    expect(r.status).toBe('update-available')
    expect(r.latest).toBe('0.4.0')
    expect(r.downloadUrl).toBe('u/dmg')
    expect(r.message).toContain('0.4.0')
    expect(r.message).toContain('0.3.97')
  })

  it('版本相同 → 已是最新，且不给下载链接（避免用户重下同一个包）', () => {
    const r = evaluateUpdate({ current: '0.3.97', latest: '0.3.97', downloadUrl: 'u/dmg' })
    expect(r.status).toBe('up-to-date')
    expect(r.downloadUrl).toBeUndefined()
  })

  it('本机比线上新（本地开发版）→ 不提示降级', () => {
    expect(evaluateUpdate({ current: '0.4.0', latest: '0.3.97' }).status).toBe('up-to-date')
  })

  it('线上版本号读不到 → 报错而不是谎称已最新', () => {
    const r = evaluateUpdate({ current: '0.3.97', latest: '' })
    expect(r.status).toBe('error')
  })
})
