import {
  type AsRead,
  CredentialId,
  MemberId,
  type SchedulingDelegation,
  type SchedulingDelegationView,
  isPerson,
} from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * "Your agent and meetings" in Settings: whether the agent joins scheduling rooms and adds settled
 * meetings for the person, which agent does it, and the limits that narrow it. It starts on with no
 * limit, so the first thing shown is that it is on and how to change it.
 */
export const schedulingSettingsModel = (input: SchedulingSettingsInput): SchedulingSettingsModel => {
  const view = input.view
  if (view === 'failed') return { kind: 'failed', text: strings.loadFailed }
  if (view === null) return { kind: 'loading' }
  const { delegation } = view
  const { scope } = delegation
  const inUse = input.agents.find((agent) => agent.id === view.agentInUse)
  const hours = scope.hours
  const chosen = scope.people ?? []
  return {
    kind: 'ready',
    title: strings.scheduling.delegation.title,
    summary: [
      strings.scheduling.delegation.summary[summaryKey(delegation)],
      isLimited(delegation) ? strings.scheduling.delegation.limited : null,
    ].filter((line): line is string => line !== null),
    join: {
      checked: delegation.autoJoin,
      label: strings.scheduling.delegation.join,
      hint: strings.scheduling.delegation.joinHint,
    },
    add: {
      checked: delegation.autoAdd,
      label: strings.scheduling.delegation.add,
      hint: strings.scheduling.delegation.addHint,
    },
    agentLine:
      inUse === undefined
        ? strings.scheduling.delegation.agentNone
        : strings.scheduling.delegation.agentInUse({ name: inUse.name }),
    agentChoices: [
      { value: '', label: strings.scheduling.delegation.agentAutomatic },
      ...input.agents.map((agent) => ({ value: agent.id as string, label: agent.name })),
    ].map((choice) => ({ ...choice, selected: choice.value === (delegation.agentId ?? '') })),
    people: {
      limited: scope.people !== null,
      choices: input.directory
        .filter((entry) => isPerson(entry.member) && entry.member.id !== input.me.member.id)
        .filter((entry) => entry.member.status === 'active' || chosen.includes(entry.member.id))
        .map((entry) => ({
          value: entry.member.id as string,
          label: entry.member.name,
          checked: chosen.includes(entry.member.id),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    hours: {
      limited: hours !== null,
      from: timeOfDay(hours?.from ?? DEFAULT_FROM),
      to: timeOfDay(hours?.to ?? DEFAULT_TO),
      zoneNote:
        hours !== null && hours.timeZone !== input.timeZone
          ? strings.scheduling.delegation.hoursSavedZone({ saved: hours.timeZone, timeZone: input.timeZone })
          : strings.scheduling.delegation.hoursZone({ timeZone: input.timeZone }),
    },
    maxMinutes: {
      limited: scope.maxMinutes !== null,
      choices: lengthChoices(scope.maxMinutes).map((minutes) => ({
        value: minutes,
        label: strings.scheduling.lengthChoice({ minutes }),
        selected: minutes === (scope.maxMinutes ?? DEFAULT_MAX_MINUTES),
      })),
    },
    brief: delegation.brief,
  }
}

/** The delegation a saved form asks for, or the reason it cannot be saved. */
export const delegationFrom = (
  typed: TypedDelegation,
  before: SchedulingDelegation,
  timeZone: string,
): { readonly delegation: SchedulingDelegation } | { readonly problem: string } => {
  const people = [...new Set(typed.people)].filter((id): id is MemberId => MemberId.is(id))
  if (typed.peopleLimited && people.length === 0)
    return { problem: strings.scheduling.delegation.problems.noPeople }
  const from = minutesOf(typed.from)
  const to = minutesOf(typed.to)
  const hours = from !== null && to !== null ? { from, to, timeZone } : null
  if (typed.hoursLimited && hours === null) return { problem: strings.scheduling.delegation.problems.noHours }
  return {
    delegation: {
      autoJoin: typed.autoJoin,
      autoAdd: typed.autoAdd,
      agentId: typed.agentId === null ? before.agentId : agentIdFrom(typed.agentId),
      brief: typed.brief.trim(),
      scope: {
        people: typed.peopleLimited ? people : null,
        hours: typed.hoursLimited ? hours : null,
        maxMinutes: typed.maxLimited ? lengthFrom(typed.maxMinutes) : null,
      },
    },
  }
}

export interface SchedulingSettingsInput {
  readonly me: AsRead.Me
  readonly view: SchedulingDelegationView | 'failed' | null
  readonly agents: ReadonlyArray<AsRead.Credential>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  /** The browser's own IANA time zone. */
  readonly timeZone: string
}

export interface TypedDelegation {
  readonly autoJoin: boolean
  readonly autoAdd: boolean
  /** The agent chosen, empty for automatic, or null when the person did not open the choice. */
  readonly agentId: string | null
  readonly peopleLimited: boolean
  readonly people: ReadonlyArray<string>
  readonly hoursLimited: boolean
  /** A time of day as the browser writes it, such as 09:30. */
  readonly from: string
  readonly to: string
  readonly maxLimited: boolean
  readonly maxMinutes: string
  readonly brief: string
}

export type SchedulingSettingsModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly text: string }
  | {
      readonly kind: 'ready'
      readonly title: string
      readonly summary: ReadonlyArray<string>
      readonly join: Switch
      readonly add: Switch
      readonly agentLine: string
      readonly agentChoices: ReadonlyArray<{
        readonly value: string
        readonly label: string
        readonly selected: boolean
      }>
      readonly people: {
        readonly limited: boolean
        readonly choices: ReadonlyArray<{
          readonly value: string
          readonly label: string
          readonly checked: boolean
        }>
      }
      readonly hours: {
        readonly limited: boolean
        readonly from: string
        readonly to: string
        readonly zoneNote: string
      }
      readonly maxMinutes: {
        readonly limited: boolean
        readonly choices: ReadonlyArray<{
          readonly value: number
          readonly label: string
          readonly selected: boolean
        }>
      }
      readonly brief: string
    }

interface Switch {
  readonly checked: boolean
  readonly label: string
  readonly hint: string
}

const DEFAULT_FROM = 9 * 60
const DEFAULT_TO = 18 * 60
const DEFAULT_MAX_MINUTES = 60
const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 480]

const summaryKey = (delegation: SchedulingDelegation): 'both' | 'joinOnly' | 'addOnly' | 'neither' =>
  delegation.autoJoin
    ? delegation.autoAdd
      ? 'both'
      : 'joinOnly'
    : delegation.autoAdd
      ? 'addOnly'
      : 'neither'

const isLimited = (delegation: SchedulingDelegation): boolean =>
  (delegation.autoJoin || delegation.autoAdd) &&
  (delegation.scope.people !== null ||
    delegation.scope.hours !== null ||
    delegation.scope.maxMinutes !== null)

const lengthChoices = (saved: number | null): ReadonlyArray<number> =>
  saved === null || LENGTHS.includes(saved) ? LENGTHS : [...LENGTHS, saved].sort((a, b) => a - b)

const lengthFrom = (typed: string): number => {
  const minutes = Number(typed)
  return Number.isInteger(minutes) ? Math.min(480, Math.max(15, minutes)) : DEFAULT_MAX_MINUTES
}

const agentIdFrom = (typed: string): CredentialId | null => (CredentialId.is(typed) ? typed : null)

const timeOfDay = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const minutesOf = (typed: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(typed)
  if (match === null) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes < 24 * 60 ? minutes : null
}
