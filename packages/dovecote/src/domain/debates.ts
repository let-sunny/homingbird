import { Task as T } from '@homingbird/kernel'
import {
  type Conflict,
  type Contract,
  type CredentialId,
  DEFAULT_DEBATE_LIMITS,
  DEFAULT_GRACE_MINUTES,
  type Debate,
  type DebateAsk,
  type DebateEnding,
  DebateId,
  type DebateLimits,
  type DebateLimitsWish,
  type DebateSummary,
  type DebateVisibility,
  Forbidden,
  Invalid,
  type MemberId,
  NotFound,
  RESULT_WINDOW_MS,
  type ResponseOf,
  askOf,
  limitsFor,
  limitsProblem,
} from '@homingbird/protocol'
import { type Caller, isHuman, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { type Viewer, isVisibleRoom } from './channel-rows.ts'
import {
  type DebateRow,
  announceDebate,
  describeDebate,
  enterDebate,
  isDebateMember,
  loadRoom,
  lockedDebate,
  visibleDebate,
} from './debate-rows.ts'
import { moveDebate } from './debate-settling.ts'
import { settleDebate } from './debate-turns.ts'

export interface DebateWish {
  readonly question: string
  readonly visibility?: DebateVisibility
  readonly limits?: DebateLimitsWish
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
    const limits = limitsFor(wish.limits ?? DEFAULT_DEBATE_LIMITS, 0)
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
      total_follows_agents: limits.totalFollowsAgents === true ? 1 : null,
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
      votes_open_at: null,
      grace_minutes: limits.graceMinutes ?? DEFAULT_GRACE_MINUTES,
      dropped_out: null,
    }
    yield* run(insertInto('debates', { ...row }))
    for (const memberId of [caller.member.id, ...invited]) yield* enterDebate(row.id, memberId, now)
    yield* announceDebate(row, 'everyone')
    return yield* describeDebate(row)
  })

/**
 * The rooms the viewer may see, newest first: every open room and the private rooms they are in, and for
 * an administrator's own sign-in every private room too, as with channels. Statuses are as the
 * background pass left them, at most a minute ago.
 */
export const listDebates = (viewer: Viewer): T.Task<DebateSummary[], never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<DebateRow & { joined: number | null; turn_count: number }>(sql`
      SELECT d.*, m.member_id IS NOT NULL AS joined,
        (SELECT COUNT(*) FROM debate_turns t WHERE t.debate_id = d.id) AS turn_count
      FROM debates d LEFT JOIN debate_members m ON m.debate_id = d.id AND m.member_id = ${viewer.id}
      WHERE ${isVisibleRoom('private', viewer) ? sql`1 = 1` : sql`d.visibility = 'open' OR m.member_id IS NOT NULL`}
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
      totalTurns: Number(row.total_turns),
      resultDrafted: row.result !== null,
      joined: Boolean(Number(row.joined)),
    }))
  })

export const debateFor = (viewer: Viewer, id: DebateId): T.Task<Debate, NotFound, RequestEnv> =>
  T.gen(function* () {
    yield* visibleDebate(viewer, id)
    yield* settleDebate(id)
    return yield* describeDebate(yield* visibleDebate(viewer, id))
  })

/** Opts the person's own connected agent in; it joins the room and may take turns there, never elsewhere. */
export const optInAgent = (
  caller: Caller,
  id: DebateId,
  agentId: CredentialId,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(
        Forbidden({ message: 'Only a person can opt their agent in; an agent never joins by itself.' }),
      )
    const now = env.clock.now()
    const visible = yield* visibleDebate(viewerOf(caller), id)
    if (visible.visibility === 'private' && !(yield* isDebateMember(id, caller.member.id)))
      return yield* T.fail(
        Forbidden({ message: 'Only people invited to a private room can opt their agent in.' }),
      )
    const agentName = yield* ownAgentName(caller.member.id, agentId, now)
    yield* moveDebate(
      yield* lockedDebate(id),
      { type: 'join', memberId: caller.member.id },
      { credentialId: agentId, agentName },
    )
    return yield* describeDebate(yield* lockedDebate(id))
  })

/** Changes the limits at setup, before the first turn; only the person who opened the room may. */
export const setDebateLimits = (
  caller: Caller,
  id: DebateId,
  limits: DebateLimitsWish,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can set a room’s limits.' }))
    yield* visibleDebate(viewerOf(caller), id)
    const row = yield* lockedDebate(id)
    if (row.created_by !== caller.member.id)
      return yield* T.fail(
        Forbidden({ message: 'Only the person who opened this room can change its limits.' }),
      )
    yield* moveDebate(row, { type: 'setLimits', limits })
    return yield* describeDebate(yield* lockedDebate(id))
  })

/**
 * What the rooms ask of the calling agent: a turn where it may take one, a draft of the result while the
 * room collects drafts and it has not drafted, and as ballots the rooms whose drafts it is asked to vote
 * on; and, so it learns why they stopped asking, its rooms that closed in the last day because agents
 * dropped out. The route moves this agent's own rooms on first, each in a transaction of its own.
 */
export const debateAsks = (caller: Caller): T.Task<DebateAsks, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (isHuman(caller)) return { asks: [], ballots: [], ended: [] }
    const ended = yield* all<{ id: DebateId; ended_because: DebateEnding; closed_at: number }>(sql`
      SELECT d.id, d.ended_because, d.closed_at FROM debates d
      JOIN debate_participants p ON p.debate_id = d.id
      WHERE p.credential_id = ${caller.credential.id} AND d.status = 'ended'
      AND d.ended_because IN ('one_agent_left', 'no_agent_left') AND d.closed_at >= ${env.clock.now() - RESULT_WINDOW_MS}
      ORDER BY d.closed_at, d.id`)
    const rows = yield* all<DebateRow & { member_id: MemberId }>(sql`
      SELECT d.*, p.member_id FROM debates d JOIN debate_participants p ON p.debate_id = d.id
      WHERE p.credential_id = ${caller.credential.id}
      AND (d.status = 'open' OR (d.status = 'concluding' AND d.result IS NULL))
      ORDER BY d.created_at, d.id`)
    const asks: DebateAsk[] = []
    const ballots: Debate[] = []
    for (const row of rows) {
      const { debate, room } = yield* loadRoom(row)
      const ask = askOf(room, row.member_id, env.clock.now())
      if (ask === 'ballot') ballots.push(debate)
      else if (ask !== null) asks.push({ debate, ask })
    }
    return {
      asks,
      ballots,
      ended: ended.map((row) => ({
        id: row.id,
        endedBecause: row.ended_because,
        closedAt: Number(row.closed_at),
      })),
    }
  })

export type DebateAsks = Required<ResponseOf<Contract['debates.waiting']>>

const LISTED_ROOMS = 100

const requireUsableLimits = (limits: DebateLimits): T.Task<void, Invalid> => {
  const problem = limitsProblem(limits)
  return problem === null ? T.unit : T.fail(Invalid({ message: problem }))
}

const activeMembersAmong = (ids: ReadonlyArray<MemberId>): T.Task<MemberId[], Invalid, RequestEnv> =>
  T.gen(function* () {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    const found = yield* all<{ id: MemberId }>(
      sql`SELECT id FROM members WHERE status = 'active' AND kind = 'person' AND id IN ${list(unique)}`,
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
