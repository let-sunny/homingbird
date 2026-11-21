import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  EARLIER_ANSWERS_MAX,
  QUESTION_TERMS_MAX,
  questionTerms,
  rankEarlierAnswers,
} from '../src/earlier-answers.ts'

const candidate = (
  id: string,
  question: string,
  answer: string,
  sentAt: number | null = 1,
  conversationId = 'room',
) => ({ question: { id: `q-${id}`, body: question }, answer: { body: answer, sentAt, conversationId }, id })

describe('questionTerms', () => {
  it('keeps the words worth matching, lower-case, without common words or short ones', () => {
    expect(questionTerms('Where is the Release calendar kept?')).toEqual(['release', 'calendar', 'kept'])
  })

  it('keeps each word once', () => {
    expect(questionTerms('deploy deploy DEPLOY')).toEqual(['deploy'])
  })

  it('keeps words of three letters and drops shorter ones, counting letters rather than code units', () => {
    expect(questionTerms('vpn is up 캘린더 ok')).toEqual(['vpn', '캘린더'])
  })

  it('splits on anything that is not a letter or a digit', () => {
    expect(questionTerms('release-calendar/2026')).toEqual(['release', 'calendar', '2026'])
  })

  it('finds nothing in a question of only common words or punctuation', () => {
    expect(questionTerms('Where is it? ...')).toEqual([])
    expect(questionTerms('')).toEqual([])
  })

  it('keeps at most eight terms, the first ones', () => {
    const terms = questionTerms('alpha bravo charlie delta echo foxtrot golf hotel india juliet')
    expect(terms).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'])
    expect(QUESTION_TERMS_MAX).toBe(8)
  })

  it('never returns a term shorter than three letters, a repeated term or more than eight', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const terms = questionTerms(text)
        expect(terms.length).toBeLessThanOrEqual(QUESTION_TERMS_MAX)
        expect(new Set(terms).size).toBe(terms.length)
        for (const term of terms) {
          expect([...term].length).toBeGreaterThanOrEqual(3)
          expect(term).toBe(term.toLowerCase())
        }
      }),
    )
  })
})

describe('rankEarlierAnswers', () => {
  const terms = ['release', 'calendar', 'kept']

  it('finds nothing without terms', () => {
    expect(rankEarlierAnswers([candidate('a', 'release calendar', 'x')], [], null)).toEqual([])
  })

  it('needs half the terms, and at least two, to match', () => {
    const one = candidate('one', 'release notes?', 'In the wiki.')
    const two = candidate('two', 'release calendar?', 'In the wiki.')
    expect(rankEarlierAnswers([one, two], terms, null).map((each) => each.id)).toEqual(['two'])
  })

  it('needs every term of a one- or two-term question', () => {
    expect(rankEarlierAnswers([candidate('a', 'VPN?', 'Ask IT.')], ['vpn'], null)).toHaveLength(1)
    expect(
      rankEarlierAnswers([candidate('a', 'release?', 'Weekly.')], ['release', 'calendar'], null),
    ).toEqual([])
  })

  it('needs half the terms of a long question, rounded up', () => {
    const long = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
    const matchesTwo = candidate('two', 'alpha bravo', '')
    const matchesThree = candidate('three', 'alpha bravo charlie', '')
    expect(rankEarlierAnswers([matchesTwo, matchesThree], long, null).map((each) => each.id)).toEqual([
      'three',
    ])
  })

  it('matches words in the answer as well as the question, ignoring case', () => {
    const found = rankEarlierAnswers(
      [candidate('a', 'Anyone?', 'The RELEASE Calendar is in Drive.')],
      terms,
      null,
    )
    expect(found.map((each) => each.id)).toEqual(['a'])
  })

  it('ranks a match in the earlier question above the same match in its answer', () => {
    const inAnswer = candidate('answer', 'Where?', 'release calendar', 9)
    const inQuestion = candidate('question', 'release calendar', 'Drive.', 1)
    expect(rankEarlierAnswers([inAnswer, inQuestion], terms, null).map((each) => each.id)).toEqual([
      'question',
      'answer',
    ])
  })

  it('ranks more shared words above fewer', () => {
    const two = candidate('two', 'release calendar', '', 9)
    const three = candidate('three', 'release calendar kept', '', 1)
    expect(rankEarlierAnswers([two, three], terms, null).map((each) => each.id)).toEqual(['three', 'two'])
  })

  it('puts an equal match in the room the question goes to first, then the newer one', () => {
    const elsewhere = candidate('elsewhere', 'release calendar', '', 9, 'wiki')
    const here = candidate('here', 'release calendar', '', 1, 'deploys')
    const newer = candidate('newer', 'release calendar', '', 5, 'wiki')
    expect(rankEarlierAnswers([newer, elsewhere, here], terms, 'deploys').map((each) => each.id)).toEqual([
      'here',
      'elsewhere',
      'newer',
    ])
    expect(rankEarlierAnswers([newer, elsewhere, here], terms, null).map((each) => each.id)).toEqual([
      'elsewhere',
      'newer',
      'here',
    ])
  })

  it('orders an answer without a send time after a timed one', () => {
    const timed = candidate('timed', 'release calendar', '', 1)
    const untimed = candidate('untimed', 'release calendar', '', null)
    expect(rankEarlierAnswers([untimed, timed], terms, null).map((each) => each.id)).toEqual([
      'timed',
      'untimed',
    ])
    expect(rankEarlierAnswers([timed, untimed], terms, null).map((each) => each.id)).toEqual([
      'timed',
      'untimed',
    ])
  })

  it('shows one answer per earlier question, the best one', () => {
    const first = {
      ...candidate('first', 'release calendar', 'Drive.', 1),
      question: { id: 'q', body: 'release calendar' },
    }
    const second = {
      ...candidate('second', 'release calendar', 'Drive, kept there.', 2),
      question: { id: 'q', body: 'release calendar' },
    }
    expect(rankEarlierAnswers([first, second], terms, null).map((each) => each.id)).toEqual(['second'])
  })

  it('shows at most three', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id, index) => candidate(id, 'release calendar', '', index))
    expect(rankEarlierAnswers(many, terms, null).map((each) => each.id)).toEqual(['e', 'd', 'c'])
    expect(EARLIER_ANSWERS_MAX).toBe(3)
  })

  it('returns only candidates it was given, each question once, never more than three', () => {
    const arbitraryCandidate = fc.record({
      id: fc.string(),
      question: fc.record({ id: fc.constantFrom('q1', 'q2', 'q3', 'q4', 'q5'), body: fc.string() }),
      answer: fc.record({
        body: fc.string(),
        sentAt: fc.option(fc.nat(), { nil: null }),
        conversationId: fc.constantFrom('a', 'b'),
      }),
    })
    fc.assert(
      fc.property(
        fc.array(arbitraryCandidate),
        fc.array(fc.constantFrom('release', 'calendar', 'kept', 'a', 'b')),
        (candidates, given) => {
          const ranked = rankEarlierAnswers(candidates, given, 'a')
          expect(ranked.length).toBeLessThanOrEqual(EARLIER_ANSWERS_MAX)
          expect(new Set(ranked.map((each) => each.question.id)).size).toBe(ranked.length)
          for (const each of ranked) expect(candidates).toContain(each)
        },
      ),
    )
  })
})
