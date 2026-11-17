import type { Conversation, Member, MemberId, Note, NoteId, Receipt } from '@homingbird/protocol'
import { describeStatus, summarize } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  conversationTitle,
  excerpt,
  isUnreadBy,
  noteAwaitingReply,
  otherParticipants,
  threadItems,
  upsertNote,
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

const draft = (id: string, fields: Partial<Note> = {}): Note =>
  note(id, { status: 'draft', sentAt: null, authorId: june, origin: 'agent', ...fields })

describe('threadItems', () => {
  it('orders sent notes by time and puts drafts after them', () => {
    const items = threadItems([draft('d1'), note('b', { sentAt: 20 }), note('a', { sentAt: 10 })])
    expect(items.map((item) => item.key)).toEqual(['a', 'b', 'drafts:d1'])
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

describe('what needs the viewer', () => {
  const question = note('q', { receipts: [receipt(june)] })

  it('finds the latest note from someone else that the viewer has not answered', () => {
    const later = note('q2', { sentAt: 9, receipts: [receipt(june)] })
    expect(noteAwaitingReply([question, later], june)?.id).toBe('q2')
    expect(noteAwaitingReply([question], ana)).toBeNull()
    expect(noteAwaitingReply([note('q', { receipts: [receipt(june, { repliedAt: 3 })] })], june)).toBeNull()
    expect(noteAwaitingReply([draft('d')], june)).toBeNull()
  })

  it('counts a note as unread only for a recipient who has not opened it', () => {
    expect(isUnreadBy(question, june)).toBe(true)
    expect(isUnreadBy(question, ana)).toBe(false)
    expect(isUnreadBy(question, cy)).toBe(false)
    expect(isUnreadBy(note('q', { receipts: [receipt(june, { readAt: 2 })] }), june)).toBe(false)
    expect(isUnreadBy(draft('d', { authorId: ana }), june)).toBe(false)
  })
})

describe('conversation titles', () => {
  const conversation = (fields: Partial<Conversation>): Conversation => ({
    id: 'conv_000000000000' as never,
    kind: 'dm',
    title: null,
    participantIds: [ana, june],
    createdAt: 1,
    lastActivityAt: 1,
    lastNote: null,
    unreadCount: 0,
    draftCount: 0,
    ...fields,
  })
  const members = new Map<MemberId, Member>([[june, { name: 'June' } as Member]])

  it('names a direct conversation after the other person', () => {
    expect(conversationTitle(conversation({}), members, ana, 'Former member')).toBe('June')
    expect(otherParticipants(conversation({}), ana)).toEqual([june])
  })

  it('prefers a group title and otherwise lists everyone else', () => {
    const group = conversation({ kind: 'group', participantIds: [ana, june, cy] })
    expect(conversationTitle(group, members, ana, 'Former member')).toBe('June, Former member')
    expect(conversationTitle({ ...group, title: 'Billing' }, members, ana, 'x')).toBe('Billing')
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
})
