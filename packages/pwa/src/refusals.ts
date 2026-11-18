import type { ApiError } from '@homingbird/protocol'
import { errorText, strings } from './strings.ts'

export type Attempt =
  | 'device'
  | 'draft'
  | 'channel-name'
  | 'managers'
  | 'visibility'
  | 'move'
  | 'request'
  | 'membership'

export const refusalText = (error: ApiError, attempt?: Attempt): string => {
  if (error._tag === 'Conflict' && ARCHIVED.test(error.message)) return strings.refusals.roomArchived
  if (attempt === 'device' && CODE_REFUSALS.has(error._tag)) return strings.refusals.connectionCode
  const known = attempt === undefined || error._tag !== 'Conflict' ? null : CONFLICTS[attempt]()
  return known ?? errorText(error)
}

const ARCHIVED = /\barchived\b/i

const CODE_REFUSALS: ReadonlySet<ApiError['_tag']> = new Set(['NotFound', 'Conflict', 'Invalid'])

const CONFLICTS: Readonly<Record<Attempt, () => string | null>> = {
  device: () => null,
  draft: () => strings.refusals.draftHandled,
  'channel-name': () => strings.refusals.nameTaken,
  managers: () => strings.refusals.lastManager,
  visibility: () => strings.refusals.needsManagerInRoom,
  move: () => null,
  request: () => strings.refusals.requestNotWaiting,
  membership: () => null,
}
