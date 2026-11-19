import type { Channel, Conversation, ConversationId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  archivedRooms,
  channelLabel,
  channelNamed,
  channelOfRoom,
  channelRooms,
  chipsForPerson,
  destinationsFrom,
  isPrivate,
  isValidSlug,
  joinedFirst,
  mayMoveBetween,
  peopleConversations,
  rosterFacts,
  similarChannels,
  slugFrom,
  withChannel,
  withoutRoom,
} from '../src/channels.ts'

const channel = (slug: string, fields: Partial<Channel> = {}): Channel => ({
  slug,
  description: `About ${slug}`,
  conversationId: `conv_${slug}` as ConversationId,
  visibility: 'open',
  memberCount: 1,
  helperCount: 1,
  joined: false,
  answering: false,
  managing: false,
  createdAt: 1,
  ...fields,
})

const room = (id: string, kind: Conversation['kind'], title: string | null = null): Conversation => ({
  id: id as ConversationId,
  kind,
  title,
  participantIds: ['mem_ana000000000' as never],
  createdAt: 1,
  lastActivityAt: 1,
  lastNote: null,
  unreadCount: 0,
  draftCount: 0,
  archivedAt: null,
})

describe('channelLabel', () => {
  it('shows a channel as a hashtag', () => {
    expect(channelLabel('billing')).toBe('#billing')
  })
})

describe('slugFrom', () => {
  it.each([
    ['Billing', 'billing'],
    ['#release calendar', 'release-calendar'],
    ['  Payments / Refunds ', 'payments-refunds'],
    ['--ops', 'ops'],
    ['typing-', 'typing-'],
  ])('turns %j into %j', (typed, slug) => {
    expect(slugFrom(typed)).toBe(slug)
  })

  it('always yields a valid slug or something a person is still typing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (typed) => {
        const slug = slugFrom(typed).replace(/-+$/, '')
        expect(slug === '' || isValidSlug(slug)).toBe(true)
      }),
    )
  })

  it('leaves a valid slug unchanged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]([a-z0-9]|-[a-z0-9]){0,15}$/), (slug) => {
        expect(slugFrom(slug)).toBe(slug)
      }),
    )
  })
})

describe('similarChannels', () => {
  const channels = [channel('billing'), channel('billing-ops'), channel('lobby'), channel('bill')]

  it('puts the exact match first, then the others that contain or are contained', () => {
    expect(similarChannels(channels, 'Billing').map((each) => each.slug)).toEqual([
      'billing',
      'bill',
      'billing-ops',
    ])
  })

  it('finds nothing for an empty field', () => {
    expect(similarChannels(channels, ' # ')).toEqual([])
  })
})

describe('lookups', () => {
  it('finds a channel by slug and by its room', () => {
    const channels = [channel('billing'), channel('lobby')]
    expect(channelNamed(channels, 'lobby')?.slug).toBe('lobby')
    expect(channelNamed(channels, 'nope')).toBeNull()
    expect(channelOfRoom(channels, 'conv_billing' as ConversationId)?.slug).toBe('billing')
    expect(channelOfRoom(channels, 'conv_x' as ConversationId)).toBeNull()
  })

  it('splits channel rooms from conversations with people', () => {
    const all = [
      room('a', 'direct'),
      room('b', 'channel', 'zeta'),
      room('c', 'group', 'G'),
      room('d', 'channel', 'alpha'),
    ]
    expect(channelRooms(all).map((each) => each.id)).toEqual(['d', 'b'])
    expect(peopleConversations(all).map((each) => each.id)).toEqual(['a', 'c'])
  })
})

describe('joinedFirst', () => {
  it('lists the channels I am in first, then by member count, then by name', () => {
    const sorted = [
      channel('zeta', { memberCount: 3 }),
      channel('alpha', { memberCount: 3 }),
      channel('big', { memberCount: 40 }),
      channel('mine', { joined: true, memberCount: 1 }),
    ].sort(joinedFirst)
    expect(sorted.map((each) => each.slug)).toEqual(['mine', 'big', 'alpha', 'zeta'])
  })
})

describe('archived rooms', () => {
  it('keeps archived rooms out of the channel and people lists and lists them apart', () => {
    const all = [
      room('a', 'direct'),
      { ...room('b', 'group', 'old'), archivedAt: 5 },
      room('c', 'channel', 'live'),
      { ...room('d', 'channel', 'gone'), archivedAt: 9 },
    ]
    expect(channelRooms(all).map((each) => each.id)).toEqual(['c'])
    expect(peopleConversations(all).map((each) => each.id)).toEqual(['a'])
    expect(archivedRooms(all).map((each) => each.id)).toEqual(['d', 'b'])
  })
})

describe('where a question may move', () => {
  it('moves an open question to any open channel or a private one I am in, never to where it is', () => {
    const here = channel('billing')
    const all = [
      here,
      channel('deploys'),
      channel('secret', { visibility: 'private' }),
      channel('mine', { visibility: 'private', joined: true }),
    ]
    expect(destinationsFrom(all, here, here).map((each) => each.slug)).toEqual(['mine', 'deploys'])
  })

  it('keeps a private question among private channels I am in', () => {
    const here = channel('payroll', { visibility: 'private', joined: true })
    expect(mayMoveBetween(here, channel('billing'))).toBe(false)
    expect(mayMoveBetween(here, channel('hr', { visibility: 'private', joined: true }))).toBe(true)
  })

  it('offers no destination when the only channel is the one it is in', () => {
    const here = channel('billing')
    expect(destinationsFrom([here], here, here)).toEqual([])
  })
})

describe('rosterFacts', () => {
  const member = (memberId: string, manager: boolean) => ({
    memberId: memberId as never,
    answering: false,
    manager,
  })

  it('names the last manager and whether that is the viewer', () => {
    const roster = { memberCount: 2, members: [member('me', true), member('you', false)] }
    expect(rosterFacts(roster, 'me' as never)).toEqual({
      hasManager: true,
      lastManagerId: 'me',
      viewerIsLastManager: true,
    })
    expect(rosterFacts(roster, 'you' as never).viewerIsLastManager).toBe(false)
  })

  it('lets the only member, who is the manager, leave', () => {
    expect(
      rosterFacts({ memberCount: 1, members: [member('me', true)] }, 'me' as never).viewerIsLastManager,
    ).toBe(false)
  })

  it('knows when nobody in the room manages it', () => {
    expect(rosterFacts({ memberCount: 1, members: [member('me', false)] }, 'me' as never).hasManager).toBe(
      false,
    )
    expect(rosterFacts(null, null)).toEqual({
      hasManager: false,
      lastManagerId: null,
      viewerIsLastManager: false,
    })
  })
})

describe('private channels in the list', () => {
  it('tells a private channel from an open one', () => {
    expect(isPrivate(channel('payroll', { visibility: 'private' }))).toBe(true)
    expect(isPrivate(channel('billing'))).toBe(false)
  })

  it('replaces a changed channel in place, or adds a new one in name order', () => {
    const listed = [channel('billing'), channel('lobby')]
    expect(withChannel(listed, channel('billing', { joined: true })).map((each) => each.joined)).toEqual([
      true,
      false,
    ])
    expect(withChannel(listed, channel('deploys')).map((each) => each.slug)).toEqual([
      'billing',
      'deploys',
      'lobby',
    ])
  })

  it('drops a private room I left, keeps an open one, and keeps a private one for an administrator to see but not manage', () => {
    const listed = [
      channel('billing', { joined: true, answering: true }),
      channel('payroll', { visibility: 'private', joined: true, managing: true }),
    ]
    expect(withoutRoom(listed, 'conv_payroll' as ConversationId, false).map((each) => each.slug)).toEqual([
      'billing',
    ])
    expect(withoutRoom(listed, 'conv_billing' as ConversationId, false)[0]).toMatchObject({
      slug: 'billing',
      joined: false,
      answering: false,
    })
    expect(withoutRoom(listed, 'conv_payroll' as ConversationId, true)[1]).toMatchObject({
      slug: 'payroll',
      joined: false,
      managing: false,
    })
    expect(withoutRoom(listed, 'conv_billing' as ConversationId, true)[0]).toMatchObject({ managing: true })
  })
})

describe('chipsForPerson', () => {
  const many = Array.from({ length: 26 }, (_, index) => `area-${String(index).padStart(2, '0')}`)

  it('shows the first six channels and keeps the rest behind a disclosure', () => {
    const { first, rest } = chipsForPerson(many, new Set())
    expect(first).toHaveLength(6)
    expect(rest).toHaveLength(20)
    expect([...first, ...rest]).toEqual(many)
  })

  it('puts the channels the viewer shares with that person first, in their order', () => {
    const { first } = chipsForPerson(many, new Set(['area-20', 'area-03']))
    expect(first.slice(0, 2)).toEqual(['area-03', 'area-20'])
    expect(first.slice(2)).toEqual(['area-00', 'area-01', 'area-02', 'area-04'])
  })

  it('never hides a single channel behind “1 more”', () => {
    expect(chipsForPerson(many.slice(0, 7), new Set()).rest).toEqual([])
  })

  it('shows a short list whole', () => {
    expect(chipsForPerson(['billing'], new Set())).toEqual({ first: ['billing'], rest: [] })
  })
})
