import type { OrganizationFigures, OrganizationInsights } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  authorshipModel,
  deliveryModel,
  quickTrendModel,
  quickWarningModel,
} from '../../src/models/insights-sections.ts'
import { durationOf, formats, percentOf, strings } from '../../src/strings.ts'

const figures = (fields: Partial<OrganizationFigures> = {}): OrganizationFigures => ({
  activeMembers: 5,
  notesSent: 8,
  newNotes: 4,
  answered: 2,
  medianFirstReplyMs: null,
  agentDraftsWritten: 6,
  sentAsWritten: 4,
  sentAfterEdits: 2,
  discarded: 0,
  quickApprovals: 1,
  skipped: 0,
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
  blocks: 0,
  periods: [],
  ...fields,
})

describe('authorshipModel', () => {
  it('splits what was sent by who wrote it, as shares of everything sent', () => {
    const model = authorshipModel(figures({ authorship: { agent: 4, humanEdited: 2, human: 2 } }), 5)
    expect(model.hidden).toBeNull()
    expect(model.rows).toEqual([
      {
        key: 'agent',
        share: 0.5,
        line: strings.measures.authorshipAgent({ share: percentOf(0.5), count: 4 }),
      },
      {
        key: 'edited',
        share: 0.25,
        line: strings.measures.authorshipEdited({ share: percentOf(0.25), count: 2 }),
      },
      {
        key: 'person',
        share: 0.25,
        line: strings.measures.authorshipHuman({ share: percentOf(0.25), count: 2 }),
      },
    ])
  })

  it('says why it is hidden, and shows empty bars when nothing was sent', () => {
    expect(authorshipModel(figures({ authorship: null }), 5)).toMatchObject({
      rows: [],
      hidden: strings.measures.authorshipHidden({ minimum: 5 }),
    })
    expect(authorshipModel(figures(), 6).hidden).toBe(strings.measures.authorshipHidden({ minimum: 6 }))
    expect(authorshipModel(figures({ authorship: null }), 1).hidden).toBe(strings.trust.noneYet)
    const none = authorshipModel(figures({ authorship: { agent: 0, humanEdited: 0, human: 0 } }), 5)
    expect(none.rows.map((row) => row.share)).toEqual([0, 0, 0])
  })
})

describe('deliveryModel', () => {
  it('gives each delivery figure with its share of the notes it is part of', () => {
    const model = deliveryModel(
      figures({
        delivery: {
          received: 10,
          toAgents: 8,
          pickedUpQuickly: 6,
          medianPickupMs: 90_000,
          waitedWithoutAgent: 1,
        },
      }),
      5,
    )
    expect(model.hidden).toBeNull()
    expect(model.rows).toEqual([
      [strings.measures.deliveryReceived, formats.decimal.format(10)],
      [
        strings.measures.deliveryToAgents,
        strings.insights.partOf({ share: percentOf(0.8), count: 8, total: 10 }),
      ],
      [
        strings.measures.deliveryQuickly,
        strings.insights.partOf({ share: percentOf(0.75), count: 6, total: 8 }),
      ],
      [strings.measures.deliveryMedian, durationOf(90_000)],
      [
        strings.measures.deliveryWaited,
        strings.insights.partOf({ share: percentOf(0.125), count: 1, total: 8 }),
      ],
    ])
  })

  it('hides the typical pickup time on its own, and says none yet where nothing reached an agent', () => {
    const model = deliveryModel(
      figures({
        delivery: {
          received: 0,
          toAgents: 0,
          pickedUpQuickly: 0,
          medianPickupMs: null,
          waitedWithoutAgent: 0,
        },
      }),
      5,
    )
    expect(model.rows.map((row) => row[1])).toEqual([
      '0',
      strings.trust.noneYet,
      strings.trust.noneYet,
      strings.insights.hidden,
      strings.trust.noneYet,
    ])
    const everyone = deliveryModel(
      figures({
        delivery: {
          received: 0,
          toAgents: 0,
          pickedUpQuickly: 0,
          medianPickupMs: null,
          waitedWithoutAgent: 0,
        },
      }),
      1,
    )
    expect(everyone.rows[3]![1]).toBe(strings.trust.noneYet)
  })

  it('hides the received total on its own, and shows the notes to agents as a count', () => {
    const model = deliveryModel(
      figures({
        delivery: {
          received: null,
          toAgents: 8,
          pickedUpQuickly: 6,
          medianPickupMs: null,
          waitedWithoutAgent: 0,
        },
      }),
      5,
    )
    expect(model.rows.slice(0, 2)).toEqual([
      [strings.measures.deliveryReceived, strings.insights.hidden],
      [strings.measures.deliveryToAgents, '8'],
    ])
  })

  it('says why delivery is hidden', () => {
    expect(deliveryModel(figures({ delivery: null }), 5)).toEqual({
      title: strings.measures.deliveryTitle,
      intro: strings.measures.deliveryIntro,
      rows: [],
      hidden: strings.measures.deliveryHidden({ minimum: 5 }),
    })
    expect(deliveryModel(figures({ delivery: null }), 1).hidden).toBe(strings.trust.noneYet)
  })
})

describe('quickTrendModel', () => {
  const week = (index: number) => formats.day.format(new Date(index * 7 * 86_400_000))

  it('draws the quick share week by week, hiding a week with too few people', () => {
    const trend = quickTrendModel(
      insights({
        weeks: [
          { start: 0, sentAsWritten: 10, quickApprovals: 3 },
          { start: 7 * 86_400_000, sentAsWritten: null, quickApprovals: null },
          { start: 14 * 86_400_000, sentAsWritten: 0, quickApprovals: 0 },
        ],
      }),
    )!
    expect(trend.id).toBe('insights-quick-trend')
    expect(trend.intro).toBe(strings.measures.quickTrendIntro({ seconds: 3 }))
    expect(trend.bars).toEqual([
      {
        share: 0.3,
        shareText: percentOf(0.3),
        label: week(0),
        spoken: strings.measures.quickTrendWeek({ date: week(0), quick: 3, asWritten: 10 }),
      },
      {
        share: null,
        shareText: '–',
        label: week(1),
        spoken: strings.measures.quickTrendHiddenWeek({ date: week(1) }),
      },
      {
        share: null,
        shareText: '–',
        label: week(2),
        spoken: strings.measures.quickTrendWeek({ date: week(2), quick: 0, asWritten: 0 }),
      },
    ])
    expect(trend.rows).toEqual([
      [week(0), '10', '3', percentOf(0.3)],
      [week(1), strings.insights.hidden, strings.insights.hidden, strings.insights.hidden],
      [week(2), '0', '0', strings.trust.noneYet],
    ])
  })

  it('draws nothing for a server without the weeks', () => {
    expect(quickTrendModel(insights())).toBeNull()
  })
})

describe('quickWarningModel', () => {
  it('warns only when the server says quick approvals stayed frequent', () => {
    expect(quickWarningModel(insights({ quickWarning: true }))).toBe(
      strings.measures.quickWarning({ weeks: 2, share: percentOf(0.25), seconds: 3 }),
    )
    expect(quickWarningModel(insights({ quickWarning: false }))).toBeNull()
    expect(quickWarningModel(insights())).toBeNull()
  })
})
