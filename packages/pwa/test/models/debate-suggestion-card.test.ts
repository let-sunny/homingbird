import type { MemberId } from '@homingbird/protocol'
import { DEBATE_QUESTION_MAX, SHORT_DEBATE_LIMITS, SUGGESTED_MEMBERS_MAX } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { suggestionAcceptance, suggestionCardModel } from '../../src/models/debate-suggestion-card.ts'
import { hrefFor } from '../../src/routes.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, entry, member, suggestion } from '../support/fixtures.ts'

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
  [CY, member(CY, 'Cy')],
])

const awake = { humanOnline: true, agentOnline: true }
const everyoneAwake = [
  entry(ANA, 'Ana', { presence: awake }),
  entry(BEN, 'Ben', { presence: awake }),
  entry(CY, 'Cy', { presence: awake }),
]
const cardFor = (directory = everyoneAwake, members_ = members) =>
  suggestionCardModel({ suggestion: suggestion(), members: members_, directory, viewerId: ANA })

describe('suggestionCardModel', () => {
  it('names the agent, the colleagues, the reason and the short limits', () => {
    const card = cardFor()
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
    expect(card.notAwake).toBeNull()
    expect(card.askInNote).toBeNull()
  })

  it('says so when none of the colleagues is known', () => {
    const card = cardFor(everyoneAwake, new Map())
    expect(card.heading).toBe(strings.debateSuggestion.headingAlone({ agent: 'Desk' }))
  })

  it('names the colleagues whose agents are not awake, and keeps the flock while two agents are', () => {
    const card = cardFor([
      entry(ANA, 'Ana', { presence: awake }),
      entry(BEN, 'Ben', { presence: awake }),
      entry(CY, 'Cy'),
    ])
    expect(card.notAwake).toBe(strings.debateSuggestion.notAwake({ people: 'Cy' }))
    expect(card.askInNote).toBeNull()
  })

  it('recommends a group note to the same colleagues when fewer than two agents are awake', () => {
    const card = cardFor([entry(ANA, 'Ana', { presence: awake }), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    expect(card.notAwake).toBe(strings.debateSuggestion.notAwake({ people: 'Ben and Cy' }))
    expect(card.askInNote).toEqual({
      text: strings.debateSuggestion.askInNote,
      label: strings.debateSuggestion.askInNoteLink,
      href: hrefFor({ name: 'new', to: [BEN, CY] }),
    })
  })

  it('counts the person’s own agent as awake when the directory does not list them', () => {
    expect(cardFor([entry(BEN, 'Ben', { presence: awake }), entry(CY, 'Cy')]).askInNote).toBeNull()
    expect(cardFor([entry(ANA, 'Ana'), entry(BEN, 'Ben', { presence: awake })]).askInNote).not.toBeNull()
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
