import { Task as T, makeTestClock } from '@homingbird/kernel'
import {
  ConversationId,
  NotFound,
  PRINCIPLES_UNAVAILABLE,
  Unavailable,
  answeringFlowInstructions,
} from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { answeringFlowFor } from '../src/answering-flow.ts'

const guidanceWith = async (
  flow: T.Task<{ flow: string | null; updatedAt: number | null }, never> | T.Task<never, unknown>,
  principles: T.Task<unknown, unknown>,
) => {
  const asked: unknown[] = []
  const api = {
    'answeringFlow.get': () => flow,
    'principles.drafting': (request: unknown) => {
      asked.push(request)
      return principles
    },
  } as never
  const exit = await T.run(answeringFlowFor(api, ConversationId.of('conv00000000')), {
    clock: makeTestClock(),
  })
  return { text: exit._tag === 'Ok' ? exit.value : null, asked }
}

describe('answeringFlowFor', () => {
  it('puts the answering flow before the principles of the note’s conversation', async () => {
    const { text, asked } = await guidanceWith(
      T.succeed({ flow: '## Before drafting\n1. Look it up.', updatedAt: 1 }),
      T.succeed({ principles: [], leftOut: 1, ignored: [], ignoredLeftOut: 0 }),
    )
    expect(text?.startsWith(answeringFlowInstructions({ before: ['Look it up.'], checks: [] }))).toBe(true)
    expect(text).toContain('1 more principle was left out')
    expect(asked).toEqual([{ query: { conversationId: 'conv_conv00000000' } }])
  })

  it('says nothing about a switched off feature and says when one could not be fetched', async () => {
    const { text } = await guidanceWith(
      T.fail(NotFound({ message: 'off' })),
      T.fail(Unavailable({ message: 'down' })),
    )
    expect(text).toBe(PRINCIPLES_UNAVAILABLE)
  })

  it('gives a channel’s agent its managers’ teaching between the flow’s steps and its checks', async () => {
    const { text } = await guidanceWith(
      T.succeed({
        flow: '## Before drafting\n1. Look it up.\n## After drafting\n1. Check it.',
        updatedAt: 1,
      }),
      T.succeed({
        principles: [{ kind: 'rule', topic: 'Refunds', rule: 'link the refunds page', source: null }],
        leftOut: 0,
        ignored: [],
        ignoredLeftOut: 0,
        channel: { channel: 'billing', instruction: 'Answer briefly.', sources: [] },
      }),
    )
    expect(text).toContain('What the managers of #billing taught you')
    expect(text).toContain('The managers’ instruction: Answer briefly.')
    expect(text).toContain('before its checks after drafting')
    expect(text?.indexOf('Look it up.')).toBeLessThan(text?.indexOf('- Refunds: link the refunds page') ?? 0)
    expect(text).not.toContain('Your person’s principles')
  })
})
