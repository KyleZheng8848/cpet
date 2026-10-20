/**
 * 更新日志结构契约（三处版本号是否同步由 scripts/check-version-sync.mjs 负责）。
 * 这里只管应用内「关于 → 更新日志」渲染时不会出现空条目、乱序、日期格式错。
 */
import { describe, it, expect } from 'vitest'
import { CHANGELOG, recentChangelog } from '../src/shared/changelog'

/** '0.3.64–0.3.67' 这类区间取 [低, 高]。 */
function bounds(version: string): [number[], number[]] {
  const parts = version.split(/\s*[–—-]\s*/).filter(Boolean)
  const toNums = (v: string) => v.split('.').map((n) => Number(n))
  const lo = toNums(parts[0])
  const hi = toNums(parts[parts.length - 1])
  return [lo, hi]
}

const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

describe('CHANGELOG 数据', () => {
  it('非空', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
  })

  it('每条都有合法版本号', () => {
    for (const e of CHANGELOG) {
      expect(e.version, `版本号格式：${e.version}`).toMatch(/^\d+\.\d+\.\d+(\s*[–—-]\s*\d+\.\d+\.\d+)?$/)
    }
  })

  it('每条日期都是 YYYY-MM-DD 且真实存在', () => {
    for (const e of CHANGELOG) {
      expect(e.date, `日期格式：${e.version}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(e.date)), `日期可解析：${e.version}`).toBe(false)
    }
  })

  it('每条至少一条非空说明（关于页不出现空白项）', () => {
    for (const e of CHANGELOG) {
      expect(e.highlights.length, `${e.version} 无说明`).toBeGreaterThan(0)
      for (const h of e.highlights) expect(h.trim().length, `${e.version} 有空说明`).toBeGreaterThan(0)
    }
  })

  it('版本严格递减：新条目必须插在最前面', () => {
    for (let i = 0; i + 1 < CHANGELOG.length; i++) {
      const [lo] = bounds(CHANGELOG[i].version)
      const [, prevHi] = bounds(CHANGELOG[i + 1].version)
      expect(
        cmp(lo, prevHi),
        `${CHANGELOG[i].version} 应当高于 ${CHANGELOG[i + 1].version}`
      ).toBeGreaterThan(0)
    }
  })

  it('日期不倒流（越靠前不早于后一条）', () => {
    for (let i = 0; i + 1 < CHANGELOG.length; i++) {
      expect(
        CHANGELOG[i].date >= CHANGELOG[i + 1].date,
        `${CHANGELOG[i].version}(${CHANGELOG[i].date}) 早于 ${CHANGELOG[i + 1].version}(${CHANGELOG[i + 1].date})`
      ).toBe(true)
    }
  })

  it('版本号不重复', () => {
    const seen = new Set<string>()
    for (const e of CHANGELOG) {
      expect(seen.has(e.version), `重复版本 ${e.version}`).toBe(false)
      seen.add(e.version)
    }
  })
})

describe('recentChangelog', () => {
  it('默认取最近 8 条', () => {
    expect(recentChangelog()).toHaveLength(Math.min(8, CHANGELOG.length))
  })

  it('limit 为 0 或负数时至少给 1 条，不返回空列表', () => {
    expect(recentChangelog(0)).toHaveLength(1)
    expect(recentChangelog(-5)).toHaveLength(1)
  })

  it('limit 超过总数时不报错', () => {
    expect(recentChangelog(999)).toHaveLength(CHANGELOG.length)
  })

  it('返回可变副本，调用方改它不会污染真源', () => {
    const got = recentChangelog(1)
    got[0].highlights.push('污染')
    expect(CHANGELOG[0].highlights).not.toContain('污染')
  })
})
