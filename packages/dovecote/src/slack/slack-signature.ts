import { createHmac, timingSafeEqual } from 'node:crypto'
import { type HasClock, Task as T, tagged } from '@homingbird/kernel'

/** Slack's scheme: `v0=` hex HMAC-SHA256 of `v0:<timestamp>:<raw body>`, sent within five minutes. */
export const requireSlackSignature = (
  signingSecret: string,
  request: SignedSlackRequest,
): T.Task<void, SlackSignatureRefused, HasClock> =>
  T.gen(function* () {
    const { clock } = yield* T.ask<HasClock>()
    if (request.timestamp === null || !TIMESTAMP.test(request.timestamp))
      return yield* T.fail(SlackSignatureRefused({ reason: 'missing' }))
    if (request.signature === null || !SIGNATURE.test(request.signature))
      return yield* T.fail(SlackSignatureRefused({ reason: 'missing' }))
    const sentAt = Number(request.timestamp) * 1000
    if (Math.abs(clock.now() - sentAt) > SLACK_REPLAY_WINDOW_MS)
      return yield* T.fail(SlackSignatureRefused({ reason: 'stale' }))
    if (!isSameSignature(slackSignatureOf(signingSecret, request.timestamp, request.body), request.signature))
      return yield* T.fail(SlackSignatureRefused({ reason: 'mismatch' }))
  })

export interface SignedSlackRequest {
  readonly timestamp: string | null
  readonly signature: string | null
  /** The bytes as they arrived, before any parsing. */
  readonly body: string | Uint8Array
}

export type SlackSignatureRefused = ReturnType<typeof SlackSignatureRefused>

export const slackSignatureOf = (
  signingSecret: string,
  timestamp: string,
  body: string | Uint8Array,
): string =>
  `${VERSION}=${createHmac('sha256', signingSecret).update(`${VERSION}:${timestamp}:`).update(body).digest('hex')}`

export const SLACK_REPLAY_WINDOW_MS = 5 * 60 * 1000

const SlackSignatureRefused = tagged('SlackSignatureRefused')<{
  readonly reason: 'missing' | 'stale' | 'mismatch'
}>()

const isSameSignature = (expected: string, given: string): boolean => {
  const wanted = Buffer.from(expected, 'utf8')
  const received = Buffer.from(given, 'utf8')
  return wanted.length === received.length && timingSafeEqual(wanted, received)
}

const VERSION = 'v0'
const TIMESTAMP = /^\d{1,12}$/
const SIGNATURE = /^v0=[0-9a-f]{64}$/
