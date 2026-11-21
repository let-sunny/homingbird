import { ConversationId, MemberId, type Note, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { draftBasisOf, sourcesOf } from '../src/draft-basis.ts'
import { strings } from '../src/strings.ts'

const note = (basis?: string | null): Note => ({
  id: NoteId.of('note_1'),
  conversationId: ConversationId.of('conv_1'),
  authorId: MemberId.of('mem_1'),
  status: 'draft',
  body: 'Yes.',
  inReplyTo: null,
  origin: 'agent',
  agentName: 'Laptop',
  createdAt: 1,
  updatedAt: 1,
  sentAt: null,
  receipts: [],
  ...(basis !== undefined && { basis }),
})

describe('draftBasisOf', () => {
  it('shows nothing when the server did not share the basis with this viewer', () => {
    expect(draftBasisOf(note())).toBeNull()
  })

  it('says plainly that the agent gave no basis, so its absence is visible', () => {
    expect(draftBasisOf(note(null))).toEqual({ kind: 'none' })
    expect(draftBasisOf(note('  \n '))).toEqual({ kind: 'none' })
  })

  it('keeps each line, such as one per check, without blank ones', () => {
    expect(
      draftBasisOf(note('Read the runbook\n\n Checked for confidential material: passed, by reading ')),
    ).toEqual({
      kind: 'given',
      lines: ['Read the runbook', 'Checked for confidential material: passed, by reading'],
      sources: [],
    })
  })

  it('shows each source as a link, a jump to an earlier note, or words, leaving out one it cannot read', () => {
    const sources = [
      { url: 'https://wiki.example.com/refunds', quote: ' Five days. ' },
      { url: 'ftp://files.example.com/a' },
      { noteId: NoteId.of('note_2'), conversationId: ConversationId.of('conv_2'), quote: '  ' },
      { noteId: NoteId.of('note_3') },
      null,
    ]
    expect(draftBasisOf({ ...note(null), sources })).toEqual({
      kind: 'given',
      lines: [],
      sources: [
        {
          kind: 'link',
          label: 'https://wiki.example.com/refunds',
          href: 'https://wiki.example.com/refunds',
          quote: 'Five days.',
        },
        { kind: 'text', label: 'ftp://files.example.com/a', href: null, quote: null },
        { kind: 'note', label: strings.sourceNote, href: '#/c/conv_conv_2?note=note_note_2', quote: null },
        { kind: 'text', label: strings.sourceNoteUnknown, href: null, quote: null },
      ],
    })
  })

  it('keeps a basis of sources alone, and reads no sources as none', () => {
    expect(draftBasisOf({ ...note(''), sources: [] })).toEqual({ kind: 'none' })
    expect(sourcesOf({})).toEqual([])
  })
})
