import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { DebateResult } from '../src/debate-result.ts'
import {
  type DebateState,
  creditsOf,
  endingOf,
  isAtLimit,
  limitsProblem,
  mayTakeTurn,
  resultProblem,
  turnProblem,
  turnsTakenBy,
  whyNoTurn,
} from '../src/debate-rules.ts'
import { DEFAULT_DEBATE_LIMITS } from '../src/debates.ts'
import { MemberId } from '../src/ids.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const LIMITS = { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 }
const NOW = 1_000

const stateOf = (speakers: ReadonlyArray<MemberId>, overrides: Partial<DebateState> = {}): DebateState => ({
  status: 'open',
  limits: LIMITS,
  deadlineAt: NOW + 1,
  participants: [{ memberId: ANA }, { memberId: BEN }],
  turns: speakers.map((memberId) => ({ memberId })),
  ...overrides,
})

describe('whose turn it is', () => {
  it('lets any participant start, then never the same agent twice in a row', () => {
    expect(mayTakeTurn(stateOf([]), ANA, NOW)).toBe(true)
    expect(mayTakeTurn(stateOf([ANA]), ANA, NOW)).toBe(false)
    expect(whyNoTurn(stateOf([ANA]), ANA, NOW)).toMatch(/no two turns in a row/)
    expect(mayTakeTurn(stateOf([ANA]), BEN, NOW)).toBe(true)
  })

  it('names why a turn is refused: the room, the agent, a missing second agent, or a used share', () => {
    expect(whyNoTurn(stateOf([], { status: 'concluding' }), ANA, NOW)).toMatch(/no more turns/)
    expect(whyNoTurn(stateOf([], { deadlineAt: NOW }), ANA, NOW)).toMatch(/no more turns/)
    expect(whyNoTurn(stateOf([ANA, BEN, ANA, BEN]), ANA, NOW)).toMatch(/no more turns/)
    expect(whyNoTurn(stateOf([]), CY, NOW)).toMatch(/not opted in/)
    expect(whyNoTurn(stateOf([], { participants: [{ memberId: ANA }] }), ANA, NOW)).toMatch(/second agent/)
    const three = { participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }] }
    expect(
      whyNoTurn(stateOf([ANA, BEN, ANA, CY], { ...three, limits: { ...LIMITS, totalTurns: 6 } }), ANA, NOW),
    ).toMatch(/used all its turns/)
  })

  it('never lets an agent pass its share, the total or the deadline, whatever the order of turns', () => {
    const order = fc.array(fc.constantFrom(ANA, BEN, CY), { maxLength: 12 })
    fc.assert(
      fc.property(order, fc.integer({ min: 0, max: 2 * NOW }), (speakers, now) => {
        const state = stateOf(speakers, {
          participants: [{ memberId: ANA }, { memberId: BEN }, { memberId: CY }],
        })
        for (const who of [ANA, BEN, CY])
          if (mayTakeTurn(state, who, now)) {
            expect(turnsTakenBy(state, who)).toBeLessThan(LIMITS.turnsPerAgent)
            expect(speakers.length).toBeLessThan(LIMITS.totalTurns)
            expect(now).toBeLessThan(state.deadlineAt)
            expect(speakers.at(-1)).not.toBe(who)
          }
      }),
    )
  })

  it('is at its limit exactly when time is up, the total is reached, or nobody may speak', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(ANA, BEN), { maxLength: 6 }), (speakers) => {
        const state = stateOf(speakers)
        const anyoneMay = [ANA, BEN].some((who) => mayTakeTurn(state, who, NOW))
        expect(isAtLimit(state, NOW)).toBe(!anyoneMay)
      }),
    )
    expect(isAtLimit(stateOf([], { deadlineAt: NOW }), NOW)).toBe(true)
    expect(isAtLimit(stateOf([], { participants: [{ memberId: ANA }] }), NOW)).toBe(false)
  })
})

describe('a room that stops', () => {
  it('ends without a result with fewer than two agents or no turn, and otherwise asks for one', () => {
    expect(endingOf(stateOf([], { participants: [{ memberId: ANA }] }))).toBe('too_few_agents')
    expect(endingOf(stateOf([ANA], { participants: [] }))).toBe('too_few_agents')
    expect(endingOf(stateOf([]))).toBe('no_turns')
    expect(endingOf(stateOf([ANA]))).toBeNull()
  })
})

describe('what a turn and the limits may be', () => {
  it('refuses a blank turn and one over the cap, and takes one at the cap', () => {
    expect(turnProblem('  \n', LIMITS)).toMatch(/needs some text/)
    expect(turnProblem('x'.repeat(301), LIMITS)).toMatch(/at most 300 characters; this one has 301/)
    expect(turnProblem('x'.repeat(300), LIMITS)).toBeNull()
  })

  it('refuses a share per agent larger than the total', () => {
    expect(limitsProblem(DEFAULT_DEBATE_LIMITS)).toBeNull()
    expect(limitsProblem({ ...LIMITS, turnsPerAgent: 5 })).toMatch(/cannot be more/)
  })
})

describe('a drafted result against its room', () => {
  const result = (overrides: Partial<Extract<DebateResult, { kind: 'conclusion' }>> = {}): DebateResult => ({
    kind: 'conclusion',
    conclusion: 'Ship on Thursday.',
    reasons: ['Tested.'],
    contributions: [
      { memberId: ANA, summary: 'Named the report.', credits: ['gap_filled'] },
      { memberId: BEN, summary: 'Changed position.', credits: ['position_changed', 'gap_filled'] },
    ],
    nextSteps: [{ step: 'Ben shares the plan.', owner: BEN, proposedBy: ANA }],
    ...overrides,
  })

  it('takes one contribution per participant and steps among them', () => {
    expect(resultProblem(result(), [ANA, BEN])).toBeNull()
    expect(
      resultProblem(result({ nextSteps: [{ step: 'Decide.', owner: null, proposedBy: BEN }] }), [ANA, BEN]),
    ).toBeNull()
  })

  it('names who is missing, refuses duplicates and strangers', () => {
    expect(resultProblem(result(), [ANA, BEN, CY])).toMatch(`missing: ${CY}`)
    const twice = result({ contributions: [...result().contributions, result().contributions[0]!] })
    expect(resultProblem(twice, [ANA, BEN])).toMatch(/exactly one/)
    expect(resultProblem(result(), [ANA])).toMatch(/exactly one/)
    expect(
      resultProblem(result({ nextSteps: [{ step: 'x', owner: CY, proposedBy: ANA }] }), [ANA, BEN]),
    ).toMatch(/among the participants/)
    expect(
      resultProblem(result({ nextSteps: [{ step: 'x', owner: null, proposedBy: CY }] }), [ANA, BEN]),
    ).toMatch(/among the participants/)
  })

  it('credits every contributor to a conclusion, each claim, and each proposer of an accepted step, once', () => {
    expect(creditsOf(result())).toEqual([
      { memberId: ANA, credit: 'conclusion' },
      { memberId: ANA, credit: 'gap_filled' },
      { memberId: BEN, credit: 'conclusion' },
      { memberId: BEN, credit: 'position_changed' },
      { memberId: BEN, credit: 'gap_filled' },
      { memberId: ANA, credit: 'next_step_accepted' },
    ])
    const twoSteps = result({
      nextSteps: [
        { step: 'a', owner: null, proposedBy: ANA },
        { step: 'b', owner: null, proposedBy: ANA },
      ],
    })
    expect(creditsOf(twoSteps).filter((one) => one.credit === 'next_step_accepted')).toHaveLength(1)
  })

  it('gives no conclusion credit when there was no conclusion', () => {
    const none: DebateResult = {
      kind: 'no_conclusion',
      summary: 'They did not agree.',
      points: [{ point: 'Risk', category: 'goals', explanation: 'Speed against safety.' }],
      contributions: [
        { memberId: ANA, summary: 'Separated the goals.', credits: ['disagreement_separated'] },
      ],
      nextSteps: [],
    }
    expect(creditsOf(none)).toEqual([{ memberId: ANA, credit: 'disagreement_separated' }])
  })
})
