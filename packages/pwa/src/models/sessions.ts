import {
  type AsRead,
  type LatestSession,
  SESSION_BUCKET_MINIMUM,
  type SessionBucketFigures,
} from '@homingbird/protocol'
import { bucketShares, hasSessionFigures, sessionsDueForFreshStart } from '../session-health.ts'
import { formats, percentOf, strings } from '../strings.ts'

/** How it is doing, by session: edit and discard shares by the session's age and its context use. */
export const sessionsModel = (report: AsRead.AgentReport): SessionsModel | null => {
  const { sessions } = report
  if (!hasSessionFigures(sessions.byAge)) return null
  const text = strings.trust.sessions
  const known = sessions.byContext.filter((bucket) => bucket.bucket !== 'unknown')
  return {
    title: text.title,
    intro: text.intro({ days: sessions.days }),
    tables: [
      bucketTable(text.byAgeCaption, sessions.byAge, (bucket) => text.ages[bucket as keyof typeof text.ages]),
      ...(hasSessionFigures(known)
        ? [
            bucketTable(
              text.byContextCaption,
              sessions.byContext,
              (bucket) => text.contexts[bucket as keyof typeof text.contexts],
            ),
          ]
        : []),
    ],
    footnote: text.tooFewExplained({ minimum: SESSION_BUCKET_MINIMUM }),
  }
}

/** On Connection: a suggestion to start afresh for each desk whose latest draft came from a long or full session. */
export const freshSessionLines = (latest: ReadonlyArray<LatestSession>): ReadonlyArray<string> =>
  sessionsDueForFreshStart(latest).map((session) =>
    strings.trust.sessions.freshSuggestion({ name: session.agentName }),
  )

export interface SessionsModel {
  readonly title: string
  readonly intro: string
  readonly tables: ReadonlyArray<SessionTable>
  readonly footnote: string
}

export interface SessionTable {
  readonly caption: string
  readonly headings: ReadonlyArray<string>
  readonly rows: ReadonlyArray<readonly [string, string, string, string]>
}

const bucketTable = (
  caption: string,
  buckets: ReadonlyArray<SessionBucketFigures>,
  nameOf: (bucket: string) => string,
): SessionTable => {
  const text = strings.trust.sessions
  const shown = (share: number | null): string => (share === null ? text.tooFew : percentOf(share))
  return {
    caption,
    headings: [text.bucketColumn, text.decidedColumn, text.editedColumn, text.discardedColumn],
    rows: buckets.map((bucket) => {
      const shares = bucketShares(bucket)
      return [
        nameOf(bucket.bucket),
        formats.decimal.format(bucket.decided),
        shown(shares.edited),
        shown(shares.discarded),
      ]
    }),
  }
}
