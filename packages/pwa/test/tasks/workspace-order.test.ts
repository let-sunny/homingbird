import { arbitrary } from '@homingbird/kernel/testing'
import {
  type AsRead,
  type ConversationId,
  DirectoryEntry,
  type DraftRequest,
  type MemberId,
  type NoteId,
} from '@homingbird/protocol'
import { Channel, Conversation } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { withChannel, withoutRoom } from '../../src/channels.ts'
import { upsertRequest } from '../../src/draft-requests.ts'
import { QUIET_RETRY_SECONDS } from '../../src/load-timing.ts'
import { leaveGroup } from '../../src/tasks/conversation-actions.ts'
import { liveEvents } from '../../src/tasks/live.ts'
import { setMuted } from '../../src/tasks/mutes.ts'
import { loadThread, markRead } from '../../src/tasks/notes.ts'
import { WORKSPACE, again, invalidate, open } from '../../src/tasks/resources.ts'
import { withAgentPresence, withPresence } from '../../src/thread.ts'
import { fail, settle, testApp } from '../support/app.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  entry,
  everything,
  me,
  note,
} from '../support/fixtures.ts'

const GROUP = 'conv_group0000000' as ConversationId
const CHANNEL = channel('billing')
const HALL = CHANNEL.conversationId

/** What the server holds, for the parts of the workspace the steps change. */
interface Held {
  readonly rooms: ReadonlyArray<AsRead.Conversation>
  readonly entries: ReadonlyArray<AsRead.DirectoryEntry>
  readonly contacts: ReadonlyArray<AsRead.Contact>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly requests: ReadonlyArray<DraftRequest>
  readonly notes: ReadonlyArray<AsRead.Note>
}

interface Pending {
  readonly route: string
  /** What the server does and answers at the moment it reads the request. */
  readonly serve: () => unknown
  readonly respond: (answer: unknown) => void
  served: { readonly answer: unknown } | null
}

const withRoom = (
  held: Held,
  id: ConversationId,
  change: (room: AsRead.Conversation) => AsRead.Conversation,
) => ({
  ...held,
  rooms: held.rooms.map((room) => (room.id === id ? change(room) : room)),
})

const receiptOf = (readAt: number | null): AsRead.Receipt => ({
  memberId: ANA,
  state: readAt === null ? 'delivered' : 'read',
  deliveredAt: 1,
  readAt,
  draftingAt: null,
  repliedAt: null,
})

const isUnread = (one: AsRead.Note) => one.receipts.some((receipt) => receipt.readAt === null)

const setUp = () => {
  let held: Held = {
    rooms: [
      conversation(),
      conversation({ id: GROUP, kind: 'group', participantIds: [ANA, BEN, CY] }),
      conversation({ id: HALL, kind: 'channel', title: 'billing' }),
    ],
    entries: [entry(BEN, 'Ben', { relation: 'contact' }), entry(CY, 'Cy', { relation: 'contact' })],
    contacts: [BEN, CY].map((memberId) => ({ memberId, state: 'accepted' as const, since: 1 })),
    channels: [{ ...CHANNEL, joined: true }],
    requests: [],
    notes: [note('n0', { receipts: [receiptOf(1)] })],
  }
  const events: AsRead.StreamEvent[] = []
  const pending: Pending[] = []
  let numbered = 0
  const emit = (body: unknown): void =>
    void events.push({ seq: ++numbered, at: 1, body } as AsRead.StreamEvent)
  const request = (route: string, serve: () => unknown) => {
    let respond = (_: unknown): void => {}
    const waitFor = new Promise((resolve) => {
      respond = resolve
    })
    pending.push({ route, serve, respond, served: null })
    return { waitFor }
  }
  const room = (id: string) => held.rooms.find((one) => one.id === id)
  const list = (route: string, read: () => unknown) => [route, () => request(route, read)] as const
  const test = testApp({
    ...Object.fromEntries([
      list('conversations.list', () => ({ conversations: held.rooms })),
      list('directory.list', () => ({ entries: held.entries })),
      list('contacts.list', () => ({ contacts: held.contacts })),
      list('channels.list', () => ({ channels: held.channels })),
      list('credentials.list', () => ({ credentials: [] })),
      list('draftRequests.list', () => ({ requests: held.requests })),
    ]),
    'conversations.get': ({ params }) =>
      request('conversations.get', () => room(params.id) ?? fail({ _tag: 'NotFound', message: 'no' })),
    'conversations.notes': ({ params }) =>
      request('conversations.notes', () =>
        room(params.id) === undefined
          ? fail({ _tag: 'NotFound', message: 'no' })
          : { notes: held.notes, hasMore: false, notices: [] },
      ),
    'notes.read': ({ params }) =>
      request('notes.read', () => {
        markReadOnServer(params.id)
        return held.notes.find((one) => one.id === params.id)
      }),
    'conversations.mute': ({ params }) => request('conversations.mute', () => mutedOnServer(params.id, true)),
    'conversations.unmute': ({ params }) =>
      request('conversations.unmute', () => mutedOnServer(params.id, false)),
    'conversations.leave': ({ params }) =>
      request('conversations.leave', () => {
        server.leave(params.id as ConversationId)
        return {}
      }),
  })
  const unreadNow = () => held.notes.filter(isUnread).length
  const markReadOnServer = (id: string): void => {
    held = {
      ...held,
      notes: held.notes.map((one) => (one.id === id ? { ...one, receipts: [receiptOf(1)] } : one)),
    }
    held = withRoom(held, ROOM, (one) => ({ ...one, unreadCount: unreadNow() }))
    emit({ type: 'note.status', noteId: id, conversationId: ROOM, receipts: [receiptOf(1)] })
  }
  const mutedOnServer = (id: string, muted: boolean) => {
    held = withRoom(held, id as ConversationId, (one) => ({ ...one, muted }))
    return room(id) ?? fail({ _tag: 'NotFound', message: 'no' })
  }
  let notesSent = 0
  const server = {
    note: () => {
      const sent = note(`n${++notesSent}`, { receipts: [receiptOf(null)], sentAt: notesSent + 1 })
      held = { ...held, notes: [...held.notes, sent] }
      held = withRoom(held, ROOM, (one) => ({
        ...one,
        unreadCount: unreadNow(),
        lastActivityAt: notesSent + 1,
      }))
      emit({ type: 'note.sent', note: sent })
    },
    readElsewhere: () => {
      const unread = held.notes.find(isUnread)
      if (unread === undefined) return
      held = {
        ...held,
        notes: held.notes.map((one) => ({
          ...one,
          receipts:
            one.id === unread.id
              ? [{ ...receiptOf(null), state: 'delivered' as const, draftingAt: numbered + 1 }]
              : one.receipts,
        })),
      }
      emit({
        type: 'note.status',
        noteId: unread.id,
        conversationId: ROOM,
        receipts: held.notes.find((one) => one.id === unread.id)!.receipts,
      })
    },
    leave: (id: ConversationId) => {
      if (room(id) === undefined) return
      held = { ...held, rooms: held.rooms.filter((one) => one.id !== id) }
      if (id === HALL) {
        held = { ...held, channels: [{ ...CHANNEL, joined: false }] }
        emit({ type: 'channel.left', slug: CHANNEL.slug, conversationId: id })
      } else emit({ type: 'conversation.left', conversationId: id, memberId: ANA })
    },
    otherLeaves: () => {
      if (room(GROUP)?.participantIds.includes(CY) !== true) return
      held = withRoom(held, GROUP, (one) => ({ ...one, participantIds: [ANA, BEN] }))
      emit({ type: 'conversation.left', conversationId: GROUP, memberId: CY })
    },
    join: () => {
      if (room(HALL) !== undefined) return
      held = {
        ...held,
        rooms: [...held.rooms, conversation({ id: HALL, kind: 'channel', title: 'billing' })],
        channels: [{ ...CHANNEL, joined: true }],
      }
      emit({ type: 'channel.changed', channel: { ...CHANNEL, joined: true } })
    },
    presence: () => {
      const humanOnline = !held.entries[0]!.presence.humanOnline
      held = {
        ...held,
        entries: held.entries.map((one) =>
          one.member.id === BEN ? { ...one, presence: { humanOnline, agentOnline: false } } : one,
        ),
      }
      emit({ type: 'presence', members: [{ memberId: BEN, humanOnline, agentOnline: false }] })
    },
    contactRemoved: () => {
      held = {
        ...held,
        contacts: held.contacts.filter((one) => one.memberId !== CY),
        entries: held.entries.map((one) => (one.member.id === CY ? { ...one, relation: 'none' } : one)),
      }
      emit({ type: 'contact.changed', memberId: CY })
    },
    renamed: () => {
      held = {
        ...held,
        entries: held.entries.map((one) =>
          one.member.id === CY ? { ...one, member: { ...one.member, name: `${one.member.name}+` } } : one,
        ),
      }
      emit({ type: 'directory.changed', memberId: CY })
    },
    request: () => {
      const known = held.requests[0]
      const changed = {
        id: 'dreq_000000000000',
        conversationId: ROOM,
        inReplyTo: null,
        instruction: '',
        agentId: null,
        createdAt: 1,
        expiresAt: 2,
        cancelledAt: null,
        draftIds: known === undefined ? [] : ['d1' as NoteId],
      } as unknown as DraftRequest
      const isCancelled = known !== undefined && known.draftIds.length > 0
      held = { ...held, requests: isCancelled ? [] : [changed] }
      emit({
        type: known === undefined ? 'draft.requested' : 'draft.request.changed',
        request: isCancelled ? { ...changed, cancelledAt: 3 } : changed,
      })
    },
  }
  test.state.session.set(me())
  test.state.serverInfo.set(everything())
  test.state.connection.set('live')
  return { ...test, server, events, pending, held: () => held, apply: liveEvents(test.app) }
}

const SERVER_STEPS = [
  'note',
  'readElsewhere',
  'leaveGroup',
  'leaveHall',
  'otherLeaves',
  'join',
  'presence',
  'contactRemoved',
  'renamed',
  'request',
] as const
const OWN_STEPS = ['mute', 'unmute', 'markRead', 'leave', 'thread', 'open', 'again', 'invalidate'] as const
const stepsOf = (does: ReadonlyArray<string>): fc.Arbitrary<ReadonlyArray<Step>> =>
  fc.array(
    fc.oneof(
      fc.record({ does: fc.constantFrom(...does) }),
      fc.record({ does: fc.constant('deliver' as const) }),
      fc.record({
        does: fc.constantFrom('serve' as const, 'answer' as const, 'fail' as const),
        which: fc.nat(20),
      }),
      fc.record({ does: fc.constant('answer' as const), which: fc.nat(20) }),
      fc.record({ does: fc.constant('wait' as const), ms: fc.constantFrom(400, 2500) }),
    ),
    { maxLength: 45, size: 'max' },
  )

type Step = { readonly does: string; readonly which?: number; readonly ms?: number }

const play = async (script: ReadonlyArray<Step>, isInTheRoom = false) => {
  const test = setUp()
  const { app, state, server, events, pending, held, apply, clock } = test
  const left = new Set<string>()
  const marked = new Set<string>()
  const broken: string[] = []
  const check = (): void => {
    for (const room of state.conversations.get()) if (left.has(room.id)) broken.push(`D1: ${room.id} is back`)
  }
  state.conversations.subscribe(check)
  const deliver = (): void => {
    const event = events.shift()
    if (event === undefined) return
    const { body } = event
    apply(event)
    const isOwn = body.type === 'channel.left' || (body.type === 'conversation.left' && body.memberId === ANA)
    const id = isOwn ? (body as { conversationId: string }).conversationId : null
    if (id !== null && !held().rooms.some((room) => room.id === id)) left.add(id)
    check()
  }
  const answer = (which: number, isFailing = false): void => {
    const [one] = pending.splice(which % Math.max(1, pending.length), 1)
    if (one === undefined) return
    one.served ??= { answer: isFailing ? fail({ _tag: 'Unavailable', message: 'down' }) : one.serve() }
    one.respond(one.served.answer)
  }
  const take = async (step: Step): Promise<void> => {
    switch (step.does) {
      case 'deliver':
        return deliver()
      case 'serve': {
        const one = pending[step.which! % Math.max(1, pending.length)]
        if (one !== undefined) one.served ??= { answer: one.serve() }
        return
      }
      case 'answer':
        return answer(step.which!)
      case 'fail':
        return answer(step.which!, true)
      case 'wait':
        return void (await clock.advance(step.ms!))
      case 'mute':
      case 'unmute':
        if (pending.some((one) => one.route.endsWith('mute'))) return
        return app.launch(setMuted(ROOM, step.does === 'mute'))
      case 'leave':
        return app.launch(leaveGroup(GROUP, 'left'))
      case 'thread':
        return app.launch(loadThread(ROOM))
      case 'markRead': {
        const unread = state.threads
          .get()
          .get(ROOM)
          ?.notes.find((one) => isUnread(one) && !marked.has(one.id))
        if (unread === undefined) return
        marked.add(unread.id)
        app.launch(markRead(unread))
        return
      }
      case 'open':
        return app.launch(open(...WORKSPACE))
      case 'invalidate':
        return app.launch(invalidate('conversations', 'directory'))
      case 'again':
        return app.launch(again('conversations', 'directory'))
      case 'join':
        left.delete(HALL)
        return server.join()
      case 'leaveGroup':
        return server.leave(GROUP)
      case 'leaveHall':
        return server.leave(HALL)
      default:
        return server[step.does as 'note']()
    }
  }
  if (isInTheRoom) {
    app.launch(loadThread(ROOM))
    await settle()
    while (pending.length > 0) answer(0)
    await settle()
  }
  app.launch(open(...WORKSPACE))
  await settle()
  for (const step of script) {
    await take(step)
    await settle()
    check()
  }
  for (
    let round = 0;
    round < 40 && (events.length > 0 || pending.length > 0 || clock.pending() > 0);
    round++
  ) {
    while (events.length > 0) deliver()
    while (pending.length > 0) {
      answer(0)
      await settle()
    }
    await clock.advance(QUIET_RETRY_SECONDS * 1000)
    await settle()
  }
  expect(broken).toEqual([])
  return test
}

const isSettled = (pending: ReadonlyArray<unknown>, events: ReadonlyArray<unknown>) =>
  pending.length === 0 && events.length === 0

const READ_WHILE_THE_ROOM_LOADS: ReadonlyArray<Step> = [
  ...Array<Step>(6).fill({ does: 'answer', which: 0 }),
  { does: 'note' },
  { does: 'deliver' },
  { does: 'thread' },
  { does: 'serve', which: 1 },
  { does: 'serve', which: 2 },
  { does: 'readElsewhere' },
  { does: 'deliver' },
  { does: 'answer', which: 1 },
  { does: 'answer', which: 1 },
]

describe('the workspace, whatever the order of events, actions and answers', () => {
  it('never brings back a room that was left, and ends as the server is', async () => {
    await fc.assert(
      fc.asyncProperty(
        stepsOf([...SERVER_STEPS, ...OWN_STEPS]),
        fc.boolean(),
        async (script, isInTheRoom) => {
          const { state, held, pending, events } = await play(script, isInTheRoom)
          const server = held()
          expect(isSettled(pending, events)).toBe(true)
          expect(state.workspace.get()).toBe('loaded')
          const roomsOf = (rooms: ReadonlyArray<AsRead.Conversation>) =>
            rooms
              .map(({ id, muted, unreadCount, participantIds }) => ({
                id,
                muted: muted === true,
                unreadCount,
                participantIds,
              }))
              .sort((a, b) => a.id.localeCompare(b.id))
          expect(roomsOf(state.conversations.get()), 'rooms, mute, unread and people').toEqual(
            roomsOf(server.rooms),
          )
          expect(state.directory.get(), 'names, presence and relations').toEqual(server.entries)
          expect(state.contacts.get(), 'contacts').toEqual(server.contacts)
          expect(state.channels.get(), 'channels').toEqual(server.channels)
          expect(state.draftRequests.get(), 'draft requests').toEqual(server.requests)
          const thread = state.threads.get().get(ROOM)
          if (thread !== undefined)
            expect(
              thread.notes.map((one) => [one.id, one.receipts]),
              'notes and receipts',
            ).toEqual(server.notes.map((one) => [one.id, one.receipts]))
        },
      ),
      { numRuns: 300 },
    )
  }, 20_000)

  it('counts what is unread, and shows who read what, as the server does while the person reads', async () => {
    const reading = ['note', 'note', 'markRead', 'markRead', 'readElsewhere', 'thread', 'open', 'invalidate']
    await fc.assert(
      fc.asyncProperty(stepsOf(reading), async (script) => {
        const { state, held } = await play(script, true)
        const unread = (rooms: ReadonlyArray<AsRead.Conversation>) =>
          rooms.find((room) => room.id === ROOM)!.unreadCount
        expect(unread(state.conversations.get())).toBe(unread(held().rooms))
        expect(
          state.threads
            .get()
            .get(ROOM)!
            .notes.map((one) => [one.id, one.receipts]),
        ).toEqual(held().notes.map((one) => [one.id, one.receipts]))
      }),
      { numRuns: 300, examples: [[READ_WHILE_THE_ROOM_LOADS]] },
    )
  }, 20_000)
})

describe('each change an event or an action makes', () => {
  const twiceIsOnce = <A>(value: fc.Arbitrary<A>, change: (value: A) => A): void =>
    fc.assert(
      fc.property(value, (before) => {
        expect(change(change(before))).toEqual(change(before))
      }),
      { numRuns: 100 },
    )
  const channels = fc.array(arbitrary(Channel), { maxLength: 4 }) as fc.Arbitrary<
    ReadonlyArray<AsRead.Channel>
  >
  const entries = fc.array(arbitrary(DirectoryEntry), { maxLength: 4 }) as fc.Arbitrary<
    ReadonlyArray<AsRead.DirectoryEntry>
  >
  const rooms = fc.array(arbitrary(Conversation), { maxLength: 4 }) as fc.Arbitrary<
    ReadonlyArray<AsRead.Conversation>
  >

  it('means the same made twice as made once', () => {
    fc.assert(
      fc.property(channels, entries, fc.nat(), fc.boolean(), (known, people, which, flag) => {
        const of = known[which % Math.max(1, known.length)] ?? CHANNEL
        const person = people[which % Math.max(1, people.length)]?.member.id ?? (BEN as MemberId)
        const presence = [{ memberId: person, humanOnline: flag, agentOnline: !flag }]
        const same = <A>(change: (value: A) => A, value: A) =>
          expect(change(change(value))).toEqual(change(value))
        same((all) => withChannel(all, { ...of, joined: flag }), known)
        same((all) => withChannel(all, { ...CHANNEL, joined: flag }), known)
        same((all) => withAgentPresence(withoutRoom(withChannel(all, CHANNEL), HALL, flag), presence), known)
        same((all) => withoutRoom(all, of.conversationId, flag), known)
        same((all) => withAgentPresence(all, presence), known)
        same((all) => withPresence(all, presence), people)
      }),
      { numRuns: 200 },
    )
  })

  it('and so does each made to the rooms and to the draft requests', () => {
    twiceIsOnce(rooms, (all) => all.map((room) => ({ ...room, unreadCount: Math.min(room.unreadCount, 1) })))
    fc.assert(
      fc.property(fc.boolean(), (isCancelled) => {
        const request = { id: 'dreq_1', cancelledAt: isCancelled ? 1 : null } as unknown as DraftRequest
        const once = upsertRequest([{ ...request, id: 'dreq_2' as never }], request)
        expect(upsertRequest(once, request)).toEqual(once)
      }),
    )
  })
})
