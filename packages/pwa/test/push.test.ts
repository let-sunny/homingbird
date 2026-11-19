import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesOf, pushIsOn, testPush, turnPushOff, turnPushOn } from '../src/push.ts'
import { strings } from '../src/strings.ts'
import { fail, testApp } from './support/app.ts'

afterEach(() => vi.unstubAllGlobals())

const subscription = (key: ArrayBuffer | null) => ({
  endpoint: 'https://push.example/1',
  options: { applicationServerKey: key },
  unsubscribe: vi.fn(() => Promise.resolve(true)),
  toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }),
})

const browser = (existing: ReturnType<typeof subscription> | null, permission = 'granted') => {
  const created = subscription(null)
  const pushManager = {
    getSubscription: () => Promise.resolve(existing),
    subscribe: vi.fn(() => Promise.resolve(created)),
  }
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager }) } })
  vi.stubGlobal('PushManager', {})
  vi.stubGlobal('Notification', { requestPermission: () => Promise.resolve(permission) })
  return { pushManager, created }
}

const answers = {
  'push.key': () => ({ publicKey: 'AQID' }),
  'push.test': () => ({ results: [] }),
}

describe('web push', () => {
  it('reads the server’s key from its base64url form', () => {
    expect([...bytesOf('AQID')]).toEqual([1, 2, 3])
    expect([...bytesOf('-_8')]).toEqual([251, 255])
  })

  it('subscribes once the person allows it, replacing a subscription made for another key', async () => {
    const { pushManager } = browser(subscription(new Uint8Array([9]).buffer))
    const { run, routes } = testApp(answers)
    expect(await run(turnPushOn)).toEqual({ _tag: 'Ok', value: true })
    expect(pushManager.subscribe).toHaveBeenCalled()
    expect(routes()).toEqual(['push.key', 'push.unsubscribe', 'push.subscribe'])
  })

  it('reuses a subscription for the same key, and stops when the person refuses', async () => {
    const { pushManager } = browser(subscription(new Uint8Array([1, 2, 3]).buffer))
    const { run, routes } = testApp(answers)
    await run(turnPushOn)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(routes()).toEqual(['push.key', 'push.subscribe'])
    browser(null, 'denied')
    expect(await run(turnPushOn)).toEqual({ _tag: 'Ok', value: false })
  })

  it('says whether it is on, turns it off, and tests it', async () => {
    const existing = subscription(null)
    browser(existing)
    const { run, routes } = testApp(answers)
    expect(await run(pushIsOn)).toEqual({ _tag: 'Ok', value: true })
    expect(await run(turnPushOff)).toEqual({ _tag: 'Ok', value: false })
    expect(existing.unsubscribe).toHaveBeenCalled()
    browser(null)
    expect(await run(turnPushOff)).toEqual({ _tag: 'Ok', value: false })
    expect(await run(testPush)).toEqual({ _tag: 'Ok', value: [strings.testPushNoDevices] })
    expect(routes()).toEqual(['push.unsubscribe', 'push.test'])
  })

  it('reads a refusal of the browser as the person’s refusal', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.reject(new Error('no worker')) } })
    const { run } = testApp({ 'push.test': () => fail({ _tag: 'Unavailable', message: 'x' }) })
    expect((await run(pushIsOn))._tag).toBe('Err')
  })
})
