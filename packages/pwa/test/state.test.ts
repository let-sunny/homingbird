import { describe, expect, it } from 'vitest'
import { type AppState, OUTLIVES_SESSION, createState, forgetSession, signedIn } from '../src/state.ts'
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

describe('forgetSession', () => {
  it('empties every part of the state but what it names, so a new part cannot be forgotten', () => {
    const state = createState('#/people')
    const untouched = createState('#/people')
    for (const key of Object.keys(state) as Array<keyof AppState>) fill(state[key], key)
    forgetSession(state)
    for (const key of Object.keys(state) as Array<keyof AppState>) {
      if (key === 'session') expect(state.session.get()).toBeNull()
      else if (OUTLIVES_SESSION.has(key)) expect(held(state[key]), key).not.toEqual(held(untouched[key]))
      else if (key !== 'members') expect(held(state[key]), key).toEqual(held(untouched[key]))
    }
    expect(state.members.get().size).toBe(0)
  })

  it('keeps only what the server tells everyone and the address', () => {
    expect([...OUTLIVES_SESSION].sort()).toEqual(['branding', 'route', 'serverInfo'])
  })

  it('is heard once, with everything already gone', () => {
    const state = createState('')
    state.session.set(me())
    state.directory.set([entry(BEN, 'Ben')])
    const heard: number[] = []
    state.session.subscribe(() => heard.push(state.directory.get().length))
    forgetSession(state)
    expect(heard).toEqual([0])
  })
})

/** Puts something in a part of the state; a part of a new kind fails here until the test knows how. */
const fill = (part: unknown, name: string): void => {
  if (typeof part === 'function' || typeof part === 'number') return
  if (part instanceof Set) return void part.add('personal')
  if (typeof part !== 'object' || part === null || part instanceof Map || Array.isArray(part))
    throw new Error(`forgetSession does not empty ${name}`)
  if ('changesTo' in part) return void (part as AppState['changes']).count(ROOM)
  if ('reset' in part) fill((part as AppState['debates']).load, `${name}.load`)
  if ('set' in part && 'get' in part) {
    const signal = part as { get: () => unknown; set: (value: unknown) => void }
    return void signal.set(somethingElse(signal.get()))
  }
  if ('get' in part) return
  for (const [key, inner] of Object.entries(part)) fill(inner, `${name}.${key}`)
}

const held = (part: unknown): unknown => {
  if (typeof part === 'function' || typeof part === 'number') return null
  if (part instanceof Set) return [...part]
  if ('changesTo' in (part as object)) return (part as AppState['changes']).changesTo(ROOM)
  if ('reset' in (part as object)) {
    const { get, load } = part as AppState['debates']
    return [get(), load.get()]
  }
  if ('get' in (part as object)) return (part as { get: () => unknown }).get()
  return Object.entries(part as object).map(([key, inner]) => [key, held(inner)])
}

const somethingElse = (value: unknown): unknown => {
  if (value === 'loading') return 'failed'
  if (typeof value === 'string') return `${value} personal`
  if (typeof value === 'number') return value + 1
  if (typeof value === 'boolean') return !value
  if (Array.isArray(value)) return [PERSONAL]
  if (value instanceof Map) return new Map([[ROOM, PERSONAL]])
  if (value instanceof Set) return new Set([ROOM])
  return PERSONAL
}

const PERSONAL = { ...channel('wiki'), notes: [draft('d1')], note: draft('d1'), member: member(BEN, 'Ben') }

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
