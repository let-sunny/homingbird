import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { newMessageView } from '../../src/views/new-message.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, ROOM, conversation, entry, everything, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const drawn = (to: ReadonlyArray<string> = [], info = everything()) => {
  const test = testContext('#/new')
  test.context.state.serverInfo.set(info)
  test.context.state.directory.set([
    entry(ANA, 'Ana', {
      relation: 'self',
      canMessage: false,
      presence: { humanOnline: true, agentOnline: true },
    }),
    entry(BEN, 'Ben'),
    entry(CY, 'Cy'),
  ])
  const shown = mount(newMessageView(test.context, lifetime(), me(), to))
  const field = getByRole(shown, 'combobox', { name: strings.newMessage.to }) as HTMLInputElement
  const text = getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement
  const send = getByRole(shown, 'button', { name: strings.send }) as HTMLButtonElement
  return { ...test, shown, field, text, send }
}

describe('newMessageView', () => {
  it('starts in the To field, and holds Send and the agent until someone is chosen', () => {
    const { shown, field, send, called, page } = drawn()
    expect(called('loadPeople')).toHaveLength(1)
    page.runFrames()
    expect(document.activeElement).toBe(field)
    expect(getByRole(shown, 'heading', { name: strings.newMessage.title })).toBeTruthy()
    expect(textOf(shown)).toContain(strings.newMessage.nobody)
    expect(send.disabled).toBe(true)
    expect(textOf(shown.querySelector('.new-message-reason')!)).toBe(strings.newMessage.chooseFirst)
    expect(getByRole(shown, 'button', { name: strings.letAgentWrite }).hasAttribute('disabled')).toBe(true)
  })

  it('sends the first note to the people chosen, making nothing before the send', () => {
    const { shown, field, text, send, called, page } = drawn()
    fire.type(field, 'cy')
    fire.key(field, 'Enter')
    fire.type(field, 'be')
    fire.key(field, 'Enter')
    expect(textOf(shown)).toContain(strings.newMessage.several({ names: 'Cy and Ben' }))
    expect(textOf(shown)).toContain(strings.newMessage.newGroup)
    expect(called('sendNoteAmong')).toHaveLength(0)
    fire.type(text, '  Can you two look at the release?  ')
    expect(send.disabled).toBe(false)
    fire.key(text, 'Enter', { isComposing: true })
    fire.key(text, 'Enter', { shiftKey: true })
    expect(called('sendNoteAmong')).toHaveLength(0)
    fire.key(text, 'Enter')
    expect(called('sendNoteAmong').map((call) => call.args)).toEqual([
      [[CY, BEN], 'Can you two look at the release?'],
    ])
    expect(send.disabled).toBe(true)
    expect(send.textContent).toBe(strings.sending)
    fire.submit(shown.querySelector('form.new-message')!)
    expect(called('sendNoteAmong')).toHaveLength(1)
    called('sendNoteAmong')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    expect(send.disabled).toBe(false)
    page.state.coarsePointer = true
    fire.key(text, 'Enter')
    expect(called('sendNoteAmong')).toHaveLength(1)
  })

  it('starts in the note with the person a card chose, and points to the room there is', () => {
    const test = testContext('#/new')
    test.context.state.serverInfo.set(everything())
    test.context.state.directory.set([entry(BEN, 'Ben')])
    test.context.state.conversations.set([conversation()])
    const shown = mount(newMessageView(test.context, lifetime(), me(), [BEN]))
    test.page.runFrames()
    expect(document.activeElement).toBe(getByRole(shown, 'textbox', { name: strings.composerLabel }))
    expect(textOf(shown)).toContain(strings.newMessage.onlyOne({ name: 'Ben' }))
    expect(getByRole(shown, 'link', { name: strings.newMessage.openExisting }).getAttribute('href')).toBe(
      `#/c/${ROOM}`,
    )
  })

  it('asks the agent for the first note instead, once someone is chosen', () => {
    const { shown, called } = drawn([BEN])
    const toggle = getByRole(shown, 'button', { name: strings.letAgentWrite })
    expect(toggle.hasAttribute('disabled')).toBe(false)
    toggle.click()
    const instruction = getByRole(shown, 'textbox', { name: strings.agentInstructionLabel })
    fire.type(instruction, 'Ask about the launch')
    fire.key(instruction, 'Enter')
    expect(called('askAgentAmong').map((call) => call.args)).toEqual([[[BEN], 'Ask about the launch', null]])
    fire.key(instruction, 'Enter')
    expect(called('askAgentAmong')).toHaveLength(1)
  })

  it('offers no agent where the server takes no draft requests', () => {
    const { shown } = drawn([], serverInfo())
    expect(shown.querySelector('.ask-agent-toggle')).toBeNull()
  })
})
