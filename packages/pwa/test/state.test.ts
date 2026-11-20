import { describe, expect, it } from 'vitest'
import { createState, signedIn } from '../src/state.ts'
import { ANA, BEN, ROOM, draft, entry, me } from './support/fixtures.ts'

describe('createState', () => {
  it('starts on the route of the address, loading, with nothing known yet', () => {
    const state = createState('#/people')
    expect(state.route.get()).toEqual({ name: 'people' })
    expect(state.session.get()).toBe('loading')
    expect(state.conversationsLoaded.get()).toBe(false)
    expect(state.connection.get()).toBe('connecting')
  })

  it('remembers each draft as it first reaches a thread, and keeps that version as it changes', () => {
    const state = createState('')
    state.threads.set(new Map([[ROOM, { notes: [draft('d1')], hasMore: false }]]))
    state.threads.set(new Map([[ROOM, { notes: [draft('d1', { body: 'rewritten' })], hasMore: false }]]))
    expect(state.draftsRead.get().get('d1' as never)).toEqual({ body: 'body of d1', conversationId: ROOM })
  })

  it('knows every member by id, the person signed in among them', () => {
    const state = createState('')
    expect(state.members.get().size).toBe(0)
    state.session.set(me())
    state.directory.set([entry(BEN, 'Ben')])
    expect([...state.members.get().keys()]).toEqual([ANA, BEN])
  })
})

describe('signedIn', () => {
  it('is the person signed in, or null while loading or signed out', () => {
    const state = createState('')
    expect(signedIn(state)).toBeNull()
    state.session.set(null)
    expect(signedIn(state)).toBeNull()
    state.session.set(me())
    expect(signedIn(state)?.member.id).toBe(ANA)
  })
})
