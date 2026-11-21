import { describe, expect, it } from 'vitest'
import { reviewsWithoutHeld, threadsWithoutHeld, withoutHeld } from '../src/held-decisions.ts'
import { ROOM, draft } from './support/fixtures.ts'

const held = { noteId: 'd1' as never }

describe('what is shown while a decision is held', () => {
  it('leaves out only the draft or answer the held decision decides', () => {
    const notes = [draft('d1'), draft('d2')]
    expect(withoutHeld(notes, held, (note) => note.id).map((note) => note.id)).toEqual(['d2'])
    expect(withoutHeld(notes, null, (note) => note.id)).toBe(notes)
    const threads = new Map([[ROOM, { notes, hasMore: false }]])
    expect(threadsWithoutHeld(threads, null)).toBe(threads)
    expect(
      threadsWithoutHeld(threads, held)
        .get(ROOM)!
        .notes.map((note) => note.id),
    ).toEqual(['d2'])
    const reviews = [{ note: draft('d1') }, { note: draft('d3') }] as never[]
    expect(reviewsWithoutHeld(reviews, held)).toEqual([reviews[1]])
  })
})
