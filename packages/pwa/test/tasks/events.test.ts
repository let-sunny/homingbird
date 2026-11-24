import { describe, expect, it } from 'vitest'
import { followEvents, latestEvent } from '../../src/tasks/events.ts'
import { settle, testApp } from '../support/app.ts'
import { BEN, ROOM, me, serverInfo } from '../support/fixtures.ts'

const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })

/** A stream that answers with no event yet and stays open, noting where each connection resumes from. */
const quietStream = () => {
  const resumedFrom: Array<string | null> = []
  const fetch = (_url: string, init?: RequestInit) => {
    resumedFrom.push(new Headers(init?.headers).get('last-event-id'))
    return Promise.resolve(new Response(new ReadableStream()))
  }
  return { resumedFrom, fetch }
}

describe('latestEvent', () => {
  it('asks for the newest event’s number from past the end, so no event comes with it', async () => {
    const app = testApp({ 'events.poll': () => ({ events: [], cursor: 41 }) })
    expect(await app.run(latestEvent)).toEqual({ _tag: 'Ok', value: 41 })
    expect(app.sent).toEqual([{ route: 'events.poll', request: { query: { after: '999999999999999' } } }])
  })
})

describe('followEvents', () => {
  it.each([41, 0])(
    'resumes from the event it starts after, %i, at first and after offline and online again',
    async (after) => {
      const app = testApp()
      const { resumedFrom, fetch } = quietStream()
      Object.assign(app.page.page, { fetch })
      await app.run(followEvents(after))
      await settle()
      app.page.emit('offline')
      app.page.emit('online')
      await settle()
      expect(resumedFrom).toEqual([String(after), String(after)])
      app.page.emit('offline')
    },
  )

  it('resumes after offline and online again from the last event that arrived', async () => {
    const app = testApp()
    const { resumedFrom, fetch } = quietStream()
    let opened = 0
    Object.assign(app.page.page, {
      fetch: (url: string, init?: RequestInit) => {
        const quiet = fetch(url, init)
        return opened++ === 0
          ? Promise.resolve(
              sse(
                { seq: 42, at: 1, body: { type: 'contact.changed', memberId: BEN } },
                { seq: 0, at: 1, body: { type: 'presence', members: [] } },
              ),
            )
          : quiet
      },
    })
    await app.run(followEvents(41))
    for (let round = 0; round < 5; round++) await settle()
    app.page.emit('offline')
    app.page.emit('online')
    await settle()
    expect(resumedFrom).toEqual(['41', '42'])
    app.page.emit('offline')
  })

  it('applies each live event, and says the stream is live', async () => {
    const app = testApp({
      'directory.list': () => ({ entries: [] }),
    })
    const asked: string[] = []
    Object.assign(app.page.page, {
      fetch: (url: string) => {
        asked.push(url)
        return Promise.resolve(sse({ seq: 4, at: 1, body: { type: 'contact.changed', memberId: BEN } }))
      },
    })
    await app.run(followEvents(0))
    for (let round = 0; round < 5; round++) await settle()
    expect(app.state.connection.get()).toBe('live')
    expect(app.routes()).toContain('directory.list')
    expect(asked[0]).toBe('http://localhost/api/v1/events/stream')
    app.page.emit('offline')
    expect(app.state.connection.get()).toBe('offline')
    app.page.emit('online')
    expect(app.state.connection.get()).toBe('connecting')
    await settle()
    app.page.emit('offline')
  })

  it('says the page is offline when the stream is refused or cannot be reached, and polling when it polls', async () => {
    const refused = testApp()
    Object.assign(refused.page.page, { fetch: () => Promise.resolve(new Response('', { status: 503 })) })
    await refused.run(followEvents(0))
    await settle()
    expect(refused.state.connection.get()).toBe('offline')
    refused.page.emit('offline')
    const unreachable = testApp()
    Object.assign(unreachable.page.page, { fetch: () => Promise.reject(new Error('down')) })
    await unreachable.run(followEvents(0))
    await settle()
    expect(unreachable.state.connection.get()).toBe('offline')
    unreachable.page.emit('offline')
    const polling = testApp()
    let calls = 0
    Object.assign(polling.page.page, {
      fetch: (url: string) => {
        calls++
        return url.includes('/poll')
          ? Promise.resolve(
              new Response(JSON.stringify({ events: [], resumeAt: 0 }), {
                headers: { 'content-type': 'application/json' },
              }),
            )
          : Promise.reject(new Error('no stream'))
      },
    })
    await polling.run(followEvents(0))
    for (let round = 0; round < 4; round++) {
      await settle()
      await polling.clock.advance(60_000)
    }
    expect(calls).toBeGreaterThan(3)
    expect(polling.state.connection.get()).toBe('polling')
    polling.page.emit('offline')
  })
})

describe('a preview of a draft discarded while events cannot arrive', () => {
  const PREVIEW = { noteId: 'note_p1', conversationId: ROOM, state: 'unconfirmed', body: 'Early words' }

  /** A page that shows a preview, live, and a server whose author discards the draft when told to. */
  const livePage = async () => {
    let isDiscarded = false
    let respond: () => Promise<Response> = () => Promise.resolve(new Response(new ReadableStream()))
    const out = testApp({
      'me.get': () => me(),
      'previews.list': () => ({ previews: isDiscarded ? [] : [PREVIEW] }),
    })
    out.state.session.set(me())
    out.state.serverInfo.set(serverInfo({ draftPreviews: true }))
    out.state.previews.set(new Map([[ROOM, [PREVIEW as never]]]))
    Object.assign(out.page.page, {
      fetch: (url: string) =>
        url.includes('/poll') ? Promise.resolve(Response.json({ events: [], cursor: 0 })) : respond(),
    })
    const pass = async (ms: number) => {
      for (let round = 0; round < 5; round++) await settle()
      await out.clock.advance(ms)
      for (let round = 0; round < 5; round++) await settle()
    }
    return {
      ...out,
      pass,
      discard: () => {
        isDiscarded = true
      },
      streamsAnswer: (answer: () => Promise<Response>) => {
        respond = answer
      },
      shown: () => out.state.previews.get().get(ROOM),
    }
  }

  it('is gone after offline and online again, and is not shown meanwhile', async () => {
    const { run, page, pass, discard, shown } = await livePage()
    await run(followEvents(0))
    await pass(0)
    expect(shown()).toHaveLength(1)
    page.emit('offline')
    expect(shown()).toEqual([])
    discard()
    page.emit('online')
    await pass(0)
    expect(shown()).toEqual([])
    page.emit('offline')
  })

  it('is gone after the stream ended and opened again, where one still waiting comes back', async () => {
    const { run, page, pass, discard, shown, streamsAnswer } = await livePage()
    const ends: Array<() => void> = []
    streamsAnswer(() =>
      Promise.resolve(
        new Response(new ReadableStream({ start: (stream) => void ends.push(() => stream.close()) })),
      ),
    )
    await run(followEvents(0))
    await pass(0)
    ends[0]!()
    await pass(60_000)
    expect(shown()).toHaveLength(1)
    discard()
    ends[1]!()
    await pass(60_000)
    expect(shown()).toEqual([])
    page.emit('offline')
  })

  it('is gone once the stream that broke while the computer slept is refused, and while the page polls', async () => {
    const { run, page, pass, discard, shown, streamsAnswer, state } = await livePage()
    let fail = (): void => {}
    streamsAnswer(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start: (stream) => {
              fail = () => stream.error(new Error('broken'))
            },
          }),
        ),
      ),
    )
    await run(followEvents(0))
    await pass(0)
    streamsAnswer(() => Promise.resolve(new Response('', { status: 503 })))
    fail()
    await pass(2_000)
    expect(shown()).toEqual([])
    for (let round = 0; round < 4; round++) await pass(60_000)
    expect(state.connection.get()).toBe('polling')
    expect(shown()).toHaveLength(1)
    discard()
    for (let round = 0; round < 4; round++) await pass(1_000)
    expect(shown()).toEqual([])
    page.emit('offline')
  })
})
