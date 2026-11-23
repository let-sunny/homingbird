import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DebateResult } from '../src/debate-result.ts'
import { MemberId } from '../src/ids.ts'
import { RoomResult } from '../src/room-result.ts'
import { ScheduleResult } from '../src/schedule-result.ts'

describe('a room result', () => {
  it('reads every debate result of before as it was', () => {
    fc.assert(
      fc.property(arbitrary(DebateResult), (result) => {
        const stored = JSON.parse(JSON.stringify(result))
        expect(RoomResult.read(stored)).toEqual(DebateResult.read(stored))
      }),
      { numRuns: 25 },
    )
  })

  it('reads every schedule result as it is', () => {
    fc.assert(
      fc.property(arbitrary(ScheduleResult), (result) => {
        const stored = JSON.parse(JSON.stringify(result))
        expect(RoomResult.read(stored)).toEqual(ScheduleResult.read(stored))
      }),
      { numRuns: 25 },
    )
  })

  it('decodes a slot, and reads a kind it does not know as unknown', () => {
    const slot = {
      kind: 'slot',
      startsAt: 1,
      endsAt: 2,
      optionalFree: [MemberId.of('ana000000000')],
      optionalBusy: [],
      unanswered: [],
    }
    expect(RoomResult.decode(slot)).toEqual(Result.ok(slot))
    expect(RoomResult.read({ kind: 'three_slots' })).toEqual(Result.ok({ kind: 'unknown' }))
    expect(RoomResult.decode({ kind: 'three_slots' })).toMatchObject({ _tag: 'Err' })
  })
})
