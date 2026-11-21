import { describe, expect, it } from 'vitest'
import { MINIMUM_DECIDED, verdictOf } from '../src/trust-verdict.ts'

describe('verdictOf', () => {
  it('tells nothing until enough drafts were decided', () => {
    expect(verdictOf(6, 2, 1)).toBe('too_few')
    expect(MINIMUM_DECIDED).toBe(10)
  })

  it('reads the same numbers the same way wherever they come from', () => {
    expect(verdictOf(12, 4, 2)).toBe('mixed')
    expect(verdictOf(7, 2, 1)).toBe('usually_as_written')
  })

  it('says drafts are often discarded when discards are many and outnumber edits', () => {
    expect(verdictOf(5, 1, 4)).toBe('often_discarded')
  })

  it('says drafts often need edits when edits are many', () => {
    expect(verdictOf(5, 4, 1)).toBe('often_edited')
  })
})
