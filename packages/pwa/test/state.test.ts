import { describe, expect, it } from 'vitest'
import { createState, signedIn } from '../src/state.ts'
import { ANA, BEN, ROOM, channel, draft, entry, me, member } from './support/fixtures.ts'

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

  it('knows the channels’ agents by name, and each answer a manager reviews as first read', () => {
    const state = createState('')
    const agent = { id: 'mem_agent0000000' as never, name: 'Payments wiki' }
    state.channels.set([channel('wiki', { agent }), channel('quiet', { agent: null }), channel('old')])
    expect(state.members.get().get(agent.id)).toMatchObject({ name: 'Payments wiki', kind: 'channel_agent' })
    expect(state.members.get().size).toBe(1)
    state.reviews.set([
      { note: draft('d1'), question: null, channel: 'wiki', agent: member(ANA, 'x'), privately: false },
    ])
    expect(state.reviewsRead.get().get('d1' as never)).toEqual({ body: 'body of d1', conversationId: ROOM })
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
