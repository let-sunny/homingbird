import { Schema as S } from '@homingbird/kernel'
import { ConversationId } from './ids.ts'
import { ChannelSlug, Note } from './model.ts'

/**
 * Earlier sent answers that may answer a question before it is asked: the most likely first, at most
 * `EARLIER_ANSWERS_MAX`, one per earlier question. Matching is by the words they share, never by a model.
 */
export const rankEarlierAnswers = <C extends Candidate>(
  candidates: ReadonlyArray<C>,
  terms: ReadonlyArray<string>,
  destination: string | null,
): C[] => {
  if (terms.length === 0) return []
  const needed = Math.min(terms.length, Math.max(2, Math.ceil(terms.length / 2)))
  const scored = candidates.flatMap((candidate) => {
    const match = matchOf(candidate, terms)
    return match.matched < needed ? [] : [{ candidate, score: match.score }]
  })
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(isAt(b.candidate, destination)) - Number(isAt(a.candidate, destination)) ||
      (b.candidate.answer.sentAt ?? 0) - (a.candidate.answer.sentAt ?? 0),
  )
  const questions = new Set<string>()
  const ranked: C[] = []
  for (const { candidate } of scored) {
    if (questions.has(candidate.question.id)) continue
    questions.add(candidate.question.id)
    ranked.push(candidate)
  }
  return ranked.slice(0, EARLIER_ANSWERS_MAX)
}

/** The words of a question worth matching: lower-case, three letters or more, no common words, at most eight. */
export const questionTerms = (text: string): string[] => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const terms = new Set(words.filter((word) => [...word].length >= 3 && !COMMON_WORDS.has(word)))
  return [...terms].slice(0, QUESTION_TERMS_MAX)
}

export const EARLIER_ANSWERS_MAX = 3
export const QUESTION_TERMS_MAX = 8
export const EARLIER_QUESTION_MAX = 2000

/** The question being written and where it goes; the destination only orders equal matches. */
export const EarlierAnswersAsk = S.struct({
  question: S.string({ minLength: 1, maxLength: EARLIER_QUESTION_MAX }),
  conversationId: S.optional(ConversationId),
  channel: S.optional(ChannelSlug),
})
export type EarlierAnswersAsk = S.Infer<typeof EarlierAnswersAsk>

/** An earlier question and a sent answer to it, both notes the asker may read; `channel` names its room. */
export const EarlierAnswer = S.struct({
  question: Note,
  answer: Note,
  channel: S.nullable(ChannelSlug),
})
export type EarlierAnswer = S.Infer<typeof EarlierAnswer>

/** The room the question was going to when an earlier answer answered it: where the deflection counts. */
export const AnsweredFromHistory = S.struct({ conversationId: ConversationId })
export type AnsweredFromHistory = S.Infer<typeof AnsweredFromHistory>

export interface Candidate {
  readonly question: { readonly id: string; readonly body: string }
  readonly answer: {
    readonly body: string
    readonly sentAt: number | null
    readonly conversationId: string
  }
}

/** A term found in the earlier question counts twice: questions asked alike are the better sign. */
const matchOf = (
  candidate: Candidate,
  terms: ReadonlyArray<string>,
): { readonly matched: number; readonly score: number } => {
  const question = candidate.question.body.toLowerCase()
  const answer = candidate.answer.body.toLowerCase()
  let matched = 0
  let score = 0
  for (const term of terms) {
    if (question.includes(term)) score += 2
    else if (answer.includes(term)) score += 1
    else continue
    matched += 1
  }
  return { matched, score }
}

const isAt = (candidate: Candidate, destination: string | null): boolean =>
  candidate.answer.conversationId === destination

const COMMON_WORDS = new Set([
  'about',
  'and',
  'any',
  'anyone',
  'are',
  'but',
  'can',
  'could',
  'did',
  'does',
  'for',
  'from',
  'get',
  'has',
  'have',
  'hello',
  'how',
  'its',
  'know',
  'not',
  'our',
  'please',
  'should',
  'some',
  'thanks',
  'that',
  'the',
  'there',
  'this',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
])
