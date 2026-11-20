import { Task as T } from '@homingbird/kernel'
import type { ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import { channelOfAgentRoom } from '../domain/channel-rows.ts'
import type { NoteRow } from '../domain/note-rows.ts'
import { reviewersOf } from '../domain/reviews.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/** A channel's agent's new draft as one of its reviewers is told, read again as the push goes out (rule 2). */
export const reviewWaitingFor = (
  memberId: MemberId,
  noteId: NoteId,
): T.Task<ReviewWaiting | null, never, AppEnv> =>
  T.gen(function* () {
    if (!(yield* featureIsOn('channelAgents'))) return null
    const draft = yield* first<NoteRow>(sql`
      SELECT n.* FROM notes n JOIN members a ON a.id = n.author_id AND a.kind = 'channel_agent'
      WHERE n.id = ${noteId} AND n.status = 'draft'`)
    if (draft === null || Number(draft.updated_at) !== Number(draft.created_at)) return null
    const channel = yield* channelOfAgentRoom(draft.conversation_id)
    if (channel === null || !(yield* reviewersOf(draft)).includes(memberId)) return null
    return {
      conversationId: draft.conversation_id,
      channelId: channel.conversation_id,
      slug: channel.slug,
      body: draft.body,
      url: reviewCardUrl(channel.slug, noteId),
    }
  })

export interface ReviewWaiting {
  readonly conversationId: ConversationId
  readonly channelId: ConversationId
  readonly slug: string
  readonly body: string
  readonly url: string
}

/** The web client's address of one review card on the channel's agent page. */
export const reviewCardUrl = (slug: string, noteId: NoteId): string =>
  `/#/channel/${encodeURIComponent(slug)}/agent?draft=${encodeURIComponent(noteId)}`
