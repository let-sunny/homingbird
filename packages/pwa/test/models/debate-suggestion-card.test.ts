import type { MemberId } from '@homingbird/protocol'
import { DEBATE_QUESTION_MAX, SHORT_DEBATE_LIMITS, SUGGESTED_MEMBERS_MAX } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { suggestionAcceptance, suggestionCardModel } from '../../src/models/debate-suggestion-card.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, member, suggestion } from '../support/fixtures.ts'

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
  [CY, member(CY, 'Cy')],
])

describe('suggestionCardModel', () => {
  it('names the agent, the colleagues, the reason and the short limits', () => {
    const card = suggestionCardModel({ suggestion: suggestion(), members })
    expect(card.heading).toBe(strings.debateSuggestion.heading({ agent: 'Desk', people: 'Ben and Cy' }))
    expect(card.reason.text).toBe('Billing and support both touch the refund flow.')
    expect(card.question.value).toBe('Can we ship the refund change on Friday?')
    expect(card.people.chosen).toEqual([BEN, CY])
    expect(card.people.limit).toBe(SUGGESTED_MEMBERS_MAX)
    expect(card.limits).toBe(strings.debateSuggestion.limits({ minutes: SHORT_DEBATE_LIMITS.minutes }))
    expect(card.labels).toEqual({
      open: strings.debateSuggestion.open,
      dismiss: strings.debateSuggestion.dismiss,
    })
  })

  it('says so when none of the colleagues is known', () => {
    const card = suggestionCardModel({ suggestion: suggestion(), members: new Map() })
    expect(card.heading).toBe(strings.debateSuggestion.headingAlone({ agent: 'Desk' }))
  })
})

describe('suggestionAcceptance', () => {
  const typed = { question: '  Ship Friday?  ', memberIds: [BEN] as MemberId[], brief: '  ' }

  it('sends the trimmed question and people, and a note only when one was written', () => {
    expect(suggestionAcceptance(typed)).toEqual({
      acceptance: { question: 'Ship Friday?', memberIds: [BEN] },
    })
    expect(suggestionAcceptance({ ...typed, brief: ' Share the plan ' })).toEqual({
      acceptance: { question: 'Ship Friday?', memberIds: [BEN], brief: 'Share the plan' },
    })
  })

  it('says why it cannot be opened yet', () => {
    expect(suggestionAcceptance({ ...typed, question: ' ' })).toEqual({
      problem: strings.debateSuggestion.questionEmpty,
    })
    expect(suggestionAcceptance({ ...typed, question: 'x'.repeat(DEBATE_QUESTION_MAX + 1) })).toEqual({
      problem: strings.debateSuggestion.questionTooLong({ max: DEBATE_QUESTION_MAX }),
    })
    expect(suggestionAcceptance({ ...typed, memberIds: [] })).toEqual({
      problem: strings.debateSuggestion.peopleEmpty,
    })
    expect(
      suggestionAcceptance({
        ...typed,
        memberIds: Array.from({ length: SUGGESTED_MEMBERS_MAX + 1 }, () => BEN),
      }),
    ).toEqual({ problem: strings.debateSuggestion.peopleTooMany({ max: SUGGESTED_MEMBERS_MAX }) })
  })
})
