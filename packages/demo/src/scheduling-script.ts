import {
  type AttendanceState,
  type Debate,
  type DebateRoom,
  type MemberId,
  SCHEDULING_RULES,
  type TimeSpan,
  confirmAttendance,
  scheduleOf,
  windowAheadOf,
} from '@homingbird/protocol'
import { changeRoom, roomById } from './debate-script.ts'
import { memberById } from './reads.ts'
import type { World } from './world.ts'

/**
 * A scheduling room the visitor opened: a few seconds apart, each colleague's agent joins and gives the
 * free times a scripted calendar leaves, and nothing else about it. The visitor chooses their own.
 */
export const colleaguesAnswerLater = (world: World, debateId: string): void => {
  const room = roomById(world, debateId)!
  const colleagues = room.schedule!.attendees.filter((attendee) => attendee.memberId !== room.createdBy)
  for (const [index, attendee] of colleagues.entries())
    world.after(ANSWER_AFTER_MS + index * ANSWER_GAP_MS, () =>
      answer(world, debateId, attendee.memberId, index),
    )
}

/** The room settles once every required person answered: at the earliest common time, or the closest. */
export const settleWhenAnswered = (world: World, debateId: string): void => {
  const debate = roomById(world, debateId)
  if (debate === null || debate.status !== 'open') return
  const room = ruleRoomOf(debate)
  if (!SCHEDULING_RULES.isReadyToConclude(room, debate.createdBy)) return
  const now = world.clock.now()
  const settled = scheduleOf(room, now)!.result
  changeRoom(world, debateId, (current) => ({
    ...current,
    status: 'closed',
    concludedAt: now,
    closedAt: now,
    result: { result: settled, draftedBy: null, draftedAt: now },
    resultRound: 1,
    schedule: {
      ...current.schedule!,
      attendees:
        settled.kind === 'slot' ? withAttendance(current, settled.optionalBusy) : current.schedule!.attendees,
    },
  }))
}

/** A person's or an agent's free times kept in the room, and who gave them marked answered. */
export const withAnswer = (
  schedule: RoomSchedule,
  memberId: MemberId,
  answer: 'by_agent' | 'by_person',
  slots: ReadonlyArray<TimeSpan>,
): RoomSchedule => ({
  ...schedule,
  attendees: schedule.attendees.map((attendee) =>
    attendee.memberId === memberId ? { ...attendee, answer } : attendee,
  ),
  freeSlots: [
    ...(schedule.freeSlots ?? []).filter((given) => given.memberId !== memberId),
    { memberId, slots: [...slots] },
  ],
})

/** The room as the rules read it: what the agents' turns and the people's own choices gave. */
export const ruleRoomOf = (debate: Debate): DebateRoom => {
  const schedule = debate.schedule!
  const given = schedule.freeSlots ?? []
  const isByPerson = (memberId: MemberId): boolean =>
    schedule.attendees.some((attendee) => attendee.memberId === memberId && attendee.answer === 'by_person')
  return {
    stage: { stage: 'open' },
    createdAt: debate.createdAt,
    deadlineAt: debate.deadlineAt,
    askingSince: debate.createdAt,
    limits: debate.limits,
    participants: debate.participants,
    turns: given
      .filter((one) => !isByPerson(one.memberId))
      .map((one) => ({ memberId: one.memberId, afterTurn: null, slots: one.slots })),
    round: 0,
    drafts: [],
    votes: [],
    schedule: {
      minutes: schedule.minutes,
      window: schedule.window,
      attendees: schedule.attendees.map(({ memberId, required }) => ({ memberId, required })),
      chosenByPeople: given.filter((one) => isByPerson(one.memberId)),
    },
  }
}

export type RoomSchedule = NonNullable<Debate['schedule']>

/** How long the first colleague's agent takes to answer, and each next one after it. */
export const ANSWER_AFTER_MS = 3_000
export const ANSWER_GAP_MS = 1_500

const answer = (world: World, debateId: string, memberId: MemberId, index: number): void => {
  const room = roomById(world, debateId)
  const colleague = memberById(world.records(), memberId)
  if (room === null || colleague === null || room.status !== 'open') return
  const now = world.clock.now()
  const busy = BUSY_HOURS[index % BUSY_HOURS.length]!
  const agentName = `${colleague.name.split(' ')[0]}'s laptop`
  changeRoom(world, debateId, (current) => ({
    ...current,
    participants: [
      ...current.participants,
      { memberId, agentId: null, agentName, joinedAt: now, takingPart: true },
    ],
    turns: [
      ...current.turns,
      {
        position: current.turns.length + 1,
        memberId,
        agentName,
        body: `Free, except ${hourLabel(busy.from)} to ${hourLabel(busy.to)} UTC each day.`,
        at: now,
      },
    ],
    schedule: withAnswer(
      current.schedule!,
      memberId,
      'by_agent',
      freeSlotsOf(busy, windowAheadOf(current.schedule!.window, now)),
    ),
  }))
  settleWhenAnswered(world, debateId)
}

/** Everything in the window but one busy stretch each UTC day: all an agent says of its person's calendar. */
const freeSlotsOf = (busy: BusyHours, window: TimeSpan): TimeSpan[] => {
  const firstDay = Math.floor(window.startsAt / DAY_MS) * DAY_MS
  const days = Math.ceil((window.endsAt - firstDay) / DAY_MS)
  return Array.from({ length: days }, (_, index) => firstDay + index * DAY_MS)
    .flatMap((day) => [
      { startsAt: day, endsAt: day + busy.from * HOUR_MS },
      { startsAt: day + busy.to * HOUR_MS, endsAt: day + DAY_MS },
    ])
    .map((span) => ({
      startsAt: Math.max(span.startsAt, window.startsAt),
      endsAt: Math.min(span.endsAt, window.endsAt),
    }))
    .filter((span) => span.endsAt > span.startsAt)
}

const withAttendance = (debate: Debate, notInvited: ReadonlyArray<MemberId>): RoomSchedule['attendees'] => {
  const attendees = debate.schedule!.attendees
  const step = confirmAttendance(
    debate.createdBy,
    attendees
      .filter((attendee) => attendee.required || !notInvited.includes(attendee.memberId))
      .map((attendee) => attendee.memberId),
    () => 'person',
    notInvited,
  )
  return attendees.map((attendee) => {
    const state: AttendanceState | undefined = step.attendance.attendees.find(
      (one) => one.memberId === attendee.memberId,
    )?.state
    return state === undefined ? attendee : { ...attendee, attendance: state }
  })
}

interface BusyHours {
  readonly from: number
  readonly to: number
}

/** When each colleague's calendar is busy, in UTC hours, by the order they were asked. */
const BUSY_HOURS: ReadonlyArray<BusyHours> = [
  { from: 9, to: 11 },
  { from: 13, to: 15 },
  { from: 15, to: 17 },
  { from: 11, to: 13 },
]

const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
