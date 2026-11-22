import { Schema as S, Task as T } from '@homingbird/kernel'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { type HttpRequest, type HttpResponse, json, parseJson } from '../http/exchange.ts'
import { dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { threadOf } from './slack-arrivals.ts'
import { linkOfSlackChannel } from './slack-channels.ts'
import { slackPersonBySlackUser } from './slack-people.ts'
import { type SlackSignatureRefused, requireSlackSignature } from './slack-signature.ts'
import { type SlackWorkspaceRow, pinnedWorkspace } from './slack-workspace.ts'

/**
 * `POST /slack/events`: authenticated by Slack's signature over the raw body, not by a credential. An
 * event Homingbird uses is stored by Slack's event id and answered at once, so a retry does nothing and
 * Slack's three-second limit is never at risk; a pass does the work. Anything else is dropped unread,
 * never stored and never logged: messages in channels, events of another workspace.
 */
export const handleSlackEvents = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (env.config.slack === null || !(yield* featureIsOn('slack'))) return NOT_FOUND
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' })
    const refused = yield* T.catchAll((refusal: SlackSignatureRefused) => T.succeed(refusal.reason))(
      T.as(null)(
        requireSlackSignature(env.config.slack.signingSecret, {
          timestamp: request.headers['x-slack-request-timestamp'] ?? null,
          signature: request.headers['x-slack-signature'] ?? null,
          body: request.body,
        }),
      ),
    )
    if (refused !== null) {
      env.log.emit(
        { name: 'slack.event_refused', attributes: { reason: `signature_${refused}` } },
        env.requestId,
      )
      return json(401, { error: 'The signature does not match.' })
    }
    const envelope = Envelope.decode(parseJson(request.body))
    if (envelope._tag === 'Err') {
      env.log.emit({ name: 'slack.event_refused', attributes: { reason: 'malformed' } }, env.requestId)
      return json(400, { error: 'Not a Slack event.' })
    }
    if (envelope.value.type === 'url_verification')
      return json(200, { challenge: envelope.value.challenge ?? '' })
    if (envelope.value.type === 'event_callback') yield* keep(envelope.value)
    return json(200, { ok: true })
  })

/** The fields of a kept event the pass reads; nothing of a user's profile beyond these is kept. */
export interface KeptEvent {
  readonly type: string
  readonly user?: string
  readonly bot_id?: string
  readonly text?: string
  readonly channel?: string
  readonly ts?: string
  readonly thread_ts?: string
  readonly tokens?: { readonly bot?: ReadonlyArray<string> }
  readonly subject?: { readonly id: string; readonly name: string; readonly deleted: boolean }
  /** When Slack changed a kept message, for an edit or a deletion. */
  readonly at?: string
}

const keep = (envelope: S.Infer<typeof Envelope>): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const workspace = yield* pinnedWorkspace
    if (workspace === null || envelope.team_id !== workspace.team_id || envelope.event_id === undefined)
      return
    const kept = yield* keptPartOf(envelope.event, workspace)
    env.log.emit({
      name: 'slack.event_received',
      attributes: { kind: kindOf(envelope.event), kept: kept !== null },
    })
    yield* run(
      sql`UPDATE slack_workspaces SET last_event_at = ${env.clock.now()} WHERE team_id = ${workspace.team_id}`,
    )
    if (kept === null) return
    yield* run(
      insertIgnoringConflict(yield* dialect, 'slack_events', {
        event_id: envelope.event_id,
        kind: kept.type,
        payload: JSON.stringify(kept),
        received_at: env.clock.now(),
        processed_at: null,
      }),
    )
  })

/** Which part of an event is kept, decided before anything of a message's text is read. */
const keptPartOf = (event: unknown, workspace: SlackWorkspaceRow): T.Task<KeptEvent | null, never, AppEnv> =>
  T.gen(function* () {
    const typed = EventType.decode(event)
    if (typed._tag === 'Err') return null
    const type = typed.value.type
    if (type === 'message') return yield* keptMessage(event, workspace)
    if (type === 'member_left_channel' || type === 'channel_archive' || type === 'channel_deleted') {
      const place = ChannelEvent.decode(event)
      if (place._tag === 'Err' || (yield* linkOfSlackChannel(place.value.channel)) === null) return null
      if (type === 'member_left_channel' && place.value.user !== workspace.bot_user_id) return null
      return { type, channel: place.value.channel }
    }
    if (type === 'app_mention') {
      const mention = Mention.decode(event)
      return mention._tag === 'Ok' ? { type: 'app_mention', ...mention.value } : null
    }
    if (type === 'app_uninstalled') return { type }
    if (type === 'tokens_revoked') {
      const revoked = Revoked.decode(event)
      return revoked._tag === 'Ok' ? { type, tokens: { bot: revoked.value.tokens.bot ?? [] } } : null
    }
    if (type === 'user_change') {
      const changed = UserChange.decode(event)
      if (changed._tag === 'Err' || (yield* slackPersonBySlackUser(changed.value.user.id)) === null)
        return null
      const user = changed.value.user
      return {
        type,
        subject: {
          id: user.id,
          name: user.profile?.display_name || user.real_name || user.name || user.id,
          deleted: user.deleted === true,
        },
      }
    }
    return null
  })

/**
 * A channel message is kept only when it belongs to a linked thread, or is an edit or a deletion of a
 * message that arrived; then only its times, and an edit's new text. The app's own messages go first.
 */
const keptMessage = (event: unknown, workspace: SlackWorkspaceRow): T.Task<KeptEvent | null, never, AppEnv> =>
  T.gen(function* () {
    const decoded = MessageEvent.decode(event)
    if (decoded._tag === 'Err') return null
    const message = decoded.value
    if ((yield* linkOfSlackChannel(message.channel)) === null) return null
    const author = message.message ?? message
    if (author.bot_id === workspace.bot_id || author.user === workspace.bot_user_id) return null
    if (message.subtype === 'message_changed' && message.message !== undefined)
      return (yield* hasArrived(message.channel, message.message.ts))
        ? {
            type: 'message_changed',
            channel: message.channel,
            ts: message.message.ts,
            at: message.ts,
            text: message.message.text ?? '',
          }
        : null
    if (message.subtype === 'message_deleted' && message.deleted_ts !== undefined)
      return (yield* hasArrived(message.channel, message.deleted_ts))
        ? { type: 'message_deleted', channel: message.channel, ts: message.deleted_ts, at: message.ts }
        : null
    if (message.subtype !== undefined && message.subtype !== 'thread_broadcast') return null
    if (message.thread_ts === undefined || (yield* threadOf(message.channel, message.thread_ts)) === null)
      return null
    return { type: 'thread_moved', channel: message.channel, ts: message.ts, thread_ts: message.thread_ts }
  })

const hasArrived = (channel: string, ts: string): T.Task<boolean, never, AppEnv> =>
  T.map((row: unknown) => row !== null)(
    first(sql`SELECT note_id FROM slack_arrivals WHERE slack_channel_id = ${channel} AND message_ts = ${ts}`),
  )

const kindOf = (event: unknown): string => {
  const typed = EventType.decode(event)
  return typed._tag === 'Ok' ? typed.value.type : 'none'
}

const NOT_FOUND: HttpResponse = json(404, { error: { code: 'NotFound', message: 'Not found.' } })

const SlackId = S.string({ minLength: 1, maxLength: 64 })
const Name = S.string({ maxLength: 200 })

const Envelope = S.struct({
  type: S.string({ maxLength: 40 }),
  challenge: S.optional(S.string({ maxLength: 200 })),
  event_id: S.optional(SlackId),
  team_id: S.optional(SlackId),
  event: S.optional(S.unknown),
})

const EventType = S.struct({ type: S.string({ maxLength: 40 }) })

const Mention = S.struct({
  user: S.optional(SlackId),
  bot_id: S.optional(SlackId),
  text: S.optional(S.string({ maxLength: 40_000 })),
  channel: SlackId,
  ts: SlackId,
  thread_ts: S.optional(SlackId),
})

const ChannelEvent = S.struct({ channel: SlackId, user: S.optional(SlackId) })

const MessageEvent = S.struct({
  channel: SlackId,
  ts: SlackId,
  thread_ts: S.optional(SlackId),
  subtype: S.optional(S.string({ maxLength: 40 })),
  user: S.optional(SlackId),
  bot_id: S.optional(SlackId),
  deleted_ts: S.optional(SlackId),
  message: S.optional(
    S.struct({
      ts: SlackId,
      user: S.optional(SlackId),
      bot_id: S.optional(SlackId),
      text: S.optional(S.string({ maxLength: 40_000 })),
    }),
  ),
})

const Revoked = S.struct({ tokens: S.struct({ bot: S.optional(S.array(SlackId, { maxItems: 100 })) }) })

const UserChange = S.struct({
  user: S.struct({
    id: SlackId,
    name: S.optional(Name),
    real_name: S.optional(Name),
    deleted: S.optional(S.boolean),
    profile: S.optional(S.struct({ display_name: S.optional(Name) })),
  }),
})
