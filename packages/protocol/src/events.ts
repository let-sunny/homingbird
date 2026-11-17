/**
 * What the server pushes to a member's clients. The same events flow over SSE, WebSocket and
 * long-poll. Durable events carry a per-member sequence number used to resume a stream.
 */
import { Schema as S } from '@homingbird/kernel'
import { ConversationId, MemberId, NoteId } from './ids.ts'
import { Note, Receipt } from './model.ts'

export const EventBody = S.variants('type', {
  /** A note was approved and sent. Delivered to every participant. */
  'note.sent': { note: Note },
  /** A sent note's receipts changed. Delivered to every participant, with identical content. */
  'note.status': { noteId: NoteId, conversationId: ConversationId, receipts: S.array(Receipt) },
  /** One of the member's own drafts was created or edited. Delivered to the author only. */
  'draft.saved': { note: Note },
  /** One of the member's own drafts was discarded. Delivered to the author only. */
  'draft.discarded': { noteId: NoteId, conversationId: ConversationId },
  /** A contact request, acceptance, removal or block involving the member. */
  'contact.changed': { memberId: MemberId },
  /** Someone came online or went offline. Not durable. */
  presence: { memberId: MemberId, humanOnline: S.boolean, agentOnline: S.boolean },
  /** The client fell too far behind to resume; it must reload its state. Not durable. */
  resync: {},
})
export type EventBody = S.Infer<typeof EventBody>
export type EventType = EventBody['type']

export const StreamEvent = S.struct({
  /** Per-member sequence number; `0` for events that are not durable. */
  seq: S.int({ min: 0 }),
  at: S.int({ min: 0 }),
  body: EventBody,
})
export type StreamEvent = S.Infer<typeof StreamEvent>

export const isDurable = (type: EventType): boolean => type !== 'presence' && type !== 'resync'

/** Paths of the three transports, relative to the server origin. */
export const STREAM_PATHS = {
  sse: '/api/v1/events/stream',
  ws: '/api/v1/events/ws',
  poll: '/api/v1/events/poll',
} as const

/** Seconds between keep-alive frames on streaming transports. */
export const HEARTBEAT_SECONDS = 20
/** Longest a long-poll request is held open. */
export const POLL_WAIT_MAX_SECONDS = 25
