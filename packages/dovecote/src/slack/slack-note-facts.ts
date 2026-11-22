import { Task as T } from '@homingbird/kernel'
import type { MemberId, Note, NoteId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'

/**
 * The asker's Slack id and the message's address are never on a note, so an agent that reads one learns
 * nothing it could use to read more of Slack.
 */
export const slackFactsOf = (
  rows: ReadonlyArray<{ readonly id: NoteId; readonly origin: string; readonly status: string }>,
): T.Task<SlackFacts, never, AppEnv> =>
  T.gen(function* () {
    const arrived = rows.filter((row) => row.origin === 'outside').map((row) => row.id)
    const sent = rows.filter((row) => row.status === 'sent' && row.origin !== 'outside').map((row) => row.id)
    const via =
      arrived.length === 0
        ? []
        : yield* all<ArrivalFacts>(sql`
            SELECT a.note_id, a.asker_name, a.asker_member_id, a.asker_linked, a.edited, a.deleted,
              l.slack_channel_name, t.newest_ts, t.newer_messages,
              (SELECT MAX(o.created_at) FROM slack_arrivals o WHERE o.slack_channel_id = a.slack_channel_id
                AND o.thread_ts = a.thread_ts) AS newest_arrival_at, a.created_at
            FROM slack_arrivals a
            LEFT JOIN slack_channel_links l ON l.slack_channel_id = a.slack_channel_id
            LEFT JOIN slack_threads t ON t.slack_channel_id = a.slack_channel_id AND t.thread_ts = a.thread_ts
            WHERE a.note_id IN ${list(arrived)}`)
    const posting =
      sent.length === 0
        ? []
        : yield* all<OutboxFacts>(
            sql`SELECT note_id, state, next_at FROM slack_outbox WHERE note_id IN ${list(sent)}`,
          )
    const now = (yield* T.ask<AppEnv>()).clock.now()
    return {
      via: new Map(via.map((row) => [row.note_id, viaOf(row)])),
      posting: new Map(posting.map((row) => [row.note_id, postingOf(row, now)])),
    }
  })

export interface SlackFacts {
  readonly via: ReadonlyMap<NoteId, NonNullable<Note['via']>>
  readonly posting: ReadonlyMap<NoteId, Pick<Note, 'posting' | 'postingRetryAt'>>
}

interface OutboxFacts {
  readonly note_id: NoteId
  readonly state: 'pending' | 'posted' | 'failed'
  readonly next_at: number
}

interface ArrivalFacts {
  readonly note_id: NoteId
  readonly asker_name: string
  readonly asker_member_id: MemberId | null
  readonly asker_linked: number
  readonly edited: number
  readonly deleted: number
  readonly slack_channel_name: string | null
  readonly newest_ts: string | null
  readonly newer_messages: number | null
  readonly newest_arrival_at: number | null
  readonly created_at: number
}

/** Only the thread's newest question counts the messages after it; an older one in the thread counts none. */
const viaOf = (row: ArrivalFacts): NonNullable<Note['via']> => ({
  tool: 'slack',
  askerName: row.asker_name,
  askerId: Number(row.asker_linked) === 1 ? row.asker_member_id : null,
  channelName: row.slack_channel_name ?? 'unlinked channel',
  edited: Number(row.edited) === 1,
  deleted: Number(row.deleted) === 1,
  threadAt: row.newest_ts ?? '',
  newerMessages:
    Number(row.newest_arrival_at) === Number(row.created_at) ? Number(row.newer_messages ?? 0) : 0,
})

const postingOf = (row: OutboxFacts, now: number): Pick<Note, 'posting' | 'postingRetryAt'> =>
  row.state === 'pending' && Number(row.next_at) > now
    ? { posting: 'retrying', postingRetryAt: Number(row.next_at) }
    : { posting: row.state }
