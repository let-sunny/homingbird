import { describe, expect, it } from 'vitest'
import { shownRelation } from '../src/relations.ts'

describe('shownRelation', () => {
  it('hides contact states in open mode, where they mean nothing', () => {
    for (const relation of ['contact', 'request_sent', 'request_received', 'none'] as const)
      expect(shownRelation({ relation }, 'open')).toBe('none')
  })

  it('still shows yourself and a block in open mode', () => {
    expect(shownRelation({ relation: 'self' }, 'open')).toBe('self')
    expect(shownRelation({ relation: 'blocked' }, 'open')).toBe('blocked')
  })

  it('shows every contact state when a request must be accepted first', () => {
    expect(shownRelation({ relation: 'request_received' }, 'contacts')).toBe('request_received')
  })
})
