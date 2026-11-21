import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DebateResult,
  DraftedResult,
  creditKindOf,
  creditTurnOf,
  resultOfDraft,
} from '../src/debate-result.ts'

describe('a debate result', () => {
  it('round-trips both kinds through JSON', () => {
    const seen = new Set<string>()
    fc.assert(
      fc.property(arbitrary(DebateResult), (result) => {
        seen.add(result.kind)
        expect(DebateResult.decode(JSON.parse(JSON.stringify(result)))._tag).toBe('Ok')
      }),
      { numRuns: 60 },
    )
    expect([...seen].sort()).toEqual(['conclusion', 'no_conclusion'])
  })

  it('names every disagreement with one of four categories, never a verdict', () => {
    const point = { point: 'Risk', explanation: 'Speed against safety.' }
    const result = (category: string) => ({
      kind: 'no_conclusion',
      summary: 'They did not agree.',
      points: [{ ...point, category }],
      contributions: [],
      nextSteps: [],
    })
    for (const category of ['information', 'assumptions', 'goals', 'open_question'])
      expect(DebateResult.is(result(category))).toBe(true)
    expect(DebateResult.is(result('winner'))).toBe(false)
  })

  it('lets a contribution claim only the credits the turns can show', () => {
    const withCredit = (credit: string) => ({
      kind: 'conclusion',
      conclusion: 'Ship.',
      reasons: ['Tested.'],
      contributions: [{ memberId: 'mem_ana000000000', summary: 'Named the report.', credits: [credit] }],
      nextSteps: [],
    })
    expect(DebateResult.is(withCredit('gap_filled'))).toBe(true)
    expect(DebateResult.is(withCredit('conclusion'))).toBe(false)
    expect(DebateResult.is(withCredit('won'))).toBe(false)
  })

  it('lets a credit name the turn that earned it, and reads one named as a kind alone', () => {
    const conclusion = {
      kind: 'conclusion',
      conclusion: 'Ship.',
      reasons: ['Tested.'],
      contributions: [
        {
          memberId: 'mem_ana000000000',
          summary: 'Named the report.',
          credits: [{ credit: 'gap_filled', turn: 2 }, 'position_changed'],
        },
      ],
      nextSteps: [],
      changedMinds: [{ turn: 2, line: 'The report moved Ben.' }],
      stillOpen: ['The load.'],
      points: [{ point: 'Date', category: 'goals', explanation: 'Friday against January.' }],
    }
    expect(DebateResult.is(conclusion)).toBe(true)
    expect(DebateResult.is({ ...conclusion, changedMinds: [{ turn: 0, line: 'x' }] })).toBe(false)
    expect(DebateResult.is({ ...conclusion, stillOpen: ['x'.repeat(301)] })).toBe(false)
    expect(creditKindOf({ credit: 'gap_filled', turn: 2 })).toBe('gap_filled')
    expect(creditKindOf('position_changed')).toBe('position_changed')
    expect(creditTurnOf({ turn: 2 })).toBe(2)
    expect(creditTurnOf('position_changed')).toBeNull()
  })

  it('takes a drafted result apart from the model its agent stated, which only a label may be', () => {
    fc.assert(
      fc.property(arbitrary(DraftedResult), (drafted) => {
        const { result, model } = resultOfDraft(drafted)
        expect(result).not.toHaveProperty('model')
        expect(DebateResult.decode(result)).toEqual({ _tag: 'Ok', value: result })
        expect(model).toBe(drafted.model ?? null)
      }),
      { numRuns: 60 },
    )
    const result = { kind: 'no_conclusion', summary: 'S', points: [], contributions: [], nextSteps: [] }
    const point = { point: 'P', category: 'goals', explanation: 'E' }
    expect(DraftedResult.is({ ...result, points: [point], model: 'gpt-6' })).toBe(true)
    expect(DraftedResult.is({ ...result, points: [point], model: 'gpt\n6' })).toBe(false)
  })
})
