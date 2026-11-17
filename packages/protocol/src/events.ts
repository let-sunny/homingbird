import { Schema as S } from '@homingbird/kernel'
import { ConversationId, MemberId, NoteId } from './ids.ts'
import { Note, Receipt } from './model.ts'

export const EventBody = S.variants('type', {
  'note.sent': { note: Note },
  'note.status': { noteId: NoteId, conversationId: ConversationId, receipts: S.array(Receipt) },
  'draft.saved': { note: Note },
  'draft.discarded': { noteId: NoteId, conversationId: ConversationId },
  'contact.changed': { memberId: MemberId },
  presence: { memberId: MemberId, humanOnline: S.boolean, agentOnline: S.boolean },
  resync: {},
})
export type EventBody = S.Infer<typeof EventBody>
export type EventType = EventBody['type']

export const StreamEvent = S.struct({
  seq: S.int({ min: 0 }),
  at: S.int({ min: 0 }),
  body: EventBody,
})
export type StreamEvent = S.Infer<typeof StreamEvent>

export const isDurable = (type: EventType): boolean => type !== 'presence' && type !== 'resync'

export const STREAM_PATHS = {
  sse: '/api/v1/events/stream',
  ws: '/api/v1/events/ws',
  poll: '/api/v1/events/poll',
} as const

export const HEARTBEAT_SECONDS = 20
export const POLL_WAIT_MAX_SECONDS = 25
