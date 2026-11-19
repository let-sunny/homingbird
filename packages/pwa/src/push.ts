import { Task as T } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { type Action, type App, withApp } from './app.ts'
import { type PushResult, isSameKey, pushResultLines } from './push-results.ts'
import { locale, strings } from './strings.ts'

export const pushIsOn: Action<boolean> = T.suspend(() =>
  T.map((subscription: PushSubscription | null) => subscription !== null)(currentSubscription()),
)

/** Sends a test notification to each of the person's subscriptions and says how each went. */
export const testPush: Action<ReadonlyArray<string>> = withApp(({ api }) =>
  T.map((answer: { results: ReadonlyArray<PushResult> }) => pushResultLines(answer.results))(
    api['push.test']({ body: {} }),
  ),
)

export const turnPushOn: Action<boolean> = T.gen(function* () {
  const { api } = yield* T.ask<App>()
  const permission = yield* browser(() => Notification.requestPermission())
  if (permission !== 'granted') return false
  const { publicKey } = yield* api['push.key']({})
  const serverKey = bytesOf(publicKey)
  const registration = yield* browser(() => navigator.serviceWorker.ready)
  const existing = yield* browser(() => registration.pushManager.getSubscription())
  const reusable = existing !== null && isSameKey(existing.options.applicationServerKey, serverKey)
  if (existing !== null && !reusable) {
    yield* api['push.unsubscribe']({ body: { endpoint: existing.endpoint } })
    yield* browser(() => existing.unsubscribe())
  }
  const subscription =
    reusable && existing !== null
      ? existing
      : yield* browser(() =>
          registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey }),
        )
  const { endpoint = '', keys } = subscription.toJSON()
  yield* api['push.subscribe']({
    body: { endpoint, keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' }, locale },
  })
  return true
})

export const turnPushOff: Action<boolean> = T.gen(function* () {
  const { api } = yield* T.ask<App>()
  const subscription = yield* currentSubscription()
  if (subscription === null) return false
  yield* api['push.unsubscribe']({ body: { endpoint: subscription.endpoint } })
  yield* browser(() => subscription.unsubscribe())
  return false
})

export const bytesOf = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function currentSubscription(): Action<PushSubscription | null> {
  return T.gen(function* () {
    const registration = yield* browser(() => navigator.serviceWorker.ready)
    return yield* browser(() => registration.pushManager.getSubscription())
  })
}

function browser<A>(work: () => Promise<A>): T.Task<A, ApiError> {
  return T.tryPromise(work, (): ApiError => ({ _tag: 'Unavailable', message: strings.notificationsRefused }))
}
