import type { Receipt } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { authorshipOf, shortLabel, showsStateMark, stateMarkOf } from '../src/authorship.ts'

const receipt = (memberId: string, changes: Partial<Receipt> = {}): Receipt => ({
  memberId: memberId as Receipt['memberId'],
  state: 'delivered',
  deliveredAt: 1,
  readAt: null,
  draftingAt: null,
  repliedAt: null,
  ...changes,
})

describe('authorshipOf', () => {
  it('reads how a note was written from its origin', () => {
    expect(authorshipOf({ origin: 'agent' })).toBe('agent')
    expect(authorshipOf({ origin: 'human_edited' })).toBe('edited')
    expect(authorshipOf({ origin: 'human' })).toBe('person')
  })
})

describe('stateMarkOf', () => {
  it('gives a direct note its state without a count, and a room note a count of who read it', () => {
    expect(stateMarkOf([receipt('mem_a', { readAt: 2, state: 'read' })])).toEqual({
      state: 'read',
      count: null,
    })
    expect(stateMarkOf([receipt('mem_a', { readAt: 2, state: 'read' }), receipt('mem_b')])).toEqual({
      state: 'read',
      count: { read: 1, of: 2 },
    })
    expect(stateMarkOf([receipt('mem_a', { repliedAt: 3, readAt: 2, state: 'replied' })]).state).toBe(
      'replied',
    )
  })
})

describe('showsStateMark', () => {
  it('shows the mark on the last note of a run, and on an earlier one only where it differs', () => {
    const read = { receipts: [receipt('mem_a', { readAt: 2, state: 'read' })] }
    const delivered = { receipts: [receipt('mem_a')] }
    expect(showsStateMark(read, null)).toBe(true)
    expect(showsStateMark(read, read)).toBe(false)
    expect(showsStateMark(read, delivered)).toBe(true)
  })
})

describe('shortLabel', () => {
  it('keeps a short label and cuts a long one to the limit with an ellipsis', () => {
    expect(shortLabel('Claude Code 2.1.327')).toBe('Claude Code 2.1.327')
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.integer({ min: 2, max: 60 }), (label, max) => {
        const shown = shortLabel(label, max)
        expect(shown.length).toBeLessThanOrEqual(max)
        if (label.length <= max) expect(shown).toBe(label)
      }),
    )
  })
})
