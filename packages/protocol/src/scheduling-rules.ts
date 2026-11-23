import { type Meeting, type TimeSpan, closestSlot, earliestCommonSlot, isFreeThrough } from './common-slot.ts'
import type { DebateRoom } from './debate-room.ts'
import type { DebateEnding } from './debates.ts'
import { FREE_SLOTS_MAX, FREE_SLOTS_NOTE_MAX } from './free-slots.ts'
import type { MemberId } from './ids.ts'
import type { ComputedResult, RoomTurn } from './room-rules.ts'

/** The earliest time every required person who answered is free, else the closest; who did not is named. */
export const scheduleOf = (room: DebateRoom, now: number): ComputedResult | null => {
  const schedule = room.schedule
  if (schedule === undefined) return null
  const answers = answersOf(room)
  const answered = schedule.attendees.filter((attendee) => answers.has(attendee.memberId))
  const required = answered.filter((attendee) => attendee.required)
  const freeOf = (attendee: Attendee) => answers.get(attendee.memberId)!
  const unanswered = schedule.attendees
    .filter((attendee) => !answers.has(attendee.memberId))
    .map((attendee) => attendee.memberId)
  const meeting: Meeting = { minutes: schedule.minutes, window: schedule.window }
  const slot = earliestCommonSlot(meeting, required.map(freeOf))
  if (slot === null) {
    const closest = closestSlot(
      meeting,
      required.map((attendee) => ({ memberId: attendee.memberId, free: freeOf(attendee) })),
    )
    return { draftedBy: null, draftedAt: now, result: { kind: 'no_slot', closest, unanswered } }
  }
  const optional = answered.filter((attendee) => !attendee.required)
  const isFree = (attendee: Attendee) => isFreeThrough(freeOf(attendee), slot)
  return {
    draftedBy: null,
    draftedAt: now,
    result: {
      kind: 'slot',
      ...slot,
      optionalFree: optional.filter(isFree).map((attendee) => attendee.memberId),
      optionalBusy: optional.filter((attendee) => !isFree(attendee)).map((attendee) => attendee.memberId),
      unanswered,
    },
  }
}

/** Why the room cannot take a scheduling turn: free slots inside the window and a short note, or null. */
export const scheduleTurnProblem = (turn: RoomTurn, room: DebateRoom): string | null => {
  const schedule = room.schedule
  if (schedule === undefined) return 'This room does not schedule a meeting.'
  if (!schedule.attendees.some((attendee) => attendee.memberId === turn.memberId))
    return 'This agent’s person is not invited to this meeting.'
  const slots = turn.slots
  if (slots === undefined)
    return 'A turn in a scheduling room gives free slots: an empty list when there are none.'
  if (slots.length > FREE_SLOTS_MAX)
    return `A turn gives at most ${FREE_SLOTS_MAX} free slots; this one has ${slots.length}.`
  if (turn.body.length > FREE_SLOTS_NOTE_MAX)
    return `A note holds at most ${FREE_SLOTS_NOTE_MAX} characters; this one has ${turn.body.length}.`
  if (slots.some((slot) => slot.endsAt <= slot.startsAt)) return 'Every free slot ends after it starts.'
  const { window } = schedule
  return slots.some((slot) => slot.startsAt < window.startsAt || slot.endsAt > window.endsAt)
    ? `Every free slot lies inside the meeting’s window, from ${new Date(window.startsAt).toISOString()} to ${new Date(window.endsAt).toISOString()}.`
    : null
}

/** The room has an answer from every required person, from their agent or chosen by themself. */
export const isEveryRequiredAnswered = (room: DebateRoom): boolean => {
  const answers = answersOf(room)
  return (
    room.schedule?.attendees.every((attendee) => !attendee.required || answers.has(attendee.memberId)) ===
    true
  )
}

/** A room no required person answered ends with no turns: there is nobody to schedule for. */
export const scheduleEndingOf = (room: DebateRoom): DebateEnding | null => {
  const answers = answersOf(room)
  const anyRequired = room.schedule?.attendees.some(
    (attendee) => attendee.required && answers.has(attendee.memberId),
  )
  return anyRequired === true ? null : 'no_turns'
}

/** What a person chose themself in the web client, when their agent could not, counts over its turn. */
export interface RoomSchedule {
  readonly minutes: number
  readonly window: TimeSpan
  readonly attendees: ReadonlyArray<Attendee>
  readonly chosenByPeople: ReadonlyArray<{
    readonly memberId: MemberId
    readonly slots: ReadonlyArray<TimeSpan>
  }>
}

export interface Attendee {
  readonly memberId: MemberId
  readonly required: boolean
}

const answersOf = (room: DebateRoom): ReadonlyMap<MemberId, ReadonlyArray<TimeSpan>> => {
  const fromTurns = room.turns.flatMap((turn) =>
    turn.slots === undefined ? [] : [[turn.memberId, turn.slots] as const],
  )
  const chosen = (room.schedule?.chosenByPeople ?? []).map(
    (answer) => [answer.memberId, answer.slots] as const,
  )
  return new Map([...fromTurns, ...chosen])
}
