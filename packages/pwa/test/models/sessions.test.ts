import type { SessionBucketFigures } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { freshSessionLines, sessionsModel } from '../../src/models/sessions.ts'
import { strings } from '../../src/strings.ts'
import { report } from '../support/fixtures.ts'

const bucket = (
  name: string,
  decided: number,
  edited: number | null,
  discarded: number | null,
): SessionBucketFigures => ({
  bucket: name,
  decided,
  edited,
  discarded,
})

const withSessions = (byAge: SessionBucketFigures[], byContext: SessionBucketFigures[]) =>
  report({ sessions: { days: 30, byAge, byContext, latest: [] } })

describe('sessionsModel', () => {
  it('shows nothing until some session-age bucket has a decided draft', () => {
    expect(sessionsModel(withSessions([bucket('hours', 0, null, null)], []))).toBeNull()
  })

  it('shows shares from the server’s counts, and too few where it gave none', () => {
    const model = sessionsModel(
      withSessions(
        [bucket('under_hour', 10, 2, 1), bucket('longer', 3, null, null)],
        [bucket('nearly_full', 10, 5, 0), bucket('unknown', 3, null, null)],
      ),
    )!
    expect(model.tables).toHaveLength(2)
    expect(model.tables[0]!.rows).toEqual([
      [strings.trust.sessions.ages.under_hour, '10', '20%', '10%'],
      [strings.trust.sessions.ages.longer, '3', strings.trust.sessions.tooFew, strings.trust.sessions.tooFew],
    ])
    expect(model.tables[1]!.rows[0]![0]).toBe(strings.trust.sessions.contexts.nearly_full)
    expect(model.intro).toBe(strings.trust.sessions.intro({ days: 30 }))
  })

  it('leaves out the context table when only unreported context use was decided', () => {
    const model = sessionsModel(
      withSessions(
        [bucket('hours', 2, null, null)],
        [bucket('under_half', 0, null, null), bucket('unknown', 2, null, null)],
      ),
    )!
    expect(model.tables).toHaveLength(1)
  })
})

describe('freshSessionLines', () => {
  it('names each desk due for a fresh session', () => {
    expect(freshSessionLines([{ agentName: 'Laptop', ageMinutes: 30, contextPercent: 10, at: 1 }])).toEqual(
      [],
    )
    expect(
      freshSessionLines([
        { agentName: 'Laptop', ageMinutes: 600, contextPercent: null, at: 1 },
        { agentName: 'Phone', ageMinutes: 10, contextPercent: 10, at: 1 },
      ]),
    ).toEqual([strings.trust.sessions.freshSuggestion({ name: 'Laptop' })])
  })
})
