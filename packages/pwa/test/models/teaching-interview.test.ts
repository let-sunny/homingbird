import { type AsRead, TEACHING_DOCUMENT_MAX } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { idsOf, interviewModel, proposalChange } from '../../src/models/teaching-interview.ts'
import { strings } from '../../src/strings.ts'
import { CHECKING } from '../support/resource-load.ts'

const proposal = (overrides: Partial<AsRead.PrincipleProposal> = {}): AsRead.PrincipleProposal => ({
  id: 'prop_aaaaaaaaaaaa' as AsRead.PrincipleProposal['id'],
  kind: 'rule',
  topic: 'Refund requests',
  rule: 'check the order date and offer a refund within 30 days',
  source: null,
  place: null,
  question: 'How do you usually handle refund requests?',
  origin: 'chat',
  rewriteOf: null,
  createdAt: 1,
  ...overrides,
})

const interview = (proposals: ReadonlyArray<AsRead.PrincipleProposal>, document: string | null = null) => ({
  document,
  proposals,
  limit: 20,
})

describe('interviewModel', () => {
  it('waits until the proposals have come', () => {
    expect(interviewModel(null, CHECKING)).toEqual({ kind: 'waiting', wait: CHECKING })
  })

  it('says how to start a chat with the person’s own agent, and that nothing waits yet', () => {
    const model = interviewModel(interview([]), CHECKING)
    if (model.kind !== 'shown') throw new Error('expected the section')
    expect(model.title).toBe(strings.teach.chat.title)
    expect(model.steps).toHaveLength(3)
    expect(model.steps[1]).toContain('/homingbird teach')
    expect(model.noModel).toBe(strings.teach.chat.noModel)
    expect(model.document).toMatchObject({ value: '', maxLength: TEACHING_DOCUMENT_MAX, remove: null })
    expect(model.document.hint).toBe(strings.teach.chat.documentHint({ max: TEACHING_DOCUMENT_MAX }))
    expect(model.groups).toEqual([])
    expect(model.empty).toBe(strings.teach.chat.empty)
    expect(model.waiting).toBe(strings.teach.chat.waiting({ count: 0, limit: 20 }))
  })

  it('shows the chat’s proposals and the suggestions from rewritten drafts apart, each with a way to save them all', () => {
    const fromEdit = proposal({
      id: 'prop_bbbbbbbbbbbb' as never,
      origin: 'edit',
      question: null,
      place: 'billing',
    })
    const fromDiscard = proposal({ id: 'prop_cccccccccccc' as never, origin: 'discard', kind: 'answer' })
    const model = interviewModel(
      interview([proposal(), fromEdit, fromDiscard], 'Refunds: 30 days.'),
      CHECKING,
    )
    if (model.kind !== 'shown') throw new Error('expected the section')
    expect(model.document).toMatchObject({
      value: 'Refunds: 30 days.',
      remove: strings.teach.chat.documentRemove,
    })
    expect(model.empty).toBeNull()
    expect(model.groups.map((group) => [group.key, group.title, group.intro, group.saveAll])).toEqual([
      ['chat', strings.teach.chat.proposalsTitle, null, strings.teach.chat.saveAll({ count: 1 })],
      [
        'rewrites',
        strings.teach.chat.rewritesTitle,
        strings.teach.chat.rewritesIntro,
        strings.teach.chat.saveAll({ count: 2 }),
      ],
    ])
    const [chat, rewrites] = model.groups
    expect(chat!.cards[0]!.details).toEqual([
      strings.teach.chat.asked({ question: 'How do you usually handle refund requests?' }),
      strings.teach.anywhere,
    ])
    expect(rewrites!.cards[0]!.details).toEqual([strings.teach.chat.fromEdit, '#billing'])
    expect(rewrites!.cards[1]!.details).toContain(strings.teach.chat.fromDiscard)
    expect(rewrites!.cards[1]!.kindBadge).toBe(strings.teach.kindBadge.answer)
    expect(rewrites!.cards[1]!.fields[1]!.label).toBe(strings.teach.answer)
    expect(chat!.cards[0]!.fields[1]!.label).toBe(strings.teach.rule)
    expect(idsOf(rewrites!.cards)).toEqual(['prop_bbbbbbbbbbbb', 'prop_cccccccccccc'])
  })

  it('warns on a card as the save dialog would, but not that it reads as a wish', () => {
    const model = interviewModel(
      interview([proposal({ rule: 'The refund window is 30 days.' }), proposal({ rule: 'be nice' })]),
      CHECKING,
    )
    if (model.kind !== 'shown') throw new Error('expected the section')
    expect(model.groups[0]!.cards[0]!.warnings).toEqual([strings.teach.advice.stored_answer])
    expect(model.groups[0]!.cards[1]!.warnings).toEqual([])
  })
})

describe('proposalChange', () => {
  const card = () => {
    const model = interviewModel(interview([proposal()]), CHECKING)
    if (model.kind !== 'shown') throw new Error('expected the section')
    return model.groups[0]!.cards[0]!
  }

  it('sends the person’s changes trimmed', () => {
    expect(proposalChange(card(), { topic: ' Refunds ', rule: ' ask billing first ' })).toEqual({
      change: { topic: 'Refunds', rule: 'ask billing first' },
    })
  })

  it('says why it cannot be saved yet', () => {
    expect(proposalChange(card(), { topic: 'Refunds', rule: ' ' })).toEqual({
      problem: strings.teach.problems.rule_empty,
    })
    expect(proposalChange(card(), { topic: ' ', rule: 'ask billing' })).toEqual({
      problem: strings.teach.chat.topicEmpty,
    })
  })

  it('checks an answer as an answer', () => {
    const model = interviewModel(interview([proposal({ kind: 'answer' })]), CHECKING)
    if (model.kind !== 'shown') throw new Error('expected the section')
    expect(proposalChange(model.groups[0]!.cards[0]!, { topic: 'Refunds', rule: '' })).toEqual({
      problem: strings.teach.problems.answer_empty,
    })
  })
})
