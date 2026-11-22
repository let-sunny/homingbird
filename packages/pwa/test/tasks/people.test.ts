import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/people.ts'
import { testApp } from '../support/app.ts'
import { ANA, BEN, CY, ROOM, conversation, me, note } from '../support/fixtures.ts'

const answers = {
  'directory.list': () => ({ entries: [] }),
  'contacts.list': () => ({ contacts: [] }),
  'conversations.create': () => conversation(),
  'search.notes': () => ({ notes: [note('n1')] }),
}

describe('people tasks', () => {
  it('opens the conversation with a member, adding it to the list once', async () => {
    const { run, state, page } = testApp(answers)
    await run(tasks.openConversationWith(BEN))
    await run(tasks.openConversationWith(BEN))
    expect(state.conversations.get()).toHaveLength(1)
    expect(page.visited).toEqual([`go #/c/${ROOM}`, `go #/c/${ROOM}`])
  })

  it('starts a conversation with everyone chosen and opens it, sending nothing', async () => {
    const { run, state, page, sent, routes } = testApp(answers)
    await run(tasks.openConversationAmong([BEN, CY]))
    expect(sent.map((one) => one.request)).toEqual([{ body: { participantIds: [BEN, CY] } }])
    expect(routes()).toEqual(['conversations.create'])
    expect(state.conversations.get()).toHaveLength(1)
    expect(page.visited).toEqual([`go #/c/${ROOM}`])
  })

  it('sends a first note in the room made for it, then opens that room', async () => {
    const { run, state, page, routes, sent } = testApp({
      ...answers,
      'conversations.create': () => conversation({ kind: 'group', participantIds: [ANA, BEN, CY] }),
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
      'drafts.send': () => note('d1', { authorId: ANA }),
      'conversations.list': () => ({ conversations: [conversation({ kind: 'group' })] }),
    })
    state.session.set(me())
    await run(tasks.sendNoteAmong([BEN, CY], 'Hello both'))
    expect(routes()).toEqual(['conversations.create', 'drafts.create', 'drafts.send', 'conversations.list'])
    expect(sent[1]!.request).toEqual({ body: { body: 'Hello both', conversationId: ROOM } })
    expect(state.conversations.get().map((room) => room.id)).toEqual([ROOM])
    expect(page.visited).toEqual([`go #/c/${ROOM}`])
  })

  it('sends to the room there already is with exactly those people instead of making another', async () => {
    const { run, state, routes } = testApp({
      ...answers,
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
      'drafts.send': () => note('d1', { authorId: ANA }),
    })
    state.session.set(me())
    state.conversations.set([conversation()])
    await run(tasks.sendNoteAmong([BEN], 'Hi'))
    expect(routes()).not.toContain('conversations.create')
  })

  it('makes the room before asking the agent for a draft there, and opens it', async () => {
    const created = conversation({ id: 'conv_new000000000' as never })
    const { run, state, page, routes, sent } = testApp({
      ...answers,
      'conversations.create': () => created,
      'draftRequests.create': () => ({ id: 'dreq_1', conversationId: created.id }),
    })
    state.conversations.set([created])
    await run(tasks.askAgentAmong([BEN], 'Ask about the release', null))
    expect(routes()).toEqual(['conversations.create', 'draftRequests.create'])
    expect(sent[1]!.request).toEqual({
      body: { conversationId: created.id, instruction: 'Ask about the release' },
    })
    expect(state.conversations.get()).toHaveLength(1)
    expect(page.visited).toEqual([`go #/c/${created.id}`])
  })

  it('changes contacts and blocks, reloading people after each', async () => {
    const { run, routes } = testApp(answers)
    for (const task of [
      tasks.requestContact,
      tasks.acceptContact,
      tasks.removeContact,
      tasks.blockMember,
      tasks.unblockMember,
    ])
      await run(task(BEN))
    expect(routes().filter((route) => route !== 'directory.list' && route !== 'contacts.list')).toEqual([
      'contacts.request',
      'contacts.accept',
      'contacts.remove',
      'blocks.add',
      'blocks.remove',
    ])
  })

  it('searches notes', async () => {
    const { run } = testApp(answers)
    expect(await run(tasks.searchNotes('release'))).toEqual({ _tag: 'Ok', value: [note('n1')] })
  })
})
