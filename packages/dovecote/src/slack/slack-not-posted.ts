import { Task as T } from '@homingbird/kernel'
import type { MemberId, Note } from '@homingbird/protocol'
import { channelOfRoom, managersOf } from '../domain/channel-rows.ts'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/**
 * Whether a person is told that a reply was given up on: its sender or approver and the channel's
 * managers are, read again as they are told, and nobody when a manager removed the link.
 */
export const notPostedNoticeFor = (
  memberId: MemberId,
  note: Pick<Note, 'id' | 'conversationId' | 'authorId' | 'approvedBy'>,
): T.Task<NotPosted | null, never, AppEnv> =>
  T.gen(function* () {
    const post = yield* first<{
      slack_channel_name: string
    }>(sql`SELECT l.slack_channel_name FROM slack_outbox o
      JOIN slack_channel_links l ON l.slack_channel_id = o.slack_channel_id
      WHERE o.note_id = ${note.id} AND o.state = 'failed'`)
    if (post === null) return null
    const room = yield* channelOfRoom(note.conversationId)
    const managers = room === null ? [] : yield* managersOf(room)
    if (memberId !== (note.approvedBy ?? note.authorId) && !managers.includes(memberId)) return null
    return { channel: post.slack_channel_name, url: `/#/c/${encodeURIComponent(note.conversationId)}` }
  })

export interface NotPosted {
  readonly channel: string
  readonly url: string
}
