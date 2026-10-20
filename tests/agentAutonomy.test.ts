import { describe, expect, it } from 'vitest'
import {
  buildCodexExecArgv,
  codexExecAutonomyArgs,
  codexGlobalAutonomyArgs,
  isCodexResumableSessionId
} from '../src/shared/agentAutonomy'

describe('buildCodexExecArgv', () => {
  it('把 --ask-for-approval 放在 exec 之前', () => {
    const args = buildCodexExecArgv({
      autonomy: 'agent',
      prompt: 'hello'
    })
    const approvalAt = args.indexOf('--ask-for-approval')
    const execAt = args.indexOf('exec')
    expect(approvalAt).toBeGreaterThanOrEqual(0)
    expect(execAt).toBeGreaterThan(approvalAt)
    expect(args[approvalAt + 1]).toBe('never')
    expect(args.slice(execAt)).toContain('--sandbox')
    expect(args.slice(execAt)).toContain('workspace-write')
    expect(args.at(-1)).toBe('hello')
    expect(args).not.toContain('resume')
  })

  it('ask/plan 用 read-only sandbox', () => {
    const args = buildCodexExecArgv({ autonomy: 'ask', prompt: 'x' })
    const execAt = args.indexOf('exec')
    expect(args.slice(execAt)).toContain('read-only')
  })

  it('resume：sandbox/json 在 resume 之前；假 session 不开 resume', () => {
    const uuid = '019fcc8d-93fe-7452-ae34-4bcfd44bf2e0'
    const args = buildCodexExecArgv({
      prefix: ['--codex'],
      sessionId: uuid,
      autonomy: 'agent',
      prompt: 'cont',
      model: 'gpt-5'
    })
    expect(args[0]).toBe('--codex')
    expect(args.indexOf('--ask-for-approval')).toBeLessThan(args.indexOf('exec'))
    const resumeAt = args.indexOf('resume')
    const sandboxAt = args.indexOf('--sandbox')
    const jsonAt = args.indexOf('--json')
    expect(resumeAt).toBeGreaterThan(0)
    expect(sandboxAt).toBeGreaterThan(args.indexOf('exec'))
    expect(sandboxAt).toBeLessThan(resumeAt)
    expect(jsonAt).toBeLessThan(resumeAt)
    expect(args[resumeAt + 1]).toBe(uuid)
    expect(args).toContain('--model')
    expect(args).toContain('gpt-5')

    const junk = buildCodexExecArgv({
      sessionId: 'openai-xxx::custom-api:Hy3',
      autonomy: 'agent',
      prompt: 'hi'
    })
    expect(junk).not.toContain('resume')
    expect(junk).toContain('--sandbox')
  })
})

describe('isCodexResumableSessionId', () => {
  it('只认 UUID', () => {
    expect(isCodexResumableSessionId('019fcc8d-93fe-7452-ae34-4bcfd44bf2e0')).toBe(true)
    expect(isCodexResumableSessionId('openai-c7hobjzatfvsmscymu3l::custom-api:Hy3')).toBe(false)
    expect(isCodexResumableSessionId('sess-1')).toBe(false)
  })
})

describe('codex autonomy split', () => {
  it('global 只有审批；exec 只有 sandbox', () => {
    expect(codexGlobalAutonomyArgs('agent')).toEqual(['--ask-for-approval', 'never'])
    expect(codexExecAutonomyArgs('agent')).toEqual(['--sandbox', 'workspace-write'])
    expect(codexExecAutonomyArgs('plan')).toEqual(['--sandbox', 'read-only'])
  })
})
