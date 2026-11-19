import { Schema as S } from '@homingbird/kernel'
import { ANALYTICS_AGENT_PRESETS, ANALYTICS_PAGES } from './analytics-values.ts'
import { DebateVisibility } from './debates.ts'
import { Timestamp } from './ids.ts'
import { PrincipleKind } from './principles.ts'

/**
 * The product analytics catalogue: every event a client may send and the only properties it may carry.
 * Enums and buckets only, never content, names or email addresses; Dovecote refuses anything else.
 */
export const ANALYTICS_EVENTS = {
  sign_in_completed: S.struct({ client: S.literal('web', 'cli') }),
  page_viewed: S.struct({ page: S.literal(...ANALYTICS_PAGES) }),
  principle_saved: S.struct({ kind: PrincipleKind }),
  draft_approved: S.struct({ editedRatioBucket: S.optional(S.literal('none', 'some', 'most')) }),
  debate_opened: S.struct({ visibility: DebateVisibility }),
  desk_started: S.struct({ agentPreset: S.literal(...ANALYTICS_AGENT_PRESETS) }),
} as const

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS

export type AnalyticsProperties<N extends AnalyticsEventName> = S.Infer<(typeof ANALYTICS_EVENTS)[N]>

export const AnalyticsEvent = S.struct({
  event: S.string({ pattern: /^[a-z][a-z_]{0,39}$/ }),
  properties: S.record(S.unknown),
  anonymousId: S.string({ pattern: /^[A-Za-z0-9_-]{8,64}$/ }),
  timestamp: Timestamp,
})
export type AnalyticsEvent = S.Infer<typeof AnalyticsEvent>

export const ANALYTICS_BATCH_MAX = 20

export const AnalyticsBatch = S.struct({
  events: S.array(AnalyticsEvent, { minItems: 1, maxItems: ANALYTICS_BATCH_MAX }),
})

export const checkAnalyticsEvent = (event: AnalyticsEvent): string | null => {
  if (!Object.hasOwn(ANALYTICS_EVENTS, event.event))
    return `"${event.event}" is not in the analytics catalogue`
  const schema = ANALYTICS_EVENTS[event.event as AnalyticsEventName]
  const unknown = Object.keys(event.properties).filter((key) => !Object.hasOwn(schema.fields, key))
  if (unknown.length > 0)
    return `"${event.event}" does not carry ${unknown.map((key) => `"${key}"`).join(', ')}`
  const decoded = schema.decode(event.properties)
  return decoded._tag === 'Ok' ? null : `"${event.event}": ${S.formatIssues(decoded.error)}`
}

export const analyticsEvent = <N extends AnalyticsEventName>(
  name: N,
  properties: AnalyticsProperties<N>,
  anonymousId: string,
  timestamp: number,
): AnalyticsEvent => ({ event: name, properties, anonymousId, timestamp })
