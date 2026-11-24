import { afterEach, describe, expect, it } from 'vitest'
import { locale, strings, useLanguage } from '../../src/strings.ts'
import { boot } from '../../src/tasks/boot.ts'
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
})
