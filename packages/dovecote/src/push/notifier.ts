import { randomBytes } from 'node:crypto'
import { createECDH } from 'node:crypto'
import { type Clock, Task as T, makeQueue } from '@homingbird/kernel'
import type { Locale, MemberId, StreamEvent } from '@homingbird/protocol'
import type { Fetch } from '../auth/identity-provider.ts'
import { chosenLocaleOf, membersByIds } from '../domain/members.ts'
import type { AppEnv } from '../environment.ts'
import { encryptPushPayload } from './payload-encryption.ts'
import { type PushSubscription, pushSubscriptionsOf, removePushSubscription } from './subscriptions.ts'
import { type PushTitles, pushTitlesIn } from './titles.ts'
import { type VapidKeys, vapidAuthorization, vapidKeys } from './vapid.ts'

export interface PushMessage {
  readonly title: string
  readonly body: string
  readonly url: string
}

export interface PushNotice {
  readonly about: { readonly kind: 'note'; readonly author: string | null } | { readonly kind: 'draft' }
  readonly body: string
  readonly url: string
}

export interface PushNotifier {
  readonly consider: (memberId: MemberId, event: StreamEvent) => void
  readonly run: T.Task<never, never, AppEnv>
}

export const makePushNotifier = (fetch: Fetch): PushNotifier => {
  const pending = makeQueue<{ memberId: MemberId; event: StreamEvent }>(PENDING_LIMIT)
  return {
    consider: (memberId, event) => {
      if (event.body.type === 'note.sent' || event.body.type === 'draft.saved')
        pending.tryOffer({ memberId, event })
    },
    run: T.gen(function* () {
      for (;;) {
        const { memberId, event } = yield* T.orDie(pending.take)
        const notice = yield* pushNoticeFor(memberId, event)
        if (notice !== null) yield* deliverToMember(fetch, memberId, notice)
      }
    }) as T.Task<never, never, AppEnv>,
  }
}

export const pushNoticeFor = (
  memberId: MemberId,
  event: StreamEvent,
): T.Task<PushNotice | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (env.hub.presenceOf(memberId).humanOnline) return null
    const body = event.body
    if (body.type === 'note.sent' && body.note.authorId !== memberId) {
      const author = (yield* membersByIds([body.note.authorId])).get(body.note.authorId)
      return {
        about: { kind: 'note', author: author?.name ?? null },
        body: preview(body.note.body),
        url: `/#/c/${body.note.conversationId}`,
      }
    }
    const isNewAgentDraft =
      body.type === 'draft.saved' &&
      body.note.origin === 'agent' &&
      body.note.createdAt === body.note.updatedAt
    if (isNewAgentDraft)
      return {
        about: { kind: 'draft' },
        body: preview(body.note.body),
        url: `/#/c/${body.note.conversationId}`,
      }
    return null
  })

export const deliverToMember = (
  fetch: Fetch,
  memberId: MemberId,
  notice: PushNotice,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const keys = yield* vapidKeys
    const chosen = yield* chosenLocaleOf(memberId)
    for (const subscription of yield* pushSubscriptionsOf(memberId)) {
      const message = messageIn(chosen ?? subscription.locale ?? null, notice)
      const status = yield* send(fetch, env.clock, env.config.publicUrl, keys, subscription, message)
      if (status === 404 || status === 410) yield* removePushSubscription(subscription.endpoint)
    }
  })

const PENDING_LIMIT = 10_000
const PREVIEW_LENGTH = 140
const TIME_TO_LIVE_SECONDS = 24 * 60 * 60
const AUTHORIZATION_LIFETIME_SECONDS = 12 * 60 * 60
const REQUEST_TIMEOUT_MS = 10_000

const messageIn = (locale: Locale | null, notice: PushNotice): PushMessage => ({
  title: titleOf(pushTitlesIn(locale), notice.about),
  body: notice.body,
  url: notice.url,
})

const titleOf = (titles: PushTitles, about: PushNotice['about']): string => {
  if (about.kind === 'draft') return titles.draftWaiting
  return about.author === null ? titles.noteFromColleague : titles.noteFrom(about.author)
}

const preview = (text: string): string =>
  text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`

const send = (
  fetch: Fetch,
  clock: Clock,
  publicUrl: string,
  keys: VapidKeys,
  subscription: PushSubscription,
  message: PushMessage,
): T.Task<number, never, { clock: Clock }> => {
  const ephemeral = createECDH('prime256v1')
  ephemeral.generateKeys()
  const body = encryptPushPayload({
    plaintext: Buffer.from(JSON.stringify(message), 'utf8'),
    subscriberPublicKey: Buffer.from(subscription.keys.p256dh, 'base64url'),
    subscriberAuthSecret: Buffer.from(subscription.keys.auth, 'base64url'),
    senderPrivateKey: ephemeral.getPrivateKey(),
    salt: randomBytes(16),
  })
  const authorization = vapidAuthorization(keys, {
    audience: new URL(subscription.endpoint).origin,
    subject: publicUrl,
    expiresAtSeconds: Math.floor(clock.now() / 1000) + AUTHORIZATION_LIFETIME_SECONDS,
  })
  return T.catchAll(() => T.succeed(0))(
    T.timeout(REQUEST_TIMEOUT_MS)(
      T.tryPromise(
        async (signal) =>
          (
            await fetch(subscription.endpoint, {
              method: 'POST',
              headers: {
                authorization,
                'content-encoding': 'aes128gcm',
                'content-type': 'application/octet-stream',
                ttl: String(TIME_TO_LIVE_SECONDS),
                urgency: 'normal',
              },
              body,
              signal,
            })
          ).status,
        () => 'unreachable' as const,
      ),
    ),
  )
}
