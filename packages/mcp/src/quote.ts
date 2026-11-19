import { Task as T } from '@homingbird/kernel'
import { type ApiError, type AsRead, type Quoting, authorsIn } from '@homingbird/protocol'
import type { MemberApi } from './member-api.ts'

/** How this adapter quotes notes for a model: every member by their directory name, each note with a fresh nonce. */
export const quotingFor = (
  api: Pick<MemberApi, 'directory.list'>,
  nonce: () => string,
): T.Task<Quoting, ApiError> =>
  T.map(({ entries }: { entries: ReadonlyArray<{ readonly member: AsRead.Member }> }) => ({
    nonce,
    authors: authorsIn(entries),
  }))(api['directory.list']({ query: {} }))
