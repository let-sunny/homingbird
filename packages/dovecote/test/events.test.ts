import { Task as T } from '@homingbird/kernel'
import { HEARTBEAT_SECONDS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  REPLAY_LIMIT,
  deleteEventsBefore,
  emit,
  eventsAfter,
  liveEvents,
  transact,
} from '../src/events/events.ts'
import { makeHub } from '../src/events/hub.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  benAgent = await connectAgent(server, ben)
})

afterEach(() => server.close())

const sendNote = async (body: string) => {
  const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body })).json
  return (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
}

const frames = async (response: { raw: { body: unknown } }, count: number): Promise<string[]> => {
  const collected: string[] = []
  const iterator = (response.raw.body as AsyncIterable<string>)[Symbol.asyncIterator]()
  while (collected.length < count) {
    const step = await iterator.next()
    if (step.done) break
    collected.push(step.value)
  }
  return collected
}

const latestSequence = async (): Promise<number> =>
  (await ben.api('GET', '/events/poll?after=999999999')).json.cursor

const backlog = async (count: number): Promise<number> => {
  const from = await latestSequence()
  await T.runPromise(
    transact(
      T.gen(function* () {
        for (let index = 0; index < count; index++)
          yield* emit([ben.me.member.id], { type: 'contact.changed', memberId: ana.me.member.id })
      }),
    ),
    server.env,
  )
  return from
}

const counting = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, index) => from + index + 1)

const BACKLOGS: ReadonlyArray<readonly [string, number]> = [
  ['exactly the replay limit', REPLAY_LIMIT],
  ['one over the replay limit', REPLAY_LIMIT + 1],
  ['far over the replay limit', REPLAY_LIMIT * 3 + 7],
]

describe('the durable event log', () => {
  it('numbers each member’s events from one and resumes after a cursor', async () => {
    await sendNote('one')
    await sendNote('two')
    const all = (await ben.api('GET', '/events/poll?after=0')).json
    expect(all.events.map((event: any) => [event.seq, event.body.type])).toEqual([
      [1, 'note.sent'],
      [2, 'note.sent'],
    ])
    expect(all.cursor).toBe(2)
    const rest = (await ben.api('GET', '/events/poll?after=1')).json
    expect(rest.events.map((event: any) => event.seq)).toEqual([2])
    expect((await ben.api('GET', '/events/poll?after=2')).json).toEqual({ events: [], cursor: 2 })
    expect((await ben.api('GET', '/events/poll?after=99')).json).toEqual({ events: [], cursor: 2 })
  })

  it('tells a client to resync when the events it missed were trimmed', async () => {
    await sendNote('one')
    await server.clock.advance(1_000)
    await sendNote('two')
    await T.runPromise(deleteEventsBefore(server.clock.now()), server.env)
    const answer = (await ben.api('GET', '/events/poll?after=0')).json
    expect(answer.events.map((event: any) => [event.seq, event.body.type])).toEqual([[0, 'resync']])
    expect(answer.cursor).toBe(2)
    await T.runPromise(deleteEventsBefore(server.clock.now() + 1), server.env)
    expect((await ben.api('GET', '/events/poll?after=1')).json.events[0].body.type).toBe('resync')
  })

  it('pages a long backlog', async () => {
    for (let index = 0; index < 5; index++) await sendNote(`note ${index}`)
    const page = await T.runPromise(eventsAfter(ben.me.member.id, 0, 2), server.env)
    expect(page.events.map((event) => event.seq)).toEqual([1, 2])
    expect(page.cursor).toBe(2)
  })
})

describe('long-polling', () => {
  it.each(BACKLOGS)('pages a backlog of %s to the end without skipping an event', async (_, count) => {
    const from = await backlog(count)
    const seen: number[] = []
    let cursor = from
    for (let page = 0; page < 10; page++) {
      const answer = (await ben.api('GET', `/events/poll?after=${cursor}`)).json
      if (answer.events.length === 0) break
      expect(answer.events.length).toBeLessThanOrEqual(REPLAY_LIMIT)
      seen.push(...answer.events.map((event: any) => event.seq))
      cursor = answer.cursor
    }
    expect(seen).toEqual(counting(from, count))
    expect(cursor).toBe(from + count)
  })

  it('holds the request until an event arrives', async () => {
    let answered = false
    const waiting = ben.api('GET', '/events/poll?after=0&wait=25').then((response) => {
      answered = true
      return response
    })
    await server.clock.flush()
    expect(answered).toBe(false)
    await sendNote('wake up')
    const response = await waiting
    expect(response.json.events.map((event: any) => event.body.note.body)).toEqual(['wake up'])
  })

  it('answers empty when the wait runs out, and never waits longer than the maximum', async () => {
    const waiting = ben.api('GET', '/events/poll?after=0&wait=99')
    await server.clock.advance(24_999)
    await server.clock.advance(1)
    expect((await waiting).json).toEqual({ events: [], cursor: 0 })
  })

  it('does not show a long-polling client as online', async () => {
    const waiting = benAgent.api('GET', '/events/poll?after=0&wait=5')
    await server.clock.flush()
    expect(server.env.hub.presenceOf(ben.me.member.id)).toEqual({ humanOnline: false, agentOnline: false })
    await server.clock.advance(5_000)
    await waiting
  })
})

describe('the event stream', () => {
  it('replays what was missed, then delivers live events as server-sent frames', async () => {
    await sendNote('before')
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream?after=0', {
      token: benAgent.token,
      signal: hangUp.signal,
    })
    expect(stream.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    const pending = frames(stream, 2)
    await server.clock.flush()
    await sendNote('after')
    const [replayed, live] = await pending
    expect(replayed).toMatch(/^id: 1\nevent: note\.sent\ndata: \{.*"before".*\}\n\n$/)
    expect(live).toMatch(/^id: 2\nevent: note\.sent\ndata: \{.*"after".*\}\n\n$/)
    hangUp.abort()
  })

  it('starts from now without a cursor and honours Last-Event-ID', async () => {
    await sendNote('old')
    const hangUp = new AbortController()
    const fresh = await server.request('GET', '/api/v1/events/stream', {
      token: benAgent.token,
      signal: hangUp.signal,
    })
    const resumed = await server.request('GET', '/api/v1/events/stream', {
      token: benAgent.token,
      signal: hangUp.signal,
      headers: { 'last-event-id': '0' },
    })
    const fromFresh = frames(fresh, 1)
    const fromResumed = frames(resumed, 2)
    await server.clock.flush()
    await sendNote('new')
    expect((await fromFresh)[0]).toContain('"new"')
    expect((await fromResumed).map((frame) => frame.split('\n')[0])).toEqual(['id: 1', 'id: 2'])
    hangUp.abort()
  })

  it('sends a keep-alive comment on the heartbeat', async () => {
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', {
      token: benAgent.token,
      signal: hangUp.signal,
    })
    const pending = frames(stream, 1)
    await server.clock.advance(HEARTBEAT_SECONDS * 1000)
    expect(await pending).toEqual([': keep-alive\n\n'])
    hangUp.abort()
  })

  it('ends the stream at the next heartbeat after the credential is revoked', async () => {
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', {
      token: benAgent.token,
      signal: hangUp.signal,
    })
    const pending = frames(stream, 5)
    const id = (await benAgent.api('GET', '/me')).json.credential.id
    await ben.api('DELETE', `/credentials/${id}`)
    await server.clock.advance(HEARTBEAT_SECONDS * 1000)
    await server.clock.advance(HEARTBEAT_SECONDS * 1000)
    expect((await pending).length).toBeLessThanOrEqual(1)
    expect(server.env.hub.presenceOf(ben.me.member.id).agentOnline).toBe(false)
  })

  it('refuses a stream without a credential', async () => {
    expect((await server.request('GET', '/api/v1/events/stream')).status).toBe(401)
  })

  it.each(BACKLOGS)('replays a backlog of %s in full before the live events', async (_, count) => {
    const from = await backlog(count)
    const hangUp = new AbortController()
    const stream = await server.request('GET', `/api/v1/events/stream?after=${from}`, {
      token: benAgent.token,
      signal: hangUp.signal,
    })
    const pending = frames(stream, count + 1)
    await server.clock.flush()
    await sendNote('live')
    const received = await pending
    expect(received.map((frame) => Number(/^id: (\d+)/.exec(frame)?.[1]))).toEqual(counting(from, count + 1))
    expect(received.at(-1)).toContain('"live"')
    expect(received.some((frame) => frame.includes('event: resync'))).toBe(false)
    hangUp.abort()
  })

  it('delivers events published while the backlog is replayed exactly once, in order', async () => {
    const from = await backlog(REPLAY_LIMIT * 2 + 3)
    const hangUp = new AbortController()
    const live = await T.runPromise(liveEvents(ben.me.member.id, 'agent', from, hangUp.signal), server.env)
    const iterator = live[Symbol.asyncIterator]()
    const seen: number[] = []
    const read = async (count: number) => {
      for (let index = 0; index < count; index++) seen.push((await iterator.next()).value!.seq)
    }
    await read(10)
    await backlog(4)
    await read(REPLAY_LIMIT)
    await backlog(2)
    await read(REPLAY_LIMIT * 2 + 3 + 4 + 2 - 10 - REPLAY_LIMIT)
    await backlog(1)
    await read(1)
    expect(seen).toEqual(counting(from, REPLAY_LIMIT * 2 + 3 + 4 + 2 + 1))
    hangUp.abort()
    expect((await iterator.next()).done).toBe(true)
  })

  it('tells the client to resync when events are trimmed in the middle of a replay', async () => {
    const from = await backlog(REPLAY_LIMIT * 2)
    const hangUp = new AbortController()
    const live = await T.runPromise(liveEvents(ben.me.member.id, 'agent', from, hangUp.signal), server.env)
    const iterator = live[Symbol.asyncIterator]()
    const seen: number[] = []
    for (let index = 0; index < REPLAY_LIMIT; index++) seen.push((await iterator.next()).value!.seq)
    await T.runPromise(deleteEventsBefore(server.clock.now() + 1), server.env)
    const told = (await iterator.next()).value!
    expect(told.body.type).toBe('resync')
    await backlog(1)
    expect((await iterator.next()).value!.seq).toBe(from + REPLAY_LIMIT * 2 + 1)
    expect(seen).toEqual(counting(from, REPLAY_LIMIT))
    hangUp.abort()
  })

  it('ends instead of going live when it is interrupted between two pages', async () => {
    const from = await backlog(REPLAY_LIMIT + 1)
    const hangUp = new AbortController()
    const live = await T.runPromise(liveEvents(ben.me.member.id, 'agent', from, hangUp.signal), server.env)
    const iterator = live[Symbol.asyncIterator]()
    for (let index = 0; index < REPLAY_LIMIT; index++) await iterator.next()
    hangUp.abort()
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
    expect(server.env.hub.presenceOf(ben.me.member.id).agentOnline).toBe(false)
  })

  it('stops counting the client online when it stops reading in the middle of a replay', async () => {
    const from = await backlog(3)
    const live = await T.runPromise(
      liveEvents(ben.me.member.id, 'agent', from, new AbortController().signal),
      server.env,
    )
    const iterator = live[Symbol.asyncIterator]()
    await iterator.next()
    expect(server.env.hub.presenceOf(ben.me.member.id).agentOnline).toBe(true)
    await iterator.return!(undefined)
    expect(server.env.hub.presenceOf(ben.me.member.id).agentOnline).toBe(false)
  })

  it('skips live events that the replay already covered', async () => {
    await sendNote('one')
    const hangUp = new AbortController()
    const live = await T.runPromise(liveEvents(ben.me.member.id, 'agent', 0, hangUp.signal), server.env)
    const seen: number[] = []
    const reading = (async () => {
      for await (const event of live) seen.push(event.seq)
    })()
    await server.clock.flush()
    server.env.hub.publish(ben.me.member.id, { seq: 1, at: 0, body: { type: 'resync' } })
    await sendNote('two')
    await server.clock.flush()
    hangUp.abort()
    await reading
    expect(seen).toEqual([1, 2])
  })
})

describe('presence', () => {
  const connections = () => {
    const hub = makeHub(() => 42)
    const watcher = new AbortController()
    const seen: unknown[] = []
    const watching = (async () => {
      for await (const event of hub.subscribe('mem_watcher000000' as never, 'hidden', watcher.signal))
        seen.push(event.body)
    })()
    return { hub, watcher, seen, watching }
  }
  const member = 'mem_subject000000' as never

  it('announces nothing until flushed, then one event listing each changed member once with its final state', async () => {
    const { hub, watcher, seen, watching } = connections()
    const human = new AbortController()
    const agent = new AbortController()
    hub.subscribe(member, 'human', human.signal)
    hub.subscribe(member, 'agent', agent.signal)
    human.abort()
    expect(seen).toEqual([])
    hub.flushPresence()
    hub.flushPresence()
    watcher.abort()
    await watching
    expect(seen).toEqual([
      { type: 'presence', members: [{ memberId: member, humanOnline: false, agentOnline: true }] },
    ])
  })

  it('counts connections per kind and hides hidden ones', () => {
    const { hub, watcher } = connections()
    const first = new AbortController()
    const second = new AbortController()
    const firstSubscription = hub.subscribe(member, 'human', first.signal)
    hub.subscribe(member, 'human', second.signal)
    expect(hub.presenceOf(member)).toEqual({ humanOnline: true, agentOnline: false })
    firstSubscription.close()
    firstSubscription.close()
    first.abort()
    expect(hub.presenceOf(member).humanOnline).toBe(true)
    second.abort()
    expect(hub.presenceOf(member)).toEqual({ humanOnline: false, agentOnline: false })
    expect(hub.presenceOf('mem_watcher000000' as never)).toEqual({ humanOnline: false, agentOnline: false })
    watcher.abort()
  })

  it('announces N connecting members as one event with N entries', async () => {
    const { hub, watcher, seen, watching } = connections()
    const holders = Array.from({ length: 50 }, (_, index) => {
      const holder = new AbortController()
      hub.subscribe(`mem_member${String(index).padStart(8, '0')}` as never, 'agent', holder.signal)
      return holder
    })
    hub.flushPresence()
    watcher.abort()
    await watching
    expect(seen).toHaveLength(1)
    expect((seen[0] as { members: unknown[] }).members).toHaveLength(50)
    for (const holder of holders) holder.abort()
  })

  it('closes a subscriber that stops reading and marks it overflowed', async () => {
    const hub = makeHub(() => 0)
    const slow = new AbortController()
    const subscription = hub.subscribe(member, 'agent', slow.signal)
    for (let index = 0; index < 3000; index++)
      hub.publish(member, { seq: index + 1, at: 0, body: { type: 'resync' } })
    expect(subscription.overflowed()).toBe(true)
    const drained: number[] = []
    for await (const event of subscription) drained.push(event.seq)
    expect(drained.length).toBe(2048)
    expect(hub.presenceOf(member).agentOnline).toBe(false)
  })

  it('ends a subscription when its iterator is returned', async () => {
    const hub = makeHub(() => 0)
    const iterator = hub.subscribe(member, 'human', new AbortController().signal)[Symbol.asyncIterator]()
    expect(await iterator.return!()).toEqual({ done: true, value: undefined })
    expect(hub.presenceOf(member).humanOnline).toBe(false)
  })
})

describe('directory changes', () => {
  const listen = async (token: string) => {
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', { token, signal: hangUp.signal })
    return { hangUp, iterator: (stream.raw.body as AsyncIterable<string>)[Symbol.asyncIterator]() }
  }

  it('tells every connected client when someone signs in, edits their profile or is changed by an admin', async () => {
    const { hangUp, iterator } = await listen(benAgent.token)
    const typeAndMember = async () => {
      const frame = (await iterator.next()).value as string
      const event = JSON.parse(frame.split('data: ')[1]!)
      return [frame.split('\n')[0], event.body.type, event.body.memberId]
    }
    await ana.api('PATCH', '/me', { profile: 'Billing' })
    expect(await typeAndMember()).toEqual(['event: directory.changed', 'directory.changed', ana.me.member.id])
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'admin' })
    expect(await typeAndMember()).toEqual(['event: directory.changed', 'directory.changed', ben.me.member.id])
    const cy = await server.signIn('cy@example.com')
    expect((await typeAndMember())[2]).toBe(cy.me.member.id)
    hangUp.abort()
  })

  it('tells every connected client when someone helps with or leaves a topic, or an admin tidies topics', async () => {
    const { hangUp, iterator } = await listen(benAgent.token)
    const typeAndMember = async () => {
      const event = JSON.parse(((await iterator.next()).value as string).split('data: ')[1]!)
      return [event.body.type, event.body.memberId]
    }
    const changed = ['directory.changed', ana.me.member.id]
    await ana.api('POST', '/topics', { slug: 'billing', description: 'Invoices' })
    expect(await typeAndMember()).toEqual(changed)
    await ana.api('DELETE', '/topics/billing/helpers/me')
    expect(await typeAndMember()).toEqual(changed)
    await ana.api('PUT', '/topics/billing/helpers/me')
    expect(await typeAndMember()).toEqual(changed)
    await ana.api('PATCH', '/admin/topics/billing', { slug: 'payments' })
    expect(await typeAndMember()).toEqual(changed)
    await ana.api('POST', '/topics', { slug: 'invoices', description: 'Duplicate' })
    expect(await typeAndMember()).toEqual(changed)
    await ana.api('POST', '/admin/topics/invoices/merge', { into: 'payments' })
    expect(await typeAndMember()).toEqual(changed)
    await ana.api('DELETE', '/admin/topics/payments')
    expect(await typeAndMember()).toEqual(changed)
    hangUp.abort()
  })

  it('is never stored, never pushed, and not sent when the change fails', async () => {
    const pushed: unknown[] = []
    const env = { ...server.env, pushSink: (...delivery: unknown[]) => pushed.push(delivery) }
    const before = (await storedRows(server, 'events')).length
    const { hangUp, iterator } = await listen(benAgent.token)
    expect((await ana.api('PATCH', `/admin/members/${ana.me.member.id}`, { role: 'member' })).status).toBe(
      409,
    )
    expect((await ana.api('PATCH', '/me', { profile: 'x'.repeat(501) })).status).toBe(400)
    await ana.api('PATCH', '/me', { profile: 'ok' })
    const frame = (await iterator.next()).value as string
    expect(frame).toContain(ana.me.member.id)
    expect(frame.startsWith('id:')).toBe(false)
    expect((await storedRows(server, 'events')).length).toBe(before)
    expect((await ben.api('GET', '/events/poll?after=0')).json.events).toEqual([])
    expect(pushed).toEqual([])
    expect(env.hub).toBe(server.env.hub)
    hangUp.abort()
  })
})
