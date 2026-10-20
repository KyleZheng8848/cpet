/**
 * 用量抽取契约：五个引擎的字段命名各不相同（OpenAI / Anthropic / camelCase / 嵌套 token_usage）。
 * 这里锁住每种命名都能被认出来——上游改字段时应当是这份用例先红，而不是用户先看到「0 token」。
 */
import { describe, it, expect } from 'vitest'
import { extractRunUsage, mergeRunUsage } from '../src/main/agent/usage'
import { formatRunUsage, formatRunUsageTitle } from '../src/shared/runUsage'

describe('extractRunUsage：各家字段命名', () => {
  it('OpenAI 风格 usage.prompt_tokens / completion_tokens', () => {
    expect(extractRunUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    })
  })

  it('Anthropic 风格 usage.input_tokens / output_tokens', () => {
    expect(extractRunUsage({ usage: { input_tokens: 7, output_tokens: 3 } })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10
    })
  })

  it('camelCase 且平铺在根上', () => {
    expect(extractRunUsage({ inputTokens: 1, outputTokens: 2 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3
    })
  })

  it('嵌套在 token_usage 下', () => {
    expect(extractRunUsage({ token_usage: { input_tokens: 4, output_tokens: 6 } })).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10
    })
  })

  it('嵌套在 tokens 下', () => {
    expect(extractRunUsage({ tokens: { prompt_tokens: 2, completion_tokens: 2 } })).toEqual({
      inputTokens: 2,
      outputTokens: 2,
      totalTokens: 4
    })
  })

  it('只给 total_tokens 时不臆造进出明细', () => {
    expect(extractRunUsage({ usage: { total_tokens: 99 } })).toEqual({ totalTokens: 99 })
  })

  it('显式 total 优先于自行相加', () => {
    expect(
      extractRunUsage({ usage: { input_tokens: 1, output_tokens: 1, total_tokens: 100 } })
    ).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 100 })
  })

  it('抽出 OpenAI prompt_tokens_details.cached_tokens，避免 95 万缓存扮成新输入', () => {
    expect(
      extractRunUsage({
        usage: {
          prompt_tokens: 957861,
          completion_tokens: 1228,
          prompt_tokens_details: { cached_tokens: 955266 }
        }
      })
    ).toEqual({
      inputTokens: 957861,
      outputTokens: 1228,
      totalTokens: 959089,
      cacheReadTokens: 955266
    })
  })

  it('抽出 Anthropic/后台引擎 的缓存命中，避免把 95 万缓存当成新输入', () => {
    expect(
      extractRunUsage({
        token_usage: {
          input_tokens: 957861,
          output_tokens: 1228,
          cache_read_tokens: 955266,
          cache_write_tokens: 2205
        }
      })
    ).toEqual({
      inputTokens: 957861,
      outputTokens: 1228,
      totalTokens: 959089,
      cacheReadTokens: 955266,
      cacheWriteTokens: 2205
    })
  })

  it('字符串数字也认（有的 CLI 用字符串输出）', () => {
    expect(extractRunUsage({ usage: { input_tokens: '12', output_tokens: '8' } })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    })
  })
})

describe('extractRunUsage：脏输入不得抛异常', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['空对象', {}],
    ['字符串', 'oops'],
    ['数字', 42],
    ['无关字段', { model: 'gpt', ok: true }],
    ['负数被拒', { usage: { input_tokens: -5 } }],
    ['NaN 被拒', { usage: { input_tokens: Number.NaN } }],
    ['非数字字符串被拒', { usage: { input_tokens: 'abc' } }]
  ])('%s → undefined', (_label, input) => {
    expect(extractRunUsage(input)).toBeUndefined()
  })
})

describe('extractRunUsage：耗时字段', () => {
  it('毫秒字段原样保留', () => {
    expect(extractRunUsage({ duration_ms: 1500 })?.durationMs).toBe(1500)
  })

  it('小数秒（如 2.5s）换算成毫秒', () => {
    expect(extractRunUsage({ duration: 2.5 })?.durationMs).toBe(2500)
  })

  it('耗时为 0 时不写入该字段（0 不是有效耗时）', () => {
    expect(extractRunUsage({ duration_ms: 0 })).toBeUndefined()
  })

  it('elapsed_ms 别名同样识别', () => {
    expect(extractRunUsage({ elapsed_ms: 800 })?.durationMs).toBe(800)
  })
})

describe('mergeRunUsage：多次 usage 事件合并', () => {
  it('patch 为空时原样返回', () => {
    const base = { inputTokens: 1 }
    expect(mergeRunUsage(base, undefined)).toEqual(base)
  })

  it('patch 覆盖同名字段', () => {
    expect(mergeRunUsage({ inputTokens: 1 }, { inputTokens: 9 })).toEqual({ inputTokens: 9 })
  })

  it('patch 里的 null/undefined 不得擦掉已有数值', () => {
    expect(
      mergeRunUsage({ inputTokens: 5, totalTokens: 5 }, {
        inputTokens: undefined,
        outputTokens: 3
      } as never)
    ).toEqual({ inputTokens: 5, totalTokens: 5, outputTokens: 3 })
  })
})

describe('formatRunUsage：缓存不能扮成新输入', () => {
  it('几乎全是缓存时写成「新 + 缓存」，不写 958k→1.2k', () => {
    expect(
      formatRunUsage({
        durationMs: 40_000,
        inputTokens: 957861,
        outputTokens: 1228,
        cacheReadTokens: 955266
      })
    ).toBe('40s · 2.6k 新（955k 缓存）→1.2k')
    expect(
      formatRunUsageTitle({
        inputTokens: 957861,
        outputTokens: 1228,
        cacheReadTokens: 955266
      })
    ).toContain('不是这一句的字数')
  })

  it('没有缓存字段时仍用进出箭头', () => {
    expect(formatRunUsage({ inputTokens: 120, outputTokens: 30 })).toBe('120→30 tok')
  })
})
