import { DebateId, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { makeTurnHolds } from '../src/domain/debate-turn-holds.ts'

const ROOM = DebateId.of('room00000000')
const OTHER = DebateId.of('other0000000')
const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')

describe('the places kept for refused turns', () => {
  it('keeps one hold per agent and room, the latest replacing the earlier', () => {
    const holds = makeTurnHolds(() => 0)
    expect(holds.of(ROOM)).toEqual([])
    holds.keep(ROOM, { memberId: ANA, turnsTaken: 0, until: 10 })
    holds.keep(ROOM, { memberId: BEN, turnsTaken: 1, until: 20 })
    holds.keep(ROOM, { memberId: ANA, turnsTaken: 1, until: 30 })
    expect(holds.of(ROOM)).toEqual([
      { memberId: BEN, turnsTaken: 1, until: 20 },
      { memberId: ANA, turnsTaken: 1, until: 30 },
    ])
    expect(holds.of(OTHER)).toEqual([])
  })

  it('remembers a hold that ran out for an hour, so it is not given again, then forgets the room', () => {
    let now = 0
    const holds = makeTurnHolds(() => now)
    holds.keep(ROOM, { memberId: ANA, turnsTaken: 0, until: 100 })
    now = 100 + 60 * 60_000 - 1
    holds.keep(OTHER, { memberId: BEN, turnsTaken: 0, until: now + 100 })
    expect(holds.of(ROOM)).toHaveLength(1)
    now += 1
    holds.keep(OTHER, { memberId: BEN, turnsTaken: 1, until: now + 100 })
    expect(holds.of(ROOM)).toEqual([])
    expect(holds.of(OTHER)).toEqual([{ memberId: BEN, turnsTaken: 1, until: now + 100 }])
  })
})
