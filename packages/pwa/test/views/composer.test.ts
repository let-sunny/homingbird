import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { composerModel } from '../../src/models/composer.ts'
import { strings } from '../../src/strings.ts'
import { composer } from '../../src/views/composer.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  entry,
  me,
  member,
  note,
  serverInfo,
} from '../support/fixtures.ts'
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
  it('says in a channel who answers, and marks a warning when nobody can now', () => {
    const room = conversation({ kind: 'channel', title: 'billing' })
    const { shown, update } = setup({
      conversations: [room],
      channels: [channel('billing', { conversationId: ROOM, helperCount: 2 })],
    })
    expect(textOf(shown.querySelector('.channel-answers')!)).toBe(
      strings.channelAnswer.peopleAnswer({ count: 2 }),
    )
    expect(shown.querySelector('.channel-answers.no-agent')).toBeNull()
    update({
      conversations: [room],
      channels: [channel('billing', { conversationId: ROOM, helperCount: 0 })],
    })
    expect(textOf(shown.querySelector('.channel-answers.no-agent')!)).toBe(
      strings.channelAnswer.nobodyAnswers,
    )
  })

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

  it('brings the thread back to the bottom once a note is sent, and asks the keyboard for Send', () => {
    const test = testContext()
    test.context.state.conversations.set([conversation()])
    let sent = 0
    const shown = composer(
      test.context,
      lifetime(),
      ROOM,
      () => composerModel(threadInput()),
      [],
      () => void sent++,
    )
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    expect(text.getAttribute('enterkeyhint')).toBe('send')
    fire.key(text, 'Enter')
    expect(sent).toBe(0)
    text.value = 'Hello'
    fire.key(text, 'Enter')
    expect(sent).toBe(1)
  })

  it('on a touch screen adds a line with the return key and sends only with Send', () => {
    const test = testContext()
    test.page.state.coarsePointer = true
    test.context.state.conversations.set([conversation()])
    const shown = composer(test.context, lifetime(), ROOM, () => composerModel(threadInput()), [])
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    expect(text.getAttribute('enterkeyhint')).toBe('enter')
    text.value = 'Two\nlines'
    fire.key(text, 'Enter')
    expect(test.called('sendNote')).toHaveLength(0)
    fire.submit(shown)
    expect(test.called('sendNote')[0]!.args).toEqual([ROOM, 'Two\nlines'])
  })

  it('stops replying to a note with Escape, and leaves Escape alone when it replies to none', () => {
    const { context, shown, called } = setup()
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    fire.key(text, 'Escape')
    expect(called('chooseReplyTarget')).toHaveLength(0)
    context.state.replyTargets.set(new Map([[ROOM, 'n1' as never]]))
    fire.key(text, 'Escape', { isComposing: true })
    expect(called('chooseReplyTarget')).toHaveLength(0)
    fire.key(text, 'Escape')
    expect(called('chooseReplyTarget')[0]!.args).toEqual([ROOM, null])
  })

  it('looks up earlier answers to what is typed, and stops once the note is sent', () => {
    const { shown, called } = setup()
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    fire.type(text, 'Where is the release calendar kept?')
    expect(called('findEarlierAnswers')[0]!.args.slice(0, 2)).toEqual([
      'Where is the release calendar kept?',
      ROOM,
    ])
    called('findEarlierAnswers')[0]!.then!.done!([
      {
        question: note('q1', { body: 'Release calendar?' }),
        answer: note('a1', { body: 'In Drive.' }),
        channel: null,
      },
    ])
    expect(textOf(shown)).toContain(strings.answeredBefore.title)
    fire.key(text, 'Enter')
    expect(called('sendNote')[0]!.args).toEqual([ROOM, 'Where is the release calendar kept?'])
    expect(textOf(shown)).not.toContain(strings.answeredBefore.title)
    getByRole(shown, 'textbox', { name: strings.composerLabel })
  })

  it('clears what was typed when an earlier answer answers it, sending nothing', () => {
    const { shown, called } = setup()
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    fire.type(text, 'Where is the release calendar kept?')
    called('findEarlierAnswers')[0]!.then!.done!([
      {
        question: note('q1', { body: 'Release calendar?' }),
        answer: note('a1', { body: 'In Drive.' }),
        channel: null,
      },
    ])
    getByRole(shown, 'button', { name: strings.answeredBefore.thisAnswersIt }).click()
    expect(text.value).toBe('')
    expect(called('sendNote')).toHaveLength(0)
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

  it('asks the agent to reply to the note answered, or to write a new one, from beside Send', () => {
    const { shown, called, context } = setup()
    mount(shown)
    const toggle = shown.querySelector<HTMLButtonElement>('.composer-row .ask-agent-toggle')!
    const ask = shown.querySelector<HTMLDetailsElement>('.ask-agent')!
    expect(toggle.textContent).toBe(strings.letAgentWrite)
    expect(ask.querySelector('.ask-agent-row button')!.textContent).toBe(strings.askAgent)
    toggle.click()
    expect([ask.open, toggle.getAttribute('aria-expanded')]).toEqual([true, 'true'])
    expect(context.document.focused()?.getAttribute('name')).toBe('instruction')
    const request = () => ask.querySelector<HTMLButtonElement>('.ask-agent-row button')!
    request().click()
    expect(called('askAgent')[0]!.args[0]).toMatchObject({ destination: { conversationId: ROOM } })
    context.state.replyTargets.set(new Map([[ROOM, 'q' as never]]))
    request().click()
    expect(called('askAgent')[1]!.args[0]).toMatchObject({ destination: { inReplyTo: 'q' } })
    toggle.click()
    expect([ask.open, toggle.getAttribute('aria-expanded')]).toEqual([false, 'false'])
  })

  it('says why the agent cannot be asked, and offers nothing where the server takes no requests', () => {
    const unavailable = entry(ANA, 'Ana', {
      presence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null, kind: 'failed' } },
    })
    const { shown, update } = setup({ directory: [unavailable] })
    const toggle = shown.querySelector<HTMLButtonElement>('.ask-agent-toggle')!
    expect([toggle.disabled, toggle.title]).toEqual([true, strings.deskUnavailableReason.failed])
    expect(textOf(shown.querySelector(`#${toggle.getAttribute('aria-describedby')}`)!)).toBe(
      strings.deskUnavailableReason.failed,
    )
    update({})
    expect([toggle.disabled, toggle.title, toggle.hasAttribute('aria-describedby')]).toEqual([
      false,
      strings.letAgentWriteHint,
      false,
    ])
    const off = testContext()
    off.context.state.serverInfo.set(serverInfo())
    const plain = composer(
      off.context,
      lifetime(),
      ROOM,
      () => composerModel(threadInput({ serverInfo: serverInfo() })),
      [],
    )
    expect(plain.querySelector('.ask-agent-toggle')).toBeNull()
  })

  it('keeps unsent text per conversation, gives it back when drawn again, and forgets it once sent', () => {
    const { shown, called, context } = setup()
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    fire.type(text, 'Half a thought')
    expect(called('keepComposerText')[0]!.args).toEqual([ROOM, 'Half a thought'])
    context.state.composerTexts.set(new Map([[ROOM, 'Half a thought']]))
    const again = composer(context, lifetime(), ROOM, () => composerModel(threadInput()), [])
    expect((getByRole(again, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement).value).toBe(
      'Half a thought',
    )
    fire.key(text, 'Enter')
    expect(called('keepComposerText').at(-1)!.args).toEqual([ROOM, ''])
    expect(called('sendNote')[0]!.args).toEqual([ROOM, 'Half a thought'])
  })

  it('takes the focus when a reply asks for it, and keeps it after sending', () => {
    const { shown, context, page } = setup()
    mount(shown)
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    context.state.composerTexts.set(new Map())
    text.value = 'Typed'
    context.state.composerFocus.set(ROOM)
    expect(context.document.focused()).not.toBe(text)
    page.runFrames()
    expect(context.document.focused()).toBe(text)
    expect(context.state.composerFocus.get()).toBeNull()
    const send = getByRole(shown, 'button', { name: strings.send })
    expect(fire.event(send, 'pointerdown')).toBe(false)
    send.focus()
    fire.submit(shown)
    expect(context.document.focused()).toBe(text)
    context.state.composerFocus.set('elsewhere' as never)
    page.runFrames()
    expect(context.state.composerFocus.get()).toBe('elsewhere')
  })

  it('tags people in a group with @, writes the name chosen, and says whose agents will draft a reply', () => {
    const test = testContext()
    const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    test.context.state.session.set(me())
    test.context.state.conversations.set([group])
    const input = () =>
      threadInput({
        conversations: [group],
        members: new Map([
          [ANA, member(ANA, 'Ana')],
          [BEN, member(BEN, 'Ben')],
          [CY, member(CY, 'Cy')],
        ]),
        directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')],
      })
    const shown = composer(
      test.context,
      lifetime(),
      ROOM,
      () => composerModel(input()),
      [],
      () => {},
      input,
    )
    const asks = () => textOf(shown.querySelector('.composer-asks')!)
    const options = () => shown.querySelector<HTMLElement>('#composer-tags-options')!
    expect(asks()).toContain(strings.tags.everyone)
    expect(shown.querySelector('.composer-asks')!.textContent).toContain(strings.hints.tagging)
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    expect(text.getAttribute('aria-controls')).toBe('composer-tags-options')
    expect(options().hidden).toBe(true)
    fire.type(text, 'Hi @')
    expect(options().hidden).toBe(false)
    expect(textOf(options())).toContain('Ben')
    fire.key(text, 'ArrowDown')
    expect(text.getAttribute('aria-activedescendant')).toBe(`composer-tags-${CY}`)
    fire.key(text, 'Enter')
    expect(test.called('sendNote')).toHaveLength(0)
    expect(text.value).toBe('Hi @Cy ')
    expect(test.called('keepComposerTags').at(-1)!.args).toEqual([ROOM, [CY]])
    expect(options().hidden).toBe(true)
    test.context.state.composerTags.set(new Map([[ROOM, [CY]]]))
    expect(asks()).toContain(strings.tags.onlyOne({ name: 'Cy' }))
    fire.type(text, 'Hi @Cy and @b')
    fire.key(text, 'Escape')
    expect(options().hidden).toBe(true)
    expect(test.called('chooseReplyTarget')).toHaveLength(0)
    fire.type(text, 'Hi @Cy and @b')
    fire.key(text, 'Tab')
    expect(text.value).toBe('Hi @Cy and @Ben ')
    expect(test.called('keepComposerTags').at(-1)!.args).toEqual([ROOM, [CY, BEN]])
    fire.type(text, 'Hi @Cy and @b')
    test.context.state.composerTags.set(new Map([[ROOM, [CY, BEN]]]))
    fire.key(text, 'Enter')
    expect(test.called('sendNote')).toHaveLength(1)
    test.context.state.composerTags.set(new Map([[ROOM, [CY]]]))
    expect(options().hidden).toBe(true)
    fire.click(getByRole(shown, 'button', { name: strings.picker.remove({ name: 'Cy' }) }))
    expect(test.called('keepComposerTags').at(-1)!.args).toEqual([ROOM, []])
    fire.type(text, '@')
    fire.event(text, 'blur')
    expect(options().hidden).toBe(true)
  })

  it('offers no tagging in a direct message', () => {
    const test = testContext()
    test.context.state.conversations.set([conversation()])
    const shown = composer(
      test.context,
      lifetime(),
      ROOM,
      () => composerModel(threadInput()),
      [],
      () => {},
      () => threadInput(),
    )
    expect(shown.querySelector('.composer-asks')).toBeNull()
    const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
    expect(text.getAttribute('aria-controls')).toBeNull()
    fire.type(text, '@')
    fire.key(text, 'Enter')
    expect(test.called('sendNote')).toHaveLength(1)
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
