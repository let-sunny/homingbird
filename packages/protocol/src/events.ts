import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { ConversationId, DebateId, GroupId, MemberId, NoteId, Timestamp } from './ids.ts'
import { Channel, ChannelSlug, DraftRequest, Note, RELEASE_REASON_MAX, Receipt } from './model.ts'

/** What a client reads in place of an event of a kind that a newer server added; a client skips it. */
export const UNKNOWN_EVENT = { type: UNKNOWN } as const

export const EventBody = S.openVariants(
  'type',
  {
    'note.sent': { note: Note },
    'note.status': { noteId: NoteId, conversationId: ConversationId, receipts: S.array(Receipt) },
    'draft.saved': { note: Note },
    'draft.discarded': {
      noteId: NoteId,
      conversationId: ConversationId,
      because: S.optional(S.tolerant(S.literal('channel_archived'), UNKNOWN)),
      channel: S.optional(ChannelSlug),
    },
    'note.withdrawn': { noteId: NoteId, conversationId: ConversationId },
    'note.released': {
      noteId: NoteId,
      conversationId: ConversationId,
      reason: S.nullable(S.string({ maxLength: RELEASE_REASON_MAX })),
      agentName: S.nullable(S.string({ maxLength: 200 })),
    },
    'draft.requested': { request: DraftRequest },
    'draft.request.changed': { request: DraftRequest },
    'contact.changed': { memberId: MemberId },
    presence: {
      members: S.array(
        S.struct({
          memberId: MemberId,
          humanOnline: S.boolean,
          agentOnline: S.boolean,
          agentUnavailable: S.optional(S.struct({ until: S.nullable(Timestamp) })),
        }),
      ),
    },
    'directory.changed': { memberId: MemberId },
    'channel.changed': { channel: Channel },
    'channel.left': { slug: ChannelSlug, conversationId: ConversationId },
    'debate.changed': { debateId: DebateId, participantIds: S.array(MemberId, { maxItems: 8 }) },
    'group.changed': { groupId: GroupId },
    'review.changed': { noteId: S.nullable(NoteId) },
    /** An allowed viewer's previews in a conversation changed, or with none, everywhere: read them again. */
    'preview.changed': { conversationId: S.nullable(ConversationId) },
    resync: {},
  },
  UNKNOWN_EVENT,
)
export type EventBody = S.Infer<typeof EventBody>
export type EventType = EventBody['type']

export const StreamEvent = S.struct({
  seq: S.int({ min: 0 }),
  at: S.int({ min: 0 }),
  body: EventBody,
})
export type StreamEvent = S.Infer<typeof StreamEvent>

/** A room's, a group's or a review's change carries no content and is not stored: a client reads it through the API. */
const EPHEMERAL: ReadonlyArray<EventType> = [
  'presence',
  'directory.changed',
  'debate.changed',
  'group.changed',
  'review.changed',
  'preview.changed',
  'resync',
]

export const isDurable = (type: EventType): boolean => !EPHEMERAL.includes(type)

/** Told to a person's own signed-in pages only, never to a stream an agent credential holds. */
export const isForPeopleOnly = (type: string): boolean => type === 'preview.changed'

export const STREAM_PATHS = {
  sse: '/api/v1/events/stream',
  ws: '/api/v1/events/ws',
  poll: '/api/v1/events/poll',
} as const

export const HEARTBEAT_SECONDS = 20
export const POLL_WAIT_MAX_SECONDS = 25
