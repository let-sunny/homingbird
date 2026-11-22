import type { ConversationId, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { MATCHES_SHOWN, type NameMatchInput, nameMatches, roomMatch } from '../../src/models/name-matches.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, channel, conversation, entry, member } from '../support/fixtures.ts'

const DEE = 'mem_dee000000000' as MemberId
const GROUP = 'conv_group0000000' as ConversationId

const input = (fields: Partial<NameMatchInput> = {}): NameMatchInput => ({
  query: '',
  viewerId: ANA,
  directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben Kim'), entry(CY, 'Cy Bennett', { canMessage: false })],
  channels: [],
  conversations: [conversation()],
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben Kim')],
    [CY, member(CY, 'Cy Bennett')],
  ]),
  ...fields,
})

describe('nameMatches', () => {
  it('finds nothing until something is typed', () => {
    expect(nameMatches(input({ query: '  # ' }))).toEqual({ people: [], channels: [], rooms: [] })
  })

  it('finds people by name or email, never the person themself, names that start with it first', () => {
    const found = nameMatches(input({ query: 'BEN' }))
    expect(found.people.map((match) => match.label)).toEqual(['Ben Kim', 'Cy Bennett'])
    expect(nameMatches(input({ query: 'ana' })).people).toEqual([])
    expect(nameMatches(input({ query: 'bennett@example' })).people.map((match) => match.label)).toEqual([
      'Cy Bennett',
    ])
  })

  it('opens a direct message there is, starts one there is not, and sends to People who cannot be messaged', () => {
    const [ben, cy] = nameMatches(input({ query: 'ben' })).people
    expect(ben).toEqual({
      key: `person:${BEN}`,
      kind: 'person',
      label: 'Ben Kim',
      detail: 'ben kim@example.com',
      target: { kind: 'href', href: `#/c/${ROOM}` },
    })
    expect(cy?.target).toEqual({ kind: 'href', href: '#/people' })
    expect(cy?.detail).toBe('cy bennett@example.com')
    const fresh = nameMatches(input({ query: 'ben', conversations: [] })).people[0]
    expect(fresh?.target).toEqual({ kind: 'message', memberId: BEN })
    expect(fresh?.detail).toBe(strings.switcher.startMessage)
  })

  it('leaves out people who left and anyone who is not a person', () => {
    const found = nameMatches(
      input({
        query: 'ben',
        directory: [
          entry(BEN, 'Ben Kim', { member: member(BEN, 'Ben Kim', { status: 'deactivated' }) }),
          entry(DEE, 'Ben helper', { member: member(DEE, 'Ben helper', { kind: 'channel_agent' }) }),
        ],
      }),
    )
    expect(found.people).toEqual([])
  })

  it('finds open channels and private ones the person is in, never a private channel they are not in', () => {
    const found = nameMatches(
      input({
        query: '#pay',
        channels: [
          channel('payments', { joined: true }),
          channel('payroll', { visibility: 'private' }),
          channel('pay-secret', { visibility: 'private', joined: true, description: '' }),
          channel('repay'),
        ],
      }),
    )
    expect(found.channels).toEqual([
      {
        key: 'channel:pay-secret',
        kind: 'channel',
        label: '#pay-secret',
        detail: null,
        target: { kind: 'href', href: `#/c/${channel('pay-secret').conversationId}` },
      },
      {
        key: 'channel:payments',
        kind: 'channel',
        label: '#payments',
        detail: 'About payments',
        target: { kind: 'href', href: `#/c/${channel('payments').conversationId}` },
      },
      {
        key: 'channel:repay',
        kind: 'channel',
        label: '#repay',
        detail: strings.switcher.notJoined,
        target: { kind: 'href', href: '#/channel/repay' },
      },
    ])
  })

  it('finds group messages the person takes part in by who is in them', () => {
    const group = conversation({ id: GROUP, kind: 'group', participantIds: [ANA, BEN, CY] })
    const found = nameMatches(input({ query: 'cy', conversations: [conversation(), group] }))
    expect(found.rooms.map((match) => [match.label, match.target])).toEqual([
      ['Ben Kim, Cy Bennett', { kind: 'href', href: `#/c/${GROUP}` }],
    ])
  })

  it('finds a group by someone its short title leaves out, and skips people it cannot name', () => {
    const big = conversation({
      id: GROUP,
      kind: 'group',
      title: 'Quarterly',
      participantIds: [ANA, BEN, DEE],
    })
    expect(
      nameMatches(input({ query: 'kim', conversations: [big] })).rooms.map((match) => match.label),
    ).toEqual(['Quarterly'])
    expect(nameMatches(input({ query: 'dee', conversations: [big] })).rooms).toEqual([])
  })

  it('shows only the first few of each kind', () => {
    const many = Array.from({ length: MATCHES_SHOWN + 3 }, (_, index) => channel(`team-${index}`))
    expect(nameMatches(input({ query: 'team', channels: many })).channels).toHaveLength(MATCHES_SHOWN)
  })
})

describe('roomMatch', () => {
  it('names a room as its list does, a channel as a channel, and says when it is archived', () => {
    const view = { members: input().members, viewerId: ANA }
    expect(roomMatch(view, conversation())).toMatchObject({ kind: 'room', label: 'Ben Kim', detail: null })
    expect(
      roomMatch(view, conversation({ id: ROOM, kind: 'channel', title: 'ops', archivedAt: 3 })),
    ).toMatchObject({ kind: 'channel', detail: strings.switcher.archived })
  })
})
