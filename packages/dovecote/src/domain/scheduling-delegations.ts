import { Task as T } from '@homingbird/kernel'
import {
  type CredentialId,
  DEFAULT_SCHEDULING_DELEGATION,
  Forbidden,
  Invalid,
  type MemberId,
  type SchedulingDelegation,
  type SchedulingDelegationView,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'

/** The person's delegation as they set it, on with no limit until they change it, and the agent it uses. */
export const delegationViewOf = (memberId: MemberId): T.Task<SchedulingDelegationView, never, AppEnv> =>
  T.gen(function* () {
    const delegation = yield* delegationOf(memberId)
    const agent = yield* delegatedAgentOf(memberId, delegation.agentId)
    return { delegation, agentInUse: agent?.id ?? null }
  })

/**
 * Replaces the person's delegation. Only the person changes it, in the web client (rules 3 and 9); the
 * server checks the agent is theirs and the people are active.
 */
export const setDelegation = (
  caller: Caller,
  wish: SchedulingDelegation,
): T.Task<SchedulingDelegationView, Forbidden | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(
        Forbidden({ message: 'Only a person sets what their agent may do in scheduling rooms.' }),
      )
    const memberId = caller.member.id
    if (wish.agentId !== null && !(yield* isOwnAgent(memberId, wish.agentId, env.clock.now())))
      return yield* T.fail(Invalid({ message: 'Choose one of your own connected agents.' }))
    const people = [...new Set(wish.scope.people ?? [])].sort()
    if (people.length > 0) {
      const found = yield* all<{ id: MemberId }>(
        sql`SELECT id FROM members WHERE status = 'active' AND kind = 'person' AND id IN ${list(people)}`,
      )
      if (found.length !== people.length)
        return yield* T.fail(Invalid({ message: 'Choose active people only.' }))
    }
    const { scope } = wish
    const brief = wish.brief.trim()
    yield* forgetDelegation(memberId)
    yield* run(
      insertInto('scheduling_delegations', {
        member_id: memberId,
        auto_join: wish.autoJoin ? 1 : 0,
        auto_add: wish.autoAdd ? 1 : 0,
        credential_id: wish.agentId,
        brief: brief === '' ? null : brief,
        max_minutes: scope.maxMinutes,
        hours_from: scope.hours?.from ?? null,
        hours_to: scope.hours?.to ?? null,
        time_zone: scope.hours?.timeZone ?? null,
        updated_at: env.clock.now(),
      }),
    )
    for (const other of people)
      yield* run(insertInto('scheduling_delegation_people', { member_id: memberId, other_member_id: other }))
    return yield* delegationViewOf(memberId)
  })

export const delegationOf = (memberId: MemberId): T.Task<SchedulingDelegation, never, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<DelegationRow>(sql`
      SELECT auto_join, auto_add, credential_id, brief, max_minutes, hours_from, hours_to, time_zone
      FROM scheduling_delegations WHERE member_id = ${memberId}`)
    if (row === null) return DEFAULT_SCHEDULING_DELEGATION
    const people = yield* all<{ other_member_id: MemberId }>(sql`
      SELECT other_member_id FROM scheduling_delegation_people WHERE member_id = ${memberId}
      ORDER BY other_member_id`)
    const isHours = row.hours_from !== null && row.hours_to !== null && row.time_zone !== null
    return {
      autoJoin: row.auto_join === null || Number(row.auto_join) === 1,
      autoAdd: row.auto_add === null || Number(row.auto_add) === 1,
      agentId: row.credential_id,
      brief: row.brief ?? '',
      scope: {
        people: people.length === 0 ? null : people.map((person) => person.other_member_id),
        hours: isHours
          ? { from: Number(row.hours_from), to: Number(row.hours_to), timeZone: String(row.time_zone) }
          : null,
        maxMinutes: row.max_minutes === null ? null : Number(row.max_minutes),
      },
    }
  })

/**
 * The connected agent the delegation uses: the one the person chose while it still works, else the one
 * that drafted most recently, else the newest.
 */
export const delegatedAgentOf = (
  memberId: MemberId,
  chosen: CredentialId | null,
): T.Task<DelegatedAgent | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const agents = yield* all<DelegatedAgent>(sql`
      SELECT c.id, c.name, COALESCE((SELECT MAX(n.created_at) FROM notes n
        WHERE n.author_id = c.member_id AND n.credential_id = c.id), 0) AS drafted_at
      FROM credentials c
      WHERE c.member_id = ${memberId} AND c.kind = 'agent' AND c.revoked_at IS NULL
      AND c.expires_at > ${env.clock.now()}
      ORDER BY drafted_at DESC, c.created_at DESC, c.id`)
    return agents.find((agent) => agent.id === chosen) ?? agents[0] ?? null
  })

/** Deletes the person's delegation, as when they are deactivated; they then delegate as by default. */
export const forgetDelegation = (memberId: MemberId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`DELETE FROM scheduling_delegation_people WHERE member_id = ${memberId}`)
    yield* run(sql`DELETE FROM scheduling_delegations WHERE member_id = ${memberId}`)
  })

export interface DelegatedAgent {
  readonly id: CredentialId
  readonly name: string
}

const isOwnAgent = (memberId: MemberId, agentId: CredentialId, now: number): T.Task<boolean, never, AppEnv> =>
  T.map((found: unknown) => found !== null)(
    first(sql`
      SELECT 1 AS present FROM credentials WHERE id = ${agentId} AND member_id = ${memberId}
      AND kind = 'agent' AND revoked_at IS NULL AND expires_at > ${now}`),
  )

interface DelegationRow {
  readonly auto_join: number | null
  readonly auto_add: number | null
  readonly credential_id: CredentialId | null
  readonly brief: string | null
  readonly max_minutes: number | null
  readonly hours_from: number | null
  readonly hours_to: number | null
  readonly time_zone: string | null
}
