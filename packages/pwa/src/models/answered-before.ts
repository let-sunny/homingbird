import {
  type AsRead,
  EARLIER_QUESTION_MAX,
  type MemberId,
  type NoteId,
  questionTerms,
  rankEarlierAnswers,
} from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { durationOf, strings } from '../strings.ts'
import { excerpt } from '../thread.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * "Answered before" under the composer: earlier answers that may answer the question being written,
 * a way to say one does, and a way to keep writing. It never stands between the person and Send.
 */
export const answeredBeforeModel = (input: AnsweredBeforeInput): AnsweredBeforeModel => {
  if (input.answered) return { kind: 'answered', text: strings.answeredBefore.answered }
  const open = input.open ?? []
  if (input.dismissed || (input.found.length === 0 && open.length === 0)) return { kind: 'none' }
  const answered = input.found.length > 0
  return {
    kind: 'shown',
    title: answered ? strings.answeredBefore.title : strings.answeredBefore.askedTitle,
    lead: answered ? strings.answeredBefore.lead : strings.answeredBefore.askedLead,
    keepWriting: strings.answeredBefore.keepWriting,
    items: input.found.map((found) => itemOf(found, input)),
    asked: open.map((each) => askedItemOf(each, input)),
  }
}

/**
 * Questions in this room that nobody answered yet and that share the words of the one being written,
 * by the same rule as earlier answers, so that the person does not ask the same thing twice. A manager
 * is told when the answer to one waits for their own review.
 */
export const openQuestionsLike = (
  typed: string,
  notes: ReadonlyArray<AsRead.Note>,
  reviews: ReadonlyArray<AsRead.Review>,
): OpenQuestion[] => {
  const question = questionToLookUp(typed, false)
  if (question === null) return []
  const answered = new Set(
    notes.flatMap((note) => (note.status === 'sent' && note.inReplyTo !== null ? [note.inReplyTo] : [])),
  )
  const candidates = notes
    .filter((note) => note.status === 'sent' && note.inReplyTo === null && !answered.has(note.id))
    .map((note) => ({
      note,
      question: { id: note.id, body: note.body },
      answer: { body: '', sentAt: note.sentAt, conversationId: note.conversationId },
    }))
  return rankEarlierAnswers(candidates, questionTerms(question), null).map(({ note }) => ({
    question: note,
    waitsForYourReview: reviews.some((review) => review.note.inReplyTo === note.id),
  }))
}

/** The question to look up earlier answers for, or null while there is nothing worth looking up. */
export const questionToLookUp = (typed: string, isReplying: boolean): string | null => {
  const question = typed.trim()
  if (isReplying || questionTerms(question).length === 0) return null
  return question.slice(0, EARLIER_QUESTION_MAX)
}

export interface OpenQuestion {
  readonly question: AsRead.Note
  readonly waitsForYourReview: boolean
}

export interface AnsweredBeforeInput {
  readonly found: ReadonlyArray<AsRead.EarlierAnswer>
  /** Questions still open in the room, from `openQuestionsLike`. */
  readonly open?: ReadonlyArray<OpenQuestion>
  readonly dismissed: boolean
  readonly answered: boolean
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly now: number
}

export type AnsweredBeforeModel =
  | { readonly kind: 'none' }
  | { readonly kind: 'answered'; readonly text: string }
  | {
      readonly kind: 'shown'
      readonly title: string
      readonly lead: string
      readonly keepWriting: string
      readonly items: ReadonlyArray<AnsweredBeforeItem>
      readonly asked: ReadonlyArray<AskedItem>
    }

export interface AskedItem {
  readonly questionId: NoteId
  readonly question: string
  readonly asked: string
  readonly review: string | null
  readonly href: string
  readonly open: string
}

export interface AnsweredBeforeItem {
  readonly answerId: NoteId
  readonly question: string
  readonly answer: string
  readonly approvedBy: string
  readonly place: string | null
  readonly time: TimeShown
  readonly href: string
  readonly open: string
  readonly thisAnswersIt: string
}

const itemOf = (found: AsRead.EarlierAnswer, input: AnsweredBeforeInput): AnsweredBeforeItem => {
  const approver = found.answer.approvedBy ?? found.answer.authorId
  return {
    answerId: found.answer.id,
    question: excerpt(found.question.body, 120),
    answer: excerpt(found.answer.body, 240),
    approvedBy: strings.answeredBefore.approvedBy({
      name: input.members.get(approver)?.name ?? strings.formerMember,
    }),
    place: found.channel === null ? null : strings.answeredBefore.inChannel({ channel: found.channel }),
    time: timeShown(found.answer.sentAt ?? found.answer.createdAt, input.now),
    href: hrefFor({ name: 'conversation', id: found.answer.conversationId, draft: null }),
    open: strings.answeredBefore.open,
    thisAnswersIt: strings.answeredBefore.thisAnswersIt,
  }
}

const askedItemOf = (open: OpenQuestion, input: AnsweredBeforeInput): AskedItem => {
  const { question } = open
  const at = question.sentAt ?? question.createdAt
  return {
    questionId: question.id,
    question: excerpt(question.body, 120),
    asked: strings.answeredBefore.askedBy({
      elapsed: durationOf(Math.max(MINUTE_MS, input.now - at)),
      name: input.members.get(question.authorId)?.name ?? strings.formerMember,
    }),
    review: open.waitsForYourReview ? strings.answeredBefore.waitsForYourReview : null,
    href: hrefFor({ name: 'conversation', id: question.conversationId, draft: null, note: question.id }),
    open: strings.answeredBefore.openQuestion,
  }
}

const MINUTE_MS = 60_000
