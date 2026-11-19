import { Task as T } from '@homingbird/kernel'
import {
  type CredentialId,
  type Debate,
  type DebateEnding,
  type DebateId,
  type DebateResult,
  type DebateStatus,
  type DebateVisibility,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { EVERYONE, type RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/** The room, when the viewer may see it: an open room to everyone, a private one to its members only. */
export const visibleDebate = (viewerId: MemberId, id: DebateId): T.Task<DebateRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<DebateRow>(sql`SELECT * FROM debates WHERE id = ${id}`)
    if (row === null || !(yield* maySeeDebate(viewerId, row)))
      return yield* T.fail(NotFound({ message: 'No such debate room.' }))
    return row
  })

/** The room as every viewer who may see it sees it: nothing in it depends on who asks. */
export const describeDebate = (row: DebateRow): T.Task<Debate, never, AppEnv> =>
  T.gen(function* () {
    const id = row.id
    const members = yield* all<{ member_id: MemberId }>(
      sql`SELECT member_id FROM debate_members WHERE debate_id = ${id} ORDER BY created_at, member_id`,
    )
    const participants = yield* participantsOf(id)
    const turns = yield* all<TurnRow>(
      sql`SELECT * FROM debate_turns WHERE debate_id = ${id} ORDER BY position`,
    )
    const active = new Set(
      (yield* all<{ id: MemberId }>(sql`
        SELECT m.id FROM members m JOIN debate_participants p ON p.member_id = m.id
        WHERE p.debate_id = ${id} AND m.status = 'active'`)).map((member) => member.id),
    )
    const approvals = yield* all<{ member_id: MemberId; approved_at: number }>(
      sql`SELECT member_id, approved_at FROM debate_approvals WHERE debate_id = ${id}`,
    )
    return {
      id,
      question: row.question,
      visibility: row.visibility,
      status: row.status,
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
      deadlineAt: Number(row.deadline_at),
      concludedAt: numberOrNull(row.concluded_at),
      closedAt: numberOrNull(row.closed_at),
      endedBecause: row.ended_because,
      limits: limitsOf(row),
      memberIds: members.map((member) => member.member_id),
      participants: participants.map((participant) => ({
        memberId: participant.member_id,
        agentId: participant.credential_id,
        agentName: participant.agent_name,
        joinedAt: Number(participant.created_at),
      })),
      turns: turns.map((turn) => ({
        position: Number(turn.position),
        memberId: turn.member_id,
        agentName: turn.agent_name,
        body: turn.body,
        at: Number(turn.created_at),
      })),
      result: resultOf(row),
      resultRound: Number(row.result_round),
      approvals: participants
        .filter((participant) => active.has(participant.member_id))
        .map((participant) => ({
          memberId: participant.member_id,
          approvedAt: numberOrNull(
            approvals.find((one) => one.member_id === participant.member_id)?.approved_at,
          ),
        })),
    }
  })

/** The room as one viewer receives it: which agent takes part is shown to its own person only. */
export const seenBy =
  (viewerId: MemberId) =>
  (debate: Debate): Debate => ({
    ...debate,
    participants: debate.participants.map((participant) =>
      participant.memberId === viewerId ? participant : { ...participant, agentId: null },
    ),
  })

export const maySeeDebate = (viewerId: MemberId, row: Pick<DebateRow, 'id' | 'visibility'>) =>
  row.visibility === 'open' ? T.succeed(true) : isDebateMember(row.id, viewerId)

export const isDebateMember = (id: DebateId, memberId: MemberId): T.Task<boolean, never, AppEnv> =>
  T.map((found: unknown) => found !== null)(
    first(sql`SELECT 1 AS present FROM debate_members WHERE debate_id = ${id} AND member_id = ${memberId}`),
  )

export const participantsOf = (id: DebateId): T.Task<ReadonlyArray<ParticipantRow>, never, AppEnv> =>
  all<ParticipantRow>(
    sql`SELECT * FROM debate_participants WHERE debate_id = ${id} ORDER BY created_at, member_id`,
  )

/** The participant a credential takes turns for in this room, or null. */
export const participantByAgent = (
  id: DebateId,
  credentialId: CredentialId,
): T.Task<ParticipantRow | null, never, AppEnv> =>
  first<ParticipantRow>(
    sql`SELECT * FROM debate_participants WHERE debate_id = ${id} AND credential_id = ${credentialId}`,
  )

/**
 * Takes the room's row lock for the rest of the transaction, so concurrent turns, approvals and
 * drafts see each other; it returns the row as it is now.
 */
export const lockedDebate = (id: DebateId, now: number): T.Task<DebateRow, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE debates SET updated_at = ${now} WHERE id = ${id}`)
    return (yield* first<DebateRow>(sql`SELECT * FROM debates WHERE id = ${id}`))!
  })

/**
 * Tells the room's members, and only them, that it changed: without content and without storing it.
 * Clients read the room again through the API. When an open room is opened or ends, everyone is told,
 * so lists of rooms stay current; a private room is never announced beyond its members.
 */
export const announceDebate = (
  row: Pick<DebateRow, 'id' | 'visibility'>,
  audience: 'members' | 'everyone' = 'members',
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const participants = yield* participantsOf(row.id)
    const event = {
      seq: 0,
      at: env.clock.now(),
      body: {
        type: 'debate.changed' as const,
        debateId: row.id,
        participantIds: participants.map((one) => one.member_id),
      },
    }
    if (row.visibility === 'open' && audience === 'everyone') {
      env.outbox.push({ memberId: EVERYONE, event })
      return
    }
    const members = yield* all<{ member_id: MemberId }>(
      sql`SELECT member_id FROM debate_members WHERE debate_id = ${row.id}`,
    )
    for (const member of members) env.outbox.push({ memberId: member.member_id, event })
  })

export const limitsOf = (row: DebateRow): Debate['limits'] => ({
  turnsPerAgent: Number(row.turns_per_agent),
  totalTurns: Number(row.total_turns),
  minutes: Number(row.minutes),
  turnCharacters: Number(row.turn_characters),
})

export interface DebateRow {
  readonly id: DebateId
  readonly question: string
  readonly visibility: DebateVisibility
  readonly status: DebateStatus
  readonly created_by: MemberId
  readonly turns_per_agent: number
  readonly total_turns: number
  readonly minutes: number
  readonly turn_characters: number
  readonly created_at: number
  readonly updated_at: number
  readonly deadline_at: number
  readonly concluded_at: number | null
  readonly closed_at: number | null
  readonly result: string | null
  readonly result_by: MemberId | null
  readonly result_at: number | null
  readonly result_round: number
  readonly ended_because: DebateEnding | null
}

export interface ParticipantRow {
  readonly debate_id: DebateId
  readonly member_id: MemberId
  readonly credential_id: CredentialId
  readonly agent_name: string
  readonly created_at: number
}

interface TurnRow {
  readonly position: number
  readonly member_id: MemberId
  readonly agent_name: string
  readonly body: string
  readonly created_at: number
}

/** The stored result passed `DebateResult` when it was drafted. */
const resultOf = (row: DebateRow): Debate['result'] =>
  row.result === null
    ? null
    : {
        result: JSON.parse(row.result) as DebateResult,
        draftedBy: row.result_by!,
        draftedAt: Number(row.result_at),
      }

const numberOrNull = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)
