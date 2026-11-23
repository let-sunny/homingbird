import { Result } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { DebateResult } from '../src/debate-result.ts'
import {
  type DebateEvent,
  type DebateRoom,
  type RoomDraft,
  askedTurnOf,
  settleDebateRoom,
  stepDebate,
  turnHoldOf,
} from '../src/debate-room.ts'
import { isReadyToConclude, limitsProblem, turnProblem } from '../src/debate-rules.ts'
import { MemberId } from '../src/ids.ts'
import { DEBATE_RULES, type RoomRules } from '../src/room-rules.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const MEMBERS = [ANA, BEN, CY] as const
const LIMITS = { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 }
const NOW = 1_000

const roomOf = (overrides: Partial<DebateRoom> = {}): DebateRoom => ({
  stage: { stage: 'setup' },
  createdAt: 0,
  askingSince: 0,
  deadlineAt: LIMITS.minutes * 60_000,
  limits: LIMITS,
  participants: [{ memberId: ANA }, { memberId: BEN }],
  turns: [],
  round: 0,
  drafts: [],
  votes: [],
  ...overrides,
})

const resultFor = (room: DebateRoom): DebateResult => ({
  kind: 'conclusion',
  conclusion: 'Ship on Thursday.',
  reasons: ['Tested.'],
  contributions: room.participants.map(({ memberId }) => ({ memberId, summary: 'Spoke.', credits: [] })),
  nextSteps: [],
})

const ruledBy = (overrides: Partial<RoomRules>): RoomRules => ({ ...DEBATE_RULES, ...overrides })

const turn = (memberId: MemberId, body = 'A point.'): Extract<DebateEvent, { readonly type: 'turn' }> => ({
  type: 'turn',
  memberId,
  body,
})

const accepted = (room: DebateRoom, event: DebateEvent, rules: RoomRules, now = NOW) => {
  const move = stepDebate(room, event, now, rules)
  if (!Result.isOk(move)) throw new Error(`refused: ${move.error.message}`)
  return move.value
}

describe('the debate rules', () => {
  it('make a debate room whose agents draft the result and vote on it', () => {
    expect(DEBATE_RULES.kind).toBe('debate')
    expect(DEBATE_RULES.settlement).toEqual({ by: 'drafted_and_voted' })
  })

  it('check a turn’s text against the room’s limits, as a debate does', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.integer({ min: 1, max: 30 }),
        fc.boolean(),
        (body, turnCharacters, ready) => {
          const room = roomOf({ limits: { ...LIMITS, turnCharacters } })
          expect(DEBATE_RULES.turnProblem({ memberId: ANA, body, ready }, room)).toBe(
            turnProblem(body, room.limits),
          )
        },
      ),
    )
  })

  it('count an agent ready as a debate does: its latest turn said so, or it used all its turns', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ memberId: fc.constantFrom(...MEMBERS), ready: fc.boolean() }), { maxLength: 6 }),
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom(...MEMBERS),
        (turns, turnsPerAgent, memberId) => {
          const room = roomOf({
            limits: { ...LIMITS, turnsPerAgent },
            turns: turns.map((one) => ({ ...one, afterTurn: null })),
          })
          expect(DEBATE_RULES.isReadyToConclude(room, memberId)).toBe(isReadyToConclude(room, memberId))
        },
      ),
    )
  })

  it('end a room without two agents, without a turn, or with fewer than two left taking part', () => {
    const spoken = [{ memberId: ANA, afterTurn: null, ready: false }]
    expect(DEBATE_RULES.endingOf(roomOf({ participants: [{ memberId: ANA }] }))).toBe('too_few_agents')
    expect(DEBATE_RULES.endingOf(roomOf())).toBe('no_turns')
    expect(DEBATE_RULES.endingOf(roomOf({ turns: spoken }))).toBeNull()
    expect(
      DEBATE_RULES.endingOf(
        roomOf({ turns: spoken, participants: [{ memberId: ANA }, { memberId: BEN, takingPart: false }] }),
      ),
    ).toBe('one_agent_left')
  })
})

describe('a room stepped by the debate rules', () => {
  it('moves exactly as a room stepped without rules, through any run of events', () => {
    fc.assert(
      fc.property(script, ({ joined, steps }) => {
        let room = roomOf({ participants: joined.map((memberId) => ({ memberId })) })
        let now = 0
        for (const one of steps) {
          if (one.op === 'wait') {
            now += one.ms
            continue
          }
          expect(settleDebateRoom(room, now, DEBATE_RULES)).toEqual(settleDebateRoom(room, now))
          const event = eventOf(one, room, now)
          if (event === null) continue
          if (event.type === 'turn')
            expect(turnHoldOf(room, event, now, DEBATE_RULES)).toEqual(turnHoldOf(room, event, now))
          const move = stepDebate(room, event, now)
          expect(stepDebate(room, event, now, DEBATE_RULES)).toEqual(move)
          if (Result.isOk(move)) room = move.value.room
        }
      }),
      { numRuns: 150 },
    )
  })
})

describe('a room stepped by other rules', () => {
  it('refuses a turn its rules refuse, keeping the place of one that has text', () => {
    const fussy = ruledBy({ turnProblem: (one) => (one.body === 'A point.' ? 'Say it otherwise.' : null) })
    const move = stepDebate(roomOf(), turn(ANA), NOW, fussy)
    expect(Result.isOk(move) ? null : move.error).toMatchObject({
      _tag: 'Invalid',
      message: expect.stringMatching(/^Say it otherwise\. Your place in the room is kept until /),
    })
    expect(turnHoldOf(roomOf(), turn(ANA), NOW, fussy)).toEqual({
      memberId: ANA,
      turnsTaken: 0,
      until: NOW + 2 * 60_000,
    })
    expect(accepted(roomOf(), turn(ANA, 'Another point.'), fussy).action).toMatchObject({ type: 'addTurn' })
  })

  it('stops early once its rules count every agent taking part ready', () => {
    const eager = ruledBy({ isReadyToConclude: () => true })
    expect(accepted(roomOf(), turn(ANA), eager).after).toEqual([{ type: 'conclude', because: 'agreed' }])
    expect(accepted(roomOf(), turn(ANA), DEBATE_RULES).after).toEqual([])
  })

  it('ends a room its rules end once its turns stop', () => {
    const ending = ruledBy({ endingOf: () => 'no_result' })
    const room = roomOf({
      turns: [{ memberId: ANA, afterTurn: null, ready: false }],
      stage: { stage: 'open' },
    })
    expect(settleDebateRoom(room, LIMITS.minutes * 60_000, ending)).toEqual({
      room: { ...room, stage: { stage: 'ended', because: 'no_result' } },
      effects: [{ type: 'end', because: 'no_result', during: 'turns' }],
    })
  })

  it('closes at once with the result its rules compute, or ends with none', () => {
    const room = roomOf({
      turns: [{ memberId: ANA, afterTurn: null, ready: false }],
      stage: { stage: 'open' },
    })
    const at = LIMITS.minutes * 60_000
    const chosen: RoomDraft = { draftedBy: ANA, draftedAt: at, result: resultFor(room) }
    const seen: Array<{ readonly room: DebateRoom; readonly now: number }> = []
    const computing = ruledBy({
      settlement: {
        by: 'computed',
        resultOf: (computed, now) => {
          seen.push({ room: computed, now })
          return chosen
        },
      },
    })
    expect(settleDebateRoom(room, at, computing)).toEqual({
      room: { ...room, stage: { stage: 'closed', result: chosen } },
      effects: [
        { type: 'conclude', because: 'time' },
        {
          type: 'close',
          round: 0,
          chosen,
          votes: null,
          drafts: 0,
          droppedOut: [],
          credits: [
            { memberId: ANA, credit: 'conclusion' },
            { memberId: BEN, credit: 'conclusion' },
          ],
          replacing: null,
        },
      ],
    })
    expect(seen).toEqual([{ room: { ...room, stage: { stage: 'drafting', concludedAt: at } }, now: at }])
    const empty = ruledBy({ settlement: { by: 'computed', resultOf: () => null } })
    expect(settleDebateRoom(room, at, empty)).toEqual({
      room: { ...room, stage: { stage: 'ended', because: 'no_result' } },
      effects: [
        { type: 'conclude', because: 'time' },
        { type: 'end', because: 'no_result', during: 'result' },
      ],
    })
  })
})

type Step =
  | { readonly op: 'wait'; readonly ms: number }
  | { readonly op: 'tick' }
  | { readonly op: 'join'; readonly memberId: MemberId }
  | { readonly op: 'setLimits'; readonly turnsPerAgent: number }
  | { readonly op: 'turn'; readonly memberId: MemberId; readonly body: string; readonly ready: boolean }
  | { readonly op: 'askedTurn'; readonly body: string; readonly ready: boolean }
  | { readonly op: 'draft'; readonly memberId: MemberId; readonly fits: boolean }
  | { readonly op: 'vote'; readonly memberId: MemberId; readonly draftBy: MemberId; readonly round: number }

const eventOf = (step: Step, room: DebateRoom, now: number): DebateEvent | null => {
  switch (step.op) {
    case 'join':
      return { type: 'join', memberId: step.memberId }
    case 'setLimits':
      return {
        type: 'setLimits',
        limits: { turnsPerAgent: step.turnsPerAgent, minutes: LIMITS.minutes, turnCharacters: 300 },
      }
    case 'turn':
      return { type: 'turn', memberId: step.memberId, body: step.body, ready: step.ready }
    case 'askedTurn': {
      const asked = askedTurnOf(settleDebateRoom(room, now).room, now)
      return asked === null
        ? null
        : { type: 'turn', memberId: asked.memberId, body: step.body, ready: step.ready }
    }
    case 'draft':
      return {
        type: 'draft',
        memberId: step.memberId,
        result: step.fits ? resultFor(room) : { ...resultFor(room), contributions: [] },
      }
    case 'vote':
      return { type: 'vote', memberId: step.memberId, vote: { round: step.round, draftBy: step.draftBy } }
    default:
      return null
  }
}

const member = fc.constantFrom(...MEMBERS)
const body = fc.constantFrom('A point.', 'A point.', '  ', 'x'.repeat(301))
const script = fc.record({
  joined: fc.subarray([...MEMBERS]),
  steps: fc.array(
    fc.oneof(
      {
        arbitrary: fc
          .constantFrom(0, 1_000, 60_000, 3 * 60_000, 30 * 60_000, 24 * 60 * 60_000)
          .map((ms) => ({ op: 'wait' as const, ms })),
        weight: 3,
      },
      { arbitrary: fc.constant({ op: 'tick' as const }), weight: 1 },
      { arbitrary: member.map((memberId) => ({ op: 'join' as const, memberId })), weight: 1 },
      {
        arbitrary: fc
          .integer({ min: 1, max: 5 })
          .filter((turnsPerAgent) => limitsProblem({ ...LIMITS, turnsPerAgent }) === null)
          .map((turnsPerAgent) => ({ op: 'setLimits' as const, turnsPerAgent })),
        weight: 1,
      },
      {
        arbitrary: fc.record({
          op: fc.constant('turn' as const),
          memberId: member,
          body,
          ready: fc.boolean(),
        }),
        weight: 2,
      },
      {
        arbitrary: fc.record({ op: fc.constant('askedTurn' as const), body, ready: fc.boolean() }),
        weight: 5,
      },
      {
        arbitrary: fc.record({ op: fc.constant('draft' as const), memberId: member, fits: fc.boolean() }),
        weight: 3,
      },
      {
        arbitrary: fc.record({
          op: fc.constant('vote' as const),
          memberId: member,
          draftBy: member,
          round: fc.constantFrom(0, 1),
        }),
        weight: 3,
      },
    ),
    { minLength: 20, maxLength: 60 },
  ),
})
