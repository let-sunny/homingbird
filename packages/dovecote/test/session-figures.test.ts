import { describe, expect, it } from 'vitest'
import { sessionHealthOf } from '../src/domain/session-figures.ts'
import { type AgentDraft, DAY_MS } from '../src/domain/trust-figures.ts'

const NOW = 1_700_000_000_000

const draft = (changes: Partial<AgentDraft>): AgentDraft => ({
  place: null,
  createdAt: NOW - 60_000,
  seenAt: null,
  decidedAt: NOW,
  outcome: 'as_written',
  agentName: 'Laptop',
  sessionMinutes: 30,
  contextPercent: 20,
  ...changes,
})

describe('sessionHealthOf', () => {
  it('counts decided drafts by session age and context use, with shares only from five', () => {
    const young = Array.from({ length: 5 }, (_, index) =>
      draft({ outcome: index === 0 ? 'edited' : index === 1 ? 'discarded' : 'as_written' }),
    )
    const old = [draft({ sessionMinutes: 900, contextPercent: 90, outcome: 'discarded' })]
    const health = sessionHealthOf([...young, ...old, draft({ outcome: null })], NOW)
    expect(health.byAge).toEqual([
      { bucket: 'under_hour', decided: 5, edited: 1, discarded: 1 },
      { bucket: 'hours', decided: 0, edited: null, discarded: null },
      { bucket: 'half_day', decided: 0, edited: null, discarded: null },
      { bucket: 'longer', decided: 1, edited: null, discarded: null },
    ])
    expect(health.byContext.map((bucket) => [bucket.bucket, bucket.decided])).toEqual([
      ['under_half', 5],
      ['most', 0],
      ['nearly_full', 1],
      ['unknown', 0],
    ])
  })

  it('leaves out drafts with no session reported and drafts older than its window', () => {
    const health = sessionHealthOf(
      [draft({ sessionMinutes: null }), draft({ createdAt: NOW - 31 * DAY_MS }), withoutSession(draft({}))],
      NOW,
    )
    expect(health.byAge.every((bucket) => bucket.decided === 0)).toBe(true)
    expect(health.latest).toEqual([])
  })

  it('names each desk’s latest session, aged to now, newest first, while its latest draft is under an hour old', () => {
    const health = sessionHealthOf(
      [
        draft({ agentName: 'Laptop', createdAt: NOW - 120 * 60_000, sessionMinutes: 10 }),
        draft({ agentName: 'Laptop', createdAt: NOW - 59 * 60_000, sessionMinutes: 70 }),
        draft({ agentName: 'Phone', createdAt: NOW - 5 * 60_000, sessionMinutes: 3, contextPercent: null }),
        draft({ agentName: null, createdAt: NOW - 10 * 60_000, sessionMinutes: 1 }),
      ],
      NOW,
    )
    expect(health.latest).toEqual([
      { agentName: 'Phone', ageMinutes: 8, contextPercent: null, at: NOW - 5 * 60_000 },
      { agentName: '', ageMinutes: 11, contextPercent: 20, at: NOW - 10 * 60_000 },
      { agentName: 'Laptop', ageMinutes: 129, contextPercent: 20, at: NOW - 59 * 60_000 },
    ])
  })

  it('suggests nothing for a desk whose latest draft is an hour old or more, since it may have restarted', () => {
    const health = sessionHealthOf(
      [draft({ agentName: 'Laptop', createdAt: NOW - 60 * 60_000, sessionMinutes: 600, contextPercent: 90 })],
      NOW,
    )
    expect(health.latest).toEqual([])
    expect(health.byAge.find((bucket) => bucket.bucket === 'half_day')?.decided).toBe(1)
  })

  it('leaves runner drafts out, which report no session because every run is fresh', () => {
    const health = sessionHealthOf([withoutSession(draft({ agentName: 'Runner' }))], NOW)
    expect(health.latest).toEqual([])
    expect(health.byAge.every((bucket) => bucket.decided === 0)).toBe(true)
  })
})

const withoutSession = ({ sessionMinutes: _, ...rest }: AgentDraft): AgentDraft => rest
