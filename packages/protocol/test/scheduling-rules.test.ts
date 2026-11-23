import { describe, expect, it } from 'vitest'
import type { TimeSpan } from '../src/common-slot.ts'
import type { DebateRoom } from '../src/debate-room.ts'
import { MemberId } from '../src/ids.ts'
import {
  type RoomSchedule,
  isEveryRequiredAnswered,
  scheduleEndingOf,
  scheduleOf,
  scheduleTurnProblem,
} from '../src/scheduling-rules.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const DAN = MemberId.of('dan000000000')

const at = (hours: number, minutes = 0) => Date.UTC(2026, 10, 23, hours, minutes)
const span = (startsAt: number, endsAt: number): TimeSpan => ({ startsAt, endsAt })
const NOW = at(8)

const SCHEDULE: RoomSchedule = {
  minutes: 60,
  window: span(at(9), at(17)),
  attendees: [
    { memberId: ANA, required: true },
    { memberId: BEN, required: true },
    { memberId: CY, required: false },
  ],
  chosenByPeople: [],
}

const roomOf = (overrides: Partial<DebateRoom> = {}): DebateRoom => ({
  stage: { stage: 'open' },
  createdAt: 0,
  askingSince: 0,
  deadlineAt: at(10),
  limits: { turnsPerAgent: 1, totalTurns: 3, minutes: 120, turnCharacters: 200 },
  participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }],
  turns: [],
  round: 0,
  drafts: [],
  votes: [],
  schedule: SCHEDULE,
  ...overrides,
})

const unscheduled = (): DebateRoom => {
  const { schedule: _, ...room } = roomOf()
  return room
}

const answered = (memberId: MemberId, slots: ReadonlyArray<TimeSpan>) => ({
  memberId,
  afterTurn: null,
  ready: false,
  slots,
})

describe('the time a scheduling flock settles on', () => {
  it('is the earliest every required person is free, with which optional people can come', () => {
    const room = roomOf({
      turns: [
        answered(ANA, [span(at(9), at(12))]),
        answered(BEN, [span(at(10, 10), at(15))]),
        answered(CY, [span(at(13), at(14))]),
      ],
    })
    expect(scheduleOf(room, NOW)).toEqual({
      draftedBy: null,
      draftedAt: NOW,
      result: {
        kind: 'slot',
        startsAt: at(10, 15),
        endsAt: at(11, 15),
        optionalFree: [],
        optionalBusy: [CY],
        unanswered: [],
      },
    })
    const free = roomOf({ turns: [...room.turns.slice(0, 2), answered(CY, [span(at(10), at(12))])] })
    expect(scheduleOf(free, NOW)?.result).toMatchObject({ optionalFree: [CY], optionalBusy: [] })
  })

  it('leaves out and names whoever gave no answer, required or not', () => {
    const room = roomOf({ turns: [answered(ANA, [span(at(14), at(16))])] })
    expect(scheduleOf(room, NOW)?.result).toEqual({
      kind: 'slot',
      startsAt: at(14),
      endsAt: at(15),
      optionalFree: [],
      optionalBusy: [],
      unanswered: [BEN, CY],
    })
  })

  it('takes what a person chose themself over their agent’s answer', () => {
    const room = roomOf({
      turns: [answered(ANA, [span(at(9), at(10))]), answered(BEN, [span(at(9), at(10))])],
      schedule: { ...SCHEDULE, chosenByPeople: [{ memberId: BEN, slots: [span(at(15), at(17))] }] },
    })
    expect(scheduleOf(room, NOW)?.result).toMatchObject({ kind: 'no_slot' })
    const chosen = roomOf({
      turns: [answered(ANA, [span(at(15), at(16))])],
      schedule: { ...SCHEDULE, chosenByPeople: [{ memberId: BEN, slots: [span(at(15), at(17))] }] },
    })
    expect(scheduleOf(chosen, NOW)?.result).toMatchObject({ kind: 'slot', startsAt: at(15) })
  })

  it('is no slot, with the time that misses the fewest required people, when none suits them all', () => {
    const room = roomOf({
      turns: [
        answered(ANA, [span(at(9), at(10))]),
        answered(BEN, [span(at(11), at(12))]),
        answered(CY, [span(at(9), at(17))]),
      ],
    })
    expect(scheduleOf(room, NOW)).toEqual({
      draftedBy: null,
      draftedAt: NOW,
      result: {
        kind: 'no_slot',
        closest: { startsAt: at(9), endsAt: at(10), missing: [BEN] },
        unanswered: [],
      },
    })
  })

  it('never settles on a time already past, starting from now rounded up to the quarter hour', () => {
    const room = roomOf({
      turns: [answered(ANA, [span(at(9), at(17))]), answered(BEN, [span(at(9), at(17))])],
    })
    expect(scheduleOf(room, at(11, 1))?.result).toMatchObject({ kind: 'slot', startsAt: at(11, 15) })
    expect(scheduleOf(room, at(11))?.result).toMatchObject({ kind: 'slot', startsAt: at(11) })
    const early = roomOf({
      turns: [answered(ANA, [span(at(9), at(10))]), answered(BEN, [span(at(9), at(10))])],
    })
    expect(scheduleOf(early, at(9, 30))?.result).toMatchObject({ kind: 'no_slot', closest: null })
  })

  it('is no result for a flock that schedules nothing', () => {
    expect(scheduleOf(unscheduled(), NOW)).toBeNull()
  })
})

describe('a scheduling turn', () => {
  const turn = (slots?: ReadonlyArray<TimeSpan>, body = '') => ({
    memberId: ANA,
    body,
    ...(slots === undefined ? {} : { slots }),
  })

  it('gives free slots inside the window and a short note, even none', () => {
    expect(scheduleTurnProblem(turn([]), roomOf())).toBeNull()
    expect(scheduleTurnProblem(turn([span(at(9), at(17))], 'x'.repeat(200)), roomOf())).toBeNull()
  })

  it('is refused in a flock that schedules nothing, or from a person not invited', () => {
    expect(scheduleTurnProblem(turn([]), unscheduled())).toBe('This flock does not schedule a meeting.')
    expect(scheduleTurnProblem({ ...turn([]), memberId: DAN }, roomOf())).toBe(
      'This agent’s person is not invited to this meeting.',
    )
  })

  it('is refused without slots, with too many, or with too long a note', () => {
    expect(scheduleTurnProblem(turn(), roomOf())).toBe(
      'A turn in a scheduling flock gives free slots: an empty list when there are none.',
    )
    const many = Array.from({ length: 51 }, () => span(at(9), at(10)))
    expect(scheduleTurnProblem(turn(many), roomOf())).toBe(
      'A turn gives at most 50 free slots; this one has 51.',
    )
    expect(scheduleTurnProblem(turn(many.slice(1)), roomOf())).toBeNull()
    expect(scheduleTurnProblem(turn([], 'x'.repeat(201)), roomOf())).toBe(
      'A note holds at most 200 characters; this one has 201.',
    )
  })

  it('is refused for a slot that does not end after it starts, or reaches outside the window', () => {
    expect(scheduleTurnProblem(turn([span(at(10), at(10))]), roomOf())).toBe(
      'Every free slot ends after it starts.',
    )
    const outside =
      'Every free slot lies inside the meeting’s window, from 2026-11-23T09:00:00.000Z to 2026-11-23T17:00:00.000Z.'
    expect(scheduleTurnProblem(turn([span(at(8, 59), at(10))]), roomOf())).toBe(outside)
    expect(scheduleTurnProblem(turn([span(at(16), at(17, 1))]), roomOf())).toBe(outside)
  })
})

describe('whether a scheduling flock has its answers', () => {
  it('waits for every required person, from their agent or chosen by themself, and no optional one', () => {
    const ana = answered(ANA, [])
    expect(isEveryRequiredAnswered(roomOf({ turns: [ana] }))).toBe(false)
    expect(isEveryRequiredAnswered(roomOf({ turns: [ana, answered(BEN, [])] }))).toBe(true)
    const chosen = { ...SCHEDULE, chosenByPeople: [{ memberId: BEN, slots: [] }] }
    expect(isEveryRequiredAnswered(roomOf({ turns: [ana], schedule: chosen }))).toBe(true)
    expect(
      isEveryRequiredAnswered(roomOf({ turns: [{ memberId: BEN, afterTurn: null, ready: true }, ana] })),
    ).toBe(false)
    expect(isEveryRequiredAnswered(unscheduled())).toBe(false)
  })

  it('ends with no turns once its turns stop when no required person answered', () => {
    expect(scheduleEndingOf(roomOf())).toBe('no_turns')
    expect(scheduleEndingOf(roomOf({ turns: [answered(CY, [])] }))).toBe('no_turns')
    expect(scheduleEndingOf(roomOf({ turns: [answered(BEN, [])] }))).toBeNull()
    expect(scheduleEndingOf(unscheduled())).toBe('no_turns')
  })
})

describe('the time a scheduling flock with limits settles on', () => {
  const limited = (limits: Partial<RoomSchedule>): DebateRoom =>
    roomOf({
      schedule: { ...SCHEDULE, window: span(at(0), at(24)), ...limits },
      turns: [answered(ANA, [span(at(0), at(24))]), answered(BEN, [span(at(0), at(24))])],
    })

  it('is the earliest time inside the chosen hours, in the zone of whoever opened the flock', () => {
    const room = limited({ hours: { from: 600, to: 900 }, timeZone: 'UTC' })
    expect(scheduleOf(room, at(0))?.result).toMatchObject({ kind: 'slot', ...span(at(10), at(11)) })
  })

  it('has no slot when the chosen weekday is not in the window, and no closest one either', () => {
    const room = limited({ weekdays: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== 1), timeZone: 'UTC' })
    expect(scheduleOf(room, at(0))?.result).toMatchObject({ kind: 'no_slot', closest: null })
  })
})
