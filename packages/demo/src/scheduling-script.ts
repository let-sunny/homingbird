import {
  type Adding,
  type Debate,
  type DebateRoom,
  type MemberId,
  SCHEDULING_RULES,
  type ScheduleLimits,
  type TimeSpan,
  allowedStretches,
  clippedToLimits,
  scheduleOf,
  windowAheadOf,
} from '@homingbird/protocol'
import { changeRoom, roomById } from './debate-script.ts'
import { memberById } from './reads.ts'
import { agentsContinue, confirmedAttendance } from './scheduling-invitation.ts'
import type { World } from './world.ts'

/**
 * A scheduling flock the visitor opened: a moment after it opens the visitor's own agent gives their free
 * times from a scripted calendar, and a few seconds later each colleague's agent joins and does the same.
 * The visitor may replace their own times until the flock settles; opening it is the only click.
 */
export const agentsAnswerLater = (world: World, debateId: string, adding: () => Adding): void => {
  const room = roomById(world, debateId)!
  const colleagues = room.schedule!.attendees.filter((attendee) => attendee.memberId !== room.createdBy)
  if (room.participants.some((participant) => participant.memberId === room.createdBy))
    world.after(OWN_ANSWER_AFTER_MS, () => answerForOpener(world, debateId, adding))
  for (const [index, attendee] of colleagues.entries())
    world.after(ANSWER_AFTER_MS + index * ANSWER_GAP_MS, () =>
      answer(world, debateId, attendee.memberId, index, adding),
    )
}

/** The flock settles once every required person answered: at the earliest common time, or the closest. */
export const settleWhenAnswered = (world: World, debateId: string, adding: () => Adding): void => {
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
        settled.kind === 'slot'
          ? confirmedAttendance(current, settled.optionalBusy, adding, now)
          : current.schedule!.attendees,
    },
  }))
  agentsContinue(world, debateId, adding)
}

/** A person's or an agent's free times kept in the flock, and who gave them marked answered. */
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

/** The flock as the rules read it: what the agents' turns and the people's own choices gave. */
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
      ...(schedule.weekdays !== undefined && { weekdays: schedule.weekdays }),
      ...(schedule.hours !== undefined && { hours: schedule.hours }),
      ...(schedule.timeZone !== undefined && { timeZone: schedule.timeZone }),
      attendees: schedule.attendees.map(({ memberId, required }) => ({ memberId, required })),
      chosenByPeople: given.filter((one) => isByPerson(one.memberId)),
    },
  }
}

export type RoomSchedule = NonNullable<Debate['schedule']>

/** How long the visitor's own agent takes to answer, then the first colleague's agent, and each next one after it. */
export const OWN_ANSWER_AFTER_MS = 2_000
export const ANSWER_AFTER_MS = 6_000
export const ANSWER_GAP_MS = 2_500

const answerForOpener = (world: World, debateId: string, adding: () => Adding): void => {
  const room = roomById(world, debateId)
  const participant = room?.participants.find((one) => one.memberId === room.createdBy)
  if (room === null || participant === undefined || room.status !== 'open') return
  give(world, debateId, room.createdBy, participant.agentName, OWN_BUSY_HOURS, adding)
}

const answer = (
  world: World,
  debateId: string,
  memberId: MemberId,
  index: number,
  adding: () => Adding,
): void => {
  const room = roomById(world, debateId)
  const colleague = memberById(world.records(), memberId)
  if (room === null || colleague === null || room.status !== 'open') return
  give(
    world,
    debateId,
    memberId,
    `${colleague.name.split(' ')[0]}'s laptop`,
    BUSY_HOURS[index % BUSY_HOURS.length]!,
    adding,
  )
}

/** An agent joins if it has not, and takes its turn with the free times its person's scripted calendar leaves. */
const give = (
  world: World,
  debateId: string,
  memberId: MemberId,
  agentName: string,
  busy: BusyHours,
  adding: () => Adding,
): void => {
  const now = world.clock.now()
  changeRoom(world, debateId, (current) => ({
    ...current,
    participants: current.participants.some((participant) => participant.memberId === memberId)
      ? current.participants
      : [...current.participants, { memberId, agentId: null, agentName, joinedAt: now, takingPart: true }],
    turns: [
      ...current.turns,
      {
        position: current.turns.length + 1,
        memberId,
        agentName,
        body: `Free in working hours, except ${hourLabel(busy.from)} to ${hourLabel(busy.to)} each day.`,
        at: now,
      },
    ],
    schedule: withAnswer(
      current.schedule!,
      memberId,
      'by_agent',
      clippedToLimits(
        freeSlotsOf(busy, windowAheadOf(current.schedule!.window, now), current.schedule!),
        windowAheadOf(current.schedule!.window, now),
        current.schedule!,
      ),
    ),
  }))
  settleWhenAnswered(world, debateId, adding)
}

/**
 * The working hours of the visitor's zone, minus one busy stretch each day: all an agent says of its
 * person's calendar. The flock's own limits win over the default 09:00 to 18:00.
 */
const freeSlotsOf = (busy: BusyHours, window: TimeSpan, limits: ScheduleLimits): TimeSpan[] => {
  const timeZone = limits.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const working: ScheduleLimits = { ...limits, ...(limits.hours === undefined && WORKING_DAY), timeZone }
  const busyStretches = allowedStretches(window, {
    timeZone,
    hours: { from: busy.from * 60, to: busy.to * 60 },
  })
  return allowedStretches(window, working).flatMap((stretch) => withoutBusy(stretch, busyStretches))
}

const withoutBusy = (stretch: TimeSpan, busyStretches: ReadonlyArray<TimeSpan>): TimeSpan[] => {
  const free: TimeSpan[] = []
  let from = stretch.startsAt
  for (const busy of busyStretches) {
    if (busy.endsAt <= from || busy.startsAt >= stretch.endsAt) continue
    if (busy.startsAt > from) free.push({ startsAt: from, endsAt: busy.startsAt })
    from = Math.max(from, busy.endsAt)
  }
  return from < stretch.endsAt ? [...free, { startsAt: from, endsAt: stretch.endsAt }] : free
}

interface BusyHours {
  readonly from: number
  readonly to: number
}

const WORKING_DAY = { hours: { from: 9 * 60, to: 18 * 60 } }

/** When the visitor's own calendar is busy, in hours of their day. */
const OWN_BUSY_HOURS: BusyHours = { from: 12, to: 13 }

/** When each colleague's calendar is busy, in hours of their day, by the order they were asked. */
const BUSY_HOURS: ReadonlyArray<BusyHours> = [
  { from: 9, to: 11 },
  { from: 13, to: 15 },
  { from: 15, to: 17 },
  { from: 11, to: 13 },
]

const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`
