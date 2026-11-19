import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/people.ts'
import { testApp } from '../support/app.ts'
import { BEN, ROOM, conversation, note } from '../support/fixtures.ts'

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
