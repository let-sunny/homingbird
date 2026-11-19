import { describe, expect, it } from 'vitest'
import { followEvents } from '../../src/tasks/events.ts'
import { settle, testApp } from '../support/app.ts'
import { BEN } from '../support/fixtures.ts'

const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })

describe('followEvents', () => {
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
    await app.run(followEvents)
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
    await refused.run(followEvents)
    await settle()
    expect(refused.state.connection.get()).toBe('offline')
    refused.page.emit('offline')
    const unreachable = testApp()
    Object.assign(unreachable.page.page, { fetch: () => Promise.reject(new Error('down')) })
    await unreachable.run(followEvents)
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
    await polling.run(followEvents)
    for (let round = 0; round < 4; round++) {
      await settle()
      await polling.clock.advance(60_000)
    }
    expect(calls).toBeGreaterThan(3)
    expect(polling.state.connection.get()).toBe('polling')
    polling.page.emit('offline')
  })
})
