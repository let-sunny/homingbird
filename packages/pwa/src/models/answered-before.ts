import {
  type AsRead,
  EARLIER_QUESTION_MAX,
  type MemberId,
  type NoteId,
  questionTerms,
} from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { excerpt } from '../thread.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * "Answered before" under the composer: earlier answers that may answer the question being written,
 * a way to say one does, and a way to keep writing. It never stands between the person and Send.
 */
export const answeredBeforeModel = (input: AnsweredBeforeInput): AnsweredBeforeModel => {
  if (input.answered) return { kind: 'answered', text: strings.answeredBefore.answered }
  if (input.dismissed || input.found.length === 0) return { kind: 'none' }
  return {
    kind: 'shown',
    title: strings.answeredBefore.title,
    lead: strings.answeredBefore.lead,
    keepWriting: strings.answeredBefore.keepWriting,
    items: input.found.map((found) => itemOf(found, input)),
  }
}

/** The question to look up earlier answers for, or null while there is nothing worth looking up. */
export const questionToLookUp = (typed: string, isReplying: boolean): string | null => {
  const question = typed.trim()
  if (isReplying || questionTerms(question).length === 0) return null
  return question.slice(0, EARLIER_QUESTION_MAX)
}

export interface AnsweredBeforeInput {
  readonly found: ReadonlyArray<AsRead.EarlierAnswer>
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
