/**
 * 四个 CLI 引擎「一行原始 stream-json → 该发哪些 AgentEvent」的契约。
 *
 * CHANGELOG 里大量修复都落在这一层（流式重复、终局正文丢失、token 抓不到、
 * 工具事件错位），但此前一个用例都没有。fixture 全部按各 Runner 实际读的字段名构造。
 */
import { describe, it, expect } from 'vitest'
import { RunContext } from '../src/main/agent/runContext'
import type { AgentEvent } from '../src/shared/types'
import { handleCursorLine } from '../src/main/agent/parse/cursorLine'
import { handleCodexLine } from '../src/main/agent/parse/codexLine'
import { handleClaudeLine } from '../src/main/agent/parse/claudeLine'
import { handleOpencodeLine } from '../src/main/agent/parse/opencodeLine'
import type { CursorLineSink } from '../src/main/agent/parse/sink'

interface Harness {
  sink: CursorLineSink
  events: AgentEvent[]
  ctx: RunContext
  /** Runner 侧的收尾动作记录（真 Runner 会顺带杀子进程 / 清 run 表）。 */
  calls: string[]
  keepAlive: number
}

function harness(): Harness {
  const events: AgentEvent[] = []
  const calls: string[] = []
  const ctx = new RunContext({ conversationId: 'c1', runKey: 'k1' }, (e) => events.push(e))
  const h: Harness = {
    events,
    ctx,
    calls,
    keepAlive: 0,
    sink: {
      ctx,
      settleDone: (result) => {
        calls.push(`done:${result ?? ''}`)
        ctx.done(result)
      },
      settleError: (message) => {
        calls.push(`error:${message}`)
        ctx.error(message)
      },
      settleAfterStreamBreak: (detail) => {
        calls.push(`break:${detail}`)
        if (ctx.hasOutput) ctx.done()
        else ctx.error(detail)
      },
      keepAlive: () => {
        h.keepAlive += 1
      }
    }
  }
  return h
}

const texts = (events: AgentEvent[]): string[] =>
  events.filter((e) => e.type === 'assistant-delta').map((e) => (e as { text: string }).text)
const reasons = (events: AgentEvent[]): string[] =>
  events.filter((e) => e.type === 'reasoning-delta').map((e) => (e as { text: string }).text)
const terminal = (events: AgentEvent[]): AgentEvent | undefined =>
  events.find((e) => e.type === 'done' || e.type === 'error' || e.type === 'aborted')

// ---------------------------------------------------------------- cursor-agent

describe('cursor-agent stream-json', () => {
  it('system 行带出 session_id（续聊全靠它）', () => {
    const h = harness()
    handleCursorLine(h.sink, JSON.stringify({ type: 'system', session_id: 'sess-1' }))
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'session', sessionId: 'sess-1' }))
  })

  it('--stream-partial-output 的逐片 assistant 累加成完整正文', () => {
    const h = harness()
    for (const t of ['你', '好', '，世界']) {
      handleCursorLine(
        h.sink,
        JSON.stringify({ type: 'assistant', timestamp_ms: 1, message: { content: [{ text: t }] } })
      )
    }
    expect(texts(h.events)).toEqual(['你', '好', '，世界'])
    expect(h.ctx.lastText).toBe('你好，世界')
  })

  it('带 model_call_id 的非流式回放帧被忽略，避免整段重播', () => {
    const h = harness()
    handleCursorLine(
      h.sink,
      JSON.stringify({ type: 'assistant', model_call_id: 'mc-1', message: { content: [{ text: '整段重播' }] } })
    )
    expect(texts(h.events)).toEqual([])
  })

  it('result 是权威终局正文：流式只发了一半时补齐后缀', () => {
    const h = harness()
    handleCursorLine(
      h.sink,
      JSON.stringify({ type: 'assistant', timestamp_ms: 1, message: { content: [{ text: '答案是' }] } })
    )
    handleCursorLine(h.sink, JSON.stringify({ type: 'result', result: '答案是 42。' }))
    expect(h.ctx.lastText).toBe('答案是 42。')
    expect(texts(h.events)).toEqual(['答案是', ' 42。'])
    expect(terminal(h.events)?.type).toBe('done')
  })

  it('result 带 usage：token 进终态事件', () => {
    const h = harness()
    handleCursorLine(
      h.sink,
      JSON.stringify({
        type: 'result',
        result: 'ok',
        usage: { input_tokens: 120, output_tokens: 30 }
      })
    )
    expect(terminal(h.events)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 }
    })
  })

  it('terminal 系工具走 command 事件并带 exitCode', () => {
    const h = harness()
    handleCursorLine(
      h.sink,
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-1',
        tool_call: {
          terminalToolCall: {
            args: { command: 'ls -la' },
            result: { success: { output: 'README.md', exitCode: 0 } }
          }
        }
      })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: 'command',
        id: 'call-1',
        command: 'ls -la',
        exitCode: 0,
        status: 'done'
      })
    )
  })

  it('读文件类工具走 tool 事件并给中文名', () => {
    const h = harness()
    handleCursorLine(
      h.sink,
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-2',
        tool_call: { readToolCall: { args: { path: 'src/main/index.ts' } } }
      })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        name: '读取文件 · read',
        input: 'src/main/index.ts',
        status: 'running'
      })
    )
  })

  it('运行中的工具会解封口，之后的正文不会被吞', () => {
    const h = harness()
    h.ctx.assistant('先说一句')
    h.ctx.sealContent()
    handleCursorLine(
      h.sink,
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c',
        tool_call: { readToolCall: { args: { path: 'a.ts' } } }
      })
    )
    handleCursorLine(
      h.sink,
      JSON.stringify({ type: 'assistant', timestamp_ms: 2, message: { content: [{ text: '再说一句' }] } })
    )
    expect(h.ctx.lastText).toBe('先说一句再说一句')
  })

  it('WritableIterable 噪声：已有正文时按正常结束收尾，不报错', () => {
    const h = harness()
    handleCursorLine(
      h.sink,
      JSON.stringify({ type: 'assistant', timestamp_ms: 1, message: { content: [{ text: '完整答案' }] } })
    )
    handleCursorLine(
      h.sink,
      JSON.stringify({ type: 'error', message: 'RetriableError: WritableIterable is closed' })
    )
    expect(terminal(h.events)?.type).toBe('done')
  })

  it('半行 JSON 直接忽略，不当正文喷给用户', () => {
    const h = harness()
    handleCursorLine(h.sink, '{"type":"assistant","message":{"cont')
    expect(h.events).toEqual([])
  })
})

// ---------------------------------------------------------------------- codex

describe('codex exec --json', () => {
  it('thread.started 带出 session', () => {
    const h = harness()
    handleCodexLine(h.sink, JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }))
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'session', sessionId: 'th-1' }))
  })

  it('item.updated 是累计快照：只补新增后缀，不整段重贴', () => {
    const h = harness()
    for (const t of ['第一段', '第一段第二段']) {
      handleCodexLine(
        h.sink,
        JSON.stringify({ type: 'item.updated', item: { type: 'agent_message', text: t } })
      )
    }
    expect(texts(h.events)).toEqual(['第一段', '第二段'])
  })

  it('command_execution 映射成 command 并带 exit_code', () => {
    const h = harness()
    handleCodexLine(
      h.sink,
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          id: 'item-9',
          command: 'npm test',
          aggregated_output: 'ok',
          exit_code: 0
        }
      })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: 'command', command: 'npm test', exitCode: 0, status: 'done' })
    )
  })

  it('turn.completed 用 last_agent_message 兜底终局正文并记 token', () => {
    const h = harness()
    handleCodexLine(
      h.sink,
      JSON.stringify({
        type: 'turn.completed',
        last_agent_message: '最终回答',
        usage: { input_tokens: 10, output_tokens: 5 }
      })
    )
    expect(h.ctx.lastText).toBe('最终回答')
    expect(terminal(h.events)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 5 }
    })
  })

  it('reasoning item 走思考通道，不混进正文', () => {
    const h = harness()
    handleCodexLine(
      h.sink,
      JSON.stringify({ type: 'item.started', item: { type: 'reasoning', text: '我想想' } })
    )
    expect(reasons(h.events)).toEqual(['我想想'])
    expect(texts(h.events)).toEqual([])
  })

  it('error 的 message 藏在 error 对象里时也要显示成人话', () => {
    const h = harness()
    handleCodexLine(
      h.sink,
      JSON.stringify({ type: 'error', error: { message: '模型配额不足' } })
    )
    expect(h.calls).toEqual(['error:模型配额不足'])
  })

  it('Reconnecting 传输重试不得掐死对话', () => {
    const h = harness()
    handleCodexLine(
      h.sink,
      JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (request timed out)' })
    )
    handleCodexLine(
      h.sink,
      JSON.stringify({
        type: 'error',
        message: 'Falling back from WebSockets to HTTPS transport. stream disconnected before completion'
      })
    )
    expect(h.calls).toEqual([])
    expect(h.keepAlive).toBeGreaterThanOrEqual(2)
    expect(terminal(h.events)).toBeUndefined()
  })

  it('turn.failed 走错误路径', () => {
    const h = harness()
    handleCodexLine(h.sink, JSON.stringify({ type: 'turn.failed', error: { message: '沙箱拒绝' } }))
    expect(h.calls).toEqual(['error:沙箱拒绝'])
  })
})

// --------------------------------------------------------------- claude code

describe('claude code stream-json', () => {
  it('stream_event 的 text_delta 逐片累加', () => {
    const h = harness()
    for (const t of ['Hel', 'lo']) {
      handleClaudeLine(
        h.sink,
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } }
        })
      )
    }
    expect(h.ctx.lastText).toBe('Hello')
  })

  it('thinking_delta 只进思考通道', () => {
    const h = harness()
    handleClaudeLine(
      h.sink,
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '推理中' } }
      })
    )
    expect(reasons(h.events)).toEqual(['推理中'])
    expect(texts(h.events)).toEqual([])
  })

  it('assistant 全量消息用 snapshot 去重，不会把流式片重贴一遍', () => {
    const h = harness()
    handleClaudeLine(
      h.sink,
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }
      })
    )
    handleClaudeLine(
      h.sink,
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好世界' }] } })
    )
    expect(texts(h.events)).toEqual(['你好', '世界'])
  })

  it('tool_use → 工具事件；tool_result → 完成事件', () => {
    const h = harness()
    handleClaudeLine(
      h.sink,
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'a.ts' } }] }
      })
    )
    handleClaudeLine(
      h.sink,
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: '文件内容' }] }
      })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: 'tool', id: 'tu-1', name: 'Read', status: 'running' })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: 'tool', id: 'tu-1', output: '文件内容', status: 'done' })
    )
  })

  it('result 行的 usage 用 Anthropic 命名，仍能抓到 token', () => {
    const h = harness()
    handleClaudeLine(
      h.sink,
      JSON.stringify({
        type: 'result',
        session_id: 's-9',
        result: '收工',
        usage: { input_tokens: 200, output_tokens: 40 }
      })
    )
    expect(terminal(h.events)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 200, outputTokens: 40, totalTokens: 240 }
    })
  })

  it('is_error 的 result 走错误分支', () => {
    const h = harness()
    handleClaudeLine(h.sink, JSON.stringify({ type: 'result', is_error: true, result: '权限被拒' }))
    expect(h.calls).toEqual(['error:权限被拒'])
  })
})

describe('opencode run --format json', () => {
  it('step_start 带出 session 并进入 thinking', () => {
    const h = harness()
    handleOpencodeLine(
      h.sink,
      JSON.stringify({
        type: 'step_start',
        sessionID: 'ses_abc',
        part: { type: 'step-start' }
      })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: 'session', sessionId: 'ses_abc' })
    )
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'state', state: 'thinking' }))
  })

  it('text 拼进正文', () => {
    const h = harness()
    handleOpencodeLine(
      h.sink,
      JSON.stringify({ type: 'text', sessionID: 'ses_1', part: { type: 'text', text: '你好' } })
    )
    expect(texts(h.events)).toEqual(['你好'])
  })

  it('bash tool_use 走命令通道', () => {
    const h = harness()
    handleOpencodeLine(
      h.sink,
      JSON.stringify({
        type: 'tool_use',
        sessionID: 'ses_1',
        part: {
          callID: 'c1',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'echo hi' },
            output: 'hi\n',
            metadata: { exit: 0 }
          }
        }
      })
    )
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: 'command',
        command: 'echo hi',
        output: 'hi\n',
        exitCode: 0,
        status: 'done'
      })
    )
  })

  it('step_finish stop 收尾；tool-calls 不收尾', () => {
    const mid = harness()
    handleOpencodeLine(
      mid.sink,
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', reason: 'tool-calls', tokens: { input: 1, output: 2 } }
      })
    )
    expect(mid.calls).toEqual([])

    const h = harness()
    handleOpencodeLine(h.sink, JSON.stringify({ type: 'text', part: { text: '完' } }))
    handleOpencodeLine(
      h.sink,
      JSON.stringify({
        type: 'step_finish',
        part: {
          type: 'step-finish',
          reason: 'stop',
          tokens: { input: 10, output: 3 }
        }
      })
    )
    expect(h.calls[0]).toBe('done:完')
    expect(terminal(h.events)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 3 }
    })
  })

  it('error 事件立刻失败', () => {
    const h = harness()
    handleOpencodeLine(
      h.sink,
      JSON.stringify({
        type: 'error',
        error: { name: 'APIError', data: { message: 'Rate limit exceeded' } }
      })
    )
    expect(h.calls).toEqual(['error:Rate limit exceeded'])
  })
})
