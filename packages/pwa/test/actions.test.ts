import { describe, expect, it, vi } from 'vitest'
import { TASKS, createActions } from '../src/actions.ts'
import { settle, testApp } from './support/app.ts'
import { ROOM } from './support/fixtures.ts'

describe('createActions', () => {
  it('offers every task by name, passing its arguments and what comes next', async () => {
    const { app, sent } = testApp({
      'channels.list': () => ({ channels: [] }),
      'search.notes': () => ({ notes: [] }),
    })
    const actions = createActions(app.launch)
    expect(Object.keys(actions).sort()).toEqual(Object.keys(TASKS).sort())
    const done = vi.fn()
    actions.loadKnownChannels({ done })
    actions.searchNotes('release', { done })
    actions.chooseReplyTarget(ROOM, null)
    await settle()
    expect(done).toHaveBeenCalledTimes(2)
    expect(sent.map((one) => one.route).sort()).toEqual(['channels.list', 'search.notes'])
  })

  it('creates a channel on the way to sending a draft there', async () => {
    const { app, routes } = testApp({ 'channels.create': () => ({ slug: 'ops' }) })
    const actions = createActions(app.launch)
    actions.createChannelThenReaddress({ slug: 'ops', description: 'Ops' }, { id: 'd' } as never)
    await settle()
    expect(routes()).toEqual(expect.arrayContaining(['drafts.update']))
  })

  it('passes every argument a view gives, so a note typed at opt-in reaches the server', async () => {
    const { app, sent } = testApp({ 'debates.optIn': () => ({}) })
    createActions(app.launch).optInAgent('deb_1' as never, 'cred_1' as never, 'Use the Q3 budget.')
    await settle()
    expect(sent[0]!.request).toEqual({
      params: { id: 'deb_1' },
      body: { agentId: 'cred_1', brief: 'Use the Q3 budget.' },
    })
  })

  it('offers no task with a default parameter, which would take a trailing callback for an argument', () => {
    for (const [name, task] of Object.entries(TASKS))
      expect(hasDefaultParameter(String(task)), name).toBe(false)
  })

  it('makes every task from its name', () => {
    for (const [name, task] of Object.entries(TASKS))
      if (task.length === 0) expect((task as () => unknown)(), name).toBeTruthy()
  })
})

const hasDefaultParameter = (source: string): boolean => {
  if (!source.startsWith('(')) return false
  let depth = 0
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '(' || character === '{' || character === '[') depth++
    else if (character === ')' || character === '}' || character === ']') {
      depth--
      if (depth === 0) return false
    } else if (character === '=' && source[index + 1] !== '>' && source[index - 1] !== '=') return true
  }
  return false
}
