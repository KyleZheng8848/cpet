import { describe, expect, it } from 'vitest'
import { parseHookInboxRaw } from '../src/main/hookInbox'

describe('parseHookInboxRaw', () => {
  it('parses clean payload', () => {
    const p = parseHookInboxRaw('{"state":"tool","body":{"tool_name":"Shell"}}')
    expect(p?.state).toBe('tool')
    expect((p?.body as { tool_name?: string })?.tool_name).toBe('Shell')
  })

  it('tolerates trailing extra brace from old printf bug', () => {
    const p = parseHookInboxRaw('{"state":"thinking","body":{"session_id":"x"}}}')
    expect(p?.state).toBe('thinking')
    expect((p?.body as { session_id?: string })?.session_id).toBe('x')
  })

  it('returns null for empty / garbage', () => {
    expect(parseHookInboxRaw('')).toBeNull()
    expect(parseHookInboxRaw('not-json')).toBeNull()
  })
})
