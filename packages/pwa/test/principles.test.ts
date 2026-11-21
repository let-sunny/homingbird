import { type Principle, type PrincipleOffer, TRUST_MINIMUM_DECIDED } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  appliedPrinciples,
  countsShown,
  needsConfirmation,
  offersIn,
  problemText,
  sourceHost,
  suggestionText,
} from '../src/principles.ts'

const principle = (topic: string): Principle => ({
  id: `prin_${'a'.repeat(12)}` as Principle['id'],
  kind: 'rule',
  topic,
  rule: 'check RELEASES.md',
  source: null,
  place: null,
  enabled: true,
  origin: 'manual',
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  lastAppliedAt: null,
  publicText: null,
  counts: { applied: 0, sentAsWritten: 0, edited: 0, discarded: 0, missed: 0 },
})

const offer = (changes: Partial<PrincipleOffer> = {}): PrincipleOffer => ({
  id: 'offer_aaaaaaaaaaaa',
  kind: 'edit',
  noteId: 'note_aaaaaaaaaaaa' as PrincipleOffer['noteId'],
  conversationId: 'conv_aaaaaaaaaaaa' as PrincipleOffer['conversationId'],
  place: null,
  suggestion: { added: 'Tuesday', removed: 'soon' },
  createdAt: 1,
  ...changes,
})

describe('appliedPrinciples', () => {
  it('matches the titles the basis names against the person’s own principles, and nothing else', () => {
    const mine = [principle('Release dates'), principle('Tone')]
    expect(appliedPrinciples('Read it.\nPrinciples applied: release dates; Invented', mine)).toEqual([
      mine[0],
    ])
    expect(appliedPrinciples(null, mine)).toEqual([])
  })
})

describe('countsShown', () => {
  it('shows no share below the minimum that every trust verdict uses', () => {
    expect(TRUST_MINIMUM_DECIDED).toBe(10)
    expect(
      countsShown({ applied: 9, sentAsWritten: 8, edited: 1, discarded: 0, missed: 0 }).sentAsWrittenShare,
    ).toBeNull()
    expect(
      countsShown({ applied: 10, sentAsWritten: 8, edited: 2, discarded: 0, missed: 0 }).sentAsWrittenShare,
    ).toBe(0.8)
  })
})

describe('sourceHost', () => {
  it('shows the host of an http or https source, and nothing for anything else', () => {
    expect(sourceHost('https://wiki.example.com/releases')).toBe('wiki.example.com')
    expect(sourceHost('javascript:alert(1)')).toBeNull()
    expect(sourceHost('not a url')).toBeNull()
  })
})

describe('offers', () => {
  it('finds the chances to teach of one conversation', () => {
    expect(
      offersIn([offer(), offer({ conversationId: 'conv_bbbbbbbbbbbb' as never })], 'conv_aaaaaaaaaaaa'),
    ).toHaveLength(1)
  })

  it('asks for confirmation only when the suggestion is saved as it was offered', () => {
    expect(needsConfirmation(offer(), 'say “Tuesday” instead of “soon” ')).toBe(true)
    expect(needsConfirmation(offer(), 'give weekday and time zone')).toBe(false)
    expect(needsConfirmation(offer({ suggestion: null }), '')).toBe(false)
    expect(needsConfirmation(null, 'anything')).toBe(false)
    expect(needsConfirmation(offer(), 'mention Tuesday, never soon')).toBe(true)
  })

  it('words the suggestion from the changed phrases', () => {
    expect(suggestionText({ added: 'Tuesday', removed: 'soon' })).toBe('say “Tuesday” instead of “soon”')
    expect(suggestionText({ added: 'the calendar', removed: null })).toBe('include “the calendar”')
    expect(suggestionText({ added: null, removed: 'probably' })).toBe('leave out “probably”')
  })
})

describe('problemText', () => {
  it('words every problem in the person’s language, with the limits filled in', () => {
    expect(problemText(null)).toBeNull()
    expect(problemText('answer_too_long')).toBe(
      'An answer may have at most 300 characters, title and answer together. Shorten it, or link the longer text as its source.',
    )
    expect(problemText('rule_too_long')).toBe(
      'A principle may have at most 300 characters, title and rule together.',
    )
    for (const problem of [
      'answer_empty',
      'rule_empty',
      'public_empty',
      'public_repeats',
      'public_names_channel',
    ] as const)
      expect(problemText(problem)).toBe(PROBLEM_TEXT[problem])
  })
})

const PROBLEM_TEXT = {
  answer_empty: 'An answer needs its text or a source to take it from.',
  rule_empty: 'A rule needs to say how to answer.',
  public_empty: 'Write a sentence for your colleagues first.',
  public_repeats:
    'Write the public sentence in your own words; it may not repeat the private text or its source.',
  public_names_channel: 'Leave the channel’s name out of the public sentence.',
}
