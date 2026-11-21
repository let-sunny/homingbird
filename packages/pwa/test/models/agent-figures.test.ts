import { describe, expect, it } from 'vitest'
import { figuresModel, labelsTableModel, periodChoices } from '../../src/models/agent-figures.ts'
import { durationOf, formats, percentOf, strings } from '../../src/strings.ts'
import { figures, report } from '../support/fixtures.ts'

const shown = (model: ReturnType<typeof figuresModel>) => {
  if (model.kind !== 'figures') throw new Error('expected figures')
  return model
}

describe('figuresModel', () => {
  it('waits for the report and says when it could not load', () => {
    expect(figuresModel(null, 7)).toEqual({ kind: 'loading' })
    expect(figuresModel('failed', 7)).toEqual({ kind: 'failed', text: strings.trust.loadFailed })
  })

  it('gives too few decisions as the verdict, without a change, a nudge, skips or places', () => {
    const model = shown(figuresModel(report(), 7))
    expect(model.headline).toEqual({
      verdictClass: 'is-too-few',
      verdict: strings.trust.verdict.too_few,
      basis: strings.trust.tooFewBasis({ count: 0, days: 7, minimum: 10 }),
      change: null,
      teach: strings.trust.teach.too_few,
      nudge: null,
    })
    expect(model.skips).toBeNull()
    expect(model.places).toBeNull()
    expect(model.byClient).toBeNull()
    expect(model.table.rows[6]).toEqual([
      strings.trust.rows.medianDecision,
      strings.trust.noneYet,
      strings.trust.noneYet,
    ])
    expect(model.measured.lines.at(-1)).toBe(strings.trust.quickExplained({ seconds: 3 }))
    expect(model.measured.link).toEqual({ href: '#/measured', label: strings.measures.pageLink })
    expect(model.trend.id).toBe('trust-trend')
  })

  it('compares the share sent as written and nudges a person who approves too quickly', () => {
    const current = figures({
      written: 12,
      sentAsWritten: 9,
      sentAfterEdits: 1,
      discarded: 0,
      verdict: 'usually_as_written',
      quickApprovals: 4,
      quickApprovalsFrequent: true,
      medianDecisionMs: 45_000,
      debateResultsSent: 2,
    })
    const model = shown(
      figuresModel(
        report({ periods: [{ days: 7, current, previous: figures({ sentAsWritten: 1, discarded: 1 }) }] }),
        7,
      ),
    )
    expect(model.headline.verdictClass).toBe('is-usually-as-written')
    expect(model.headline.basis).toBe(strings.trust.basis({ count: 10, asWritten: 9, days: 7 }))
    expect(model.headline.change).toBe(
      strings.trust.shareUp({ share: percentOf(0.9), before: percentOf(0.5) }),
    )
    expect(model.headline.nudge).toEqual({
      title: strings.trust.nudge,
      detail: strings.trust.nudgeDetail({ count: 4, seconds: 3 }),
    })
    expect(model.table.rows[1]).toEqual([
      strings.trust.rows.sentAsWritten,
      strings.trust.countAndShare({ count: '9', share: percentOf(0.9) }),
      strings.trust.countAndShare({ count: '1', share: percentOf(0.5) }),
    ])
    expect(model.table.rows[6]![1]).toBe(durationOf(45_000))
    expect(model.table.rows[9]).toEqual([strings.trust.rows.debateResultsSent, '2', '0'])
  })

  it('words a falling, steady and new share', () => {
    const change = (current: number, previous: number | null) =>
      shown(
        figuresModel(
          report({
            periods: [
              {
                days: 7,
                current: figures({ sentAsWritten: current, discarded: 10 - current }),
                previous:
                  previous === null
                    ? figures()
                    : figures({ sentAsWritten: previous, discarded: 10 - previous }),
              },
            ],
          }),
          7,
        ),
      ).headline.change
    expect(change(5, 9)).toBe(strings.trust.shareDown({ share: percentOf(0.5), before: percentOf(0.9) }))
    expect(change(5, 5)).toBe(strings.trust.shareSame({ share: percentOf(0.5) }))
    expect(change(5, null)).toBe(strings.trust.shareNew({ share: percentOf(0.5) }))
  })

  it('lists why drafts were skipped, or says none was given', () => {
    const withSkips = (skipReasons: Array<{ reason: string; count: number }>) =>
      shown(
        figuresModel(
          report({
            periods: [{ days: 7, current: figures({ skipped: 2, skipReasons }), previous: figures() }],
          }),
          7,
        ),
      ).skips
    expect(withSkips([])).toEqual({
      title: strings.trust.skipsTitle,
      reasons: [],
      none: strings.trust.noSkipReasons,
    })
    expect(withSkips([{ reason: 'Out of scope', count: 2 }])!.reasons).toEqual([
      strings.trust.skipReason({ reason: 'Out of scope', count: 2 }),
    ])
  })

  it('shows each place with its share and verdict, and the places nothing was decided in', () => {
    const current = figures({
      places: [
        {
          place: 'billing',
          sentAsWritten: 3,
          sentAfterEdits: 1,
          discarded: 0,
          skipped: 2,
          verdict: 'usually_as_written',
        },
        { place: null, sentAsWritten: 0, sentAfterEdits: 0, discarded: 0, skipped: 0, verdict: 'too_few' },
      ],
    } as never)
    const places = shown(figuresModel(report({ periods: [{ days: 7, current, previous: figures() }] }), 7))
      .places!
    expect(places.rows).toEqual([
      {
        key: 'billing',
        line: strings.trust.placeLine({ place: '#billing', asWritten: 3, decided: 4 }),
        share: 0.75,
        verdict: strings.trust.verdict.usually_as_written,
        skipped: strings.trust.placeSkipped({ count: 2 }),
      },
      {
        key: 'direct',
        line: strings.trust.placeNothingDecided({ place: strings.trust.directMessages }),
        share: null,
        verdict: null,
        skipped: null,
      },
    ])
  })

  it('draws the trend by week, with a dash for a week without decisions', () => {
    const trend = shown(
      figuresModel(
        report({
          weeks: [
            { start: 1, decided: 4, sentAsWritten: 3 },
            { start: 2, decided: 0, sentAsWritten: 0 },
          ],
        }),
        7,
      ),
    ).trend
    const week = (start: number) => formats.day.format(new Date(start))
    expect(trend.bars).toEqual([
      {
        share: 0.75,
        shareText: percentOf(0.75),
        label: week(1),
        spoken: strings.trust.trendWeek({ date: week(1), asWritten: 3, decided: 4 }),
      },
      {
        share: null,
        shareText: '–',
        label: week(2),
        spoken: strings.trust.trendEmptyWeek({ date: week(2) }),
      },
    ])
    expect(trend.rows).toEqual([
      [week(1), '4', '3', percentOf(0.75)],
      [week(2), '0', '0', strings.trust.noneYet],
    ])
  })
})

describe('labelsTableModel', () => {
  it('shows drafts by label, an unknown label in words, and hidden counts as hidden', () => {
    expect(labelsTableModel('id', 'Title', [], 'Unknown')).toBeNull()
    const table = labelsTableModel(
      'id',
      'Title',
      [
        { label: 'x'.repeat(40), written: 3, sentAsWritten: 1, sentAfterEdits: 1, discarded: 1 },
        { label: null, written: 2, sentAsWritten: null, sentAfterEdits: null, discarded: null },
        { label: 'Web', written: 1, sentAsWritten: 1, sentAfterEdits: 0, discarded: 0 },
      ],
      'Unknown',
    )!
    expect(table.rows[2]).toMatchObject({ title: strings.clients.web, label: strings.clients.web })
    expect(table.rows[0]!.title).toBe('x'.repeat(40))
    expect(table.rows[0]!.label).toHaveLength(32)
    expect(table.rows[1]).toEqual({
      title: 'Unknown',
      label: 'Unknown',
      cells: ['2', strings.insights.hidden, strings.insights.hidden, strings.insights.hidden],
    })
  })
})

describe('periodChoices', () => {
  it('offers the last 7 and 30 days, the chosen one checked', () => {
    expect(periodChoices(30)).toEqual([
      { days: 7, label: strings.trust.lastDays({ days: 7 }), checked: false },
      { days: 30, label: strings.trust.lastDays({ days: 30 }), checked: true },
    ])
  })
})
