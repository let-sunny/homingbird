import { Task as T } from '@homingbird/kernel'
import { survivingPass } from '../background-pass.ts'
import type { AppEnv } from '../environment.ts'
import { transact } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { followSlackMessage, moveThread, receiveQuestion } from './slack-arrivals.ts'
import {
  type SlackLinkRow,
  type SlackLinkStop,
  linkOfSlackChannel,
  offerChannelLink,
  stopSlackLink,
} from './slack-channels.ts'
import type { KeptEvent } from './slack-events.ts'
import {
  calling,
  forgetSlackPerson,
  isEligible,
  offerSlackLink,
  slackPersonBySlackUser,
  tellOnly,
} from './slack-people.ts'
import { slackTextsIn } from './slack-texts.ts'
import type { SlackUser } from './slack-web-api.ts'
import { type WorkingSlack, stopSlack, workingSlack } from './slack-workspace.ts'

/** A handled event's id is kept a day, past Slack's last retry, so that a retry does nothing. */
export const slackIntakePass: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  yield* run(
    sql`DELETE FROM slack_events WHERE processed_at IS NOT NULL AND processed_at < ${env.clock.now() - DAY_MS}`,
  )
  const slack = yield* workingSlack
  if (slack === null) return
  const waiting = yield* all<EventRow>(sql`SELECT event_id, payload FROM slack_events
    WHERE processed_at IS NULL ORDER BY received_at, event_id LIMIT ${EVENTS_PER_PASS}`)
  for (const row of waiting) {
    yield* survivingPass('slack event', handle(slack, JSON.parse(row.payload ?? '{}') as KeptEvent))
    yield* run(sql`UPDATE slack_events SET processed_at = ${env.clock.now()}, payload = NULL
      WHERE event_id = ${row.event_id}`)
  }
})

const handle = (slack: WorkingSlack, event: KeptEvent): T.Task<void, never, AppEnv> => {
  if (event.type === 'app_mention') return mentioned(slack, event)
  if (event.type === 'app_uninstalled') return transact(stopSlack('revoked'))
  if (event.type === 'tokens_revoked')
    return (event.tokens?.bot ?? []).length > 0 ? transact(stopSlack('revoked')) : T.unit
  if (event.type === 'user_change' && event.subject !== undefined) return userChanged(event.subject)
  if (event.channel === undefined || event.ts === undefined) return linkEvent(event)
  if (event.type === 'thread_moved' && event.thread_ts !== undefined)
    return moveThread(event.channel, event.thread_ts, event.ts)
  if (event.type === 'message_changed' || event.type === 'message_deleted')
    return followSlackMessage(slack, {
      channel: event.channel,
      ts: event.ts,
      at: event.at ?? event.ts,
      text: event.type === 'message_deleted' ? null : (event.text ?? ''),
    })
  return T.unit
}

/** The app left the channel, or the channel was archived or deleted: the link stops. */
const linkEvent = (event: KeptEvent): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const because = LINK_STOPS[event.type]
    if (because === undefined || event.channel === undefined) return
    const link = yield* linkOfSlackChannel(event.channel)
    if (link !== null) yield* transact(stopSlackLink(link, because))
  })

const mentioned = (slack: WorkingSlack, event: KeptEvent): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (event.user === undefined || event.channel === undefined) return
    if (event.bot_id !== undefined || event.user === slack.workspace.bot_user_id) return
    const place = {
      channel: event.channel,
      ...(event.thread_ts !== undefined && { threadTs: event.thread_ts }),
    }
    const link = yield* linkOfSlackChannel(event.channel)
    const wantsLink = LINK_WORD.test(withoutMentions(event.text ?? '').trim())
    if (!wantsLink && link?.state === 'stopped') return
    const user = yield* calling('users.info', slack.api.userInfo(event.user))
    if (user === undefined) return
    if (!isEligible(slack, user)) return yield* tellOnly(slack, user, place, 'membersOnly')
    if (!wantsLink && link === null) return yield* tellOnly(slack, user, place, 'notLinkedHere')
    if (!wantsLink && link !== null)
      return yield* receiveQuestion(
        slack,
        link,
        {
          channel: event.channel,
          ts: event.ts ?? '',
          threadTs: event.thread_ts ?? null,
          text: event.text ?? '',
        },
        user,
      )
    if (link !== null) return yield* tellLinked(slack, user, place, link)
    const person = yield* slackPersonBySlackUser(user.id)
    if (person !== null) return yield* offerChannelLink(slack, user, person.member_id, place)
    yield* offerSlackLink(slack, user, place)
  })

const userChanged = (subject: NonNullable<KeptEvent['subject']>): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const linked = yield* slackPersonBySlackUser(subject.id)
    if (linked === null) return
    if (subject.deleted)
      return yield* transact(forgetSlackPerson(linked.member_id, 'slack_deactivated', null))
    yield* run(sql`UPDATE slack_people SET slack_name = ${subject.name.slice(0, 200)}
      WHERE member_id = ${linked.member_id}`)
  })

const tellLinked = (
  slack: WorkingSlack,
  user: SlackUser,
  place: { readonly channel: string; readonly threadTs?: string },
  link: SlackLinkRow,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const channel = yield* first<{ slug: string }>(
      sql`SELECT slug FROM channels WHERE conversation_id = ${link.conversation_id}`,
    )
    const text = slackTextsIn(null).channelLinked(`#${channel?.slug ?? ''}`)
    yield* calling('chat.postEphemeral', slack.api.postEphemeral({ ...place, user: user.id, text }))
  })

const withoutMentions = (text: string): string => text.replace(/<@[A-Z0-9]+>/g, ' ')

const LINK_WORD = /^link[.!?]?$/i

const LINK_STOPS: Readonly<Record<string, SlackLinkStop>> = {
  member_left_channel: 'app_removed',
  channel_archive: 'archived',
  channel_deleted: 'deleted',
}
const EVENTS_PER_PASS = 50
const DAY_MS = 24 * 60 * 60_000

interface EventRow {
  readonly event_id: string
  readonly payload: string | null
}
