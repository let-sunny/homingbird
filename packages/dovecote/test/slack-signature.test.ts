import { Task as T, makeTestClock } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  SLACK_REPLAY_WINDOW_MS,
  type SignedSlackRequest,
  requireSlackSignature,
  slackSignatureOf,
} from '../src/slack/slack-signature.ts'

// The worked example in Slack's "Verifying requests from Slack" documentation.
const SLACK_EXAMPLE = {
  signingSecret: '8f742231b10e8888abcd99yyyzzz85a5',
  timestamp: '1531420618',
  body:
    'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V' +
    '&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=' +
    '&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN' +
    '&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c',
  signature: 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
}

const SENT_AT_MS = Number(SLACK_EXAMPLE.timestamp) * 1000

const verdict = (request: SignedSlackRequest, now = SENT_AT_MS, secret = SLACK_EXAMPLE.signingSecret) =>
  T.runPromise(
    T.catchAll((refused: { readonly reason: string }) => T.succeed(refused.reason))(
      T.map(() => 'signed')(requireSlackSignature(secret, request)),
    ),
    { clock: makeTestClock(now) },
  )

const EXAMPLE_REQUEST: SignedSlackRequest = {
  timestamp: SLACK_EXAMPLE.timestamp,
  signature: SLACK_EXAMPLE.signature,
  body: SLACK_EXAMPLE.body,
}

describe('a Slack request signature', () => {
  it('computes the signature of Slack’s documented example', () => {
    expect(slackSignatureOf(SLACK_EXAMPLE.signingSecret, SLACK_EXAMPLE.timestamp, SLACK_EXAMPLE.body)).toBe(
      SLACK_EXAMPLE.signature,
    )
  })

  it('accepts Slack’s documented example at the time it was sent', async () => {
    expect(await verdict(EXAMPLE_REQUEST)).toBe('signed')
  })

  it('accepts the raw body as bytes as well as text', async () => {
    expect(await verdict({ ...EXAMPLE_REQUEST, body: new TextEncoder().encode(SLACK_EXAMPLE.body) })).toBe(
      'signed',
    )
  })

  it('accepts a request up to five minutes old or early, and refuses one a moment past that', async () => {
    expect(SLACK_REPLAY_WINDOW_MS).toBe(300_000)
    expect(await verdict(EXAMPLE_REQUEST, SENT_AT_MS + SLACK_REPLAY_WINDOW_MS)).toBe('signed')
    expect(await verdict(EXAMPLE_REQUEST, SENT_AT_MS - SLACK_REPLAY_WINDOW_MS)).toBe('signed')
    expect(await verdict(EXAMPLE_REQUEST, SENT_AT_MS + SLACK_REPLAY_WINDOW_MS + 1)).toBe('stale')
    expect(await verdict(EXAMPLE_REQUEST, SENT_AT_MS - SLACK_REPLAY_WINDOW_MS - 1)).toBe('stale')
  })

  it('refuses a replayed request even with a valid signature', async () => {
    expect(await verdict(EXAMPLE_REQUEST, SENT_AT_MS + 60 * 60 * 1000)).toBe('stale')
  })

  it('refuses a changed body, timestamp or secret', async () => {
    expect(await verdict({ ...EXAMPLE_REQUEST, body: `${SLACK_EXAMPLE.body}&x=1` })).toBe('mismatch')
    expect(await verdict({ ...EXAMPLE_REQUEST, timestamp: '1531420619' })).toBe('mismatch')
    expect(await verdict(EXAMPLE_REQUEST, SENT_AT_MS, 'another-secret')).toBe('mismatch')
  })

  it('refuses a request without its headers or with malformed ones', async () => {
    expect(await verdict({ ...EXAMPLE_REQUEST, timestamp: null })).toBe('missing')
    expect(await verdict({ ...EXAMPLE_REQUEST, signature: null })).toBe('missing')
    expect(await verdict({ ...EXAMPLE_REQUEST, timestamp: '1531420618.5' })).toBe('missing')
    expect(
      await verdict({ ...EXAMPLE_REQUEST, signature: SLACK_EXAMPLE.signature.replace('v0=', 'v1=') }),
    ).toBe('missing')
    expect(await verdict({ ...EXAMPLE_REQUEST, signature: SLACK_EXAMPLE.signature.toUpperCase() })).toBe(
      'missing',
    )
    expect(await verdict({ ...EXAMPLE_REQUEST, signature: SLACK_EXAMPLE.signature.slice(0, -1) })).toBe(
      'missing',
    )
  })

  it('accepts exactly the body it signed, whatever the body', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string({ minLength: 1 }), async (body, extra) => {
        const signature = slackSignatureOf('secret', SLACK_EXAMPLE.timestamp, body)
        const request = { timestamp: SLACK_EXAMPLE.timestamp, signature, body }
        expect(await verdict(request, SENT_AT_MS, 'secret')).toBe('signed')
        expect(await verdict({ ...request, body: body + extra }, SENT_AT_MS, 'secret')).toBe('mismatch')
      }),
    )
  })
})
