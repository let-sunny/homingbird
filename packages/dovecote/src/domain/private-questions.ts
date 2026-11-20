import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type Conversation,
  ConversationId,
  type MemberId,
  type NotFound,
} from '@homingbird/protocol'
import { type Caller, viewerOf } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import { abandonDraftsIn } from './abandoned-drafts.ts'
import {
  type ChannelRow,
  channelAgentOf,
  isMemberOf,
  managersOf,
  noSuchChannel,
  visibilityOf,
} from './channel-rows.ts'
import { conversationFor, participantsOf } from './conversations.ts'
import { lockedChannel } from './group-rows.ts'
import { announceReview } from './review-events.ts'

/** The asker's own conversation with a channel's agent and its managers, now and later; one per asker. */
export const askPrivately = (
  caller: Caller,
  slug: string,
): T.Task<Conversation, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const askerId = caller.member.id
    const row = yield* lockedChannel(viewerOf(caller), slug)
    if (visibilityOf(row) === 'private' && !(yield* isMemberOf(row.conversation_id, askerId)))
      return yield* T.fail(noSuchChannel(slug))
    if ((yield* channelAgentOf(row)) === null)
      return yield* T.fail(Conflict({ message: 'This channel has no agent to ask.' }))
    const existing = yield* first<{ id: ConversationId }>(sql`
      SELECT id FROM conversations WHERE channel_id = ${row.conversation_id} AND asked_by = ${askerId}
      AND archived_at IS NULL ORDER BY id LIMIT 1`)
    if (existing !== null) return yield* T.orDie(conversationFor(askerId, existing.id, true))
    const now = env.clock.now()
    const id = ConversationId.of(env.random.identifier())
    yield* run(
      insertInto('conversations', {
        id,
        kind: 'group',
        title: null,
        created_at: now,
        last_activity_at: now,
        pair_key: null,
        channel_id: row.conversation_id,
        asked_by: askerId,
      }),
    )
    yield* syncPrivateQuestionRooms(row)
    return yield* T.orDie(conversationFor(askerId, id, true))
  })

/** Each open private question holds exactly its asker, the channel's agent and its current managers. */
export const syncPrivateQuestionRooms = (row: ChannelRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const rooms = yield* all<{ id: ConversationId; asked_by: MemberId }>(sql`
      SELECT id, asked_by FROM conversations WHERE channel_id = ${row.conversation_id} AND archived_at IS NULL
      ORDER BY id`)
    if (rooms.length === 0) return
    const agent = yield* channelAgentOf(row)
    const managers = yield* managersOf(row)
    const target = yield* dialect
    for (const room of rooms) {
      const wanted = new Set([room.asked_by, ...(agent === null ? [] : [agent.id]), ...managers])
      const present = yield* participantsOf(room.id)
      for (const memberId of present.filter((id) => !wanted.has(id))) {
        yield* run(
          sql`DELETE FROM participants WHERE conversation_id = ${room.id} AND member_id = ${memberId}`,
        )
        yield* abandonDraftsIn(room.id, memberId)
        yield* emit([memberId], { type: 'resync' })
      }
      for (const memberId of [...wanted].filter((id) => !present.includes(id)))
        yield* run(
          insertIgnoringConflict(target, 'participants', { conversation_id: room.id, member_id: memberId }),
        )
    }
  })

/** Whom a note in a private question goes to: the asker's to the agent, everyone else's to the asker. */
export const privateQuestionRecipients = (
  conversationId: ConversationId,
  authorId: MemberId,
): T.Task<MemberId[] | null, never, RequestEnv> =>
  T.gen(function* () {
    const room = yield* first<{ channel_id: ConversationId | null; asked_by: MemberId | null }>(
      sql`SELECT channel_id, asked_by FROM conversations WHERE id = ${conversationId}`,
    )
    if (room === null || room.channel_id === null || room.asked_by === null) return null
    if (authorId !== room.asked_by) return [room.asked_by]
    const agent = yield* channelAgentOf({ conversation_id: room.channel_id })
    if (agent !== null) return [agent.id]
    return (yield* participantsOf(conversationId)).filter((id) => id !== authorId)
  })

/** Someone who leaves a channel, or is taken out of it, leaves their private questions there closed. */
export const closeQuestionsOf = (row: ChannelRow, askerId: MemberId): T.Task<void, never, RequestEnv> =>
  closeRooms(
    row,
    sql`SELECT id FROM conversations WHERE channel_id = ${row.conversation_id} AND asked_by = ${askerId} AND archived_at IS NULL ORDER BY id`,
    null,
  )

/** Archiving a channel closes its private questions: they stay readable to the asker and the managers. */
export const closePrivateQuestions = (row: ChannelRow, slug: string): T.Task<void, never, RequestEnv> =>
  closeRooms(
    row,
    sql`SELECT id FROM conversations WHERE channel_id = ${row.conversation_id} AND archived_at IS NULL ORDER BY id`,
    slug,
  )

const closeRooms = (
  row: ChannelRow,
  rooms: ReturnType<typeof sql>,
  archivedChannel: string | null,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const closing = yield* all<{ id: ConversationId }>(rooms)
    if (closing.length > 0) yield* announceReview(yield* managersOf(row), null)
    for (const room of closing) {
      const drafts = yield* all<{ author_id: MemberId }>(
        sql`SELECT DISTINCT author_id FROM notes WHERE conversation_id = ${room.id} AND status = 'draft' ORDER BY author_id`,
      )
      for (const draft of drafts) yield* abandonDraftsIn(room.id, draft.author_id, archivedChannel)
      yield* run(sql`UPDATE conversations SET archived_at = ${env.clock.now()} WHERE id = ${room.id}`)
    }
  })
