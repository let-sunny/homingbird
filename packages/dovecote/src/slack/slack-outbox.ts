import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type DraftAsShown,
  type MemberId,
  type NotFound,
  type Note,
  type NoteId,
  SLACK_THREAD_MOVED,
} from '@homingbird/protocol'
import { survivingPass } from '../background-pass.ts'
import { membersByIds } from '../domain/members.ts'
import type { NoteRow } from '../domain/note-rows.ts'
import { noteById } from '../domain/note-status.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { type ArrivalRow, threadOf } from './slack-arrivals.ts'
import { type SlackLinkRow, stopSlackLink } from './slack-channels.ts'
import { slackPostOf } from './slack-markup.ts'
import {
  type SlackCallFailure,
  type SlackPosted,
  type SlackThreadMessage,
  isTokenRefusal,
} from './slack-web-api.ts'
import { type WorkingSlack, slackCallFailed, workingSlack } from './slack-workspace.ts'

/**
 * Whether a send must be posted to Slack: when, and only when, the link is among its recipients, which
 * means it replies to a question that arrived from Slack. Such a send is refused while the link does not
 * work, and once when the Slack thread moved since the person read the card.
 */
export const slackPostingOf = (
  draft: Pick<NoteRow, 'in_reply_to'>,
  recipients: ReadonlyArray<MemberId>,
  expected: DraftAsShown | null,
): T.Task<SlackPosting | null, Conflict, AppEnv> =>
  T.gen(function* () {
    if (draft.in_reply_to === null) return null
    const arrival = yield* first<ArrivalRow>(
      sql`SELECT * FROM slack_arrivals WHERE note_id = ${draft.in_reply_to}`,
    )
    if (arrival === null) return null
    const link = yield* first<SlackLinkRow>(sql`SELECT * FROM slack_channel_links
      WHERE slack_channel_id = ${arrival.slack_channel_id} AND link_member_id IN ${list([...recipients, ''])}`)
    if (link === null) return null
    if (link.state !== 'active' || (yield* workingSlack) === null)
      return yield* T.fail(
        Conflict({ message: 'This reply would go to Slack, which is stopped for this channel. Discard it.' }),
      )
    const thread = yield* threadOf(arrival.slack_channel_id, arrival.thread_ts)
    if (expected !== null && thread !== null && expected.threadAt !== thread.newest_ts)
      return yield* T.fail(Conflict({ message: SLACK_THREAD_MOVED }))
    return { link, arrival }
  })

/** One outbox row per sent note, in the transaction of the send; a pass posts it. */
export const queueSlackPost = (
  noteId: NoteId,
  posting: SlackPosting,
  authors: { readonly authorId: MemberId; readonly approvedBy: MemberId | null },
  body: string,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const named = yield* membersByIds([
      authors.authorId,
      ...(authors.approvedBy === null ? [] : [authors.approvedBy]),
    ])
    const author = named.get(authors.authorId)
    const approver = authors.approvedBy === null ? undefined : named.get(authors.approvedBy)
    const provenance =
      approver === undefined || authors.approvedBy === authors.authorId
        ? (author?.name ?? 'Homingbird')
        : `${author?.name ?? 'Homingbird'}, approved by ${approver.name}`
    yield* run(
      insertInto('slack_outbox', {
        note_id: noteId,
        slack_channel_id: posting.link.slack_channel_id,
        thread_ts: posting.arrival.thread_ts,
        text: slackPostOf(provenance, body),
        state: 'pending',
        attempts: 0,
        uncertain: 0,
        next_at: env.clock.now(),
        posted_ts: null,
        created_at: env.clock.now(),
      }),
    )
  })

/**
 * Posts what waits, one note at a time per thread in send order. Slack has no idempotency key, so a post
 * that timed out is unknown: before trying again the pass reads the thread for the app's own message
 * with that text, and posts only if it is not there.
 */
export const slackOutboxPass: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const slack = yield* workingSlack
  if (slack === null) return
  const due = yield* all<OutboxRow>(sql`SELECT * FROM slack_outbox o WHERE o.state = 'pending'
    AND o.next_at <= ${env.clock.now()} AND NOT EXISTS (SELECT 1 FROM slack_outbox e WHERE e.state = 'pending'
    AND e.slack_channel_id = o.slack_channel_id AND e.thread_ts = o.thread_ts AND e.created_at < o.created_at)
    ORDER BY o.created_at, o.note_id LIMIT ${POSTS_PER_PASS}`)
  for (const row of due) yield* survivingPass('slack post', post(slack, row))
})

/** Tries a note that was not posted again, for anyone who may read it. */
export const retrySlackPost = (
  caller: Caller,
  noteId: NoteId,
): T.Task<Note, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const note = yield* noteById(noteId, caller.member.id)
    const retried =
      yield* run(sql`UPDATE slack_outbox SET state = 'pending', attempts = 0, next_at = ${env.clock.now()}
      WHERE note_id = ${note.id} AND state = 'failed'`)
    if (retried === 0)
      return yield* T.fail(Conflict({ message: 'This note is not waiting to be tried again.' }))
    return yield* noteById(noteId, caller.member.id)
  })

export interface SlackPosting {
  readonly link: SlackLinkRow
  readonly arrival: ArrivalRow
}

interface OutboxRow {
  readonly note_id: NoteId
  readonly slack_channel_id: string
  readonly thread_ts: string
  readonly text: string
  readonly attempts: number
  readonly uncertain: number
}

const post = (slack: WorkingSlack, row: OutboxRow): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (row.uncertain === 1) {
      const thread = yield* T.catchAll(() => T.succeed<ReadonlyArray<SlackThreadMessage>>([]))(
        slack.api.threadReplies(row.slack_channel_id, row.thread_ts),
      )
      const already = thread.find(
        (message) => message.botId === slack.workspace.bot_id && message.text === row.text,
      )
      if (already !== undefined) return yield* transact(markPosted(row, already.ts))
    }
    yield* T.catchAll((failure: SlackCallFailure) => failed(row, failure))(
      T.flatMap((posted: SlackPosted) => transact(markPosted(row, posted.ts)))(
        slack.api.postMessage({ channel: row.slack_channel_id, text: row.text, threadTs: row.thread_ts }),
      ),
    )
  })

const markPosted = (row: OutboxRow, ts: string): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(
      sql`UPDATE slack_outbox SET state = 'posted', posted_ts = ${ts}, uncertain = 0 WHERE note_id = ${row.note_id}`,
    )
    yield* run(
      sql`UPDATE slack_channel_links SET failures = 0 WHERE slack_channel_id = ${row.slack_channel_id}`,
    )
  })

const failed = (row: OutboxRow, failure: SlackCallFailure): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    yield* slackCallFailed('chat.postMessage', failure)
    if (isTokenRefusal(failure)) return
    if (failure._tag === 'SlackRateLimited')
      return yield* T.asUnit(
        run(sql`UPDATE slack_outbox SET next_at = ${now + failure.retryAfterSeconds * 1000}
        WHERE note_id = ${row.note_id}`),
      )
    if (failure._tag === 'SlackRefused' && LINK_GONE[failure.error] !== undefined)
      return yield* transact(stopLinkOf(row, LINK_GONE[failure.error]!))
    const attempts = row.attempts + 1
    const uncertain = failure._tag === 'SlackUnreachable' ? 1 : row.uncertain
    if (attempts <= BACKOFF_MS.length)
      return yield* T.asUnit(
        run(sql`UPDATE slack_outbox SET attempts = ${attempts}, uncertain = ${uncertain},
        next_at = ${now + BACKOFF_MS[attempts - 1]!} WHERE note_id = ${row.note_id}`),
      )
    yield* transact(givenUp(row, uncertain))
  })

/** After the last wait, the note shows as not posted with Try again; five such notes in a row stop the link. */
const givenUp = (row: OutboxRow, uncertain: number): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE slack_outbox SET state = 'failed', attempts = 0, uncertain = ${uncertain}
      WHERE note_id = ${row.note_id}`)
    yield* run(
      sql`UPDATE slack_channel_links SET failures = failures + 1 WHERE slack_channel_id = ${row.slack_channel_id}`,
    )
    const link = yield* first<SlackLinkRow>(
      sql`SELECT * FROM slack_channel_links WHERE slack_channel_id = ${row.slack_channel_id}`,
    )
    if (link !== null && link.failures >= FAILURES_TO_STOP) yield* stopSlackLink(link, 'failures')
  })

const stopLinkOf = (row: OutboxRow, because: 'app_removed' | 'archived'): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const link = yield* first<SlackLinkRow>(
      sql`SELECT * FROM slack_channel_links WHERE slack_channel_id = ${row.slack_channel_id}`,
    )
    if (link !== null) yield* stopSlackLink(link, because)
    else yield* run(sql`UPDATE slack_outbox SET state = 'failed' WHERE note_id = ${row.note_id}`)
  })

const LINK_GONE: Readonly<Record<string, 'app_removed' | 'archived'>> = {
  not_in_channel: 'app_removed',
  channel_not_found: 'app_removed',
  is_archived: 'archived',
}

const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000]
const FAILURES_TO_STOP = 5
const POSTS_PER_PASS = 20
