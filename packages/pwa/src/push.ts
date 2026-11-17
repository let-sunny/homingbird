import { Task as T } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { type Action, api } from './actions.ts'

export const pushIsAvailable = (): boolean =>
  PUSH_ROUTES.every((name) => name in api) && 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis

export const pushIsOn: Action<boolean> = T.map((subscription: PushSubscription | null) => subscription !== null)(
  currentSubscription(),
)

export const turnPushOn: Action<boolean> = T.gen(function* () {
  const permission = yield* browser(() => Notification.requestPermission())
  if (permission !== 'granted') return false
  const { publicKey } = (yield* route('push.key')({})) as { publicKey: string }
  const registration = yield* browser(() => navigator.serviceWorker.ready)
  const subscription = yield* browser(() =>
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesOf(publicKey) }),
  )
  const { endpoint, keys } = subscription.toJSON()
  yield* route('push.subscribe')({ body: { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } } })
  return true
})

export const turnPushOff: Action<boolean> = T.gen(function* () {
  const subscription = yield* currentSubscription()
  if (subscription === null) return false
  yield* route('push.unsubscribe')({ body: { endpoint: subscription.endpoint } })
  yield* browser(() => subscription.unsubscribe())
  return false
})

export const bytesOf = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

const PUSH_ROUTES = ['push.key', 'push.subscribe', 'push.unsubscribe'] as const

const route = (name: (typeof PUSH_ROUTES)[number]): ((request: unknown) => Action<unknown>) =>
  (api as unknown as Record<string, (request: unknown) => Action<unknown>>)[name]!

function currentSubscription(): Action<PushSubscription | null> {
  return browser(async () => (await navigator.serviceWorker.ready).pushManager.getSubscription())
}

const browser = <A>(work: () => Promise<A>): T.Task<A, ApiError> =>
  T.tryPromise(work, (): ApiError => ({ _tag: 'Unavailable', message: 'This browser refused the notification request.' }))
