import { afterEach, describe, expect, it } from 'vitest'
import { QUIET_RETRY_SECONDS, TOO_LONG_LOAD_SECONDS, USUAL_LOAD_SECONDS } from '../../src/load-timing.ts'
import { locale, strings, useLanguage } from '../../src/strings.ts'
import { boot, startAgain } from '../../src/tasks/boot.ts'
import { DIRECTORY_SETTLE_MS } from '../../src/tasks/live.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { ANA, BEN, ROOM, conversation, entry, everything, me, note } from '../support/fixtures.ts'

afterEach(() => useLanguage('en'))

const USUAL_MS = USUAL_LOAD_SECONDS * 1000
const TOO_LONG_MS = TOO_LONG_LOAD_SECONDS * 1000
const QUIET_RETRY_MS = QUIET_RETRY_SECONDS * 1000

/** Lets the page's live stream be counted, and say what the server holds after a given event. */
const withStreams = (
  out: ReturnType<typeof testApp>,
  frames: (after: string | null) => string = () => '',
) => {
  const streams: string[] = []
  Object.assign(out.page.page, {
    fetch: (url: string, init?: RequestInit) => {
      streams.push(url)
      return Promise.resolve(new Response(frames(new Headers(init?.headers).get('last-event-id'))))
    },
  })
  return () => streams.filter((url) => url.includes('/events/stream')).length
}

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
      expect(out.state.startRetrying.get()).toBe(true)
      await out.clock.advance(14_500)
      await running
      expect(out.routes().filter((route) => route === 'server.info')).toHaveLength(3)
      expect(out.state.session.get()).toEqual(me())
      out.page.emit('offline')
    })

    it('says what is usual, then that it takes too long, while the attempt goes on, and goes on by itself when it answers', async () => {
      const server = hold<unknown>()
      const out = testApp({ ...empty, 'server.info': () => server.waiting, 'me.get': () => me() })
      const running = out.run(boot)
      await out.clock.advance(USUAL_MS - 1)
      expect(out.state.start.get()).toBe('loading')
      await out.clock.advance(1)
      expect(out.state.start.get()).toBe('slow')
      await out.clock.advance(TOO_LONG_MS - USUAL_MS)
      expect(out.state.start.get()).toBe('long')
      expect(out.state.session.get()).toBe('loading')
      server.release(everything())
      await running
      expect(out.state.session.get()).toEqual(me())
      out.page.emit('offline')
    })

    it('ends the running attempt when asked to try again, and starts exactly one fresh one', async () => {
      const server = hold<unknown>()
      let asked = 0
      const out = testApp({
        ...empty,
        'server.info': () => (asked++ === 0 ? server.waiting : everything()),
        'me.get': () => me(),
      })
      const streams = withStreams(out)
      const running = out.run(boot)
      await out.clock.advance(TOO_LONG_MS)
      expect(out.state.start.get()).toBe('long')
      await out.run(startAgain)
      await out.run(startAgain)
      await running
      expect(out.aborted).toEqual(['server.info'])
      expect(out.routes().filter((route) => route === 'server.info')).toHaveLength(2)
      expect(out.state.session.get()).toEqual(me())
      expect(out.routes().filter((route) => route === 'me.get')).toHaveLength(1)
      expect(streams()).toBe(1)
      expect(out.page.listening('online')).toBe(1)
      expect(out.page.listening('visibilitychange')).toBe(1)
      server.release(everything())
      await settle()
      expect(out.routes().filter((route) => route === 'me.get')).toHaveLength(1)
      out.page.emit('offline')
    })

    it('keeps the page up while the workspace is retried, never back to loading, with one stream and one set of listeners', async () => {
      let listed = 0
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'conversations.list': () => (listed++ === 0 ? down : { conversations: [] }),
      })
      const sessions: unknown[] = []
      out.state.session.subscribe((session) => sessions.push(session))
      const running = out.run(boot)
      await out.clock.advance(1000)
      await running
      expect(sessions).toEqual([me()])
      expect(out.state.workspace.get()).toBe('loaded')
      expect(out.state.conversationsLoaded.get()).toBe(true)
      expect(out.page.listening('online')).toBe(1)
      expect(out.page.listening('offline')).toBe(1)
      expect(out.page.listening('visibilitychange')).toBe(1)
      expect(out.routes().filter((route) => route === 'analytics.track').length).toBeLessThanOrEqual(1)
      out.page.emit('offline')
    })

    it('says the workspace takes longer, then too long, with live events started, and clears the line when it answers late', async () => {
      const list = hold<unknown>()
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'conversations.list': () => list.waiting,
      })
      const streams = withStreams(out)
      const sessions: unknown[] = []
      out.state.session.subscribe((session) => sessions.push(session))
      const running = out.run(boot)
      await out.clock.advance(USUAL_MS)
      expect(out.state.workspace.get()).toBe('slow')
      expect(streams()).toBe(0)
      await out.clock.advance(TOO_LONG_MS - USUAL_MS)
      expect(out.state.workspace.get()).toBe('long')
      expect(streams()).toBe(1)
      expect(sessions).toEqual([me()])
      list.release({ conversations: [] })
      await running
      expect(out.state.workspace.get()).toBe('loaded')
      expect(out.state.conversationsLoaded.get()).toBe(true)
      expect(streams()).toBe(1)
      out.page.emit('offline')
    })

    it('keeps a note that arrives during a slow load, however late the older list answers', async () => {
      const first = hold<unknown>()
      const arrived = note('note_late00000000', { body: 'Arrived during the load' })
      let listed = 0
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'events.poll': () => ({ events: [], cursor: 5 }),
        'conversations.list': () =>
          listed++ === 0 ? first.waiting : { conversations: [conversation({ lastActivityAt: 2 })] },
      })
      out.state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
      withStreams(out, (after) =>
        after === '5'
          ? `data: ${JSON.stringify({ seq: 6, at: 1, body: { type: 'note.sent', note: arrived } })}\n\n`
          : '',
      )
      const running = out.run(boot)
      await out.clock.advance(TOO_LONG_MS)
      for (let round = 0; round < 5; round++) await settle()
      expect(out.state.conversations.get()).toHaveLength(1)
      expect(out.state.threads.get().get(ROOM)?.notes).toEqual([arrived])
      first.release({ conversations: [] })
      await running
      expect(out.state.conversations.get()).toHaveLength(1)
      expect(out.state.threads.get().get(ROOM)?.notes).toEqual([arrived])
      out.page.emit('offline')
    })

    it('ends the slow workspace load when asked to try again and loads it afresh, then once more quietly, without a second stream', async () => {
      const first = hold<unknown>()
      let listed = 0
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'conversations.list': () => (listed++ === 0 ? first.waiting : { conversations: [] }),
      })
      const streams = withStreams(out)
      const running = out.run(boot)
      await out.clock.advance(TOO_LONG_MS)
      expect(out.state.workspace.get()).toBe('long')
      await out.run(startAgain)
      await running
      expect(out.aborted).toContain('conversations.list')
      expect(listed).toBe(3)
      expect(out.state.workspace.get()).toBe('loaded')
      expect(streams()).toBe(1)
      expect(out.page.listening('online')).toBe(1)
      out.page.emit('offline')
    })

    const failingWorkspace = async (refusal: unknown, waits: number) => {
      let recovered = false
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'contacts.list': () => (recovered ? { contacts: [] } : refusal),
      })
      const streams = withStreams(out)
      const sessions: unknown[] = []
      out.state.session.subscribe((session) => sessions.push(session))
      const running = out.run(boot)
      await out.clock.advance(waits)
      return { out, streams, sessions, running, recover: () => (recovered = true) }
    }

    describe('when a load finishes after the live events started', () => {
      const entryNow = entry(BEN, 'Ben', { presence: { humanOnline: true, agentOnline: false } })
      const requestNow = {
        id: 'dreq_000000000000',
        conversationId: ROOM,
        inReplyTo: null,
        instruction: '',
        agentId: null,
        createdAt: 1,
        expiresAt: 2,
        cancelledAt: null,
        draftIds: [],
      } as const
      const reviewNow = { note: note('note_answer00000'), question: note('note_question000') } as never
      const eventFrames = (after: string | null) =>
        after === '5'
          ? [
              { seq: 6, at: 1, body: { type: 'draft.requested', request: requestNow } },
              { seq: 7, at: 1, body: { type: 'directory.changed', memberId: BEN } },
              { seq: 8, at: 1, body: { type: 'review.changed', noteId: null } },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join('')
          : ''

      const slowFirstLoad = () => {
        const firstDirectory = hold<unknown>()
        let directoryCalls = 0
        let requestCalls = 0
        const out = testApp({
          ...empty,
          'server.info': () => everything(),
          'me.get': () => me(),
          'events.poll': () => ({ events: [], cursor: 5 }),
          'directory.list': () => (directoryCalls++ === 0 ? firstDirectory.waiting : { entries: [entryNow] }),
          'draftRequests.list': () => ({ requests: requestCalls++ === 0 ? [] : [requestNow] }),
          'reviews.list': () => ({
            reviews: out.routes().filter((route) => route === 'inbox.list').length === 1 ? [] : [reviewNow],
          }),
        })
        withStreams(out, eventFrames)
        return { out, firstDirectory }
      }

      it('loads the workspace once more, quietly, so what the events changed is kept in directory, requests and reviews', async () => {
        const { out, firstDirectory } = slowFirstLoad()
        const running = out.run(boot)
        await out.clock.advance(TOO_LONG_MS)
        for (let round = 0; round < 5; round++) await settle()
        await out.clock.advance(DIRECTORY_SETTLE_MS)
        for (let round = 0; round < 5; round++) await settle()
        expect(out.state.draftRequests.get()).toEqual([requestNow])
        expect(out.state.directory.get()).toEqual([entryNow])
        const seen: string[] = []
        out.state.workspace.subscribe((step) => seen.push(step))
        out.state.notice.subscribe((notice) => seen.push(`notice ${notice?.kind}`))
        firstDirectory.release({ entries: [] })
        await running
        expect(out.routes().filter((route) => route === 'inbox.list')).toHaveLength(2)
        expect(out.routes().filter((route) => route === 'draftRequests.list')).toHaveLength(2)
        expect(out.state.directory.get()).toEqual([entryNow])
        expect(out.state.draftRequests.get()).toEqual([requestNow])
        expect(out.state.reviews.get()).toEqual([reviewNow])
        expect(seen).toEqual(['loaded'])
        out.page.emit('offline')
      })

      it('does not load again when the load finished before the events started', async () => {
        const out = testApp({ ...empty, 'server.info': () => everything(), 'me.get': () => me() })
        await out.run(boot)
        for (let round = 0; round < 5; round++) await settle()
        expect(out.routes().filter((route) => route === 'inbox.list')).toHaveLength(1)
        out.page.emit('offline')
      })

      it('gives up on the quiet load after the limit and says nothing, leaving the page as it was', async () => {
        const first = hold<unknown>()
        const never = hold<unknown>()
        let directoryCalls = 0
        const out = testApp({
          ...empty,
          'server.info': () => everything(),
          'me.get': () => me(),
          'directory.list': () => (directoryCalls++ === 0 ? first.waiting : never.waiting),
        })
        withStreams(out)
        const running = out.run(boot)
        await out.clock.advance(TOO_LONG_MS)
        first.release({ entries: [] })
        for (let round = 0; round < 5; round++) await settle()
        expect(directoryCalls).toBe(2)
        expect(out.state.workspace.get()).toBe('loaded')
        await out.clock.advance(TOO_LONG_MS)
        await running
        expect(out.aborted).toContain('directory.list')
        expect(out.state.workspace.get()).toBe('loaded')
        expect(out.state.notice.get()).toBeNull()
        out.page.emit('offline')
      })

      it('loads once more, quietly, after the quiet retry of a failed workspace finishes with the events live', async () => {
        const { out, streams, running, recover } = await failingWorkspace(down, 15_000)
        expect(streams()).toBe(1)
        expect(out.routes().filter((route) => route === 'inbox.list')).toHaveLength(0)
        recover()
        await out.clock.advance(QUIET_RETRY_MS)
        await running
        expect(out.routes().filter((route) => route === 'inbox.list')).toHaveLength(2)
        expect(out.state.workspace.get()).toBe('loaded')
        out.page.emit('offline')
      })
    })

    it('keeps the page up with a notice, the line and one live stream when the server stays away, and loads again without online once it is back', async () => {
      const { out, streams, sessions, running, recover } = await failingWorkspace(down, 15_000)
      expect(sessions).toEqual([me()])
      expect(out.state.workspace.get()).toBe('failed')
      expect(out.state.workspaceRefusal.get()).toBe('')
      expect(out.state.notice.get()?.kind).toBe('error')
      expect(streams()).toBe(1)
      expect(out.page.listening('online')).toBe(2)
      recover()
      await out.clock.advance(QUIET_RETRY_MS)
      await running
      expect(out.state.workspace.get()).toBe('loaded')
      expect(out.state.directoryLoaded.get()).toBe(true)
      expect(out.page.listening('online')).toBe(1)
      expect(sessions).toEqual([me()])
      out.page.emit('offline')
    })

    it('loads the failed workspace on online and on Try again, and does not call a refusal a lost connection', async () => {
      const { out, streams, running, recover } = await failingWorkspace(
        fail({ _tag: 'Forbidden', message: 'No contacts for you.' }),
        0,
      )
      await settle()
      expect(out.routes().filter((route) => route === 'contacts.list')).toHaveLength(1)
      expect(out.state.workspace.get()).toBe('failed')
      expect(out.state.workspaceRefusal.get()).not.toBe('')
      expect(out.state.workspaceRefusal.get()).not.toBe(strings.firstLoad.failed)
      expect(streams()).toBe(1)
      await out.clock.advance(QUIET_RETRY_MS * 3)
      expect(out.routes().filter((route) => route === 'contacts.list')).toHaveLength(1)
      await out.run(startAgain)
      await settle()
      expect(out.routes().filter((route) => route === 'contacts.list')).toHaveLength(2)
      recover()
      out.page.emit('online')
      await running
      expect(out.state.workspace.get()).toBe('loaded')
      expect(out.page.listening('online')).toBe(1)
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

    it('does not repeat a refusal that waiting cannot change, and does not blame the connection', async () => {
      const out = testApp({
        'server.info': () => everything(),
        'me.get': () => fail({ _tag: 'Forbidden', message: 'This account may not use this server.' }),
      })
      await out.run(boot)
      expect(out.routes()).toEqual(['server.info', 'me.get'])
      expect(out.state.start.get()).toBe('refused')
      expect(out.state.startRefusal.get()).not.toBe('')
      expect(out.state.startRefusal.get()).not.toBe(strings.firstLoad.failed)
      expect(out.state.session.get()).toBe('loading')
    })

    const refusedKinds = [
      { _tag: 'Forbidden', message: 'This account may not use this server.' },
      { _tag: 'NotFound', message: 'Not found' },
      { _tag: 'Invalid', message: 'Invalid' },
      { _tag: 'Conflict', message: 'Conflict' },
    ] as const

    it.each(refusedKinds)(
      'says a refusal of the first screen ($_tag) in a sentence of the page’s language, never the server’s English',
      async (refusal) => {
        useLanguage('ko')
        const out = testApp({ 'server.info': () => everything(), 'me.get': () => fail(refusal) })
        await out.run(boot)
        expect(out.state.start.get()).toBe('refused')
        expect(out.state.startRefusal.get()).toBe(strings.firstLoad.refused[refusal._tag])
        expect(out.state.startRefusal.get()).not.toContain(refusal.message)
        expect(out.state.startRefusal.get()).not.toContain('메시지')
        expect(out.state.startRefusal.get()).toMatch(/[가-힣]/)
      },
    )

    it.each(refusedKinds)(
      'says a refusal ($_tag) in English with the server’s words only when they say more',
      async (refusal) => {
        const out = testApp({ 'server.info': () => everything(), 'me.get': () => fail(refusal) })
        await out.run(boot)
        expect(out.state.startRefusal.get()).toBe(
          refusal.message.length > 12 ? refusal.message : strings.firstLoad.refused[refusal._tag],
        )
      },
    )

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
