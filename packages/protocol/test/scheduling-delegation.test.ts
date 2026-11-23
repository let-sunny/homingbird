import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MemberId } from '../src/ids.ts'
import {
  DEFAULT_SCHEDULING_DELEGATION,
  DELEGATION_FIELDS,
  type SchedulingDelegation as Delegation,
  type DelegationScope,
  SchedulingDelegation,
  delegationChanges,
  isTimeZone,
  mayAddByDelegation,
  mayJoinByDelegation,
  minuteOfDayIn,
} from '../src/scheduling-delegation.ts'
import { refinements } from './contract-refinements.ts'

const ANA = MemberId.of('mem_ana')
const BEN = MemberId.of('mem_ben')
const CY = MemberId.of('mem_cy')

/** Monday 2026-11-23 at the given UTC hour and minute. */
const at = (hour: number, minute = 0) => Date.UTC(2026, 10, 23, hour, minute)

const limited = (scope: Partial<DelegationScope>, rest: Partial<Delegation> = {}): Delegation => ({
  ...DEFAULT_SCHEDULING_DELEGATION,
  ...rest,
  scope: { ...DEFAULT_SCHEDULING_DELEGATION.scope, ...scope },
})

const BEN_ROOM = { memberId: CY, openedBy: BEN, minutes: 60 }

describe('a scheduling delegation', () => {
  it('is on by default with no limit, joining and adding every meeting', () => {
    expect(DEFAULT_SCHEDULING_DELEGATION).toEqual({
      autoJoin: true,
      autoAdd: true,
      agentId: null,
      brief: '',
      scope: { people: null, hours: null, maxMinutes: null },
    })
    const long = { ...BEN_ROOM, minutes: 480 }
    expect(mayJoinByDelegation(DEFAULT_SCHEDULING_DELEGATION, long)).toBe(true)
    expect(mayAddByDelegation(DEFAULT_SCHEDULING_DELEGATION, { ...long, startsAt: at(3) })).toBe(true)
  })

  it('joins and adds nothing once the person turns either off', () => {
    expect(mayJoinByDelegation(limited({}, { autoJoin: false }), BEN_ROOM)).toBe(false)
    expect(mayAddByDelegation(limited({}, { autoJoin: false }), { ...BEN_ROOM, startsAt: at(9) })).toBe(true)
    expect(mayAddByDelegation(limited({}, { autoAdd: false }), { ...BEN_ROOM, startsAt: at(9) })).toBe(false)
    expect(mayJoinByDelegation(limited({}, { autoAdd: false }), BEN_ROOM)).toBe(true)
  })

  it('covers only rooms the chosen people opened, and always the person’s own', () => {
    const onlyAna = limited({ people: [ANA] })
    expect(mayJoinByDelegation(onlyAna, BEN_ROOM)).toBe(false)
    expect(mayAddByDelegation(onlyAna, { ...BEN_ROOM, startsAt: at(9) })).toBe(false)
    expect(mayJoinByDelegation(onlyAna, { ...BEN_ROOM, openedBy: ANA })).toBe(true)
    expect(mayAddByDelegation(onlyAna, { ...BEN_ROOM, openedBy: ANA, startsAt: at(9) })).toBe(true)
    expect(mayJoinByDelegation(onlyAna, { ...BEN_ROOM, openedBy: CY })).toBe(true)
  })

  it('covers meetings up to the longest length allowed', () => {
    const hour = limited({ maxMinutes: 60 })
    expect(mayJoinByDelegation(hour, BEN_ROOM)).toBe(true)
    expect(mayJoinByDelegation(hour, { ...BEN_ROOM, minutes: 75 })).toBe(false)
    expect(mayAddByDelegation(hour, { ...BEN_ROOM, minutes: 75, startsAt: at(9) })).toBe(false)
  })

  it('adds only meetings that fit the hours in the person’s own time zone, and joins whatever the time', () => {
    const office = limited({ hours: { from: 9 * 60, to: 18 * 60, timeZone: 'Asia/Seoul' } })
    expect(mayJoinByDelegation(office, BEN_ROOM)).toBe(true)
    expect(mayAddByDelegation(office, { ...BEN_ROOM, startsAt: at(0) })).toBe(true)
    expect(mayAddByDelegation(office, { ...BEN_ROOM, startsAt: at(8) })).toBe(true)
    expect(mayAddByDelegation(office, { ...BEN_ROOM, startsAt: at(8, 15) })).toBe(false)
    expect(mayAddByDelegation(office, { ...BEN_ROOM, startsAt: at(23, 45) })).toBe(false)
    expect(mayAddByDelegation(office, { ...BEN_ROOM, startsAt: at(9) })).toBe(false)
  })

  it('reads hours that end before they start as spanning midnight, and equal ones as the whole day', () => {
    const night = limited({ hours: { from: 22 * 60, to: 2 * 60, timeZone: 'UTC' } })
    expect(mayAddByDelegation(night, { ...BEN_ROOM, startsAt: at(22) })).toBe(true)
    expect(mayAddByDelegation(night, { ...BEN_ROOM, startsAt: at(1) })).toBe(true)
    expect(mayAddByDelegation(night, { ...BEN_ROOM, startsAt: at(1, 15) })).toBe(false)
    expect(mayAddByDelegation(night, { ...BEN_ROOM, startsAt: at(21, 45) })).toBe(false)
    const allDay = limited({ hours: { from: 6 * 60, to: 6 * 60, timeZone: 'UTC' } })
    expect(mayAddByDelegation(allDay, { ...BEN_ROOM, minutes: 480, startsAt: at(10) })).toBe(true)
  })

  it('tells the minute of the day in a time zone, whatever its offset', () => {
    expect(minuteOfDayIn('UTC', at(0))).toBe(0)
    expect(minuteOfDayIn('UTC', at(13, 45))).toBe(13 * 60 + 45)
    expect(minuteOfDayIn('Asia/Seoul', at(15))).toBe(0)
    expect(minuteOfDayIn('Asia/Kolkata', at(0))).toBe(5 * 60 + 30)
  })

  it('knows a time zone by its name', () => {
    expect(isTimeZone('Asia/Seoul')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false)
  })

  it('names the parts that changed, never their values', () => {
    const base = DEFAULT_SCHEDULING_DELEGATION
    expect(delegationChanges(base, base)).toEqual([])
    const changed = limited(
      { people: [ANA], hours: { from: 0, to: 60, timeZone: 'UTC' }, maxMinutes: 30 },
      { autoJoin: false, autoAdd: false, agentId: null, brief: 'Mornings only' },
    )
    expect(delegationChanges(base, changed)).toEqual([
      'autoJoin',
      'autoAdd',
      'brief',
      'people',
      'hours',
      'maxMinutes',
    ])
    expect(delegationChanges(base, { ...base, agentId: 'cred_ana' as Delegation['agentId'] })).toEqual([
      'agentId',
    ])
    expect(DELEGATION_FIELDS).toHaveLength(7)
  })

  it('decodes what it encodes, and refuses an unknown field, an empty list of people and a made-up zone', () => {
    fc.assert(
      fc.property(arbitrary(SchedulingDelegation, refinements), (value) => {
        expect(SchedulingDelegation.decode(JSON.parse(JSON.stringify(value)))).toEqual(Result.ok(value))
      }),
      { numRuns: 50 },
    )
    const refused = [
      { ...DEFAULT_SCHEDULING_DELEGATION, canRead: true },
      limited({ people: [] }),
      limited({ hours: { from: 0, to: 60, timeZone: 'Mars/Olympus_Mons' } }),
      limited({ hours: { from: 0, to: 24 * 60, timeZone: 'UTC' } }),
      limited({ maxMinutes: 10 }),
      { ...DEFAULT_SCHEDULING_DELEGATION, scope: { ...DEFAULT_SCHEDULING_DELEGATION.scope, extra: 1 } },
    ]
    for (const value of refused) expect(Result.isOk(SchedulingDelegation.decode(value))).toBe(false)
  })
})
