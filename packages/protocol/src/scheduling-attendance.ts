import { Result } from '@homingbird/kernel'
import { Conflict } from './errors.ts'
import type { MemberId } from './ids.ts'
import type { ATTENDANCE_STATES, CalendarOutcome } from './meeting.ts'

/** A click or report moves its own person's part; the opener's also reaches or cancels everyone else's. */
export const stepAttendance = (
  attendance: Attendance,
  event: AttendanceEvent,
  addingOf: (memberId: MemberId) => Adding,
): Result.Result<AttendanceStep, Conflict> => {
  const attendee = attendance.attendees.find((one) => one.memberId === event.memberId)
  if (attendee === undefined) return refuse('This person is not invited to this meeting.')
  const role: Role = event.memberId === attendance.openedBy ? 'opener' : 'attendee'
  const state = nextStateOf(role, attendee.state, event, addingOf(event.memberId))
  if (state === null) return refuse(refusalOf(role, attendee.state, event))
  const own = moved(role, attendee, state)
  const step: AttendanceStep = {
    attendance: withStates(attendance, [own.attendee]),
    asks: own.asks,
    notices: [
      ...own.notices,
      ...unremovedNotices(attendee, event),
      ...leavingNotices(attendance, role, attendee, event),
    ],
  }
  if (role === 'attendee') return Result.ok(step)
  if (state === 'added') return Result.ok(followed(step, invited(step.attendance, addingOf)))
  return Result.ok(event.type === 'remove' ? followed(step, cancelled(step.attendance)) : step)
}

/** The meeting as the room confirmed it: the opener is asked to send its one invitation, nobody else yet. */
export const confirmAttendance = (
  openedBy: MemberId,
  memberIds: ReadonlyArray<MemberId>,
  addingOf: (memberId: MemberId) => Adding,
): AttendanceStep => {
  const others = memberIds.filter(
    (memberId, index) => memberId !== openedBy && memberIds.indexOf(memberId) === index,
  )
  const opener = moved(
    'opener',
    { memberId: openedBy, state: 'waiting_invite' },
    askedStateOf(addingOf(openedBy)),
  )
  return {
    attendance: {
      openedBy,
      attendees: [
        opener.attendee,
        ...others.map((memberId) => ({ memberId, state: 'waiting_invite' as const })),
      ],
    },
    asks: opener.asks,
    notices: opener.notices,
  }
}

/** What the person's agent is asked to do in their calendar now, if anything. */
export const askWaitingOn = (attendance: Attendance, memberId: MemberId): AttendanceAsk['ask'] | null => {
  const state = attendance.attendees.find((one) => one.memberId === memberId)?.state
  const role: Role = memberId === attendance.openedBy ? 'opener' : 'attendee'
  if (state === 'adding') return ADDING_ASK[role]
  return state === 'removing' ? REMOVING_ASK[role] : null
}

/** For the opener, `added` means the invitation was sent; for anyone else, that it is in their calendar. */
export interface Attendance {
  readonly openedBy: MemberId
  readonly attendees: ReadonlyArray<AttendeeAttendance>
}

export interface AttendeeAttendance {
  readonly memberId: MemberId
  readonly state: AttendanceState
}

/** `asked` waits for the person's click, `by_hand` for them to do it, `adding` or `removing` for their agent. */
export type AttendanceState = (typeof ATTENDANCE_STATES)[number]

/** Their agent adds at once as their delegation allows, after their click, or the person does it themself. */
export type Adding = 'agent' | 'agent_after_click' | 'person'

export type AttendanceEvent =
  | { readonly type: 'report'; readonly memberId: MemberId; readonly outcome: CalendarOutcome }
  | { readonly type: 'add'; readonly memberId: MemberId }
  | { readonly type: 'decline'; readonly memberId: MemberId }
  | { readonly type: 'remove'; readonly memberId: MemberId }

export interface AttendanceStep {
  readonly attendance: Attendance
  readonly asks: ReadonlyArray<AttendanceAsk>
  readonly notices: ReadonlyArray<AttendanceNotice>
}

/** What a person's agent is asked to do in their calendar. */
export interface AttendanceAsk {
  readonly memberId: MemberId
  readonly ask: 'send_invite' | 'accept_invite' | 'decline_invite' | 'cancel_invite'
}

export type AttendanceNotice =
  | { readonly to: MemberId; readonly notice: 'waits' }
  | { readonly to: MemberId; readonly notice: 'added' }
  | { readonly to: MemberId; readonly notice: 'cancelled' }
  | { readonly to: MemberId; readonly notice: 'remove_by_hand' }
  | { readonly to: MemberId; readonly notice: 'busy'; readonly memberId: MemberId }
  | {
      readonly to: MemberId
      readonly notice: 'left'
      readonly memberId: MemberId
      readonly because: 'took_out' | 'declined'
    }

type Role = 'opener' | 'attendee'

/**
 * The states each agent's report moves its own person from, and to. An agent that fails to take the
 * meeting out leaves it to its person: Homingbird counts it out and tells them.
 */
const REPORTED: Record<
  Role,
  Partial<Record<CalendarOutcome, ReadonlyArray<readonly [AttendanceState, AttendanceState]>>>
> = {
  opener: {
    sent: [['adding', 'added']],
    conflict: [['adding', 'asked']],
    failed: [
      ['adding', 'by_hand'],
      ['removing', 'removed'],
    ],
    cancelled: [['removing', 'removed']],
  },
  attendee: {
    accepted: [['adding', 'added']],
    conflict: [['adding', 'asked']],
    failed: [
      ['adding', 'by_hand'],
      ['removing', 'removed'],
    ],
    declined: [['removing', 'removed']],
  },
}

const nextStateOf = (
  role: Role,
  state: AttendanceState,
  event: AttendanceEvent,
  adding: Adding,
): AttendanceState | null => {
  switch (event.type) {
    case 'report':
      return REPORTED[role][event.outcome]?.find(([from]) => from === state)?.[1] ?? null
    case 'add':
      return state === 'asked' ? 'adding' : state === 'by_hand' ? 'added' : null
    case 'decline':
      return role === 'attendee' && isWaitingOnPerson(state) ? 'declined' : null
    case 'remove':
      return removedStateOf(role, state, adding)
  }
}

/** The opener takes out a meeting at any point before it is gone; anyone else once it is or is being added. */
const removedStateOf = (role: Role, state: AttendanceState, adding: Adding): AttendanceState | null => {
  const isInCalendar = state === 'added' || state === 'adding'
  if (isInCalendar) return adding === 'person' ? 'removed' : 'removing'
  return role === 'opener' && (state === 'asked' || state === 'by_hand') ? 'removed' : null
}

const isWaitingOnPerson = (state: AttendanceState): boolean =>
  state === 'waiting_invite' || state === 'asked' || state === 'by_hand'

const askedStateOf = (adding: Adding): AttendanceState =>
  adding === 'agent' ? 'adding' : adding === 'agent_after_click' ? 'asked' : 'by_hand'

const moved = (
  role: Role,
  attendee: AttendeeAttendance,
  state: AttendanceState,
): { attendee: AttendeeAttendance; asks: AttendanceAsk[]; notices: AttendanceNotice[] } => {
  const { memberId } = attendee
  const ask = state === 'adding' ? ADDING_ASK[role] : state === 'removing' ? REMOVING_ASK[role] : null
  const waits = state === 'asked' || state === 'by_hand'
  const addedByAgent = attendee.state === 'adding' && state === 'added'
  return {
    attendee: { memberId, state },
    asks: ask === null ? [] : [{ memberId, ask }],
    notices: waits || addedByAgent ? [{ to: memberId, notice: waits ? 'waits' : 'added' }] : [],
  }
}

const ADDING_ASK = { opener: 'send_invite', attendee: 'accept_invite' } as const

const REMOVING_ASK = { opener: 'cancel_invite', attendee: 'decline_invite' } as const

const unremovedNotices = (attendee: AttendeeAttendance, event: AttendanceEvent): AttendanceNotice[] =>
  event.type === 'report' && event.outcome === 'failed' && attendee.state === 'removing'
    ? [{ to: attendee.memberId, notice: 'remove_by_hand' }]
    : []

/** Someone other than the opener leaving, or finding the time taken, is told to the opener. */
const leavingNotices = (
  attendance: Attendance,
  role: Role,
  attendee: AttendeeAttendance,
  event: AttendanceEvent,
): AttendanceNotice[] => {
  if (role === 'opener') return []
  const about = { to: attendance.openedBy, memberId: attendee.memberId }
  if (event.type === 'report') return event.outcome === 'conflict' ? [{ ...about, notice: 'busy' }] : []
  if (event.type === 'decline') return [{ ...about, notice: 'left', because: 'declined' }]
  return event.type === 'remove' ? [{ ...about, notice: 'left', because: 'took_out' }] : []
}

const invited = (
  attendance: Attendance,
  addingOf: (memberId: MemberId) => Adding,
): ReturnType<typeof moved>[] =>
  attendance.attendees
    .filter((one) => one.state === 'waiting_invite')
    .map((one) => moved('attendee', one, askedStateOf(addingOf(one.memberId))))

const cancelled = (attendance: Attendance): ReturnType<typeof moved>[] =>
  attendance.attendees
    .filter((one) => one.memberId !== attendance.openedBy && !isGone(one.state))
    .map((one) => ({
      attendee: { memberId: one.memberId, state: 'cancelled' as const },
      asks: [],
      notices: [{ to: one.memberId, notice: 'cancelled' as const }],
    }))

const isGone = (state: AttendanceState): boolean => state === 'declined' || state === 'removed'

const followed = (step: AttendanceStep, others: ReturnType<typeof moved>[]): AttendanceStep => ({
  attendance: withStates(
    step.attendance,
    others.map((other) => other.attendee),
  ),
  asks: [...step.asks, ...others.flatMap((other) => other.asks)],
  notices: [...step.notices, ...others.flatMap((other) => other.notices)],
})

const withStates = (attendance: Attendance, changed: ReadonlyArray<AttendeeAttendance>): Attendance => ({
  ...attendance,
  attendees: attendance.attendees.map(
    (one) => changed.find((other) => other.memberId === one.memberId) ?? one,
  ),
})

const refusalOf = (role: Role, state: AttendanceState, event: AttendanceEvent): string => {
  switch (event.type) {
    case 'report':
      return REPORTED[role][event.outcome] === undefined
        ? role === 'opener'
          ? `The agent of whoever opened the room sends and cancels the invitation; it does not report ${event.outcome}.`
          : `Only the agent of whoever opened the room reports the invitation ${event.outcome}.`
        : `Nothing waits for this agent to report ${event.outcome}: its person’s part of the meeting is ${state}.`
    case 'add':
      return `There is nothing for this person to add now: their part of the meeting is ${state}.`
    case 'decline':
      return role === 'opener'
        ? 'Whoever opened the room takes the meeting out instead, which cancels it.'
        : `This person can no longer say they cannot come: their part of the meeting is ${state}.`
    case 'remove':
      return `There is nothing for this person to take out: their part of the meeting is ${state}.`
  }
}

const refuse = (message: string): Result.Result<never, Conflict> => Result.err(Conflict({ message }))
