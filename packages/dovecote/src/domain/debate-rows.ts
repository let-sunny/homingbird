import { Task as T } from '@homingbird/kernel'
import {
  type CredentialId,
  DEBATE_GRACE_MINUTES,
  DEFAULT_GRACE_MINUTES,
  type Debate,
  type DebateConclusion,
  type DebateEnding,
  type DebateId,
  type DebateResult,
  type DebateRoom,
  type DebateStage,
  type DebateStatus,
  type DebateVisibility,
  type MemberId,
  NotFound,
  RESULT_DRAFTING_WINDOW_MS,
  RESULT_VOTING_WINDOW_MS,
  type TurnHold,
  askedTurnOf,
  draftedResultOf,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman } from '../environment.ts'
import { EVERYONE, type RequestEnv } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { type Viewer, isVisibleRoom } from './channel-rows.ts'
import { featureIsOn } from './settings.ts'

/** A private room shows to its members, and to an administrator's own sign-in only (rule 6). */
export const visibleDebate = (viewer: Viewer, id: DebateId): T.Task<DebateRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<DebateRow>(sql`SELECT * FROM debates WHERE id = ${id}`)
    if (row === null || !(yield* maySeeDebate(viewer, row)))
      return yield* T.fail(NotFound({ message: 'No such debate room.' }))
    return row
  })

/** The room as every viewer who may see it sees it: nothing in it depends on who asks. */
export const describeDebate = (row: DebateRow): T.Task<Debate, never, AppEnv> =>
  T.map((facts: DebateFacts) => facts.debate)(loadRoom(row))

/** The room as the state machine reads it, with the description it was read from. */
export const loadRoom = (row: DebateRow): T.Task<DebateFacts, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const id = row.id
    const members = yield* all<{ member_id: MemberId }>(
      sql`SELECT member_id FROM debate_members WHERE debate_id = ${id} ORDER BY created_at, member_id`,
    )
    const participants = yield* participantsOf(id)
    const turns = yield* all<TurnRow>(
      sql`SELECT * FROM debate_turns WHERE debate_id = ${id} ORDER BY position`,
    )
    const agents = yield* all<AgentRow>(sql`
      SELECT p.member_id, p.credential_id, c.last_used_at, c.revoked_at, m.status
      FROM debate_participants p JOIN credentials c ON c.id = p.credential_id JOIN members m ON m.id = p.member_id
      WHERE p.debate_id = ${id}`)
    const round = Number(row.result_round)
    const drafts = yield* draftsOf(id, round)
    const votes = yield* votesOf(id, round)
    const limits = limitsOf(row)
    const statedModel = (yield* featureIsOn('noteDetails'))
      ? (stated: { readonly agent_model?: string | null }) => ({ agentModel: stated.agent_model ?? null })
      : () => ({})
    const graceMs = (limits.graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000
    const takingPart = (memberId: MemberId) => {
      const agent = agents.find((one) => one.member_id === memberId)
      return agent !== undefined && isAgentTakingPart(env, agent, graceMs)
    }
    const firstDraftAt = drafts[0] === undefined ? null : Number(drafts[0].created_at)
    const deciding = row.status === 'concluding' && row.result === null
    const debate: Debate = {
      id,
      question: row.question,
      visibility: row.visibility,
      status: row.status,
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
      deadlineAt: Number(row.deadline_at),
      concludedAt: numberOrNull(row.concluded_at),
      concludedBecause: row.concluded_because ?? null,
      closedAt: numberOrNull(row.closed_at),
      endedBecause: row.ended_because,
      limits,
      memberIds: members.map((member) => member.member_id),
      participants: participants.map((participant) => ({
        memberId: participant.member_id,
        agentId: participant.credential_id,
        agentName: participant.agent_name,
        joinedAt: Number(participant.created_at),
        takingPart: takingPart(participant.member_id),
      })),
      turns: turns.map((turn) => ({
        position: Number(turn.position),
        memberId: turn.member_id,
        agentName: turn.agent_name,
        body: turn.body,
        at: Number(turn.created_at),
        ...statedModel(turn),
        afterTurn: numberOrNull(turn.after_turn),
        ...(Number(turn.ready) === 1 && { ready: true }),
      })),
      result: resultOf(row),
      resultRound: Number(row.result_round),
      drafts: drafts.map((draft) => ({
        draftedBy: draft.member_id,
        draftedAt: Number(draft.created_at),
        result: JSON.parse(draft.result) as DebateResult,
        votes: row.result === null ? null : votes.filter((vote) => vote.draft_by === draft.member_id).length,
        ...statedModel(draft),
      })),
      draftsCloseAt:
        deciding && firstDraftAt !== null && row.votes_open_at === null
          ? firstDraftAt + RESULT_DRAFTING_WINDOW_MS
          : null,
      votingClosesAt:
        deciding && row.votes_open_at !== null ? Number(row.votes_open_at) + RESULT_VOTING_WINDOW_MS : null,
      votedBy: votes.map((vote) => vote.voter_id),
      voteRecord:
        row.status === 'closed'
          ? {
              votes: votes.map((vote) => ({
                voterId: vote.voter_id,
                draftBy: vote.draft_by,
                ...statedModel(vote),
              })),
              droppedOut: row.dropped_out === null ? [] : (JSON.parse(row.dropped_out) as MemberId[]),
            }
          : null,
    }
    const room = roomOf(row, debate, votes, env.turnHolds.of(id))
    return { debate: { ...debate, askedTurn: askedTurnOf(room, env.clock.now()) }, room }
  })

/**
 * Its credential made an authenticated request within the grace; holding an event stream alone does not
 * count, since a half-open connection looks held for many minutes. For one grace after this server
 * started everyone takes part. A deactivated account or a revoked credential has dropped out.
 */
export const isAgentTakingPart = (
  env: AppEnv,
  agent: Pick<AgentRow, 'last_used_at' | 'revoked_at' | 'status'>,
  graceMs: number,
): boolean => {
  if (agent.status !== 'active' || agent.revoked_at !== null) return false
  const since = env.clock.now() - graceMs
  if (env.hub.startedAt > since) return true
  return Number(agent.last_used_at ?? 0) >= since
}

/** Each agent's id to its own person only; while drafts are collected, an agent sees only its own. */
const seenBy =
  (caller: Caller) =>
  (debate: Debate): Debate => {
    const viewerId = caller.member.id
    const shown = {
      ...debate,
      participants: debate.participants.map((participant) =>
        participant.memberId === viewerId ? participant : { ...participant, agentId: null },
      ),
    }
    const collecting =
      debate.status === 'concluding' && debate.result === null && debate.votingClosesAt == null
    const drafted = (debate.drafts ?? []).some((draft) => draft.draftedBy === viewerId)
    if (isHuman(caller) || !collecting || drafted) return shown
    return { ...shown, drafts: [] }
  }

/**
 * The room as `seenBy` shows it, with the caller's own note on what their agent may use here: to the person
 * who wrote it and to the agent they opted in, never to another participant, an administrator or another
 * agent of theirs.
 */
export const shownTo =
  (caller: Caller) =>
  (debate: Debate): T.Task<Debate, never, AppEnv> =>
    T.map((own: { readonly brief: string | null } | null) => ({
      ...seenBy(caller)(debate),
      brief: own?.brief ?? null,
    }))(
      first<{ brief: string | null }>(
        isHuman(caller)
          ? sql`SELECT brief FROM debate_participants WHERE debate_id = ${debate.id} AND member_id = ${caller.member.id}`
          : sql`SELECT brief FROM debate_participants WHERE debate_id = ${debate.id} AND credential_id = ${caller.credential.id}`,
      ),
    )

const draftsOf = (id: DebateId, round: number): T.Task<ReadonlyArray<DraftRow>, never, AppEnv> =>
  all<DraftRow>(sql`
    SELECT * FROM debate_drafts WHERE debate_id = ${id} AND round = ${round} ORDER BY created_at, member_id`)

export const isDebateMember = (id: DebateId, memberId: MemberId): T.Task<boolean, never, AppEnv> =>
  T.map((found: unknown) => found !== null)(
    first(sql`SELECT 1 AS present FROM debate_members WHERE debate_id = ${id} AND member_id = ${memberId}`),
  )

const participantsOf = (id: DebateId): T.Task<ReadonlyArray<ParticipantRow>, never, AppEnv> =>
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
 * Takes the room's row lock for the rest of the transaction, changing nothing, so concurrent turns,
 * drafts and votes see each other; it returns the row as it is now.
 */
export const lockedDebate = (id: DebateId): T.Task<DebateRow, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE debates SET updated_at = updated_at WHERE id = ${id}`)
    return (yield* first<DebateRow>(sql`SELECT * FROM debates WHERE id = ${id}`))!
  })

/** Marks the room changed, after a turn, an agent, a draft or a vote was added to it. */
export const touchDebate = (id: DebateId, now: number): T.Task<void, never, AppEnv> =>
  T.asUnit(run(sql`UPDATE debates SET updated_at = ${now} WHERE id = ${id}`))

/** Makes the person a member of the room, once. */
export const enterDebate = (id: DebateId, memberId: MemberId, now: number): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(
      insertIgnoringConflict(yield* dialect, 'debate_members', {
        debate_id: id,
        member_id: memberId,
        created_at: now,
      }),
    )
  })

/**
 * Tells the room's members that it changed, without content; everyone too when an open room opens or
 * ends. A private room is never announced beyond its members.
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

export interface DebateFacts {
  readonly debate: Debate
  readonly room: DebateRoom
}

export interface DebateRow {
  readonly id: DebateId
  readonly question: string
  readonly visibility: DebateVisibility
  readonly status: DebateStatus
  readonly created_by: MemberId
  readonly turns_per_agent: number
  readonly total_turns: number
  readonly total_follows_agents: number | null
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
  readonly concluded_because?: DebateConclusion | null
  readonly votes_open_at: number | null
  readonly grace_minutes: number | null
  readonly dropped_out: string | null
}

export interface DraftRow {
  readonly member_id: MemberId
  readonly credential_id: CredentialId
  readonly result: string
  readonly created_at: number
  readonly agent_model?: string | null
}

export interface VoteRow {
  readonly voter_id: MemberId
  readonly draft_by: MemberId
  readonly created_at: number
  readonly agent_model?: string | null
}

export interface ParticipantRow {
  readonly debate_id: DebateId
  readonly member_id: MemberId
  readonly credential_id: CredentialId
  readonly agent_name: string
  readonly created_at: number
  readonly brief?: string | null
}

interface AgentRow {
  readonly member_id: MemberId
  readonly credential_id: CredentialId
  readonly last_used_at: number | null
  readonly revoked_at: number | null
  readonly status: string
}

interface TurnRow {
  readonly position: number
  readonly member_id: MemberId
  readonly agent_name: string
  readonly body: string
  readonly created_at: number
  readonly agent_model?: string | null
  readonly after_turn?: number | null
  readonly ready?: number | null
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

const roomOf = (
  row: DebateRow,
  debate: Debate,
  votes: ReadonlyArray<VoteRow>,
  holds: ReadonlyArray<TurnHold>,
): DebateRoom => ({
  stage: stageOf(row, debate),
  createdAt: debate.createdAt,
  deadlineAt: debate.deadlineAt,
  askingSince:
    debate.turns.at(-1)?.at ??
    Math.max(debate.createdAt, ...debate.participants.map((participant) => participant.joinedAt)),
  limits: debate.limits,
  participants: debate.participants,
  turns: debate.turns,
  round: debate.resultRound,
  drafts: debate.drafts ?? [],
  votes: votes.map((vote) => ({ voterId: vote.voter_id, draftBy: vote.draft_by })),
  holds,
})

const stageOf = (row: DebateRow, debate: Debate): DebateStage => {
  const concludedAt = Number(row.concluded_at)
  switch (row.status) {
    case 'open':
      return debate.turns.length === 0 ? { stage: 'setup' } : { stage: 'open' }
    case 'concluding':
      if (debate.result !== null)
        return { stage: 'approving', concludedAt, result: draftedResultOf(debate.result)! }
      return row.votes_open_at === null
        ? { stage: 'drafting', concludedAt }
        : { stage: 'voting', concludedAt, votesOpenAt: Number(row.votes_open_at) }
    case 'closed':
      return { stage: 'closed', result: draftedResultOf(debate.result)! }
    default:
      return { stage: 'ended', because: row.ended_because! }
  }
}

const numberOrNull = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

const votesOf = (id: DebateId, round: number): T.Task<ReadonlyArray<VoteRow>, never, AppEnv> =>
  all<VoteRow>(sql`
    SELECT * FROM debate_votes WHERE debate_id = ${id} AND round = ${round} ORDER BY created_at, voter_id`)

const maySeeDebate = (viewer: Viewer, row: Pick<DebateRow, 'id' | 'visibility'>) =>
  isVisibleRoom(row.visibility, viewer) ? T.succeed(true) : isDebateMember(row.id, viewer.id)

const limitsOf = (row: DebateRow): Debate['limits'] => ({
  turnsPerAgent: Number(row.turns_per_agent),
  totalTurns: Number(row.total_turns),
  minutes: Number(row.minutes),
  turnCharacters: Number(row.turn_characters),
  totalFollowsAgents: Number(row.total_follows_agents) === 1,
  graceMinutes:
    DEBATE_GRACE_MINUTES.find((minutes) => minutes === Number(row.grace_minutes)) ?? DEFAULT_GRACE_MINUTES,
})
