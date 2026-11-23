import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DebateResult } from '../src/debate-result.ts'
import {
  type DebateEvent,
  type DebateMove,
  type DebateRoom,
  type DebateSettlingEffect,
  type DebateStage,
  RESULT_DRAFTING_WINDOW_MS,
  RESULT_VOTING_WINDOW_MS,
  RESULT_WINDOW_MS,
  type RoomDraft,
  TURN_HOLD_MS,
  askOf,
  askedTurnOf,
  isStaleTurnRefusal,
  settleDebateRoom,
  stepDebate,
  turnHoldOf,
} from '../src/debate-room.ts'
import { isReadyToConclude, isTakingPart, limitsProblem, turnsTakenBy } from '../src/debate-rules.ts'
import { turnWaitMs } from '../src/debate-turn-order.ts'
import { DebateLimits } from '../src/debates.ts'
import { MemberId } from '../src/ids.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const DAN = MemberId.of('dan000000000')
const LIMITS = { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 }
const NOW = 1_000
const WAIT = turnWaitMs({})

const RESULT: DebateResult = {
  kind: 'conclusion',
  conclusion: 'Ship on Thursday.',
  reasons: ['Tested.'],
  contributions: [
    { memberId: ANA, summary: 'Named the report.', credits: [{ credit: 'gap_filled', turn: 1 }] },
    { memberId: BEN, summary: 'Changed position.', credits: [] },
  ],
  nextSteps: [],
}

const draft = (draftedBy: MemberId, draftedAt: number): RoomDraft => ({
  draftedBy,
  draftedAt,
  result: RESULT,
})

const roomOf = (speakers: ReadonlyArray<MemberId>, overrides: Partial<DebateRoom> = {}): DebateRoom => ({
  stage: speakers.length === 0 ? { stage: 'setup' } : { stage: 'open' },
  createdAt: 0,
  askingSince: 0,
  deadlineAt: NOW + 1,
  limits: LIMITS,
  participants: [{ memberId: ANA }, { memberId: BEN }],
  turns: speakers.map((memberId) => ({ memberId })),
  round: 0,
  drafts: [],
  votes: [],
  ...overrides,
})

const deciding = (stage: DebateStage, overrides: Partial<DebateRoom> = {}): DebateRoom =>
  roomOf([ANA, BEN], { stage, deadlineAt: 0, ...overrides })

const drafting = (overrides: Partial<DebateRoom> = {}) =>
  deciding({ stage: 'drafting', concludedAt: NOW }, overrides)

const voting = (overrides: Partial<DebateRoom> = {}) =>
  deciding({ stage: 'voting', concludedAt: NOW, votesOpenAt: NOW }, overrides)

const accepted = (room: DebateRoom, event: DebateEvent, now = NOW): DebateMove => {
  const move = stepDebate(room, event, now)
  if (!Result.isOk(move)) throw new Error(`refused: ${move.error.message}`)
  return move.value
}

const refusal = (room: DebateRoom, event: DebateEvent, now = NOW): string => {
  const move = stepDebate(room, event, now)
  if (Result.isOk(move)) throw new Error('accepted')
  return `${move.error._tag}: ${move.error.message}`
}

const settled = (room: DebateRoom, now = NOW): ReadonlyArray<DebateSettlingEffect> =>
  settleDebateRoom(room, now).effects

const turn = (memberId: MemberId, body = 'A point.'): DebateEvent => ({ type: 'turn', memberId, body })

const droppedOut = (memberId: MemberId) => ({ memberId, takingPart: false })

const readFrom = (memberId: MemberId, afterTurn: number): DebateEvent => ({
  type: 'turn',
  memberId,
  body: 'A point.',
  afterTurn,
})

type TurnEvent = Extract<DebateEvent, { readonly type: 'turn' }>

describe('whose turn it is', () => {
  it('asks the first agent to join for the first turn, then never the same agent twice in a row', () => {
    expect(askOf(roomOf([]), ANA, NOW)).toBe('turn')
    expect(askOf(roomOf([]), BEN, NOW)).toBeNull()
    expect(askOf(roomOf([ANA]), ANA, NOW)).toBeNull()
    expect(refusal(roomOf([ANA]), turn(ANA))).toMatch(/Conflict: .*no two turns in a row/)
    expect(askOf(roomOf([ANA]), BEN, NOW)).toBe('turn')
    expect(accepted(roomOf([ANA]), turn(BEN)).action).toEqual({
      type: 'addTurn',
      position: 2,
      memberId: BEN,
      body: 'A point.',
      afterTurn: null,
      ready: false,
      deadlineAt: null,
    })
  })

  it('asks one agent at a time, in join order from the one after the latest speaker', () => {
    const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
    const asked = (room: DebateRoom, now = NOW) => [ANA, BEN, CY].filter((who) => askOf(room, who, now))
    expect(asked(roomOf([], three))).toEqual([ANA])
    expect(asked(roomOf([ANA], three))).toEqual([BEN])
    expect(asked(roomOf([ANA, BEN], three))).toEqual([CY])
    expect(asked(roomOf([ANA, CY], three))).toEqual([ANA])
    expect(askedTurnOf(roomOf([ANA], three), NOW)).toEqual({ memberId: BEN, until: WAIT, next: [CY] })
    expect(askedTurnOf(roomOf([ANA], { ...three, askingSince: NOW }), NOW)).toEqual({
      memberId: BEN,
      until: NOW + WAIT,
      next: [CY],
    })
  })

  it('passes the turn of an agent that does not take it within the wait, so the flock never stalls', () => {
    const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
    const room = roomOf([ANA], { ...three, deadlineAt: 10 * WAIT })
    expect(askOf(room, BEN, WAIT - 1)).toBe('turn')
    expect(askOf(room, CY, WAIT - 1)).toBeNull()
    expect(askOf(room, BEN, WAIT)).toBeNull()
    expect(askOf(room, CY, WAIT)).toBe('turn')
    expect(askOf(room, BEN, 2 * WAIT)).toBe('turn')
    expect(settleDebateRoom(room, 2 * WAIT).effects).toEqual([])
    expect(accepted(room, turn(CY), WAIT).room.askingSince).toBe(WAIT)
  })

  it('refuses a turn out of order with whose turn it is and when the agent’s comes, never as stale', () => {
    const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
    const until = new Date(WAIT).toISOString()
    expect(refusal(roomOf([], three), turn(BEN))).toBe(
      `Conflict: It is not your turn: the flock asks ${ANA}’s agent for a turn until ${until}. Yours comes next, by ${until} if that agent lets its turn pass. Wait until the flock asks you; your turn was not saved.`,
    )
    expect(refusal(roomOf([], three), turn(CY))).toMatch(
      new RegExp(`Yours comes after 2 other agents’ turns, by ${new Date(2 * WAIT).toISOString()} if each`),
    )
    const outOfOrder = stepDebate(roomOf([ANA], three), readFrom(CY, 0), NOW)
    if (Result.isOk(outOfOrder)) throw new Error('accepted')
    expect(isStaleTurnRefusal(outOfOrder.error)).toBe(false)
    expect(outOfOrder.error.message).toMatch(
      new RegExp(`^It is not your turn: the flock asks ${BEN}’s agent`),
    )
    const anaRests = roomOf([], {
      ...three,
      stage: { stage: 'open' },
      limits: { ...LIMITS, totalTurns: 6 },
      turns: [
        { memberId: ANA, ready: true },
        { memberId: BEN, ready: true },
      ],
    })
    expect(refusal(anaRests, turn(ANA))).toMatch(
      /It is not your turn: you said you are ready to conclude, so the flock asks you again only once another agent takes a turn that does not say so\./,
    )
    const cyAway = { participants: [{ memberId: ANA }, { memberId: BEN }, droppedOut(CY)] }
    expect(refusal(roomOf([ANA], cyAway), turn(CY))).toMatch(
      /the flock has no turn coming for this agent now/,
    )
  })

  it('refuses the asked agent as stale when the flock moved on while its turn passed', () => {
    const room = roomOf([], { deadlineAt: 10 * WAIT })
    expect(askOf(room, ANA, 0)).toBe('turn')
    const benSpoke = accepted(room, turn(BEN), WAIT).room
    expect(askOf(benSpoke, ANA, WAIT)).toBe('turn')
    const stale = stepDebate(benSpoke, readFrom(ANA, 0), WAIT)
    if (Result.isOk(stale)) throw new Error('accepted')
    expect(isStaleTurnRefusal(stale.error)).toBe(true)
  })

  it('names nobody while the flock takes no turn', () => {
    expect(askedTurnOf(drafting(), NOW)).toBeNull()
    expect(askedTurnOf(roomOf([], { participants: [{ memberId: ANA }] }), NOW)).toBeNull()
    expect(askedTurnOf(roomOf([ANA], { deadlineAt: NOW }), NOW)).toBeNull()
    expect(askedTurnOf(roomOf([ANA, BEN, ANA, BEN]), NOW)).toBeNull()
  })

  it('starts the first agent’s wait when an agent is opted in, until the first turn', () => {
    expect(accepted(roomOf([]), { type: 'join', memberId: CY }, NOW).room.askingSince).toBe(NOW)
    expect(accepted(roomOf([ANA]), { type: 'join', memberId: CY }, NOW).room.askingSince).toBe(0)
  })

  it('starves nobody: an agent speaking as asked gets its share, whatever turns pass, unless it alone is left after its own turn', () => {
    const agents = [ANA, BEN, CY]
    const plan = fc.array(fc.boolean(), { minLength: 40, maxLength: 40 })
    fc.assert(
      fc.property(plan, fc.integer({ min: 1, max: 3 }), (speaks, share) => {
        let room = roomOf([], {
          participants: agents.map((memberId) => ({ memberId })),
          limits: { turnsPerAgent: share, totalTurns: share * 3, minutes: 10_080, turnCharacters: 300 },
          deadlineAt: 10_080 * 60_000,
        })
        let now = 0
        for (const speak of [...speaks, ...Array<boolean>(3 * share).fill(true)]) {
          if (room.stage.stage !== 'setup' && room.stage.stage !== 'open') break
          const asked = agents.filter((who) => askOf(room, who, now) === 'turn')
          expect(asked).toHaveLength(1)
          if (speak) room = accepted(room, turn(asked[0]!), now).room
          else now += WAIT
        }
        expect(room.stage.stage).toBe('drafting')
        const short = agents.filter((who) => turnsTakenBy(room, who) < share)
        expect(short.filter((who) => who !== room.turns.at(-1)?.memberId)).toEqual([])
      }),
    )
  })

  it('starts the flock’s time with the first turn, so setting the flock up takes none of it', () => {
    const first = accepted(roomOf([], { createdAt: 0, deadlineAt: LIMITS.minutes * 60_000 }), turn(ANA), NOW)
    expect(first.action).toMatchObject({ deadlineAt: NOW + LIMITS.minutes * 60_000 })
    expect(first.room.deadlineAt).toBe(NOW + LIMITS.minutes * 60_000)
    expect(accepted(roomOf([ANA]), turn(BEN)).room.deadlineAt).toBe(NOW + 1)
  })

  it('names why a turn is refused: the flock, the agent, a missing second agent, or a used share', () => {
    expect(refusal(drafting(), turn(ANA))).toMatch(/no more turns/)
    expect(refusal(roomOf([ANA], { deadlineAt: NOW }), turn(BEN))).toMatch(/no more turns/)
    expect(refusal(roomOf([ANA, BEN, ANA, BEN]), turn(ANA))).toMatch(/no more turns/)
    expect(refusal(roomOf([]), turn(CY))).toMatch(/not opted in/)
    expect(refusal(roomOf([], { participants: [{ memberId: ANA }] }), turn(ANA))).toMatch(/second agent/)
    const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
    expect(
      refusal(roomOf([ANA, BEN, ANA, CY], { ...three, limits: { ...LIMITS, totalTurns: 6 } }), turn(ANA)),
    ).toMatch(/used all its turns/)
    expect(askOf(roomOf([ANA, BEN, ANA, BEN]), BEN, NOW)).toBeNull()
  })

  it('refuses a blank turn and one over the flock’s cap as invalid', () => {
    expect(refusal(roomOf([]), turn(ANA, ' '))).toMatch(/Invalid: A turn needs some text/)
    expect(refusal(roomOf([]), turn(ANA, 'x'.repeat(301)))).toMatch(/Invalid: .*at most 300/)
    expect(refusal(roomOf([]), turn(ANA, 'x'.repeat(342)))).toMatch(/this one has 342, 42 over\./)
  })

  it('never lets an agent pass its share, the total or the deadline, whatever the order of turns', () => {
    const order = fc.array(fc.constantFrom(ANA, BEN, CY), { maxLength: 12 })
    fc.assert(
      fc.property(order, fc.integer({ min: 0, max: 2 * NOW }), (speakers, now) => {
        const room = roomOf(speakers, {
          participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }],
        })
        for (const who of [ANA, BEN, CY])
          if (askOf(room, who, now) === 'turn') {
            expect(turnsTakenBy(room, who)).toBeLessThan(LIMITS.turnsPerAgent)
            expect(speakers.length).toBeLessThan(LIMITS.totalTurns)
            expect(now).toBeLessThan(room.deadlineAt)
            expect(speakers.at(-1)).not.toBe(who)
          }
      }),
    )
  })

  it('stops exactly when time is up, the total is reached, or nobody may speak', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(ANA, BEN), { maxLength: 6 }), (speakers) => {
        const room = roomOf(speakers)
        const anyoneMay = [ANA, BEN].some((who) => askOf(room, who, NOW) === 'turn')
        expect(settled(room).length > 0).toBe(!anyoneMay)
      }),
    )
    expect(settled(roomOf([], { deadlineAt: NOW }))).toEqual([
      { type: 'end', because: 'no_turns', during: 'turns' },
    ])
    expect(settled(roomOf([], { participants: [{ memberId: ANA }] }))).toEqual([])
  })

  it('stops a flock at once with the turn that reaches its limit', () => {
    const move = accepted(roomOf([ANA, BEN, ANA]), turn(BEN))
    expect(move.after).toEqual([{ type: 'conclude', because: 'limit' }])
    expect(move.room.stage).toEqual({ stage: 'drafting', concludedAt: NOW })
    expect(accepted(roomOf([ANA]), turn(BEN)).after).toEqual([])
  })

  it('stops a flock by time before it takes a turn, and refuses the turn', () => {
    expect(settled(roomOf([ANA], { deadlineAt: NOW }))).toEqual([{ type: 'conclude', because: 'time' }])
  })
})

describe('a flock whose agents agree', () => {
  const ready = (memberId: MemberId): DebateEvent => ({
    type: 'turn',
    memberId,
    body: 'Agreed.',
    ready: true,
  })
  const wide = { limits: { ...LIMITS, totalTurns: 12, turnsPerAgent: 4 } }
  const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
  const said = (...turns: ReadonlyArray<readonly [MemberId, boolean]>) =>
    turns.map(([memberId, isReady]) => ({ memberId, ready: isReady }))
  const UNCREDITED: DebateResult = {
    ...RESULT,
    contributions: RESULT.contributions.map((contribution) => ({ ...contribution, credits: [] })),
  }

  it('stops taking turns once every agent’s latest turn says it is ready, and asks each for a draft', () => {
    const first = accepted(roomOf([], wide), ready(ANA))
    expect(first.action).toMatchObject({ type: 'addTurn', ready: true })
    expect(first.after).toEqual([])
    const move = accepted(first.room, ready(BEN))
    expect(move.after).toEqual([{ type: 'conclude', because: 'agreed' }])
    expect(move.room.stage).toEqual({ stage: 'drafting', concludedAt: NOW })
    expect(askOf(move.room, ANA, NOW)).toBe('result')
    expect(refusal(move.room, ready(ANA))).toMatch(/no more turns/)
  })

  it('takes an agent’s readiness back with a later turn that does not say it', () => {
    const room = roomOf([], {
      ...wide,
      stage: { stage: 'open' },
      turns: said([ANA, true], [BEN, false], [ANA, false]),
    })
    const benReady = accepted(room, ready(BEN))
    expect(benReady.after).toEqual([])
    expect(accepted(benReady.room, ready(ANA)).after).toEqual([{ type: 'conclude', because: 'agreed' }])
  })

  it('concludes when the asked agent says it is ready and every other agent already did', () => {
    const room = roomOf([], {
      ...three,
      ...wide,
      stage: { stage: 'open' },
      turns: said([ANA, false], [BEN, true], [CY, true]),
    })
    expect(askOf(room, ANA, NOW)).toBe('turn')
    expect(askOf(room, BEN, NOW)).toBeNull()
    expect(accepted(room, ready(ANA)).after).toEqual([{ type: 'conclude', because: 'agreed' }])
    expect(askedTurnOf(accepted(room, turn(ANA)).room, NOW)).toMatchObject({ memberId: BEN, next: [CY] })
  })

  it('counts an agent that used all its turns as ready, and one that has not spoken as not', () => {
    const anaDone = roomOf([], {
      ...three,
      limits: { ...LIMITS, totalTurns: 12 },
      stage: { stage: 'open' },
      askingSince: NOW - WAIT,
      turns: said([ANA, false], [BEN, false], [ANA, false]),
    })
    const cyReady = accepted(anaDone, ready(CY))
    expect(cyReady.after).toEqual([])
    expect(accepted(cyReady.room, ready(BEN)).after).toEqual([{ type: 'conclude', because: 'agreed' }])
    const cySilent = roomOf([], { ...three, ...wide, stage: { stage: 'open' }, turns: said([ANA, true]) })
    expect(accepted(cySilent, ready(BEN)).after).toEqual([])
  })

  it('leaves an agent that dropped out out of the agreement, so the flock concludes when it settles', () => {
    const cyAsleep = { participants: [{ memberId: ANA }, { memberId: BEN }, droppedOut(CY)] }
    const room = roomOf([], {
      ...cyAsleep,
      ...wide,
      stage: { stage: 'open' },
      turns: said([ANA, true], [BEN, true]),
    })
    expect(settled(room)).toEqual([{ type: 'conclude', because: 'agreed' }])
    expect(settled({ ...room, participants: three.participants })).toEqual([])
  })

  it('names the limit, not agreement, when the agreeing turn also reaches the total', () => {
    const room = roomOf([], { stage: { stage: 'open' }, turns: said([ANA, true], [BEN, false], [ANA, true]) })
    expect(accepted(room, ready(BEN)).after).toEqual([{ type: 'conclude', because: 'limit' }])
  })

  it('never concludes by agreement while an agent taking part dissents, and keeps the flock open while one may speak', () => {
    const turns = fc.array(fc.tuple(fc.constantFrom(ANA, BEN, CY), fc.boolean()), { maxLength: 14 })
    const awake = fc.record({ ana: fc.boolean(), ben: fc.boolean(), cy: fc.boolean() })
    fc.assert(
      fc.property(turns, awake, (said, { ana, ben, cy }) => {
        const participants = [
          { memberId: ANA, takingPart: ana },
          { memberId: BEN, takingPart: ben },
          { memberId: CY, takingPart: cy },
        ]
        let room = roomOf([], { participants, ...wide })
        for (const [memberId, isReady] of said) {
          const move = stepDebate(room, { type: 'turn', memberId, body: 'A point.', ready: isReady }, NOW)
          if (!Result.isOk(move)) continue
          room = move.value.room
          const takingPart = participants.filter(isTakingPart)
          const dissents = takingPart.some((one) => !isReadyToConclude(room, one.memberId))
          const agreed = move.value.after.some(
            (effect) => effect.type === 'conclude' && effect.because === 'agreed',
          )
          if (agreed) expect(dissents).toBe(false)
          const reopened = { ...room, stage: { stage: 'open' as const } }
          const mayContinue =
            takingPart.length >= 2 && takingPart.some((one) => askOf(reopened, one.memberId, NOW) === 'turn')
          if (dissents && mayContinue) {
            expect(move.value.after).toEqual([])
            expect(room.stage).toEqual({ stage: 'open' })
          }
        }
      }),
    )
  })

  it('never skips the vote: an agreed flock collects every agent’s draft, then puts them to a vote', () => {
    const turns = fc.array(fc.tuple(fc.constantFrom(ANA, BEN), fc.boolean()), { maxLength: 8 })
    fc.assert(
      fc.property(turns, (said) => {
        let room = roomOf([], wide)
        for (const [memberId, isReady] of said) {
          const move = stepDebate(room, { type: 'turn', memberId, body: 'A point.', ready: isReady }, NOW)
          if (!Result.isOk(move)) continue
          room = move.value.room
          if (!move.value.after.some((effect) => effect.type === 'conclude' && effect.because === 'agreed'))
            continue
          expect(move.value.after).toHaveLength(1)
          expect(room.stage).toEqual({ stage: 'drafting', concludedAt: NOW })
          const first = accepted(room, { type: 'draft', memberId: ANA, result: UNCREDITED })
          expect(first.after).toEqual([])
          const second = accepted(first.room, { type: 'draft', memberId: BEN, result: UNCREDITED })
          expect(second.after).toEqual([{ type: 'openVote', round: 0 }])
          expect(second.room.stage.stage).toBe('voting')
        }
      }),
    )
  })
})

describe('an agent that dropped out', () => {
  it('is skipped: the flock stops once no agent taking part has a turn left, but never before its first turn', () => {
    const cyAsleep = { participants: [{ memberId: ANA }, { memberId: BEN }, droppedOut(CY)] }
    expect(settled(roomOf([ANA, CY, BEN], cyAsleep))).toEqual([])
    expect(settled(roomOf([ANA, BEN], { ...cyAsleep, limits: { ...LIMITS, turnsPerAgent: 1 } }))).toEqual([
      { type: 'conclude', because: 'limit' },
    ])
    expect(settled(roomOf([], { participants: [droppedOut(ANA), droppedOut(BEN)] }))).toEqual([])
  })

  it('closes a started debate as it is when one agent is left taking part, and never before its first turn', () => {
    const benAsleep = { participants: [{ memberId: ANA }, droppedOut(BEN)] }
    expect(settled(roomOf([BEN], benAsleep))).toEqual([
      { type: 'end', because: 'one_agent_left', during: 'turns' },
    ])
    expect(settled(roomOf([ANA], { participants: [droppedOut(ANA), droppedOut(BEN)] }))).toEqual([
      { type: 'end', because: 'no_agent_left', during: 'turns' },
    ])
    expect(settled(roomOf([], benAsleep))).toEqual([])
    expect(settled(roomOf([], { ...benAsleep, deadlineAt: NOW }))).toEqual([
      { type: 'end', because: 'no_turns', during: 'turns' },
    ])
    const cyAsleep = { participants: [{ memberId: ANA }, { memberId: BEN }, droppedOut(CY)] }
    expect(settled(roomOf([CY], { ...cyAsleep, deadlineAt: NOW }))).toEqual([
      { type: 'conclude', because: 'time' },
    ])
  })

  it('ends a flock deciding its result as soon as fewer than two agents are left, whatever it collected', () => {
    const benAsleep = { participants: [{ memberId: ANA }, droppedOut(BEN)], drafts: [draft(ANA, NOW)] }
    expect(settled(drafting(benAsleep))).toEqual([
      { type: 'end', because: 'one_agent_left', during: 'result' },
    ])
    expect(settled(voting({ participants: [droppedOut(ANA), droppedOut(BEN)] }))).toEqual([
      { type: 'end', because: 'no_agent_left', during: 'result' },
    ])
  })

  it('never makes the flock wait: with any agents dropped out, it stops exactly when no agent taking part may speak or one is left', () => {
    const order = fc.array(fc.constantFrom(ANA, BEN, CY), { minLength: 1, maxLength: 8 })
    const awake = fc.record({ ana: fc.boolean(), ben: fc.boolean(), cy: fc.boolean() })
    fc.assert(
      fc.property(order, awake, (speakers, { ana, ben, cy }) => {
        const participants = [
          { memberId: ANA, takingPart: ana },
          { memberId: BEN, takingPart: ben },
          { memberId: CY, takingPart: cy },
        ]
        const room = roomOf(speakers, {
          participants,
          limits: { ...LIMITS, totalTurns: 12, turnsPerAgent: 4 },
        })
        const takingPartMay = participants.some(
          (one) => one.takingPart && askOf(room, one.memberId, NOW) === 'turn',
        )
        const debating = participants.filter((one) => one.takingPart).length >= 2
        expect(settled(room).length > 0).toBe(!takingPartMay || !debating)
      }),
    )
  })
})

describe('a flock that stops', () => {
  it('ends without a result with fewer than two agents or no turn, and otherwise asks for one', () => {
    const atDeadline = { deadlineAt: NOW }
    const endedBecause = (room: DebateRoom) => settleDebateRoom(room, NOW).room.stage
    expect(endedBecause(roomOf([], { ...atDeadline, participants: [{ memberId: ANA }] }))).toEqual({
      stage: 'ended',
      because: 'too_few_agents',
    })
    expect(endedBecause(roomOf([ANA], { ...atDeadline, participants: [] }))).toEqual({
      stage: 'ended',
      because: 'too_few_agents',
    })
    expect(endedBecause(roomOf([], atDeadline))).toEqual({ stage: 'ended', because: 'no_turns' })
    expect(endedBecause(roomOf([ANA], atDeadline))).toEqual({ stage: 'drafting', concludedAt: NOW })
    expect(askOf(roomOf([ANA], { stage: { stage: 'ended', because: 'no_turns' } }), BEN, NOW)).toBeNull()
  })
})

describe('agents joining', () => {
  it('takes a new agent while the flock takes turns, once per person and up to the most a flock holds', () => {
    expect(accepted(roomOf([ANA]), { type: 'join', memberId: CY })).toMatchObject({
      action: { type: 'addParticipant', memberId: CY },
      after: [],
      room: { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] },
    })
    expect(refusal(roomOf([]), { type: 'join', memberId: ANA })).toMatch(/already takes part/)
    expect(refusal(drafting(), { type: 'join', memberId: CY })).toMatch(/takes no more agents/)
    const full = Array.from({ length: 8 }, (_, index) => ({ memberId: MemberId.of(`agent${index}0000000`) }))
    expect(refusal(roomOf([], { participants: full }), { type: 'join', memberId: CY })).toMatch(/at most 8/)
  })
})

describe('limits', () => {
  const wished = { turnsPerAgent: 3, totalTurns: 6, minutes: 10, turnCharacters: 400 }

  it('change only at setup, before the first turn', () => {
    const move = accepted(roomOf([], { limits: { ...LIMITS, graceMinutes: 10 } }), {
      type: 'setLimits',
      limits: wished,
    })
    expect(move.action).toEqual({
      type: 'changeLimits',
      limits: { ...wished, totalFollowsAgents: false, graceMinutes: 10 },
      deadlineAt: 10 * 60_000,
    })
    expect(move.after).toEqual([])
    expect(refusal(roomOf([ANA]), { type: 'setLimits', limits: wished })).toMatch(
      /Conflict: Limits can be changed only at setup/,
    )
    expect(refusal(drafting(), { type: 'setLimits', limits: wished })).toMatch(/no longer takes turns/)
    expect(refusal(roomOf([]), { type: 'setLimits', limits: { ...wished, turnsPerAgent: 7 } })).toMatch(
      /Invalid: Turns per agent cannot be more/,
    )
  })

  it('keep the flock’s grace unless new limits name one', () => {
    const withGrace = { ...wished, graceMinutes: 30 } as const
    expect(accepted(roomOf([]), { type: 'setLimits', limits: withGrace }).action).toMatchObject({
      limits: withGrace,
    })
    expect(accepted(roomOf([]), { type: 'setLimits', limits: wished }).action).toMatchObject({
      limits: wished,
    })
  })

  it('stop a flock whose new time is already up', () => {
    const move = accepted(roomOf([], { createdAt: -wished.minutes * 60_000 }), {
      type: 'setLimits',
      limits: wished,
    })
    expect(move.after).toEqual([{ type: 'end', because: 'no_turns', during: 'turns' }])
  })
})

describe('a total that follows the agents', () => {
  const following = { ...LIMITS, totalTurns: 4, totalFollowsAgents: true }

  it('gives every agent opted in its turns until the first turn, then stays', () => {
    const joined = accepted(roomOf([], { limits: following }), { type: 'join', memberId: CY })
    expect(joined.action).toEqual({ type: 'addParticipant', memberId: CY, totalTurns: 6 })
    expect(joined.room.limits.totalTurns).toBe(6)
    const started = accepted(roomOf([ANA], { limits: following }), { type: 'join', memberId: CY })
    expect(started.action).toEqual({ type: 'addParticipant', memberId: CY, totalTurns: null })
    expect(started.room.limits.totalTurns).toBe(4)
    expect(accepted(roomOf([]), { type: 'join', memberId: CY }).action).toMatchObject({ totalTurns: null })
  })

  it('follows the agents already in the flock when a person sets limits without a total', () => {
    const { totalTurns: _, ...withoutTotal } = { ...LIMITS, turnsPerAgent: 4 }
    expect(accepted(roomOf([]), { type: 'setLimits', limits: withoutTotal }).action).toMatchObject({
      limits: { turnsPerAgent: 4, totalTurns: 8, totalFollowsAgents: true },
    })
  })
})

describe('a turn written against an older flock', () => {
  const readTo = (memberId: MemberId, afterTurn: number, body = 'A point.'): TurnEvent => ({
    type: 'turn',
    memberId,
    body,
    afterTurn,
  })
  const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }

  it('is refused when the flock moved past the turn its agent read, and saved when it did not', () => {
    expect(refusal(roomOf([ANA, BEN], three), readTo(CY, 1))).toMatch(
      /^Conflict: The flock moved on: turns 2 to 2 were taken after turn 1, the last you read\. Your turn was not saved: rewrite it in the light of the turns you missed\./,
    )
    const stale = stepDebate(roomOf([ANA, BEN], three), readTo(CY, 1), NOW)
    if (Result.isOk(stale)) throw new Error('accepted')
    expect(isStaleTurnRefusal(stale.error)).toBe(true)
    expect(isStaleTurnRefusal({ _tag: 'Invalid', message: stale.error.message })).toBe(false)
    expect(isStaleTurnRefusal({ _tag: 'Conflict', message: 'This flock takes no more turns.' })).toBe(false)
    expect(isStaleTurnRefusal({ _tag: 'Conflict', message: 'The flock moved on.' })).toBe(false)
    expect(isStaleTurnRefusal({ _tag: 'Conflict', message: `Note: ${stale.error.message}` })).toBe(false)
    expect(accepted(roomOf([ANA], three), readTo(BEN, 1)).action).toMatchObject({ afterTurn: 1, position: 2 })
    expect(accepted(roomOf([ANA], three), readTo(BEN, 1)).room.turns.at(-1)).toEqual({
      memberId: BEN,
      afterTurn: 1,
      ready: false,
    })
  })

  it('keeps the place of a turn refused for its length or for being stale, once per turn of its own', () => {
    const room = roomOf([ANA, BEN, ANA], { ...three, askingSince: NOW - WAIT })
    const tooLong = readTo(CY, 3, 'x'.repeat(301))
    expect(turnHoldOf(room, tooLong, NOW)).toEqual({ memberId: CY, turnsTaken: 0, until: NOW + TURN_HOLD_MS })
    expect(turnHoldOf(room, readTo(CY, 2), NOW)).toEqual({
      memberId: CY,
      turnsTaken: 0,
      until: NOW + TURN_HOLD_MS,
    })
    expect(refusal(room, tooLong)).toMatch(
      new RegExp(`Your place in the flock is kept until ${new Date(NOW + TURN_HOLD_MS).toISOString()}`),
    )
    expect(turnHoldOf(room, readTo(CY, 3), NOW)).toBeNull()
    expect(turnHoldOf(room, readTo(CY, 3, ' '), NOW)).toBeNull()
    expect(turnHoldOf(room, readTo(ANA, 3, 'x'.repeat(301)), NOW)).toBeNull()
    const held = { ...room, holds: [{ memberId: CY, turnsTaken: 0, until: NOW + 10 }] }
    expect(turnHoldOf(held, tooLong, NOW)).toBeNull()
    expect(refusal(held, tooLong)).toMatch(/kept until 1970-01-01T00:00:01\.010Z/)
    const ranOut = { ...room, holds: [{ memberId: CY, turnsTaken: 0, until: NOW }] }
    expect(turnHoldOf(ranOut, tooLong, NOW)).toBeNull()
    expect(refusal(ranOut, tooLong)).toBe(
      'Invalid: A turn in this flock holds at most 300 characters; this one has 301, 1 over.',
    )
    for (const other of [
      { memberId: BEN, turnsTaken: 0, until: NOW + 10 },
      { memberId: CY, turnsTaken: 1, until: NOW + 10 },
    ])
      expect(turnHoldOf({ ...room, holds: [other] }, tooLong, NOW)).not.toBeNull()
  })

  const until = WAIT - 10 + TURN_HOLD_MS
  const holds = [{ memberId: BEN, turnsTaken: 0, until }]

  it('keeps the turn of an asked agent whose turn was refused until its hold ends, then asks the next', () => {
    const room = roomOf([ANA], { ...three, holds, deadlineAt: 10 * WAIT })
    expect(askedTurnOf(room, WAIT + 5)).toEqual({ memberId: BEN, until, next: [CY] })
    expect(askOf(room, CY, WAIT + 5)).toBeNull()
    expect(refusal(room, turn(CY), WAIT + 5)).toMatch(/the flock asks .*ben000000000’s agent/)
    expect(accepted(room, turn(BEN), WAIT + 5).action).toMatchObject({ position: 2, memberId: BEN })
    expect(askedTurnOf(room, until)).toEqual({ memberId: CY, until: until + WAIT, next: [BEN] })
    expect(askedTurnOf(room, until + WAIT)).toMatchObject({ memberId: BEN, until: until + 2 * WAIT })
    const early = [{ memberId: BEN, turnsTaken: 0, until: 10 + TURN_HOLD_MS }]
    expect(askedTurnOf({ ...room, holds: early }, WAIT - 1)).toEqual({
      memberId: BEN,
      until: WAIT,
      next: [CY],
    })
    expect(askedTurnOf({ ...room, holds: early }, WAIT)).toMatchObject({ memberId: CY })
    for (const ignored of [
      { memberId: CY, turnsTaken: 0, until },
      { memberId: BEN, turnsTaken: 1, until },
      { memberId: BEN, turnsTaken: 0, until: TURN_HOLD_MS - 1 },
    ])
      expect(askedTurnOf({ ...room, askingSince: 0, holds: [ignored] }, WAIT + 5)).toMatchObject({
        memberId: CY,
      })
    const gone = [{ memberId: ANA }, droppedOut(BEN), { memberId: CY }]
    expect(askedTurnOf({ ...room, participants: gone }, WAIT + 5)).toMatchObject({ memberId: CY })
    expect(settled(room, WAIT + 5)).toEqual([])
  })

  it('keeps each refused turn in the order the flock asked them, one after another', () => {
    const cyRefusedAt = until + 10
    const chain = [{ memberId: CY, turnsTaken: 0, until: cyRefusedAt + TURN_HOLD_MS }, holds[0]!]
    const room = roomOf([ANA], { ...three, holds: chain, deadlineAt: 10 * WAIT })
    expect(askedTurnOf(room, until + 20)).toEqual({ memberId: CY, until: until + WAIT, next: [BEN] })
    expect(askedTurnOf(room, until + WAIT)).toMatchObject({ memberId: BEN, until: until + 2 * WAIT })
  })
})

describe('collecting drafts of the result', () => {
  const draftBy = (memberId: MemberId): DebateEvent => ({ type: 'draft', memberId, result: RESULT })

  it('asks each agent for a draft until it drafted one', () => {
    expect(askOf(drafting(), ANA, NOW)).toBe('result')
    expect(askOf(drafting({ drafts: [draft(ANA, NOW)] }), ANA, NOW)).toBeNull()
  })

  it('takes one draft per agent and round, fitting the flock, while the flock collects drafts', () => {
    expect(accepted(drafting(), draftBy(ANA))).toMatchObject({
      action: { type: 'addDraft', round: 0, memberId: ANA, result: RESULT },
      after: [],
      room: { drafts: [draft(ANA, NOW)] },
    })
    expect(refusal(drafting({ drafts: [draft(ANA, NOW)] }), draftBy(ANA))).toMatch(/already drafted/)
    expect(refusal(voting({ drafts: [draft(ANA, NOW), draft(BEN, NOW)] }), draftBy(ANA))).toMatch(
      /voting on this round’s drafts/,
    )
    expect(refusal(roomOf([ANA]), draftBy(ANA))).toMatch(/once the flock’s turns have run out/)
    const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
    expect(refusal(drafting(three), draftBy(ANA))).toMatch(/Invalid: .*missing/)
  })

  it('checks each credit against the turns, and leaves out a credit that names no turn', () => {
    const crediting = (credits: DebateResult['contributions'][number]['credits']): DebateEvent => ({
      type: 'draft',
      memberId: ANA,
      result: {
        ...RESULT,
        contributions: [{ ...RESULT.contributions[0]!, credits }, RESULT.contributions[1]!],
      },
    })
    expect(refusal(drafting(), crediting([{ credit: 'gap_filled', turn: 2 }]))).toMatch(
      /Invalid: The credit gap_filled for .* names turn 2, which is not a turn of that agent’s/,
    )
    const kept = accepted(drafting(), crediting(['gap_filled', { credit: 'gap_filled', turn: 1 }]))
    expect(kept.action).toMatchObject({
      result: { contributions: [{ credits: [{ credit: 'gap_filled', turn: 1 }] }, { credits: [] }] },
    })
  })

  it('opens the vote once every agent taking part drafted, or the window closed', () => {
    expect(accepted(drafting({ drafts: [draft(ANA, NOW)] }), draftBy(BEN)).after).toEqual([
      { type: 'openVote', round: 0 },
    ])
    const three = {
      participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }],
      drafts: [draft(ANA, NOW), draft(BEN, NOW + 1)],
    }
    expect(settled(drafting(three), NOW + RESULT_DRAFTING_WINDOW_MS - 1)).toEqual([])
    const opened = settleDebateRoom(drafting(three), NOW + RESULT_DRAFTING_WINDOW_MS)
    expect(opened.effects).toEqual([{ type: 'openVote', round: 0 }])
    expect(opened.room.stage).toEqual({
      stage: 'voting',
      concludedAt: NOW,
      votesOpenAt: NOW + RESULT_DRAFTING_WINDOW_MS,
    })
  })

  it('takes a single draft as the result, with no vote', () => {
    const alone = drafting({ drafts: [draft(ANA, NOW)] })
    expect(settled(alone, NOW + RESULT_DRAFTING_WINDOW_MS - 1)).toEqual([])
    expect(settled(alone, NOW + RESULT_DRAFTING_WINDOW_MS)).toEqual([
      {
        type: 'close',
        round: 0,
        chosen: draft(ANA, NOW),
        votes: 0,
        drafts: 1,
        droppedOut: [],
        credits: [
          { memberId: ANA, credit: 'conclusion' },
          { memberId: ANA, credit: 'gap_filled' },
          { memberId: BEN, credit: 'conclusion' },
        ],
        replacing: null,
      },
    ])
  })
})

describe('choosing the result by vote', () => {
  const winnerOf = (drafts: ReadonlyArray<RoomDraft>, votes: ReadonlyArray<MemberId>) => {
    const effects = settled(
      voting({
        participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }],
        drafts,
        votes: votes.map((draftBy) => ({ voterId: DAN, draftBy })),
      }),
      NOW + RESULT_VOTING_WINDOW_MS,
    )
    const close = effects.find((effect) => effect.type === 'close')
    return close?.chosen ?? null
  }

  it('takes the draft with the most votes, a tie going to the earliest, and nothing from no drafts', () => {
    const drafts = [draft(BEN, 2), draft(ANA, 1), draft(CY, 3)]
    expect(winnerOf(drafts, [CY, CY, ANA])).toEqual(draft(CY, 3))
    expect(winnerOf(drafts, [BEN, CY])).toEqual(draft(BEN, 2))
    expect(winnerOf(drafts, [])).toEqual(draft(ANA, 1))
    expect(winnerOf([], [])).toBeNull()
  })

  it('always picks a draft no other draft beats on votes, and the earliest of those', () => {
    const people = fc.constantFrom(ANA, BEN, CY)
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({ draftedBy: people, draftedAt: fc.integer({ min: 0, max: 50 }) }).map((one) => ({
            ...one,
            result: RESULT,
          })),
          { selector: (one) => one.draftedBy, minLength: 1 },
        ),
        fc.array(people),
        (drafts, votes) => {
          const tally = (by: MemberId) => votes.filter((vote) => vote === by).length
          const winner = winnerOf(drafts, votes)!
          const best = Math.max(...drafts.map((one) => tally(one.draftedBy)))
          expect(tally(winner.draftedBy)).toBe(best)
          const tied = drafts.filter((one) => tally(one.draftedBy) === best)
          expect(winner.draftedAt).toBe(Math.min(...tied.map((one) => one.draftedAt)))
        },
      ),
    )
  })

  it('asks only agents taking part for a vote, each needing a draft by another agent, and only once', () => {
    const participants = [{ memberId: ANA }, droppedOut(BEN), { memberId: CY }]
    const ballots = (room: DebateRoom) => [ANA, BEN, CY].filter((who) => askOf(room, who, NOW) === 'ballot')
    expect(ballots(voting({ participants, drafts: [draft(ANA, 1)] }))).toEqual([CY])
    expect(ballots(voting({ participants, drafts: [draft(ANA, 1), draft(CY, 2)] }))).toEqual([ANA, CY])
    expect(
      ballots(
        voting({
          participants,
          drafts: [draft(ANA, 1), draft(CY, 2)],
          votes: [{ voterId: CY, draftBy: ANA }],
        }),
      ),
    ).toEqual([ANA])
    expect(ballots(voting({ participants }))).toEqual([])
  })

  it('names why a vote is refused: a stranger, an agent that dropped out, its own draft, no such draft, a second vote', () => {
    const room = voting({
      participants: [{ memberId: ANA }, droppedOut(BEN), { memberId: CY }],
      drafts: [draft(ANA, 1), draft(BEN, 2)],
      votes: [{ voterId: CY, draftBy: ANA }],
    })
    const vote = (memberId: MemberId, draftBy: MemberId, round = 0): DebateEvent => ({
      type: 'vote',
      memberId,
      vote: { round, draftBy },
    })
    expect(refusal(room, vote(DAN, ANA))).toMatch(/not opted in/)
    expect(refusal(room, vote(BEN, ANA))).toMatch(/dropped out of the debate/)
    expect(refusal(room, vote(ANA, ANA))).toMatch(/its own draft/)
    expect(refusal(room, vote(ANA, CY))).toMatch(/no such draft/)
    expect(refusal(room, vote(CY, BEN))).toMatch(/already voted/)
    expect(refusal(room, vote(ANA, BEN, 1))).toMatch(/That round is over/)
    expect(refusal(drafting(), vote(ANA, BEN))).toMatch(/There is no vote on drafts/)
    const last = accepted(room, vote(ANA, BEN))
    expect(last.action).toEqual({ type: 'addVote', round: 0, voterId: ANA, draftBy: BEN })
    expect(last.after).toMatchObject([
      { type: 'close', chosen: { draftedBy: ANA }, votes: 1, droppedOut: [BEN] },
    ])
  })

  it('waits for a voter taking part until the vote’s time runs out', () => {
    const room = voting({ drafts: [draft(ANA, 1), draft(BEN, 2)], votes: [{ voterId: BEN, draftBy: ANA }] })
    expect(settled(room, NOW + RESULT_VOTING_WINDOW_MS - 1)).toEqual([])
    expect(settled(room, NOW + RESULT_VOTING_WINDOW_MS)).toMatchObject([{ type: 'close', votes: 1 }])
  })
})

describe('a flock whose result waits', () => {
  it('closes a flock stored while it waited for approvals with the result it chose', () => {
    const stored = draft(BEN, 5)
    const room = deciding({ stage: 'approving', concludedAt: NOW, result: stored })
    expect(settled(room)).toMatchObject([{ type: 'close', chosen: stored, votes: null, replacing: 5 }])
    expect(askOf(room, ANA, NOW)).toBeNull()
  })

  it('settles its drafts at once a day after its turns stopped, and ends without one only with no draft', () => {
    const overdue = NOW + RESULT_WINDOW_MS
    expect(settled(drafting(), overdue - 1)).toEqual([])
    expect(settled(drafting(), overdue)).toEqual([{ type: 'end', because: 'no_result', during: 'result' }])
    const two = [draft(ANA, NOW), draft(BEN, NOW + 1)]
    expect(
      settled(
        drafting({ drafts: two, participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }),
        overdue,
      ),
    ).toMatchObject([{ type: 'close', chosen: { draftedBy: ANA }, votes: 0 }])
    expect(settled(voting({ drafts: two, votes: [{ voterId: ANA, draftBy: BEN }] }), overdue)).toMatchObject([
      { type: 'close', chosen: { draftedBy: BEN }, votes: 1 },
    ])
  })

  it('leaves a closed or ended flock as it is', () => {
    const closed = deciding({ stage: 'closed', result: draft(ANA, 1) })
    expect(settled(closed, NOW + RESULT_WINDOW_MS)).toEqual([])
    expect(askOf(closed, ANA, NOW)).toBeNull()
  })
})

describe('the laws of a flock, over any run of events', () => {
  const members = [ANA, BEN, CY, DAN] as const
  const member = fc.constantFrom(...members)
  const smallLimits = fc
    .record({
      turnsPerAgent: fc.integer({ min: 1, max: 3 }),
      totalTurns: fc.integer({ min: 2, max: 6 }),
      minutes: fc.integer({ min: 5, max: 30 }),
      turnCharacters: fc.constant(200),
    })
    .filter((limits) => limitsProblem(limits) === null)
  const limits = fc.oneof(
    { arbitrary: smallLimits, weight: 4 },
    { arbitrary: arbitrary(DebateLimits), weight: 1 },
  )
  const wait = fc.oneof(
    { arbitrary: fc.integer({ min: 0, max: 60_000 }), weight: 6 },
    {
      arbitrary: fc.constantFrom(
        RESULT_DRAFTING_WINDOW_MS,
        RESULT_VOTING_WINDOW_MS,
        30 * 60_000,
        RESULT_WINDOW_MS,
      ),
      weight: 1,
    },
  )
  const op = fc.oneof(
    { arbitrary: wait.map((ms) => ({ op: 'wait' as const, ms })), weight: 3 },
    { arbitrary: fc.constant({ op: 'tick' as const }), weight: 2 },
    {
      arbitrary: fc.record({
        op: fc.constant('presence' as const),
        memberId: member,
        takingPart: fc.boolean(),
      }),
      weight: 1,
    },
    { arbitrary: member.map((memberId) => ({ op: 'join' as const, memberId })), weight: 2 },
    { arbitrary: limits.map((wished) => ({ op: 'setLimits' as const, limits: wished })), weight: 1 },
    { arbitrary: member.map((memberId) => ({ op: 'turn' as const, memberId })), weight: 3 },
    { arbitrary: fc.boolean().map((ready) => ({ op: 'askedTurn' as const, ready })), weight: 6 },
    {
      arbitrary: fc.record({
        op: fc.constant('draft' as const),
        memberId: member,
        result: arbitrary(DebateResult),
      }),
      weight: 3,
    },
    {
      arbitrary: fc.record({ op: fc.constant('vote' as const), memberId: member, draftBy: member }),
      weight: 3,
    },
  )
  const script = fc.record({
    limits: smallLimits,
    joined: fc.subarray([...members], { minLength: 2 }),
    ops: fc.array(op, { minLength: 30, maxLength: 80 }),
  })
  type Script = typeof script extends fc.Arbitrary<infer S> ? S : never

  interface Transition {
    readonly before: DebateRoom
    readonly now: number
    readonly event: DebateEvent | null
    readonly room: DebateRoom
    readonly effects: ReadonlyArray<DebateSettlingEffect>
  }

  const fitting = (result: DebateResult, room: DebateRoom): DebateResult => ({
    ...result,
    contributions: room.participants.map((one) => ({
      memberId: one.memberId,
      summary: 'Spoke.',
      credits: [],
    })),
    nextSteps: [],
  })

  const run = ({ limits: initial, joined, ops }: Script): Transition[] => {
    let room: DebateRoom = {
      stage: { stage: 'setup' },
      createdAt: 0,
      askingSince: 0,
      deadlineAt: initial.minutes * 60_000,
      limits: initial,
      participants: joined.map((memberId) => ({ memberId })),
      turns: [],
      round: 0,
      drafts: [],
      votes: [],
    }
    let now = 0
    const trace: Transition[] = []
    for (const step of ops) {
      if (step.op === 'wait') now += step.ms
      else if (step.op === 'presence')
        room = {
          ...room,
          participants: room.participants.map((one) =>
            one.memberId === step.memberId ? { ...one, takingPart: step.takingPart } : one,
          ),
        }
      else if (step.op === 'askedTurn') {
        const asked = askedTurnOf(settleDebateRoom(room, now).room, now)
        if (asked === null) continue
        const event: DebateEvent = {
          type: 'turn',
          memberId: asked.memberId,
          body: 'A point.',
          ready: step.ready,
        }
        const move = stepDebate(room, event, now)
        if (!Result.isOk(move)) throw new Error(`the asked agent was refused: ${move.error.message}`)
        trace.push({
          before: room,
          now,
          event,
          room: move.value.room,
          effects: [...move.value.before, ...move.value.after],
        })
        room = move.value.room
      } else if (step.op === 'tick') {
        const next = settleDebateRoom(room, now)
        trace.push({ before: room, now, event: null, room: next.room, effects: next.effects })
        room = next.room
      } else {
        const event: DebateEvent =
          step.op === 'turn'
            ? turn(step.memberId)
            : step.op === 'draft'
              ? { type: 'draft', memberId: step.memberId, result: fitting(step.result, room) }
              : step.op === 'vote'
                ? { type: 'vote', memberId: step.memberId, vote: { round: 0, draftBy: step.draftBy } }
                : step.op === 'join'
                  ? { type: 'join', memberId: step.memberId }
                  : { type: 'setLimits', limits: step.limits }
        const move = stepDebate(room, event, now)
        if (Result.isOk(move)) {
          trace.push({
            before: room,
            now,
            event,
            room: move.value.room,
            effects: [...move.value.before, ...move.value.after],
          })
          room = move.value.room
        } else trace.push({ before: room, now, event, room, effects: [] })
      }
    }
    return trace
  }

  const lawful = (law: (transition: Transition) => void) =>
    fc.assert(
      fc.property(script, (generated) => {
        for (const transition of run(generated)) law(transition)
      }),
      { numRuns: 150 },
    )

  it('reaches every stage a flock can reach, so the laws below are tried on each', () => {
    const reached = new Set(
      fc
        .sample(script, { numRuns: 300, seed: 11 })
        .flatMap((generated) => run(generated).map(({ room }) => room.stage.stage)),
    )
    expect([...reached].sort()).toEqual(['closed', 'drafting', 'ended', 'open', 'setup', 'voting'])
  })

  it('asks exactly one agent at a time for a turn while the flock takes turns, and that one only', () => {
    lawful(({ room, now }) => {
      const asked = room.participants.filter((one) => askOf(room, one.memberId, now) === 'turn')
      const named = askedTurnOf(room, now)
      expect(asked.length).toBeLessThanOrEqual(1)
      if (asked.length === 1) expect(asked[0]!.memberId).toBe(named?.memberId)
      const open = settleDebateRoom(room, now).room
      if (open.stage.stage === 'setup' || open.stage.stage === 'open')
        if (open.participants.length >= 2 && open.participants.some(isTakingPart))
          expect(askedTurnOf(open, now)).not.toBeNull()
    })
  })

  it('takes a turn only from the agent whose turn it is, within its share and the total', () => {
    lawful(({ before, now, event, room }) => {
      if (event?.type !== 'turn' || room === before) return
      expect(askedTurnOf(settleDebateRoom(before, now).room, now)?.memberId).toBe(event.memberId)
      expect(room.turns.length).toBeLessThanOrEqual(room.limits.totalTurns)
      expect(turnsTakenBy(room, event.memberId)).toBeLessThanOrEqual(room.limits.turnsPerAgent)
    })
  })

  it('never skips the vote when the agents agree: the flock goes on to collect drafts', () => {
    lawful(({ room, effects }) => {
      if (effects.some((effect) => effect.type === 'conclude' && effect.because === 'agreed'))
        expect(['drafting', 'ended']).toContain(room.stage.stage)
    })
  })

  it('never lets the same agent take two turns in a row', () => {
    lawful(({ room }) => {
      for (let index = 1; index < room.turns.length; index++)
        expect(room.turns[index]!.memberId).not.toBe(room.turns[index - 1]!.memberId)
    })
  })

  it('changes limits only before the first turn', () => {
    lawful(({ before, event, room }) => {
      if (event?.type === 'setLimits' && room !== before) expect(before.turns).toEqual([])
      if (event?.type === 'setLimits' && before.turns.length > 0) expect(room).toBe(before)
    })
  })

  it('ends a started flock with one agent left or none, before it decides anything', () => {
    lawful(({ before, now }) => {
      const stage = before.stage.stage
      const takingPart = before.participants.filter(isTakingPart).length
      if (
        !['open', 'drafting', 'voting'].includes(stage) ||
        before.participants.length < 2 ||
        before.turns.length === 0 ||
        takingPart >= 2
      )
        return
      expect(settleDebateRoom(before, now).room.stage).toEqual({
        stage: 'ended',
        because: takingPart === 1 ? 'one_agent_left' : 'no_agent_left',
      })
    })
  })

  it('closes with the draft that has the most votes, a tie going to the earliest', () => {
    lawful(({ room, effects }) => {
      for (const effect of effects) {
        if (effect.type !== 'close' || effect.votes === null) continue
        const tally = (by: MemberId) => room.votes.filter((vote) => vote.draftBy === by).length
        expect(effect.votes).toBe(tally(effect.chosen.draftedBy))
        for (const other of room.drafts) {
          expect(tally(other.draftedBy)).toBeLessThanOrEqual(effect.votes)
          if (tally(other.draftedBy) === effect.votes)
            expect(other.draftedAt).toBeGreaterThanOrEqual(effect.chosen.draftedAt)
        }
      }
    })
  })

  it('closes an overdue flock that has drafts with a result', () => {
    lawful(({ before, now }) => {
      const stage = before.stage
      if (stage.stage !== 'drafting' && stage.stage !== 'voting') return
      if (before.drafts.length === 0 || before.participants.filter(isTakingPart).length < 2) return
      const overdue = settleDebateRoom(before, Math.max(now, stage.concludedAt + RESULT_WINDOW_MS))
      expect(overdue.room.stage.stage).toBe('closed')
    })
  })

  it('never gives a result without a draft', () => {
    lawful(({ room, effects }) => {
      for (const effect of effects)
        if (effect.type === 'close') expect(room.drafts).toContainEqual(effect.chosen)
      if (room.stage.stage === 'closed') expect(room.drafts).toContainEqual(room.stage.result)
    })
  })

  it('counts only the votes of agents taking part when they voted', () => {
    lawful(({ before, event, room }) => {
      if (event?.type !== 'vote' || room === before) return
      const voter = before.participants.find((one) => one.memberId === event.memberId)
      expect(voter !== undefined && isTakingPart(voter)).toBe(true)
      expect(event.vote.draftBy).not.toBe(event.memberId)
    })
  })

  it('changes nothing when a settled flock is settled again', () => {
    lawful(({ room, now }) => {
      const settledOnce = settleDebateRoom(room, now).room
      const again = settleDebateRoom(settledOnce, now)
      expect(again.effects).toEqual([])
      expect(again.room).toBe(settledOnce)
    })
  })
})
