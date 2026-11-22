import { Schema as S, Task as T } from '@homingbird/kernel'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { type HttpRequest, type HttpResponse, json, parseJson } from '../http/exchange.ts'
import { dialect, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { slackPersonBySlackUser } from './slack-people.ts'
import { type SlackSignatureRefused, requireSlackSignature } from './slack-signature.ts'
import { pinnedWorkspace } from './slack-workspace.ts'

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
}

const keep = (envelope: S.Infer<typeof Envelope>): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const workspace = yield* pinnedWorkspace
    if (workspace === null || envelope.team_id !== workspace.team_id || envelope.event_id === undefined)
      return
    const kept = yield* keptPartOf(envelope.event)
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
const keptPartOf = (event: unknown): T.Task<KeptEvent | null, never, AppEnv> =>
  T.gen(function* () {
    const typed = EventType.decode(event)
    if (typed._tag === 'Err') return null
    const type = typed.value.type
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
