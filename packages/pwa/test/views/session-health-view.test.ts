import { allByRole, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { freshSessionSuggestions, sessionSection } from '../../src/views/session-health-view.ts'
import { usingFakeDom } from '../support/dom.ts'
import { report } from '../support/fixtures.ts'

usingFakeDom()

describe('sessionSection', () => {
  it('shows nothing until a session-age bucket has a decided draft', () => {
    expect(sessionSection(report())).toBeNull()
  })

  it('shows a table per measure, each row a bucket', () => {
    const section = sessionSection(
      report({
        sessions: {
          days: 30,
          byAge: [{ bucket: 'under_hour', decided: 10, edited: 2, discarded: 1 }],
          byContext: [{ bucket: 'nearly_full', decided: 10, edited: 5, discarded: 0 }],
          latest: [],
        },
      }),
    )!
    expect(allByRole(section, 'table')).toHaveLength(2)
    const table = getByRole(section, 'table', { name: strings.trust.sessions.byAgeCaption })
    const cells = allByRole(table, 'row').map((row) => [...row.children].map((cell) => textOf(cell)))
    expect(cells).toEqual([
      [
        strings.trust.sessions.bucketColumn,
        strings.trust.sessions.decidedColumn,
        strings.trust.sessions.editedColumn,
        strings.trust.sessions.discardedColumn,
      ],
      [strings.trust.sessions.ages.under_hour, '10', '20%', '10%'],
    ])
  })
})

describe('freshSessionSuggestions', () => {
  it('names each desk due for a fresh session', () => {
    expect(freshSessionSuggestions([])).toBeNull()
    const shown = freshSessionSuggestions([
      { agentName: 'Laptop', ageMinutes: 600, contextPercent: null, at: 1 },
    ])!
    expect(textOf(shown)).toBe(strings.trust.sessions.freshSuggestion({ name: 'Laptop' }))
  })
})
