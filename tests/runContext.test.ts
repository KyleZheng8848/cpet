/**
 * RunContext 契约：五个引擎的事件全部经它发出，历史 bug 也全在这里
 * （封口后丢正文、result 不回填、工具还在跑就被当完成、重连误收尾）。
 * 这是全项目最该有测试的一层——Runner 可以重写，这份行为不能变。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RunContext, type RunIdentity } from '../src/main/agent/runContext'
import type { AgentEvent } from '../src/shared/types'

const SEAL_GRACE_MS = 1_200

function makeCtx(identity?: Partial<RunIdentity>) {
  const events: AgentEvent[] = []
  const ctx = new RunContext(
    { conversationId: 'c1', runKey: 'k1', ...identity },
    (e) => events.push(e)
  )
  return { ctx, events }
}

const types = (events: AgentEvent[]) => events.map((e) => e.type)
const texts = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'assistant-delta').map((e) => (e as { text: string }).text)

describe('事件打标签', () => {
  it('每个事件都带上 conversationId / modelId / laneId', () => {
    const { ctx, events } = makeCtx({ modelId: 'gpt-5', laneId: 'lane-a' })
    ctx.assistant('你好')
    expect(events.at(-1)).toMatchObject({
      type: 'assistant-delta',
      conversationId: 'c1',
      modelId: 'gpt-5',
      laneId: 'lane-a'
    })
  })

  it('没有 modelId / laneId 时不塞 undefined 字段（对比视图靠它分栏）', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('你好')
    expect(Object.keys(events.at(-1)!)).not.toContain('modelId')
    expect(Object.keys(events.at(-1)!)).not.toContain('laneId')
  })
})

describe('宠物状态', () => {
  it('同一状态不重复发（否则宠物动画会被反复重置）', () => {
    const { ctx, events } = makeCtx()
    ctx.state('thinking')
    ctx.state('thinking')
    ctx.state('talking')
    expect(events.filter((e) => e.type === 'state')).toHaveLength(2)
  })

  it('正文触发 talking，思考触发 thinking', () => {
    const { ctx, events } = makeCtx()
    ctx.reasoning('嗯…')
    ctx.assistant('答案')
    const states = events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)
    expect(states).toEqual(['thinking', 'talking'])
  })
})

describe('正文累积与封口', () => {
  it('delta 逐片累加', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('我')
    ctx.assistant('在想')
    expect(texts(events)).toEqual(['我', '在想'])
    expect(ctx.lastText).toBe('我在想')
  })

  it('重复完整快照 → 封口，之后的正文被忽略（防 CLI 重放整段）', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('完整回答', 'snapshot')
    ctx.assistant('完整回答', 'snapshot')
    expect(ctx.contentSealed).toBe(true)
    expect(ctx.assistant('又来一遍', 'snapshot')).toBe(false)
    expect(texts(events)).toEqual(['完整回答'])
  })

  it('工具开新一轮会解封，允许继续输出正文', () => {
    const { ctx } = makeCtx()
    ctx.assistant('第一段', 'snapshot')
    ctx.sealContent()
    expect(ctx.assistant('第二段')).toBe(false)
    ctx.tool({ name: 'read_file', status: 'running' })
    expect(ctx.contentSealed).toBe(false)
    expect(ctx.assistant('第二段')).toBe(true)
  })
})

describe('ensureFinalText：result 事件兜底回填', () => {
  it('已封口也要把终局正文补进 UI（换机/重连后流式片常被丢）', () => {
    const { ctx, events } = makeCtx()
    ctx.sealContent()
    expect(ctx.assistant('流式片')).toBe(false)
    ctx.ensureFinalText('这是完整答案')
    expect(texts(events)).toEqual(['这是完整答案'])
  })

  it('终局正文以流式正文为前缀 → 只补后缀，不重复整段', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('前半段')
    ctx.ensureFinalText('前半段加后半段')
    expect(texts(events)).toEqual(['前半段', '加后半段'])
    expect(ctx.lastText).toBe('前半段加后半段')
  })

  it('终局与流式完全一致 → 不重发', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('一样的')
    ctx.ensureFinalText('一样的')
    expect(texts(events)).toEqual(['一样的'])
  })

  it('流式几乎没发出去（<8 字）而终局不同 → 用终局整段覆盖', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('嗯')
    ctx.ensureFinalText('其实完整答案是这样的一大段')
    expect(texts(events)).toEqual(['嗯', '其实完整答案是这样的一大段'])
  })

  it('已发出足够长的流式正文而终局对不上且不更长 → 保留流式，不整段重贴', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('这是已经显示给用户的一长段正文')
    const before = texts(events).length
    ctx.ensureFinalText('完全不相干的另一段内容')
    expect(texts(events)).toHaveLength(before)
  })

  it('终局明显更长 → 即使前缀对不上也整段覆盖半截流式', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('文件已写好。')
    ctx.ensureFinalText(
      '文件已写好，并完成校验：项目1 得分 85，项目2 得分 77。完整表格见附件路径。'
    )
    expect(ctx.lastText).toContain('项目1')
    expect(texts(events).some((t) => t.includes('项目1'))).toBe(true)
  })

  it('终局为空不清空已有正文', () => {
    const { ctx } = makeCtx()
    ctx.assistant('已有正文')
    ctx.ensureFinalText('   ')
    expect(ctx.lastText).toBe('已有正文')
  })
})

describe('consumeControlEvent', () => {
  it('usage 事件被吞掉并累计，不当内容解析', () => {
    const { ctx } = makeCtx()
    expect(ctx.consumeControlEvent({ type: 'usage', input_tokens: 10, output_tokens: 5 })).toBe(
      'handled'
    )
    expect(ctx.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it.each(['usage', 'token_usage', 'tokens', 'metering'])('%s 都算用量事件', (type) => {
    const { ctx } = makeCtx()
    expect(ctx.consumeControlEvent({ type, total_tokens: 7 })).toBe('handled')
  })

  it('已有正文且无活跃工具时，reconnecting → 立刻收尾（别等 CLI 空转几分钟）', () => {
    const { ctx } = makeCtx()
    ctx.assistant('答案')
    expect(ctx.consumeControlEvent({ type: 'reconnecting' })).toBe('settle')
  })

  it('工具还在跑时 reconnecting 绝不能收尾（沙箱脚本可能几分钟无正文）', () => {
    const { ctx } = makeCtx()
    ctx.assistant('开始干活')
    ctx.tool({ id: 't1', name: 'run_script', status: 'running' })
    expect(ctx.consumeControlEvent({ type: 'reconnecting' })).toBe('handled')
    expect(ctx.settled).toBe(false)
  })

  it('还没有任何输出时 reconnecting 不收尾（否则用户看到空回复）', () => {
    const { ctx } = makeCtx()
    expect(ctx.consumeControlEvent({ type: 'reconnecting' })).toBe('handled')
  })

  it('reconnected 不算重连事件（认它会误伤正常流）', () => {
    const { ctx } = makeCtx()
    ctx.assistant('答案')
    expect(ctx.consumeControlEvent({ type: 'reconnected' })).toBeNull()
  })

  it('connection/reconnecting 组合也认', () => {
    const { ctx } = makeCtx()
    ctx.assistant('答案')
    expect(ctx.consumeControlEvent({ type: 'connection', subtype: 'reconnecting' })).toBe('settle')
  })

  it('retry 与 reconnecting 同规则', () => {
    const { ctx } = makeCtx()
    ctx.assistant('答案')
    expect(ctx.consumeControlEvent({ type: 'retry' })).toBe('settle')
  })

  it.each([
    ['普通内容事件', { type: 'assistant', text: 'hi' }],
    ['null', null],
    ['字符串', 'oops'],
    ['空对象', {}]
  ])('不是控制事件：%s → null', (_label, input) => {
    const { ctx } = makeCtx()
    expect(ctx.consumeControlEvent(input)).toBeNull()
  })
})

describe('工具与命令', () => {
  it('running 时切 tool 状态并计入活跃工作', () => {
    const { ctx } = makeCtx()
    ctx.tool({ id: 't1', name: 'read_file', status: 'running' })
    expect(ctx.hasActiveWork).toBe(true)
    ctx.tool({ id: 't1', name: 'read_file', status: 'done' })
    expect(ctx.hasActiveWork).toBe(false)
  })

  it('没有 id 时按名字配对，start/end 名字一致就能收掉', () => {
    const { ctx } = makeCtx()
    ctx.command({ command: 'npm test', status: 'running' })
    expect(ctx.hasActiveWork).toBe(true)
    ctx.command({ command: 'npm test', status: 'done', exitCode: 0 })
    expect(ctx.hasActiveWork).toBe(false)
  })

  it('多个工具并行时要全部收完才算空闲', () => {
    const { ctx } = makeCtx()
    ctx.tool({ id: 'a', name: 'x', status: 'running' })
    ctx.tool({ id: 'b', name: 'y', status: 'running' })
    ctx.tool({ id: 'a', name: 'x', status: 'done' })
    expect(ctx.hasActiveWork).toBe(true)
    ctx.tool({ id: 'b', name: 'y', status: 'done' })
    expect(ctx.hasActiveWork).toBe(false)
  })
})

describe('终态', () => {
  it('done 未带 result 时用已有正文回填（0.3.64 修过的坑）', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('流式正文')
    ctx.done()
    expect(events.at(-1)).toMatchObject({ type: 'done', result: '流式正文' })
  })

  it('done 显式带 result 时优先用它', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('流式正文')
    ctx.done('权威终局')
    expect(events.at(-1)).toMatchObject({ result: '权威终局' })
  })

  it('done 一定带耗时，便于用量统计', () => {
    const { ctx, events } = makeCtx()
    ctx.done('x')
    const usage = (events.at(-1) as { usage?: { durationMs?: number } }).usage
    expect(usage?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('CLI 自报的用量不被本地耗时覆盖', () => {
    const { ctx, events } = makeCtx()
    ctx.noteUsage({ inputTokens: 3, durationMs: 9999 })
    ctx.done('x')
    expect((events.at(-1) as { usage: { durationMs: number } }).usage.durationMs).toBe(9999)
  })

  it('done 之后非终态事件被丢弃（防收尾后又冒出正文）', () => {
    const { ctx, events } = makeCtx()
    ctx.done('完')
    const n = events.length
    ctx.assistant('迟到的正文')
    ctx.state('thinking')
    ctx.tool({ name: 'x', status: 'running' })
    expect(events).toHaveLength(n)
  })

  it('done 后再 done / error 不重复发终态', () => {
    const { ctx, events } = makeCtx()
    ctx.done('完')
    ctx.done('又完')
    ctx.error('又错')
    expect(types(events).filter((t) => t === 'done' || t === 'error')).toEqual(['done'])
  })

  it('error 带上已收集的用量', () => {
    const { ctx, events } = makeCtx()
    ctx.noteUsage({ inputTokens: 4 })
    ctx.error('炸了')
    expect(events.at(-1)).toMatchObject({ type: 'error', message: '炸了' })
    expect((events.at(-1) as { usage: { inputTokens: number } }).usage.inputTokens).toBe(4)
  })

  it('取消后必须发 aborted，否则 UI 永远停在「进行中」', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('半截')
    ctx.aborted()
    expect(types(events)).toContain('aborted')
    expect(ctx.aborting).toBe(true)
  })

  it('已 done 后仍允许补发 aborted（渲染进程漏终态时的兜底）', () => {
    const { ctx, events } = makeCtx()
    ctx.done('完')
    ctx.forceAbort()
    expect(types(events)).toEqual(['done', 'aborted'])
  })

  it('取消后不再接受正文', () => {
    const { ctx } = makeCtx()
    ctx.aborted()
    expect(ctx.assistant('还想说话')).toBe(false)
  })
})

describe('封口宽限（CLI 不给 result 时强制收尾）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('正文已齐并封口后，宽限到点自动收尾', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('答案')
    ctx.sealContent()
    expect(types(events)).not.toContain('done')
    vi.advanceTimersByTime(SEAL_GRACE_MS + 10)
    expect(types(events)).toContain('done')
  })

  it('Runner 注册了 settleHook 就走它（杀子进程更干净）', () => {
    const { ctx } = makeCtx()
    const hook = vi.fn()
    ctx.assistant('答案')
    ctx.setSettleHook(hook)
    ctx.sealContent()
    vi.advanceTimersByTime(SEAL_GRACE_MS + 10)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('还没有任何输出时不启动宽限（不能把空回复收尾成完成）', () => {
    const { ctx, events } = makeCtx()
    ctx.sealContent()
    vi.advanceTimersByTime(SEAL_GRACE_MS * 3)
    expect(types(events)).not.toContain('done')
  })

  it('工具还在跑时宽限不生效', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('开始')
    ctx.tool({ id: 't1', name: 'long_task', status: 'running' })
    ctx.sealContent()
    vi.advanceTimersByTime(SEAL_GRACE_MS * 3)
    expect(types(events)).not.toContain('done')
  })

  it('解封会取消宽限，不会在工具跑完后突然收尾', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('答案')
    ctx.sealContent()
    ctx.unsealContent()
    vi.advanceTimersByTime(SEAL_GRACE_MS * 3)
    expect(types(events)).not.toContain('done')
  })

  it('已经 done 之后宽限不再补发第二个 done', () => {
    const { ctx, events } = makeCtx()
    ctx.assistant('答案')
    ctx.sealContent()
    ctx.done()
    vi.advanceTimersByTime(SEAL_GRACE_MS * 3)
    expect(types(events).filter((t) => t === 'done')).toHaveLength(1)
  })
})
