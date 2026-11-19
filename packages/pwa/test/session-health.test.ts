import { describe, expect, it } from 'vitest'
import { bucketShares, hasSessionFigures, sessionsDueForFreshStart } from '../src/session-health.ts'

describe('session health', () => {
  it('gives edit and discard shares only where the server showed counts', () => {
    expect(bucketShares({ bucket: 'hours', decided: 10, edited: 3, discarded: 1 })).toEqual({
      edited: 0.3,
      discarded: 0.1,
    })
    expect(bucketShares({ bucket: 'hours', decided: 4, edited: null, discarded: null })).toEqual({
      edited: null,
      discarded: null,
    })
  })

  it('names the desks due for a fresh session, by age or by context use', () => {
    const at = 1
    expect(
      sessionsDueForFreshStart([
        { agentName: 'Young', ageMinutes: 30, contextPercent: 10, at },
        { agentName: 'Old', ageMinutes: 600, contextPercent: null, at },
        { agentName: 'Full', ageMinutes: 30, contextPercent: 90, at },
      ]).map((session) => session.agentName),
    ).toEqual(['Old', 'Full'])
  })

  it('shows a table only when some bucket has decided drafts', () => {
    expect(hasSessionFigures([{ bucket: 'hours', decided: 0, edited: null, discarded: null }])).toBe(false)
    expect(hasSessionFigures([{ bucket: 'hours', decided: 1, edited: null, discarded: null }])).toBe(true)
  })
})
