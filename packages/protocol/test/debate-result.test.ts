import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DebateResult } from '../src/debate-result.ts'

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
})
