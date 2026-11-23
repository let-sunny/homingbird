import { Schema as S } from '@homingbird/kernel'
import { DEBATE_BRIEF_MAX } from './debates.ts'
import { CredentialId, MemberId, type Timestamp } from './ids.ts'

/** A room a person opened themself is always within the people they chose. */
export const mayJoinByDelegation = (delegation: SchedulingDelegation, meeting: DelegatedMeeting): boolean =>
  delegation.autoJoin && isWithinPeopleAndLength(delegation.scope, meeting)

export const mayAddByDelegation = (
  delegation: SchedulingDelegation,
  meeting: DelegatedMeeting & { readonly startsAt: Timestamp },
): boolean =>
  delegation.autoAdd &&
  isWithinPeopleAndLength(delegation.scope, meeting) &&
  (delegation.scope.hours === null ||
    isWithinHours(delegation.scope.hours, meeting.startsAt, meeting.minutes))

export const delegationChanges = (
  before: SchedulingDelegation,
  after: SchedulingDelegation,
): Array<(typeof DELEGATION_FIELDS)[number]> => {
  const partsOf = (delegation: SchedulingDelegation) => ({
    autoJoin: delegation.autoJoin,
    autoAdd: delegation.autoAdd,
    agentId: delegation.agentId,
    brief: delegation.brief,
    ...delegation.scope,
  })
  const was = partsOf(before)
  const is = partsOf(after)
  return DELEGATION_FIELDS.filter((field) => JSON.stringify(was[field]) !== JSON.stringify(is[field]))
}

export const minuteOfDayIn = (timeZone: string, at: Timestamp): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at)
  const valueOf = (type: 'hour' | 'minute') => Number(parts.find((part) => part.type === type)?.value)
  return valueOf('hour') * 60 + valueOf('minute')
}

export const isTimeZone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

export const DELEGATION_PEOPLE_MAX = 200

export const DELEGATION_FIELDS = [
  'autoJoin',
  'autoAdd',
  'agentId',
  'brief',
  'people',
  'hours',
  'maxMinutes',
] as const

export const MinuteOfDay = S.int({ min: 0, max: 24 * 60 - 1 })

/** The hours of a day, in the person's own time zone, a meeting must fit; `to` before `from` spans midnight. */
export const DelegationHours = S.closed(
  S.struct({
    from: MinuteOfDay,
    to: MinuteOfDay,
    timeZone: S.refine<string>(
      'time-zone',
      isTimeZone,
      'expected a time zone such as Asia/Seoul',
    )(S.string({ minLength: 1, maxLength: 64 })),
  }),
)
export type DelegationHours = S.Infer<typeof DelegationHours>

/** Null is no limit. `people` opened the rooms it covers; `hours` bound only the meetings it adds. */
export const DelegationScope = S.closed(
  S.struct({
    people: S.nullable(S.array(MemberId, { minItems: 1, maxItems: DELEGATION_PEOPLE_MAX })),
    hours: S.nullable(DelegationHours),
    maxMinutes: S.nullable(S.int({ min: 15, max: 480 })),
  }),
)
export type DelegationScope = S.Infer<typeof DelegationScope>

/** Set and read in the web client only. `agentId` null uses the agent that drafted most recently. */
export const SchedulingDelegation = S.closed(
  S.struct({
    autoJoin: S.boolean,
    autoAdd: S.boolean,
    agentId: S.nullable(CredentialId),
    brief: S.string({ maxLength: DEBATE_BRIEF_MAX }),
    scope: DelegationScope,
  }),
)
export type SchedulingDelegation = S.Infer<typeof SchedulingDelegation>

export const SchedulingDelegationView = S.struct({
  delegation: SchedulingDelegation,
  agentInUse: S.nullable(CredentialId),
})
export type SchedulingDelegationView = S.Infer<typeof SchedulingDelegationView>

/** On until the person turns it off, with no limit: finding a time should take nobody's effort. */
export const DEFAULT_SCHEDULING_DELEGATION: SchedulingDelegation = {
  autoJoin: true,
  autoAdd: true,
  agentId: null,
  brief: '',
  scope: { people: null, hours: null, maxMinutes: null },
}

export interface DelegatedMeeting {
  readonly memberId: MemberId
  readonly openedBy: MemberId
  readonly minutes: number
}

const isWithinPeopleAndLength = (scope: DelegationScope, meeting: DelegatedMeeting): boolean =>
  (scope.people === null ||
    meeting.openedBy === meeting.memberId ||
    scope.people.includes(meeting.openedBy)) &&
  (scope.maxMinutes === null || meeting.minutes <= scope.maxMinutes)

const isWithinHours = (hours: DelegationHours, startsAt: Timestamp, minutes: number): boolean => {
  const span = (hours.to - hours.from + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES
  const offset = (minuteOfDayIn(hours.timeZone, startsAt) - hours.from + DAY_MINUTES) % DAY_MINUTES
  return offset + minutes <= span
}

const DAY_MINUTES = 24 * 60
