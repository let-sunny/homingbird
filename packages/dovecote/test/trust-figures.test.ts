import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type AgentActivity,
  type AgentDraft,
  DAY_MS,
  MINIMUM_DECIDED,
  agentFiguresIn,
  agentReportOf,
  commonReasons,
  isQuickApproval,
  isQuickApprovalFrequent,
  median,
  periodEndingAt,
  verdictOf,
  weeksBefore,
} from '../src/domain/trust-figures.ts'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60_000

const nothing: AgentActivity = { drafts: [], skips: [], expiredRequests: [], handWritten: [] }

const decided = (
  outcome: AgentDraft['outcome'],
  place: string | null,
  hoursAgo: number,
  secondsToDecide = 60,
): AgentDraft => ({
  place,
  createdAt: NOW - hoursAgo * HOUR - 120_000,
  seenAt: NOW - hoursAgo * HOUR - secondsToDecide * 1000,
  decidedAt: NOW - hoursAgo * HOUR,
  outcome,
})

const counts = fc.record({
  sentAsWritten: fc.nat({ max: 200 }),
  sentAfterEdits: fc.nat({ max: 200 }),
  discarded: fc.nat({ max: 200 }),
})

const lastWeek = periodEndingAt(NOW, 7, 0)

describe('verdictOf', () => {
  it('says there are too few drafts until ten were decided, whatever they were', () => {
    fc.assert(
      fc.property(counts, (decisions) => {
        const total = decisions.sentAsWritten + decisions.sentAfterEdits + decisions.discarded
        expect(verdictOf(decisions) === 'too_few').toBe(total < MINIMUM_DECIDED)
      }),
    )
  })

  it('reads the same at any scale, because it depends on shares only', () => {
    fc.assert(
      fc.property(counts, fc.integer({ min: 2, max: 9 }), (decisions, factor) => {
        fc.pre(decisions.sentAsWritten + decisions.sentAfterEdits + decisions.discarded >= MINIMUM_DECIDED)
        const scaled = {
          sentAsWritten: decisions.sentAsWritten * factor,
          sentAfterEdits: decisions.sentAfterEdits * factor,
          discarded: decisions.discarded * factor,
        }
        expect(verdictOf(scaled)).toBe(verdictOf(decisions))
      }),
    )
  })

  it('never turns away from “usually sent as written” when one more draft is sent as written', () => {
    fc.assert(
      fc.property(counts, (decisions) => {
        fc.pre(verdictOf(decisions) === 'usually_as_written')
        expect(verdictOf({ ...decisions, sentAsWritten: decisions.sentAsWritten + 1 })).toBe(
          'usually_as_written',
        )
      }),
    )
  })

  it('draws each line at a stated share', () => {
    expect(verdictOf({ sentAsWritten: 7, sentAfterEdits: 3, discarded: 0 })).toBe('usually_as_written')
    expect(verdictOf({ sentAsWritten: 6, sentAfterEdits: 4, discarded: 0 })).toBe('often_edited')
    expect(verdictOf({ sentAsWritten: 6, sentAfterEdits: 1, discarded: 3 })).toBe('often_discarded')
    expect(verdictOf({ sentAsWritten: 4, sentAfterEdits: 3, discarded: 3 })).toBe('often_discarded')
    expect(verdictOf({ sentAsWritten: 3, sentAfterEdits: 4, discarded: 3 })).toBe('often_edited')
    expect(verdictOf({ sentAsWritten: 6, sentAfterEdits: 2, discarded: 2 })).toBe('mixed')
    expect(verdictOf({ sentAsWritten: 9, sentAfterEdits: 0, discarded: 0 })).toBe('too_few')
  })
})

describe('median', () => {
  it('has none for no values', () => {
    expect(median([])).toBeNull()
  })

  it('takes the middle value, or the rounded mean of the two middle values', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 2, 10])).toBe(3)
    expect(median([1, 2])).toBe(2)
  })

  it('lies between the smallest and the largest value and ignores order', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1 }), (values) => {
        const middle = median(values)!
        expect(middle).toBeGreaterThanOrEqual(Math.min(...values))
        expect(middle).toBeLessThanOrEqual(Math.max(...values))
        expect(median([...values].reverse())).toBe(middle)
      }),
    )
  })

  it('is the value itself when every value is the same', () => {
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 1, max: 20 }), (value, times) => {
        expect(median(Array.from({ length: times }, () => value))).toBe(value)
      }),
    )
  })
})

describe('quick approvals', () => {
  it('counts a draft sent as written within the setting, measured from when it was first shown', () => {
    expect(isQuickApproval(decided('as_written', null, 1, 3), 3)).toBe(true)
    expect(isQuickApproval(decided('as_written', null, 1, 4), 3)).toBe(false)
    expect(isQuickApproval(decided('edited', null, 1, 1), 3)).toBe(false)
    expect(isQuickApproval({ ...decided('as_written', null, 1, 1), seenAt: null }, 3)).toBe(false)
  })

  it('nudges only when quick approvals are both several and a large share of what was sent as written', () => {
    expect(isQuickApprovalFrequent(2, 2)).toBe(false)
    expect(isQuickApprovalFrequent(3, 12)).toBe(true)
    expect(isQuickApprovalFrequent(3, 13)).toBe(false)
  })
})

describe('commonReasons', () => {
  it('groups reasons that differ only in case and spacing, most frequent first, at most three', () => {
    expect(
      commonReasons([
        'Needs the release plan',
        ' needs  the release plan ',
        'Out of office',
        null,
        '',
        'Not my area',
        'not my area',
        'NOT MY AREA',
        'Asked twice',
      ]),
    ).toEqual([
      { reason: 'Not my area', count: 3 },
      { reason: 'Needs the release plan', count: 2 },
      { reason: 'Out of office', count: 1 },
    ])
  })

  it('accounts for every reason given, when nothing is cut', () => {
    fc.assert(
      fc.property(fc.array(fc.option(fc.constantFrom('a', 'A', 'b', ' b', 'c'))), (reasons) => {
        const given = reasons.filter((reason) => reason !== null).length
        const total = commonReasons(reasons, 10).reduce((sum, entry) => sum + entry.count, 0)
        expect(total).toBe(given)
      }),
    )
  })
})

describe('periods and weeks', () => {
  it('lays weeks end to end, oldest first, the last one open towards now', () => {
    const weeks = weeksBefore(NOW, 8)
    expect(weeks).toHaveLength(8)
    expect(weeks.at(-1)!.to).toBe(Number.POSITIVE_INFINITY)
    expect(weeks.at(-2)!.to).toBe(NOW - 7 * DAY_MS)
    for (let index = 1; index < weeks.length; index++) expect(weeks[index]!.from).toBe(weeks[index - 1]!.to)
    expect(weeks[0]!.from).toBe(NOW - 56 * DAY_MS)
  })

  it('puts the previous period right before the current one', () => {
    expect(periodEndingAt(NOW, 30, 1)).toEqual({ from: NOW - 60 * DAY_MS, to: NOW - 30 * DAY_MS })
  })
})

describe('agentFiguresIn', () => {
  it('counts drafts written by when they were written and outcomes by when they were decided', () => {
    const activity: AgentActivity = {
      ...nothing,
      drafts: [
        decided('as_written', 'billing', 1),
        decided('edited', 'billing', 2),
        decided('discarded', null, 3),
        { place: 'billing', createdAt: NOW - HOUR, seenAt: null, decidedAt: null, outcome: null },
        { ...decided('as_written', 'billing', 24 * 8), createdAt: NOW - 24 * 9 * HOUR },
        {
          place: null,
          createdAt: NOW - 10 * DAY_MS,
          seenAt: null,
          decidedAt: NOW - HOUR,
          outcome: 'as_written',
        },
      ],
    }
    const figures = agentFiguresIn(activity, lastWeek, 3)
    expect(figures).toMatchObject({ written: 4, sentAsWritten: 2, sentAfterEdits: 1, discarded: 1 })
  })

  it('keeps a draft set aside without its person, such as an unchosen alternative, out of the decisions', () => {
    const activity: AgentActivity = {
      ...nothing,
      drafts: [{ place: null, createdAt: NOW - HOUR, seenAt: null, decidedAt: null, outcome: null }],
    }
    expect(agentFiguresIn(activity, lastWeek, 3)).toMatchObject({
      written: 1,
      sentAsWritten: 0,
      sentAfterEdits: 0,
      discarded: 0,
      medianDecisionMs: null,
      verdict: 'too_few',
    })
  })

  it('measures the median time from shown to decided, and counts the quick approvals', () => {
    const activity: AgentActivity = {
      ...nothing,
      drafts: [
        decided('as_written', null, 1, 2),
        decided('as_written', null, 2, 2),
        decided('as_written', null, 3, 1),
        decided('edited', null, 4, 120),
        decided('discarded', null, 5, 40),
      ],
    }
    const figures = agentFiguresIn(activity, lastWeek, 3)
    expect(figures.medianDecisionMs).toBe(2000)
    expect(figures.quickApprovals).toBe(3)
    expect(figures.quickApprovalsFrequent).toBe(true)
  })

  it('counts skips with their reasons, expired draft requests and notes the person wrote', () => {
    const activity: AgentActivity = {
      drafts: [],
      skips: [
        { place: 'payroll', at: NOW - HOUR, reason: 'Needs payroll access' },
        { place: 'payroll', at: NOW - 2 * HOUR, reason: 'needs payroll access' },
        { place: null, at: NOW - 8 * DAY_MS, reason: 'Old' },
      ],
      expiredRequests: [{ place: null, at: NOW - HOUR }],
      handWritten: [
        { place: null, at: NOW - HOUR },
        { place: 'billing', at: NOW - 3 * HOUR },
      ],
    }
    expect(agentFiguresIn(activity, lastWeek, 3)).toMatchObject({
      skipped: 2,
      skipReasons: [{ reason: 'Needs payroll access', count: 2 }],
      expiredRequests: 1,
      wroteYourself: 2,
    })
  })

  it('breaks the figures down by channel, with direct messages together, the busiest first', () => {
    const activity: AgentActivity = {
      ...nothing,
      drafts: [
        ...Array.from({ length: 9 }, (_, index) => decided('as_written', 'billing', index + 1)),
        decided('edited', 'billing', 10),
        decided('as_written', 'payroll', 1),
        decided('as_written', 'payroll', 2),
        ...Array.from({ length: 4 }, (_, index) => decided('edited', 'payroll', index + 3)),
        decided('discarded', null, 1),
      ],
      skips: [{ place: 'deploys', at: NOW - HOUR, reason: null }],
    }
    const places = agentFiguresIn(activity, lastWeek, 3).places
    expect(places.map((place) => [place.place, place.sentAsWritten, place.written, place.verdict])).toEqual([
      ['billing', 9, 10, 'usually_as_written'],
      ['payroll', 2, 6, 'too_few'],
      [null, 0, 1, 'too_few'],
      ['deploys', 0, 0, 'too_few'],
    ])
    expect(places.find((place) => place.place === 'deploys')!.skipped).toBe(1)
  })

  it('splits every decided draft into exactly one outcome', () => {
    const outcome = fc.constantFrom<AgentDraft['outcome']>('as_written', 'edited', 'discarded', null)
    const draft = fc.record({
      place: fc.constantFrom('billing', 'payroll', null),
      createdAt: fc.integer({ min: NOW - 20 * DAY_MS, max: NOW - 1 }),
      seenAt: fc.option(fc.integer({ min: NOW - 20 * DAY_MS, max: NOW - 1 })),
      decidedAt: fc.option(fc.integer({ min: NOW - 20 * DAY_MS, max: NOW - 1 })),
      outcome,
    })
    fc.assert(
      fc.property(fc.array(draft, { maxLength: 60 }), (drafts) => {
        const figures = agentFiguresIn({ ...nothing, drafts }, lastWeek, 3)
        const inWeek = drafts.filter(
          (each) =>
            each.outcome !== null &&
            each.decidedAt !== null &&
            each.decidedAt > lastWeek.from &&
            each.decidedAt <= lastWeek.to,
        )
        expect(figures.sentAsWritten + figures.sentAfterEdits + figures.discarded).toBe(inWeek.length)
        const byPlace = figures.places.reduce(
          (sum, place) => sum + place.sentAsWritten + place.sentAfterEdits + place.discarded,
          0,
        )
        expect(byPlace).toBe(inWeek.length)
        expect(figures.quickApprovals).toBeLessThanOrEqual(figures.sentAsWritten)
      }),
    )
  })
})

describe('labelTotals', () => {
  it('breaks drafts down by the program that wrote them and by the stated model, unknown last', () => {
    const drafts: AgentDraft[] = [
      { ...decided('as_written', null, 1), client: 'Claude Code', model: 'claude-opus-5-5' },
      { ...decided('edited', null, 2), client: 'Claude Code', model: null },
      { ...decided('discarded', null, 3), client: 'codex via homingbird run', model: null },
    ]
    const figures = agentFiguresIn({ ...nothing, drafts }, lastWeek, 3)
    expect(figures.byClient).toEqual([
      { label: 'Claude Code', written: 2, sentAsWritten: 1, sentAfterEdits: 1, discarded: 0 },
      { label: 'codex via homingbird run', written: 1, sentAsWritten: 0, sentAfterEdits: 0, discarded: 1 },
    ])
    expect(figures.byModel.map((each) => [each.label, each.written])).toEqual([
      [null, 2],
      ['claude-opus-5-5', 1],
    ])
  })
})

describe('agentReportOf', () => {
  it('compares the last 7 and 30 days with the period before, and trends the last 8 weeks', () => {
    const activity: AgentActivity = {
      ...nothing,
      drafts: [
        decided('as_written', null, 1),
        decided('edited', null, 24 * 10),
        decided('discarded', null, 24 * 40),
      ],
    }
    const report = agentReportOf(activity, NOW, 3)
    expect(report).toMatchObject({ generatedAt: NOW, quickApprovalSeconds: 3, minimumDecided: 10 })
    expect(report.periods.map((period) => period.days)).toEqual([7, 30])
    expect(report.periods[0]!.current.sentAsWritten).toBe(1)
    expect(report.periods[0]!.previous.sentAfterEdits).toBe(1)
    expect(report.periods[1]!.current.sentAfterEdits).toBe(1)
    expect(report.periods[1]!.previous.discarded).toBe(1)
    expect(report.weeks).toHaveLength(8)
    expect(report.weeks.at(-1)).toEqual({ start: NOW - 7 * DAY_MS, decided: 1, sentAsWritten: 1 })
    expect(report.weeks.at(-2)).toEqual({ start: NOW - 14 * DAY_MS, decided: 1, sentAsWritten: 0 })
  })
})
