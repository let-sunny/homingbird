import { Schema as S } from '@homingbird/kernel'
import {
  type AsRead,
  DEBATE_GRACE_MINUTES,
  DEFAULT_DEBATE_LIMITS,
  DEFAULT_GRACE_MINUTES,
  type DebateGraceMinutes,
  type DebateLimits,
  DebateLimitsWish,
  type MemberId,
  TURNS_PER_AGENT_OFFERED,
  UNKNOWN,
  limitsFor,
  limitsProblem,
  turnsTakenBy,
} from '@homingbird/protocol'

/** Where a room stands for the person looking at it, which decides what the room page offers. */
export type DebateStage =
  | 'gathering'
  | 'debating'
  | 'waiting-for-agent'
  | 'awaiting-result'
  | 'voting'
  | 'closed'
  | 'ended'
  | 'unknown'

export const debateStage = (debate: {
  readonly status: AsRead.Debate['status']
  readonly participants: ReadonlyArray<unknown>
  readonly result: unknown
  readonly votingClosesAt?: number | null | undefined
}): DebateStage => {
  if (debate.status === 'closed') return 'closed'
  if (debate.status === 'ended') return 'ended'
  if (debate.status === 'concluding') return debate.votingClosesAt == null ? 'awaiting-result' : 'voting'
  if (debate.status === 'unknown') return 'unknown'
  return debate.participants.length < 2 ? 'gathering' : 'debating'
}

/** The same for a room in the list, which carries counts instead of the room itself. */
export const summaryStage = (summary: AsRead.DebateSummary): DebateStage =>
  debateStage({
    status: summary.status,
    participants: summary.participantIds.map((memberId) => ({ memberId })),
    result: summary.resultDrafted ? true : null,
  })

/** A room as the list shows it: debating only while a taking-part agent is awake to take a turn. */
export const listedStage = (
  summary: AsRead.DebateSummary,
  agentAwake: (memberId: MemberId) => boolean,
): DebateStage => {
  const stage = summaryStage(summary)
  return stage === 'debating' && !summary.participantIds.some(agentAwake) ? 'waiting-for-agent' : stage
}

/** Whether the viewer's own agent was opted in for the room. */
export const takesPart = (debate: Pick<AsRead.Debate, 'participants'>, viewerId: MemberId): boolean =>
  debate.participants.some((participant) => participant.memberId === viewerId)

/** Whether the viewer's agent took a turn, which lets them post the settled result as a note of theirs. */
export const tookATurn = (debate: Pick<AsRead.Debate, 'turns'>, viewerId: MemberId): boolean =>
  debate.turns.some((turn) => turn.memberId === viewerId)

export const mayOptIn = (debate: AsRead.Debate, viewerId: MemberId): boolean =>
  debate.status === 'open' && !takesPart(debate, viewerId) && debate.participants.length < 8

/** Limits are set at setup: only before the first turn, by the person who opened the room. */
export const mayChangeLimits = (debate: AsRead.Debate, viewerId: MemberId): boolean =>
  debate.status === 'open' && debate.createdBy === viewerId && debate.turns.length === 0

/** The room's drafts with the chosen one marked, once the agents chose it. */
export const draftsOf = (
  debate: AsRead.Debate,
): ReadonlyArray<{
  readonly draft: NonNullable<AsRead.Debate['drafts']>[number]
  readonly chosen: boolean
}> =>
  (debate.drafts ?? []).map((draft) => ({
    draft,
    chosen: debate.result !== null && debate.result.draftedBy === draft.draftedBy,
  }))

export const turnsLeftFor = (debate: AsRead.Debate, memberId: MemberId): number =>
  Math.max(0, debate.limits.turnsPerAgent - turnsTakenBy(debate, memberId))

/**
 * The limits a person typed, each clamped to what a room accepts, or the reason they cannot work. A total
 * left empty follows the agents opted in.
 */
export const limitsFrom = (
  typed: Readonly<Record<NumberLimit, string>> & { readonly graceMinutes?: string },
): { readonly limits: DebateLimitsWish } | { readonly problem: string } => {
  const decoded = DebateLimitsWish.decode({
    ...Object.fromEntries(
      (Object.keys(LIMIT_BOUNDS) as Array<NumberLimit>).flatMap((name) => {
        const [low, high] = LIMIT_BOUNDS[name]
        const value = Number.parseInt(typed[name], 10)
        if (!Number.isNaN(value)) return [[name, Math.min(high, Math.max(low, value))]]
        return name === 'totalTurns' ? [] : [[name, DEFAULT_DEBATE_LIMITS[name]]]
      }),
    ),
    graceMinutes: graceFrom(typed.graceMinutes),
  })
  if (decoded._tag === 'Err') return { problem: S.formatIssues(decoded.error) }
  const problem = limitsProblem(limitsFor(decoded.value, 0))
  return problem === null ? { limits: decoded.value } : { problem }
}

/** The limits typed as numbers; the grace is chosen among `DEBATE_GRACE_MINUTES` instead. */
export type NumberLimit = Exclude<keyof DebateLimits, 'graceMinutes' | 'totalFollowsAgents'>

/** The most turns per agent offered is 4: in real rooms nothing new appeared after an agent's fourth turn. */
export const LIMIT_BOUNDS: Readonly<Record<NumberLimit, readonly [number, number]>> = {
  turnsPerAgent: [1, TURNS_PER_AGENT_OFFERED],
  totalTurns: [2, 100],
  minutes: [5, 10_080],
  turnCharacters: [200, 4000],
}

/** The room's grace, the default when it says none or one this client does not know. */
export const graceOf = (limits: {
  readonly graceMinutes?: AsRead.Debate['limits']['graceMinutes'] | undefined
}): DebateGraceMinutes =>
  limits.graceMinutes === undefined || limits.graceMinutes === UNKNOWN
    ? DEFAULT_GRACE_MINUTES
    : limits.graceMinutes

/** Rooms that want something of the viewer first, then the newest. */
export const listedDebates = (rooms: ReadonlyArray<AsRead.DebateSummary>): AsRead.DebateSummary[] =>
  [...rooms].sort((a, b) => Number(isUnderWay(b)) - Number(isUnderWay(a)) || b.createdAt - a.createdAt)

/** The member ids a room's export or result mentions, so names can be loaded before they are shown. */
export const peopleIn = (debate: AsRead.Debate): MemberId[] => [
  ...new Set([debate.createdBy, ...debate.memberIds, ...debate.participants.map((one) => one.memberId)]),
]

/**
 * The vote record of a closed room as lines: each agent's vote, then each agent that dropped out or did
 * not vote in time; none when the result was the only draft and nobody voted.
 */
export const voteRecordLines = (
  debate: Pick<AsRead.Debate, 'participants' | 'voteRecord' | 'drafts'>,
): ReadonlyArray<VoteRecordLine> => {
  const record = debate.voteRecord ?? { votes: [], droppedOut: [] }
  if (record.votes.length === 0 && (debate.drafts ?? []).length <= 1) return []
  return [
    ...record.votes.map((vote) => ({
      kind: 'voted' as const,
      memberId: vote.voterId,
      draftBy: vote.draftBy,
      agentModel: vote.agentModel,
    })),
    ...debate.participants
      .map((one) => one.memberId)
      .filter((id) => !record.votes.some((vote) => vote.voterId === id))
      .map((memberId) => ({
        kind: record.droppedOut.includes(memberId) ? ('dropped-out' as const) : ('silent' as const),
        memberId,
        draftBy: null,
      })),
  ]
}

export interface VoteRecordLine {
  readonly kind: 'voted' | 'dropped-out' | 'silent'
  readonly memberId: MemberId
  readonly draftBy: MemberId | null
  /** What the voter stated about its model; absent while the organization keeps note details off. */
  readonly agentModel?: string | null | undefined
}

const graceFrom = (typed: string | undefined): DebateGraceMinutes =>
  DEBATE_GRACE_MINUTES.find((minutes) => String(minutes) === typed) ?? DEFAULT_GRACE_MINUTES

const isUnderWay = (room: AsRead.DebateSummary): boolean =>
  room.status === 'open' || room.status === 'concluding'
