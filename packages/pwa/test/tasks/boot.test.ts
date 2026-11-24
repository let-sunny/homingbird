import { afterEach, describe, expect, it } from 'vitest'
import {
  ATTEMPT_LIMIT_SECONDS,
  QUIET_RETRY_SECONDS,
  STREAM_WAIT_SECONDS,
  TOO_LONG_LOAD_SECONDS,
  USUAL_LOAD_SECONDS,
} from '../../src/load-timing.ts'
import { locale, strings, useLanguage } from '../../src/strings.ts'
import { boot, startAgain } from '../../src/tasks/boot.ts'
import { open } from '../../src/tasks/resources.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { ANA, BEN, ROOM, conversation, entry, everything, me, note } from '../support/fixtures.ts'

afterEach(() => useLanguage('en'))

const USUAL_MS = USUAL_LOAD_SECONDS * 1000
const TOO_LONG_MS = TOO_LONG_LOAD_SECONDS * 1000
const QUIET_RETRY_MS = QUIET_RETRY_SECONDS * 1000

/** Lets the page's live stream, which stays open, be counted, and say what the server holds after a given event. */
const withStreams = (
  out: ReturnType<typeof testApp>,
  frames: (after: string | null) => string = () => '',
) => {
  const streams: string[] = []
  Object.assign(out.page.page, {
    fetch: (url: string, init?: RequestInit) => {
      streams.push(url)
      if (!url.includes('/events/')) return Promise.resolve(new Response(''))
      const said = new TextEncoder().encode(frames(new Headers(init?.headers).get('last-event-id')))
      return Promise.resolve(new Response(new ReadableStream({ start: (stream) => stream.enqueue(said) })))
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

    it('says the workspace takes longer, then too long, with live events started from the first, and clears the line when it answers late', async () => {
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
      expect(streams()).toBe(1)
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
      expect(out.state.threads.get().get(ROOM)?.notes).toEqual([arrived])
      expect(listed).toBe(1)
      first.release({ conversations: [] })
      await running
      for (let round = 0; round < 5; round++) await settle()
      expect(listed).toBe(2)
      expect(out.state.conversations.get()).toHaveLength(1)
      expect(out.state.threads.get().get(ROOM)?.notes).toEqual([arrived])
      out.page.emit('offline')
    })

    it('ends the slow workspace load when asked to try again and loads it afresh, once, without a second stream', async () => {
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
      expect(listed).toBe(2)
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

    describe('when events arrive while the lists are on their way', () => {
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

      it('keeps what they changed in directory, requests and reviews, however late the older answers, without loading everything twice', async () => {
        const firstDirectory = hold<unknown>()
        const firstRequests = hold<unknown>()
        const firstReviews = hold<unknown>()
        const asked = { directory: 0, requests: 0, reviews: 0 }
        const out = testApp({
          ...empty,
          'server.info': () => everything(),
          'me.get': () => me(),
          'events.poll': () => ({ events: [], cursor: 5 }),
          'directory.list': () =>
            asked.directory++ === 0 ? firstDirectory.waiting : { entries: [entryNow] },
          'draftRequests.list': () =>
            asked.requests++ === 0 ? firstRequests.waiting : { requests: [requestNow] },
          'reviews.list': () => (asked.reviews++ === 0 ? firstReviews.waiting : { reviews: [reviewNow] }),
        })
        withStreams(out, eventFrames)
        const running = out.run(boot)
        await out.clock.advance(TOO_LONG_MS)
        for (let round = 0; round < 5; round++) await settle()
        expect(out.state.draftRequests.get()).toEqual([requestNow])
        const seen: string[] = []
        out.state.workspace.subscribe((step) => seen.push(step))
        out.state.notice.subscribe((notice) => seen.push(`notice ${notice?.kind}`))
        firstRequests.release({ requests: [] })
        firstReviews.release({ reviews: [] })
        firstDirectory.release({ entries: [] })
        await running
        for (let round = 0; round < 5; round++) await settle()
        expect(out.state.directory.get()).toEqual([entryNow])
        expect(out.state.draftRequests.get()).toEqual([requestNow])
        expect(out.state.reviews.get()).toEqual([reviewNow])
        expect(asked).toEqual({ directory: 2, requests: 1, reviews: 2 })
        expect(out.routes().filter((route) => route === 'inbox.list')).toHaveLength(1)
        expect(seen).toEqual(['loaded'])
        out.page.emit('offline')
      })

      it('asks for each list once when none arrives', async () => {
        const out = testApp({ ...empty, 'server.info': () => everything(), 'me.get': () => me() })
        withStreams(out)
        await out.run(boot)
        for (let round = 0; round < 5; round++) await settle()
        for (const route of Object.keys(empty))
          expect(
            out.routes().filter((one) => one === route),
            route,
          ).toHaveLength(1)
        out.page.emit('offline')
      })
    })

    describe('the stream of events', () => {
      const started = (answers: { stream?: Promise<Response>; lists?: object } = {}) => {
        const order: string[] = []
        const handlers = { ...empty, ...answers.lists }
        const out = testApp({
          ...Object.fromEntries(
            Object.entries(handlers).map(([route, answer]) => [
              route,
              () => {
                order.push(route)
                return (answer as () => unknown)()
              },
            ]),
          ),
          'server.info': () => everything(),
          'me.get': () => me(),
        })
        Object.assign(out.page.page, {
          fetch: (url: string) => {
            if (!url.includes('/events/')) return Promise.resolve(new Response('{}'))
            order.push('stream')
            return answers.stream ?? Promise.resolve(new Response(new ReadableStream()))
          },
        })
        return { ...out, order }
      }
      const listed = (order: ReadonlyArray<string>) => order.filter((route) => route.endsWith('.list')).length
      const rounds = async () => {
        for (let round = 0; round < 10; round++) await settle()
      }

      it('answers before any list is asked for, also one a page asks for as it is drawn', async () => {
        const answer = hold<Response>()
        const out = started({ stream: (answer.waiting as { waitFor: Promise<Response> }).waitFor })
        out.state.session.subscribe(() => out.app.launch(open('directory', 'debates')))
        out.app.launch(boot)
        await rounds()
        expect(out.state.session.get()).toEqual(me())
        expect(out.order).toEqual(['events.poll', 'stream'])
        answer.release(new Response(new ReadableStream()))
        await rounds()
        expect(out.state.workspace.get()).toBe('loaded')
        expect(out.order.slice(0, 3)).toEqual(['events.poll', 'stream', 'conversations.list'])
        expect(out.order.filter((route) => route === 'directory.list')).toHaveLength(1)
        expect(out.order.filter((route) => route === 'debates.list')).toHaveLength(1)
        out.app.endSession()
      })

      it('holds the lists back no longer than a second, and then what it may have missed is asked for once more', async () => {
        const answer = hold<Response>()
        const out = started({ stream: (answer.waiting as { waitFor: Promise<Response> }).waitFor })
        out.app.launch(boot)
        await rounds()
        await out.clock.advance(STREAM_WAIT_SECONDS * 1000 - 1)
        expect(listed(out.order)).toBe(0)
        await out.clock.advance(1)
        await rounds()
        expect(out.state.workspace.get()).toBe('loaded')
        answer.release(new Response(new ReadableStream()))
        await rounds()
        const times = (route: string) => out.order.filter((one) => one === route).length
        for (const route of [
          'conversations.list',
          'directory.list',
          'channels.list',
          'reviews.list',
          'debates.list',
        ])
          expect(times(route), route).toBe(2)
        for (const route of ['contacts.list', 'draftRequests.list', 'inbox.list'])
          expect(times(route), route).toBe(1)
        expect(out.routes().filter((route) => route === 'me.get')).toHaveLength(1)
        out.app.endSession()
      })

      it('holds nothing back when it cannot be reached', async () => {
        const out = started({ stream: Promise.reject(new Error('down')) })
        out.app.launch(boot)
        await rounds()
        expect(out.state.workspace.get()).toBe('loaded')
        out.app.endSession()
      })

      it('is not waited for, nor is any other list, by a list that never answers: its own attempt ends after the limit', async () => {
        const never = hold<unknown>()
        let asked = 0
        const out = started({
          lists: {
            'conversations.list': () => (asked++ === 0 ? never.waiting : { conversations: [conversation()] }),
          },
        })
        out.app.launch(boot)
        await rounds()
        expect(out.state.connection.get()).toBe('live')
        expect(out.state.directoryLoaded.get()).toBe(true)
        expect(out.state.channelsLoaded.get()).toBe(true)
        expect(out.state.workspace.get()).toBe('loading')
        await out.clock.advance(ATTEMPT_LIMIT_SECONDS * 1000)
        expect(out.state.workspace.get()).toBe('long')
        await out.clock.advance(1000)
        await rounds()
        expect(out.aborted).toEqual(['conversations.list'])
        expect(out.state.workspace.get()).toBe('loaded')
        expect(out.state.conversations.get()).toHaveLength(1)
        out.app.endSession()
      })
    })

    it('keeps the page up with the line alone, and no notice beside it, and one live stream when the server stays away, and loads again without online once it is back', async () => {
      const { out, streams, sessions, running, recover } = await failingWorkspace(down, 15_000)
      expect(sessions).toEqual([me()])
      expect(out.state.workspace.get()).toBe('failed')
      expect(out.state.workspaceRefusal.get()).toBe('')
      expect(out.state.notice.get()).toBeNull()
      expect(streams()).toBe(1)
      expect(out.page.listening('online')).toBe(1)
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

    it('asks afresh at Try again for the lists of the activity that failed or hang, and for no other', async () => {
      const hung = hold<unknown>()
      let asked = 0
      const out = testApp({
        ...empty,
        'server.info': () => everything(),
        'me.get': () => me(),
        'directory.list': () => down,
        'debates.list': () => (asked++ === 0 ? hung.waiting : { debates: [] }),
      })
      withStreams(out)
      out.app.launch(boot)
      await settle()
      await out.run(open('reviews'))
      out.app.launch(open('debates'))
      await out.clock.advance(TOO_LONG_MS)
      await settle()
      expect(out.state.workspace.get()).toBe('failed')
      expect(out.state.debates.load.get().step).toBe('long')
      await out.run(startAgain)
      await settle()
      expect(out.aborted).toContain('debates.list')
      expect(out.state.debates.load.get()).toMatchObject({ loaded: true })
      expect(out.routes().filter((route) => route === 'reviews.list')).toHaveLength(1)
      out.app.endSession()
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
