import { describe, expect, it } from 'vitest'
import {
  type SidebarInput,
  paneFor,
  searchLinkModel,
  sidebarModel,
  skipLinkModel,
  tabsModel,
  userMenuModel,
} from '../../src/models/shell.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  entry,
  me,
  member,
  note,
  serverInfo,
} from '../support/fixtures.ts'

describe('tabsModel', () => {
  it('marks the tab of the page shown, and offers Debates only where it is on', () => {
    const tabs = tabsModel({ name: 'conversation', id: ROOM, draft: null }, serverInfo())
    expect(tabs.map((tab) => tab.label)).toEqual([
      strings.navNotes,
      strings.navMyAgent,
      strings.navPeople,
      strings.channels,
    ])
    expect(tabs.filter((tab) => tab.current).map((tab) => tab.label)).toEqual([strings.navNotes])
    expect(tabs[1]).toEqual({
      label: strings.navMyAgent,
      href: '#/agent',
      current: false,
      tour: 'connect',
      mark: null,
    })
    expect(tabs.every((tab) => tab.mark === null)).toBe(true)
    expect(
      tabsModel({ name: 'debate', id: 'x', tab: null }, serverInfo({ debateRooms: true })).find(
        (tab) => tab.current,
      )?.label,
    ).toBe(strings.navDebates)
  })

  it('marks My agent, and only My agent, while the person’s agent cannot answer', () => {
    const tabs = tabsModel({ name: 'home' }, serverInfo(), strings.activity.unavailableTitle)
    expect(tabs.filter((tab) => tab.mark !== null)).toEqual([
      expect.objectContaining({ label: strings.navMyAgent, mark: strings.activity.unavailableTitle }),
    ])
  })
})

describe('searchLinkModel', () => {
  it('links to an empty search and marks itself on the search page', () => {
    expect(searchLinkModel({ name: 'home' })).toEqual({
      label: strings.search,
      href: '#/search?q=',
      current: false,
      tour: null,
      mark: null,
    })
    expect(searchLinkModel({ name: 'search', query: 'refund' }).current).toBe(true)
  })
})

describe('userMenuModel', () => {
  it('offers administration only to an administrator', () => {
    expect(userMenuModel(me()).links.map((link) => link.href)).toEqual(['#/me'])
    expect(userMenuModel(me({}, { role: 'admin' }))).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      links: [
        { label: strings.menuProfile, href: '#/me' },
        { label: strings.menuAdmin, href: '#/admin/settings' },
      ],
      signOut: strings.menuSignOut,
    })
  })
})

describe('paneFor', () => {
  it('shows the list on home and the page everywhere else', () => {
    expect(paneFor({ name: 'home' })).toBe('list')
    expect(paneFor({ name: 'people' })).toBe('stage')
  })
})

describe('skipLinkModel', () => {
  it('offers to skip to the composer in a conversation only', () => {
    expect(skipLinkModel({ name: 'conversation', id: ROOM, draft: null })).toBe(strings.skipToComposer)
    expect(skipLinkModel({ name: 'people' })).toBeNull()
  })
})

describe('sidebarModel', () => {
  const members = new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
    [CY, member(CY, 'Cy')],
  ])
  const input = (fields: Partial<SidebarInput>): SidebarInput => ({
    me: me(),
    route: { name: 'home' },
    conversations: [],
    loaded: true,
    members,
    directory: [],
    channels: [],
    reviews: [],
    agentCount: 1,
    charactersOn: true,
    muteOn: true,
    now: 10,
    arrived: new Set(),
    typedIn: new Set(),
    ...fields,
  })

  it('waits for the list, says when there are no conversations, and invites connecting an agent', () => {
    expect(sidebarModel(input({ loaded: false })).people).toEqual({ kind: 'loading' })
    expect(sidebarModel(input({ agentCount: 0 }))).toEqual({
      onboarding: true,
      people: { kind: 'none' },
      channelRooms: [],
      channelRoomsEmpty: strings.noChannelRooms,
      archived: null,
    })
  })

  it('shows only the rooms that wait for the person while the filter is on, and says so when none does', () => {
    const group = conversation({
      id: 'conv_group0000000' as never,
      kind: 'group',
      participantIds: [ANA, BEN, CY],
    })
    const room = conversation({ id: 'conv_payments0000' as never, kind: 'channel', title: 'payments' })
    const archived = conversation({
      id: 'conv_old000000000' as never,
      kind: 'channel',
      title: 'old',
      archivedAt: 2,
    })
    const all = [conversation(), group, room, archived]
    const only = sidebarModel(input({ conversations: all, waitingOnly: new Set([group.id]) }))
    expect(only.people.kind === 'rows' && only.people.rows.map((row) => row.id)).toEqual([group.id])
    expect(only.channelRooms).toEqual([])
    expect(only.channelRoomsEmpty).toBe(strings.waiting.roomsNone)
    expect(only.archived).toBeNull()
    expect(sidebarModel(input({ conversations: all, waitingOnly: new Set([room.id]) })).people).toEqual({
      kind: 'nothing-waits',
      text: strings.waiting.peopleNone,
    })
    const off = sidebarModel(input({ conversations: all, waitingOnly: null }))
    expect(off.people.kind === 'rows' && off.people.rows).toHaveLength(2)
    expect(off.archived).not.toBeNull()
  })

  it('shows a direct conversation with the other person, their presence, its last note and its counts', () => {
    const direct = conversation({
      lastNote: note('n1', { body: 'Hello there', sentAt: 9 }),
      unreadCount: 2,
      draftCount: 1,
    })
    const model = sidebarModel(
      input({
        conversations: [direct],
        route: { name: 'conversation', id: ROOM, draft: null },
        directory: [entry(BEN, 'Ben', { presence: { humanOnline: true, agentOnline: false } })],
        arrived: new Set([ROOM]),
        typedIn: new Set([ROOM]),
      }),
    )
    if (model.people.kind !== 'rows') throw new Error('expected rows')
    const [row] = model.people.rows
    expect(row).toMatchObject({
      id: ROOM,
      href: `#/c/${ROOM}`,
      current: true,
      title: 'Ben',
      presence: { humanOnline: true, agentOnline: false },
      archived: false,
      channel: null,
      preview: 'Hello there',
      time: timeShown(9, 10),
      unread: { count: 2, label: strings.unread({ count: 2 }) },
      drafts: { text: '✎1', label: strings.draftsWaiting({ count: 1 }) },
      typed: { text: '✎', label: strings.unsentText },
    })
    expect(row!.face).toMatchObject({
      kind: 'member',
      avatar: { state: 'new-note', motion: 'once', label: null },
    })
  })

  it('shows a group with two faces, kept as a draft until a note is sent, a quiet conversation by its drafts or as empty', () => {
    const group = conversation({
      kind: 'group',
      participantIds: [ANA, BEN, CY],
      title: 'Team',
      draftCount: 2,
    })
    const quiet = conversation({ id: 'conv_quiet0000000' as never })
    const drafting = conversation({ id: 'conv_drafting0000' as never, draftCount: 1 })
    const model = sidebarModel(input({ conversations: [group, quiet, drafting] }))
    if (model.people.kind !== 'rows') throw new Error('expected rows')
    const [team, empty, waiting] = model.people.rows
    expect(team!.face).toMatchObject({ kind: 'group', more: null })
    expect(team!.preview).toBe(strings.groupNotSentYet)
    expect(team!.presence).toBeNull()
    expect(empty!.preview).toBe(strings.noNotesYet)
    expect(waiting!.preview).toBe(strings.draftsWaiting({ count: 1 }))
    expect(empty!.face).toMatchObject({ kind: 'member', avatar: { state: 'idle', motion: 'still' } })
    expect(empty!.time).toBeNull()
    const arrived = sidebarModel(input({ conversations: [quiet], arrived: new Set([quiet.id]) }))
    expect(arrived.people.kind === 'rows' && arrived.people.rows[0]!.face).toMatchObject({
      avatar: { state: 'new-note' },
    })
  })

  it('lists channel rooms with their counts, and archived rooms apart, open when one is shown', () => {
    const billing = channel('billing')
    const room = conversation({ id: billing.conversationId, kind: 'channel', title: 'billing' })
    const old = conversation({
      id: 'conv_old000000000' as never,
      kind: 'channel',
      title: 'old',
      archivedAt: 5,
    })
    const model = sidebarModel(
      input({
        conversations: [room, old],
        channels: [billing],
        route: { name: 'conversation', id: 'conv_old000000000', draft: null },
      }),
    )
    expect(model.channelRooms[0]).toMatchObject({ face: { kind: 'channel' }, channel: billing })
    expect(model.archived).toMatchObject({ title: strings.archivedGroup({ count: 1 }), open: true })
    expect(model.archived!.rows[0]).toMatchObject({
      archived: true,
      face: { kind: 'channel' },
      current: true,
    })
    expect(sidebarModel(input({ conversations: [old] })).archived!.open).toBe(false)
  })

  it('offers each row a mute switch, marks a muted one, and lets no muted row play an arrival', () => {
    const muted = conversation({ muted: true, lastNote: note('n1', { authorId: BEN, sentAt: 9 }) })
    const model = sidebarModel(input({ conversations: [muted], arrived: new Set([ROOM]) }))
    if (model.people.kind !== 'rows') throw new Error('expected rows')
    const [row] = model.people.rows
    expect(row!.mute).toMatchObject({ muted: true, label: 'Unmute Ben', mark: strings.mute.muted })
    expect(row!.face).toMatchObject({ kind: 'member', avatar: { state: 'idle', motion: 'still' } })
    const off = sidebarModel(input({ conversations: [conversation()], muteOn: false }))
    expect(off.people.kind === 'rows' && off.people.rows[0]!.mute).toBeNull()
    expect(off.people.kind === 'rows' && off.people.rows[0]!.menu).toBeNull()
  })

  it('counts on a channel’s row the answers waiting for the person’s review, and opens the row at the first', () => {
    const billing = channel('billing', { joined: true })
    const room = conversation({ id: billing.conversationId, kind: 'channel', title: 'billing' })
    const waiting = {
      note: draft('note_waiting', { conversationId: billing.conversationId }),
      question: note('note_question'),
      channel: 'billing',
      agent: member(CY, 'Billing helper'),
      privately: false,
    }
    const [row] = sidebarModel(
      input({ conversations: [room], channels: [billing], reviews: [waiting] }),
    ).channelRooms
    expect(row!.review).toEqual({ text: 'Review 1', label: '1 answer waits for your review' })
    expect(row!.href).toBe(`#/c/${billing.conversationId}?review=note_waiting`)
    const [quiet] = sidebarModel(input({ conversations: [room], channels: [billing] })).channelRooms
    expect([quiet!.review, quiet!.href]).toEqual([null, `#/c/${billing.conversationId}`])
  })

  it('gives each row a menu to mute it, and to leave a joined channel unless the person manages it', () => {
    const joined = channel('billing', { joined: true })
    const managed = channel('ops', { joined: true, managing: true })
    const room = (of: ReturnType<typeof channel>, archivedAt: number | null = null) =>
      conversation({ id: of.conversationId, kind: 'channel', title: of.slug, archivedAt })
    const model = sidebarModel(
      input({ conversations: [conversation(), room(joined), room(managed)], channels: [joined, managed] }),
    )
    if (model.people.kind !== 'rows') throw new Error('expected rows')
    expect(model.people.rows[0]!.menu).toMatchObject({
      id: `row-menu-${ROOM}`,
      label: strings.conversationMore({ name: 'Ben' }),
      mute: { muted: false },
      leave: null,
    })
    expect(model.channelRooms.map((row) => row.menu?.leave)).toEqual([
      {
        kind: 'allowed',
        slug: 'billing',
        title: strings.leaveChannelTitle({ channel: '#billing' }),
        body: strings.leaveChannelBody,
      },
      { kind: 'blocked', slug: 'ops', reason: strings.managerCannotLeave },
    ])
    const outside = sidebarModel(
      input({ conversations: [room(channel('billing'))], channels: [channel('billing')], muteOn: false }),
    )
    expect(outside.channelRooms[0]!.menu).toBeNull()
  })
})
