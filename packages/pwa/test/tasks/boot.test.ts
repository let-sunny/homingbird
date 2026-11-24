import { afterEach, describe, expect, it } from 'vitest'
import { locale, strings, useLanguage } from '../../src/strings.ts'
import { boot, startAgain } from '../../src/tasks/boot.ts'
import { fail, settle, testApp } from '../support/app.ts'
import { ANA, ROOM, conversation, everything, me, note } from '../support/fixtures.ts'

afterEach(() => useLanguage('en'))

const empty = {
  'conversations.list': () => ({ conversations: [] }),
  'directory.list': () => ({ entries: [] }),
  'contacts.list': () => ({ contacts: [] }),
  'draftRequests.list': () => ({ requests: [] }),
  'credentials.list': () => ({ credentials: [] }),
  'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
  'reviews.list': () => ({ reviews: [] }),
  'inbox.list': () => ({ items: [] }),
  'debates.list': () => ({ debates: [] }),
  'events.poll': () => ({ events: [], cursor: 0 }),
}

describe('boot', () => {
  it('signs the person in, in their language, then loads their workspace and follows events', async () => {
    const { run, state, routes, page } = testApp({
      ...empty,
      'server.info': () => everything(),
      'me.get': () => me({ locale: 'ko' }),
    })
    page.local.set(`homingbird.composer.${ANA}`, JSON.stringify({ [ROOM]: 'Half a thought' }))
    await run(boot)
    expect(state.session.get()).toEqual(me({ locale: 'ko' }))
    expect(state.composerTexts.get()).toEqual(new Map([[ROOM, 'Half a thought']]))
    expect(locale).toBe('ko')
    expect(routes()).toContain('conversations.list')
    expect(page.listening('online')).toBe(1)
    expect(page.listening('visibilitychange')).toBe(1)
    expect(page.session.get('homingbird.signInCounted')).toBe('1')
  })

  it('shows a note sent while the workspace was loading, and keeps what the person is typing', async () => {
    const late = note('note_late00000000', { body: 'Sent in the gap' })
    let sent = 0
    const { run, state, page } = testApp({
      ...empty,
      'server.info': () => everything(),
      'me.get': () => me(),
      'events.poll': () => ({ events: [], cursor: sent }),
      'conversations.list': () => {
        const listed = sent === 0 ? [] : [conversation({ lastActivityAt: 2 })]
        sent = 1
        return { conversations: listed }
      },
    })
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    page.local.set(`homingbird.composer.${ANA}`, JSON.stringify({ [ROOM]: 'Half a thought' }))
    Object.assign(page.page, {
      fetch: (_url: string, init?: RequestInit) => {
        const after = new Headers(init?.headers).get('last-event-id')
        const missed = after === null ? [] : [{ seq: 1, at: 1, body: { type: 'note.sent', note: late } }]
        const frames = missed
          .filter((event) => event.seq > Number(after))
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        return Promise.resolve(new Response(frames.join('')))
      },
    })
    await run(boot)
    for (let round = 0; round < 5; round++) await settle()
    expect(state.threads.get().get(ROOM)?.notes).toEqual([late])
    expect(state.conversations.get()).toHaveLength(1)
    expect(state.composerTexts.get()).toEqual(new Map([[ROOM, 'Half a thought']]))
    page.emit('offline')
  })

  it('shows sign-in when nobody is signed in, and an unknown language as the browser’s', async () => {
    const out = testApp({
      'server.info': () => everything(),
      'me.get': () => fail({ _tag: 'Unauthorized', message: 'no' }),
    })
    await out.run(boot)
    expect(out.state.session.get()).toBeNull()
    const unknown = testApp({
      ...empty,
      'server.info': () => everything(),
      'me.get': () => me({ locale: 'unknown' }),
    })
    await unknown.run(boot)
    expect(locale).toBe('en')
  })

  it('stops with a notice when the server and this page cannot work together', async () => {
    const { run, state, routes } = testApp({
      'server.info': () => ({ ...everything(), protocolVersion: 99 }),
    })
    await run(boot)
    expect(state.notice.get()).toEqual({ kind: 'error', text: strings.upgrade.client })
    expect(routes()).toEqual(['server.info'])
  })

  describe('when the server is slow to answer', () => {
    const down = fail({ _tag: 'Unavailable', message: 'down' })
    const answers = (...first: unknown[]) => {
      let calls = 0
      return () => (calls < first.length ? first[calls++] : everything())
    }

    it('tries again after a failed request, quietly, and starts once the server answers', async () => {
      const out = testApp({ ...empty, 'server.info': answers(down, down), 'me.get': () => me() })
      const running = out.run(boot)
      await out.clock.advance(500)
      expect(out.state.start.get()).toBe('slow')
      await out.clock.advance(14_500)
      await running
      expect(out.routes().filter((route) => route === 'server.info')).toHaveLength(3)
      expect(out.state.session.get()).toEqual(me())
      expect(out.state.start.get()).toBe('slow')
      out.page.emit('offline')
    })

    it('goes back to loading when the workspace fails after the person is known, and starts one stream and one set of listeners', async () => {
      let listed = 0
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'conversations.list': () => (listed++ === 0 ? down : { conversations: [] }),
      })
      const running = out.run(boot)
      await settle()
      expect(out.state.session.get()).toBe('loading')
      await out.clock.advance(1000)
      await running
      expect(out.state.session.get()).toEqual(me())
      expect(out.page.listening('online')).toBe(1)
      expect(out.page.listening('offline')).toBe(1)
      expect(out.page.listening('visibilitychange')).toBe(1)
      expect(out.routes().filter((route) => route === 'analytics.track').length).toBeLessThanOrEqual(1)
      out.page.emit('offline')
    })

    it('tries again after being rate limited', async () => {
      const limited = fail({ _tag: 'RateLimited', message: 'slow down' })
      const out = testApp({ ...empty, 'server.info': answers(limited), 'me.get': () => me() })
      const running = out.run(boot)
      await out.clock.advance(1000)
      await running
      expect(out.state.session.get()).toEqual(me())
      out.page.emit('offline')
    })

    it('gives up after a few attempts, offering to try again, never signing in', async () => {
      const out = testApp({ 'server.info': () => down })
      const running = out.run(boot)
      await out.clock.advance(15_000)
      await running
      expect(out.routes()).toEqual(Array(5).fill('server.info'))
      expect(out.state.start.get()).toBe('failed')
      expect(out.state.session.get()).toBe('loading')
      expect(out.page.listening('online')).toBe(0)
      expect(out.clock.pending()).toBe(0)
    })

    it('starts again when asked, once, and not while it works', async () => {
      const out = testApp({
        ...empty,
        'server.info': answers(down, down, down, down, down),
        'me.get': () => me(),
      })
      const first = out.run(boot)
      await out.clock.advance(15_000)
      await first
      const again = Promise.all([out.run(startAgain), out.run(startAgain)])
      await again
      expect(out.state.session.get()).toEqual(me())
      expect(out.routes().filter((route) => route === 'me.get')).toHaveLength(1)
      expect(out.page.listening('online')).toBe(1)
      await out.run(startAgain)
      expect(out.routes().filter((route) => route === 'me.get')).toHaveLength(1)
      out.page.emit('offline')
    })

    it('shows sign-in at once when the server says nobody is signed in', async () => {
      const out = testApp({
        'server.info': () => everything(),
        'me.get': () => fail({ _tag: 'Unauthorized', message: 'no' }),
      })
      await out.run(boot)
      expect(out.routes()).toEqual(['server.info', 'me.get'])
      expect(out.state.session.get()).toBeNull()
      expect(out.clock.pending()).toBe(0)
    })

    it('does not show sign-in when the person could not be asked', async () => {
      const out = testApp({
        'server.info': () => everything(),
        'me.get': () => down,
      })
      const running = out.run(boot)
      await out.clock.advance(15_000)
      await running
      expect(out.state.session.get()).toBe('loading')
      expect(out.state.start.get()).toBe('failed')
    })

    it('does not repeat a refusal that waiting cannot change', async () => {
      const out = testApp({
        'server.info': () => everything(),
        'me.get': () => fail({ _tag: 'Forbidden', message: 'no' }),
      })
      await out.run(boot)
      expect(out.routes()).toEqual(['server.info', 'me.get'])
      expect(out.state.start.get()).toBe('failed')
    })

    it('signs the person out when the session ends while the workspace loads', async () => {
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'conversations.list': () => fail({ _tag: 'Unauthorized', message: 'ended' }),
      })
      await out.run(boot)
      expect(out.state.session.get()).toBeNull()
    })
  })
})
