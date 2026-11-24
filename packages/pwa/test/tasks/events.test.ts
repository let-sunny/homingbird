import { describe, expect, it } from 'vitest'
import { followEvents, latestEvent } from '../../src/tasks/events.ts'
import { settle, testApp } from '../support/app.ts'
import { BEN } from '../support/fixtures.ts'

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
      'contacts.list': () => ({ contacts: [] }),
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
