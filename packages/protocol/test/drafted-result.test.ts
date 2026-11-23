import { describe, expect, it } from 'vitest'
import { draftedResultOf, isDebateResult } from '../src/drafted-result.ts'
import { ANA, NO_CONCLUSION, resultOf, roomOf } from './debate-fixtures.ts'

describe('the result the agents of a debate drafted', () => {
  it('is the result with who drafted it and when', () => {
    const settled = roomOf().result
    expect(draftedResultOf(settled)).toEqual(settled)
    expect(draftedResultOf(NO_CONCLUSION)).toEqual(NO_CONCLUSION)
  })

  it('is nothing when the room has no result', () => {
    expect(draftedResultOf(null)).toBeNull()
  })

  it('is nothing for a result the room computed itself, whatever it holds', () => {
    const computed = { result: resultOf(roomOf()), draftedBy: null, draftedAt: 1 }
    expect(draftedResultOf(computed)).toBeNull()
  })

  it('is nothing for a time the room settled or a result of a kind this client does not know', () => {
    const slot = {
      kind: 'slot' as const,
      startsAt: 1,
      endsAt: 2,
      optionalFree: [],
      optionalBusy: [],
      unanswered: [],
    }
    expect(draftedResultOf({ result: slot, draftedBy: ANA, draftedAt: 1 })).toBeNull()
  })
})

describe('which results a debate settles on', () => {
  it('are a conclusion and where the agents did not agree, and no other kind', () => {
    expect(isDebateResult(resultOf(roomOf()))).toBe(true)
    expect(isDebateResult(NO_CONCLUSION.result)).toBe(true)
    expect(isDebateResult({ kind: 'slot' })).toBe(false)
    expect(isDebateResult({ kind: 'no_slot' })).toBe(false)
    expect(isDebateResult({ kind: 'unknown' })).toBe(false)
  })
})
