import { Schema as S } from '@homingbird/kernel'
import { ConversationId, MemberId, NoteId } from './ids.ts'
import { DraftRequest, Note, Receipt, Topic, TopicSlug } from './model.ts'

export const EventBody = S.variants('type', {
  'note.sent': { note: Note },
  'note.status': { noteId: NoteId, conversationId: ConversationId, receipts: S.array(Receipt) },
  'note.moved': { noteId: NoteId, fromConversationId: ConversationId, toConversationId: ConversationId },
  'draft.saved': { note: Note },
  'draft.discarded': { noteId: NoteId, conversationId: ConversationId },
  'draft.requested': { request: DraftRequest },
  'draft.request.changed': { request: DraftRequest },
  'contact.changed': { memberId: MemberId },
  presence: {
    members: S.array(S.struct({ memberId: MemberId, humanOnline: S.boolean, agentOnline: S.boolean })),
  },
  'directory.changed': { memberId: MemberId },
  'topic.changed': { topic: Topic },
  'topic.left': { slug: TopicSlug, conversationId: ConversationId },
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

const EPHEMERAL: ReadonlyArray<EventType> = ['presence', 'directory.changed', 'resync']

export const isDurable = (type: EventType): boolean => !EPHEMERAL.includes(type)

export const STREAM_PATHS = {
  sse: '/api/v1/events/stream',
  ws: '/api/v1/events/ws',
  poll: '/api/v1/events/poll',
} as const

export const HEARTBEAT_SECONDS = 20
export const POLL_WAIT_MAX_SECONDS = 25
