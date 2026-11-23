import { createECDH } from 'node:crypto'
import { type Clock, Task as T, makeQueue } from '@homingbird/kernel'
import {
  type ConversationId,
  type DeskUnavailableKind,
  type Locale,
  type MemberId,
  type NoteId,
  type StreamEvent,
  noticeTag,
} from '@homingbird/protocol'
import type { Fetch } from '../auth/identity-provider.ts'
import type { MeetingNotice } from '../domain/meeting-rows.ts'
import { chosenLocaleOf, membersByIds } from '../domain/members.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { type NotPosted, notPostedNoticeFor } from '../slack/slack-not-posted.ts'
import { sendSlackNotPosted, sendSlackReviewRequest } from '../slack/slack-review-requests.ts'
import { makeWorkTally } from '../work-tally.ts'
import { encryptPushPayload } from './payload-encryption.ts'
import { type PushWindow, makePushWindow } from './push-window.ts'
import { reviewWaitingFor } from './review-notice.ts'
import { type PushSubscription, pushSubscriptionsOf, removePushSubscription } from './subscriptions.ts'
import { type MeetingPushTitles, type PushTitles, pushTitlesIn } from './titles.ts'
import { type VapidKeys, vapidAuthorization, vapidKeys } from './vapid.ts'
import { wantsPushAbout } from './wants-push.ts'

export interface PushMessage {
  readonly title: string
  readonly body: string
  readonly url: string
  /** One draft's notifications share it, so a repeat replaces the last and a page can close it. */
  readonly tag?: string
}

export interface PushNotice {
  readonly about:
    | { readonly kind: 'note'; readonly author: string | null }
    | { readonly kind: 'draft' }
    | { readonly kind: 'review'; readonly channel: string }
    | { readonly kind: 'notPosted'; readonly channel: string }
    | { readonly kind: 'test'; readonly title: string }
    | { readonly kind: 'deskStopped'; readonly title: string }
    | { readonly kind: 'deskUnavailable'; readonly title: string }
    | { readonly kind: 'meeting'; readonly title: string }
  readonly body: string
  readonly url: string
  readonly tag?: string
}

export interface PushNotifier {
  /** `isNewReview` marks the review event a channel's agent's new answer sends its reviewers. */
  readonly consider: (memberId: MemberId, event: StreamEvent, isNewReview: boolean) => void
  /** A scheduling room's meeting changed for this person: told on their devices unless they are looking. */
  readonly considerMeeting: (memberId: MemberId, notice: MeetingNotice) => void
  readonly run: T.Task<never, never, AppEnv>
  readonly settled: T.Task<void>
}

export const makePushNotifier = (fetch: Fetch): PushNotifier => {
  const pending = makeQueue<Pending>(PENDING_LIMIT)
  const work = makeWorkTally()
  const reviewWindow = makePushWindow(REVIEW_PUSH_WINDOW_MS)
  return {
    consider: (memberId, event, isNewReview) => {
      if (!isPushable(event.body, isNewReview)) return
      if (pending.tryOffer({ memberId, event, isNewReview })) work.started()
    },
    considerMeeting: (memberId, meeting) => {
      if (pending.tryOffer({ memberId, meeting })) work.started()
    },
    run: T.gen(function* () {
      for (;;) {
        const item = yield* T.orDie(pending.take)
        const { memberId } = item
        try {
          if ('meeting' in item) {
            const notice = yield* meetingPushFor(memberId, item.meeting)
            if (notice !== null) yield* T.asUnit(deliverToMember(fetch, memberId, notice))
            continue
          }
          const { event, isNewReview } = item
          const notice = isNewReview
            ? yield* reviewNoticeFor(memberId, event, reviewWindow)
            : yield* pushNoticeFor(memberId, event)
          if (notice !== null && (yield* featureIsOn('webPush')))
            yield* T.asUnit(deliverToMember(fetch, memberId, notice))
          if (notice !== null && (notice.about.kind === 'draft' || notice.about.kind === 'review'))
            yield* sendSlackReviewRequest(memberId, notice.url)
          if (notice?.about.kind === 'notPosted') yield* sendSlackNotPosted(memberId, notice.url)
        } finally {
          work.finished()
        }
      }
    }) as T.Task<never, never, AppEnv>,
    settled: work.settled,
  }
}

/** How long a reviewer hears nothing more about a channel after one of its answers notified them. */
export const REVIEW_PUSH_WINDOW_MS = 2 * 60 * 1000

type Pending =
  | { readonly memberId: MemberId; readonly event: StreamEvent; readonly isNewReview: boolean }
  | { readonly memberId: MemberId; readonly meeting: MeetingNotice }

const isPushable = (body: StreamEvent['body'], isNewReview: boolean): boolean =>
  isNewReview
    ? body.type === 'review.changed' && body.noteId !== null
    : body.type === 'note.sent' ||
      body.type === 'draft.saved' ||
      (body.type === 'note.changed' && body.note.posting === 'failed')

const pushNoticeFor = (memberId: MemberId, event: StreamEvent): T.Task<PushNotice | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (env.hub.isLooking(memberId)) return null
    if (event.body.type === 'note.changed') return yield* notPostedPush(memberId, event.body.note)
    const about = yield* noticeAbout(memberId, event)
    if (about === null || !(yield* wantsPushAbout(memberId, about.conversationId))) return null
    return about.notice
  })

/**
 * A review push needs both rooms to want it: a private question's own and its channel's, so muting the
 * channel quiets its private questions' answers too.
 */
const reviewNoticeFor = (
  memberId: MemberId,
  event: StreamEvent,
  reviewWindow: PushWindow,
): T.Task<PushNotice | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const body = event.body
    if (body.type !== 'review.changed' || body.noteId === null || env.hub.isLooking(memberId)) return null
    const review = yield* reviewWaitingFor(memberId, body.noteId)
    if (review === null) return null
    if (!(yield* wantsPushAbout(memberId, review.conversationId))) return null
    if (!(yield* wantsPushAbout(memberId, review.channelId))) return null
    if (!reviewWindow.admits(`${memberId} ${review.channelId}`, env.clock.now())) return null
    return {
      about: { kind: 'review', channel: review.slug },
      body: preview(review.body),
      url: review.url,
      tag: noticeTag('review', body.noteId),
    }
  })

/** A reply given up on is the sender's and the managers' own concern, so it is told whatever they muted. */
const notPostedPush = (
  memberId: MemberId,
  note: Extract<StreamEvent['body'], { type: 'note.changed' }>['note'],
): T.Task<PushNotice | null, never, AppEnv> =>
  T.map((told: NotPosted | null): PushNotice | null =>
    told === null
      ? null
      : { about: { kind: 'notPosted', channel: told.channel }, body: preview(note.body), url: told.url },
  )(notPostedNoticeFor(memberId, note))

/**
 * A meeting notice in the person's own language, titled by the room, with the name of whoever it is
 * about; it opens the room. It says nothing of the time, the invitation or its link.
 */
const meetingPushFor = (
  memberId: MemberId,
  meeting: MeetingNotice,
): T.Task<PushNotice | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (env.hub.isLooking(memberId)) return null
    const titles = pushTitlesIn(yield* chosenLocaleOf(memberId)).meeting
    const { notice } = meeting
    const other =
      'memberId' in notice ? (yield* membersByIds([notice.memberId])).get(notice.memberId)?.name : undefined
    const message = meetingMessage(titles, preview(meeting.title), meeting, other ?? titles.colleague)
    return {
      about: { kind: 'meeting', title: message.title },
      body: message.body,
      url: `/#/debate/${encodeURIComponent(meeting.debateId)}`,
    }
  })

const meetingMessage = (
  titles: MeetingPushTitles,
  room: string,
  meeting: MeetingNotice,
  other: string,
): { readonly title: string; readonly body: string } => {
  const { notice } = meeting
  switch (notice.notice) {
    case 'waits':
      return {
        title: titles.waits(room),
        body: meeting.toOpener ? titles.waitsBody.send : titles.waitsBody.add,
      }
    case 'added':
      return { title: titles.added(room), body: titles.addedBody }
    case 'cancelled':
      return { title: titles.cancelled(room), body: titles.cancelledBody }
    case 'remove_by_hand':
      return { title: titles.removeByHand(room), body: titles.removeByHandBody }
    case 'busy':
      return { title: titles.busy(room, other), body: titles.busyBody }
    case 'left':
      return { title: titles.left(room, other), body: titles.leftBody[notice.because] }
    case 'joined':
      return {
        title: titles.joined(room),
        body: notice.agentName === null ? titles.joinedBody : titles.joinedFirstBody(notice.agentName),
      }
  }
}

interface NoticeAbout {
  readonly conversationId: ConversationId
  readonly notice: PushNotice
}

const noticeAbout = (memberId: MemberId, event: StreamEvent): T.Task<NoticeAbout | null, never, AppEnv> =>
  T.gen(function* () {
    const body = event.body
    if (body.type === 'note.sent' && body.note.authorId !== memberId) {
      const author = (yield* membersByIds([body.note.authorId])).get(body.note.authorId)
      return {
        conversationId: body.note.conversationId,
        notice: {
          about: { kind: 'note', author: author?.name ?? null },
          body: preview(body.note.body),
          url: `/#/c/${body.note.conversationId}`,
        },
      }
    }
    const isNewAgentDraft =
      body.type === 'draft.saved' &&
      body.note.origin === 'agent' &&
      body.note.createdAt === body.note.updatedAt
    if (isNewAgentDraft)
      return {
        conversationId: body.note.conversationId,
        notice: {
          about: { kind: 'draft' },
          body: preview(body.note.body),
          url: draftCardUrl(body.note.conversationId, body.note.id),
          tag: noticeTag('draft', body.note.id),
        },
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

/** Tells the person on their devices that their cloud desk stopped being woken, whatever they muted. */
export const sendDeskStoppedPush = (fetch: Fetch, memberId: MemberId): T.Task<PushOutcome[], never, AppEnv> =>
  T.gen(function* () {
    const titles = pushTitlesIn(yield* chosenLocaleOf(memberId))
    return yield* deliverToMember(fetch, memberId, {
      about: { kind: 'deskStopped', title: titles.deskStopped },
      body: titles.deskStoppedBody,
      url: '/#/agent/connection',
    })
  })

/** Tells the person once, when it starts, that their running desk's agent cannot answer, and why. */
export const sendDeskUnavailablePush = (
  fetch: Fetch,
  memberId: MemberId,
  kind: DeskUnavailableKind,
): T.Task<PushOutcome[], never, AppEnv> =>
  T.gen(function* () {
    const titles = pushTitlesIn(yield* chosenLocaleOf(memberId))
    return yield* deliverToMember(fetch, memberId, {
      about: { kind: 'deskUnavailable', title: titles.deskUnavailable },
      body: titles.deskUnavailableBody[kind],
      url: '/#/agent/connection',
      tag: 'desk-unavailable',
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
  ...(notice.tag !== undefined && { tag: notice.tag }),
})

const titleOf = (titles: PushTitles, about: PushNotice['about']): string => {
  if (about.kind === 'draft') return titles.draftWaiting
  if (about.kind === 'review') return titles.reviewWaiting(`#${about.channel}`)
  if (about.kind === 'notPosted') return titles.notPosted(`#${about.channel}`)
  if (
    about.kind === 'test' ||
    about.kind === 'deskStopped' ||
    about.kind === 'deskUnavailable' ||
    about.kind === 'meeting'
  )
    return about.title
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

/** The web client's address of the person's own draft card in its conversation. */
const draftCardUrl = (conversationId: ConversationId, noteId: NoteId): string =>
  `/#/c/${encodeURIComponent(conversationId)}?draft=${encodeURIComponent(noteId)}`
