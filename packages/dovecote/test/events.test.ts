import { Task as T } from '@homingbird/kernel'
import { HEARTBEAT_SECONDS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteEventsBefore, eventsAfter, liveEvents } from '../src/events/events.ts'
import { makeHub } from '../src/events/hub.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

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
    const stream = await server.request('GET', '/api/v1/events/stream?after=0', { token: benAgent.token, signal: hangUp.signal })
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
    const fresh = await server.request('GET', '/api/v1/events/stream', { token: benAgent.token, signal: hangUp.signal })
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
    const stream = await server.request('GET', '/api/v1/events/stream', { token: benAgent.token, signal: hangUp.signal })
    const pending = frames(stream, 1)
    await server.clock.advance(HEARTBEAT_SECONDS * 1000)
    expect(await pending).toEqual([': keep-alive\n\n'])
    hangUp.abort()
  })

  it('ends the stream at the next heartbeat after the credential is revoked', async () => {
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', { token: benAgent.token, signal: hangUp.signal })
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
      for await (const event of hub.subscribe('mem_watcher000000' as never, 'hidden', watcher.signal)) seen.push(event.body)
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
    expect(seen).toEqual([{ type: 'presence', members: [{ memberId: member, humanOnline: false, agentOnline: true }] }])
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
    for (let index = 0; index < 3000; index++) hub.publish(member, { seq: index + 1, at: 0, body: { type: 'resync' } })
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
