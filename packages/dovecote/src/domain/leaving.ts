import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  Forbidden,
  type MemberId,
  type NotFound,
  type NoteId,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { abandonDraftsIn } from './abandoned-drafts.ts'
import { participantsOf, participatedConversation } from './conversations.ts'
import { withdrawDraftRequestsIn } from './draft-requests.ts'
import { announceStatus } from './note-status.ts'

/** Rule 6: takes the person out of a group for good; nothing of theirs unapproved goes to the others. */
export const leaveGroup = (
  caller: Caller,
  conversationId: ConversationId,
): T.Task<void, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can leave a group.' }))
    const viewerId = caller.member.id
    const room = yield* participatedConversation(viewerId, conversationId)
    if (room.kind !== 'group' || (room.channel_id ?? null) !== null) return yield* T.fail(NOT_A_GROUP)
    yield* run(
      sql`DELETE FROM participants WHERE conversation_id = ${conversationId} AND member_id = ${viewerId}`,
    )
    yield* abandonDraftsIn(conversationId, viewerId)
    yield* withdrawDraftRequestsIn(viewerId, conversationId)
    yield* stopDraftingIn(conversationId, viewerId)
    const told = yield* stillShownTo(conversationId, yield* participantsOf(conversationId))
    yield* emit([viewerId, ...told], { type: 'conversation.left', conversationId, memberId: viewerId })
  })

const NOT_A_GROUP = Conflict({
  message: 'Only a group DN can be left. Hide a direct note instead; leave a channel from its menu.',
})

/** A note the leaver's agent had picked up stops showing as "drafting reply" to the others. */
const stopDraftingIn = (
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const picked = yield* all<{ note_id: NoteId }>(sql`
      SELECT r.note_id FROM receipts r JOIN notes n ON n.id = r.note_id
      WHERE n.conversation_id = ${conversationId} AND r.member_id = ${memberId} AND r.drafting_at IS NOT NULL
      ORDER BY r.note_id`)
    for (const { note_id: noteId } of picked) {
      yield* run(
        sql`UPDATE receipts SET drafting_at = NULL WHERE note_id = ${noteId} AND member_id = ${memberId}`,
      )
      yield* announceStatus(noteId)
    }
  })

/** Rule 2: a group nobody has sent a note in yet stays unknown to its other people, leaving included. */
const stillShownTo = (
  conversationId: ConversationId,
  memberIds: ReadonlyArray<MemberId>,
): T.Task<MemberId[], never, RequestEnv> =>
  T.gen(function* () {
    const shown: MemberId[] = []
    for (const memberId of memberIds)
      if ((yield* T.result(participatedConversation(memberId, conversationId)))._tag === 'Ok')
        shown.push(memberId)
    return shown
  })
