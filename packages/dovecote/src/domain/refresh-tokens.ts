import { Task as T } from '@homingbird/kernel'
import type { CredentialId, CredentialKind, MemberId, MemberStatus } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { hashSecret } from '../random.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import { ACCESS_TOKEN_LIFETIME_MS, type Issued, REFRESH_PREFIX, TOKEN_PREFIX } from './credentials.ts'

/** A replay's revocation must commit, so the caller refuses the client after the transaction. */
export type Refresh =
  | { readonly outcome: 'issued'; readonly issued: Issued }
  | { readonly outcome: 'refused' }
  | { readonly outcome: 'replayed' }

/** A spent token presented again after the grace revokes its credential, the access token with it. */
export const refreshCredential = (refreshToken: string): T.Task<Refresh, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    const hash = hashSecret(refreshToken)
    const row = yield* first<RefreshRow>(sql`
      SELECT c.id, c.kind, c.member_id, c.expires_at, c.revoked_at, m.status
      FROM credentials c JOIN members m ON m.id = c.member_id WHERE c.refresh_hash = ${hash}`)
    if (row === null) return yield* spentOrUnknown(hash, now)
    const usable = row.revoked_at === null && row.expires_at > now && row.status === 'active'
    if (!usable) return REFUSED
    const issued: Issued = {
      credentialId: row.id,
      token: `${TOKEN_PREFIX[row.kind]}${env.random.secret()}`,
      tokenExpiresAt: Math.min(row.expires_at, now + ACCESS_TOKEN_LIFETIME_MS),
      refreshToken: `${REFRESH_PREFIX}${env.random.secret()}`,
    }
    const rotated = yield* run(sql`
      UPDATE credentials SET token_hash = ${hashSecret(issued.token)}, refresh_hash = ${hashSecret(issued.refreshToken!)},
      token_expires_at = ${issued.tokenExpiresAt}
      WHERE id = ${row.id} AND refresh_hash = ${hash} AND revoked_at IS NULL`)
    if (rotated === 0) return REFUSED
    yield* run(
      insertInto('spent_refresh_tokens', { refresh_hash: hash, credential_id: row.id, spent_at: now }),
    )
    return { outcome: 'issued', issued }
  })

/** A spent token is kept while its credential could still be used. */
export const deleteSpentRefreshTokens = (now: number): T.Task<void, never, AppEnv> =>
  T.asUnit(
    run(sql`
      DELETE FROM spent_refresh_tokens
      WHERE credential_id IN (SELECT id FROM credentials WHERE expires_at <= ${now})`),
  )

interface RefreshRow {
  readonly id: CredentialId
  readonly kind: CredentialKind
  readonly member_id: MemberId
  readonly expires_at: number
  readonly revoked_at: number | null
  readonly status: MemberStatus
}

const REFUSED: Refresh = { outcome: 'refused' }
/** A client retrying a refresh whose answer it lost repeats the token the live one replaced. */
const REFRESH_REPLAY_GRACE_MS = 10_000

const spentOrUnknown = (hash: string, now: number): T.Task<Refresh, never, RequestEnv> =>
  T.gen(function* () {
    const spent = yield* first<{ credential_id: CredentialId; spent_at: number }>(
      sql`SELECT credential_id, spent_at FROM spent_refresh_tokens WHERE refresh_hash = ${hash}`,
    )
    if (spent === null) return REFUSED
    if (now - Number(spent.spent_at) <= REFRESH_REPLAY_GRACE_MS && (yield* isLatestSpent(hash, spent)))
      return REFUSED
    const revoked = yield* run(
      sql`UPDATE credentials SET revoked_at = ${now} WHERE id = ${spent.credential_id} AND revoked_at IS NULL`,
    )
    if (revoked > 0)
      yield* recordAudit('credential.revoked', {
        targetId: spent.credential_id,
        detail: { because: 'refresh_replayed' },
      })
    return { outcome: 'replayed' }
  })

const isLatestSpent = (
  hash: string,
  spent: { readonly credential_id: CredentialId; readonly spent_at: number },
): T.Task<boolean, never, AppEnv> =>
  T.map((row: unknown) => row === null)(
    first(sql`
      SELECT refresh_hash FROM spent_refresh_tokens
      WHERE credential_id = ${spent.credential_id} AND spent_at >= ${spent.spent_at} AND refresh_hash <> ${hash}`),
  )
