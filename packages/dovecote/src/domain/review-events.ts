import { Task as T } from '@homingbird/kernel'
import type { MemberId, NoteId } from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'

/**
 * Tells reviewers that what waits for them changed, without content: a client reads the reviews again.
 * With no note, the list changed as a whole, as when an agent retires. Only a new answer notifies them.
 */
export const announceReview = (
  reviewers: Iterable<MemberId>,
  noteId: NoteId | null,
  change: { readonly isNewAnswer: boolean } = { isNewAnswer: false },
): T.Task<void, never, RequestEnv> =>
  T.map((env: RequestEnv) => {
    for (const memberId of new Set(reviewers))
      env.outbox.push({
        memberId,
        event: { seq: 0, at: env.clock.now(), body: { type: 'review.changed', noteId } },
        isNewReview: change.isNewAnswer,
      })
  })(T.ask<RequestEnv>())
