import { UNKNOWN } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  type SchedulingRoomInput,
  roomKindOf,
  schedulingRoomModel,
  schedulingStageOf,
} from '../../src/models/scheduling-room.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, debate, member } from '../support/fixtures.ts'
import { plainSpaces } from '../support/text.ts'

const ZONE = 'Asia/Seoul'
const TEN = Date.UTC(2026, 10, 20, 1)

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])

const meeting = (fields: Partial<SchedulingRoomInput['debate']> = {}): SchedulingRoomInput['debate'] =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    deadlineAt: Date.UTC(2026, 10, 19, 15, 30),
    schedule: {
      minutes: 60,
      window: { startsAt: Date.UTC(2026, 10, 19, 15), endsAt: Date.UTC(2026, 10, 26, 15) },
      attendees: [
        { memberId: ANA, required: true, answer: 'by_person' },
        { memberId: BEN, required: true, answer: 'by_agent' },
        { memberId: CY, required: false, answer: 'waiting' },
      ],
    },
    ...fields,
  })

const input = (room: SchedulingRoomInput['debate'], fields: Partial<SchedulingRoomInput> = {}) => ({
  debate: room,
  viewerId: ANA,
  enabled: true,
  members,
  timeZone: ZONE,
  ...fields,
})

const room = (model: ReturnType<typeof schedulingRoomModel>) => {
  if (model.kind !== 'room') throw new Error('expected a room')
  return model
}

const settledAs = (result: object) =>
  meeting({ status: 'closed', result: { draftedBy: null, draftedAt: 5, result } as never })

describe('schedulingRoomModel', () => {
  it('counts who answered of everyone invited and says what each one is doing', () => {
    const model = room(schedulingRoomModel(input(meeting())))
    expect(model.title).toBe('Planning sync')
    expect(model.answered).toBe('Answered: 2 of 3')
    expect(model.attendees).toEqual([
      {
        memberId: ANA,
        name: 'Ana (you)',
        required: 'Required',
        answer: strings.scheduling.ownAnswer.by_person,
        answered: true,
        part: null,
      },
      {
        memberId: BEN,
        name: 'Ben',
        required: 'Required',
        answer: strings.scheduling.answer.by_agent,
        answered: true,
        part: null,
      },
      {
        memberId: CY,
        name: strings.formerMember,
        required: 'Optional',
        answer: strings.scheduling.answer.waiting,
        answered: false,
        part: null,
      },
    ])
  })

  it('shows whoever opened the room where each other person’s part of the meeting stands, and no one else', () => {
    const base = meeting({ status: 'closed', createdBy: ANA })
    const attendees = [
      { memberId: ANA, required: true, answer: 'by_person', attendance: 'added' },
      { memberId: BEN, required: true, answer: 'by_agent', attendance: 'declined' },
      { memberId: CY, required: false, answer: 'by_person', attendance: 'not_invited' },
      { memberId: 'mem_dee000000000', required: false, answer: 'waiting', attendance: UNKNOWN },
      {
        memberId: 'mem_eve000000000',
        required: false,
        answer: 'waiting',
        attendance: 'from_a_later_version',
      },
    ] as never
    const settled = { ...base, schedule: { ...base.schedule!, attendees } }
    expect(room(schedulingRoomModel(input(settled))).attendees.map((one) => one.part)).toEqual([
      null,
      strings.scheduling.partOf.declined,
      strings.scheduling.partOf.not_invited,
      strings.scheduling.partOf.unknown,
      strings.scheduling.partOf.unknown,
    ])
    const seenByBen = room(schedulingRoomModel(input(settled, { viewerId: BEN })))
    expect(seenByBen.attendees.map((one) => one.part)).toEqual([null, null, null, null, null])
  })

  it('reads an attendee without an answer, or with one it does not know, as not yet answered', () => {
    const attendees = [
      { memberId: ANA, required: true },
      { memberId: BEN, required: true, answer: UNKNOWN },
    ] as never
    const base = meeting()
    const model = room(schedulingRoomModel(input({ ...base, schedule: { ...base.schedule!, attendees } })))
    expect(model.attendees.map((one) => one.answer)).toEqual([
      strings.scheduling.ownAnswer.waiting,
      strings.scheduling.answer.unknown,
    ])
    expect(model.answered).toBe('Answered: 0 of 2')
  })

  it('gives the length, the days searched and the deadline in the given time zone while collecting', () => {
    const model = room(schedulingRoomModel(input(meeting())))
    expect(model.stage).toBe('collecting')
    expect(plainSpaces(model.summary)).toEqual([
      'A 60-minute meeting',
      'A time is looked for between Nov 20 – 26, 2026.',
    ])
    expect(plainSpaces(model.deadline)).toBe('Free times are collected until Nov 20, 2026, 12:30 AM.')
    expect(model.result).toEqual({ kind: 'waiting', text: strings.scheduling.waitingForResult })
  })

  it('shows the days and hours the room is limited to on the viewer’s clock', () => {
    const base = meeting()
    const limited = (schedule: object) => ({ ...base, schedule: { ...base.schedule!, ...schedule } })
    const lines = (debateRoom: SchedulingRoomInput['debate'], timeZone = ZONE) =>
      plainSpaces(room(schedulingRoomModel(input(debateRoom, { timeZone }))).summary.slice(2))
    expect(lines(base)).toEqual([])
    const both = limited({ weekdays: [3, 1], hours: { from: 600, to: 900 }, timeZone: ZONE })
    expect(lines(both)).toEqual(['Only on Mon & Wed, from 10:00 AM to 3:00 PM.'])
    expect(lines(both, 'America/New_York')).toEqual(['Only on Tue & Sun, from 8:00 PM to 1:00 AM.'])
    expect(lines(limited({ weekdays: [5], timeZone: ZONE }))).toEqual(['Only on Fri.'])
    expect(lines(limited({ hours: { from: 540, to: 600 }, timeZone: 'UTC' }))).toEqual([
      'Only from 6:00 PM to 7:00 PM.',
    ])
  })

  it('shows the chosen time once the room settled, and no deadline', () => {
    const slot = {
      kind: 'slot',
      startsAt: TEN,
      endsAt: TEN + 3_600_000,
      optionalFree: [],
      optionalBusy: [CY],
      unanswered: [],
    }
    const model = room(schedulingRoomModel(input({ ...settledAs(slot), visibility: 'private' })))
    expect([model.stage, model.deadline, model.isPrivate]).toEqual(['settled', null, true])
    const { body } = model.result as unknown as { body: { outcome: string; lines: string[] } }
    expect([body.outcome, plainSpaces(body.lines)]).toEqual([
      'slot',
      ['Friday, November 20, 10:00 – 11:00 AM GMT+9', `${strings.formerMember} is optional and busy then.`],
    ])
  })

  it('shows that no common time was found', () => {
    const model = room(
      schedulingRoomModel(input(settledAs({ kind: 'no_slot', closest: null, unanswered: [] }))),
    )
    expect(model.result).toMatchObject({ kind: 'settled', body: { outcome: 'no_slot' } })
  })

  it('says a room that ended had no time, and a result of a kind it does not know cannot be shown', () => {
    expect(room(schedulingRoomModel(input(meeting({ status: 'ended' })))).result).toEqual({
      kind: 'ended',
      text: strings.scheduling.endedNoTime,
    })
    expect(room(schedulingRoomModel(input(settledAs({ kind: 'unknown' })))).result).toEqual({
      kind: 'unknown',
      text: strings.debates.unknownResult,
    })
  })

  it('refuses a room while the feature is off, and one that carries no schedule or is of an unknown type', () => {
    expect(schedulingRoomModel(input(meeting(), { enabled: false }))).toEqual({
      kind: 'unsupported',
      text: strings.scheduling.off,
    })
    const unsupported = { kind: 'unsupported', text: strings.scheduling.unsupported }
    expect(schedulingRoomModel(input(meeting({ schedule: null })))).toEqual(unsupported)
    expect(schedulingRoomModel(input(meeting({ type: UNKNOWN })))).toEqual(unsupported)
  })
})

describe('roomKindOf', () => {
  it('reads a room without a type as a debate and a type it does not know as unknown', () => {
    expect(
      ([undefined, 'debate', 'scheduling', UNKNOWN] as const).map((type) =>
        roomKindOf(type === undefined ? {} : { type }),
      ),
    ).toEqual(['debate', 'debate', 'scheduling', 'unknown'])
  })
})

describe('schedulingStageOf', () => {
  it('collects while the room is open or concluding and settles or ends with it', () => {
    expect(
      (['open', 'concluding', 'closed', 'ended', UNKNOWN] as const).map((status) =>
        schedulingStageOf(status),
      ),
    ).toEqual(['collecting', 'collecting', 'settled', 'ended', 'unknown'])
  })

  it('says no time was found when the room closed without a common time', () => {
    expect(schedulingStageOf('closed', 'no_slot')).toBe('no_slot')
    expect(schedulingStageOf('closed', 'slot')).toBe('settled')
  })
})
