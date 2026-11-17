import { Task as T } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { type Action, api } from './actions.ts'

export const pushIsAvailable = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis

export const pushIsOn: Action<boolean> = T.suspend(() =>
  T.map((subscription: PushSubscription | null) => subscription !== null)(currentSubscription()),
)

export const turnPushOn: Action<boolean> = T.gen(function* () {
  const permission = yield* browser(() => Notification.requestPermission())
  if (permission !== 'granted') return false
  const { publicKey } = yield* api['push.key']({})
  const registration = yield* browser(() => navigator.serviceWorker.ready)
  const subscription = yield* browser(() =>
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesOf(publicKey) }),
  )
  const { endpoint = '', keys } = subscription.toJSON()
  yield* api['push.subscribe']({
    body: { endpoint, keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' } },
  })
  return true
})

export const turnPushOff: Action<boolean> = T.gen(function* () {
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
  return browser(async () => (await navigator.serviceWorker.ready).pushManager.getSubscription())
}

function browser<A>(work: () => Promise<A>): T.Task<A, ApiError> {
  return T.tryPromise(
    work,
    (): ApiError => ({ _tag: 'Unavailable', message: 'This browser refused the notification request.' }),
  )
}
