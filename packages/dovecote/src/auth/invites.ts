import { Task as T, tagged } from '@homingbird/kernel'
import {
  Forbidden,
  INVITE_LIFETIME_SECONDS,
  type Invite,
  type InviteLink,
  type Member,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { memberById } from '../domain/members.ts'
import { readSettings } from '../domain/settings.ts'
import { type AppEnv, type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { advanceAuthRequest, authRequestById, authRequestBySecret, openAuthRequest } from './requests.ts'

/** A single-use invite link for one new person, stored as a hash and shown in this response alone. */
export const createInvite = (
  caller: Caller,
  email: string | undefined,
): T.Task<InviteLink, Forbidden, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireMayInvite(caller)
    const code = `${INVITE_PREFIX}${env.random.secret()}`
    const bound = email?.trim().toLowerCase() || null
    const opened = yield* openAuthRequest<InviteDetail>({
      kind: 'invite',
      secret: code,
      memberId: caller.member.id,
      lifetimeMs: INVITE_LIFETIME_SECONDS * 1000,
      detail: { createdBy: caller.member.id, email: bound },
    })
    return {
      invite: {
        id: opened.id,
        email: bound,
        createdBy: caller.member.id,
        createdAt: env.clock.now(),
        expiresAt: opened.expiresAt,
      },
      url: `${env.config.publicUrl}/#/invite/${code}`,
    }
  })

/** The invites still waiting for someone: every one for an administrator, a member's own otherwise. */
export const listInvites = (caller: Caller): T.Task<Invite[], Forbidden, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireMayInvite(caller)
    const madeBy = caller.member.role === 'admin' ? sql`` : sql`AND member_id = ${caller.member.id}`
    const rows = yield* all<InviteRow>(
      sql`SELECT id, detail, created_at, expires_at FROM auth_requests
        WHERE kind = 'invite' AND status = 'pending' AND expires_at > ${env.clock.now()} ${madeBy}
        ORDER BY created_at DESC, id LIMIT ${LIST_LIMIT}`,
    )
    return rows.map(toInvite)
  })

/** Withdraws a pending invite: its maker, or any administrator. Anyone else learns nothing about it. */
export const revokeInvite = (caller: Caller, id: string): T.Task<void, Forbidden | NotFound, RequestEnv> =>
  T.gen(function* () {
    yield* requireMayInvite(caller)
    const request = yield* authRequestById<InviteDetail>('invite', id)
    const isTheirs = request !== null && request.detail.createdBy === caller.member.id
    const revoked =
      request !== null &&
      request.status === 'pending' &&
      (isTheirs || caller.member.role === 'admin') &&
      (yield* advanceAuthRequest(id, { status: 'denied', expectedStatus: 'pending' }))
    if (!revoked) return yield* T.fail(NotFound({ message: 'There is no pending invite with that id.' }))
  })

/** Checks an opened invite link before sign-in starts, and names the invite the sign-in carries. */
export const openInvite = (code: string): T.Task<string, InviteRefused, AppEnv> =>
  T.gen(function* () {
    if (!code.startsWith(INVITE_PREFIX)) return yield* T.fail(REFUSED)
    const request = yield* authRequestBySecret<InviteDetail>('invite', code)
    if (request === null || request.status !== 'pending' || !(yield* makerMayInvite(request.detail)))
      return yield* T.fail(REFUSED)
    return request.id
  })

/**
 * Spends an invite on a person signing in with a verified email: still pending and unexpired, made by
 * someone who may still invite, and for this address when it names one. Called inside the transaction
 * that admits the person, so a refusal later in sign-in leaves it unspent.
 */
export const redeemInvite = (id: string, email: string): T.Task<boolean, never, RequestEnv> =>
  T.gen(function* () {
    const request = yield* authRequestById<InviteDetail>('invite', id)
    if (request === null || request.status !== 'pending') return false
    if (request.detail.email !== null && request.detail.email !== email.toLowerCase()) return false
    if (!(yield* makerMayInvite(request.detail))) return false
    return yield* advanceAuthRequest(id, { status: 'consumed', expectedStatus: 'pending' })
  })

export const recordInviteRedeemed = (id: string, member: Member): T.Task<void, never, RequestEnv> =>
  recordAudit('member.invite_redeemed', {
    actorId: member.id,
    targetId: id,
    detail: { memberId: member.id },
  })

/** Whether a member may make invite links under these settings. */
export const mayInvite = (
  member: Pick<Member, 'role' | 'status' | 'kind'>,
  settings: { readonly whoCanInvite?: string | undefined },
): boolean =>
  member.status === 'active' &&
  member.kind === 'person' &&
  (member.role === 'admin' || settings.whoCanInvite === 'members')

export const InviteRefused = tagged('InviteRefused')<{ readonly message: string }>()
export type InviteRefused = ReturnType<typeof InviteRefused>

export const INVITE_REFUSED_MESSAGE =
  'This invite link is unknown, expired or already used. Ask the person who sent it for a new one.'

const INVITE_PREFIX = 'hbi_'
const LIST_LIMIT = 200

const REFUSED = InviteRefused({ message: INVITE_REFUSED_MESSAGE })

interface InviteDetail {
  readonly createdBy: MemberId
  readonly email: string | null
}

interface InviteRow {
  readonly id: string
  readonly detail: string
  readonly created_at: number
  readonly expires_at: number
}

const toInvite = (row: InviteRow): Invite => {
  const detail = JSON.parse(row.detail) as InviteDetail
  return {
    id: row.id,
    email: detail.email,
    createdBy: detail.createdBy,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

const requireMayInvite = (caller: Caller): T.Task<void, Forbidden, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller) || !mayInvite(caller.member, yield* readSettings))
      return yield* T.fail(Forbidden({ message: 'You cannot make invite links on this server.' }))
  })

const makerMayInvite = (detail: InviteDetail): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const settings = yield* readSettings
    return yield* T.fold(
      () => false,
      (maker: Member) => mayInvite(maker, settings),
    )(memberById(detail.createdBy))
  })
