import type {
  AsRead,
  Conversation,
  ConversationId,
  DirectoryEntry,
  DraftRequest,
  Member,
  MemberId,
  Note,
  NoteId,
  Receipt,
} from '@homingbird/protocol'
import { describeStatus, summarize } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { strings } from '../src/strings.ts'
import {
  alternativesLeftAfterSending,
  answeredBy,
  conversationTitle,
  draftDestination,
  excerpt,
  groupWith,
  isArchived,
  isMuted,
  isUnreadBy,
  myNoteState,
  namesInBrief,
  otherParticipants,
  readProgress,
  showsAuthors,
  statusOf,
  threadItems,
  upsertNote,
  withAgentPresence,
  withNoteFiled,
  withPresence,
  withReceipts,
  withoutNote,
} from '../src/thread.ts'

const ana = 'mem_ana000000000' as MemberId
const june = 'mem_june00000000' as MemberId
const cy = 'mem_cy0000000000' as MemberId

const receipt = (memberId: MemberId, times: Partial<Receipt> = {}): Receipt => ({
  memberId,
  state: 'delivered',
  deliveredAt: 1,
  readAt: null,
  draftingAt: null,
  repliedAt: null,
  ...times,
})

const note = (id: string, fields: Partial<Note> = {}): Note => ({
  id: id as NoteId,
  conversationId: 'conv_000000000000' as never,
  authorId: ana,
  status: 'sent',
  body: id,
  inReplyTo: null,
  origin: 'human',
  agentName: null,
  createdAt: 1,
  updatedAt: 1,
  sentAt: 1,
  receipts: [],
  ...fields,
})

const conversation = (fields: Partial<Conversation>): Conversation => ({
  id: 'conv_000000000000' as never,
  kind: 'direct',
  title: null,
  participantIds: [ana, june],
  createdAt: 1,
  lastActivityAt: 1,
  lastNote: null,
  unreadCount: 0,
  draftCount: 0,
  archivedAt: null,
  ...fields,
})

const draft = (id: string, fields: Partial<Note> = {}): Note =>
  note(id, { status: 'draft', sentAt: null, authorId: june, origin: 'agent', ...fields })

describe('threadItems', () => {
  it('orders sent notes by time and puts drafts after them', () => {
    const items = threadItems([draft('d1'), note('b', { sentAt: 20 }), note('a', { sentAt: 10 })])
    expect(items.map((item) => item.key)).toEqual(['a', 'b', 'drafts:d1'])
  })

  it('keeps a recalled note among the sent ones, where only its author reads it', () => {
    const items = threadItems([note('a', { sentAt: 10 }), note('r', { status: 'withdrawn', sentAt: 5 })])
    expect(items.map((item) => item.key)).toEqual(['r', 'a'])
    expect(threadItems([note('x', { status: 'discarded' })])).toEqual([])
  })

  it('groups drafts that answer the same note as alternatives', () => {
    const items = threadItems([
      note('q'),
      draft('d2', { inReplyTo: 'q' as NoteId, createdAt: 5 }),
      draft('d1', { inReplyTo: 'q' as NoteId, createdAt: 3 }),
      draft('fresh'),
    ])
    const groups = items.filter((item) => item.type === 'drafts')
    expect(groups.map((group) => group.drafts.map((d) => d.id))).toEqual([['fresh'], ['d1', 'd2']])
    expect(groups[0]!.inReplyTo).toBeNull()
    expect(groups[1]!.inReplyTo).toBe('q')
  })

  it('groups drafts that answer one request as alternatives even without a note to reply to', () => {
    const asked = {
      id: 'dreq_1',
      conversationId: 'conv_000000000000',
      inReplyTo: null,
      instruction: '',
      agentId: null,
      createdAt: 1,
      expiresAt: 9,
      cancelledAt: null,
      draftIds: ['d1', 'd2'],
    } as unknown as DraftRequest
    const groups = threadItems([draft('d1'), draft('d2'), draft('d3')], [asked])
    expect(groups.map((group) => group.key)).toEqual(['drafts:dreq_1', 'drafts:d3'])
  })

  it('never shows a discarded note', () => {
    expect(threadItems([note('gone', { status: 'discarded' })])).toEqual([])
  })

  it('breaks ties by id so every participant sees the same order', () => {
    expect(threadItems([note('b'), note('a')]).map((item) => item.key)).toEqual(['a', 'b'])
  })
})

describe('note reducers', () => {
  it('adds a new note and replaces an existing one in place', () => {
    const notes = [note('a'), note('b')]
    expect(upsertNote(notes, note('c')).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(upsertNote(notes, note('a', { body: 'edited' })).map((n) => n.body)).toEqual(['edited', 'b'])
  })

  it('removes a note by id and leaves the rest', () => {
    expect(withoutNote([note('a'), note('b')], 'a' as NoteId).map((n) => n.id)).toEqual(['b'])
  })

  it('files a note under its conversation and takes it out of the one it left', () => {
    const lobby = 'conv_lobby00000' as ConversationId
    const billing = 'conv_billing0000' as ConversationId
    const unrelated = 'conv_unrelated00' as ConversationId
    const before = draft('d', { conversationId: lobby })
    const untouched = { notes: [note('x', { conversationId: unrelated })] }
    const threads = new Map([
      [lobby, { notes: [note('q', { conversationId: lobby }), before] }],
      [billing, { notes: [] as Note[] }],
      [unrelated, untouched],
    ])
    const moved = { ...before, conversationId: billing }
    const filed = withNoteFiled(threads, moved)
    expect(filed.get(lobby)?.notes.map((each) => each.id)).toEqual(['q'])
    expect(filed.get(billing)?.notes).toEqual([moved])
    expect(filed.get(unrelated)).toBe(untouched)
    expect(withNoteFiled(filed, { ...moved, status: 'discarded' }).get(billing)?.notes).toEqual([])
    expect(withNoteFiled(new Map(), moved).size).toBe(0)
  })

  it('replaces the receipts of one note only', () => {
    const updated = withReceipts([note('a'), note('b')], 'b' as NoteId, [
      receipt(june, { readAt: 2, state: 'read' }),
    ])
    expect(updated.map((n) => n.receipts.length)).toEqual([0, 1])
  })

  it('is idempotent when the same note arrives twice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 8 }),
        fc.string({ minLength: 1 }),
        (ids, id) => {
          const notes = [...new Set(ids)].map((each) => note(each))
          const once = upsertNote(notes, note(id))
          expect(upsertNote(once, note(id))).toEqual(once)
        },
      ),
    )
  })
})

describe('presence', () => {
  const entry = (memberId: MemberId): DirectoryEntry =>
    ({ member: { id: memberId }, presence: { humanOnline: false, agentOnline: false } }) as DirectoryEntry

  it('shows that an agent cannot answer, keeping why for the person themself until the directory reloads', () => {
    const before = {
      ...entry(ana),
      presence: { humanOnline: true, agentOnline: true, agentUnavailable: { until: null, kind: 'failed' } },
    } as DirectoryEntry
    const [kept] = withPresence(
      [before],
      [{ memberId: ana, humanOnline: true, agentOnline: true, agentUnavailable: { until: 5 } }],
    )
    expect(kept!.presence).toEqual({
      humanOnline: true,
      agentOnline: true,
      agentUnavailable: { until: 5, kind: 'failed' },
    })
    const [cleared] = withPresence([before], [{ memberId: ana, humanOnline: true, agentOnline: true }])
    expect(cleared!.presence).toEqual({ humanOnline: true, agentOnline: true })
    const [colleague] = withPresence(
      [entry(june)],
      [{ memberId: june, humanOnline: false, agentOnline: true, agentUnavailable: { until: null } }],
    )
    expect(colleague!.presence.agentUnavailable).toEqual({ until: null })
  })

  it('applies a batch of presence changes and leaves everyone else as they were', () => {
    const updated = withPresence(
      [entry(ana), entry(june), entry(cy)],
      [
        { memberId: june, humanOnline: true, agentOnline: false },
        { memberId: cy, humanOnline: false, agentOnline: true },
      ],
    )
    expect(updated.map((each) => each.presence)).toEqual([
      { humanOnline: false, agentOnline: false },
      { humanOnline: true, agentOnline: false },
      { humanOnline: false, agentOnline: true },
    ])
  })

  it('ignores a change for someone who is not in the directory', () => {
    const entries = [entry(ana)]
    expect(withPresence(entries, [{ memberId: june, humanOnline: true, agentOnline: true }])).toEqual(entries)
  })
})

describe('what needs the viewer', () => {
  const question = note('q', { receipts: [receipt(june)] })

  it('counts a note as unread only for a recipient who has not opened it', () => {
    expect(isUnreadBy(question, june)).toBe(true)
    expect(isUnreadBy(question, ana)).toBe(false)
    expect(isUnreadBy(question, cy)).toBe(false)
    expect(isUnreadBy(note('q', { receipts: [receipt(june, { readAt: 2 })] }), june)).toBe(false)
    expect(isUnreadBy(draft('d', { authorId: ana }), june)).toBe(false)
  })
})

describe('conversation titles', () => {
  const members = new Map<MemberId, Member>([[june, { name: 'June' } as Member]])

  it('names a direct conversation after the other person', () => {
    expect(conversationTitle(conversation({}), members, ana, 'Former member')).toBe('June')
    expect(otherParticipants(conversation({}), ana)).toEqual([june])
  })

  it('prefers a group title and otherwise names the first two others and how many more', () => {
    const group = conversation({ kind: 'group', participantIds: [ana, june, cy] })
    expect(conversationTitle(group, members, ana, 'Former member')).toBe('June, Former member')
    expect(conversationTitle({ ...group, title: 'Billing' }, members, ana, 'x')).toBe('Billing')
    const larger = { ...group, participantIds: [ana, june, cy, 'mem_dee' as MemberId, 'mem_eve' as MemberId] }
    expect(conversationTitle(larger, members, ana, 'Gone')).toBe(
      strings.namesAndMore({ names: 'June, Gone', count: 2 }),
    )
  })

  it('names people on one line: the first two, then how many more', () => {
    expect(namesInBrief(['Ana'])).toBe('Ana')
    expect(namesInBrief(['Ana', 'Kai'])).toBe('Ana, Kai')
    expect(namesInBrief(['Ana', 'Kai', 'Ben', 'Cy'])).toBe('Ana, Kai +2')
  })

  it('finds the open group of exactly the viewer and the people chosen, in any order', () => {
    const group = conversation({
      id: 'conv_group0000000' as never,
      kind: 'group',
      participantIds: [cy, ana, june],
    })
    const rooms = [
      conversation({ participantIds: [ana, june] }),
      conversation({ kind: 'group', participantIds: [ana, june, cy, 'mem_dee000000000' as MemberId] }),
      conversation({ kind: 'channel', participantIds: [ana, june, cy] }),
      conversation({ kind: 'group', participantIds: [ana, june, cy], archivedAt: 5 }),
      conversation({ kind: 'group', participantIds: [ana, june, 'mem_dee000000000' as MemberId] }),
      group,
    ]
    expect(groupWith(rooms, ana, [june, cy])).toBe(group)
    expect(groupWith(rooms, ana, [cy, june, ana])).toBe(group)
    expect(groupWith(rooms.slice(0, -1), ana, [june, cy])).toBeUndefined()
  })

  it('shows a channel room as a hashtag, even with a single participant', () => {
    const room = conversation({ kind: 'channel', title: 'billing', participantIds: [ana] })
    expect(conversationTitle(room, members, ana, 'x')).toBe('#billing')
  })

  it('keeps an old server’s archived title as written when the room carries no archive time', () => {
    const archived = conversation({ kind: 'group', title: 'billing (archived)', participantIds: [ana, june] })
    expect(conversationTitle(archived, members, ana, 'x')).toBe('billing (archived)')
  })

  it('shows an archived room by its channel name, leaving the word Archived to the interface', () => {
    const archived = conversation({
      kind: 'group',
      title: 'billing (archived)',
      participantIds: [ana, june],
      archivedAt: 9,
    })
    expect(conversationTitle(archived, members, ana, 'x')).toBe('#billing')
    expect(isArchived(archived)).toBe(true)
    expect(isArchived(conversation({}))).toBe(false)
    expect(isArchived(undefined)).toBe(false)
  })

  it('counts a conversation as muted only when the server says so', () => {
    expect(isMuted(conversation({ muted: true }))).toBe(true)
    expect(isMuted(conversation({ muted: false }))).toBe(false)
    expect(isMuted(conversation({}))).toBe(false)
  })
})

describe('rooms', () => {
  it('names the author on each note in groups and channels, not in direct conversations', () => {
    expect(showsAuthors(undefined)).toBe(false)
    expect(showsAuthors({ kind: 'direct' } as Conversation)).toBe(false)
    expect(showsAuthors({ kind: 'group' } as Conversation)).toBe(true)
    expect(showsAuthors({ kind: 'channel' } as Conversation)).toBe(true)
  })

  it('counts readers out of all recipients', () => {
    expect(readProgress([receipt(june, { readAt: 2, state: 'read' }), receipt(cy), receipt(ana)])).toEqual({
      read: 1,
      of: 3,
      drafting: 0,
    })
    expect(readProgress([receipt(june, { draftingAt: 2, state: 'drafting' })]).drafting).toBe(1)
  })

  it('names who answered a question from replied receipts', () => {
    const question = note('q', {
      receipts: [
        receipt(june, { repliedAt: 3, state: 'replied' }),
        receipt(cy, { readAt: 2, state: 'read' }),
      ],
    })
    expect(answeredBy(question)).toEqual([june])
  })
})

describe('alternativesLeftAfterSending', () => {
  it('discards the other answers to a request for a new note, but leaves replies to the server', () => {
    const fresh = { type: 'drafts', key: 'k', inReplyTo: null, drafts: [draft('a'), draft('b')] } as const
    expect(alternativesLeftAfterSending(fresh, 'a' as NoteId).map((each) => each.id)).toEqual(['b'])
    const replies = { ...fresh, inReplyTo: 'q' as NoteId }
    expect(alternativesLeftAfterSending(replies, 'a' as NoteId)).toEqual([])
  })
})

describe('excerpt', () => {
  it('collapses whitespace and never exceeds the limit', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.integer({ min: 2, max: 120 }), (text, length) => {
        const short = excerpt(text, length)
        expect(short.length).toBeLessThanOrEqual(length)
        expect(short).not.toMatch(/\s{2,}|\n/)
      }),
    )
    expect(excerpt('  a\n\n b  ')).toBe('a b')
    expect(excerpt('abcdef', 4)).toBe('abc…')
  })
})

describe('status lines', () => {
  it('reads the same for the sender and every recipient because it is derived from receipts alone', () => {
    const receipts = [
      receipt(june, { readAt: 2, state: 'read' }),
      receipt(cy),
      receipt(ana, { repliedAt: 3, state: 'replied', readAt: 2 }),
    ]
    expect(describeStatus(summarize(receipts))).toBe('Replied by 1 of 3, read by 2 of 3')
    expect(describeStatus(summarize([receipt(june)]))).toBe('Delivered')
    expect(describeStatus(summarize([receipt(june, { draftingAt: 2, state: 'drafting' })]))).toBe(
      'Drafting reply',
    )
    expect(describeStatus(summarize([]))).toBe('Sent')
  })
  it('names the single-recipient status the web client translates', () => {
    expect(statusOf(summarize([]))).toBe('sent')
    expect(statusOf(summarize([receipt(june)]))).toBe('delivered')
    expect(statusOf(summarize([receipt(june, { readAt: 2, state: 'read' })]))).toBe('read')
    expect(statusOf(summarize([receipt(june, { draftingAt: 2, state: 'drafting' })]))).toBe('drafting')
    expect(statusOf(summarize([receipt(june, { repliedAt: 3, readAt: 2, state: 'replied' })]))).toBe(
      'replied',
    )
  })
})

describe('runs of notes', () => {
  it('marks the first note of each run of consecutive notes by one author', () => {
    const notes = [
      note('n1', { authorId: june, sentAt: 1 }),
      note('n2', { authorId: june, sentAt: 2 }),
      note('n3', { authorId: ana, sentAt: 3 }),
      note('n4', { authorId: june, sentAt: 4 }),
    ]
    expect(threadItems(notes).map((item) => (item.type === 'note' ? item.leadsRun : null))).toEqual([
      true,
      false,
      true,
      true,
    ])
    expect(threadItems(notes).map((item) => (item.type === 'note' ? (item.next?.id ?? null) : null))).toEqual(
      ['n2', null, null, null],
    )
  })

  it('starts a new run whenever the same author changes how a note was written', () => {
    const notes = [
      note('n1', { authorId: june, sentAt: 1, origin: 'agent' }),
      note('n2', { authorId: june, sentAt: 2, origin: 'agent' }),
      note('n3', { authorId: june, sentAt: 3, origin: 'human_edited' }),
      note('n4', { authorId: june, sentAt: 4, origin: 'human' }),
    ]
    expect(threadItems(notes).map((item) => (item.type === 'note' ? item.leadsRun : null))).toEqual([
      true,
      false,
      true,
      true,
    ])
  })

  it('splits any thread into runs that share one author and one way of writing, each led once', () => {
    const origins = ['agent', 'human_edited', 'human'] as const
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(june, ana), fc.constantFrom(...origins)), { maxLength: 30 }),
        (written) => {
          const items = threadItems(
            written.map(([authorId, origin], index) =>
              note(`n${index}`, { authorId, origin, sentAt: index + 1 }),
            ),
          ).filter((item) => item.type === 'note')
          items.forEach((item, index) => {
            const previous = items[index - 1]?.note
            const sameAsPrevious =
              previous !== undefined &&
              previous.authorId === item.note.authorId &&
              previous.origin === item.note.origin
            expect(item.leadsRun).toBe(!sameAsPrevious)
            expect(item.next).toBe(items[index + 1]?.leadsRun === false ? items[index + 1]!.note : null)
          })
        },
      ),
    )
  })
})

describe('where a draft goes', () => {
  it('names the other people of a conversation', () => {
    const room = conversation({ participantIds: [ana, june, cy] })
    expect(draftDestination(room, draft('d'), [], ana)).toEqual({ kind: 'people', memberIds: [june, cy] })
  })

  it('sends a question to the channel and a reply in a channel to the person who asked', () => {
    const room = conversation({ kind: 'channel', title: 'billing', participantIds: [ana, june] })
    const question = note('q', { authorId: june })
    expect(draftDestination(room, draft('d'), [question], ana)).toEqual({ kind: 'channel', memberIds: [] })
    expect(draftDestination(room, draft('d', { inReplyTo: 'q' as never }), [question], ana)).toEqual({
      kind: 'people',
      memberIds: [june],
    })
  })
})

describe('my note’s pose', () => {
  it('poses my character for each status, with a reply flying home', () => {
    expect(myNoteState('sent')).toBe('delivered')
    expect(myNoteState('delivered')).toBe('delivered')
    expect(myNoteState('read')).toBe('read')
    expect(myNoteState('drafting')).toBe('drafting')
    expect(myNoteState('replied')).toBe('returning')
  })
})

describe('withAgentPresence', () => {
  const channel = (slug: string, agent: { id: MemberId; name: string } | null) =>
    ({ slug, agent }) as unknown as AsRead.Channel

  it('applies a presence change to the channel whose own agent it is about, leaving the rest as they are', () => {
    const channels = [channel('billing', { id: june, name: 'Helper' }), channel('wiki', null)]
    const changed = withAgentPresence(channels, [{ memberId: june, humanOnline: false, agentOnline: true }])
    expect(changed[0]!.agent?.presence).toEqual({ humanOnline: false, agentOnline: true })
    expect(changed[1]).toBe(channels[1])
    expect(withAgentPresence(channels, [{ memberId: ana, humanOnline: true, agentOnline: true }])).toBe(
      channels,
    )
  })
})
