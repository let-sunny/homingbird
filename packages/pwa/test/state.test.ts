import { lifetime } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { type AppState, OUTLIVES_SESSION, createState, forgetSession, signedIn } from '../src/state.ts'
import { ANA, BEN, ROOM, channel, conversation, draft, entry, me, member } from './support/fixtures.ts'
import { setLoad } from './support/resource-load.ts'

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

  it('draws the rooms once the people who name them came, or take longer than usual', () => {
    const state = createState('')
    setLoad(state.conversations, { loaded: true })
    expect(state.conversationsLoaded.get()).toBe(false)
    setLoad(state.directory, { step: 'loading' })
    expect(state.conversationsLoaded.get()).toBe(false)
    for (const load of [{ step: 'slow' }, { step: 'failed' }, { loaded: true }] as const) {
      setLoad(state.directory, load)
      expect(state.conversationsLoaded.get()).toBe(true)
    }
  })

  it('keeps the rooms drawn while the people are asked for again, until the rooms themselves are lost', () => {
    const state = createState('')
    setLoad(state.conversations, { loaded: true })
    setLoad(state.directory, { step: 'failed' })
    for (const step of ['idle', 'loading', 'failed', 'loading'] as const) {
      setLoad(state.directory, { step })
      expect(state.conversationsLoaded.get()).toBe(true)
    }
    setLoad(state.conversations, { step: 'failed' })
    expect(state.conversationsLoaded.get()).toBe(false)
    setLoad(state.conversations, { loaded: true })
    expect(state.conversationsLoaded.get()).toBe(false)
    setLoad(state.directory, { loaded: true })
    expect(state.conversationsLoaded.get()).toBe(true)
    forgetSession(state)
    expect(state.conversationsLoaded.get()).toBe(false)
  })

  it('never takes someone for a former member before the people came, and follows the rooms only until then', () => {
    const state = createState('')
    let changes = 0
    state.members.subscribe(() => {
      changes++
    })
    state.conversations.set([conversation()])
    expect(state.members.get().get(BEN)?.name).toBe('…')
    state.directory.set([entry(ANA, 'Ana')])
    setLoad(state.directory, { loaded: true })
    expect([...state.members.get().keys()]).toEqual([ANA])
    changes = 0
    state.conversations.set([conversation({ unreadCount: 1 })])
    setLoad(state.directory, { loaded: true, step: 'loading' })
    expect(changes).toBe(0)
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

describe('what a channel agent’s page holds', () => {
  const held = (state: AppState) => {
    const life = lifetime()
    const all = [
      state.channelAgents,
      state.channelTeaching,
      state.channelAgentFigures,
      state.channelDecisions,
    ]
    const entries = all.map((one) => one.use('wiki', life))
    for (const entry of entries) {
      entry.set(PERSONAL as never)
      setLoad(entry, { loaded: true })
    }
    return entries
  }

  it('stays while the person still runs the channel’s agent, and is emptied when they no longer do', () => {
    const state = createState('')
    const entries = held(state)
    state.channels.set([channel('wiki', { runsAgent: true })])
    setLoad(state.channels, { loaded: true })
    for (const entry of entries) expect(entry.get()).not.toBeNull()
    state.channels.set([channel('wiki', { runsAgent: false })])
    for (const entry of entries) expect(entry.get()).toBeNull()
  })

  it('is emptied when the channel is gone from the list, as when the person left it', () => {
    const state = createState('')
    const entries = held(state)
    state.channels.set([channel('wiki', { runsAgent: true })])
    setLoad(state.channels, { loaded: true })
    state.channels.set([channel('other', { runsAgent: true })])
    for (const entry of entries) expect(entry.get()).toBeNull()
  })

  it('is emptied when the server refused the channels, and left alone while they are only not read yet', () => {
    const state = createState('')
    const entries = held(state)
    setLoad(state.channels, { step: 'loading' })
    for (const entry of entries) expect(entry.get()).not.toBeNull()
    setLoad(state.channels, { step: 'failed' })
    for (const entry of entries) expect(entry.get()).toBeNull()
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
  if ('use' in part)
    return void (part as AppState['channelAgents']).use('wiki', lifetime()).set(PERSONAL as never)
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
  if ('use' in (part as object)) {
    const { find, load } = part as AppState['channelAgents']
    return [find('wiki') === null, load.get()]
  }
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
