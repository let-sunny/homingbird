import { Task as T } from '@homingbird/kernel'
import {
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsProperties,
  analyticsEvent,
  isFeatureOffered,
} from '@homingbird/protocol'
import { type Action, withApp } from './app.ts'
import type { PageStorage } from './browser-page.ts'

/**
 * Counts one product event, anonymously, and sends it to this Dovecote only, and only while it offers
 * analytics. Dovecote checks it against the catalogue before it goes anywhere else.
 */
export const track = <N extends AnalyticsEventName>(name: N, properties: AnalyticsProperties<N>): Action =>
  withApp((app) =>
    T.sync(() => app.launch(counted(name, properties, analyticsStorage(app.page.storage, app.random.id)))),
  )

/** The counting as a task: the time from the clock service; a failure is dropped, never shown. */
export const counted = <N extends AnalyticsEventName>(
  name: N,
  properties: AnalyticsProperties<N>,
  storage: AnalyticsStorage,
): Action =>
  withApp(({ api, state, clock }) => {
    const event = eventToSend(state.serverInfo.get(), name, properties, storage, clock.now())
    if (event === null) return T.unit
    return T.catchAll(() => T.unit)(T.asUnit(api['analytics.track']({ body: { events: [event] } })))
  })

/** Counts that this browser finished signing in, once per tab session. */
export const trackSignIn: Action = withApp(({ page }) => {
  if (page.storage.session(SIGN_IN_COUNTED) !== null) return T.unit
  page.storage.setSession(SIGN_IN_COUNTED, '1')
  return track('sign_in_completed', { client: 'web' })
})

export interface AnalyticsStorage {
  readonly local: (key: string) => string | null
  readonly setLocal: (key: string, value: string) => void
  readonly session: (key: string) => string | null
  readonly setSession: (key: string, value: string) => void
  readonly newId: () => string
}

/** The event to send, or null while the server does not offer analytics. */
export const eventToSend = <N extends AnalyticsEventName>(
  info: { readonly features?: Readonly<Record<string, boolean>> } | null,
  name: N,
  properties: AnalyticsProperties<N>,
  storage: AnalyticsStorage,
  now: number,
): AnalyticsEvent | null =>
  info !== null && isFeatureOffered(info, 'analytics')
    ? analyticsEvent(name, properties, anonymousId(storage), now)
    : null

/** A random id kept in this browser only, never joined to the person who signed in. */
export const anonymousId = (storage: AnalyticsStorage): string => {
  const kept = storage.local(ANONYMOUS_ID_KEY)
  if (kept !== null && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept
  const made = storage.newId()
  storage.setLocal(ANONYMOUS_ID_KEY, made)
  return made
}

const ANONYMOUS_ID_KEY = 'homingbird.anonymousId'

const SIGN_IN_COUNTED = 'homingbird.signInCounted'

const analyticsStorage = (storage: PageStorage, newId: () => string): AnalyticsStorage => ({
  local: storage.local,
  setLocal: storage.setLocal,
  session: storage.session,
  setSession: storage.setSession,
  newId,
})
