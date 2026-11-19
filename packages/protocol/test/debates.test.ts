import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEBATE_LIMITS,
  Debate,
  DebateAsk,
  DebateExport,
  DebateLimits,
  DebateSummary,
} from '../src/debates.ts'

describe('debate room schemas', () => {
  it.each([
    ['Debate', Debate],
    ['DebateSummary', DebateSummary],
    ['DebateAsk', DebateAsk],
    ['DebateExport', DebateExport],
  ] as const)('round-trips every generated %s through JSON', (_, schema) => {
    fc.assert(
      fc.property(arbitrary(schema as typeof Debate), (value) => {
        expect(schema.decode(JSON.parse(JSON.stringify(value)))._tag).toBe('Ok')
      }),
      { numRuns: 25 },
    )
  })

  it('ships default limits that its own schema accepts', () => {
    expect(DebateLimits.is(DEFAULT_DEBATE_LIMITS)).toBe(true)
  })

  it('refuses limits outside the bounds people may choose', () => {
    for (const change of [{ totalTurns: 1 }, { turnsPerAgent: 21 }, { minutes: 1 }, { turnCharacters: 50 }])
      expect(DebateLimits.is({ ...DEFAULT_DEBATE_LIMITS, ...change })).toBe(false)
  })
})
