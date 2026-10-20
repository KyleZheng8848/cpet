/**
 * README 下载区的生成与替换。
 *
 * 这块东西错了没人会立刻发现：README 照样能看，只是链接指向不存在的文件，
 * 或者整块把正文吃掉。等用户反馈「点了 404」已经晚了，所以在这里锁住。
 */
import { describe, it, expect } from 'vitest'
import { renderDownloadsBlock, replaceBlock, START, END } from '../scripts/lib/readme-downloads.mjs'

const base = 'https://example.com/CPET/'
const stableUrl = (name: string) => base + name.replace(/^CPET-[\d.]+-/, 'CPET-latest-')

const sample = () =>
  renderDownloadsBlock({
    version: '0.4.0',
    publishedAt: '2026-07-30T06:00:00.000Z',
    assets: [
      { name: 'CPET-0.4.0-arm64.dmg', size: 182_257_254 },
      { name: 'CPET-0.4.0-arm64.zip', size: 175_500_000 }
    ],
    stableUrl,
    history: [
      {
        version: '0.3.99',
        files: [{ label: 'arm64', url: `${base}CPET-0.3.99-arm64.dmg`, size: 180_000_000 }]
      }
    ],
    pageUrl: `${base}index.html`
  })

describe('README 下载区渲染', () => {
  it('下载链接指向固定名，不指向带版本号的文件', () => {
    const md = sample()
    expect(md).toContain(`${base}CPET-latest-arm64.dmg`)
    expect(md).not.toContain(`${base}CPET-0.4.0-arm64.dmg`)
  })

  it('历史版本链接保留具体版本号，否则回退不到旧版', () => {
    expect(sample()).toContain(`${base}CPET-0.3.99-arm64.dmg`)
  })

  it('没出包的平台留占位而不是假链接', () => {
    const md = sample()
    expect(md).toMatch(/\| Windows · x64 \| — \|/)
    expect(md).toMatch(/\| Linux · x64 \| — \|/)
    expect(md).toMatch(/\| macOS · Intel \| — \|/)
  })

  it('Linux 两个架构各占一行，不会互相盖掉', () => {
    const md = renderDownloadsBlock({
      version: '0.4.0',
      assets: [
        { name: 'CPET-0.4.0-x86_64.AppImage', size: 180_000_000 },
        { name: 'CPET-0.4.0-arm64.AppImage', size: 178_000_000 },
        { name: 'CPET-0.4.0-x64.exe', size: 130_000_000 }
      ],
      stableUrl
    })
    expect(md).toContain('CPET-latest-x86_64.AppImage')
    expect(md).toContain('CPET-latest-arm64.AppImage')
    expect(md).toContain('CPET-latest-x64.exe')
  })

  it('版本、日期、体积都出现在标题与表格里', () => {
    const md = sample()
    expect(md).toContain('### 最新版本 0.4.0 · 2026-07-30')
    expect(md).toContain('174 MB')
  })

  it('更新要点最多列 5 条，其余引到 CHANGELOG', () => {
    const md = renderDownloadsBlock({
      version: '0.4.0',
      assets: [{ name: 'CPET-0.4.0-arm64.dmg', size: 1_048_576 }],
      stableUrl,
      highlights: ['一', '二', '三', '四', '五', '六', '七']
    })
    expect(md).toContain('- 五')
    expect(md).not.toContain('- 六')
    expect(md).toContain('CHANGELOG.md')
  })

  it('没有更新要点时不留空标题', () => {
    const md = renderDownloadsBlock({
      version: '0.4.0',
      assets: [{ name: 'CPET-0.4.0-arm64.dmg', size: 1_048_576 }],
      stableUrl,
      highlights: []
    })
    expect(md).not.toContain('这一版改了什么')
  })

  it('没有历史版本时不渲染空表', () => {
    const md = renderDownloadsBlock({
      version: '0.1.0',
      assets: [{ name: 'CPET-0.1.0-arm64.dmg', size: 1_048_576 }],
      stableUrl,
      history: []
    })
    expect(md).not.toContain('历史版本')
    expect(md.startsWith(START)).toBe(true)
    expect(md.trimEnd().endsWith(END)).toBe(true)
  })
})

describe('README 区块替换', () => {
  const doc = `# 标题\n\n前面的手写正文\n\n${START}\n旧内容\n${END}\n\n后面的手写正文\n`

  it('只换标记之间的内容，手写正文一个字不动', () => {
    const out = replaceBlock(doc, `${START}\n新内容\n${END}`)
    expect(out).toContain('前面的手写正文')
    expect(out).toContain('后面的手写正文')
    expect(out).toContain('新内容')
    expect(out).not.toContain('旧内容')
  })

  it('替换是幂等的：同样的输入再跑一遍不会变', () => {
    const block = `${START}\n新内容\n${END}`
    expect(replaceBlock(replaceBlock(doc, block), block)).toBe(replaceBlock(doc, block))
  })

  it('找不到标记就报错，绝不猜位置插入', () => {
    expect(() => replaceBlock('# 只有标题\n', `${START}\nx\n${END}`)).toThrow(/找不到下载区块标记/)
  })
})
