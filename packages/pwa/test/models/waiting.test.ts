import type { AsRead, ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type ActivityInput, activityModel } from '../../src/models/activity.ts'
import {
  NOTHING_WAITS,
  type Waiting,
  outsideTabModel,
  unreadCount,
  waitingFilterModel,
  waitingOf,
} from '../../src/models/waiting.ts'
import { strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CHANNEL_ROOM,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  everything,
  me,
  member,
  note,
  suggestion,
  summary,
} from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId
const OTHER_ROOM = 'conv_other0000000' as ConversationId
const NOW = 1_000_000

const input = (fields: Partial<ActivityInput> = {}): ActivityInput => ({
  me: me(),
  threads: new Map(),
  conversations: [conversation()],
  channels: [],
  members: new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
    [CY, member(CY, 'Cy')],
  ]),
  directory: [],
  draftsRead: new Map(),
  draftEdits: new Map(),
  held: [],
  draftRequests: [],
  releases: new Map(),
  reviews: [],
  reviewsRead: new Map(),
  debates: [],
  suggestions: [],
  taught: null,
  agentReport: null,
  serverInfo: everything(),
  now: NOW,
  ...fields,
})

const review: AsRead.Review = {
  note: draft('note_answer00000', {
    authorId: AGENT,
    conversationId: CHANNEL_ROOM,
    inReplyTo: 'note_question000' as NoteId,
    updatedAt: 50,
  }),
  question: note('note_question000', { authorId: CY, conversationId: CHANNEL_ROOM, body: 'Where is it?' }),
  channel: 'payments',
  agent: member(AGENT, 'Payments helper', { kind: 'channel_agent' }),
  privately: false,
}

/** Two drafts in one room, one still loading in another, an answer to review, a skipped note and a room. */
const busy = (): ActivityInput => {
  const asked = note('note_asked000000', { authorId: BEN, body: 'Can you check?', sentAt: 20 })
  return input({
    conversations: [
      conversation(),
      conversation({ id: OTHER_ROOM, participantIds: [ANA, CY], draftCount: 1, lastActivityAt: 5 }),
      conversation({ id: CHANNEL_ROOM, kind: 'channel', title: 'payments', participantIds: [ANA, CY] }),
    ],
    channels: [channel('payments', { conversationId: CHANNEL_ROOM, joined: true, managing: true })],
    threads: new Map([
      [
        ROOM,
        {
          notes: [
            asked,
            draft('note_d1', { inReplyTo: asked.id, updatedAt: 9 }),
            draft('note_d2', { inReplyTo: asked.id }),
          ],
          hasMore: false,
        },
      ],
    ]),
    reviews: [review],
    debates: [summary({ createdAt: 30, participantIds: [BEN] })],
    suggestions: [suggestion()],
  })
}

describe('waitingOf', () => {
  it('counts what the activity panel lists, approvals apart from the rest, the same total as the bell', () => {
    const activity = activityModel(busy())
    const waiting = waitingOf(activity)
    expect(waiting.approvals).toBe(4)
    expect(waiting.others).toBe(2)
    expect(waiting.approvals + waiting.others).toBe(activity.count)
    expect([...waiting.conversationIds].sort()).toEqual([CHANNEL_ROOM, ROOM, OTHER_ROOM].sort())
  })

  it('names each place once, approvals first, with the group it is listed under', () => {
    const waiting = waitingOf(activityModel(busy()))
    expect(waiting.places.map((place) => [place.text, place.why])).toEqual([
      [strings.activity.withPeople({ names: 'Ben' }), strings.activity.groups.drafts],
      [strings.activity.withPeople({ names: 'Cy' }), strings.activity.groups.drafts],
      [strings.activity.inPlace({ place: '#payments' }), strings.activity.groups.reviews],
      [expect.any(String), strings.activity.groups.debates],
    ])
    expect(waiting.places[0]).toMatchObject({ conversationId: ROOM, href: `#/c/${ROOM}?draft=note_d1` })
    expect(waiting.places[3]).toMatchObject({
      conversationId: null,
      href: expect.stringMatching(/^#\/debate\//),
    })
  })

  it('no longer counts or names a decision held a moment', () => {
    const held: Waiting = waitingOf({
      groups: [
        {
          kind: 'drafts',
          title: strings.activity.groups.drafts,
          items: [
            {
              type: 'debate',
              key: 'held',
              at: 1,
              weight: 0,
              text: '',
              place: { conversationId: ROOM, text: 'With Ben', href: '#/', label: '', time: null },
            },
          ],
        },
      ],
    })
    expect(held).toEqual(NOTHING_WAITS)
  })

  it('always counts as many things as the bell does', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.nat({ max: 3 }), (reviewed, debating, loading) => {
        const activity = activityModel(
          input({
            conversations: [conversation({ draftCount: loading })],
            reviews: reviewed ? [review] : [],
            debates: debating ? [summary({ createdAt: 30, participantIds: [BEN] })] : [],
          }),
        )
        const waiting = waitingOf(activity)
        expect(waiting.approvals + waiting.others).toBe(activity.count)
      }),
    )
  })
})

describe('outsideTabModel', () => {
  const waiting = (approvals: number, others: number): Waiting => ({ ...NOTHING_WAITS, approvals, others })
  const unread = [conversation({ unreadCount: 2 })]

  it('leads the title with approvals, then what else waits, then unread notes', () => {
    const title = (shown: Waiting, conversations: AsRead.Conversation[] = []) =>
      outsideTabModel({ name: 'Acme', waiting: shown, conversations }).title
    expect(title(waiting(3, 1), unread)).toBe(
      strings.waiting.titleApproveUnread({ approve: 3, unread: 2, name: 'Acme' }),
    )
    expect(title(waiting(3, 1))).toBe(strings.waiting.titleApprove({ approve: 3, name: 'Acme' }))
    expect(title(waiting(0, 2), unread)).toBe(
      strings.waiting.titleWaitingUnread({ waiting: 2, unread: 2, name: 'Acme' }),
    )
    expect(title(waiting(0, 2))).toBe(strings.waiting.titleWaiting({ waiting: 2, name: 'Acme' }))
    expect(title(NOTHING_WAITS, unread)).toBe(strings.waiting.titleUnread({ unread: 2, name: 'Acme' }))
    expect(title(NOTHING_WAITS)).toBe('Acme')
  })

  it('badges the count of what waits, only a mark for unread notes, and nothing when all is done', () => {
    const badge = (shown: Waiting, conversations: AsRead.Conversation[] = []) =>
      outsideTabModel({ name: 'Acme', waiting: shown, conversations }).badge
    expect(badge(waiting(3, 1), unread)).toBe(4)
    expect(badge(NOTHING_WAITS, unread)).toBe('unread')
    expect(badge(NOTHING_WAITS)).toBeNull()
  })
})

describe('unreadCount', () => {
  it('adds the unread notes of rooms kept open and not muted', () => {
    expect(
      unreadCount([
        conversation({ unreadCount: 2 }),
        conversation({ unreadCount: 5, muted: true }),
        conversation({ unreadCount: 7, archivedAt: 1 }),
        conversation({ unreadCount: 1 }),
      ]),
    ).toBe(3)
  })
})

describe('waitingFilterModel', () => {
  it('counts the places that wait and says what pressing it shows', () => {
    const some: Waiting = { ...NOTHING_WAITS, conversationIds: new Set([ROOM, OTHER_ROOM]) }
    expect(waitingFilterModel(true, some)).toEqual({
      text: strings.waiting.filter,
      label: strings.waiting.filterLabel({ count: 2 }),
      count: 'in 2 places',
      pressed: true,
    })
    expect(waitingFilterModel(false, NOTHING_WAITS)).toEqual({
      text: strings.waiting.filter,
      label: strings.waiting.filterNone,
      count: null,
      pressed: false,
    })
  })
})
