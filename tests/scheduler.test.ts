/**
 * 定时器编排：同一个任务只能在到点时跑一次。
 *
 * 覆盖的真实故障：
 * - 远期一次性任务在第 24.8 天（setTimeout 上限）被提前执行；
 * - 对话忙时排队的任务，等空闲后连着跑两次；
 * - 点「立即运行」后原定时器脱管，到点又跑一次；
 * - 关机/休眠错过的每日任务补跑成一串。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HEARTBEAT_INTERVAL_MS } from '../src/main/scheduleTime'
import type { ScheduledTask, SendPromptPayload } from '../src/shared/types'

const h = vi.hoisted(() => ({ state: { schedules: [] as ScheduledTask[] } }))

vi.mock('electron', () => ({
  Notification: { isSupported: () => false }
}))

vi.mock('../src/main/store', () => ({
  getSchedules: () => h.state.schedules,
  saveSchedules: (tasks: ScheduledTask[]) => {
    h.state.schedules = tasks
  },
  upsertSchedule: (task: ScheduledTask) => {
    const i = h.state.schedules.findIndex((t) => t.id === task.id)
    if (i >= 0) h.state.schedules[i] = task
    else h.state.schedules.push(task)
    return task
  },
  getSettings: () => ({ skin: 'violet', cwd: '/tmp/cpet-proj', defaultModelRef: 'cursor:auto' }),
  getChatStore: () => ({
    conversations: [
      {
        id: 'conv1',
        title: '对话',
        messages: [],
        cwd: '/tmp/cpet-proj',
        createdAt: 0,
        updatedAt: 0
      }
    ],
    activeId: 'conv1'
  }),
  saveChatStore: () => {}
}))

// 定时任务的技能解析要对着「本机真实存在的技能」判定，测试里固定这份清单
vi.mock('../src/main/skills', () => ({
  listAgentSkills: () => [
    { id: 'daily-report', name: 'daily-report', source: 'user', hasBody: true },
    { id: 'shell', name: 'shell', source: 'builtin', hasBody: true }
  ]
}))

const T0 = new Date('2026-07-28T12:00:00-04:00').getTime()
const DAY = 86_400_000
const HOUR = 3_600_000
/**
 * 当地时间 23:00：此时「每天 9:00」的下次运行正好是 10 小时后。
 * 必须按本地时区构造（daily 用的是 setHours），写死 UTC 偏移会让断言随运行环境时区漂移。
 */
const NIGHT = new Date(2026, 6, 28, 23, 0, 0, 0).getTime()

function task(patch: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'x',
    name: '任务',
    prompt: '干活',
    kind: 'interval',
    intervalMinutes: 60,
    enabled: true,
    conversationId: 'conv1',
    createdAt: T0,
    updatedAt: T0,
    ...patch
  }
}

/** runMs > 0 时模拟真实 agent：执行期间占住对话（isBusyFor 为真），跨过若干次心跳。 */
function makeRunner(runMs = 0): {
  runner: import('../src/main/scheduler').PromptRunner
  runs: SendPromptPayload[]
  busy: Set<string>
} {
  const runs: SendPromptPayload[] = []
  const busy = new Set<string>()
  return {
    runs,
    busy,
    runner: {
      get isBusy() {
        return busy.size > 0
      },
      isBusyFor: (id: string) => busy.has(id),
      run: async (payload) => {
        runs.push(payload)
        if (runMs <= 0) return
        busy.add(payload.conversationId!)
        await new Promise<void>((resolve) => setTimeout(resolve, runMs))
        busy.delete(payload.conversationId!)
      },
      cancel: () => {}
    }
  }
}

async function makeScheduler(runMs = 0): Promise<{
  scheduler: import('../src/main/scheduler').TaskScheduler
  runs: SendPromptPayload[]
  busy: Set<string>
}> {
  const { TaskScheduler } = await import('../src/main/scheduler')
  const { runner, runs, busy } = makeRunner(runMs)
  const scheduler = new TaskScheduler(
    runner,
    () => {},
    () => {},
    () => {}
  )
  return { scheduler, runs, busy }
}

const stored = (id: string): ScheduledTask | undefined => h.state.schedules.find((t) => t.id === id)

beforeEach(() => {
  h.state.schedules = []
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('远期任务', () => {
  it('60 天后的一次性任务不会在第 25 天被提前执行', { timeout: 15_000 }, async () => {
    h.state.schedules = [task({ kind: 'once', intervalMinutes: undefined, runAt: T0 + 60 * DAY })]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()

    // setTimeout 上限是 24.8 天，定时器会在那时醒一次
    // Run the minute heartbeats synchronously; only flush async work at assertions.
    // Awaiting every minute over 61 days makes this test time out under parallel load.
    vi.advanceTimersByTime(30 * DAY)
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toHaveLength(0)

    vi.advanceTimersByTime(31 * DAY)
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })
})

describe('对话忙时的排队', () => {
  it('延后的任务在对话空闲后只跑一次', async () => {
    h.state.schedules = [task({ nextRunAt: T0 + 60_000 })]
    const { scheduler, runs, busy } = await makeScheduler()
    busy.add('conv1')
    scheduler.start()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runs).toHaveLength(0)

    busy.delete('conv1')
    // 忙时的重试间隔是 15s
    await vi.advanceTimersByTimeAsync(15_000)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })
})

describe('立即运行', () => {
  it('手动跑过之后，原定时器不会再补一次', async () => {
    h.state.schedules = [task({ nextRunAt: T0 + 3_600_000 })]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()

    await vi.advanceTimersByTimeAsync(60_000)
    await scheduler.runNow('x')
    expect(runs).toHaveLength(1)

    // 越过原计划时刻（T0+60min），但还没到手动执行后重排的时刻
    await vi.advanceTimersByTimeAsync(3_560_000)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })

  // 一个任务同时挂两个定时器 = 到点时 onDue 被调两次；只要 agent 跑得比第二次唤醒慢，
  // 第二次就会看到还没被推进的 nextRunAt 而重复执行。所以「每个任务至多一个定时器」是硬约束。
  it('排队任务被顺带执行后，不会给同一个任务留下第二个定时器', async () => {
    h.state.schedules = [
      task({ id: 'a', nextRunAt: T0 + 60_000 }),
      task({ id: 'b', prompt: 'B 的活', nextRunAt: T0 + 70_000 })
    ]
    const { scheduler, runs, busy } = await makeScheduler()

    busy.add('conv1')
    scheduler.start()
    // 两个任务都到点但对话忙：各自排队并挂上 15s 重试
    await vi.advanceTimersByTimeAsync(70_000)
    expect(runs).toHaveLength(0)
    // a、b 各一个重试定时器，外加一个墙钟心跳
    expect(vi.getTimerCount()).toBe(3)

    busy.delete('conv1')
    // a 的重试到点，执行完顺手 drain 出 b —— 此时 b 的重试定时器仍待触发
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runs).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(3)
    scheduler.stop()
  })
})

describe('错过的触发', () => {
  it('关机 3 天后启动，每日任务只补跑一次并重排到未来', async () => {
    h.state.schedules = [
      task({ kind: 'daily', intervalMinutes: undefined, hour: 9, minute: 0, nextRunAt: T0 - 3 * DAY })
    ]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(runs).toHaveLength(1)
    expect(stored('x')?.nextRunAt).toBeGreaterThan(T0)

    // 再等一小时也不该出现补跑串
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })
})

describe('保存与启停', () => {
  it('保存一个时间已过的一次性任务：直接落成停用，而不是「已启用但永不运行」', async () => {
    const { scheduler } = await makeScheduler()
    const saved = scheduler.save(
      task({ id: 'past', kind: 'once', intervalMinutes: undefined, runAt: T0 - 1 })
    )
    expect(saved.enabled).toBe(false)
    expect(saved.nextRunAt).toBeUndefined()
    scheduler.stop()
  })

  it('重复保存同一个任务不会累积出多个定时器', async () => {
    const { scheduler, runs } = await makeScheduler()
    const t = task({ intervalMinutes: 1 })
    scheduler.save(t)
    scheduler.save(t)
    scheduler.save(t)

    await vi.advanceTimersByTimeAsync(61_000)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })
})

/**
 * 休眠场景的模拟方式：vi.setSystemTime 只把墙钟（Date.now）往前拨，同时把待触发定时器的到点时刻
 * 整体后移同样的量 —— 也就是定时器保持原有的剩余时长。这正是 macOS 合盖时的表现：
 * setTimeout 走单调时钟，休眠期间不计时。所以不能用 advanceTimersByTime 来「跳过」休眠，
 * 那样定时器会照常触发，等于绕开了要验证的行为。
 */
function dailyAt9(): ScheduledTask {
  return task({ kind: 'daily', intervalMinutes: undefined, hour: 9, minute: 0 })
}

/**
 * 定时任务没有技能选单，只能从 prompt 开头认 `/技能名`；认出来的要进 payload.skills，
 * 否则除 Cursor 之外的引擎拿不到 SKILL.md 正文（技能静默失效的老毛病）。
 */
describe('定时任务的技能', () => {
  async function runOnce(patch: Partial<ScheduledTask>): Promise<SendPromptPayload> {
    h.state.schedules = [task(patch)]
    const { scheduler, runs } = await makeScheduler()
    await scheduler.runNow('x')
    scheduler.stop()
    expect(runs).toHaveLength(1)
    return runs[0]
  }

  it('prompt 开头的斜杠词进 payload.skills，prompt 本身原样发出', async () => {
    const payload = await runOnce({ prompt: '/daily-report 汇总今天的进展' })
    expect(payload.skills).toEqual(['daily-report'])
    expect(payload.prompt).toBe('/daily-report 汇总今天的进展')
  })

  it('显式 skills 字段优先于 prompt 解析', async () => {
    const payload = await runOnce({ prompt: '/daily-report 汇总', skills: ['shell'] })
    expect(payload.skills).toEqual(['shell'])
  })

  it('prompt 以绝对路径开头时不会被误判成技能', async () => {
    const payload = await runOnce({ prompt: '/Users/example/notes.md 里的待办帮我做掉' })
    expect(payload.skills).toBeUndefined()
  })

  it('未知斜杠词和普通 prompt 都不带 skills', async () => {
    expect((await runOnce({ prompt: '/no-such-skill 干活' })).skills).toBeUndefined()
    expect((await runOnce({ prompt: '干活' })).skills).toBeUndefined()
  })

  it('payload 带上对话的 threadId，后台引擎 才不会跨轮复用 daemon session', async () => {
    const payload = await runOnce({ prompt: '干活' })
    expect(payload.threadId).toBeTruthy()
    expect(payload.conversationId).toBe('conv1')
  })
})

describe('休眠唤醒后的墙钟兜底', () => {
  it('23:00 合盖、次日 10:00 唤醒：心跳一拍内补跑，不用等原定时器', async () => {
    vi.setSystemTime(NIGHT)
    h.state.schedules = [dailyAt9()]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()
    // 定时器按 10 小时后挂上
    expect(stored('x')?.nextRunAt).toBe(NIGHT + 10 * HOUR)

    // 休眠 11 小时：墙钟到次日 10:00（已过 9:00），但定时器仍剩满 10 小时
    vi.setSystemTime(NIGHT + 11 * HOUR)
    expect(runs).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })

  it('唤醒后立刻 sweepDue（powerMonitor resume 的路径）不必等心跳', async () => {
    vi.setSystemTime(NIGHT)
    h.state.schedules = [dailyAt9()]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()

    vi.setSystemTime(NIGHT + 11 * HOUR)
    await scheduler.sweepDue()
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })

  it('睡了 3 天的每日任务，唤醒后只跑 1 次而不是补 3 次', async () => {
    vi.setSystemTime(NIGHT)
    h.state.schedules = [dailyAt9()]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()

    vi.setSystemTime(NIGHT + 3 * DAY + 11 * HOUR)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(runs).toHaveLength(1)
    // 下次应排到未来，之后的心跳不该再补出第二次
    expect(stored('x')?.nextRunAt).toBeGreaterThan(Date.now())
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })

  it('setTimeout 与心跳同时指向同一任务时只执行一次', async () => {
    // nextRunAt 正好落在心跳节拍上：任务自己的定时器和心跳在同一刻都认为它该跑
    h.state.schedules = [task({ nextRunAt: T0 + HEARTBEAT_INTERVAL_MS })]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })

  it('执行耗时跨过多次心跳时，任务不会被重复触发', async () => {
    // 真实 agent 会跑几分钟。这段时间里 nextRunAt 还没推进，心跳每 30s 都会重新看到「已到点」；
    // 一旦被排进 queue，本次跑完 drain 就会立刻再跑一遍。
    h.state.schedules = [task({ nextRunAt: T0 + 1_000 })]
    const { scheduler, runs } = await makeScheduler(5 * HEARTBEAT_INTERVAL_MS)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(runs).toHaveLength(1)

    // 执行期间跨过 5 次心跳，再多等一会儿让 drain 有机会发作
    await vi.advanceTimersByTimeAsync(10 * HEARTBEAT_INTERVAL_MS)
    expect(runs).toHaveLength(1)
    scheduler.stop()
  })

  it('stop() 之后心跳不再触发', async () => {
    vi.setSystemTime(NIGHT)
    h.state.schedules = [dailyAt9()]
    const { scheduler, runs } = await makeScheduler()
    scheduler.start()
    scheduler.stop()
    // 心跳定时器必须一起清掉，否则退出后仍在唤醒主进程
    expect(vi.getTimerCount()).toBe(0)

    vi.setSystemTime(NIGHT + 11 * HOUR)
    await vi.advanceTimersByTimeAsync(10 * HEARTBEAT_INTERVAL_MS)
    expect(runs).toHaveLength(0)
  })
})
