import { type AsRead, type MemberId, UNKNOWN } from '@homingbird/protocol'
import { locale, strings } from '../strings.ts'
import { type ScheduleResultBody, scheduleResultBody } from './schedule-result.ts'

/** Whether a room is one this client shows as a scheduling room, a debate, or a kind it does not know. */
export const roomKindOf = (debate: Pick<AsRead.Debate, 'type'>): 'debate' | 'scheduling' | 'unknown' =>
  debate.type === 'scheduling' ? 'scheduling' : debate.type === UNKNOWN ? 'unknown' : 'debate'

/**
 * A scheduling room: who has answered and what each one is doing, the deadline, and the result, with
 * every time in the viewer's time zone. Whoever opened it also sees where each other person's part of
 * the meeting stands.
 */
export const schedulingRoomModel = (input: SchedulingRoomInput): SchedulingRoomModel => {
  const { debate, viewerId, timeZone } = input
  const schedule = debate.schedule
  if (!input.enabled) return { kind: 'unsupported', text: strings.scheduling.off }
  if (roomKindOf(debate) !== 'scheduling' || schedule == null)
    return { kind: 'unsupported', text: strings.scheduling.unsupported }
  const nameOf = (id: MemberId): string => input.members.get(id)?.name ?? strings.formerMember
  const answered = schedule.attendees.filter(hasAnswered).length
  const stage = schedulingStageOf(debate.status, debate.result?.result.kind)
  return {
    kind: 'room',
    title: debate.question,
    stage,
    stageText: strings.scheduling.stage[stage],
    isPrivate: debate.visibility === 'private',
    summary: [
      strings.scheduling.lengthSummary({ minutes: schedule.minutes }),
      strings.scheduling.windowSummary({
        range: windowShown(schedule.window.startsAt, schedule.window.endsAt, timeZone),
      }),
    ],
    deadline:
      debate.status === 'open'
        ? strings.scheduling.collectingUntil({ time: fullTime(debate.deadlineAt, timeZone) })
        : null,
    answered: strings.scheduling.answeredCount({ answered, total: schedule.attendees.length }),
    attendeesTitle: strings.scheduling.attendeesTitle,
    attendees: schedule.attendees.map((attendee) => ({
      memberId: attendee.memberId,
      name:
        attendee.memberId === viewerId
          ? strings.scheduling.youNamed({ name: nameOf(attendee.memberId) })
          : nameOf(attendee.memberId),
      required: attendee.required ? strings.scheduling.required : strings.scheduling.optional,
      answer: (attendee.memberId === viewerId ? strings.scheduling.ownAnswer : strings.scheduling.answer)[
        attendee.answer ?? 'waiting'
      ],
      answered: hasAnswered(attendee),
      part:
        debate.createdBy === viewerId && attendee.memberId !== viewerId && attendee.attendance !== undefined
          ? strings.scheduling.partOf[knownPart(attendee.attendance)]
          : null,
    })),
    resultTitle: strings.scheduling.resultTitle,
    result: resultOf(debate, { nameOf, viewerId }, timeZone),
  }
}

export interface SchedulingRoomInput {
  readonly debate: AsRead.Debate
  readonly viewerId: MemberId
  /** Whether scheduling rooms are on in this organization. */
  readonly enabled: boolean
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  /** An IANA time zone for tests; the browser's own when absent. */
  readonly timeZone: string
}

export type SchedulingRoomModel =
  | { readonly kind: 'unsupported'; readonly text: string }
  | {
      readonly kind: 'room'
      readonly title: string
      readonly stage: SchedulingStage
      readonly stageText: string
      readonly isPrivate: boolean
      readonly summary: ReadonlyArray<string>
      readonly deadline: string | null
      /** For example "Answered: 3 of 5". */
      readonly answered: string
      readonly attendeesTitle: string
      readonly attendees: ReadonlyArray<{
        readonly memberId: MemberId
        readonly name: string
        readonly required: string
        readonly answer: string
        readonly answered: boolean
        /** Where their part of the meeting stands, for whoever opened the room. */
        readonly part: string | null
      }>
      readonly resultTitle: string
      readonly result: SchedulingResult
    }

export type SchedulingResult =
  | { readonly kind: 'waiting'; readonly text: string }
  | { readonly kind: 'ended'; readonly text: string }
  | { readonly kind: 'unknown'; readonly text: string }
  | { readonly kind: 'settled'; readonly body: ScheduleResultBody }

export type SchedulingStage = 'collecting' | 'settled' | 'no_slot' | 'ended' | 'unknown'

/** The stage a scheduling room shows; a list has the status alone, and a room that closed with no common time says so. */
export const schedulingStageOf = (status: AsRead.Debate['status'], resultKind?: string): SchedulingStage =>
  status === 'open' || status === 'concluding'
    ? 'collecting'
    : status === 'closed'
      ? resultKind === 'no_slot'
        ? 'no_slot'
        : 'settled'
      : status === 'ended'
        ? 'ended'
        : 'unknown'

const knownPart = (state: string): keyof typeof strings.scheduling.partOf =>
  state in strings.scheduling.partOf ? (state as keyof typeof strings.scheduling.partOf) : 'unknown'

const hasAnswered = (attendee: { readonly answer?: string | undefined }): boolean =>
  attendee.answer === 'by_agent' || attendee.answer === 'by_person'

const resultOf = (
  debate: AsRead.Debate,
  people: { readonly nameOf: (id: MemberId) => string; readonly viewerId: MemberId },
  timeZone: string,
): SchedulingResult => {
  const settled = debate.result?.result
  if (settled === undefined) {
    return debate.status === 'ended'
      ? { kind: 'ended', text: strings.scheduling.endedNoTime }
      : { kind: 'waiting', text: strings.scheduling.waitingForResult }
  }
  if (settled.kind === 'slot' || settled.kind === 'no_slot')
    return { kind: 'settled', body: scheduleResultBody(settled, people, timeZone) }
  return { kind: 'unknown', text: strings.debates.unknownResult }
}

const windowShown = (startsAt: number, endsAt: number, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone,
  }).formatRange(new Date(startsAt), new Date(endsAt - 1))

const fullTime = (timestamp: number, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(timestamp))
