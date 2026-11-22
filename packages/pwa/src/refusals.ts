import { type ApiError, DRAFT_CHANGED, SLACK_THREAD_MOVED } from '@homingbird/protocol'
import { errorText, strings } from './strings.ts'

export type Attempt =
  | 'device'
  | 'draft'
  | 'channel-name'
  | 'managers'
  | 'leave'
  | 'move'
  | 'request'
  | 'membership'

export const refusalText = (error: ApiError, attempt?: Attempt): string => {
  if (error._tag === 'Conflict' && ARCHIVED.test(error.message)) return strings.refusals.roomArchived
  const named = attempt === 'draft' && error._tag === 'Conflict' ? DRAFT_REFUSALS[error.message] : undefined
  if (named !== undefined) return named()
  if (attempt === 'device' && CODE_REFUSALS.has(error._tag)) return strings.refusals.connectionCode
  const known = attempt === undefined || error._tag !== 'Conflict' ? null : CONFLICTS[attempt]()
  return known ?? errorText(error)
}

const DRAFT_REFUSALS: Readonly<Record<string, () => string>> = {
  [DRAFT_CHANGED]: () => strings.refusals.draftChanged,
  [SLACK_THREAD_MOVED]: () => strings.refusals.slackThreadMoved,
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
}
