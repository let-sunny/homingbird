import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { composerModel } from '../../src/models/composer.ts'
import { strings } from '../../src/strings.ts'
import { composer } from '../../src/views/composer.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, ROOM, conversation, entry, me, note } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

usingFakeDom()

const setup = (input: Parameters<typeof threadInput>[0] = {}) => {
  const test = testContext()
  test.context.state.session.set(me())
  test.context.state.conversations.set([conversation()])
  let current = threadInput(input)
  const shown = composer(test.context, lifetime(), ROOM, () => composerModel(current), [
    test.context.state.threads,
  ])
  const update = (fields: Parameters<typeof threadInput>[0]) => {
    current = threadInput(fields)
    test.context.state.threads.set(new Map())
    test.context.state.directory.set([])
  }
  return { ...test, shown, update }
}

describe('composer', () => {
  it('sends with Enter, adds a line with Shift+Enter, and sends nothing blank', () => {
    const { shown, called } = setup()
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    fire.key(text, 'Enter')
    expect(called('sendNote')).toHaveLength(0)
    text.value = ' Hello '
    fire.key(text, 'Enter', { shiftKey: true })
    fire.key(text, 'Enter', { isComposing: true })
    fire.key(text, 'a')
    expect(called('sendNote')).toHaveLength(0)
    fire.key(text, 'Enter')
    expect(called('sendNote')[0]!.args).toEqual([ROOM, 'Hello'])
    expect(text.value).toBe('')
    text.value = 'Again'
    fire.submit(shown)
    expect(called('sendNote')).toHaveLength(2)
  })

  it('withdraws a request to the agent, stops replying, and says why the person cannot write', () => {
    const { shown, called, update, context } = setup()
    const question = note('q', { body: 'When?' })
    update({
      thread: { notes: [question], hasMore: false },
      replyTarget: question.id,
      sending: true,
      draftRequests: [
        {
          id: 'dreq_1' as never,
          conversationId: ROOM,
          inReplyTo: null,
          instruction: '',
          agentId: null,
          createdAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          cancelledAt: null,
          draftIds: [],
        },
      ],
      directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben', { canMessage: false })],
    })
    expect(textOf(shown)).toContain(strings.sending)
    expect(textOf(shown)).toContain(strings.noAgentOnline)
    getByRole(shown, 'button', { name: strings.withdraw }).click()
    expect(called('withdrawRequest')[0]!.then!.attempt).toBe('request')
    getByRole(shown, 'button', { name: strings.stopReplying }).click()
    expect(called('chooseReplyTarget')[0]!.args).toEqual([ROOM, null])
    expect(textOf(shown)).toContain(strings.cannotMessage)
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    expect(text.disabled).toBe(true)
    update({})
    context.state.directory.set([entry(BEN, 'Ben')])
    expect(text.disabled).toBe(false)
  })

  it('asks the agent to reply to the note answered, or to write a new one', () => {
    const { shown, called, context } = setup()
    shown.querySelector<HTMLElement>('summary')!.click()
    getByRole(shown, 'button', { name: strings.askAgent }).click()
    expect(called('askAgent')[0]!.args[0]).toMatchObject({ destination: { conversationId: ROOM } })
    context.state.replyTargets.set(new Map([[ROOM, 'q' as never]]))
    getByRole(shown, 'button', { name: strings.askAgent }).click()
    expect(called('askAgent')[1]!.args[0]).toMatchObject({ destination: { inReplyTo: 'q' } })
  })

  it('shows a closed composer in an archived room', () => {
    const { context } = testContext()
    const shown = composer(
      context,
      lifetime(),
      ROOM,
      () => composerModel(threadInput({ conversations: [conversation({ archivedAt: 5 })] })),
      [],
    )
    expect(textOf(shown)).toContain(strings.archivedRoomNotice)
    expect((getByRole(shown, 'button', { name: strings.send }) as HTMLButtonElement).disabled).toBe(true)
  })
})
