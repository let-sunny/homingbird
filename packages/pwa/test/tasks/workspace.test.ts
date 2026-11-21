import { describe, expect, it } from 'vitest'
import {
  loadAgents,
  loadBranding,
  loadConversations,
  loadKnownChannels,
  loadPeople,
  loadWorkspace,
} from '../../src/tasks/workspace.ts'
import { fail, testApp } from '../support/app.ts'
import { BEN, channel, conversation, credential, draft, entry, serverInfo } from '../support/fixtures.ts'

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
    })
    await run(loadWorkspace)
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
      'conversations.get': () => conversation({ unreadCount: 1 }),
      'conversations.notes': () => ({ notes: [], hasMore: false, notices: [released] }),
    })
    await run(loadWorkspace)
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
    })
    page.notifications.set('draft:d_open', 0).set('draft:d_sent', 0)
    await run(loadWorkspace)
    expect(routes()).not.toContain('drafts.list')
    expect([...page.notifications.keys()]).toEqual(['draft:d_open', 'draft:d_sent'])
    page.state.push = true
    await run(loadWorkspace)
    expect([...page.notifications.keys()]).toEqual(['draft:d_open'])
  })

  it('reads no draft requests where they are off or the server lacks them', async () => {
    const off = testApp({ 'credentials.list': () => ({ credentials: [] }) })
    off.state.serverInfo.set(serverInfo())
    await off.run(loadAgents)
    expect(off.routes()).toEqual(['credentials.list'])
    const missing = testApp({
      'draftRequests.list': () => fail({ _tag: 'NotFound', message: 'no' }),
      'credentials.list': () => ({ credentials: [] }),
    })
    await missing.run(loadAgents)
    expect(missing.state.draftRequests.get()).toEqual([])
  })

  it('loads conversations, people and known channels on their own', async () => {
    const { run, state } = testApp({
      'conversations.list': () => ({ conversations: [] }),
      'directory.list': () => ({ entries: [] }),
      'contacts.list': () => ({ contacts: [] }),
      'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
    })
    await run(loadConversations)
    await run(loadPeople)
    await run(loadKnownChannels)
    expect([
      state.conversationsLoaded.get(),
      state.directoryLoaded.get(),
      state.channelsLoaded.get(),
    ]).toEqual([true, true, true])
  })
})

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
