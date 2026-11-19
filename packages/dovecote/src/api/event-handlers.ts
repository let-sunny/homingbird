import { Task as T } from '@homingbird/kernel'
import { POLL_WAIT_MAX_SECONDS } from '@homingbird/protocol'
import { type RequestEnv, waitForEvents } from '../events/events.ts'
import { removeOwnPushSubscription, savePushSubscription } from '../push/subscriptions.ts'
import { vapidKeys } from '../push/vapid.ts'
import type { Handlers } from './handlers.ts'

/** How events reach a person: polling, presence, and push subscriptions. */
export const eventHandlers = {
  'events.poll': ({ query }, caller) =>
    waitForEvents(
      caller.member.id,
      Number(query.after ?? '0'),
      Math.min(Number(query.wait ?? '0'), POLL_WAIT_MAX_SECONDS) * 1000,
    ),
  'presence.visibility': ({ body }, caller) =>
    T.map((env: RequestEnv) => {
      env.hub.reportVisibility(caller.member.id, `${caller.credential.id}:${body.page}`, body.visible)
      return {}
    })(T.ask<RequestEnv>()),
  'presence.heartbeat': () => T.succeed({}),
  'push.key': () => T.map((keys: { publicKey: string }) => ({ publicKey: keys.publicKey }))(vapidKeys),
  'push.subscribe': ({ body }, caller) => T.as({})(savePushSubscription(caller.member.id, body)),
  'push.unsubscribe': ({ body }, caller) =>
    T.as({})(removeOwnPushSubscription(caller.member.id, body.endpoint)),
  'push.test': (_, caller) =>
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      return { results: [...(yield* env.pushTest(caller.member.id))] }
    }),
} satisfies Partial<Handlers>
