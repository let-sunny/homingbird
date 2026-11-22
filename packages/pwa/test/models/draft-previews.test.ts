import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { confirmedPreviewLine, draftPreviewsModel } from '../../src/models/draft-previews.ts'
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
  member,
  note,
  serverInfo,
} from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

const withPreviews = (): AsRead.ServerInfo => serverInfo({ ...everything().features, draftPreviews: true })

const preview = (fields: Partial<AsRead.DraftPreview> = {}): AsRead.DraftPreview => ({
  noteId: 'note_preview00000' as NoteId,
  conversationId: ROOM,
  authorId: BEN,
  agentName: 'Ben desk',
  inReplyTo: null,
  state: 'unconfirmed',
  body: 'Early words',
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

const input = (fields: Partial<Parameters<typeof draftPreviewsModel>[0]> = {}) => ({
  ...threadInput({ serverInfo: withPreviews() }),
  previews: [],
  allowance: null,
  ...fields,
})

describe('draftPreviewsModel', () => {
  it('shows nothing while the organization has previews off', () => {
    expect(draftPreviewsModel(input({ serverInfo: everything(), previews: [preview()] }))).toEqual({
      cards: [],
      ownNotice: null,
    })
  })

  it('marks a colleague’s agent’s draft as unconfirmed, and a withdrawn one without its words', () => {
    const model = draftPreviewsModel(
      input({
        previews: [
          preview(),
          preview({ noteId: 'note_gone000000000' as NoteId, state: 'withdrawn', body: null }),
        ],
      }),
    )
    expect(model.cards).toEqual([
      {
        noteId: 'note_preview00000',
        withdrawn: false,
        title: strings.draftPreviews.cardTitle({ name: 'Ben' }),
        note: strings.draftPreviews.cardNote({ name: 'Ben' }),
        body: 'Early words',
      },
      {
        noteId: 'note_gone000000000',
        withdrawn: true,
        title: strings.draftPreviews.withdrawn({ name: 'Ben' }),
        note: strings.draftPreviews.withdrawnNote,
        body: null,
      },
    ])
  })

  it('reads a state this client does not know as withdrawn, showing no words', () => {
    const [card] = draftPreviewsModel(input({ previews: [preview({ state: 'unknown' })] })).cards
    expect(card).toMatchObject({ withdrawn: true, body: null })
  })

  it('tells the author who can see their agent’s waiting draft here, and nothing without one', () => {
    const allowance = { people: [BEN], channels: [] }
    const waiting = { notes: [draft('d1')], hasMore: false }
    expect(draftPreviewsModel(input({ allowance, thread: waiting })).ownNotice).toBe(
      strings.draftPreviews.ownNotice({ names: 'Ben' }),
    )
    expect(
      draftPreviewsModel(input({ allowance, thread: { notes: [note('n1')], hasMore: false } })).ownNotice,
    ).toBeNull()
    expect(
      draftPreviewsModel(
        input({
          allowance,
          thread: { notes: [draft('d1', { agentName: null, origin: 'human' })], hasMore: false },
        }),
      ).ownNotice,
    ).toBeNull()
    expect(
      draftPreviewsModel(input({ allowance: { people: [CY], channels: [] }, thread: waiting })).ownNotice,
    ).toBeNull()
    expect(draftPreviewsModel(input({ thread: waiting })).ownNotice).toBeNull()
    expect(draftPreviewsModel(input({ allowance, thread: waiting, conversations: [] })).ownNotice).toBeNull()
  })

  it('says everyone in an allowed channel’s room sees it, and nobody in a private question', () => {
    const room = conversation({ id: CHANNEL_ROOM, kind: 'channel', participantIds: [ANA, BEN, CY] })
    const fields = {
      conversationId: CHANNEL_ROOM,
      conversations: [room],
      channels: [channel('ops', { conversationId: CHANNEL_ROOM })],
      thread: { notes: [draft('d1', { conversationId: CHANNEL_ROOM })], hasMore: false },
      allowance: { people: [], channels: ['ops'] },
    }
    expect(draftPreviewsModel(input(fields)).ownNotice).toBe(strings.draftPreviews.ownNoticeRoom)
    expect(
      draftPreviewsModel(input({ ...fields, conversations: [{ ...room, privateQuestionOf: 'ops' }] }))
        .ownNotice,
    ).toBeNull()
  })
})

describe('confirmedPreviewLine', () => {
  const seen = (body: string) => ({
    me: threadInput().me,
    members: new Map([[BEN, member(BEN, 'Ben')]]),
    previewedBodies: new Map([['n1' as NoteId, body]]),
  })

  it('says a draft seen early was checked, and whether its author changed it first', () => {
    expect(confirmedPreviewLine(seen('body of n1'), note('n1'))).toBe(
      strings.draftPreviews.confirmed({ name: 'Ben' }),
    )
    expect(confirmedPreviewLine(seen('older words'), note('n1'))).toBe(
      strings.draftPreviews.confirmedEdited({ name: 'Ben' }),
    )
  })

  it('says nothing of a note never seen early, a draft, or the person’s own note', () => {
    expect(confirmedPreviewLine(seen('x'), note('n2'))).toBeNull()
    expect(confirmedPreviewLine(seen('x'), note('n1', { status: 'draft' }))).toBeNull()
    expect(confirmedPreviewLine(seen('x'), note('n1', { authorId: ANA }))).toBeNull()
  })
})
