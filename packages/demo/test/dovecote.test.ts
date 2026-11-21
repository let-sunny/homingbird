import { eventStream } from '@homingbird/client'
import { Stream, Task as T, makeTestClock } from '@homingbird/kernel'
import {
  API_PREFIX,
  type AsRead,
  FEATURE_OFF_MESSAGE,
  NOTE_BODY_MAX,
  STREAM_PATHS,
  isFeatureOffered,
} from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { BRANDING, fakeDovecote } from '../src/dovecote.ts'
import { DEMO_REFUSAL } from '../src/handlers.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

describe('fakeDovecote', () => {
  it('answers every read the web client makes as it starts and on the pages the demo shows', async () => {
    const { api, world } = demoApi()
    const room = noteStarting(world, 'Is the billing migration safe').conversationId
    const reads = [
      api['server.info']({}),
      api['me.get']({}),
      api['conversations.list']({}),
      api['directory.list']({ query: {} }),
      api['contacts.list']({}),
      api['credentials.list']({}),
      api['channels.list']({ query: { limit: '200' } }),
      api['reviews.list']({}),
      api['drafts.list']({}),
      api['conversations.notes']({ params: { id: room }, query: {} }),
      api['channels.get']({ params: { slug: 'billing' } }),
      api['channels.members.list']({ params: { slug: 'billing' } }),
      api['channels.agent.get']({ params: { slug: 'billing' } }),
      api['channels.agent.figures']({ params: { slug: 'billing' } }),
      api['groups.list']({}),
      api['insights.mine']({}),
      api['principles.list']({}),
      api['answeringFlow.get']({}),
      api['search.notes']({ query: { q: 'refund' } }),
    ] as const
    for (const read of reads) expect(await refused(read as T.Task<unknown, never>)).toBeNull()
  })

  it('offers only the features it answers, and answers 404 for the others as a server that turned them off', async () => {
    const { api } = demoApi()
    const info = await succeeded(api['server.info']({}))
    expect(isFeatureOffered(info, 'channelAgents')).toBe(true)
    expect(isFeatureOffered(info, 'cloudDesk')).toBe(false)
    expect(await refused(api['me.deskWake.get']({}))).toEqual({
      _tag: 'NotFound',
      message: FEATURE_OFF_MESSAGE,
    })
    expect(await refused(api['draftRequests.list']({}))).toMatchObject({ _tag: 'NotFound' })
  })

  it('refuses a member what only an administrator does, and says the demo does not do what it leaves out', async () => {
    const { api, world } = demoApi()
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(await refused(kai.api['admin.insights']({}))).toMatchObject({ _tag: 'Forbidden' })
    expect(await refused(api['admin.insights']({}))).toBeNull()
    expect(await refused(api['channels.askPrivately']({ params: { slug: 'billing' } }))).toEqual(DEMO_REFUSAL)
    expect(await refused(api['blocks.add']({ params: { memberId: 'mem_demoana00000' } }))).toEqual(
      DEMO_REFUSAL,
    )
  })

  it('decodes a request as strictly as the server, and answers an unknown route with 404', async () => {
    const { api, fetch } = demoApi()
    const tooLong = 'x'.repeat(NOTE_BODY_MAX + 1)
    expect(
      await refused(api['drafts.create']({ body: { body: tooLong, channel: 'billing' } })),
    ).toMatchObject({
      _tag: 'Invalid',
    })
    const junk = await T.runPromise(
      T.promise(() => fetch(`http://demo.test${API_PREFIX}/drafts`, { method: 'POST', body: '{not json' })),
    )
    expect(junk.status).toBe(400)
    const nowhere = await T.runPromise(T.promise(() => fetch(`http://demo.test${API_PREFIX}/nowhere`)))
    expect(nowhere.status).toBe(404)
    const outside = await T.runPromise(T.promise(() => fetch('/somewhere-else')))
    expect(outside.status).toBe(404)
  })

  it('refuses to answer outside the contract, so a mistake in the demo shows instead of reaching the page', async () => {
    const world = createWorld(makeTestClock(NOW))
    world.update((records) => ({
      ...records,
      members: records.members.map((each) => ({
        ...each,
        presence: { humanOnline: 'yes' as never, agentOnline: false },
      })),
    }))
    const { api } = demoApi(undefined, world)
    expect(await refused(api['directory.list']({ query: {} }))).toMatchObject({
      _tag: 'Unavailable',
      message: expect.stringMatching(/^The demo answered directory.list outside the contract/),
    })
  })

  it('serves the branding beside the page, and a sign-out that keeps nothing', async () => {
    const { fetch } = demoApi()
    const branding = await T.runPromise(
      T.promise(() => fetch('/branding.json').then((response) => response.json())),
    )
    expect(branding).toEqual(BRANDING)
    const out = await T.runPromise(T.promise(() => fetch('/auth/logout', { method: 'POST' })))
    expect(out.ok).toBe(true)
  })

  it('streams the viewer’s events as they happen, and the ones it missed when it comes back', async () => {
    const clock = makeTestClock(NOW)
    const { api, world, fetch } = demoApi(undefined, createWorld(clock))
    const draft = noteStarting(world, 'Yes. I checked')
    await succeeded(api['notes.read']({ params: { id: noteStarting(world, 'Heads up').id } }))
    const held = new AbortController()
    const arrived: AsRead.KnownEvent[] = []
    const following = T.run(
      Stream.forEach((event: AsRead.KnownEvent) =>
        T.sync(() => {
          arrived.push(event)
          if (arrived.length === 3) held.abort()
        }),
      )(
        eventStream({ serverUrl: 'http://demo.test', fetch, clock, heartbeat: false, after: 0 }, held.signal),
      ),
    )
    await clock.flush()
    await succeeded(
      api['drafts.send']({
        params: { id: draft.id },
        body: { expected: { body: draft.body, conversationId: draft.conversationId } },
      }),
    )
    await following
    expect(arrived.map((event) => event.body.type)).toEqual(['note.status', 'note.sent', 'note.status'])
    expect(arrived.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('starts the stream after the last event the client read', async () => {
    const { world, fetch, viewerId } = demoApi()
    world.emit([viewerId], { type: 'contact.changed', memberId: memberNamed(world, 'Ana Silva') })
    world.emit([viewerId], { type: 'contact.changed', memberId: memberNamed(world, 'Kai Lin') })
    const held = new AbortController()
    const response = await T.runPromise(
      T.promise(() =>
        fetch(`http://demo.test${STREAM_PATHS.sse}`, {
          headers: { 'last-event-id': '1' },
          signal: held.signal,
        }),
      ),
    )
    const reader = response.body!.getReader()
    const text = await T.runPromise(
      T.promise(() => reader.read().then((first) => reader.read().then((second) => [first, second]))),
    )
    const decoded = text.map((chunk) => new TextDecoder().decode(chunk.value))
    expect(decoded[0]).toBe(': connected\n\n')
    expect(decoded[1]).toMatch(/^id: 2\nevent: contact.changed\n/)
    held.abort()
    expect((await T.runPromise(T.promise(() => reader.read()))).done).toBe(true)
  })
})
