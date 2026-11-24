import { isForeignAnswer } from '@homingbird/client'
import {
  type ApiError,
  DRAFT_CHANGED,
  SLACK_QUESTION_EDITED,
  SLACK_THREAD_MOVED,
  Unavailable,
} from '@homingbird/protocol'
import { errorText, locale, strings } from './strings.ts'

export type Attempt =
  | 'device'
  | 'draft'
  | 'channel-name'
  | 'managers'
  | 'leave'
  | 'move'
  | 'request'
  | 'membership'
  | 'meeting'

export const refusalText = (error: ApiError, attempt?: Attempt): string => {
  if (error._tag === 'Conflict' && ARCHIVED.test(error.message)) return strings.refusals.roomArchived
  const named = attempt === 'draft' && error._tag === 'Conflict' ? DRAFT_REFUSALS[error.message] : undefined
  if (named !== undefined) return named()
  if (attempt === 'device' && CODE_REFUSALS.has(error._tag)) return strings.refusals.connectionCode
  const known = attempt === undefined || error._tag !== 'Conflict' ? null : CONFLICTS[attempt]()
  return known ?? errorText(error)
}

/**
 * What the page says when the server refuses it before the person is in. The server's words are in English, so
 * another language gets a sentence of its own; English keeps the server's words when they say more than the status.
 */
export const firstScreenRefusal = (error: ApiError): string => {
  if (
    error._tag !== 'Forbidden' &&
    error._tag !== 'NotFound' &&
    error._tag !== 'Invalid' &&
    error._tag !== 'Conflict'
  )
    return errorText(error)
  const sentence = strings.firstLoad.refused[error._tag]
  return locale === 'en' && saysMore(error.message) ? error.message : sentence
}

/** Whether waiting may mend it: the server is away or too busy, rather than refusing. */
export const isTransient = (error: ApiError): boolean =>
  error._tag === 'Unavailable' || error._tag === 'RateLimited'

/** A refusal as a list may act on: one the server itself did not write, as a proxy's page, means it is away. */
export const refusalOfServer = (error: ApiError): ApiError =>
  isForeignAnswer(error) ? Unavailable({ message: error.message }) : error

const saysMore = (message: string): boolean => message.trim() !== '' && !JUST_THE_STATUS.test(message.trim())

const JUST_THE_STATUS = /^(forbidden|not found|invalid|bad request|conflict)\.?$/i

const DRAFT_REFUSALS: Readonly<Record<string, () => string>> = {
  [DRAFT_CHANGED]: () => strings.refusals.draftChanged,
  [SLACK_THREAD_MOVED]: () => strings.refusals.slackThreadMoved,
  [SLACK_QUESTION_EDITED]: () => strings.refusals.slackQuestionEdited,
}

const ARCHIVED = /\barchived\b/i

const CODE_REFUSALS: ReadonlySet<ApiError['_tag']> = new Set(['NotFound', 'Conflict', 'Invalid'])

const CONFLICTS: Readonly<Record<Attempt, () => string | null>> = {
  device: () => null,
  draft: () => strings.refusals.draftHandled,
  'channel-name': () => strings.refusals.nameTaken,
  managers: () => strings.refusals.lastManager,
  leave: () => strings.refusals.managerStays,
  move: () => null,
  request: () => strings.refusals.requestNotWaiting,
  membership: () => null,
  meeting: () => strings.refusals.meetingNotNow,
}
