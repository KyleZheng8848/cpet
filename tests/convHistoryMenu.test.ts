import { describe, expect, it } from 'vitest'
import { conversationHasContent } from '../src/shared/conversationContent'
import type { Conversation } from '../src/shared/types'

function base(partial: Partial<Conversation> = {}): Conversation {
  const now = Date.now()
  return {
    id: 'c1',
    title: 't',
    messages: [],
    kind: 'chat',
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

describe('conversationHasContent', () => {
  it('empty chat is empty', () => {
    expect(conversationHasContent(base())).toBe(false)
  })

  it('chat with messages is non-empty', () => {
    expect(
      conversationHasContent(
        base({
          messages: [
            {
              id: 'm1',
              role: 'user',
              blocks: [{ kind: 'text', text: 'hi' }],
              createdAt: Date.now()
            }
          ]
        })
      )
    ).toBe(true)
  })

  it('compare with lane messages is non-empty', () => {
    expect(
      conversationHasContent(
        base({
          kind: 'compare',
          lanes: {
            l1: {
              modelId: 'cursor:auto',
              messages: [
                {
                  id: 'm1',
                  role: 'assistant',
                  blocks: [{ kind: 'text', text: 'a' }],
                  createdAt: Date.now()
                }
              ]
            }
          }
        })
      )
    ).toBe(true)
  })
})
