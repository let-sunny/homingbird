import type { AsRead, DraftRequest, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { TOO_LONG_LOAD_SECONDS } from '../../src/load-timing.ts'
import { discardReview } from '../../src/tasks/channel-agents.ts'
import { leaveGroup } from '../../src/tasks/conversation-actions.ts'
import { dismissSuggestion } from '../../src/tasks/debate-suggestions.ts'
import { liveEvents } from '../../src/tasks/live.ts'
import {
  type ResourceKey,
  again,
  againWhatFailed,
  againWhatIsStuck,
  invalidate,
  open,
  refresh,
  reread,
} from '../../src/tasks/resources.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import {
  ANA,
  BEN,
  ROOM,
  channel,
  conversation,
  credential,
  draft,
  entry,
  everything,
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
  contacts: 'contacts.list',
  channels: 'channels.list',
  agentCredentials: 'credentials.list',
  draftRequests: 'draftRequests.list',
  awaitingReply: 'inbox.list',
  reviews: 'reviews.list',
  suggestions: 'debateSuggestions.list',
  debates: 'debates.list',
} as const satisfies Record<ResourceKey, string>

const KEYS = Object.keys(ROUTES) as ResourceKey[]

const lists = {
  'conversations.list': () => ({ conversations: [conversation()] }),
  'directory.list': () => ({ entries: [entry(BEN, 'Ben')] }),
  'contacts.list': () => ({ contacts: [{ memberId: BEN, state: 'accepted', since: 1 }] }),
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
    expect(state.contacts.get()).toEqual([{ memberId: BEN, state: 'accepted', since: 1 }])
    expect(state.channels.get()).toEqual([channel('billing')])
    expect(state.agentCredentials.get().map((one) => one.id)).toEqual(['cred_agent'])
    expect(state.draftRequests.get()).toEqual([REQUEST])
    expect(state.awaitingReply.get()).toEqual([ROOM])
    expect(state.reviews.get()).toEqual([review('note_a')])
    expect(state.suggestions.get()).toEqual([suggestion()])
    expect(state.debates.get()).toEqual([summary()])
    for (const key of KEYS) expect(state[key].load.get().loaded).toBe(true)
  })

  it('whose feature is off are none, and nothing is asked', async () => {
    const { run, routes, state } = start()
    state.serverInfo.set(
      serverInfo({
        draftRequests: false,
        channelAgents: false,
        debateSuggestions: false,
        debateRooms: false,
      }),
    )
    await run(open('draftRequests', 'reviews', 'suggestions', 'debates'))
    expect(routes()).toEqual([])
    for (const key of ['draftRequests', 'reviews', 'suggestions', 'debates'] as const) {
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
    expect(state.conversationsLoaded.get()).toBe(true)
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
    expect(state.conversationsLoaded.get()).toBe(true)
    expect(isOver).toBe(false)
    await clock.advance(5000)
    expect((await waiting)._tag).toBe('Ok')
    const down = start({ 'channels.list': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    expect((await down.run(reread('channels')))._tag).toBe('Ok')
    expect(down.state.notice.get()).toBeNull()
  })
})

describe('trying again', () => {
  it('asks for the lists that failed or take too long, and after the network is back for those that failed', async () => {
    const slow = hold<unknown>()
    const { app, run, clock, routes, state } = start({
      'directory.list': () => fail({ _tag: 'Forbidden', message: 'no' }),
      'channels.list': () => slow.waiting,
    })
    app.launch(open('conversations', 'directory', 'channels'))
    await clock.advance(TOO_LONG_LOAD_SECONDS * 1000)
    expect(state.channels.load.get().step).toBe('long')
    const asked = (route: string) => routes().filter((one) => one === route).length
    await run(againWhatFailed)
    await settle()
    expect(['conversations.list', 'directory.list', 'channels.list'].map(asked)).toEqual([1, 2, 1])
    await run(againWhatIsStuck)
    await settle()
    expect(['conversations.list', 'directory.list', 'channels.list'].map(asked)).toEqual([1, 3, 2])
    app.endSession()
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
