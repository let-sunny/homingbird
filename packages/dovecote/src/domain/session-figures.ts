import {
  CONTEXT_BUCKETS,
  type LatestSession,
  SESSION_AGE_BUCKETS,
  SESSION_AGE_MAX_MINUTES,
  SESSION_BUCKET_MINIMUM,
  type SessionBucketFigures,
  type SessionHealth,
  contextBucket,
  sessionAgeBucket,
} from '@homingbird/protocol'
import { type AgentDraft, DAY_MS, type DraftOutcome, isIn } from './trust-figures.ts'

/** How drafts fared by the age and context use of the desk session that wrote them, for their author alone. */
export const sessionHealthOf = (drafts: ReadonlyArray<AgentDraft>, now: number): SessionHealth => {
  const window = { from: now - SESSION_DAYS * DAY_MS, to: Number.POSITIVE_INFINITY }
  const reported = drafts.filter(
    (draft) =>
      draft.sessionMinutes !== null && draft.sessionMinutes !== undefined && isIn(window, draft.createdAt),
  )
  const decided = reported.filter((draft) => draft.outcome !== null)
  return {
    days: SESSION_DAYS,
    byAge: SESSION_AGE_BUCKETS.map((bucket) =>
      figuresOf(
        bucket,
        decided.filter((draft) => sessionAgeBucket(draft.sessionMinutes!) === bucket),
      ),
    ),
    byContext: CONTEXT_BUCKETS.map((bucket) =>
      figuresOf(
        bucket,
        decided.filter((draft) => contextBucket(draft.contextPercent ?? null) === bucket),
      ),
    ),
    latest: latestSessions(reported, now),
  }
}

const SESSION_DAYS = 30

/** A desk's age is told forward from its latest draft only for this long; after that it may have restarted. */
const LATEST_SESSION_FRESH_MS = 60 * 60_000

const figuresOf = (bucket: string, drafts: ReadonlyArray<AgentDraft>): SessionBucketFigures => {
  const shown = drafts.length >= SESSION_BUCKET_MINIMUM
  const count = (outcome: DraftOutcome) => drafts.filter((draft) => draft.outcome === outcome).length
  return {
    bucket,
    decided: drafts.length,
    edited: shown ? count('edited') : null,
    discarded: shown ? count('discarded') : null,
  }
}

const latestSessions = (drafts: ReadonlyArray<AgentDraft>, now: number): LatestSession[] => {
  const newest = new Map<string, AgentDraft>()
  for (const draft of drafts) {
    const name = draft.agentName ?? ''
    const known = newest.get(name)
    if (known === undefined || draft.createdAt > known.createdAt) newest.set(name, draft)
  }
  return [...newest]
    .filter(([, draft]) => now - draft.createdAt < LATEST_SESSION_FRESH_MS)
    .map(([agentName, draft]) => ({
      agentName,
      ageMinutes: Math.min(
        SESSION_AGE_MAX_MINUTES,
        draft.sessionMinutes! + Math.floor(Math.max(0, now - draft.createdAt) / 60_000),
      ),
      contextPercent: draft.contextPercent ?? null,
      at: draft.createdAt,
    }))
    .sort((a, b) => b.at - a.at || a.agentName.localeCompare(b.agentName))
}
