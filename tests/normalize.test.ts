/**
 * 流式文本归一化契约。
 *
 * 这是全项目最容易静默出错的地方：五个引擎里有的推「真增量」，有的每帧推「累计快照」，
 * 判断错的后果是用户看到重复整段、或者中文被吞字。CHANGELOG 0.3.68–0.3.72 就是这类问题。
 * 重构 Runner 时这份用例必须仍然全绿。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveTextPiece,
  sliceCumulativeDelta,
  SMALL_DELTA_MAX
} from '../src/main/agent/normalize'

describe('sliceCumulativeDelta（自动判别增量/快照）', () => {
  it('累计快照：只取新增后缀，不重复已显示的正文', () => {
    expect(sliceCumulativeDelta('你好', '你好世界')).toEqual({
      delta: '世界',
      accumulated: '你好世界'
    })
  })

  it('首帧：prev 为空时整包都是新增', () => {
    expect(sliceCumulativeDelta('', '你')).toEqual({ delta: '你', accumulated: '你' })
  })

  it('完全重复的帧被丢弃，不会把同一段贴两次', () => {
    expect(sliceCumulativeDelta('你好世界', '你好世界')).toBeNull()
  })

  it('空帧被丢弃', () => {
    expect(sliceCumulativeDelta('你好', '')).toBeNull()
  })

  it('快照实质缩水（引擎回退到更短的累计值）→ 丢弃，避免正文被截短', () => {
    // incoming 是 prev 的前缀且足够长，判定为「同一快照的旧版本」
    expect(sliceCumulativeDelta('你好世界啊哈哈哈', '你好世界啊哈')).toBeNull()
  })

  it('短片碰巧等于已有正文开头 → 必须当真增量拼接，否则会吞字', () => {
    // 这是 normalize.ts 里特意写了注释的坑：中文单字 token 常与文首重合
    expect(sliceCumulativeDelta('你好世界啊哈哈哈', '你')).toEqual({
      delta: '你',
      accumulated: '你好世界啊哈哈哈你'
    })
  })

  it('prev 出现在 incoming 中间（引擎带了前缀说明）→ 只取 prev 之后的部分', () => {
    expect(sliceCumulativeDelta('hello', 'assistant: hello world')).toEqual({
      delta: ' world',
      accumulated: 'hello world'
    })
  })

  it(`非前缀且长度超过 ${SMALL_DELTA_MAX} → 丢弃，防止整包重贴循环`, () => {
    const big = 'x'.repeat(SMALL_DELTA_MAX + 1)
    expect(sliceCumulativeDelta('abcd', big)).toBeNull()
  })

  it('非前缀但很短 → 当作真增量拼接', () => {
    expect(sliceCumulativeDelta('abcd', 'ef')).toEqual({ delta: 'ef', accumulated: 'abcdef' })
  })
})

describe('resolveTextPiece(mode)', () => {
  it('snapshot：只补后缀', () => {
    expect(resolveTextPiece('hello', 'hello world', 'snapshot')).toEqual({
      delta: ' world',
      accumulated: 'hello world'
    })
  })

  it('snapshot：无法对齐的快照直接丢弃（宁可少显示，也不贴错）', () => {
    expect(resolveTextPiece('hello', 'totally different', 'snapshot')).toBeNull()
  })

  it('replace：只有在还没有正文时才接受整包覆盖', () => {
    expect(resolveTextPiece('', 'full text', 'replace')).toEqual({
      delta: 'full text',
      accumulated: 'full text'
    })
    expect(resolveTextPiece('abc', 'xyz', 'replace')).toBeNull()
  })

  it('replace：整包包含已有正文时退化为 snapshot 续写', () => {
    expect(resolveTextPiece('abc', 'abcdef', 'replace')).toEqual({
      delta: 'def',
      accumulated: 'abcdef'
    })
  })

  it('delta：走自动判别', () => {
    expect(resolveTextPiece('你好', '你好世界', 'delta')).toEqual({
      delta: '世界',
      accumulated: '你好世界'
    })
  })

  it('三种模式都忽略空 incoming 与完全重复帧', () => {
    for (const mode of ['delta', 'snapshot', 'replace'] as const) {
      expect(resolveTextPiece('abc', '', mode)).toBeNull()
      expect(resolveTextPiece('abc', 'abc', mode)).toBeNull()
    }
  })
})

describe('模拟整段流式会话', () => {
  it('累计快照流：逐帧拼出的结果等于最后一帧', () => {
    const frames = ['我', '我在', '我在想', '我在想一个', '我在想一个办法']
    let acc = ''
    const seen: string[] = []
    for (const f of frames) {
      const r = resolveTextPiece(acc, f, 'snapshot')
      if (!r) continue
      seen.push(r.delta)
      acc = r.accumulated
    }
    expect(acc).toBe('我在想一个办法')
    expect(seen.join('')).toBe('我在想一个办法')
  })

  it('真增量流：不会因为某片等于文首而丢字', () => {
    const deltas = ['我', '在', '想', '我', '想']
    let acc = ''
    for (const d of deltas) {
      const r = resolveTextPiece(acc, d, 'delta')
      if (r) acc = r.accumulated
    }
    expect(acc).toBe('我在想我想')
  })
})
