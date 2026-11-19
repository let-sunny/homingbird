import type { AgentFigures, AgentReport } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { approvesQuicklyOften, carefulReadingFor, riskyContentOf } from '../src/careful-reading.ts'

describe('riskyContentOf', () => {
  it.each([
    ['The release is on 3 December.', 'date'],
    ['It ships Dec 3.', 'date'],
    ['See you on Tuesday.', 'date'],
    ['Shall we say Wed?', 'date'],
    ['see you thursday', 'date'],
    ['the call is sat 10am', 'date'],
    ['I sat with the team and enjoyed the sun.', null],
    ['We wed the two systems together.', null],
    ['Done by tomorrow.', 'date'],
    ['Scheduled for 2026-12-03 at 14:00.', 'date'],
    ['배포는 12월 3일이에요.', 'date'],
    ['I will send the report.', 'promise'],
    ['We guarantee a refund.', 'promise'],
    ['The invoice is 4,100 euros.', 'number'],
    ['Thanks, that makes sense.', null],
  ])('reads “%s” as %s', (body, reason) => {
    expect(riskyContentOf(body)).toBe(reason)
  })

  it('finds something in any text with a digit in it', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 9 }), fc.string(), (before, digit, after) => {
        expect(riskyContentOf(`${before}${digit}${after}`)).not.toBeNull()
      }),
    )
  })
})

describe('carefulReadingFor', () => {
  it('asks for a careful read only when the person approves quickly often', () => {
    expect(carefulReadingFor('On Tuesday.', true)).toBe('date')
    expect(carefulReadingFor('On Tuesday.', false)).toBeNull()
    expect(carefulReadingFor('Thanks.', true)).toBeNull()
  })
})

describe('approvesQuicklyOften', () => {
  const figures = (quickApprovalsFrequent: boolean): AgentFigures => ({
    written: 0,
    sentAsWritten: 0,
    sentAfterEdits: 0,
    discarded: 0,
    skipped: 0,
    skipReasons: [],
    expiredRequests: 0,
    medianDecisionMs: null,
    quickApprovals: 0,
    quickApprovalsFrequent,
    wroteYourself: 0,
    verdict: 'too_few',
    places: [],
    byClient: [],
    byModel: [],
  })
  const report = (frequent: boolean): AgentReport => ({
    generatedAt: 0,
    quickApprovalSeconds: 3,
    minimumDecided: 10,
    weeks: [],
    sessions: { days: 30, byAge: [], byContext: [], latest: [] },
    periods: [
      { days: 7, current: figures(frequent), previous: figures(false) },
      { days: 30, current: figures(true), previous: figures(true) },
    ],
  })

  it('reads the last 7 days of the person’s own figures, and says no while they are unknown', () => {
    expect(approvesQuicklyOften(report(true))).toBe(true)
    expect(approvesQuicklyOften(report(false))).toBe(false)
    expect(approvesQuicklyOften(null)).toBe(false)
    expect(approvesQuicklyOften('failed')).toBe(false)
  })
})
