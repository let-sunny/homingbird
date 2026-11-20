import { Task as T } from '@homingbird/kernel'
import {
  type Credential,
  CredentialId,
  type CredentialKind,
  type MemberId,
  type MemberKind,
  NotFound,
  Unauthorized,
} from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import { hashSecret } from '../random.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { type MemberRow, toMember } from './members.ts'
import { featureIsOn } from './settings.ts'

export interface IssueRequest {
  readonly memberId: MemberId
  readonly kind: CredentialKind
  readonly name: string
  readonly client: string
  readonly lifetimeMs: number
  readonly refreshable: boolean
  /** The manager who issued a channel's agent its credential. */
  readonly issuedBy?: MemberId
}

export interface Issued {
  readonly credentialId: CredentialId
  readonly token: string
  readonly tokenExpiresAt: number
  readonly refreshToken: string | null
}

export const BROWSER_SIGN_IN_CLIENT = 'Web'

export const issueCredential = (request: IssueRequest): T.Task<Issued, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const expiresAt = now + request.lifetimeMs
    const issued: Issued = {
      credentialId: CredentialId.of(env.random.identifier()),
      token: `${TOKEN_PREFIX[request.kind]}${env.random.secret()}`,
      tokenExpiresAt: request.refreshable ? Math.min(expiresAt, now + ACCESS_TOKEN_LIFETIME_MS) : expiresAt,
      refreshToken: request.refreshable ? `${REFRESH_PREFIX}${env.random.secret()}` : null,
    }
    yield* run(
      insertInto('credentials', {
        id: issued.credentialId,
        member_id: request.memberId,
        kind: request.kind,
        name: request.name.slice(0, 200),
        client: request.client.slice(0, 200),
        token_hash: hashSecret(issued.token),
        refresh_hash: issued.refreshToken === null ? null : hashSecret(issued.refreshToken),
        token_expires_at: issued.tokenExpiresAt,
        expires_at: expiresAt,
        created_at: now,
        last_used_at: null,
        revoked_at: null,
        issued_by: request.issuedBy ?? null,
      }),
    )
    return issued
  })

export const authenticate = (token: string): T.Task<Caller, Unauthorized, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const row = yield* first<
      Omit<CredentialRow, 'kind'> &
        Omit<MemberRow, 'kind'> & {
          credential_id: CredentialId
          credential_name: string
          credential_kind: CredentialKind
          member_kind: MemberKind | null
        }
    >(sql`
      SELECT m.*, m.kind AS member_kind, c.id AS credential_id, c.name AS credential_name, c.kind AS credential_kind,
             c.client, c.token_expires_at, c.expires_at, c.revoked_at, c.last_used_at
      FROM credentials c JOIN members m ON m.id = c.member_id
      WHERE c.token_hash = ${hashSecret(token)}`)
    const usable =
      row !== null &&
      row.revoked_at === null &&
      row.expires_at > now &&
      row.token_expires_at > now &&
      row.status === 'active' &&
      mayAuthenticate({ kind: row.credential_kind, client: row.client }) &&
      (row.member_kind === 'person' ||
        (row.member_kind === 'channel_agent' &&
          row.credential_kind === 'agent' &&
          (yield* featureIsOn('channelAgents'))))
    if (!usable)
      return yield* T.fail(Unauthorized({ message: 'This credential is missing, expired or revoked.' }))
    if (row.last_used_at === null || now - row.last_used_at > LAST_USED_RESOLUTION_MS)
      yield* run(sql`UPDATE credentials SET last_used_at = ${now} WHERE id = ${row.credential_id}`)
    return {
      member: toMember({ ...row, kind: row.member_kind }),
      credential: { id: row.credential_id, kind: row.credential_kind, name: row.credential_name },
    }
  })

export const listCredentials = (
  memberId: MemberId,
  currentId: CredentialId,
): T.Task<Credential[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<CredentialRow>) => rows.map((row) => toCredential(row, currentId)))(
    all<CredentialRow>(
      sql`SELECT * FROM credentials WHERE member_id = ${memberId} ORDER BY created_at DESC LIMIT 200`,
    ),
  )

export const renameCredential = (
  memberId: MemberId,
  currentId: CredentialId,
  id: CredentialId,
  name: string,
): T.Task<Credential, NotFound, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE credentials SET name = ${name} WHERE id = ${id} AND member_id = ${memberId}`)
    const row = yield* first<CredentialRow>(
      sql`SELECT * FROM credentials WHERE id = ${id} AND member_id = ${memberId}`,
    )
    return row === null
      ? yield* T.fail(NotFound({ message: 'No such credential.' }))
      : toCredential(row, currentId)
  })

export const revokeCredential = (memberId: MemberId, id: CredentialId): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* first(sql`SELECT id FROM credentials WHERE id = ${id} AND member_id = ${memberId}`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such credential.' }))
    yield* run(
      sql`UPDATE credentials SET revoked_at = ${env.clock.now()} WHERE id = ${id} AND revoked_at IS NULL`,
    )
  })

export const revokeByToken = (token: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const hash = hashSecret(token)
    yield* run(sql`
      UPDATE credentials SET revoked_at = ${env.clock.now()}
      WHERE (token_hash = ${hash} OR refresh_hash = ${hash}) AND revoked_at IS NULL`)
  })

export const TOKEN_PREFIX: Readonly<Record<CredentialKind, string>> = { human: 'hbh_', agent: 'hba_' }
export const REFRESH_PREFIX = 'hbr_'
export const ACCESS_TOKEN_LIFETIME_MS = 60 * 60_000
const LAST_USED_RESOLUTION_MS = 30_000

interface CredentialRow {
  readonly id: CredentialId
  readonly member_id: MemberId
  readonly kind: CredentialKind
  readonly name: string
  readonly client: string
  readonly token_expires_at: number
  readonly expires_at: number
  readonly created_at: number
  readonly last_used_at: number | null
  readonly revoked_at: number | null
}

const mayAuthenticate = (row: Pick<CredentialRow, 'kind' | 'client'>): boolean =>
  row.kind === 'agent' || row.client === BROWSER_SIGN_IN_CLIENT

const toCredential = (row: CredentialRow, currentId: CredentialId): Credential => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  client: row.client,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
  current: row.id === currentId,
})
