import { Task as T } from '@homingbird/kernel'
import { Invalid, type MemberId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { hashSecret } from '../random.ts'
import { all, dialect, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'

export interface PushSubscription {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

export const savePushSubscription = (
  memberId: MemberId,
  subscription: PushSubscription,
): T.Task<void, Invalid, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (!isKnownPushService(subscription.endpoint, env.config.pushHosts))
      return yield* T.fail(Invalid({ message: 'This push service is not on the server allow-list.' }))
    yield* removePushSubscription(subscription.endpoint)
    yield* run(
      insertIgnoringConflict(yield* dialect, 'push_subscriptions', {
        endpoint_hash: hashSecret(subscription.endpoint),
        member_id: memberId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        created_at: env.clock.now(),
      }),
    )
  })

export const removePushSubscription = (endpoint: string): T.Task<void, never, AppEnv> =>
  T.asUnit(run(sql`DELETE FROM push_subscriptions WHERE endpoint_hash = ${hashSecret(endpoint)}`))

export const removeOwnPushSubscription = (
  memberId: MemberId,
  endpoint: string,
): T.Task<void, never, AppEnv> =>
  T.asUnit(
    run(
      sql`DELETE FROM push_subscriptions WHERE endpoint_hash = ${hashSecret(endpoint)} AND member_id = ${memberId}`,
    ),
  )

export const pushSubscriptionsOf = (memberId: MemberId): T.Task<PushSubscription[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ endpoint: string; p256dh: string; auth: string }>) =>
    rows.map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })),
  )(all(sql`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ${memberId} LIMIT 20`))

export const isKnownPushService = (endpoint: string, allowedHosts: ReadonlyArray<string>): boolean => {
  if (!URL.canParse(endpoint)) return false
  const { protocol, hostname } = new URL(endpoint)
  return (
    protocol === 'https:' && allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  )
}
