import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  DEFAULT_GRACE_MINUTES,
  type Debate,
  DebateId,
  FEATURE_OFF_MESSAGE,
  FREE_SLOTS_NOTE_MAX,
  Forbidden,
  type FreeSlotsTurn,
  Invalid,
  type MemberId,
  NotFound,
  SCHEDULE_WINDOW_MAX_DAYS,
  SCHEDULING_RULES,
  type ScheduleSetup,
  type TimeSpan,
  turnHoldOf,
} from '@homingbird/protocol'
import { type Caller, isHuman, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import {
  type DebateRow,
  announceDebate,
  describeDebate,
  enterDebate,
  loadRoom,
  lockedDebate,
  participantByAgent,
  touchDebate,
  visibleDebate,
} from './debate-rows.ts'
import { moveDebate, settleDebateRow } from './debate-settling.ts'
import { activeMembersAmong } from './debates.ts'
import { joinByDelegation } from './delegated-joins.ts'
import { keepChosenSlots } from './scheduling-rows.ts'
import { featureIsOn } from './settings.ts'

/**
 * Opens a room that finds the earliest time every required person is free for a meeting. Only a person
 * opens one (rule 9), and they are always a required attendee; its time runs from now, not from the first
 * answer, so a room nobody answers still ends.
 */
export const openSchedulingRoom = (
  caller: Caller,
  setup: ScheduleSetup,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireDebateRooms
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can open a scheduling room.' }))
    const now = env.clock.now()
    const title = setup.title.trim()
    if (title === '') return yield* T.fail(Invalid({ message: 'A scheduling room needs a title.' }))
    const problem = setupProblem(setup, now)
    if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
    const others = setup.attendees.filter((attendee) => attendee.memberId !== caller.member.id)
    if (others.length === 0)
      return yield* T.fail(Invalid({ message: 'Ask at least one other person to the meeting.' }))
    if (new Set(others.map((attendee) => attendee.memberId)).size !== others.length)
      return yield* T.fail(Invalid({ message: 'Ask each person once.' }))
    yield* activeMembersAmong(others.map((attendee) => attendee.memberId))
    const attendees = [{ memberId: caller.member.id, required: true }, ...others]
    const row: DebateRow = {
      id: DebateId.of(env.random.identifier()),
      question: title,
      visibility: setup.visibility ?? 'private',
      status: 'open',
      created_by: caller.member.id,
      turns_per_agent: 1,
      total_turns: Math.max(2, attendees.length),
      total_follows_agents: null,
      minutes: ANSWERS_WITHIN_MINUTES,
      turn_characters: FREE_SLOTS_NOTE_MAX,
      created_at: now,
      updated_at: now,
      deadline_at: now + ANSWERS_WITHIN_MINUTES * 60_000,
      concluded_at: null,
      closed_at: null,
      result: null,
      result_by: null,
      result_at: null,
      result_round: 0,
      ended_because: null,
      votes_open_at: null,
      grace_minutes: DEFAULT_GRACE_MINUTES,
      dropped_out: null,
      room_type: 'scheduling',
    }
    yield* run(insertInto('debates', { ...row }))
    yield* run(
      insertInto('scheduling_rooms', {
        debate_id: row.id,
        minutes: setup.minutes,
        window_starts_at: setup.window.startsAt,
        window_ends_at: setup.window.endsAt,
      }),
    )
    for (const [order, attendee] of attendees.entries()) {
      yield* enterDebate(row.id, attendee.memberId, now + order)
      yield* run(
        insertInto('scheduling_attendees', {
          debate_id: row.id,
          member_id: attendee.memberId,
          required: attendee.required ? 1 : 0,
        }),
      )
    }
    for (const attendee of attendees) yield* joinByDelegation(row, attendee.memberId, setup.minutes)
    yield* announceDebate(row, 'everyone')
    return yield* describeDebate(yield* lockedDebate(row.id))
  })

/**
 * Opens a new room asking the same people for a meeting of the same title and length, in the window
 * given or the same one; only whoever opened the room retries it, once it has settled or ended.
 */
export const retrySchedulingRoom = (
  caller: Caller,
  id: DebateId,
  window: TimeSpan | undefined,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    yield* requireDebateRooms
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can open a scheduling room.' }))
    yield* visibleDebate(viewerOf(caller), id)
    const row = yield* lockedSchedulingRoom(id)
    if (row.created_by !== caller.member.id)
      return yield* T.fail(Forbidden({ message: 'Only the person who opened this room can open it again.' }))
    if (row.status === 'open' || row.status === 'concluding')
      return yield* T.fail(Conflict({ message: 'This room still takes answers.' }))
    const asked = (yield* first<{ minutes: number; window_starts_at: number; window_ends_at: number }>(
      sql`SELECT minutes, window_starts_at, window_ends_at FROM scheduling_rooms WHERE debate_id = ${id}`,
    ))!
    const attendees = yield* all<{ member_id: MemberId; required: number }>(sql`
      SELECT a.member_id, a.required FROM scheduling_attendees a
      JOIN debate_members m ON m.debate_id = a.debate_id AND m.member_id = a.member_id
      JOIN members p ON p.id = a.member_id
      WHERE a.debate_id = ${id} AND a.member_id <> ${row.created_by} AND p.status = 'active'
      ORDER BY m.created_at, a.member_id`)
    return yield* openSchedulingRoom(caller, {
      title: row.question,
      minutes: Number(asked.minutes),
      window: window ?? {
        startsAt: Number(asked.window_starts_at),
        endsAt: Number(asked.window_ends_at),
      },
      attendees: attendees.map((attendee) => ({
        memberId: attendee.member_id,
        required: Number(attendee.required) === 1,
      })),
      visibility: row.visibility === 'private' ? 'private' : 'open',
    })
  })

/**
 * An agent's answer for its own person: their free slots as its turn, empty when they are busy throughout.
 * An agent that cannot read the calendar takes no turn: its person is asked to choose in the web client.
 */
export const shareFreeSlots = (
  caller: Caller,
  id: DebateId,
  turn: FreeSlotsTurn,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireDebateRooms
    yield* visibleDebate(viewerOf(caller), id)
    if (isHuman(caller))
      return yield* T.fail(
        Forbidden({ message: 'Agents share free slots; a person chooses their own in the web client.' }),
      )
    const participant = yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(Forbidden({ message: 'Your person has not opted this agent in for this room.' }))
    const row = yield* lockedSchedulingRoom(id)
    const memberId = participant.member_id
    const answer = yield* answerOf(id, memberId)
    if (answer === 'by_person')
      return yield* T.fail(
        Conflict({
          message: 'Your person chose their free times themself; this room needs nothing more from you.',
        }),
      )
    if (answer === 'choosing')
      return yield* T.fail(
        Conflict({
          message: 'You said you cannot read the calendar, so your person chooses in the web client.',
        }),
      )
    if (turn.cannotReadCalendar === true) yield* askPersonToChoose(row, memberId, turn.slots)
    else {
      const event = {
        type: 'turn' as const,
        memberId,
        body: turn.note ?? '',
        slots: turn.slots,
      }
      const hold = turnHoldOf((yield* loadRoom(row)).room, event, env.clock.now(), SCHEDULING_RULES)
      if (hold !== null) env.turnHolds.keep(id, hold)
      yield* moveDebate(row, event, { credentialId: caller.credential.id, agentName: participant.agent_name })
    }
    return yield* describeDebate(yield* lockedDebate(id))
  })

/** A person's own free times, counted over their agent's answer, while the room takes answers. */
export const chooseFreeSlots = (
  caller: Caller,
  id: DebateId,
  slots: ReadonlyArray<TimeSpan>,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireDebateRooms
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person chooses their own free times.' }))
    yield* visibleDebate(viewerOf(caller), id)
    const row = yield* lockedSchedulingRoom(id)
    const memberId = caller.member.id
    if ((yield* answerOf(id, memberId)) === undefined)
      return yield* T.fail(Forbidden({ message: 'Only the people asked to this meeting choose free times.' }))
    yield* requireTakingAnswers(row)
    const { room } = yield* loadRoom(row)
    const problem = SCHEDULING_RULES.turnProblem({ memberId, body: '', slots }, room)
    if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
    const now = env.clock.now()
    yield* keepChosenSlots(id, memberId, slots, now)
    yield* touchDebate(id, now)
    yield* announceDebate(row)
    yield* settleDebateRow(row)
    return yield* describeDebate(yield* lockedDebate(id))
  })

/** Scheduling rooms are a kind of debate room, so they answer as switched off while debate rooms are. */
export const requireDebateRooms: T.Task<void, NotFound, RequestEnv> = T.flatMap((on: boolean) =>
  on ? T.unit : T.fail(NotFound({ message: FEATURE_OFF_MESSAGE })),
)(featureIsOn('debateRooms'))

/** The room's row lock, for a scheduling room only. */
export const lockedSchedulingRoom = (id: DebateId): T.Task<DebateRow, Conflict, RequestEnv> =>
  T.flatMap((row: DebateRow) =>
    row.room_type === 'scheduling'
      ? T.succeed(row)
      : T.fail(Conflict({ message: 'This room is a debate: it takes turns, not free times.' })),
  )(lockedDebate(id))

/** How long a scheduling room waits for answers, from when it opened. */
const ANSWERS_WITHIN_MINUTES = 120

const requireTakingAnswers = (row: DebateRow): T.Task<void, Conflict> =>
  row.status === 'open' ? T.unit : T.fail(Conflict({ message: 'This room no longer takes answers.' }))

/** The attendee's stored answer, null while they have none of their own, undefined for a non-attendee. */
const answerOf = (id: DebateId, memberId: MemberId): T.Task<string | null | undefined, never, RequestEnv> =>
  T.map((found: { answer: string | null } | null) => (found === null ? undefined : found.answer))(
    first<{ answer: string | null }>(
      sql`SELECT answer FROM scheduling_attendees WHERE debate_id = ${id} AND member_id = ${memberId}`,
    ),
  )

/** Marks the person as asked to choose, once, before their agent took a turn; the room stops waiting on it. */
const askPersonToChoose = (
  row: DebateRow,
  memberId: MemberId,
  slots: ReadonlyArray<TimeSpan>,
): T.Task<void, Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (slots.length > 0)
      return yield* T.fail(
        Invalid({ message: 'Give free slots, or say the calendar cannot be read; not both.' }),
      )
    yield* requireTakingAnswers(row)
    const turned = yield* first(
      sql`SELECT 1 AS present FROM debate_turns WHERE debate_id = ${row.id} AND member_id = ${memberId}`,
    )
    if (turned !== null)
      return yield* T.fail(Conflict({ message: 'This agent already shared free slots in this room.' }))
    const now = env.clock.now()
    yield* run(sql`
      UPDATE scheduling_attendees SET answer = 'choosing', changed_at = ${now}
      WHERE debate_id = ${row.id} AND member_id = ${memberId} AND answer IS NULL`)
    yield* touchDebate(row.id, now)
    yield* announceDebate(row)
  })

const setupProblem = (setup: ScheduleSetup, now: number): string | null => {
  const { minutes, window } = setup
  if (minutes % 15 !== 0) return 'A meeting lasts a whole number of quarter hours.'
  if (window.endsAt <= now) return 'The window to find a time in has already passed.'
  const length = window.endsAt - window.startsAt
  if (length > SCHEDULE_WINDOW_MAX_DAYS * DAY_MS)
    return `The window to find a time in spans at most ${SCHEDULE_WINDOW_MAX_DAYS} days.`
  return length < minutes * 60_000 ? 'The window to find a time in is shorter than the meeting.' : null
}

const DAY_MS = 24 * 60 * 60_000
