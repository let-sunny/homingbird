import { Schema as S } from '@homingbird/kernel'
import { Timestamp } from './ids.ts'

/** Whether a desk session is due for a fresh start: long-running, or its context mostly used. */
export const needsFreshSession = (session: {
  readonly ageMinutes: number
  readonly contextPercent: number | null
}): boolean =>
  session.ageMinutes >= FRESH_SESSION_AFTER_MINUTES ||
  (session.contextPercent ?? 0) >= FRESH_SESSION_AT_CONTEXT_PERCENT

export const sessionAgeBucket = (ageMinutes: number): SessionAgeBucket =>
  ageMinutes < 60 ? 'under_hour' : ageMinutes < 240 ? 'hours' : ageMinutes < 720 ? 'half_day' : 'longer'

export const contextBucket = (contextPercent: number | null): ContextBucket =>
  contextPercent === null
    ? 'unknown'
    : contextPercent < 50
      ? 'under_half'
      : contextPercent < FRESH_SESSION_AT_CONTEXT_PERCENT
        ? 'most'
        : 'nearly_full'

export const FRESH_SESSION_AFTER_MINUTES = 8 * 60
export const FRESH_SESSION_AT_CONTEXT_PERCENT = 80
export const SESSION_BUCKET_MINIMUM = 5
export const SESSION_AGE_MAX_MINUTES = 60 * 24 * 365

/** What a desk reports about its session with each draft: never shown to anyone but the draft's author. */
export const DeskSession = S.struct({
  ageMinutes: S.int({ min: 0, max: SESSION_AGE_MAX_MINUTES }),
  contextPercent: S.optional(S.nullable(S.int({ min: 0, max: 100 }))),
})
export type DeskSession = S.Infer<typeof DeskSession>

export const SESSION_AGE_BUCKETS = ['under_hour', 'hours', 'half_day', 'longer'] as const
export const SessionAgeBucket = S.literal(...SESSION_AGE_BUCKETS)
export type SessionAgeBucket = S.Infer<typeof SessionAgeBucket>

export const CONTEXT_BUCKETS = ['under_half', 'most', 'nearly_full', 'unknown'] as const
export const ContextBucket = S.literal(...CONTEXT_BUCKETS)
export type ContextBucket = S.Infer<typeof ContextBucket>

/** Decided drafts in one bucket; the edit and discard counts are null below the minimum. */
export const SessionBucketFigures = S.struct({
  bucket: S.string({ maxLength: 20 }),
  decided: S.int({ min: 0 }),
  edited: S.nullable(S.int({ min: 0 })),
  discarded: S.nullable(S.int({ min: 0 })),
})
export type SessionBucketFigures = S.Infer<typeof SessionBucketFigures>

export const LatestSession = S.struct({
  agentName: S.string({ maxLength: 200 }),
  ageMinutes: S.int({ min: 0, max: SESSION_AGE_MAX_MINUTES }),
  contextPercent: S.nullable(S.int({ min: 0, max: 100 })),
  at: Timestamp,
})
export type LatestSession = S.Infer<typeof LatestSession>

export const SessionHealth = S.struct({
  days: S.int({ min: 1 }),
  byAge: S.array(SessionBucketFigures),
  byContext: S.array(SessionBucketFigures),
  latest: S.array(LatestSession),
})
export type SessionHealth = S.Infer<typeof SessionHealth>
