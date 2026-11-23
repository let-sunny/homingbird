import { Result } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FREE_SLOTS_MAX, FREE_SLOTS_NOTE_MAX, FreeSlot, FreeSlotsTurn } from '../src/free-slots.ts'

const SLOT = { startsAt: Date.UTC(2026, 10, 23, 9), endsAt: Date.UTC(2026, 10, 23, 10) }

const pathsRefused = (input: unknown): ReadonlyArray<string> => {
  const decoded = FreeSlotsTurn.decode(input)
  return Result.isOk(decoded) ? [] : decoded.error.map((issue) => issue.path.join('.'))
}

describe('a free slots turn', () => {
  it('carries free slots, a short note and whether the agent could read the calendar', () => {
    const turn = { slots: [SLOT], note: 'Mornings suit me best.', cannotReadCalendar: false }
    expect(FreeSlotsTurn.decode(turn)).toEqual(Result.ok(turn))
    expect(FreeSlotsTurn.decode({ slots: [] })).toEqual(Result.ok({ slots: [] }))
  })

  it('refuses anything about what fills the busy time, around the slots or inside one', () => {
    expect(pathsRefused({ slots: [SLOT], title: 'Dentist', location: 'Main Street' })).toEqual([
      'title',
      'location',
    ])
    expect(pathsRefused({ slots: [{ ...SLOT, attendees: ['ben@example.com'] }] })).toEqual([
      'slots.0.attendees',
    ])
  })

  it('refuses more slots or a longer note than a room takes', () => {
    expect(pathsRefused({ slots: Array.from({ length: FREE_SLOTS_MAX }, () => SLOT) })).toEqual([])
    expect(pathsRefused({ slots: Array.from({ length: FREE_SLOTS_MAX + 1 }, () => SLOT) })).toEqual(['slots'])
    expect(pathsRefused({ slots: [], note: 'x'.repeat(FREE_SLOTS_NOTE_MAX) })).toEqual([])
    expect(pathsRefused({ slots: [], note: 'x'.repeat(FREE_SLOTS_NOTE_MAX + 1) })).toEqual(['note'])
    expect(pathsRefused({})).toEqual(['slots'])
  })

  it('decodes every turn it can describe back to itself', () => {
    fc.assert(
      fc.property(arbitrary(FreeSlotsTurn), (turn) => {
        expect(FreeSlotsTurn.decode(JSON.parse(JSON.stringify(turn)))).toEqual(Result.ok(turn))
      }),
    )
    expect(FreeSlot.decode({ ...SLOT, title: 'Dentist' })).toMatchObject({ _tag: 'Err' })
  })
})
