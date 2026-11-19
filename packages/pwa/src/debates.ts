import { Schema as S } from '@homingbird/kernel'
import {
  DEFAULT_DEBATE_LIMITS,
  type Debate,
  DebateLimits,
  type DebateSummary,
  type MemberId,
  limitsProblem,
  turnsTakenBy,
} from '@homingbird/protocol'

/** Where a room stands for the person looking at it, which decides what the room page offers. */
export type DebateStage =
  | 'gathering'
  | 'debating'
  | 'awaiting-result'
  | 'awaiting-approval'
  | 'closed'
  | 'ended'

export const debateStage = (debate: {
  readonly status: Debate['status']
  readonly participants: ReadonlyArray<unknown>
  readonly result: unknown
}): DebateStage => {
  if (debate.status === 'closed') return 'closed'
  if (debate.status === 'ended') return 'ended'
  if (debate.status === 'concluding') return debate.result === null ? 'awaiting-result' : 'awaiting-approval'
  return debate.participants.length < 2 ? 'gathering' : 'debating'
}

/** The same for a room in the list, which carries counts instead of the room itself. */
export const summaryStage = (summary: DebateSummary): DebateStage =>
  debateStage({
    status: summary.status,
    participants: summary.participantIds.map((memberId) => ({ memberId })),
    result: summary.resultDrafted ? true : null,
  })

/** Whether the viewer's own agent takes part, which makes them one of the people who approve the result. */
export const takesPart = (debate: Pick<Debate, 'participants'>, viewerId: MemberId): boolean =>
  debate.participants.some((participant) => participant.memberId === viewerId)

/** Whether the viewer may still approve or decline the drafted result. */
export const mayDecide = (debate: Debate, viewerId: MemberId): boolean =>
  debateStage(debate) === 'awaiting-approval' &&
  debate.approvals.some((approval) => approval.memberId === viewerId && approval.approvedAt === null)

export const mayOptIn = (debate: Debate, viewerId: MemberId): boolean =>
  debate.status === 'open' && !takesPart(debate, viewerId) && debate.participants.length < 8

export const mayChangeLimits = (debate: Debate, viewerId: MemberId): boolean =>
  debate.status === 'open' && debate.createdBy === viewerId

export const turnsLeftFor = (debate: Debate, memberId: MemberId): number =>
  Math.max(0, debate.limits.turnsPerAgent - turnsTakenBy(debate, memberId))

/** The limits a person typed, each clamped to what a room accepts, or the reason they cannot work. */
export const limitsFrom = (
  typed: Readonly<Record<keyof DebateLimits, string>>,
): { readonly limits: DebateLimits } | { readonly problem: string } => {
  const decoded = DebateLimits.decode(
    Object.fromEntries(
      (Object.keys(LIMIT_BOUNDS) as Array<keyof DebateLimits>).map((name) => {
        const [low, high] = LIMIT_BOUNDS[name]
        const value = Number.parseInt(typed[name], 10)
        return [
          name,
          Number.isNaN(value) ? DEFAULT_DEBATE_LIMITS[name] : Math.min(high, Math.max(low, value)),
        ]
      }),
    ),
  )
  if (decoded._tag === 'Err') return { problem: S.formatIssues(decoded.error) }
  const problem = limitsProblem(decoded.value)
  return problem === null ? { limits: decoded.value } : { problem }
}

export const LIMIT_BOUNDS: Readonly<Record<keyof DebateLimits, readonly [number, number]>> = {
  turnsPerAgent: [1, 20],
  totalTurns: [2, 100],
  minutes: [5, 10_080],
  turnCharacters: [200, 4000],
}

/** Rooms that want something of the viewer first, then the newest. */
export const listedDebates = (rooms: ReadonlyArray<DebateSummary>): DebateSummary[] =>
  [...rooms].sort((a, b) => Number(isUnderWay(b)) - Number(isUnderWay(a)) || b.createdAt - a.createdAt)

/** The member ids a room's export or result mentions, so names can be loaded before they are shown. */
export const peopleIn = (debate: Debate): MemberId[] => [
  ...new Set([debate.createdBy, ...debate.memberIds, ...debate.participants.map((one) => one.memberId)]),
]

const isUnderWay = (room: DebateSummary): boolean => room.status === 'open' || room.status === 'concluding'
