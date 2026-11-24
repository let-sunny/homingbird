import { describe, expect, it } from 'vitest'
import { ACTIVITY, WORKSPACE, open, refresh } from '../../src/tasks/resources.ts'
import { afterWorkspace, loadBranding } from '../../src/tasks/workspace.ts'
import { keepUnsettled, keptUnsettled } from '../../src/unsettled-decisions.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import {
  ANA,
  BEN,
  channel,
  conversation,
  credential,
  draft,
  entry,
  everything,
  me,
  member,
  serverInfo,
} from '../support/fixtures.ts'
import { heldDecision } from '../support/held.ts'

const openAll = open(...WORKSPACE, ...ACTIVITY)

describe('loading the workspace', () => {
  it('loads conversations, people, contacts, agents, channels and what the bell counts, and marks them loaded', async () => {
    const { run, state, routes } = testApp({
      'conversations.list': () => ({ conversations: [conversation()] }),
      'directory.list': () => ({ entries: [entry(BEN, 'Ben')] }),
      'contacts.list': () => ({ contacts: [] }),
      'draftRequests.list': () => ({ requests: [] }),
      'credentials.list': () => ({
        credentials: [
          credential('cred_agent'),
          credential('cred_web', { kind: 'human' }),
          credential('cred_old', { revokedAt: 1 }),
        ],
      }),
      'channels.list': () => ({ channels: [channel('billing')], hasMore: false, cursor: null }),
      'inbox.list': () => ({ items: [] }),
      'debates.list': () => ({ debates: [] }),
      'debateSuggestions.list': () => ({ suggestions: [] }),
    })
    await run(openAll)
    expect(state.workspace.get()).toBe('loaded')
    expect(state.conversationsLoaded.get()).toBe(true)
    expect(state.directoryLoaded.get()).toBe(true)
    expect(state.channelsLoaded.get()).toBe(true)
    expect(state.agentCredentials.get().map((one) => one.id)).toEqual(['cred_agent'])
    expect([...routes()].sort()).toEqual(
      [
        'channels.list',
        'contacts.list',
        'conversations.list',
        'credentials.list',
        'debateSuggestions.list',
        'debates.list',
        'directory.list',
        'draftRequests.list',
        'inbox.list',
      ].sort(),
    )
  })

  it('loads at start the conversations whose notes the bell counts, so its count never grows on opening one', async () => {
    const released = { kind: 'released', noteId: 'n_skipped', reason: null, agentName: null }
    const { run, state } = testApp({
      'conversations.list': () => ({ conversations: [conversation({ unreadCount: 1 })] }),
      'directory.list': () => ({ entries: [] }),
      'contacts.list': () => ({ contacts: [] }),
      'credentials.list': () => ({ credentials: [] }),
      'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
      'inbox.list': () => ({ items: [] }),
      'debates.list': () => ({ debates: [] }),
      'debateSuggestions.list': () => ({ suggestions: [] }),
      'draftRequests.list': () => ({ requests: [] }),
      'conversations.get': () => conversation({ unreadCount: 1 }),
      'conversations.notes': () => ({ notes: [], hasMore: false, notices: [released] }),
    })
    await run(openAll)
    await run(afterWorkspace)
    expect([...state.releases.get().keys()]).toEqual(['n_skipped'])
  })

  it('closes the notifications of drafts sent or discarded elsewhere, where the browser has push', async () => {
    const { run, page, routes } = testApp({
      'conversations.list': () => ({ conversations: [] }),
      'directory.list': () => ({ entries: [] }),
      'contacts.list': () => ({ contacts: [] }),
      'credentials.list': () => ({ credentials: [] }),
      'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
      'drafts.list': () => ({ drafts: [draft('d_open')] }),
      'inbox.list': () => ({ items: [] }),
      'debates.list': () => ({ debates: [] }),
      'debateSuggestions.list': () => ({ suggestions: [] }),
      'draftRequests.list': () => ({ requests: [] }),
    })
    page.notifications.set('draft:d_open', 0).set('draft:d_sent', 0)
    await run(openAll)
    await run(afterWorkspace)
    expect(routes()).not.toContain('drafts.list')
    expect([...page.notifications.keys()]).toEqual(['draft:d_open', 'draft:d_sent'])
    page.state.push = true
    await run(afterWorkspace)
    expect([...page.notifications.keys()]).toEqual(['draft:d_open'])
  })

  it('reads no draft requests where they are off or the server lacks them', async () => {
    const off = testApp({ 'credentials.list': () => ({ credentials: [] }) })
    off.state.serverInfo.set(serverInfo())
    await off.run(open('agentCredentials', 'draftRequests'))
    expect(off.routes()).toEqual(['credentials.list'])
    const missing = testApp({
      'draftRequests.list': () => fail({ _tag: 'NotFound', message: 'no' }),
      'credentials.list': () => ({ credentials: [] }),
    })
    await missing.run(open('agentCredentials', 'draftRequests'))
    expect(missing.state.draftRequests.get()).toEqual([])
  })

  it('never lets an older answer replace a newer list, however late it comes', async () => {
    const older = hold<unknown>()
    let asked = 0
    const { run, state } = testApp({
      'conversations.list': () =>
        asked++ === 0 ? older.waiting : { conversations: [conversation({ lastActivityAt: 2 })] },
    })
    const first = run(open('conversations'))
    await settle()
    const second = run(refresh('conversations'))
    await settle()
    expect(asked).toBe(1)
    older.release({ conversations: [] })
    await first
    await second
    expect(state.conversations.get()).toHaveLength(1)
  })

  it('waits with what was settled elsewhere until each list was read, and the reviews too', async () => {
    const reviews = hold<unknown>()
    const { run, state, page, routes } = testApp({
      'conversations.list': () => ({ conversations: [] }),
      'directory.list': () => ({ entries: [] }),
      'contacts.list': () => ({ contacts: [] }),
      'draftRequests.list': () => ({ requests: [] }),
      'credentials.list': () => ({ credentials: [] }),
      'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
      'inbox.list': () => ({ items: [] }),
      'reviews.list': () => reviews.waiting,
      'debates.list': () => ({ debates: [] }),
      'debateSuggestions.list': () => ({ suggestions: [] }),
    })
    state.session.set(me())
    state.serverInfo.set(everything())
    keepUnsettled(page.page.storage, ANA, heldDecision('note_a', { review: true }))
    let isOver = false
    const after = run(afterWorkspace).then(() => {
      isOver = true
    })
    void run(open(...WORKSPACE, 'awaitingReply', 'suggestions', 'debates'))
    await settle()
    expect(state.workspace.get()).toBe('loaded')
    void run(open('reviews'))
    await settle()
    expect(isOver).toBe(false)
    expect(keptUnsettled(page.page.storage, ANA)).toHaveLength(1)
    reviews.release({ reviews: [review] })
    await after
    expect(state.notice.get()).toMatchObject({ kind: 'error' })
    expect(keptUnsettled(page.page.storage, ANA)).toEqual([])
    expect(routes()).not.toContain('notes.get')
  })
})

const review = {
  note: draft('note_a'),
  question: null,
  channel: 'wiki',
  agent: member(BEN, 'Wiki'),
  privately: false,
}

describe('loadBranding', () => {
  it('reads the organization’s name and logo, keeping the default for anything missing or broken', async () => {
    const { app, run, page } = testApp()
    const answer = (body: unknown) => {
      Object.assign(page.page, { fetch: () => Promise.resolve(new Response(JSON.stringify(body))) })
    }
    answer({ name: 'Acme', logo: '/acme.svg' })
    expect(await run(loadBranding)).toEqual({ _tag: 'Ok', value: { name: 'Acme', logo: '/acme.svg' } })
    answer({ name: 3 })
    expect(await run(loadBranding)).toEqual({ _tag: 'Ok', value: { name: 'Homingbird', logo: null } })
    Object.assign(page.page, { fetch: () => Promise.resolve(new Response('not json')) })
    expect(await run(loadBranding)).toEqual({ _tag: 'Ok', value: app.state.branding.get() })
    Object.assign(page.page, { fetch: () => Promise.reject(new Error('offline')) })
    expect(await run(loadBranding)).toEqual({ _tag: 'Ok', value: app.state.branding.get() })
  })
})
