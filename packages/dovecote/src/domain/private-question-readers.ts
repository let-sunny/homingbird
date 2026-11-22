import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type EventBody,
  NotFound,
  type NoteId,
  type StreamEvent,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman } from '../environment.ts'
import { all, first } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'

/** A person signed in, or a channel's own agent; never a person's agent credential, the asker's included (rule 6). */
export const readsPrivateQuestions = (caller: Caller): boolean =>
  isHuman(caller) || caller.member.kind === 'channel_agent'

export const inReadableRooms = <A>(
  caller: Caller,
  items: ReadonlyArray<A>,
  roomOf: (item: A) => ConversationId | null,
): T.Task<A[], never, AppEnv> =>
  T.gen(function* () {
    if (readsPrivateQuestions(caller)) return [...items]
    const rooms = items.flatMap((item) => roomOf(item) ?? [])
    const hidden = yield* privateQuestionsAmong(rooms)
    return items.filter((item) => {
      const room = roomOf(item)
      return room === null || !hidden.has(room)
    })
  })

export const requireReadableRoom = (
  caller: Caller,
  conversationId: ConversationId,
): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    if ((yield* inReadableRooms(caller, [conversationId], (room) => room)).length === 0)
      return yield* T.fail(NotFound({ message: 'No such conversation.' }))
  })

export const requireReadableTarget = (
  caller: Caller,
  target: { readonly conversationId?: ConversationId; readonly inReplyTo?: NoteId },
): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    if (readsPrivateQuestions(caller)) return
    if (target.conversationId !== undefined) yield* requireReadableRoom(caller, target.conversationId)
    if (target.inReplyTo === undefined) return
    const answered = yield* first<{ conversation_id: ConversationId }>(
      sql`SELECT conversation_id FROM notes WHERE id = ${target.inReplyTo}`,
    )
    if (answered !== null) yield* requireReadableRoom(caller, answered.conversation_id)
  })

export const readableEvents = (
  caller: Caller,
  events: ReadonlyArray<StreamEvent>,
): T.Task<StreamEvent[], never, AppEnv> => inReadableRooms(caller, events, (event) => roomOfEvent(event.body))

const privateQuestionsAmong = (
  rooms: ReadonlyArray<ConversationId>,
): T.Task<ReadonlySet<ConversationId>, never, AppEnv> =>
  rooms.length === 0
    ? T.succeed(new Set())
    : T.map((rows: ReadonlyArray<{ id: ConversationId }>) => new Set(rows.map((row) => row.id)))(
        all<{ id: ConversationId }>(
          sql`SELECT id FROM conversations WHERE channel_id IS NOT NULL AND id IN ${list([...new Set(rooms)])}`,
        ),
      )

const roomOfEvent = (body: EventBody): ConversationId | null => {
  if (body.type === 'note.sent' || body.type === 'draft.saved') return body.note.conversationId
  if (body.type === 'draft.requested' || body.type === 'draft.request.changed')
    return body.request.conversationId
  if ('conversationId' in body && typeof body.conversationId === 'string') return body.conversationId
  return null
}
