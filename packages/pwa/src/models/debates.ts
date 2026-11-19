import { type AsRead, DEBATE_GRACE_MINUTES, type MemberId } from '@homingbird/protocol'
import {
  LIMIT_BOUNDS,
  type NumberLimit,
  graceOf,
  limitsFrom,
  listedDebates,
  listedStage,
} from '../debates.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { type TimeShown, timeShown } from './time.ts'

/** Debate rooms: loading, none yet, or the rooms that want something first, then the newest. */
export const debateListModel = (input: DebateListInput): DebateListModel => {
  if (!input.loaded) return { kind: 'loading' }
  if (input.debates.length === 0) return { kind: 'empty', text: strings.debates.empty }
  const awake = new Set(
    input.directory.filter((entry) => entry.presence.agentOnline).map((entry) => entry.member.id as string),
  )
  return {
    kind: 'rooms',
    rooms: listedDebates(input.debates).map((summary) => {
      const stage = listedStage(summary, (memberId) => awake.has(memberId))
      return {
        id: summary.id,
        className: `debate-card is-${stage}`,
        href: hrefFor({ name: 'debate', id: summary.id }),
        question: summary.question,
        stage: strings.debates.stage[stage],
        isPrivate: summary.visibility === 'private',
        counts: [
          strings.debates.agentCount({ count: summary.participantIds.length }),
          strings.debates.turnCount({ count: summary.turnCount }),
        ],
        time: timeShown(summary.createdAt, input.now),
      }
    }),
  }
}

/** The four limits as number fields and the grace as a choice, filled with the given values. */
export const limitFieldsModel = (limits: AsRead.Debate['limits']): LimitFieldsModel => ({
  numbers: (Object.keys(LIMIT_BOUNDS) as Array<NumberLimit>).map((name) => ({
    name,
    label: strings.debates[name],
    min: LIMIT_BOUNDS[name][0],
    max: LIMIT_BOUNDS[name][1],
    value: limits[name],
  })),
  grace: DEBATE_GRACE_MINUTES.map((minutes) => ({
    value: minutes,
    label: strings.debates.graceChoice({ minutes }),
    selected: minutes === graceOf(limits),
  })),
})

/** The limits typed into the limit fields, or the reason they cannot be used. */
export const typedLimits = (read: (name: NumberLimit | 'graceMinutes') => string) =>
  limitsFrom({
    ...(Object.fromEntries(
      (Object.keys(LIMIT_BOUNDS) as Array<NumberLimit>).map((name) => [name, read(name)]),
    ) as Record<NumberLimit, string>),
    graceMinutes: read('graceMinutes'),
  })

/** The colleagues who may be invited to a new room: everyone but the person. */
export const inviteesFor = (
  directory: ReadonlyArray<AsRead.DirectoryEntry>,
  viewerId: MemberId,
): ReadonlyArray<{ readonly value: MemberId; readonly label: string }> =>
  directory
    .filter((entry) => entry.member.id !== viewerId)
    .map((entry) => ({ value: entry.member.id, label: entry.member.name }))

export interface DebateListInput {
  readonly debates: ReadonlyArray<AsRead.DebateSummary>
  readonly loaded: boolean
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly now: number
}

export type DebateListModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly text: string }
  | { readonly kind: 'rooms'; readonly rooms: ReadonlyArray<DebateCard> }

export interface DebateCard {
  readonly id: string
  readonly className: string
  readonly href: string
  readonly question: string
  readonly stage: string
  readonly isPrivate: boolean
  readonly counts: ReadonlyArray<string>
  readonly time: TimeShown
}

export interface LimitFieldsModel {
  readonly numbers: ReadonlyArray<{
    readonly name: NumberLimit
    readonly label: string
    readonly min: number
    readonly max: number
    readonly value: number
  }>
  readonly grace: ReadonlyArray<{
    readonly value: number
    readonly label: string
    readonly selected: boolean
  }>
}
