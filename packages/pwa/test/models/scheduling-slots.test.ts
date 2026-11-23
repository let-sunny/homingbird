import { FREE_SLOTS_MAX } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { freeTimeCells, schedulingSlotsModel, slotsFromCells } from '../../src/models/scheduling-slots.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, debate } from '../support/fixtures.ts'
import { plainSpaces } from '../support/text.ts'

const HOUR = 3_600_000
const START = Date.UTC(2026, 10, 19, 12)

type Answer = 'waiting' | 'choosing' | 'by_agent' | 'by_person'

const room = (
  fields: Parameters<typeof debate>[0] = {},
  schedule: Partial<NonNullable<ReturnType<typeof debate>['schedule']>> = {},
  anaAnswer: Answer = 'choosing',
) =>
  debate({
    type: 'scheduling',
    schedule: {
      minutes: 60,
      window: { startsAt: START, endsAt: START + 24 * HOUR },
      attendees: [
        { memberId: ANA, required: true, answer: anaAnswer },
        { memberId: BEN, required: true, answer: 'waiting' },
      ],
      ...schedule,
    },
    ...fields,
  })

const model = (
  debateRoom: ReturnType<typeof room>,
  extra: { joined?: boolean; chosen?: ReadonlyArray<number>; now?: number; workingOnly?: boolean } = {},
) =>
  schedulingSlotsModel({
    debate:
      extra.joined === true
        ? {
            ...debateRoom,
            participants: [{ memberId: ANA, agentId: null, agentName: 'Laptop', joinedAt: 1 }],
          }
        : debateRoom,
    viewerId: ANA,
    now: extra.now ?? START,
    timeZone: 'Asia/Seoul',
    showAllHours: extra.workingOnly !== true,
    ...(extra.chosen !== undefined && { chosen: extra.chosen }),
  })

describe('schedulingSlotsModel', () => {
  it('lists the window hour by hour in the viewer time zone, one group for each day', () => {
    const shown = model(room())!
    expect(shown.days.map((day) => day.day)).toEqual(['Thu, Nov 19', 'Fri, Nov 20'])
    expect(shown.days.map((day) => day.cells.length)).toEqual([3, 21])
    expect(plainSpaces(shown.days[0]!.cells.map((cell) => cell.label))).toEqual([
      '9:00 PM',
      '10:00 PM',
      '11:00 PM',
    ])
    expect(shown.days[1]!.cells[0]!.startsAt).toBe(START + 3 * HOUR)
    expect(shown.count).toBe('0 hours picked')
    expect(shown.sendDisabled).toBe(true)
    expect(shown.hint).toContain('GMT+9')
    expect(shown.hint).not.toContain('Asia/Seoul')
    expect(shown.answered).toBeNull()
  })

  it('shows the working hours only unless asked for all, and says so', () => {
    const working = model(room(), { workingOnly: true })!
    expect(working.days.map((day) => day.day)).toEqual(['Fri, Nov 20'])
    expect(plainSpaces(working.days[0]!.cells.map((cell) => cell.label))).toEqual([
      '8:00 AM',
      '9:00 AM',
      '10:00 AM',
      '11:00 AM',
      '12:00 PM',
      '1:00 PM',
      '2:00 PM',
      '3:00 PM',
      '4:00 PM',
      '5:00 PM',
      '6:00 PM',
      '7:00 PM',
    ])
    expect(working.workingHint).toContain('8 AM')
    expect(working.workingHint).toContain('8 PM')
    expect(working.hoursToggle).toEqual({ label: strings.scheduling.pickShowAll, showsAll: true })
    const all = model(room())!
    expect(all.workingHint).toBeNull()
    expect(all.hoursToggle).toEqual({ label: strings.scheduling.pickShowWorking, showsAll: false })
  })

  it('keeps an hour ticked before even when it is out of working hours', () => {
    const shown = model(room(), { workingOnly: true, chosen: [START] })!
    expect(shown.chosenStarts).toEqual([START])
    expect(shown.slots).toEqual([{ startsAt: START, endsAt: START + HOUR }])
  })

  it('has no toggle when every hour shown is working time', () => {
    const day = room({}, { window: { startsAt: START + 11 * HOUR, endsAt: START + 12 * HOUR } })
    const shown = model(day, { workingOnly: true })!
    expect(shown.hoursToggle).toBeNull()
    expect(shown.workingHint).toBeNull()
  })

  it('is there for a person no agent of theirs answers for, whatever they answered, and for a person choosing themself', () => {
    expect(model(room({}, {}, 'waiting'))).not.toBeNull()
    expect(model(room({}, {}, 'by_person'))!.answered).not.toBeNull()
    expect(model(room({}, {}, 'choosing'), { joined: true })).not.toBeNull()
  })

  it('is not there while an agent of theirs is still to answer, when the room is not collecting, or for someone not invited', () => {
    expect(model(room({}, {}, 'waiting'), { joined: true })).toBeNull()
    expect(model(room({}, {}, 'unknown' as never), { joined: true })).toBeNull()
    expect(model(room({}, { attendees: [{ memberId: ANA, required: true }] }), { joined: true })).toBeNull()
    expect(model(room({ status: 'closed' }))).toBeNull()
    expect(model(debate())).toBeNull()
    expect(
      schedulingSlotsModel({
        debate: room(),
        viewerId: 'mem_zed000000000' as never,
        timeZone: 'Asia/Seoul',
        now: START,
      }),
    ).toBeNull()
  })

  it('lets a person replace the times their agent or they themself shared while the room collects', () => {
    const byAgent = model(room({}, {}, 'by_agent'), { joined: true })!
    expect(byAgent.answered).toBe(strings.scheduling.pickAnsweredByAgent)
    const byPerson = model(room({}, {}, 'by_person'), { joined: true })!
    expect(byPerson.answered).toBe(strings.scheduling.pickAnswered)
    expect(model(room({}, {}, 'choosing'), { joined: true })!.answered).toBeNull()
  })

  it('starts from the times the person gave before, only for the hours those times cover whole', () => {
    const given = room(
      {},
      {
        freeSlots: [
          { memberId: ANA, slots: [{ startsAt: START + HOUR, endsAt: START + 3 * HOUR + HOUR / 2 }] },
          { memberId: BEN, slots: [{ startsAt: START, endsAt: START + HOUR }] },
        ],
      },
      'by_person',
    )
    const shown = model(given)!
    const picked = shown.days.flatMap((day) => day.cells).filter((cell) => cell.chosen)
    expect(picked.map((cell) => cell.startsAt)).toEqual([START + HOUR, START + 2 * HOUR])
    expect(shown.count).toBe('2 hours picked')
    expect(shown.slots).toEqual([{ startsAt: START + HOUR, endsAt: START + 3 * HOUR }])
    expect(shown.sendDisabled).toBe(false)
  })

  it('sends the picked hours with neighbours joined, and no hours when nothing is picked', () => {
    const shown = model(room(), { chosen: [START + 5 * HOUR, START, START + HOUR] })!
    expect(shown.slots).toEqual([
      { startsAt: START, endsAt: START + 2 * HOUR },
      { startsAt: START + 5 * HOUR, endsAt: START + 6 * HOUR },
    ])
    expect(shown.count).toBe('3 hours picked')
    expect(model(room(), { chosen: [] })!.slots).toEqual([])
  })

  it('refuses more separate stretches than a person may give', () => {
    const many = Array.from({ length: FREE_SLOTS_MAX + 1 }, (_, index) => START + index * 2 * HOUR)
    const wide = room({}, { window: { startsAt: START, endsAt: START + 200 * HOUR } })
    const shown = model(wide, { chosen: many })!
    expect(shown.problem).toContain(String(FREE_SLOTS_MAX))
    expect(shown.sendDisabled).toBe(true)
    expect(model(room(), { chosen: [START] })!.problem).toBeNull()
  })

  it('leaves out hours that have passed and says so when the whole window has', () => {
    const late = model(room(), { now: START + 22 * HOUR + 1 })!
    expect(late.days.flatMap((day) => day.cells)).toHaveLength(2)
    const over = model(room(), { now: START + 25 * HOUR })!
    expect(over.days).toEqual([])
    expect(over.emptyText).not.toBeNull()
  })
})

describe('freeTimeCells', () => {
  it('cuts the last hour short at the end of the window', () => {
    expect(freeTimeCells({ startsAt: 0, endsAt: HOUR + 900_000 }, 0)).toEqual([
      { startsAt: 0, endsAt: HOUR },
      { startsAt: HOUR, endsAt: HOUR + 900_000 },
    ])
  })
})

describe('slotsFromCells', () => {
  it('joins neighbours and overlaps, whatever the order', () => {
    expect(
      slotsFromCells([
        { startsAt: 4 * HOUR, endsAt: 5 * HOUR },
        { startsAt: 0, endsAt: 2 * HOUR },
        { startsAt: HOUR, endsAt: 3 * HOUR },
        { startsAt: 3 * HOUR, endsAt: 4 * HOUR },
        { startsAt: 7 * HOUR, endsAt: 8 * HOUR },
        { startsAt: 7 * HOUR, endsAt: 7 * HOUR + 900_000 },
      ]),
    ).toEqual([
      { startsAt: 0, endsAt: 5 * HOUR },
      { startsAt: 7 * HOUR, endsAt: 8 * HOUR },
    ])
  })
})
