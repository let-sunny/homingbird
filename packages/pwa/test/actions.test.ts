import { describe, expect, it, vi } from 'vitest'
import { TASKS, createActions } from '../src/actions.ts'
import { settle, testApp } from './support/app.ts'
import { ROOM } from './support/fixtures.ts'

describe('createActions', () => {
  it('offers every task by name, passing its arguments and what comes next', async () => {
    const { app, sent } = testApp({
      'conversations.list': () => ({ conversations: [] }),
      'search.notes': () => ({ notes: [] }),
    })
    const actions = createActions(app.launch)
    expect(Object.keys(actions).sort()).toEqual(Object.keys(TASKS).sort())
    const done = vi.fn()
    actions.loadConversations({ done })
    actions.searchNotes('release', { done })
    actions.chooseReplyTarget(ROOM, null)
    await settle()
    expect(done).toHaveBeenCalledTimes(2)
    expect(sent.map((one) => one.route)).toEqual(['conversations.list', 'search.notes'])
  })

  it('creates a channel on the way to moving a question or a draft there', async () => {
    const { app, routes } = testApp({ 'channels.create': () => ({ slug: 'ops' }) })
    const actions = createActions(app.launch)
    actions.createChannelThenMove({ slug: 'ops', description: 'Ops' }, { id: 'q' } as never)
    actions.createChannelThenReaddress({ slug: 'ops', description: 'Ops' }, { id: 'd' } as never)
    await settle()
    expect(routes()).toEqual(expect.arrayContaining(['notes.move', 'drafts.update']))
  })

  it('makes every task from its name', () => {
    for (const [name, task] of Object.entries(TASKS))
      if (task.length === 0) expect((task as () => unknown)(), name).toBeTruthy()
  })
})
