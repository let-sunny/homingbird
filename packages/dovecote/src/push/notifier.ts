import { createECDH } from 'node:crypto'
import { type Clock, Task as T, makeQueue } from '@homingbird/kernel'
import type { Locale, MemberId, StreamEvent } from '@homingbird/protocol'
import type { Fetch } from '../auth/identity-provider.ts'
import { chosenLocaleOf, membersByIds } from '../domain/members.ts'
import type { AppEnv } from '../environment.ts'
import { makeWorkTally } from '../work-tally.ts'
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
  readonly about:
    | { readonly kind: 'note'; readonly author: string | null }
    | { readonly kind: 'draft' }
    | { readonly kind: 'test'; readonly title: string }
  readonly body: string
  readonly url: string
}

export interface PushNotifier {
  readonly consider: (memberId: MemberId, event: StreamEvent) => void
  readonly run: T.Task<never, never, AppEnv>
  readonly settled: T.Task<void>
}

export const makePushNotifier = (fetch: Fetch): PushNotifier => {
  const pending = makeQueue<{ memberId: MemberId; event: StreamEvent }>(PENDING_LIMIT)
  const work = makeWorkTally()
  return {
    consider: (memberId, event) => {
      if (event.body.type !== 'note.sent' && event.body.type !== 'draft.saved') return
      if (pending.tryOffer({ memberId, event })) work.started()
    },
    run: T.gen(function* () {
      for (;;) {
        const { memberId, event } = yield* T.orDie(pending.take)
        try {
          const notice = yield* pushNoticeFor(memberId, event)
          if (notice !== null) yield* T.asUnit(deliverToMember(fetch, memberId, notice))
        } finally {
          work.finished()
        }
      }
    }) as T.Task<never, never, AppEnv>,
    settled: work.settled,
  }
}

const pushNoticeFor = (memberId: MemberId, event: StreamEvent): T.Task<PushNotice | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (env.hub.isLooking(memberId)) return null
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

/** What one push attempt came to: the push service's host and answer, 0 when it was not reached. */
export interface PushOutcome {
  readonly endpointHost: string
  readonly status: number
  readonly removed: boolean
}

const deliverToMember = (
  fetch: Fetch,
  memberId: MemberId,
  notice: PushNotice,
): T.Task<PushOutcome[], never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const keys = yield* vapidKeys
    const chosen = yield* chosenLocaleOf(memberId)
    const outcomes: PushOutcome[] = []
    for (const subscription of yield* pushSubscriptionsOf(memberId)) {
      const message = messageIn(chosen ?? subscription.locale ?? null, notice)
      const salt = env.random.bytes(16)
      const status = yield* send(
        fetch,
        env.clock,
        vapidSubject(env.config),
        keys,
        subscription,
        message,
        salt,
      )
      const removed = status === 404 || status === 410
      if (removed) yield* removePushSubscription(subscription.endpoint)
      const outcome = { endpointHost: new URL(subscription.endpoint).host, status, removed }
      env.log.emit({ name: 'push.delivered', attributes: { memberId, ...outcome } }, env.requestId)
      outcomes.push(outcome)
    }
    return outcomes
  })

/** Sends a test notification to the person's own subscriptions only, and says how each went. */
export const sendTestPush = (fetch: Fetch, memberId: MemberId): T.Task<PushOutcome[], never, AppEnv> =>
  T.gen(function* () {
    const titles = pushTitlesIn(yield* chosenLocaleOf(memberId))
    return yield* deliverToMember(fetch, memberId, {
      about: { kind: 'test', title: titles.test },
      body: titles.testBody,
      url: '/#/me',
    })
  })

/**
 * The VAPID subject must be an https URL or a mailto: address (RFC 8292); push services refuse
 * anything else, so a server on plain http names an administrator's address instead.
 */
export const vapidSubject = (config: Pick<AppEnv['config'], 'publicUrl' | 'adminEmails'>): string =>
  config.publicUrl.startsWith('https://')
    ? config.publicUrl
    : `mailto:${config.adminEmails[0] ?? `dovecote@${new URL(config.publicUrl).hostname}`}`

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
  if (about.kind === 'test') return about.title
  return about.author === null ? titles.noteFromColleague : titles.noteFrom(about.author)
}

const preview = (text: string): string =>
  text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`

const send = (
  fetch: Fetch,
  clock: Clock,
  subject: string,
  keys: VapidKeys,
  subscription: PushSubscription,
  message: PushMessage,
  salt: Buffer,
): T.Task<number, never, { clock: Clock }> => {
  const ephemeral = createECDH('prime256v1')
  ephemeral.generateKeys()
  const body = encryptPushPayload({
    plaintext: Buffer.from(JSON.stringify(message), 'utf8'),
    subscriberPublicKey: Buffer.from(subscription.keys.p256dh, 'base64url'),
    subscriberAuthSecret: Buffer.from(subscription.keys.auth, 'base64url'),
    senderPrivateKey: ephemeral.getPrivateKey(),
    salt,
  })
  const authorization = vapidAuthorization(keys, {
    audience: new URL(subscription.endpoint).origin,
    subject,
    expiresAtSeconds: Math.floor(clock.now() / 1000) + AUTHORIZATION_LIFETIME_SECONDS,
  })
  return T.catchAll(() => T.succeed(0))(
    T.timeout(REQUEST_TIMEOUT_MS)(
      T.map((response: Response) => response.status)(
        T.tryPromise(
          (signal) =>
            fetch(subscription.endpoint, {
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
            }),
          () => 'unreachable' as const,
        ),
      ),
    ),
  )
}
