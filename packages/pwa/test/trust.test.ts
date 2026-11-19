import type { AgentFigures, AgentPeriod, OrganizationFigures } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  changeBetween,
  compareSentAsWritten,
  decidedOf,
  durationParts,
  notesPerActiveMember,
  periodOf,
  quickApprovalShare,
  replyRate,
  shareOf,
  skipShare,
  trendBars,
} from '../src/trust.ts'

const figures = (changes: Partial<AgentFigures> = {}): AgentFigures => ({
  written: 0,
  sentAsWritten: 0,
  sentAfterEdits: 0,
  discarded: 0,
  skipped: 0,
  skipReasons: [],
  expiredRequests: 0,
  medianDecisionMs: null,
  quickApprovals: 0,
  quickApprovalsFrequent: false,
  wroteYourself: 0,
  verdict: 'too_few',
  places: [],
  byClient: [],
  byModel: [],
  ...changes,
})

const organization = (changes: Partial<OrganizationFigures> = {}): OrganizationFigures => ({
  activeMembers: 5,
  notesSent: 20,
  newNotes: 10,
  answered: 7,
  medianFirstReplyMs: 60_000,
  agentDraftsWritten: 12,
  sentAsWritten: 8,
  sentAfterEdits: 2,
  discarded: 1,
  quickApprovals: 2,
  skipped: 4,
  places: [],
  hiddenPlaces: 0,
  byClient: [],
  byModel: [],
  hiddenLabels: 0,
  ...changes,
})

const share = fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null })

describe('shareOf', () => {
  it('is a share between 0 and 1 of a positive whole, and nothing of an empty one', () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), fc.nat({ max: 1000 }), (part, extra) => {
        const whole = part + extra
        const value = shareOf(part, whole)
        if (whole === 0) expect(value).toBeNull()
        else {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }),
    )
  })
})

describe('changeBetween', () => {
  it('has nothing to compare when either period has no share', () => {
    expect(changeBetween(null, 0.5)).toBe('new')
    expect(changeBetween(0.5, null)).toBe('new')
  })

  it('calls a change within five points the same, and otherwise says which way it went', () => {
    expect(changeBetween(0.8, 0.77)).toBe('same')
    expect(changeBetween(0.8, 0.6)).toBe('up')
    expect(changeBetween(0.6, 0.8)).toBe('down')
  })

  it('is antisymmetric: swapping the periods turns up into down', () => {
    const opposite = { up: 'down', down: 'up', same: 'same', new: 'new' } as const
    fc.assert(
      fc.property(share, share, (a, b) => {
        expect(changeBetween(b, a)).toBe(opposite[changeBetween(a, b)])
      }),
    )
  })
})

describe('compareSentAsWritten', () => {
  it('compares the share of decided drafts sent as written with the period before', () => {
    const period: AgentPeriod = {
      days: 7,
      current: figures({ sentAsWritten: 9, sentAfterEdits: 1 }),
      previous: figures({ sentAsWritten: 1, discarded: 1 }),
    }
    expect(compareSentAsWritten(period)).toEqual({ change: 'up', share: 0.9, before: 0.5 })
  })
})

describe('the agent report', () => {
  it('finds the period asked for, or the first one', () => {
    const week: AgentPeriod = { days: 7, current: figures(), previous: figures() }
    const month: AgentPeriod = { days: 30, current: figures(), previous: figures() }
    const report = {
      generatedAt: 0,
      quickApprovalSeconds: 3,
      minimumDecided: 10,
      periods: [week, month],
      weeks: [],
      sessions: { days: 30, byAge: [], byContext: [], latest: [] },
    }
    expect(periodOf(report, 30)).toBe(month)
    expect(periodOf(report, 90)).toBe(week)
  })

  it('adds up the decided drafts', () => {
    expect(decidedOf({ sentAsWritten: 3, sentAfterEdits: 2, discarded: 1 })).toBe(6)
  })

  it('turns weeks into bars, with no share for a week without decisions', () => {
    expect(
      trendBars([
        { start: 1, decided: 4, sentAsWritten: 3 },
        { start: 2, decided: 0, sentAsWritten: 0 },
      ]),
    ).toEqual([
      { start: 1, decided: 4, sentAsWritten: 3, share: 0.75 },
      { start: 2, decided: 0, sentAsWritten: 0, share: null },
    ])
  })
})

describe('organization shares', () => {
  it('reads the reply rate, notes per person, quick approvals and skips from the totals', () => {
    const totals = organization()
    expect(replyRate(totals)).toBe(0.7)
    expect(notesPerActiveMember(totals)).toBe(4)
    expect(quickApprovalShare({ quickApprovals: 2, sentAsWritten: 8 })).toBe(0.25)
    expect(skipShare(totals)).toBe(0.25)
    expect(skipShare(organization({ skipped: 0, agentDraftsWritten: 0 }))).toBeNull()
  })
})

describe('durationParts', () => {
  it('picks the largest unit that keeps the value at one or more', () => {
    expect(durationParts(800)).toEqual({ value: 1, unit: 'second' })
    expect(durationParts(45_000)).toEqual({ value: 45, unit: 'second' })
    expect(durationParts(150_000)).toEqual({ value: 3, unit: 'minute' })
    expect(durationParts(5 * 60 * 60_000)).toEqual({ value: 5, unit: 'hour' })
    expect(durationParts(3 * 24 * 60 * 60_000)).toEqual({ value: 3, unit: 'day' })
  })

  it('never rounds a duration to more than its unit allows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 10 * 24 * 60 * 60_000 }), (ms) => {
        const { value } = durationParts(ms)
        expect(value).toBeGreaterThanOrEqual(1)
      }),
    )
  })
})
