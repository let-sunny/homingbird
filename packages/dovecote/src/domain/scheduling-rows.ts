import { Task as T } from '@homingbird/kernel'
import type {
  AttendanceState,
  AttendeeAnswer,
  DebateId,
  MeetingInvite,
  MemberId,
  RoomSchedule,
  RoomScheduleDetails,
  ScheduleLimits,
  ScheduleSetup,
  TimeSpan,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

/**
 * A scheduling flock as it is stored: what it asks, of whom, and the free slots each attendee gave, from
 * their agent's turn or chosen by themself. A person who chose themself, or was asked to because their
 * agent cannot read their calendar, waits on that agent no more.
 */
export const scheduleOf = (
  id: DebateId,
  turns: ReadonlyArray<{ readonly member_id: MemberId }>,
): T.Task<ScheduleFacts, never, AppEnv> =>
  T.gen(function* () {
    const asked = (yield* first<SchedulingRoomRow>(
      sql`SELECT minutes, window_starts_at, window_ends_at, weekdays, hours_from, hours_to, time_zone,
        invite_uid, meeting_url, invite_state
        FROM scheduling_rooms WHERE debate_id = ${id}`,
    ))!
    const attendees = yield* all<AttendeeRow>(sql`
      SELECT a.member_id, a.required, a.answer, a.state, a.changed_at FROM scheduling_attendees a
      JOIN debate_members m ON m.debate_id = a.debate_id AND m.member_id = a.member_id
      WHERE a.debate_id = ${id} ORDER BY m.created_at, a.member_id`)
    const slots = yield* all<FreeSlotRow>(sql`
      SELECT member_id, starts_at, ends_at, by_person FROM room_free_slots WHERE debate_id = ${id}
      ORDER BY member_id, starts_at`)
    const slotsOf = (memberId: MemberId, byPerson: boolean): TimeSpan[] =>
      slots
        .filter((slot) => slot.member_id === memberId && (Number(slot.by_person) === 1) === byPerson)
        .map((slot) => ({ startsAt: Number(slot.starts_at), endsAt: Number(slot.ends_at) }))
    const tookTurn = new Set(turns.map((turn) => turn.member_id))
    const answerOf = (attendee: AttendeeRow): Exclude<AttendeeAnswer, 'unknown'> => {
      if (attendee.answer === 'by_person') return 'by_person'
      if (tookTurn.has(attendee.member_id)) return 'by_agent'
      return attendee.answer === 'choosing' ? 'choosing' : 'waiting'
    }
    const answered = attendees.flatMap((attendee) => {
      const answer = answerOf(attendee)
      return answer === 'by_agent' || answer === 'by_person'
        ? [{ memberId: attendee.member_id, slots: slotsOf(attendee.member_id, answer === 'by_person') }]
        : []
    })
    const window = { startsAt: Number(asked.window_starts_at), endsAt: Number(asked.window_ends_at) }
    const minutes = Number(asked.minutes)
    const limits = limitsOf(asked)
    const listed = attendees.map((attendee) => ({
      memberId: attendee.member_id,
      required: Number(attendee.required) === 1,
    }))
    return {
      details: {
        minutes,
        window,
        ...limits,
        attendees: attendees.map((attendee, at) => ({
          ...listed[at]!,
          answer: answerOf(attendee),
          ...(attendee.state !== null && { attendance: attendee.state }),
          ...(attendee.state !== null &&
            attendee.changed_at !== null && { attendanceSince: Number(attendee.changed_at) }),
        })),
        freeSlots: answered,
        invite: inviteOf(asked),
      },
      room: {
        minutes,
        window,
        ...limits,
        attendees: listed,
        chosenByPeople: answered.filter((one) =>
          attendees.some(
            (attendee) => attendee.member_id === one.memberId && attendee.answer === 'by_person',
          ),
        ),
      },
      answersThemself: new Set(
        attendees
          .filter((attendee) => attendee.answer === 'by_person' || attendee.answer === 'choosing')
          .map((attendee) => attendee.member_id),
      ),
      agentSlotsOf: (memberId) => slotsOf(memberId, false),
    }
  })

/** The columns that keep a flock's limits on weekdays and hours; none for a flock without them. */
export const limitColumnsOf = (setup: ScheduleSetup) => ({
  ...(setup.weekdays !== undefined && { weekdays: [...setup.weekdays].sort().join(',') }),
  ...(setup.hours !== undefined && { hours_from: setup.hours.from, hours_to: setup.hours.to }),
  ...(setup.timeZone !== undefined && { time_zone: setup.timeZone }),
})

/** The limits a stored flock has: only the ones it was opened with. */
export const limitsOf = (row: LimitRow): ScheduleLimits => ({
  ...(row.weekdays !== null && { weekdays: row.weekdays.split(',').map(Number) }),
  ...(row.hours_from !== null &&
    row.hours_to !== null && { hours: { from: Number(row.hours_from), to: Number(row.hours_to) } }),
  ...(row.time_zone !== null && { timeZone: row.time_zone }),
})

export interface LimitRow {
  readonly weekdays: string | null
  readonly hours_from: number | null
  readonly hours_to: number | null
  readonly time_zone: string | null
}

/** Keeps the free slots of an agent's turn for its person, in place of any its earlier turn gave. */
export const keepAgentSlots = (
  id: DebateId,
  memberId: MemberId,
  slots: ReadonlyArray<TimeSpan>,
  now: number,
): T.Task<void, never, AppEnv> => keepSlots(id, memberId, slots, now, false)

/** Keeps the free times a person chose themself, counted over whatever their agent gave. */
export const keepChosenSlots = (
  id: DebateId,
  memberId: MemberId,
  slots: ReadonlyArray<TimeSpan>,
  now: number,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* keepSlots(id, memberId, slots, now, true)
    yield* run(sql`
      UPDATE scheduling_attendees SET answer = 'by_person', changed_at = ${now}
      WHERE debate_id = ${id} AND member_id = ${memberId}`)
  })

export interface ScheduleFacts {
  readonly details: RoomScheduleDetails
  readonly room: RoomSchedule
  readonly answersThemself: ReadonlySet<MemberId>
  readonly agentSlotsOf: (memberId: MemberId) => ReadonlyArray<TimeSpan>
}

const keepSlots = (
  id: DebateId,
  memberId: MemberId,
  slots: ReadonlyArray<TimeSpan>,
  now: number,
  byPerson: boolean,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`DELETE FROM room_free_slots WHERE debate_id = ${id} AND member_id = ${memberId}`)
    for (const slot of mergedSlots(slots))
      yield* run(
        insertInto('room_free_slots', {
          debate_id: id,
          member_id: memberId,
          starts_at: slot.startsAt,
          ends_at: slot.endsAt,
          ...(byPerson && { by_person: 1 }),
          created_at: now,
        }),
      )
  })

/** Overlapping or touching slots become one, so each start is kept once. */
const mergedSlots = (slots: ReadonlyArray<TimeSpan>): TimeSpan[] => {
  const merged: Array<{ startsAt: number; endsAt: number }> = []
  for (const slot of [...slots].sort((a, b) => a.startsAt - b.startsAt)) {
    const last = merged.at(-1)
    if (last === undefined || slot.startsAt > last.endsAt) merged.push({ ...slot })
    else last.endsAt = Math.max(last.endsAt, slot.endsAt)
  }
  return merged
}

/** The invitation once the opener sent it, by their agent or by hand, kept after it was cancelled. */
const inviteOf = (room: SchedulingRoomRow): MeetingInvite | null =>
  room.invite_state === 'sent' || room.invite_uid !== null || room.meeting_url !== null
    ? { uid: room.invite_uid, meetingUrl: room.meeting_url }
    : null

interface SchedulingRoomRow extends LimitRow {
  readonly minutes: number
  readonly window_starts_at: number
  readonly window_ends_at: number
  readonly invite_uid: string | null
  readonly meeting_url: string | null
  readonly invite_state: string | null
}

interface AttendeeRow {
  readonly member_id: MemberId
  readonly required: number
  readonly answer: string | null
  readonly state: AttendanceState | null
  readonly changed_at: number | null
}

interface FreeSlotRow {
  readonly member_id: MemberId
  readonly starts_at: number
  readonly ends_at: number
  readonly by_person: number | null
}
