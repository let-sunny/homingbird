import { Task as T } from '@homingbird/kernel'
import { type MemberId, NoteId } from '@homingbird/protocol'
import { participantsOf } from '../domain/conversations.ts'
import { recipientsOf } from '../domain/delivery.ts'
import type { NoteRow } from '../domain/note-rows.ts'
import { announceStatus, noteById } from '../domain/note-status.ts'
import { keepNotice } from '../domain/notices.ts'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, emit, transact } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import type { SlackLinkRow } from './slack-channels.ts'
import { DELETED_IN_SLACK, mentionedUsers, plainFromSlack } from './slack-markup.ts'
import { calling, slackPersonBySlackUser } from './slack-people.ts'
import { slackTextsIn } from './slack-texts.ts'
import type { SlackUser } from './slack-web-api.ts'
import type { WorkingSlack } from './slack-workspace.ts'

/**
 * A mention of the app in a linked channel becomes a sent note of the link, a question in the channel's
 * room delivered as a member's question is. Nobody approved it in Homingbird: it is recorded as arriving
 * (`origin: 'outside'`, no approver), and a reaction tells the asker it arrived.
 */
export const receiveQuestion = (
  slack: WorkingSlack,
  link: SlackLinkRow,
  message: SlackMessageFacts,
  asker: SlackUser,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const limited = yield* limitReached(link, asker.id, env.clock.now())
    if (limited !== null) {
      const texts = slackTextsIn(null)
      const text = limited === 'asker' ? texts.askerLimited : texts.linkLimited
      yield* calling(
        'chat.postEphemeral',
        slack.api.postEphemeral({ channel: message.channel, user: asker.id, text }),
      )
      return
    }
    const names = new Map<string, string>()
    for (const user of mentionedUsers(message.text, slack.workspace.bot_user_id)) {
      const named = yield* calling('users.info', slack.api.userInfo(user))
      if (named !== undefined) names.set(user, named.name)
    }
    const body = plainFromSlack(message.text, names, slack.workspace.bot_user_id)
    if (body === '') return
    const linked = yield* slackPersonBySlackUser(asker.id)
    const sameEmail =
      linked !== null || asker.email === null
        ? null
        : yield* first<{ id: MemberId }>(sql`SELECT id FROM members WHERE email = ${asker.email.toLowerCase()}
            AND kind = 'person' AND status = 'active'`)
    const arrived = yield* transact(
      keepArrival(link, message, asker, body, linked?.member_id ?? sameEmail?.id ?? null, linked !== null),
    )
    if (arrived) yield* calling('reactions.add', slack.api.addReaction(message.channel, message.ts, 'eyes'))
  })

/** A message in a thread that holds a question moves it: a reply waiting to be sent is refused once. */
export const moveThread = (channel: string, threadTs: string, ts: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (
      (yield* first(sql`SELECT note_id FROM slack_arrivals WHERE slack_channel_id = ${channel}
      AND message_ts = ${ts}`)) !== null
    )
      return
    const thread = yield* threadOf(channel, threadTs)
    if (thread === null || Number(ts) <= Number(thread.newest_ts)) return
    yield* run(sql`UPDATE slack_threads SET newest_ts = ${ts}, newer_messages = newer_messages + 1
      WHERE slack_channel_id = ${channel} AND thread_ts = ${threadTs}`)
  })

/**
 * An arrived note is a copy of a Slack message, so it follows it: an edit replaces its text, a deletion
 * replaces it with "Deleted in Slack." and discards the drafts that answer it, telling their authors.
 * Answers already sent stay. Either moves the thread.
 */
export const followSlackMessage = (
  slack: WorkingSlack,
  change: {
    readonly channel: string
    readonly ts: string
    readonly at: string
    readonly text: string | null
  },
): T.Task<void, never, AppEnv> =>
  transact(
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      const arrival = yield* first<ArrivalRow>(sql`SELECT * FROM slack_arrivals
        WHERE slack_channel_id = ${change.channel} AND message_ts = ${change.ts}`)
      if (arrival === null) return
      const deleted = change.text === null
      const body = deleted
        ? DELETED_IN_SLACK
        : plainFromSlack(change.text ?? '', new Map(), slack.workspace.bot_user_id)
      yield* run(sql`UPDATE notes SET body = ${body || DELETED_IN_SLACK}, updated_at = ${env.clock.now()}
        WHERE id = ${arrival.note_id}`)
      yield* run(sql`UPDATE slack_arrivals SET edited = ${deleted ? arrival.edited : 1}, deleted = ${deleted ? 1 : 0}
        WHERE note_id = ${arrival.note_id}`)
      yield* run(sql`UPDATE slack_threads SET newest_ts = ${change.at}
        WHERE slack_channel_id = ${change.channel} AND thread_ts = ${arrival.thread_ts}`)
      if (deleted) yield* discardAnswersTo(arrival)
    }),
  )

export interface SlackMessageFacts {
  readonly channel: string
  readonly ts: string
  readonly threadTs: string | null
  readonly text: string
}

export interface ArrivalRow {
  readonly note_id: NoteId
  readonly conversation_id: string
  readonly slack_channel_id: string
  readonly message_ts: string
  readonly thread_ts: string
  readonly asker_name: string
  readonly asker_member_id: MemberId | null
  readonly asker_linked: number
  readonly edited: number
  readonly deleted: number
}

export const threadOf = (
  channel: string,
  threadTs: string,
): T.Task<{ readonly newest_ts: string; readonly newer_messages: number } | null, never, AppEnv> =>
  first(sql`SELECT newest_ts, newer_messages FROM slack_threads
    WHERE slack_channel_id = ${channel} AND thread_ts = ${threadTs}`)

const keepArrival = (
  link: SlackLinkRow,
  message: SlackMessageFacts,
  asker: SlackUser,
  body: string,
  askerMemberId: MemberId | null,
  askerLinked: boolean,
): T.Task<boolean, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (
      (yield* first(sql`SELECT note_id FROM slack_arrivals WHERE slack_channel_id = ${message.channel}
      AND message_ts = ${message.ts}`)) !== null
    )
      return false
    const threadTs = message.threadTs ?? message.ts
    const now = env.clock.now()
    const note = {
      id: NoteId.of(env.random.identifier()),
      conversation_id: link.conversation_id,
      author_id: link.link_member_id,
      status: 'sent',
      body,
      in_reply_to: message.threadTs === null ? null : yield* newestInThread(message.channel, threadTs),
      origin: 'outside',
      agent_name: null,
      credential_id: null,
      created_at: now,
      updated_at: now,
      sent_at: now,
      basis: null,
    } as const
    yield* run(insertInto('notes', note))
    const participants = yield* participantsOf(link.conversation_id)
    for (const memberId of yield* recipientsOf(note, participants))
      yield* run(insertInto('receipts', { note_id: note.id, member_id: memberId, delivered_at: now }))
    yield* run(sql`UPDATE conversations SET last_activity_at = ${now} WHERE id = ${link.conversation_id}`)
    yield* run(
      insertInto('slack_arrivals', {
        note_id: note.id,
        conversation_id: link.conversation_id,
        slack_channel_id: message.channel,
        message_ts: message.ts,
        thread_ts: threadTs,
        asker_slack_id: asker.id,
        asker_name: asker.name.slice(0, NAME_MAX),
        asker_member_id: askerMemberId,
        asker_linked: askerLinked ? 1 : 0,
        edited: 0,
        deleted: 0,
        created_at: now,
      }),
    )
    yield* run(
      sql`DELETE FROM slack_threads WHERE slack_channel_id = ${message.channel} AND thread_ts = ${threadTs}`,
    )
    yield* run(
      insertInto('slack_threads', {
        slack_channel_id: message.channel,
        thread_ts: threadTs,
        newest_ts: message.ts,
        newer_messages: 0,
      }),
    )
    yield* emit(participants, { type: 'note.sent', note: yield* noteById(note.id, null) })
    if (note.in_reply_to !== null) yield* announceStatus(note.in_reply_to)
    return true
  })

/** A follow-up in a thread replies to its newest sent note, as a member's follow-up would. */
const newestInThread = (channel: string, threadTs: string): T.Task<NoteId | null, never, AppEnv> =>
  T.gen(function* () {
    const question = yield* first<{ note_id: NoteId }>(sql`SELECT note_id FROM slack_arrivals
      WHERE slack_channel_id = ${channel} AND thread_ts = ${threadTs} ORDER BY created_at DESC LIMIT 1`)
    if (question === null) return null
    const answer = yield* first<{
      id: NoteId
    }>(sql`SELECT id FROM notes WHERE in_reply_to = ${question.note_id}
      AND status = 'sent' ORDER BY sent_at DESC LIMIT 1`)
    return answer?.id ?? question.note_id
  })

const discardAnswersTo = (arrival: ArrivalRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const drafts = yield* all<NoteRow>(sql`SELECT * FROM notes WHERE in_reply_to = ${arrival.note_id}
      AND status = 'draft' ORDER BY id`)
    for (const draft of drafts) {
      yield* run(sql`UPDATE notes SET status = 'discarded', updated_at = ${env.clock.now()}
        WHERE id = ${draft.id} AND status = 'draft'`)
      yield* keepNotice({
        memberId: draft.author_id,
        kind: 'slack_deleted',
        noteId: draft.id,
        conversationId: draft.conversation_id,
        reason: null,
        agentName: draft.agent_name,
        channel: null,
      })
      yield* emit([draft.author_id], {
        type: 'draft.discarded',
        noteId: draft.id,
        conversationId: draft.conversation_id,
        because: 'slack_deleted',
      })
    }
    yield* announceStatus(arrival.note_id)
  })

const limitReached = (
  link: SlackLinkRow,
  asker: string,
  now: number,
): T.Task<'asker' | 'link' | null, never, AppEnv> =>
  T.gen(function* () {
    const byAsker = yield* first<{ total: number }>(sql`SELECT COUNT(*) AS total FROM slack_arrivals
      WHERE slack_channel_id = ${link.slack_channel_id} AND asker_slack_id = ${asker} AND created_at > ${now - HOUR_MS}`)
    if (Number(byAsker?.total ?? 0) >= ASKER_PER_HOUR) return 'asker'
    const byLink = yield* first<{ total: number }>(sql`SELECT COUNT(*) AS total FROM slack_arrivals
      WHERE slack_channel_id = ${link.slack_channel_id} AND created_at > ${now - DAY_MS}`)
    return Number(byLink?.total ?? 0) >= LINK_PER_DAY ? 'link' : null
  })

const ASKER_PER_HOUR = 10
const LINK_PER_DAY = 200
const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
const NAME_MAX = 200
