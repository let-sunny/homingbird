import type { OrganizationFigures, OrganizationInsights } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { insightsModel } from '../../src/models/insights.ts'
import { durationOf, percentOf, strings } from '../../src/strings.ts'

const organization = (fields: Partial<OrganizationFigures> = {}): OrganizationFigures => ({
  activeMembers: 5,
  notesSent: 20,
  newNotes: 10,
  answered: 7,
  medianFirstReplyMs: 60_000,
  agentDraftsWritten: 6,
  sentAsWritten: 4,
  sentAfterEdits: 2,
  discarded: 2,
  quickApprovals: 1,
  skipped: 2,
  debateResultsSent: 1,
  places: [],
  hiddenPlaces: 0,
  byClient: [],
  byModel: [],
  hiddenLabels: 0,
  ...fields,
})

const insights = (fields: Partial<OrganizationInsights> = {}): OrganizationInsights => ({
  generatedAt: 0,
  quickApprovalSeconds: 3,
  minimumGroupSize: 5,
  blocks: 2,
  periods: [
    { days: 7, current: organization(), previous: organization() },
    { days: 30, current: organization(), previous: null },
  ],
  ...fields,
})

const figuresOf = (model: ReturnType<typeof insightsModel>) => {
  if (model.kind !== 'insights' || model.figures === null) throw new Error('expected figures')
  return model.figures
}

describe('insightsModel', () => {
  it('waits for the numbers', () => {
    expect(insightsModel(null, 30)).toEqual({ kind: 'loading' })
  })

  it('shows the period chosen, hides an earlier period too small to show, and counts blocks', () => {
    const model = insightsModel(insights(), 30)
    if (model.kind !== 'insights') throw new Error('expected insights')
    expect(model.warnings).toEqual([strings.insights.noTeams, strings.insights.privacy({ minimum: 5 })])
    expect(model.tooFew).toBeNull()
    expect(model.blocks).toBe(strings.insights.blocks({ count: 2 }))
    const table = figuresOf(model).table
    expect(table.caption).toBe(strings.insights.caption({ days: 30 }))
    expect(table.rows[0]).toEqual([strings.insights.rows.activeMembers, '5', strings.insights.hidden])
    expect(table.rows[2]![1]).toBe(strings.insights.partOf({ share: percentOf(0.7), count: 7, total: 10 }))
    expect(table.rows[3]![1]).toBe(durationOf(60_000))
    expect(table.rows[4]![1]).toBe(strings.insights.partOf({ share: percentOf(0.5), count: 4, total: 8 }))
    expect(table.rows[7]![1]).toBe(strings.insights.partOf({ share: percentOf(0.25), count: 1, total: 4 }))
    expect(table.rows[8]![1]).toBe(strings.insights.partOf({ share: percentOf(0.25), count: 2, total: 8 }))
    expect(table.rows[9]![1]).toBe('1')
    expect(table.footnotes).toHaveLength(3)
  })

  it('falls back to the first period, and says when a period has too few people', () => {
    const model = insightsModel(
      insights({ periods: [{ days: 7, current: null, previous: null }], blocks: null }),
      90,
    )
    expect(model).toMatchObject({
      kind: 'insights',
      tooFew: strings.insights.tooFew({ minimum: 5 }),
      figures: null,
      blocks: strings.insights.blocksHidden({ minimum: 5 }),
    })
  })

  it('hides draft decisions too few people made, and shows none yet where nothing was counted', () => {
    const hidden = organization({
      sentAsWritten: null,
      sentAfterEdits: null,
      discarded: null,
      quickApprovals: null,
      newNotes: 0,
      answered: 0,
      medianFirstReplyMs: null,
      skipped: 0,
      agentDraftsWritten: 0,
      debateResultsSent: null,
      activeMembers: 0,
    })
    const table = figuresOf(
      insightsModel(insights({ periods: [{ days: 7, current: hidden, previous: null }] }), 7),
    ).table
    expect(table.rows.map((row) => row[1])).toEqual([
      '0',
      '0',
      strings.trust.noneYet,
      strings.trust.noneYet,
      strings.insights.hidden,
      strings.insights.hidden,
      strings.insights.hidden,
      strings.insights.hidden,
      strings.trust.noneYet,
      strings.insights.hidden,
      strings.insights.hidden,
    ])
    expect(table.footnotes.at(-1)).toBe(strings.insights.draftsHidden({ minimum: 5 }))
    const shown = organization({ sentAsWritten: 0, sentAfterEdits: 0, discarded: 0, quickApprovals: 0 })
    const zero = figuresOf(
      insightsModel(insights({ periods: [{ days: 7, current: shown, previous: null }] }), 7),
    ).table
    expect(zero.rows[4]![1]).toBe(strings.trust.noneYet)
    expect(zero.rows[7]![1]).toBe(strings.trust.noneYet)
  })

  it('lists places with their decisions, hidden where too few decided, and counts hidden places and labels', () => {
    const current = organization({
      places: [
        { place: 'billing', notesSent: 4, sentAsWritten: 1, sentAfterEdits: 1, discarded: 0, skipped: 1 },
        { place: null, notesSent: 2, sentAsWritten: null, sentAfterEdits: null, discarded: null, skipped: 0 },
        { place: 'ops', notesSent: 1, sentAsWritten: 0, sentAfterEdits: 0, discarded: 0, skipped: 0 },
      ],
      hiddenPlaces: 2,
      hiddenLabels: 3,
      byClient: [{ label: 'Desk', written: 1, sentAsWritten: 1, sentAfterEdits: 0, discarded: 0 }],
    })
    const shown = figuresOf(insightsModel(insights({ periods: [{ days: 7, current, previous: null }] }), 7))
    expect(shown.places.none).toBeNull()
    expect(shown.places.rows).toEqual([
      ['#billing', '4', '2', percentOf(0.5), '1'],
      [strings.trust.directMessages, '2', strings.insights.hidden, strings.insights.hidden, '0'],
      ['#ops', '1', '0', strings.trust.noneYet, '0'],
    ])
    expect(shown.places.hidden).toBe(strings.insights.hiddenPlaces({ count: 2 }))
    expect(shown.hiddenLabels).toBe(strings.insights.hiddenLabels({ count: 3 }))
    expect(shown.byClient?.rows).toHaveLength(1)
    const none = figuresOf(insightsModel(insights(), 7))
    expect(none.places.none).toBe(strings.insights.noPlaces)
    expect(none.places.hidden).toBeNull()
    expect(none.hiddenLabels).toBeNull()
  })
})
