import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEBATE_LIMITS,
  Debate,
  DebateAsk,
  DebateExport,
  DebateLimits,
  DebateLimitsWish,
  DebateSummary,
  RoomScheduleDetails,
  TURNS_PER_AGENT_OFFERED,
} from '../src/debates.ts'
import { ANA, roomOf } from './debate-fixtures.ts'

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

  it('ships default limits that its own schema accepts, three turns per agent and no fixed total', () => {
    expect(DebateLimitsWish.is(DEFAULT_DEBATE_LIMITS)).toBe(true)
    expect(DEFAULT_DEBATE_LIMITS).not.toHaveProperty('totalTurns')
    expect(DEFAULT_DEBATE_LIMITS.turnsPerAgent).toBe(3)
    expect(TURNS_PER_AGENT_OFFERED).toBe(4)
  })

  it('refuses limits outside the bounds people may choose', () => {
    for (const change of [{ totalTurns: 1 }, { turnsPerAgent: 21 }, { minutes: 1 }, { turnCharacters: 50 }]) {
      expect(DebateLimits.is({ ...DEFAULT_DEBATE_LIMITS, totalTurns: 9, ...change })).toBe(false)
      expect(DebateLimitsWish.is({ ...DEFAULT_DEBATE_LIMITS, ...change })).toBe(false)
    }
  })

  it('reads a room from before types as a debate, and a type it does not know as unknown', () => {
    const stored = JSON.parse(JSON.stringify(roomOf()))
    expect(Debate.decode(stored)).toMatchObject({ _tag: 'Ok', value: { id: stored.id } })
    expect(Debate.read(stored)).toMatchObject({ _tag: 'Ok', value: { id: stored.id } })
    expect(Debate.read({ ...stored, type: 'poll' })).toMatchObject({ value: { type: 'unknown' } })
    expect(Debate.decode({ ...stored, type: 'scheduling' })).toMatchObject({ _tag: 'Ok' })
    expect(Debate.decode({ ...stored, type: 'poll' })).toMatchObject({ _tag: 'Err' })
  })

  it('decodes the result of a debate as before, and one the room computed with no drafter', () => {
    const stored = JSON.parse(JSON.stringify(roomOf()))
    const slot = { kind: 'slot', startsAt: 1, endsAt: 2, optionalFree: [], optionalBusy: [], unanswered: [] }
    expect(Debate.decode(stored)).toMatchObject({ value: { result: { draftedBy: ANA } } })
    const computed = {
      ...stored,
      type: 'scheduling',
      result: { result: slot, draftedBy: null, draftedAt: 3 },
    }
    expect(Debate.decode(computed)).toMatchObject({ _tag: 'Ok', value: { result: { draftedBy: null } } })
    const later = { ...stored, result: { ...stored.result, result: { kind: 'later' } } }
    expect(Debate.read(later)).toMatchObject({ value: { result: { result: { kind: 'unknown' } } } })
  })

  it('says what a scheduling room asks, within the lengths a person may choose', () => {
    const asked = {
      minutes: 30,
      window: { startsAt: 1, endsAt: 2 },
      attendees: [{ memberId: ANA, required: true }],
    }
    expect(RoomScheduleDetails.decode(asked)).toMatchObject({ _tag: 'Ok' })
    expect(RoomScheduleDetails.decode({ ...asked, minutes: 10 })).toMatchObject({ _tag: 'Err' })
  })
})
