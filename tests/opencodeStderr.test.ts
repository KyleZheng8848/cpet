import { describe, expect, it } from 'vitest'
import { extractOpencodeFatalError } from '../src/main/agent/parse/opencodeStderr'

describe('extractOpencodeFatalError', () => {
  it('parses AI_APICallError', () => {
    const msg = extractOpencodeFatalError(
      'INFO  stream\nERROR AI_APICallError: Cannot connect to API: fetch failed\n'
    )
    expect(msg).toMatch(/调用模型失败/)
    expect(msg).toMatch(/Cannot connect to API/)
  })

  it('parses cannot connect', () => {
    expect(extractOpencodeFatalError('Cannot connect to API')).toMatch(/连不上自定义 API/)
  })

  it('parses unauthorized', () => {
    expect(extractOpencodeFatalError('Unauthorized 401 invalid api key')).toMatch(/API Key/)
  })

  it('ignores empty / noise', () => {
    expect(extractOpencodeFatalError('')).toBeUndefined()
    expect(extractOpencodeFatalError('INFO starting session')).toBeUndefined()
  })
})
