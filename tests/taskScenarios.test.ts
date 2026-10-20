import { describe, expect, it } from 'vitest'
import {
  applyTaskScenario,
  autonomyShortLabel,
  BUILTIN_TASK_SCENARIOS,
  groupTaskScenarios,
  pickCompareModelRefs
} from '../src/shared/taskScenarios'
import type { Conversation } from '../src/shared/types'

function blankChat(): Conversation {
  const now = Date.now()
  return {
    id: 'c1',
    title: '新对话',
    messages: [],
    kind: 'chat',
    createdAt: now,
    updatedAt: now
  }
}

describe('taskScenarios', () => {
  it('pickCompareModelRefs pads by cycling', () => {
    expect(pickCompareModelRefs(['a', 'b'], 3)).toEqual(['a', 'b', 'a'])
    expect(pickCompareModelRefs(['only'], 2)).toEqual(['only', 'only'])
    expect(pickCompareModelRefs([], 2)).toEqual([])
  })

  it('chat templates only — not fake new kinds', () => {
    expect(BUILTIN_TASK_SCENARIOS.every((s) => s.kind === 'chat')).toBe(true)
    const groups = groupTaskScenarios()
    expect(groups.map((g) => g.group)).toEqual(['ship', 'think', 'blank'])
  })

  it('applyTaskScenario keeps chat kind', () => {
    const impl = BUILTIN_TASK_SCENARIOS.find((s) => s.id === 'scene-implement')!
    const c = applyTaskScenario(blankChat(), impl)
    expect(c.kind).toBe('chat')
    expect(c.agentAutonomy).toBe('agent')
  })

  it('includes skin factory as first ship template', () => {
    const skin = BUILTIN_TASK_SCENARIOS.find((s) => s.id === 'scene-skin')
    expect(skin).toBeTruthy()
    expect(skin!.name).toBe('皮肤生成')
    expect(groupTaskScenarios().find((g) => g.group === 'ship')?.items[0]?.id).toBe(
      'scene-skin'
    )
  })

  it('autonomyShortLabel', () => {
    expect(autonomyShortLabel('agent')).toBe('代理')
    expect(autonomyShortLabel('plan')).toBe('计划')
  })
})
