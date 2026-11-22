import { Task as T } from '@homingbird/kernel'
import type { SlackWorkspace } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { forgetRevokedSlackCredentials, slackCredentials } from './slack-credentials.ts'
import { type SlackApi, type SlackCallFailure, type SlackIdentity, isTokenRefusal } from './slack-web-api.ts'

export const workingSlack: T.Task<WorkingSlack | null, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  if (!(yield* featureIsOn('slack'))) return null
  const credentials = yield* slackCredentials
  if (credentials === null) return null
  const workspace = yield* pinnedWorkspace
  return workspace === null || workspace.state !== 'connected'
    ? null
    : { api: env.slackApi(credentials.botToken), workspace }
})

export interface WorkingSlack {
  readonly api: SlackApi
  readonly workspace: SlackWorkspaceRow
}

/** The first workspace the token names is pinned; a token of another one stops Slack until it is back. */
export const checkSlackWorkspace: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  if (!(yield* featureIsOn('slack'))) return
  const credentials = yield* slackCredentials
  if (credentials === null) return
  yield* T.catchAll((failure: SlackCallFailure) => slackCallFailed('auth.test', failure))(
    T.flatMap((identity: SlackIdentity) => transact(rememberSlackIdentity(identity)))(
      env.slackApi(credentials.botToken).authTest(),
    ),
  )
})

export const slackCallFailed = (method: string, failure: SlackCallFailure): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    env.log.emit(
      {
        name: 'slack.call_failed',
        attributes: {
          method,
          failure: failure._tag,
          error: failure._tag === 'SlackRefused' ? failure.error.slice(0, 60) : '',
        },
      },
      env.requestId,
    )
    if (isTokenRefusal(failure)) yield* transact(stopSlack('token_refused'))
  })

/** Slack refused the bot token before any workspace was pinned, so nothing names the workspace yet. */
export const slackTokenRefused: T.Task<boolean, never, AppEnv> = T.map((row: unknown) => row !== null)(
  T.suspend(() => first(sql`SELECT name FROM settings WHERE name = ${TOKEN_REFUSED_ROW}`)),
)

/** Why Slack does not work, as people are told: its stop, or a token refused before it ever connected. */
export const slackStopOf = (workspace: SlackWorkspaceRow | null): T.Task<SlackStop | null, never, AppEnv> =>
  T.gen(function* () {
    if (workspace !== null) return workspace.state === 'stopped' ? workspace.stopped_because : null
    return (yield* slackTokenRefused) ? 'token_refused' : null
  })

export const stopSlack = (because: SlackStop): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const workspace = yield* pinnedWorkspace
    if (workspace === null && because === 'token_refused') return yield* rememberTokenRefused
    if (workspace === null || workspace.state === 'stopped') return
    yield* run(sql`UPDATE slack_workspaces SET state = 'stopped', stopped_because = ${because},
      checked_at = ${env.clock.now()} WHERE team_id = ${workspace.team_id}`)
    yield* recordAudit('slack.stopped', { targetId: workspace.team_id, detail: { because } })
    if (because === 'revoked') yield* forgetRevokedSlackCredentials
  })

export const pinnedWorkspace: T.Task<SlackWorkspaceRow | null, never, AppEnv> = T.suspend(() =>
  first<SlackWorkspaceRow>(sql`SELECT * FROM slack_workspaces ORDER BY connected_at LIMIT 1`),
)

export const workspaceView = (row: SlackWorkspaceRow): SlackWorkspace => ({
  team: row.team_name,
  state: row.state,
  stoppedBecause: row.stopped_because,
  connectedAt: Number(row.connected_at),
  lastEventAt: row.last_event_at === null ? null : Number(row.last_event_at),
})

export type SlackStop = 'token_refused' | 'revoked' | 'other_workspace'

export interface SlackWorkspaceRow {
  readonly team_id: string
  readonly team_name: string
  readonly bot_user_id: string
  readonly bot_id: string | null
  readonly state: 'connected' | 'stopped'
  readonly stopped_because: SlackStop | null
  readonly connected_at: number
  readonly checked_at: number
  readonly last_event_at: number | null
}

/** Pins the first workspace a token names, and connects it again when a token of it works. */
export const rememberSlackIdentity = (identity: SlackIdentity): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    const workspace = yield* pinnedWorkspace
    yield* forgetTokenRefused
    if (workspace !== null && workspace.team_id !== identity.teamId)
      return yield* stopSlack('other_workspace')
    if (workspace === null)
      yield* run(
        insertInto('slack_workspaces', {
          team_id: identity.teamId,
          team_name: identity.team ?? identity.teamId,
          bot_user_id: identity.userId,
          bot_id: identity.botId,
          state: 'connected',
          stopped_because: null,
          connected_at: now,
          checked_at: now,
          last_event_at: null,
        }),
      )
    else
      yield* run(sql`UPDATE slack_workspaces SET team_name = ${identity.team ?? workspace.team_name},
        bot_user_id = ${identity.userId}, bot_id = ${identity.botId}, state = 'connected',
        stopped_because = NULL, checked_at = ${now} WHERE team_id = ${identity.teamId}`)
    if (workspace === null || workspace.state !== 'connected')
      yield* recordAudit('slack.connected', {
        targetId: identity.teamId,
        detail: { teamId: identity.teamId },
      })
  })

export const forgetTokenRefused: T.Task<void, never, AppEnv> = T.suspend(() =>
  T.asUnit(run(sql`DELETE FROM settings WHERE name = ${TOKEN_REFUSED_ROW}`)),
)

const rememberTokenRefused: T.Task<void, never, RequestEnv> = T.gen(function* () {
  const env = yield* T.ask<RequestEnv>()
  yield* forgetTokenRefused
  yield* run(
    insertInto('settings', { name: TOKEN_REFUSED_ROW, value: JSON.stringify({ at: env.clock.now() }) }),
  )
})

const TOKEN_REFUSED_ROW = 'slack-token-refused'
