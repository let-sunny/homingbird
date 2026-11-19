import {
  type AgentReport,
  type LatestSession,
  SESSION_BUCKET_MINIMUM,
  type SessionBucketFigures,
} from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import { bucketShares, hasSessionFigures, sessionsDueForFreshStart } from '../session-health.ts'
import { formats, percentOf, strings } from '../strings.ts'

/** How it is doing, by session: edit and discard shares by the session's age and its context use. */
export const sessionSection = (report: AgentReport): HTMLElement | null => {
  const { sessions } = report
  if (!hasSessionFigures(sessions.byAge)) return null
  const text = strings.trust.sessions
  return h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'trust-sessions' },
    h('h3', { id: 'trust-sessions' }, text.title),
    h('p', { class: 'trust-footnote' }, text.intro({ days: sessions.days })),
    bucketTable(text.byAgeCaption, sessions.byAge, (bucket) => text.ages[bucket as keyof typeof text.ages]),
    hasSessionFigures(sessions.byContext.filter((bucket) => bucket.bucket !== 'unknown')) &&
      bucketTable(
        text.byContextCaption,
        sessions.byContext,
        (bucket) => text.contexts[bucket as keyof typeof text.contexts],
      ),
    h('p', { class: 'trust-footnote' }, text.tooFewExplained({ minimum: SESSION_BUCKET_MINIMUM })),
  )
}

/** On Connection: a suggestion to start afresh for each desk whose latest draft came from a long or full session. */
export const freshSessionSuggestions = (latest: ReadonlyArray<LatestSession>): HTMLElement | null => {
  const due = sessionsDueForFreshStart(latest)
  if (due.length === 0) return null
  return h(
    'div',
    { class: 'flow-warning fresh-session', role: 'note' },
    due.map((session) => h('p', {}, strings.trust.sessions.freshSuggestion({ name: session.agentName }))),
  )
}

const bucketTable = (
  caption: string,
  buckets: ReadonlyArray<SessionBucketFigures>,
  nameOf: (bucket: string) => string,
): HTMLElement => {
  const text = strings.trust.sessions
  const shown = (share: number | null): string => (share === null ? text.tooFew : percentOf(share))
  return h(
    'div',
    { class: 'table-scroll trust-table-scroll' },
    h(
      'table',
      { class: 'trust-table' },
      h('caption', {}, caption),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          [text.bucketColumn, text.decidedColumn, text.editedColumn, text.discardedColumn].map((heading) =>
            h('th', { scope: 'col' }, heading),
          ),
        ),
      ),
      h(
        'tbody',
        {},
        buckets.map((bucket) => {
          const shares = bucketShares(bucket)
          return h(
            'tr',
            {},
            h('th', { scope: 'row' }, nameOf(bucket.bucket)),
            h('td', {}, formats.decimal.format(bucket.decided)),
            h('td', {}, shown(shares.edited)),
            h('td', {}, shown(shares.discarded)),
          )
        }),
      ),
    ),
  )
}
