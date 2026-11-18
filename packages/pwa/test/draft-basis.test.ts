import { ConversationId, MemberId, type Note, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { draftBasisOf } from '../src/draft-basis.ts'

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
    })
  })
})
