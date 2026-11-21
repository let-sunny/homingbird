import { describe, expect, it } from 'vitest'
import type { Contribution, DebateResult } from '../src/debate-result.ts'
import {
  creditsOf,
  isTakingPart,
  limitsFor,
  limitsProblem,
  resultProblem,
  turnProblem,
  turnsTakenBy,
  withCheckedCredits,
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
    expect(turnProblem('x'.repeat(301), LIMITS)).toBe(
      'A turn in this room holds at most 300 characters; this one has 301, 1 over.',
    )
    expect(turnProblem('x'.repeat(300), LIMITS)).toBeNull()
  })

  it('refuses a share per agent larger than the total', () => {
    expect(limitsProblem(limitsFor(DEFAULT_DEBATE_LIMITS, 0))).toBeNull()
    expect(limitsProblem({ ...LIMITS, turnsPerAgent: 5 })).toMatch(/cannot be more/)
  })

  it('gives every agent its turns when no total is set: the turns per agent times the agents', () => {
    const { totalTurns: _, ...wish } = LIMITS
    expect(limitsFor(DEFAULT_DEBATE_LIMITS, 4)).toMatchObject({ totalTurns: 12, totalFollowsAgents: true })
    expect(limitsFor(DEFAULT_DEBATE_LIMITS, 3).totalTurns).toBe(9)
    expect(limitsFor(DEFAULT_DEBATE_LIMITS, 0).totalTurns).toBe(3)
    expect(limitsFor({ ...wish, turnsPerAgent: 1 }, 1).totalTurns).toBe(2)
    expect(limitsFor({ ...wish, turnsPerAgent: 20 }, 8).totalTurns).toBe(100)
    expect(limitsFor(LIMITS, 8)).toEqual({ ...LIMITS, totalFollowsAgents: false })
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
  const TURNS = [{ memberId: ANA }, { memberId: BEN }, { memberId: ANA }, { memberId: BEN }]

  it('takes one contribution per participant and steps among them', () => {
    expect(resultProblem(result(), [ANA, BEN], TURNS)).toBeNull()
    expect(
      resultProblem(
        result({ nextSteps: [{ step: 'Decide.', owner: null, proposedBy: BEN }] }),
        [ANA, BEN],
        TURNS,
      ),
    ).toBeNull()
  })

  it('names who is missing, refuses duplicates and strangers', () => {
    expect(resultProblem(result(), [ANA, BEN, CY], TURNS)).toMatch(`missing: ${CY}`)
    const twice = result({ contributions: [...result().contributions, result().contributions[0]!] })
    expect(resultProblem(twice, [ANA, BEN], TURNS)).toMatch(/exactly one/)
    expect(resultProblem(result(), [ANA], TURNS)).toMatch(/exactly one/)
    expect(
      resultProblem(result({ nextSteps: [{ step: 'x', owner: CY, proposedBy: ANA }] }), [ANA, BEN], TURNS),
    ).toMatch(/among the participants/)
    expect(
      resultProblem(result({ nextSteps: [{ step: 'x', owner: null, proposedBy: CY }] }), [ANA, BEN], TURNS),
    ).toMatch(/among the participants/)
  })

  it('takes a credit only for a turn of the agent’s own, and a change of position only after it read another', () => {
    const crediting = (credit: Contribution['credits'][number], turns: typeof TURNS = TURNS) =>
      resultProblem(
        result({
          contributions: [
            { memberId: ANA, summary: 'Named it.', credits: [credit] },
            { memberId: BEN, summary: 'Agreed.', credits: [] },
          ],
        }),
        [ANA, BEN],
        turns,
      )
    expect(crediting({ credit: 'gap_filled', turn: 1 })).toBeNull()
    expect(crediting({ credit: 'gap_filled', turn: 2 })).toBe(
      `The credit gap_filled for ${ANA} names turn 2, which is not a turn of that agent’s.`,
    )
    expect(crediting({ credit: 'gap_filled', turn: 5 })).toMatch(/names turn 5, which is not a turn/)
    expect(crediting({ credit: 'position_changed', turn: 1 })).toBe(
      `The credit position_changed for ${ANA} names turn 1, but before it that agent had read no other agent’s turn.`,
    )
    expect(crediting({ credit: 'position_changed', turn: 3 })).toBeNull()
    const blind = [{ memberId: BEN }, { memberId: ANA, afterTurn: 0 }]
    expect(crediting({ credit: 'position_changed', turn: 2 }, blind)).toMatch(
      /had read no other agent’s turn/,
    )
    const read = [{ memberId: BEN }, { memberId: ANA, afterTurn: 1 }]
    expect(crediting({ credit: 'position_changed', turn: 2 }, read)).toBeNull()
    const early = [{ memberId: ANA, afterTurn: 5 }, { memberId: BEN }]
    expect(crediting({ credit: 'position_changed', turn: 1 }, early)).toMatch(/had read no other/)
    const claimed = [{ memberId: BEN }, { memberId: ANA, afterTurn: 7 }]
    expect(crediting({ credit: 'position_changed', turn: 2 }, claimed)).toBeNull()
    const ownOnly = [{ memberId: ANA }, { memberId: BEN }, { memberId: ANA, afterTurn: 1 }]
    expect(crediting({ credit: 'position_changed', turn: 3 }, ownOnly)).toMatch(/had read no other/)
    expect(crediting('position_changed')).toBeNull()
  })

  it('takes what changed minds only for turns the room has', () => {
    const changed = (turn: number) =>
      resultProblem(result({ changedMinds: [{ turn, line: 'The rehearsal failed.' }] }), [ANA, BEN], TURNS)
    expect(changed(4)).toBeNull()
    expect(changed(5)).toBe('What changed minds names turn 5, but the room has 4 turns.')
  })

  it('keeps only the credits that name a turn, and credits their kinds', () => {
    const named = result({
      contributions: [
        {
          memberId: ANA,
          summary: 'Named it.',
          credits: ['gap_filled', { credit: 'position_changed', turn: 3 }],
        },
        { memberId: BEN, summary: 'Agreed.', credits: [] },
      ],
    })
    expect(withCheckedCredits(named).contributions.map((one) => one.credits)).toEqual([
      [{ credit: 'position_changed', turn: 3 }],
      [],
    ])
    expect(creditsOf(withCheckedCredits(named))).toContainEqual({ memberId: ANA, credit: 'position_changed' })
    expect(creditsOf(withCheckedCredits(named))).not.toContainEqual({ memberId: ANA, credit: 'gap_filled' })
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
