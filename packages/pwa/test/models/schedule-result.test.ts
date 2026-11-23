import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { rangeShown, scheduleResultBody, zoneShown } from '../../src/models/schedule-result.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY } from '../support/fixtures.ts'
import { plainSpaces } from '../support/text.ts'

const ZONE = 'Asia/Seoul'
const TEN = Date.UTC(2026, 10, 20, 1)
const ELEVEN = Date.UTC(2026, 10, 20, 2)

const people = { nameOf: (id: string) => ({ [BEN]: 'Ben', [CY]: 'Cy' })[id] ?? 'Someone', viewerId: ANA }

type Slot = Extract<AsRead.RoomResult, { kind: 'slot' }>
type NoSlot = Extract<AsRead.RoomResult, { kind: 'no_slot' }>

const slot = (fields: Partial<Slot> = {}): Slot => ({
  kind: 'slot',
  startsAt: TEN,
  endsAt: ELEVEN,
  optionalFree: [],
  optionalBusy: [],
  unanswered: [],
  ...fields,
})

describe('scheduleResultBody', () => {
  it('shows the chosen time in the given time zone and nothing else when everyone is free', () => {
    const body = scheduleResultBody(slot(), people, ZONE)
    expect({ ...body, lines: plainSpaces(body.lines) }).toEqual({
      kind: 'schedule',
      outcome: 'slot',
      heading: strings.scheduling.slotHeading,
      lines: ['Friday, November 20, 10:00 – 11:00 AM GMT+9'],
    })
  })

  it('gives a viewer who is alone the plural verb that goes with you, in a sentence of its own', () => {
    const body = scheduleResultBody(slot({ optionalBusy: [ANA], unanswered: [ANA] }), people, ZONE)
    expect(body.lines.slice(1)).toEqual(['You are optional and busy then.', 'You did not answer.'])
  })

  it('says who is optional and free, optional and busy, and who did not answer, calling the viewer you', () => {
    const body = scheduleResultBody(
      slot({ optionalFree: [BEN], optionalBusy: [ANA, CY], unanswered: [BEN, CY] }),
      people,
      ZONE,
    )
    expect(body.lines.slice(1)).toEqual([
      'Ben is optional and free then.',
      'You and Cy are optional and busy then.',
      'Ben and Cy did not answer.',
    ])
  })

  it('says you in lower case in the middle of the closest option sentence', () => {
    const body = scheduleResultBody(
      { kind: 'no_slot', closest: { startsAt: TEN, endsAt: ELEVEN, missing: [BEN, ANA] }, unanswered: [] },
      people,
      ZONE,
    )
    expect(plainSpaces(body.lines[1]!)).toBe(
      'The closest option is Friday, November 20, 10:00 – 11:00 AM GMT+9, when you and Ben are busy.',
    )
  })

  it('says when no time suits every required attendee, with the closest option and who is busy then', () => {
    const none: NoSlot = {
      kind: 'no_slot',
      closest: { startsAt: TEN, endsAt: ELEVEN, missing: [BEN] },
      unanswered: [CY],
    }
    const body = scheduleResultBody(none, people, ZONE)
    expect({ ...body, lines: plainSpaces(body.lines) }).toEqual({
      kind: 'schedule',
      outcome: 'no_slot',
      heading: strings.scheduling.noSlotHeading,
      lines: [
        strings.scheduling.noSlotText,
        'The closest option is Friday, November 20, 10:00 – 11:00 AM GMT+9, when Ben is busy.',
        'Cy did not answer.',
      ],
    })
  })

  it('says so when nobody shared a free time in the window', () => {
    const none: NoSlot = { kind: 'no_slot', closest: null, unanswered: [] }
    expect(scheduleResultBody(none, people).lines).toEqual([
      strings.scheduling.noSlotText,
      strings.scheduling.nobodyFree,
    ])
  })
})

describe('rangeShown', () => {
  it('shows a time in the browser’s own time zone when none is given', () => {
    expect(rangeShown(TEN, ELEVEN)).toContain('November 2')
  })
})

describe('zoneShown', () => {
  it('names a zone the way a result shows it, and falls back to the name it was given', () => {
    expect(zoneShown('Asia/Seoul')).toBe('GMT+9')
    expect(zoneShown('Not/AZone')).toBe('Not/AZone')
  })
})
