import { Task as T } from '@homingbird/kernel'
import { survivingPass } from '../background-pass.ts'
import type { AppEnv } from '../environment.ts'
import { transact } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import type { KeptEvent } from './slack-events.ts'
import { calling, forgetSlackPerson, offerSlackLink, slackPersonBySlackUser } from './slack-people.ts'
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
  return T.unit
}

const mentioned = (slack: WorkingSlack, event: KeptEvent): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (event.user === undefined || event.channel === undefined) return
    if (event.bot_id !== undefined || event.user === slack.workspace.bot_user_id) return
    if (!LINK_WORD.test(withoutMentions(event.text ?? ''))) return
    const user = yield* calling('users.info', slack.api.userInfo(event.user))
    if (user === undefined) return
    yield* offerSlackLink(slack, user, {
      channel: event.channel,
      ...(event.thread_ts !== undefined && { threadTs: event.thread_ts }),
    })
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

const withoutMentions = (text: string): string => text.replace(/<@[A-Z0-9]+>/g, ' ')

const LINK_WORD = /(^|\s)link(\s|$|[.!?])/i
const EVENTS_PER_PASS = 50
const DAY_MS = 24 * 60 * 60_000

interface EventRow {
  readonly event_id: string
  readonly payload: string | null
}
