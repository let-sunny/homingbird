import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { insightsSection } from '../../src/views/insights.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const organization = {
  activeMembers: 5,
  notesSent: 20,
  newNotes: 10,
  answered: 7,
  medianFirstReplyMs: null,
  agentDraftsWritten: 6,
  sentAsWritten: 4,
  sentAfterEdits: 2,
  discarded: 2,
  quickApprovals: 1,
  skipped: 2,
  places: [{ place: 'billing', notesSent: 4, sentAsWritten: 1, sentAfterEdits: 1, discarded: 0, skipped: 1 }],
  hiddenPlaces: 1,
  byClient: [],
  byModel: [],
  hiddenLabels: 2,
}

describe('insightsSection', () => {
  it('loads the numbers and shows the period chosen, with places and what is hidden', () => {
    const { context, called } = testContext()
    const shown = insightsSection(context, lifetime())
    expect(textOf(shown)).toContain(strings.loading)
    called('loadInsights')[0]!.then!.done!({
      generatedAt: 0,
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      blocks: 1,
      periods: [
        { days: 30, current: organization, previous: null },
        { days: 7, current: null, previous: null },
      ],
    })
    expect(getByRole(shown, 'table', { name: strings.insights.caption({ days: 30 }) })).toBeTruthy()
    expect(getByRole(shown, 'rowheader', { name: '#billing' })).toBeTruthy()
    expect(textOf(shown)).toContain(strings.insights.hiddenPlaces({ count: 1 }))
    expect(textOf(shown)).toContain(strings.insights.hiddenLabels({ count: 2 }))
    getByRole(shown, 'radio', { name: strings.trust.lastDays({ days: 7 }) }).click()
    expect(textOf(shown)).toContain(strings.insights.tooFew({ minimum: 5 }))
  })

  it('says when no place has notes', () => {
    const { context, called } = testContext()
    const shown = insightsSection(context, lifetime())
    called('loadInsights')[0]!.then!.done!({
      generatedAt: 0,
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      blocks: null,
      periods: [
        {
          days: 30,
          current: { ...organization, places: [], hiddenPlaces: 0, hiddenLabels: 0 },
          previous: null,
        },
      ],
    })
    expect(textOf(shown)).toContain(strings.insights.noPlaces)
  })
})
