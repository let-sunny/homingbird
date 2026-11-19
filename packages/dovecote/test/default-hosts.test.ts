import { describe, expect, it } from 'vitest'
import { DEFAULT_PUSH_HOSTS } from '../src/push/default-hosts.ts'
import { isKnownPushService } from '../src/push/subscriptions.ts'

describe('the push services allowed by default', () => {
  it('cover the browsers people use, and nothing else', () => {
    expect(DEFAULT_PUSH_HOSTS).toEqual(
      expect.arrayContaining(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com']),
    )
    expect(isKnownPushService('https://fcm.googleapis.com/fcm/send/abc', DEFAULT_PUSH_HOSTS)).toBe(true)
    expect(isKnownPushService('https://web.push.apple.com/abc', DEFAULT_PUSH_HOSTS)).toBe(true)
    expect(isKnownPushService('https://attacker.example/push', DEFAULT_PUSH_HOSTS)).toBe(false)
  })
})
