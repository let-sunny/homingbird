import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { discardReview } from '../../src/tasks/channel-agents.ts'
import { dismissSuggestion } from '../../src/tasks/debate-suggestions.ts'
import { type ResourceKey, again, invalidate, open, refresh } from '../../src/tasks/resources.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import {
  ANA,
  ROOM,
  conversation,
  draft,
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
  awaitingReply: 'inbox.list',
  reviews: 'reviews.list',
  suggestions: 'debateSuggestions.list',
  debates: 'debates.list',
} as const satisfies Record<ResourceKey, string>

const KEYS = Object.keys(ROUTES) as ResourceKey[]

const lists = {
  'inbox.list': () => ({ items: [{ conversation: conversation() }] }),
  'reviews.list': () => ({ reviews: [review('note_a')] }),
  'debateSuggestions.list': () => ({ suggestions: [suggestion()] }),
  'debates.list': () => ({ debates: [summary()] }),
}

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
    expect(state.awaitingReply.get()).toEqual([ROOM])
    expect(state.reviews.get()).toEqual([review('note_a')])
    expect(state.suggestions.get()).toEqual([suggestion()])
    expect(state.debates.get()).toEqual([summary()])
    for (const key of KEYS) expect(state[key].load.get().loaded).toBe(true)
  })

  it('whose feature is off are none, and nothing is asked', async () => {
    const { run, routes, state } = start()
    state.serverInfo.set(serverInfo({ channelAgents: false, debateSuggestions: false, debateRooms: false }))
    await run(open('reviews', 'suggestions', 'debates'))
    expect(routes()).toEqual([])
    for (const key of ['reviews', 'suggestions', 'debates'] as const) {
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
