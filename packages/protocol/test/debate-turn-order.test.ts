import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isTakingPart, turnsTakenBy } from '../src/debate-rules.ts'
import {
  type TurnOrderFacts,
  askedTurnLater,
  isRestingReady,
  turnOrderAt,
  turnWaitMs,
} from '../src/debate-turn-order.ts'
import { MemberId } from '../src/ids.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const WAIT = 150_000

const roomOf = (
  turns: ReadonlyArray<readonly [MemberId, boolean?]>,
  overrides: Partial<TurnOrderFacts> = {},
): TurnOrderFacts => ({
  participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }],
  turns: turns.map(([memberId, ready]) => ({ memberId, ...(ready === true && { ready }) })),
  limits: { turnsPerAgent: 3 },
  askingSince: 0,
  ...overrides,
})

describe('whose turn it is', () => {
  it('asks the first agent in join order before the first turn, then the one after the latest speaker', () => {
    expect(turnOrderAt(roomOf([]), 0)).toEqual({ memberId: ANA, until: WAIT, next: [BEN, CY] })
    expect(turnOrderAt(roomOf([[ANA]]), 0)).toEqual({ memberId: BEN, until: WAIT, next: [CY] })
    expect(turnOrderAt(roomOf([[ANA], [BEN]]), 0)).toEqual({ memberId: CY, until: WAIT, next: [ANA] })
    expect(turnOrderAt(roomOf([[ANA], [CY]]), 0)).toEqual({ memberId: ANA, until: WAIT, next: [BEN] })
  })

  it('passes the turn to the next agent once the wait runs out, and comes round again', () => {
    const room = roomOf([[ANA]], { askingSince: 1_000 })
    expect(turnOrderAt(room, 1_000 + WAIT - 1)).toMatchObject({ memberId: BEN, until: 1_000 + WAIT })
    expect(turnOrderAt(room, 1_000 + WAIT)).toEqual({ memberId: CY, until: 1_000 + 2 * WAIT, next: [BEN] })
    expect(turnOrderAt(room, 1_000 + 2 * WAIT)).toMatchObject({ memberId: BEN, until: 1_000 + 3 * WAIT })
    expect(turnOrderAt(room, 0)).toMatchObject({ memberId: BEN, until: 1_000 + WAIT })
  })

  it('skips an agent that used its share or dropped out, and has no one to ask when nobody is left', () => {
    const shareUsed = roomOf([[BEN], [ANA]], { limits: { turnsPerAgent: 1 } })
    expect(turnOrderAt(shareUsed, 0)).toEqual({ memberId: CY, until: WAIT, next: [] })
    const cyAway = {
      participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY, takingPart: false }],
    }
    expect(turnOrderAt(roomOf([[ANA]], cyAway), 0)).toEqual({ memberId: BEN, until: WAIT, next: [] })
    expect(turnOrderAt(roomOf([[BEN]], cyAway), 0)).toEqual({ memberId: ANA, until: WAIT, next: [] })
    const done = roomOf([[ANA], [BEN], [CY]], { limits: { turnsPerAgent: 1 } })
    expect(turnOrderAt(done, 0)).toBeNull()
  })

  it('asks a ready agent again only after another agent takes a turn that does not say it is ready', () => {
    expect(
      turnOrderAt(
        roomOf([
          [ANA, true],
          [BEN, true],
        ]),
        0,
      ),
    ).toEqual({
      memberId: CY,
      until: WAIT,
      next: [],
    })
    expect(turnOrderAt(roomOf([[ANA, true], [BEN]]), 0)).toEqual({ memberId: CY, until: WAIT, next: [ANA] })
    expect(
      turnOrderAt(
        roomOf([
          [ANA, true],
          [BEN, true],
          [CY, true],
        ]),
        0,
      ),
    ).toBeNull()
    expect(
      isRestingReady(
        roomOf([
          [ANA, true],
          [BEN, true],
        ]),
        ANA,
      ),
    ).toBe(true)
    expect(isRestingReady(roomOf([[ANA, true], [BEN]]), ANA)).toBe(false)
    expect(isRestingReady(roomOf([[ANA], [BEN, true]]), ANA)).toBe(false)
    expect(isRestingReady(roomOf([]), ANA)).toBe(false)
  })

  it('gives an asked agent half the flock’s grace, 2.5 minutes by default', () => {
    expect(turnWaitMs({})).toBe(WAIT)
    expect(turnWaitMs({ graceMinutes: 5 })).toBe(WAIT)
    expect(turnWaitMs({ graceMinutes: 10 })).toBe(5 * 60_000)
    expect(turnWaitMs({ graceMinutes: 30 })).toBe(15 * 60_000)
    expect(turnWaitMs({ graceMinutes: 'unknown' })).toBe(WAIT)
  })
})

describe('a named turn, later', () => {
  it('passes the turn on for each wait that ran out, as the flock does when nobody speaks', () => {
    const asked = { memberId: ANA, until: WAIT, next: [BEN, CY] }
    expect(askedTurnLater(asked, {}, WAIT - 1)).toBe(asked)
    expect(askedTurnLater(asked, {}, WAIT)).toEqual({ memberId: BEN, until: 2 * WAIT, next: [CY, ANA] })
    expect(askedTurnLater(asked, {}, 3 * WAIT)).toEqual({ memberId: ANA, until: 4 * WAIT, next: [BEN, CY] })
    expect(askedTurnLater(asked, { graceMinutes: 10 }, 2 * WAIT)).toEqual({
      memberId: BEN,
      until: 3 * WAIT,
      next: [CY, ANA],
    })
  })

  it('agrees with the flock’s own order at any later time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 * WAIT }), (later) => {
        const room = roomOf([[ANA]], { askingSince: 0 })
        expect(askedTurnLater(turnOrderAt(room, 0)!, room.limits, later)).toEqual(turnOrderAt(room, later))
      }),
    )
  })
})

describe('the laws of the order', () => {
  const agent = fc.constantFrom(ANA, BEN, CY)
  const facts = fc.record({
    turns: fc.array(fc.tuple(agent, fc.boolean()), { maxLength: 9 }),
    awake: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
    share: fc.integer({ min: 1, max: 4 }),
    since: fc.integer({ min: 0, max: 10 * WAIT }),
  })
  const build = ({ turns, awake, share, since }: typeof facts extends fc.Arbitrary<infer T> ? T : never) =>
    roomOf(turns, {
      participants: [ANA, BEN, CY].map((memberId, index) => ({ memberId, takingPart: awake[index]! })),
      limits: { turnsPerAgent: share },
      askingSince: since,
    })

  it('asks one agent that has a turn coming, never the latest speaker, with the others behind it once each', () => {
    fc.assert(
      fc.property(facts, fc.integer({ min: 0, max: 20 * WAIT }), (input, later) => {
        const room = build(input)
        const now = input.since + later
        const asked = turnOrderAt(room, now)
        const coming = room.participants.filter(
          (one) =>
            isTakingPart(one) &&
            one.memberId !== room.turns.at(-1)?.memberId &&
            turnsTakenBy(room, one.memberId) < room.limits.turnsPerAgent &&
            !isRestingReady(room, one.memberId),
        )
        expect(asked === null).toBe(coming.length === 0)
        if (asked === null) return
        const order = [asked.memberId, ...asked.next]
        expect(new Set(order).size).toBe(order.length)
        expect([...order].sort()).toEqual(coming.map((one) => one.memberId).sort())
        expect(asked.until).toBeGreaterThan(now)
        expect(asked.until - now).toBeLessThanOrEqual(turnWaitMs(room.limits))
      }),
    )
  })

  it('starves nobody: while no one speaks, each agent with a turn coming is asked within one round', () => {
    fc.assert(
      fc.property(facts, (input) => {
        const room = build(input)
        const first = turnOrderAt(room, input.since)
        if (first === null) return
        const order = [first.memberId, ...first.next]
        const asked = order.map((_, round) => turnOrderAt(room, input.since + round * WAIT)!.memberId)
        expect(asked).toEqual(order)
        expect(turnOrderAt(room, input.since + order.length * WAIT)!.memberId).toBe(first.memberId)
      }),
    )
  })
})
