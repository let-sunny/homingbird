import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MemberId } from '../src/ids.ts'
import { ScheduleResult } from '../src/schedule-result.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')

describe('a schedule result', () => {
  it('is a slot with who of the optional people can come, or the closest time with who cannot', () => {
    const slot = {
      kind: 'slot',
      startsAt: Date.UTC(2026, 10, 23, 9),
      endsAt: Date.UTC(2026, 10, 23, 10),
      optionalFree: [ANA],
      optionalBusy: [],
      unanswered: [BEN],
    }
    const none = { kind: 'no_slot', closest: { ...slot, missing: [BEN] }, unanswered: [] }
    expect(ScheduleResult.decode(slot)).toEqual(Result.ok(slot))
    expect(ScheduleResult.decode(none)).toEqual(
      Result.ok({
        kind: 'no_slot',
        closest: { startsAt: slot.startsAt, endsAt: slot.endsAt, missing: [BEN] },
        unanswered: [],
      }),
    )
    expect(ScheduleResult.decode({ kind: 'no_slot', closest: null, unanswered: [] })).toMatchObject({
      _tag: 'Ok',
    })
  })

  it('reads a kind it does not know as unknown, and decodes only the kinds it knows', () => {
    expect(ScheduleResult.read({ kind: 'two_slots' })).toEqual(Result.ok({ kind: 'unknown' }))
    expect(ScheduleResult.decode({ kind: 'two_slots' })).toMatchObject({ _tag: 'Err' })
  })

  it('decodes every result it can describe back to itself', () => {
    fc.assert(
      fc.property(arbitrary(ScheduleResult), (result) => {
        expect(ScheduleResult.decode(JSON.parse(JSON.stringify(result)))).toEqual(Result.ok(result))
      }),
    )
  })
})
