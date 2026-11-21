import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { DIRECTORY_SETTLE_MS, liveEvents } from '../../src/tasks/live.ts'
import { settle, testApp } from '../support/app.ts'
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
  note,
} from '../support/fixtures.ts'

const event = (body: unknown, seq = 1): AsRead.StreamEvent => ({ seq, at: 1, body }) as AsRead.StreamEvent

const live = () => {
  const test = testApp({
    'conversations.list': () => ({ conversations: [] }),
    'directory.list': () => ({ entries: [] }),
    'contacts.list': () => ({ contacts: [] }),
    'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
    'conversations.get': () => conversation(),
    'conversations.notes': () => ({ notes: [], hasMore: false, notices: [] }),
    'credentials.list': () => ({ credentials: [] }),
    'draftRequests.list': () => ({ requests: [] }),
    'debates.list': () => ({ debates: [] }),
    'debates.get': () => ({}),
    'groups.list': () => ({ groups: [] }),
  })
  test.state.session.set(me())
  test.state.directory.set([entry(BEN, 'Ben')])
  return { ...test, apply: liveEvents(test.app) }
}

describe('liveEvents', () => {
  it('files a sent note, announces a fresh one from someone else, and reloads the list', async () => {
    const { apply, state, clock, routes } = live()
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    apply(event({ type: 'note.sent', note: note('n1', { sentAt: clock.now() }) }))
    expect(
      state.threads
        .get()
        .get(ROOM)!
        .notes.map((one) => one.id),
    ).toEqual(['n1'])
    expect(state.announcement.get()).toBe(strings.incomingNote({ name: 'Ben' }))
    state.announcement.set('')
    apply(event({ type: 'note.sent', note: note('n2', { sentAt: 0 }) }))
    apply(event({ type: 'note.sent', note: note('n3', { authorId: ANA, sentAt: clock.now() }) }))
    apply(
      event({
        type: 'note.sent',
        note: note('n4', { authorId: 'mem_gone00000000' as never, sentAt: clock.now() }),
      }),
    )
    expect(state.announcement.get()).toBe(strings.incomingNote({ name: strings.formerMember }))
    await settle()
    expect(routes()).toContain('conversations.list')
  })

  it('announces nothing from a conversation the person muted, and still files its note', () => {
    const { apply, state, clock } = live()
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    state.conversations.set([conversation({ muted: true })])
    apply(event({ type: 'note.sent', note: note('n1', { sentAt: clock.now() }) }))
    expect(state.announcement.get()).toBe('')
    expect(
      state.threads
        .get()
        .get(ROOM)!
        .notes.map((one) => one.id),
    ).toEqual(['n1'])
    state.conversations.set([conversation({ muted: false })])
    apply(event({ type: 'note.sent', note: note('n2', { sentAt: clock.now() }) }))
    expect(state.announcement.get()).toBe(strings.incomingNote({ name: 'Ben' }))
  })

  it('updates receipts, moves a question away, and keeps a saved draft', async () => {
    const { apply, state } = live()
    apply(event({ type: 'note.status', noteId: 'n1', conversationId: ROOM, receipts: [] }))
    state.threads.set(new Map([[ROOM, { notes: [note('n1')], hasMore: false }]]))
    const receipts = [
      { memberId: BEN, state: 'read', deliveredAt: 1, readAt: 2, draftingAt: null, repliedAt: null },
    ]
    apply(event({ type: 'note.status', noteId: 'n1', conversationId: ROOM, receipts }))
    expect(state.threads.get().get(ROOM)!.notes[0]!.receipts).toEqual(receipts)
    apply(
      event({
        type: 'note.moved',
        noteId: 'n1',
        fromConversationId: ROOM,
        toConversationId: 'conv_other0000000',
      }),
    )
    expect(state.threads.get().get(ROOM)!.notes).toEqual([])
    state.releases.set(new Map([['q' as never, { reason: null, agentName: null }]]))
    state.agentCredentials.set([credential('cred_agent')])
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    apply(event({ type: 'draft.saved', note: draft('d1', { inReplyTo: 'q' as never }) }))
    expect(state.releases.get().size).toBe(0)
    apply(event({ type: 'draft.saved', note: draft('d2', { origin: 'human' }) }))
    expect(
      state.threads
        .get()
        .get(ROOM)!
        .notes.map((one) => one.id),
    ).toEqual(['d1', 'd2'])
  })

  it('loads the agents when a draft by an agent arrives before any agent is known', async () => {
    const { apply, routes } = live()
    apply(event({ type: 'draft.saved', note: draft('d1') }))
    await settle()
    expect(routes()).toContain('credentials.list')
  })

  it('forgets a discarded draft, and says so when archiving its channel discarded it', () => {
    const { apply, state } = live()
    state.threads.set(new Map([[ROOM, { notes: [draft('d1'), draft('d2')], hasMore: false }]]))
    apply(event({ type: 'draft.discarded', noteId: 'd1', conversationId: ROOM }))
    expect(state.notice.get()).toBeNull()
    apply(
      event({
        type: 'draft.discarded',
        noteId: 'd2',
        conversationId: ROOM,
        because: 'channel_archived',
        channel: 'billing',
      }),
    )
    apply(
      event({
        type: 'draft.discarded',
        noteId: 'd2',
        conversationId: ROOM,
        because: 'channel_archived',
        channel: 'billing',
      }),
    )
    apply(event({ type: 'draft.discarded', noteId: 'd3', conversationId: ROOM, because: 'channel_archived' }))
    expect(state.threads.get().get(ROOM)!.notes).toEqual([])
    expect(state.archiveDiscards.get().get(ROOM)).toEqual([{ noteId: 'd2', channel: 'billing' }])
    expect(state.notice.get()).toEqual({
      kind: 'info',
      text: strings.draftDiscardedByArchive({ channel: '#billing' }),
    })
  })

  it('closes the notification about the person’s own draft once it was sent or discarded', async () => {
    const { apply, page, clock } = live()
    for (const tag of ['draft:d1', 'draft:n9', 'draft:n1', 'review:d1']) page.notifications.set(tag, 0)
    apply(event({ type: 'draft.discarded', noteId: 'd1', conversationId: ROOM }))
    apply(event({ type: 'note.sent', note: note('n9', { authorId: ANA, sentAt: clock.now() }) }))
    apply(event({ type: 'note.sent', note: note('n1', { authorId: BEN, sentAt: clock.now() }) }))
    await settle()
    expect([...page.notifications.keys()]).toEqual(['draft:n1', 'review:d1'])
  })

  it('remembers a release and its reason, and keeps draft requests up to date', async () => {
    const { apply, state, routes } = live()
    apply(
      event({ type: 'note.released', noteId: 'n1', conversationId: ROOM, reason: 'busy', agentName: 'Desk' }),
    )
    expect(state.releases.get().get('n1' as never)).toEqual({ reason: 'busy', agentName: 'Desk' })
    const request = {
      id: 'dreq_1',
      conversationId: ROOM,
      inReplyTo: null,
      instruction: '',
      agentId: null,
      createdAt: 1,
      expiresAt: 2,
      cancelledAt: null,
      draftIds: [],
    }
    apply(event({ type: 'draft.requested', request }))
    apply(event({ type: 'draft.request.changed', request: { ...request, cancelledAt: 2 } }))
    expect(state.draftRequests.get()).toEqual([])
    apply(event({ type: 'contact.changed', memberId: BEN }))
    await settle()
    expect(routes()).toEqual(expect.arrayContaining(['conversations.get', 'directory.list']))
  })

  it('reloads the directory once after a run of changes settles', async () => {
    const { apply, clock, routes } = live()
    apply(event({ type: 'directory.changed', memberId: BEN }))
    apply(event({ type: 'directory.changed', memberId: BEN }))
    await clock.advance(DIRECTORY_SETTLE_MS)
    await settle()
    expect(routes().filter((route) => route === 'channels.list')).toHaveLength(1)
  })

  it('keeps channels current, and leaves a room the person left, going to the channels if it was shown', () => {
    const { apply, state, page } = live()
    const billing = channel('billing', { conversationId: ROOM, joined: true })
    apply(event({ type: 'channel.changed', channel: billing }))
    apply(event({ type: 'channel.changed', channel: { ...billing, joined: false } }))
    expect(state.channels.get()).toEqual([{ ...billing, joined: false }])
    state.conversations.set([conversation()])
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    state.route.set({ name: 'conversation', id: ROOM, draft: null })
    apply(event({ type: 'channel.left', slug: 'billing', conversationId: ROOM }))
    expect(state.conversations.get()).toEqual([])
    expect(state.threads.get().has(ROOM)).toBe(false)
    expect(page.visited).toEqual(['replace #/channels'])
    state.route.set({ name: 'home' })
    apply(event({ type: 'channel.left', slug: 'billing', conversationId: ROOM }))
    expect(page.visited).toHaveLength(1)
  })

  it('tells the page of everything one event changed at once', () => {
    const { apply, state } = live()
    state.conversations.set([conversation()])
    state.threads.set(new Map([[ROOM, { notes: [], hasMore: false }]]))
    const heard: string[] = []
    const redraw = (): void =>
      void heard.push(`${state.conversations.get().length} ${state.threads.get().size}`)
    state.conversations.subscribe(redraw)
    state.threads.subscribe(redraw)
    apply(event({ type: 'channel.left', slug: 'billing', conversationId: ROOM }))
    expect(heard).toEqual(['0 0'])
  })

  it('reloads a debate room shown, or the list', async () => {
    const { apply, state, routes } = live()
    apply(event({ type: 'debate.changed', debateId: 'd1', participantIds: [] }))
    state.route.set({ name: 'debates' })
    apply(event({ type: 'debate.changed', debateId: 'd1', participantIds: [] }))
    state.route.set({ name: 'debate', id: 'd1' })
    apply(event({ type: 'debate.changed', debateId: 'd2', participantIds: [] }))
    apply(event({ type: 'debate.changed', debateId: 'd1', participantIds: [] }))
    await settle()
    expect(routes().filter((route) => route.startsWith('debates.'))).toEqual(['debates.list', 'debates.get'])
  })

  it('shows presence, loads agents when the person’s own agent comes online, and reloads everything on resync', async () => {
    const { apply, state, routes } = live()
    apply(event({ type: 'presence', members: [{ memberId: BEN, humanOnline: true, agentOnline: true }] }))
    expect(state.directory.get()[0]!.presence).toEqual({ humanOnline: true, agentOnline: true })
    apply(event({ type: 'presence', members: [{ memberId: ANA, humanOnline: true, agentOnline: false }] }))
    apply(event({ type: 'presence', members: [{ memberId: ANA, humanOnline: true, agentOnline: true }] }))
    state.route.set({ name: 'conversation', id: ROOM, draft: null })
    apply(event({ type: 'resync' }))
    state.route.set({ name: 'home' })
    apply(event({ type: 'resync' }))
    await settle()
    expect(routes()).toEqual(expect.arrayContaining(['credentials.list', 'conversations.get']))
    expect(member(ANA, 'Ana').id).toBe(ANA)
  })

  it('reloads the groups once after a run of changes settles, once they were loaded', async () => {
    const { apply, state, clock, routes } = live()
    apply(event({ type: 'group.changed', groupId: 'grp_team00000000' }))
    await clock.advance(DIRECTORY_SETTLE_MS)
    await settle()
    expect(routes()).not.toContain('groups.list')
    state.groupsLoaded.set(true)
    for (const groupId of ['grp_team00000000', 'grp_ops000000000', 'grp_team00000000'])
      apply(event({ type: 'group.changed', groupId }))
    await clock.advance(DIRECTORY_SETTLE_MS - 1)
    await settle()
    expect(routes()).not.toContain('groups.list')
    await clock.advance(1)
    await settle()
    expect(routes().filter((route) => route === 'groups.list')).toHaveLength(1)
  })

  it('reads the waiting answers again once a run of review changes settles', async () => {
    const { apply, state, clock, routes } = live()
    state.serverInfo.set(everything())
    apply(event({ type: 'review.changed', noteId: 'note_answer00000' }))
    apply(event({ type: 'review.changed', noteId: null }))
    await clock.advance(DIRECTORY_SETTLE_MS)
    await settle()
    expect(routes().filter((route) => route === 'reviews.list')).toHaveLength(1)
  })

  it('reloads the groups on a resync, once they were loaded', async () => {
    const { apply, state, routes } = live()
    state.groupsLoaded.set(true)
    apply(event({ type: 'resync' }))
    await settle()
    expect(routes()).toContain('groups.list')
  })
})
