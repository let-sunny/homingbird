import { type LatestSession, type SessionBucketFigures, needsFreshSession } from '@homingbird/protocol'
import { shareOf } from './trust.ts'

/** A bucket's edit and discard shares, or null where too few drafts were decided to show them. */
export const bucketShares = (
  figures: SessionBucketFigures,
): { readonly edited: number | null; readonly discarded: number | null } => ({
  edited: figures.edited === null ? null : shareOf(figures.edited, figures.decided),
  discarded: figures.discarded === null ? null : shareOf(figures.discarded, figures.decided),
})

/** The desks whose latest draft came from a session due for a fresh start. */
export const sessionsDueForFreshStart = (latest: ReadonlyArray<LatestSession>): LatestSession[] =>
  latest.filter(needsFreshSession)

/** Whether any bucket has drafts at all, so an empty table is never shown. */
export const hasSessionFigures = (buckets: ReadonlyArray<SessionBucketFigures>): boolean =>
  buckets.some((bucket) => bucket.decided > 0)
