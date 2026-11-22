import { Task as T } from '@homingbird/kernel'
import type { MemberId, MemberStatus } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type HasSql, all, first } from '../sql/database.ts'
import { type Query, sql } from '../sql/query.ts'

/** What the server still holds for a person who left, as the offboarding checks read it; null for nobody. */
export const leaverFactsFor = (email: string): T.Task<LeaverFacts | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const address = email.trim().toLowerCase()
    const member = yield* first<{ id: MemberId; email: string; status: MemberStatus }>(
      sql`SELECT id, email, status FROM members WHERE email = ${address} AND kind = 'person'`,
    )
    if (member === null) return null
    const now = env.clock.now()
    return {
      id: member.id,
      email: member.email,
      status: member.status,
      ownCredentials: yield* count(
        sql`SELECT COUNT(*) AS n FROM credentials WHERE member_id = ${member.id} AND revoked_at IS NULL AND expires_at > ${now}`,
      ),
      issuedCredentials: yield* count(
        sql`SELECT COUNT(*) AS n FROM credentials WHERE issued_by = ${member.id} AND revoked_at IS NULL AND expires_at > ${now}`,
      ),
      groups: yield* count(sql`SELECT COUNT(*) AS n FROM group_members WHERE member_id = ${member.id}`),
      approvedSignIns: yield* count(
        sql`SELECT COUNT(*) AS n FROM auth_requests WHERE member_id = ${member.id} AND status = 'approved' AND expires_at > ${now}`,
      ),
      deskWakes: yield* count(sql`SELECT COUNT(*) AS n FROM desk_wakes WHERE member_id = ${member.id}`),
      slackLinks: yield* count(sql`SELECT COUNT(*) AS n FROM slack_people WHERE member_id = ${member.id}`),
      namedAdministrator: env.config.adminEmails.includes(address),
    }
  })

export interface LeaverFacts {
  readonly id: MemberId
  readonly email: string
  readonly status: MemberStatus
  readonly ownCredentials: number
  readonly issuedCredentials: number
  readonly groups: number
  readonly approvedSignIns: number
  readonly deskWakes: number
  readonly slackLinks: number
  readonly namedAdministrator: boolean
}

const count = (query: Query): T.Task<number, never, HasSql> =>
  T.map((rows: ReadonlyArray<{ n: number | string }>) => rows.reduce((sum, row) => sum + Number(row.n), 0))(
    all<{ n: number | string }>(query),
  )
