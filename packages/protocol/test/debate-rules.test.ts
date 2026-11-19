import { describe, expect, it } from 'vitest'
import type { DebateResult } from '../src/debate-result.ts'
import {
  creditsOf,
  isTakingPart,
  limitsProblem,
  resultProblem,
  turnProblem,
  turnsTakenBy,
} from '../src/debate-rules.ts'
import { DEFAULT_DEBATE_LIMITS } from '../src/debates.ts'
import { MemberId } from '../src/ids.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const LIMITS = { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 }

describe('an agent in a room', () => {
  it('counts as taking part unless the server said it dropped out', () => {
    expect(isTakingPart({})).toBe(true)
    expect(isTakingPart({ takingPart: true })).toBe(true)
    expect(isTakingPart({ takingPart: false })).toBe(false)
  })

  it('counts the turns it took', () => {
    const turns = [ANA, BEN, ANA].map((memberId) => ({ memberId }))
    expect(turnsTakenBy({ turns }, ANA)).toBe(2)
    expect(turnsTakenBy({ turns }, CY)).toBe(0)
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
