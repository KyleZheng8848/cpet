import { describe, expect, it } from 'vitest'
import {
  buildMarketRows,
  catalogBaseUrlFromCatalogUrl,
  describeAppearance,
  isSafeSkinPackId,
  parseSkinCatalog,
  resolveCatalogAssetUrl,
  resolveSkinCatalogUrl
} from '../src/shared/skinMarket'
import { unzipBuffer, zipBuffer } from '../src/main/zipUtil'

describe('skinMarket catalog', () => {
  it('resolveSkinCatalogUrl prefers explicit then downloadBaseUrl', () => {
    expect(
      resolveSkinCatalogUrl({
        skinCatalog: 'https://example.com/skins/catalog.json',
        downloadBaseUrl: 'https://ignored/'
      })
    ).toBe('https://example.com/skins/catalog.json')
    expect(resolveSkinCatalogUrl({ downloadBaseUrl: 'https://cdn.example/CPET' })).toBe(
      'https://cdn.example/CPET/skins/catalog.json'
    )
    expect(resolveSkinCatalogUrl({})).toBeNull()
  })

  it('parseSkinCatalog validates and skips bad rows', () => {
    const cat = parseSkinCatalog({
      version: 1,
      updatedAt: '2026-07-30',
      skins: [
        { id: '好皮肤', name: '好皮肤', packUrl: 'packs/a.zip', states: ['idle'] },
        { id: '../evil', packUrl: 'x.zip' },
        { id: 'no-pack', name: 'x' },
        null
      ]
    })
    expect(cat.skins).toHaveLength(1)
    expect(cat.skins[0]?.id).toBe('好皮肤')
  })

  it('buildMarketRows merges install state and resolves urls', () => {
    const catalog = parseSkinCatalog({
      version: 1,
      skins: [{ id: '云朵羊', name: '云朵羊', pack: '云朵羊.zip', preview: '云朵羊/idle.gif' }]
    })
    const base = 'https://cdn.example/CPET/skins/'
    const rows = buildMarketRows(catalog, base, [{ id: '云朵羊', source: 'market' }])
    expect(rows[0]?.installed).toBe(true)
    expect(rows[0]?.localSource).toBe('market')
    expect(rows[0]?.resolvedPackUrl).toBe('https://cdn.example/CPET/skins/%E4%BA%91%E6%9C%B5%E7%BE%8A.zip')
  })

  it('catalogBaseUrlFromCatalogUrl strips filename', () => {
    expect(catalogBaseUrlFromCatalogUrl('https://a/b/skins/catalog.json')).toBe(
      'https://a/b/skins/'
    )
  })

  it('resolveCatalogAssetUrl keeps absolute', () => {
    expect(resolveCatalogAssetUrl('https://a/b/', 'https://other/x.zip')).toBe('https://other/x.zip')
  })

  it('isSafeSkinPackId rejects traversal', () => {
    expect(isSafeSkinPackId('云朵羊')).toBe(true)
    expect(isSafeSkinPackId('../x')).toBe(false)
    expect(isSafeSkinPackId('a/b')).toBe(false)
    expect(isSafeSkinPackId('')).toBe(false)
  })

  it('describeAppearance prefers image pack', () => {
    expect(describeAppearance({ skin: 'violet', skinName: '小紫熊', imageSkin: '云朵羊' })).toEqual({
      kind: 'image',
      label: '云朵羊',
      detail: '图片皮肤'
    })
    expect(describeAppearance({ skin: 'mint', skinName: '薄荷猫' }).kind).toBe('vector')
  })
})

describe('zipUtil roundtrip', () => {
  it('zips and unzips STORE entries', () => {
    const raw = zipBuffer([
      { name: 'idle.gif', data: Buffer.from('GIF89a-fake') },
      { name: 'nested/tool.png', data: Buffer.from([1, 2, 3, 4]) }
    ])
    const entries = unzipBuffer(raw)
    expect(entries.map((e) => e.name).sort()).toEqual(['idle.gif', 'nested/tool.png'])
    expect(entries.find((e) => e.name === 'idle.gif')?.data.toString()).toBe('GIF89a-fake')
  })

  it('rejects zip-slip paths', () => {
    // 手工拼一个带 .. 的 local header 名
    const name = Buffer.from('../evil.txt', 'utf8')
    const data = Buffer.from('x')
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    expect(() => unzipBuffer(Buffer.concat([local, data]))).toThrow(/不安全/)
  })
})
