import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/conversation-actions.ts'
import { testApp } from '../support/app.ts'
import { ANA, BEN, CY, ROOM, conversation, me } from '../support/fixtures.ts'

const OTHER = 'conv_other0000000' as never

const answers = {
  'conversations.hide': () => conversation({ hidden: true }),
  'conversations.unhide': () => conversation({ hidden: false }),
  'conversations.leave': () => ({}),
}

describe('conversation action tasks', () => {
  it('hides a conversation, replacing its row, closing it when it is open and saying how it comes back', async () => {
    const { run, state, routes, page } = testApp(answers)
    const other = conversation({ id: OTHER })
    state.conversations.set([conversation(), other])
    state.route.set({ name: 'conversation', id: ROOM, draft: null })
    await run(tasks.setHidden(ROOM, true, 'You hid Ben.'))
    expect(state.conversations.get()).toEqual([conversation({ hidden: true }), other])
    expect(page.visited).toEqual(['replace #/'])
    expect(state.notice.get()).toEqual({ kind: 'info', text: 'You hid Ben.' })
    expect(routes()).toEqual(['conversations.hide'])
  })

  it('hides a conversation that is not open without leaving the page, and says nothing without words', async () => {
    const { run, state, page } = testApp(answers)
    state.conversations.set([conversation()])
    state.route.set({ name: 'people' })
    await run(tasks.setHidden(ROOM, true, null))
    expect(page.visited).toEqual([])
    expect(state.notice.get()).toBeNull()
  })

  it('shows a hidden conversation again, staying where the person is', async () => {
    const { run, state, page, routes } = testApp(answers)
    state.conversations.set([conversation({ hidden: true })])
    state.route.set({ name: 'conversation', id: ROOM, draft: null })
    await run(tasks.setHidden(ROOM, false, null))
    expect(state.conversations.get()).toEqual([conversation({ hidden: false })])
    expect(page.visited).toEqual([])
    expect(routes()).toEqual(['conversations.unhide'])
  })

  it('leaves a group, forgetting its row and its notes, closing it and saying so', async () => {
    const { run, state, page, routes } = testApp(answers)
    state.conversations.set([conversation(), conversation({ id: OTHER })])
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    state.route.set({ name: 'conversation', id: ROOM, draft: null })
    await run(tasks.leaveGroup(ROOM, 'You left Ben, Cy.'))
    expect(state.conversations.get().map((each) => each.id)).toEqual([OTHER])
    expect(state.threads.get().has(ROOM)).toBe(false)
    expect(page.visited).toEqual(['replace #/'])
    expect(state.notice.get()).toEqual({ kind: 'info', text: 'You left Ben, Cy.' })
    expect(routes()).toEqual(['conversations.leave'])
  })

  it('drops a room the person left on another device, and takes someone else who left out of its people', () => {
    const test = testApp(answers)
    test.state.session.set(me())
    const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    const other = conversation({ id: OTHER })
    test.state.conversations.set([group, other])
    tasks.applyLeft(test.app, ROOM, BEN)
    expect(test.state.conversations.get()).toEqual([{ ...group, participantIds: [ANA, CY] }, other])
    tasks.applyLeft(test.app, ROOM, ANA)
    expect(test.state.conversations.get()).toEqual([other])
    tasks.applyLeft(test.app, ROOM, ANA)
    expect(test.state.conversations.get()).toEqual([other])
  })
})
