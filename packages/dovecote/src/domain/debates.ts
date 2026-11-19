import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type CredentialId,
  DEBATE_PARTICIPANTS_MAX,
  DEFAULT_DEBATE_LIMITS,
  type Debate,
  type DebateAsk,
  DebateId,
  type DebateLimits,
  type DebateSummary,
  type DebateVisibility,
  Forbidden,
  Invalid,
  type MemberId,
  NotFound,
  isAtLimit,
  limitsProblem,
  mayTakeTurn,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, list, sql } from '../sql/query.ts'
import {
  type DebateRow,
  announceDebate,
  describeDebate,
  lockedDebate,
  participantsOf,
  visibleDebate,
} from './debate-rows.ts'
import { conclude, concludeOverdueDebates } from './debate-turns.ts'

export interface DebateWish {
  readonly question: string
  readonly visibility?: DebateVisibility
  readonly limits?: DebateLimits
  readonly memberIds?: ReadonlyArray<MemberId>
}

/** Opens a room for one question. A private room is seen by its creator and the people they invite only. */
export const createDebate = (
  caller: Caller,
  wish: DebateWish,
): T.Task<Debate, Forbidden | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can open a debate room.' }))
    const question = wish.question.trim()
    if (question === '') return yield* T.fail(Invalid({ message: 'A debate room needs a question.' }))
    const limits = wish.limits ?? DEFAULT_DEBATE_LIMITS
    yield* requireUsableLimits(limits)
    const invited = yield* activeMembersAmong((wish.memberIds ?? []).filter((id) => id !== caller.member.id))
    const now = env.clock.now()
    const row: DebateRow = {
      id: DebateId.of(env.random.identifier()),
      question,
      visibility: wish.visibility ?? 'open',
      status: 'open',
      created_by: caller.member.id,
      turns_per_agent: limits.turnsPerAgent,
      total_turns: limits.totalTurns,
      minutes: limits.minutes,
      turn_characters: limits.turnCharacters,
      created_at: now,
      updated_at: now,
      deadline_at: now + limits.minutes * 60_000,
      concluded_at: null,
      closed_at: null,
      result: null,
      result_by: null,
      result_at: null,
      result_round: 0,
      ended_because: null,
    }
    yield* run(insertInto('debates', { ...row }))
    for (const memberId of [caller.member.id, ...invited]) yield* enterDebate(row.id, memberId, now)
    yield* announceDebate(row, 'everyone')
    return yield* describeDebate(row)
  })

/** The rooms the viewer may see, newest first: every open room and the private rooms they are in. */
export const listDebates = (viewerId: MemberId): T.Task<DebateSummary[], never, RequestEnv> =>
  T.gen(function* () {
    yield* concludeOverdueDebates
    const rows = yield* all<DebateRow & { joined: number | null; turn_count: number }>(sql`
      SELECT d.*, m.member_id IS NOT NULL AS joined,
        (SELECT COUNT(*) FROM debate_turns t WHERE t.debate_id = d.id) AS turn_count
      FROM debates d LEFT JOIN debate_members m ON m.debate_id = d.id AND m.member_id = ${viewerId}
      WHERE d.visibility = 'open' OR m.member_id IS NOT NULL
      ORDER BY d.created_at DESC, d.id LIMIT ${LISTED_ROOMS}`)
    if (rows.length === 0) return []
    const participants = yield* all<{ debate_id: DebateId; member_id: MemberId }>(sql`
      SELECT debate_id, member_id FROM debate_participants WHERE debate_id IN ${list(rows.map((row) => row.id))}
      ORDER BY created_at, member_id`)
    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      visibility: row.visibility,
      status: row.status,
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
      deadlineAt: Number(row.deadline_at),
      participantIds: participants.filter((one) => one.debate_id === row.id).map((one) => one.member_id),
      turnCount: Number(row.turn_count),
      resultDrafted: row.result !== null,
      joined: Boolean(Number(row.joined)),
    }))
  })

export const debateFor = (viewerId: MemberId, id: DebateId): T.Task<Debate, NotFound, RequestEnv> =>
  T.gen(function* () {
    yield* concludeOverdueDebates
    return yield* describeDebate(yield* visibleDebate(viewerId, id))
  })

/** Opts the person's own connected agent in; it joins the room and may take turns there, never elsewhere. */
export const optInAgent = (
  caller: Caller,
  id: DebateId,
  agentId: CredentialId,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(
        Forbidden({ message: 'Only a person can opt their agent in; an agent never joins by itself.' }),
      )
    const now = env.clock.now()
    yield* concludeOverdueDebates
    yield* visibleDebate(caller.member.id, id)
    const agentName = yield* ownAgentName(caller.member.id, agentId, now)
    const row = yield* lockedDebate(id, now)
    if (row.status !== 'open') return yield* T.fail(Conflict({ message: 'This room takes no more agents.' }))
    const participants = yield* participantsOf(id)
    if (participants.some((one) => one.member_id === caller.member.id))
      return yield* T.fail(Conflict({ message: 'Your agent already takes part in this room.' }))
    if (participants.length >= DEBATE_PARTICIPANTS_MAX)
      return yield* T.fail(Conflict({ message: `A room holds at most ${DEBATE_PARTICIPANTS_MAX} agents.` }))
    yield* enterDebate(id, caller.member.id, now)
    yield* run(
      insertInto('debate_participants', {
        debate_id: id,
        member_id: caller.member.id,
        credential_id: agentId,
        agent_name: agentName,
        created_at: now,
      }),
    )
    yield* announceDebate(row)
    return yield* describeDebate(row)
  })

/** Changes the limits while the room is open; only the person who opened it may. */
export const setDebateLimits = (
  caller: Caller,
  id: DebateId,
  limits: DebateLimits,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can set a room’s limits.' }))
    const now = env.clock.now()
    yield* concludeOverdueDebates
    yield* visibleDebate(caller.member.id, id)
    const row = yield* lockedDebate(id, now)
    if (row.created_by !== caller.member.id)
      return yield* T.fail(
        Forbidden({ message: 'Only the person who opened this room can change its limits.' }),
      )
    if (row.status !== 'open') return yield* T.fail(Conflict({ message: 'This room no longer takes turns.' }))
    yield* requireUsableLimits(limits)
    const changed: DebateRow = {
      ...row,
      turns_per_agent: limits.turnsPerAgent,
      total_turns: limits.totalTurns,
      minutes: limits.minutes,
      turn_characters: limits.turnCharacters,
      deadline_at: Number(row.created_at) + limits.minutes * 60_000,
    }
    yield* run(sql`
      UPDATE debates SET turns_per_agent = ${changed.turns_per_agent}, total_turns = ${changed.total_turns},
      minutes = ${changed.minutes}, turn_characters = ${changed.turn_characters}, deadline_at = ${changed.deadline_at}
      WHERE id = ${id}`)
    if (isAtLimit(yield* describeDebate(changed), now)) return yield* conclude(changed, 'limit')
    yield* announceDebate(row)
    return yield* describeDebate(changed)
  })

/** What the rooms ask of the calling agent: a turn where it may take one, the result where none is drafted. */
export const debateAsks = (caller: Caller): T.Task<DebateAsk[], never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (isHuman(caller)) return []
    yield* concludeOverdueDebates
    const rows = yield* all<DebateRow & { member_id: MemberId }>(sql`
      SELECT d.*, p.member_id FROM debates d JOIN debate_participants p ON p.debate_id = d.id
      WHERE p.credential_id = ${caller.credential.id}
      AND (d.status = 'open' OR (d.status = 'concluding' AND d.result IS NULL))
      ORDER BY d.created_at, d.id`)
    const asks: DebateAsk[] = []
    for (const row of rows) {
      const debate = yield* describeDebate(row)
      if (debate.status === 'concluding') asks.push({ debate, ask: 'result' })
      else if (mayTakeTurn(debate, row.member_id, env.clock.now())) asks.push({ debate, ask: 'turn' })
    }
    return asks
  })

const LISTED_ROOMS = 100

const requireUsableLimits = (limits: DebateLimits): T.Task<void, Invalid> => {
  const problem = limitsProblem(limits)
  return problem === null ? T.unit : T.fail(Invalid({ message: problem }))
}

const enterDebate = (id: DebateId, memberId: MemberId, now: number): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(
      insertIgnoringConflict(yield* dialect, 'debate_members', {
        debate_id: id,
        member_id: memberId,
        created_at: now,
      }),
    )
  })

const activeMembersAmong = (ids: ReadonlyArray<MemberId>): T.Task<MemberId[], Invalid, RequestEnv> =>
  T.gen(function* () {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    const found = yield* all<{ id: MemberId }>(
      sql`SELECT id FROM members WHERE status = 'active' AND id IN ${list(unique)}`,
    )
    if (found.length !== unique.length)
      return yield* T.fail(Invalid({ message: 'Invite active members only.' }))
    return unique
  })

const ownAgentName = (
  memberId: MemberId,
  agentId: CredentialId,
  now: number,
): T.Task<string, NotFound, RequestEnv> =>
  T.gen(function* () {
    const agent = yield* first<{ name: string }>(sql`
      SELECT name FROM credentials WHERE id = ${agentId} AND member_id = ${memberId} AND kind = 'agent'
      AND revoked_at IS NULL AND expires_at > ${now}`)
    if (agent === null) return yield* T.fail(NotFound({ message: 'No such connected agent.' }))
    return agent.name
  })
