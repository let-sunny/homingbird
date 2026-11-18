import { describe, expect, it } from 'vitest'
import { isSameKey, pushResultLines } from '../src/push-results.ts'

describe('pushResultLines', () => {
  it('says Sent, or what the push service refused with, for each subscription', () => {
    expect(
      pushResultLines([
        { endpointHost: 'fcm.googleapis.com', status: 201, removed: false },
        { endpointHost: 'fcm.googleapis.com', status: 403, removed: false },
        { endpointHost: 'updates.push.services.mozilla.com', status: 410, removed: true },
        { endpointHost: 'web.push.apple.com', status: 0, removed: false },
      ]),
    ).toEqual([
      'Sent through fcm.googleapis.com. A notification should appear now.',
      'The browser’s push service refused: 403 (fcm.googleapis.com).',
      'The browser’s push service no longer knows this device: 410 (updates.push.services.mozilla.com). Turn notifications off and on again.',
      'The push service web.push.apple.com could not be reached.',
    ])
  })

  it('says so when this person has no subscription at all', () => {
    expect(pushResultLines([])).toEqual(['No device of yours is subscribed yet. Turn on Notify me first.'])
  })
})

describe('isSameKey', () => {
  it('reuses a subscription made for this server’s key, and only that one', () => {
    const key = Uint8Array.from([4, 1, 2, 3])
    expect(isSameKey(Uint8Array.from([4, 1, 2, 3]).buffer, key)).toBe(true)
    expect(isSameKey(Uint8Array.from([4, 1, 2, 9]).buffer, key)).toBe(false)
    expect(isSameKey(Uint8Array.from([4, 1, 2]).buffer, key)).toBe(false)
    expect(isSameKey(null, key)).toBe(false)
  })
})
