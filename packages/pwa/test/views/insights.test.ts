import { lifetime } from '@homingbird/ui'
import { allByRole, getByRole, textOf } from '@homingbird/ui/testing'
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

  it('shows who wrote what was sent, delivery, the quick-approval weeks and a warning that is announced', () => {
    const { context, called } = testContext()
    const shown = insightsSection(context, lifetime())
    called('loadInsights')[0]!.then!.done!({
      generatedAt: 0,
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      blocks: 0,
      quickWarning: true,
      weeks: [{ start: 0, sentAsWritten: 10, quickApprovals: 4 }],
      periods: [
        {
          days: 30,
          current: {
            ...organization,
            medianDecisionMs: 5_000,
            authorship: { agent: 2, humanEdited: 1, human: 1 },
            delivery: {
              received: 4,
              toAgents: 4,
              pickedUpQuickly: 3,
              medianPickupMs: 60_000,
              waitedWithoutAgent: 0,
            },
          },
          previous: null,
        },
      ],
    })
    expect(getByRole(shown, 'status').textContent).toBe(
      strings.measures.quickWarning({ weeks: 2, share: '25%', seconds: 3 }),
    )
    expect(getByRole(shown, 'heading', { name: strings.measures.authorshipTitle })).toBeTruthy()
    expect(shown.querySelectorAll('[data-authorship] .share-bar')).toHaveLength(3)
    expect(getByRole(shown, 'rowheader', { name: strings.measures.deliveryReceived })).toBeTruthy()
    expect(getByRole(shown, 'rowheader', { name: strings.measures.decisionTimeRow })).toBeTruthy()
    expect(getByRole(shown, 'heading', { name: strings.measures.quickTrendTitle })).toBeTruthy()
    expect(getByRole(shown, 'link', { name: strings.measures.pageLink }).getAttribute('href')).toBe(
      '#/measured',
    )
  })

  it('says why authorship and delivery are hidden, with no warning', () => {
    const { context, called } = testContext()
    const shown = insightsSection(context, lifetime())
    called('loadInsights')[0]!.then!.done!({
      generatedAt: 0,
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      blocks: 0,
      periods: [{ days: 30, current: { ...organization, authorship: null, delivery: null }, previous: null }],
    })
    expect(textOf(shown)).toContain(strings.measures.authorshipHidden({ minimum: 5 }))
    expect(textOf(shown)).toContain(strings.measures.deliveryHidden({ minimum: 5 }))
    expect(shown.querySelector('[role="status"]')).toBeNull()
    expect(allByRole(shown, 'heading', { name: strings.measures.quickTrendTitle })).toHaveLength(0)
  })

  it('shows each team by name, and how many teams too small to show were left out', () => {
    const { context, called } = testContext()
    const shown = insightsSection(context, lifetime())
    const team = {
      team: 'Payments',
      activeMembers: 2,
      notesSent: 3,
      sentAsWritten: 1,
      sentAfterEdits: 0,
      discarded: null,
      quickApprovals: 0,
      medianDecisionMs: 60_000,
      skipped: 0,
    }
    called('loadInsights')[0]!.then!.done!({
      generatedAt: 0,
      quickApprovalSeconds: 3,
      minimumGroupSize: 1,
      blocks: 0,
      periods: [{ days: 30, current: { ...organization, teams: [team], hiddenTeams: 2 }, previous: null }],
    })
    const section = getByRole(shown, 'heading', { name: strings.insights.teamsTitle }).parentElement!
    expect(getByRole(section, 'rowheader', { name: 'Payments' })).toBeTruthy()
    expect(textOf(section)).toContain(strings.insights.hiddenTeams({ count: 2 }))
    expect(textOf(section)).toContain(strings.insights.teamsExplained)
    expect(textOf(shown)).not.toContain(strings.insights.noTeams)
    expect(shown.querySelector('.flow-warning[role="note"]')).toBeNull()
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
