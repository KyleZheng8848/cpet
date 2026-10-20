import { describe, expect, it } from 'vitest'
import {
  chatterFromWorkMemory,
  engineIdFromModelRef,
  rememberCwd,
  rememberEngineFailure,
  EMPTY_WORK_MEMORY
} from '../src/shared/workMemory'

describe('workMemory', () => {
  it('rememberCwd puts newest first and dedupes', () => {
    let m = rememberCwd(EMPTY_WORK_MEMORY, '/a/proj')
    m = rememberCwd(m, '/b/other')
    m = rememberCwd(m, '/a/proj')
    expect(m.recentCwds).toEqual(['/a/proj', '/b/other'])
  })

  it('chatterFromWorkMemory mentions failure and cwd', () => {
    const m = rememberEngineFailure(
      rememberCwd(EMPTY_WORK_MEMORY, '/Users/me/app'),
      'openclaw',
      'Gateway down'
    )
    const lines = chatterFromWorkMemory(m, Date.now())
    expect(lines.some((x) => /openclaw/.test(x.text))).toBe(true)
    expect(lines.some((x) => /app/.test(x.text))).toBe(true)
  })

  it('engineIdFromModelRef', () => {
    expect(engineIdFromModelRef('openclaw:main')).toBe('openclaw')
    expect(engineIdFromModelRef('cursor')).toBe('cursor')
  })
})
