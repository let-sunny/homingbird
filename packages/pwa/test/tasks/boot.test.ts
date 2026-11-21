import { afterEach, describe, expect, it } from 'vitest'
import { locale, strings, useLanguage } from '../../src/strings.ts'
import { boot } from '../../src/tasks/boot.ts'
import { fail, testApp } from '../support/app.ts'
import { ANA, ROOM, everything, me } from '../support/fixtures.ts'

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
