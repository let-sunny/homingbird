import { describe, expect, it } from 'vitest'
import { debateAchievementsOf } from '../src/domain/debate-credits.ts'

describe('debate credits as milestones', () => {
  it('marks each kind of credit with its own milestone, once', () => {
    expect(
      debateAchievementsOf([
        'conclusion',
        'gap_filled',
        'disagreement_separated',
        'position_changed',
        'next_step_accepted',
      ]),
    ).toEqual([
      'debate_conclusion',
      'debate_gap_filled',
      'debate_disagreement_separated',
      'debate_position_changed',
      'debate_next_step_accepted',
    ])
    expect(debateAchievementsOf([])).toEqual([])
  })
})
