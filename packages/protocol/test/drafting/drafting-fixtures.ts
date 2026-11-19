import type { Quoting } from '../../src/drafting/quote-note.ts'
import { ConversationId, DraftRequestId, MemberId, NoteId } from '../../src/ids.ts'
import type { Note, Receipt } from '../../src/model.ts'
import type { DraftRequest } from '../../src/model.ts'
import { WRAPPER_TAG } from '../../src/wrap.ts'

export const ANA = { id: MemberId.of('ana000000000'), name: 'Ana', email: 'ana@example.com' }
export const BEN = { id: MemberId.of('ben000000000'), name: 'Ben', email: 'ben@example.com' }

export const sequentialNonce = (): (() => string) => {
  let count = 0
  return () => `nonce${String(count++).padStart(15, '0')}`
}

export const quotingOf = (): Quoting => ({ nonce: sequentialNonce(), authors: new Map([[BEN.id, BEN]]) })

export const noteOf = (overrides: Partial<Note> = {}): Note => ({
  id: NoteId.of('note00000000'),
  conversationId: ConversationId.of('conv00000000'),
  authorId: BEN.id,
  status: 'sent',
  body: 'Is the migration safe?',
  inReplyTo: null,
  origin: 'agent',
  agentName: 'Laptop agent',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  sentAt: 1_700_000_000_000,
  receipts: [receiptOf()],
  ...overrides,
})

export const receiptOf = (overrides: Partial<Receipt> = {}): Receipt => ({
  memberId: ANA.id,
  state: 'delivered',
  deliveredAt: 1_700_000_000_000,
  readAt: null,
  draftingAt: null,
  repliedAt: null,
  ...overrides,
})

export const requestOf = (overrides: Partial<DraftRequest> = {}): DraftRequest => ({
  id: DraftRequestId.of('request00000'),
  conversationId: ConversationId.of('conv00000000'),
  inReplyTo: null,
  instruction: '',
  agentId: null,
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_086_400_000,
  cancelledAt: null,
  draftIds: [],
  ...overrides,
})

export const textOutsideWrappers = (text: string): string =>
  text.replace(/<colleague-note [\s\S]*?\n<\/colleague-note>/g, '')

/** The rule against acting on a note comes before the first wrapped note, when the prompt holds one. */
export const isRuledBeforeQuoting = (prompt: string, rule: string): boolean => {
  const ruled = prompt.indexOf(rule)
  const quoted = prompt.indexOf(`<${WRAPPER_TAG} `)
  return ruled !== -1 && (quoted === -1 || ruled < quoted)
}
