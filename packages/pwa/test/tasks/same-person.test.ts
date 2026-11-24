import { describe, expect, it } from 'vitest'
import { requireSamePerson } from '../../src/tasks/same-person.ts'
import { fail, testApp } from '../support/app.ts'
import { BEN, me, member } from '../support/fixtures.ts'

describe('requireSamePerson', () => {
  it('goes on while the page’s person is signed in', async () => {
    const { run, state, page } = testApp({ 'me.get': () => me() })
    state.session.set(me())
    expect((await run(requireSamePerson))._tag).toBe('Ok')
    expect(page.visited).toEqual([])
    expect(state.session.get()).toEqual(me())
  })

  it('starts the page anew, emptied, for another person', async () => {
    const { run, state, page } = testApp({ 'me.get': () => ({ ...me(), member: member(BEN, 'Ben') }) })
    state.session.set(me())
    expect((await run(requireSamePerson))._tag).toBe('Err')
    expect(page.visited).toEqual(['reload'])
    expect(state.session.get()).toBeNull()
  })

  it('ends the session when nobody is signed in', async () => {
    const { run, state, page } = testApp({ 'me.get': () => fail({ _tag: 'Unauthorized', message: 'out' }) })
    state.session.set(me())
    await run(requireSamePerson)
    expect(page.visited).toEqual([])
    expect(state.session.get()).toBeNull()
  })
})
