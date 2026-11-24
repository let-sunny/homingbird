import { httpApi } from '@homingbird/client'
import { Task as T, makeTestClock } from '@homingbird/kernel'
import type { AsRead, DraftRequest, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { discardReview } from '../../src/tasks/channel-agents.ts'
import { loadChannelPage, openChannelPage, reloadChannelPage } from '../../src/tasks/channels.ts'
import { leaveGroup } from '../../src/tasks/conversation-actions.ts'
import { dismissSuggestion } from '../../src/tasks/debate-suggestions.ts'
import { liveEvents } from '../../src/tasks/live.ts'
import { type ResourceKey, again, invalidate, open, refresh, reread } from '../../src/tasks/resources.ts'
import { againWhatIsStuck } from '../../src/tasks/try-again.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import {
  ANA,
  BEN,
  ROOM,
  TEAM,
  channel,
  conversation,
  credential,
  draft,
  entry,
  everything,
  group,
  me,
  member,
  serverInfo,
  suggestion,
  summary,
} from '../support/fixtures.ts'

const review = (id: string): AsRead.Review => ({
  note: draft(id, { inReplyTo: 'note_question000' as NoteId }),
  question: null,
  channel: 'wiki',
  agent: member(ANA, 'Wiki'),
  privately: false,
})

const ROUTES = {
  conversations: 'conversations.list',
  directory: 'directory.list',
  channels: 'channels.list',
  agentCredentials: 'credentials.list',
  draftRequests: 'draftRequests.list',
  awaitingReply: 'inbox.list',
  reviews: 'reviews.list',
  suggestions: 'debateSuggestions.list',
  debates: 'debates.list',
  groups: 'groups.list',
} as const satisfies Record<Exclude<ResourceKey, 'channelPage' | PageKey>, string>

/** What one page shows, which is none until it is asked for and is not a list. */
type PageKey = 'taught' | 'agentReport' | 'interview' | 'credentials'

const KEYS = Object.keys(ROUTES) as Array<keyof typeof ROUTES>

const lists = {
  'conversations.list': () => ({ conversations: [conversation()] }),
  'directory.list': () => ({ entries: [entry(BEN, 'Ben')] }),
  'channels.list': () => ({ channels: [channel('billing')], hasMore: false, cursor: null }),
  'credentials.list': () => ({
    credentials: [
      credential('cred_agent'),
      credential('cred_web', { kind: 'human' }),
      credential('cred_old', { revokedAt: 1 }),
    ],
  }),
  'draftRequests.list': () => ({ requests: [REQUEST] }),
  'inbox.list': () => ({ items: [{ conversation: conversation() }] }),
  'reviews.list': () => ({ reviews: [review('note_a')] }),
  'debateSuggestions.list': () => ({ suggestions: [suggestion()] }),
  'debates.list': () => ({ debates: [summary()] }),
  'groups.list': () => ({ groups: [group(TEAM, { memberIds: [BEN] })] }),
}

const REQUEST = {
  id: 'dreq_000000000000',
  conversationId: ROOM,
  inReplyTo: null,
  instruction: '',
  agentId: null,
  createdAt: 1,
  expiresAt: 2,
  cancelledAt: null,
  draftIds: [],
} as unknown as DraftRequest

const start = (handlers: Parameters<typeof testApp>[0] = {}) => {
  const test = testApp({ ...(lists as Parameters<typeof testApp>[0]), ...handlers })
  test.state.session.set(me())
  test.state.serverInfo.set(everything())
  return test
}

describe('the resources', () => {
  it('are each asked for by their own route, once however many places open them together', async () => {
    const { run, routes, state } = start()
    await Promise.all([run(open(...KEYS)), run(open(...KEYS)), run(open('debates'))])
    expect([...routes()].sort()).toEqual(Object.values(ROUTES).sort())
    expect(state.conversations.get()).toEqual([conversation()])
    expect(state.directory.get()).toEqual([entry(BEN, 'Ben')])
    expect(state.channels.get()).toEqual([channel('billing')])
    expect(state.agentCredentials.get().map((one) => one.id)).toEqual(['cred_agent'])
    expect(state.draftRequests.get()).toEqual([REQUEST])
    expect(state.awaitingReply.get()).toEqual([ROOM])
    expect(state.reviews.get()).toEqual([review('note_a')])
    expect(state.suggestions.get()).toEqual([suggestion()])
    expect(state.debates.get()).toEqual([summary()])
    expect(state.groups.get()).toEqual([group(TEAM, { memberIds: [BEN] })])
    for (const key of KEYS) expect(state[key].load.get().loaded).toBe(true)
  })

  it('of a page, the principles, the figures and the proposals, are asked for while their features are on', async () => {
    const { run, routes, state } = start({
      'principles.list': () => ({ principles: [] }) as never,
      'insights.mine': () => ({ generatedAt: 1 }) as never,
      'principleProposals.list': () => ({ document: null, proposals: [], limit: 20 }),
    })
    await run(open('taught', 'agentReport', 'interview'))
    expect(routes().sort()).toEqual(['insights.mine', 'principleProposals.list', 'principles.list'])
    for (const key of ['taught', 'agentReport', 'interview'] as const) {
      expect(state[key].get()).not.toBeNull()
      expect(state[key].load.get().loaded).toBe(true)
    }
  })

  it('of a page are not asked for while their feature is off, and never read as something failed', async () => {
    const { run, routes, state } = start()
    state.serverInfo.set(serverInfo({ teaching: false, agentFigures: false }))
    await run(open('taught', 'agentReport', 'interview'))
    expect(routes()).toEqual([])
    expect(state.taught.get()).toBeNull()
    expect(state.taught.load.get()).toMatchObject({ loaded: true, step: 'idle' })
  })

  it('of a page empty at a refusal, since the person may no longer read them, and say it in their own place', async () => {
    let isRefused = false
    const { run, state } = start({
      'principles.list': () =>
        isRefused ? fail({ _tag: 'Forbidden', message: 'no' }) : ({ principles: [] } as never),
    })
    await run(open('taught'))
    isRefused = true
    await run(again('taught'))
    await settle()
    expect(state.taught.get()).toBeNull()
    expect(state.taught.load.get()).toMatchObject({ loaded: false, step: 'failed' })
    expect(state.notice.get()).toBeNull()
  })

  it('whose feature is off are none, and nothing is asked', async () => {
    const { run, routes, state } = start()
    state.serverInfo.set(
      serverInfo({
        draftRequests: false,
        channelAgents: false,
        debateSuggestions: false,
        debateRooms: false,
        groups: false,
      }),
    )
    await run(open('draftRequests', 'reviews', 'suggestions', 'debates', 'groups'))
    expect(routes()).toEqual([])
    for (const key of ['draftRequests', 'reviews', 'suggestions', 'debates', 'groups'] as const) {
      expect(state[key].get()).toEqual([])
      expect(state[key].load.get().loaded).toBe(true)
    }
  })

  it('whose feature the server switched off meanwhile are none', async () => {
    let isOff = false
    const { run, state, clock } = start({
      'reviews.list': () => (isOff ? fail({ _tag: 'NotFound', message: 'off' }) : lists['reviews.list']()),
    })
    await run(open('reviews'))
    isOff = true
    await clock.advance(2000)
    await run(open('reviews'))
    expect(state.reviews.get()).toEqual([])
    expect(state.reviews.load.get()).toEqual({ loaded: true, step: 'idle', error: null })
  })

  it.each(KEYS)(
    'keep %s when something in between answers 404 with a page of its own, and read it again',
    async (key) => {
      let isBehindProxy = false
      const clock = makeTestClock(0)
      const api = httpApi({
        serverUrl: 'http://localhost',
        fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
      })
      const test = start()
      const app = {
        ...test.app,
        clock,
        api: new Proxy(test.api, {
          get: (routes, name) => (isBehindProxy ? api : routes)[name as keyof typeof api],
        }),
      }
      await T.run(open(key), app)
      const shown = test.state[key].get()
      isBehindProxy = true
      await T.run(refresh(key), app)
      await clock.advance(15_000)
      await settle()
      expect(test.state[key].get()).toEqual(shown)
      expect(test.state[key].load.get()).toMatchObject({ loaded: true, step: 'failed' })
      isBehindProxy = false
      await clock.advance(30_000)
      await settle()
      expect(test.state[key].load.get()).toMatchObject({ loaded: true, step: 'idle' })
    },
  )

  it.each(KEYS)('keep %s, and tell nobody, when a background request fails', async (key) => {
    let isDown = false
    const { run, state } = start({
      [ROUTES[key]]: () => (isDown ? fail({ _tag: 'Unavailable', message: 'down' }) : lists[ROUTES[key]]()),
    })
    await run(open(key))
    const shown = state[key].get()
    isDown = true
    expect(await run(refresh(key))).toMatchObject({ _tag: 'Ok', value: false })
    await settle()
    expect(state[key].get()).toEqual(shown)
    expect(state.notice.get()).toBeNull()
  })

  it.each(KEYS)('empty %s, and tell no toast, when the person may no longer read it', async (key) => {
    let isRefused = false
    const { run, state } = start({
      [ROUTES[key]]: () => (isRefused ? fail({ _tag: 'Forbidden', message: 'no' }) : lists[ROUTES[key]]()),
    })
    await run(open(key))
    isRefused = true
    await run(refresh(key))
    expect(state[key].get()).toEqual([])
    expect(state[key].load.get()).toMatchObject({ loaded: false, step: 'failed' })
    expect(state.notice.get()).toBeNull()
  })

  it('are asked for again although just asked while the page polls or is offline, since it hears of no change', async () => {
    for (const connection of ['polling', 'offline'] as const) {
      const { run, routes, state } = start()
      state.connection.set(connection)
      await run(open('debates'))
      await run(open('debates'))
      expect(routes()).toHaveLength(2)
    }
  })

  it('end the session at a 401, and nothing arrives after it', async () => {
    const late = hold<unknown>()
    const { app, run, state, aborted } = start({
      'reviews.list': () => late.waiting,
      'debates.list': () => fail({ _tag: 'Unauthorized', message: 'out' }),
    })
    app.launch(open('reviews'))
    await settle()
    await run(open('debates'))
    expect(app.ended.aborted).toBe(true)
    expect(aborted).toEqual(['reviews.list'])
    late.release({ reviews: [review('note_a')] })
    await settle()
    expect(state.reviews.get()).toEqual([])
    app.launch(invalidate(...KEYS))
    await run(again(...KEYS))
    await settle()
    for (const key of KEYS) expect(state[key].load.get()).toMatchObject({ loaded: false, step: 'idle' })
    const signedOut = start({ 'debates.list': () => fail({ _tag: 'Unauthorized', message: 'out' }) })
    signedOut.state.session.set(null)
    await signedOut.run(open('debates'))
    expect(signedOut.app.ended.aborted).toBe(true)
  })

  it('tell a defect as any other task’s', async () => {
    const { run, state } = start({ 'debates.list': () => null })
    await run(open('debates'))
    await settle()
    expect(state.notice.get()).toMatchObject({ kind: 'error' })
  })
})

describe('a list on its way', () => {
  const left = async (
    handlers: Parameters<typeof testApp>[0],
    leave: (app: ReturnType<typeof start>) => void,
  ) => {
    const older = hold<unknown>()
    const test = start({ 'conversations.list': () => older.waiting, ...handlers })
    test.app.launch(open('conversations'))
    await settle()
    leave(test)
    await settle()
    const shown: number[] = []
    test.state.conversations.subscribe((rooms) => shown.push(rooms.length))
    older.release({ conversations: [conversation()] })
    await settle()
    return { ...test, shown }
  }
  const event = (body: unknown) => ({ seq: 1, at: 1, body }) as AsRead.StreamEvent

  it.each([
    { type: 'conversation.left', conversationId: ROOM, memberId: ANA },
    { type: 'channel.left', slug: 'billing', conversationId: ROOM },
  ])('never brings back a room that $type says was left meanwhile', async (body) => {
    const { state, shown } = await left({}, ({ app }) => liveEvents(app)(event(body)))
    expect(state.conversations.load.get().loaded).toBe(true)
    expect(state.conversations.get()).toEqual([])
    expect(shown.every((count) => count === 0)).toBe(true)
  })

  it('never brings back a room the person leaves here meanwhile', async () => {
    const { state } = await left({}, ({ app }) => app.launch(leaveGroup(ROOM, 'left')))
    expect(state.conversations.get()).toEqual([])
  })

  it('never replaces people read after it', async () => {
    const older = hold<unknown>()
    let asked = 0
    const { app, run, state } = start({
      'directory.list': () => (asked++ === 0 ? older.waiting : { entries: [entry(BEN, 'Ben Now')] }),
    })
    app.launch(open('directory'))
    await settle()
    const newer = run(refresh('directory'))
    older.release({ entries: [entry(BEN, 'Ben Then')] })
    await newer
    await settle()
    expect(state.directory.get()).toEqual([entry(BEN, 'Ben Now')])
  })

  it('keeps presence and a draft request that came meanwhile', async () => {
    const people = hold<unknown>()
    const requests = hold<unknown>()
    const { app, state } = start({
      'directory.list': () => people.waiting,
      'draftRequests.list': () => requests.waiting,
    })
    app.launch(open('directory', 'draftRequests'))
    await settle()
    const apply = liveEvents(app)
    apply(event({ type: 'presence', members: [{ memberId: BEN, humanOnline: true, agentOnline: false }] }))
    apply(event({ type: 'draft.requested', request: REQUEST }))
    people.release({ entries: [entry(BEN, 'Ben')] })
    requests.release({ requests: [] })
    await settle()
    expect(state.directory.get()[0]!.presence.humanOnline).toBe(true)
    expect(state.draftRequests.get()).toEqual([REQUEST])
  })
})

describe('the channel list', () => {
  const found = (...slugs: string[]) => ({
    channels: slugs.map((slug) => channel(slug)),
    hasMore: false,
    cursor: null,
  })
  const listedBy = (test: ReturnType<typeof start>) =>
    test.sent.filter((one) => one.route === 'channels.list').map((one) => one.request)

  it('asks for what the person typed and adds the next page to the pages shown', async () => {
    const test = start({ 'channels.list': () => ({ ...found('billing'), hasMore: true, cursor: 'next' }) })
    test.state.channelPageWish.set({ query: 'bill', after: null })
    await test.run(open('channelPage'))
    expect(listedBy(test)).toEqual([{ query: { limit: '20', q: 'bill' } }])
    const first = test.state.channelPage.get()
    expect(first).toMatchObject({ query: 'bill', hasMore: true, cursor: 'next' })
    test.state.channelPageWish.set({ query: 'bill', after: first })
    await test.run(again('channelPage'))
    await settle()
    expect(listedBy(test)[1]).toEqual({ query: { limit: '20', q: 'bill', cursor: 'next' } })
    expect(test.state.channelPage.get().channels.map((one) => one.slug)).toEqual(['billing', 'billing'])
  })

  it('never shows an answer to what the person typed before what they type now', async () => {
    const older = hold<unknown>()
    let asked = 0
    const { app, run, state } = start({
      'channels.list': () => (asked++ === 0 ? older.waiting : found('now')),
    })
    state.channelPageWish.set({ query: 'a', after: null })
    app.launch(open('channelPage'))
    await settle()
    state.channelPageWish.set({ query: 'ab', after: null })
    await run(again('channelPage'))
    older.release(found('then'))
    await settle()
    expect(state.channelPage.get()).toMatchObject({ query: 'ab', channels: [{ slug: 'now' }] })
  })

  describe('while channels change', () => {
    const pages = (handler: () => unknown) => {
      let asked = 0
      const test = start({
        'channels.list': (request) => {
          if ((request as { query: { limit: string } }).query.limit !== '20') return found('a', 'b')
          return asked++ === 0 ? { ...found('a'), hasMore: true, cursor: 'next' } : handler()
        },
      })
      const renamed = () => {
        test.state.channels.set([channel('a', { description: 'Renamed' }), channel('b')])
        return test.run(reloadChannelPage)
      }
      const rows = () => test.state.channelPage.get().channels.map((one) => one.description)
      return { ...test, renamed, rows }
    }

    it('newest wins: a search is never replaced by the pages shown before it', async () => {
      const next = [hold<unknown>(), hold<unknown>(), hold<unknown>()]
      let asked = 0
      const { app, run, renamed, state, rows } = pages(() => next[asked++]!.waiting)
      await run(openChannelPage)
      app.launch(loadChannelPage('', state.channelPage.get()))
      await settle()
      next[0]!.release(found('b'))
      await settle()
      expect(rows()).toEqual(['About a', 'About b'])
      await renamed()
      expect(rows()).toEqual(['Renamed', 'About b'])
      app.launch(loadChannelPage('z', null))
      await settle()
      await renamed()
      next[1]!.release(found('z'))
      await settle()
      expect(rows()).toEqual(['About z'])
      next[2]!.release(found('z', 'zz'))
      await settle()
      expect(state.channelPage.get()).toMatchObject({ query: 'z' })
      expect(rows()).toEqual(['About z', 'About zz'])
    })

    it('newest wins: the next page is kept, with the rows as they are now', async () => {
      const more = hold<unknown>()
      const { app, run, renamed, state, rows } = pages(() => more.waiting)
      await run(openChannelPage)
      app.launch(loadChannelPage('', state.channelPage.get()))
      await settle()
      await renamed()
      expect(rows()).toEqual(['Renamed'])
      more.release(found('b'))
      await settle()
      expect(rows()).toEqual(['Renamed', 'About b'])
      expect(state.channelPage.load.get()).toMatchObject({ loaded: true, step: 'idle' })
    })
  })

  it('empties, and tells through its load only, when the person may no longer read it, and is tried again with the others', async () => {
    let isRefused = false
    const { run, state } = start({
      'channels.list': () => (isRefused ? fail({ _tag: 'Forbidden', message: 'no' }) : found('billing')),
    })
    await run(open('channelPage'))
    isRefused = true
    await run(again('channelPage'))
    await settle()
    expect(state.channelPage.get().channels).toEqual([])
    expect(state.channelPage.load.get()).toMatchObject({ loaded: false, step: 'failed' })
    expect(state.notice.get()).toBeNull()
    isRefused = false
    await run(againWhatIsStuck)
    await settle()
    expect(state.channelPage.get().channels).toHaveLength(1)
    expect(state.channelPage.load.get()).toMatchObject({ loaded: true, step: 'idle' })
  })
})

describe('what an action reads again', () => {
  it('is waited for, but not for long, and its failure is nobody’s', async () => {
    const slow = hold<unknown>()
    const { run, clock, state } = start({ 'channels.list': () => slow.waiting })
    let isOver = false
    const waiting = run(reread('conversations', 'channels')).then((outcome) => {
      isOver = true
      return outcome
    })
    await settle()
    expect(state.conversations.load.get().loaded).toBe(true)
    expect(isOver).toBe(false)
    await clock.advance(5000)
    expect((await waiting)._tag).toBe('Ok')
    const down = start({ 'channels.list': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    expect((await down.run(reread('channels')))._tag).toBe('Ok')
    expect(down.state.notice.get()).toBeNull()
  })
})

describe('what a person decided', () => {
  it('stays decided when an older answer comes after it, and so does a dismissed suggestion', async () => {
    const older = hold<unknown>()
    const olderSuggestions = hold<unknown>()
    let reviewsAsked = 0
    let suggestionsAsked = 0
    const { app, run, state, sent } = start({
      'reviews.list': () => [{ reviews: [review('note_a')] }, older.waiting, { reviews: [] }][reviewsAsked++],
      'debateSuggestions.list': () =>
        suggestionsAsked++ === 0 ? lists['debateSuggestions.list']() : olderSuggestions.waiting,
    })
    await run(open('reviews', 'suggestions'))
    app.launch(invalidate('reviews', 'suggestions'))
    await settle()
    const shown: number[] = []
    state.reviews.subscribe((reviews) => shown.push(reviews.length))
    state.suggestions.subscribe((suggestions) => shown.push(suggestions.length))
    await run(discardReview(review('note_a'), ''))
    await run(dismissSuggestion(suggestion().id))
    older.release({ reviews: [review('note_a')] })
    olderSuggestions.release({ suggestions: [suggestion()] })
    await settle()
    await settle()
    expect(shown.every((count) => count === 0)).toBe(true)
    expect(sent.filter((one) => one.route === 'reviews.list')).toHaveLength(3)
  })
})
