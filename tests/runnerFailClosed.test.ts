/**
 * 失败必须有终态。
 *
 * spawn 除了异步 'error' 事件，也会同步抛（参数含 NUL、cwd 非法、可执行位丢失等）。
 * 一旦漏掉，run 表里那条记录永远留着：UI 收不到 done/error 会一直显示「生成中」，
 * 再发一次只会得到「该对话还有请求在进行中」，只能重启应用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, SendPromptPayload } from '../src/shared/types'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('spawn EACCES')
  }),
  execFile: vi.fn()
}))

vi.mock('../src/main/cliPath', () => ({
  buildAgentEnvAsync: async () => ({}),
  whichBin: async () => '/usr/bin/does-not-matter',
  clearCliPathCache: () => {},
  refreshAugmentedPath: async () => ''
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0'
  }
}))

vi.mock('../src/main/store', () => ({
  getSettings: () => ({ modelProviders: [] }),
  updateSettings: () => {}
}))

const payload = (): SendPromptPayload => ({
  conversationId: 'c1',
  prompt: '你好',
  cwd: '/tmp'
})

beforeEach(() => {
  vi.clearAllMocks()
})

async function expectSpawnFailureSettles(
  runner: { run(p: SendPromptPayload, emit: (e: AgentEvent) => void): Promise<void>; isBusy: boolean },
  hint: RegExp
): Promise<void> {
  const events: AgentEvent[] = []
  await runner.run(payload(), (e) => events.push(e))
  const last = events.at(-1)
  expect(last?.type).toBe('error')
  // 必须是 spawn 失败本身，而不是「未检测到 CLI」那条前置校验
  expect((last as { message: string }).message).toMatch(hint)
  expect(runner.isBusy).toBe(false)
}

describe('spawn 同步抛异常时', () => {
  it('Codex：发出 error 终态且不再 busy', async () => {
    const { CodexRunner } = await import('../src/main/codexAgent')
    await expectSpawnFailureSettles(new CodexRunner(), /EACCES/)
  })

  it('Claude Code：发出 error 终态且不再 busy', async () => {
    const { ClaudeCodeRunner } = await import('../src/main/claudeCodeAgent')
    await expectSpawnFailureSettles(new ClaudeCodeRunner(), /EACCES/)
  })



  it('OpenCode：发出 error 终态且不再 busy', async () => {
    const { OpencodeRunner } = await import('../src/main/opencodeAgent')
    await expectSpawnFailureSettles(new OpencodeRunner(), /EACCES/)
  })

  // cursor-agent 是最常用的引擎。bin 解析走构造参数注入，否则这条只能靠本机装没装 CLI 碰运气。
  it('Cursor：发出 error 终态且不再 busy', async () => {
    const { AgentRunner } = await import('../src/main/cursorAgent')
    const runner = new AgentRunner(async () => ({
      binPath: '/usr/bin/does-not-matter',
      installed: true
    }))
    await expectSpawnFailureSettles(runner, /EACCES/)
  })
})
