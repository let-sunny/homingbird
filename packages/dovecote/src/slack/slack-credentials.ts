import { Task as T } from '@homingbird/kernel'
import type { MemberId, SlackCredentials as SlackCredentialsView } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { SEALING_NONCE_BYTES, openSealed, sealSecret } from '../wake/sealing.ts'

/**
 * The environment's values win; stored ones are used only while their giver is an active administrator.
 * Only the Slack Web API client and the events signature check are given them (rule 5).
 */
export const slackCredentials: T.Task<SlackCredentials | null, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  if (env.config.slack !== null) return { ...env.config.slack, source: 'environment', storedAt: null }
  const key = env.config.secretsKey
  if (key === null) return null
  const row = yield* first<StoredRow>(sql`
    SELECT c.given_by, c.bot_token_sealed, c.signing_secret_sealed, c.given_at
    FROM slack_credentials c JOIN members m ON m.id = c.given_by
    WHERE c.slot = ${SLOT} AND m.role = 'admin' AND m.status = 'active'`)
  if (row === null) return null
  const botToken = openSealed(key, row.bot_token_sealed, contextOf(row.given_by, 'bot_token'))
  const signingSecret = openSealed(key, row.signing_secret_sealed, contextOf(row.given_by, 'signing_secret'))
  if (botToken === null || signingSecret === null) return null
  return { botToken, signingSecret, source: 'stored', storedAt: Number(row.given_at) }
})

export interface SlackCredentials {
  readonly botToken: string
  readonly signingSecret: string
  readonly source: 'environment' | 'stored'
  readonly storedAt: number | null
}

export const slackCredentialsView: T.Task<SlackCredentialsView, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const credentials = yield* slackCredentials
  return {
    source: credentials?.source ?? 'none',
    canStore: env.config.secretsKey !== null,
    storedAt: credentials?.storedAt ?? null,
  }
})

export const sealSlackCredentials = (
  key: Buffer,
  giver: MemberId,
  values: { readonly botToken: string; readonly signingSecret: string },
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const seal = (value: string, part: SealedPart) =>
      sealSecret(key, value, contextOf(giver, part), env.random.bytes(SEALING_NONCE_BYTES))
    yield* run(sql`DELETE FROM slack_credentials WHERE slot = ${SLOT}`)
    yield* run(
      insertInto('slack_credentials', {
        slot: SLOT,
        given_by: giver,
        bot_token_sealed: seal(values.botToken, 'bot_token'),
        signing_secret_sealed: seal(values.signingSecret, 'signing_secret'),
        given_at: env.clock.now(),
      }),
    )
  })

export const deleteSlackCredentials: T.Task<boolean, never, RequestEnv> = T.suspend(() =>
  T.map((removed: number) => removed > 0)(run(sql`DELETE FROM slack_credentials WHERE slot = ${SLOT}`)),
)

/** A giver who is deactivated or demoted has lost the right to have given them. */
export const forgetSlackCredentialsOf = (
  actor: Caller,
  memberId: MemberId,
  because: 'deactivated' | 'demoted',
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const removed = yield* run(sql`DELETE FROM slack_credentials WHERE given_by = ${memberId}`)
    if (removed > 0) yield* recordAudit('slack.credentials_removed', { caller: actor, detail: { because } })
  })

export const forgetRevokedSlackCredentials: T.Task<void, never, RequestEnv> = T.gen(function* () {
  if ((yield* slackCredentials)?.source !== 'stored') return
  if (yield* deleteSlackCredentials)
    yield* recordAudit('slack.credentials_removed', { detail: { because: 'revoked' } })
})

type SealedPart = 'bot_token' | 'signing_secret'

const SLOT = 'app'

const contextOf = (giver: string, part: SealedPart): string => `slack:${part}:${giver}`

interface StoredRow {
  readonly given_by: string
  readonly bot_token_sealed: string
  readonly signing_secret_sealed: string
  readonly given_at: number
}
