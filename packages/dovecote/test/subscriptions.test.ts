import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PUSH_HOSTS } from '../src/push/default-hosts.ts'
import { isKnownPushService } from '../src/push/subscriptions.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

interface Delivery {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: Buffer
}

const subscriber = () => {
  const keys = createECDH('prime256v1')
  keys.generateKeys()
  const auth = Buffer.from('0123456789abcdef')
  return {
    keys,
    auth,
    subscription: (endpoint: string) => ({
      endpoint,
      keys: { p256dh: keys.getPublicKey('base64url'), auth: auth.toString('base64url') },
    }),
  }
}

const decrypt = (body: Buffer, receiver: ReturnType<typeof subscriber>): string => {
  const salt = body.subarray(0, 16)
  const keyLength = body[20]!
  const senderPublicKey = body.subarray(21, 21 + keyLength)
  const sealed = body.subarray(21 + keyLength)
  const shared = receiver.keys.computeSecret(senderPublicKey)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiver.keys.getPublicKey(), senderPublicKey])
  const inputKey = Buffer.from(hkdfSync('sha256', shared, receiver.auth, info, 32))
  const key = Buffer.from(
    hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
  return plain.subarray(0, plain.length - 1).toString('utf8')
}

describe('the push service allow-list', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['https://web.push.apple.com/abc', true],
    ['https://db5p.notify.windows.com/w/?token=abc', true],
    ['http://fcm.googleapis.com/fcm/send/abc', false],
    ['https://169.254.169.254/latest/meta-data', false],
    ['https://127.0.0.1/', false],
    ['https://localhost/', false],
    ['https://evilfcm.googleapis.com.attacker.example/', false],
    ['https://attacker.example/fcm.googleapis.com', false],
    ['not a url', false],
  ])('judges %s as allowed: %s', (endpoint, allowed) => {
    expect(isKnownPushService(endpoint, DEFAULT_PUSH_HOSTS)).toBe(allowed)
  })
})

describe('push subscriptions', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/ben-device'
  let server: TestServer
  let ana: Session
  let ben: Session
  let benAgent: Agent
  let deliveries: Delivery[]
  let status: number
  let running: T.RunningTask<never, never>
  const benDevice = subscriber()

  beforeEach(async () => {
    deliveries = []
    status = 201
    const fetch = (async (url: string, init?: RequestInit) => {
      deliveries.push({
        url,
        headers: init?.headers as Record<string, string>,
        body: Buffer.from(init?.body as Uint8Array),
      })
      return new Response('', { status })
    }) as never
    server = await startTestServer({}, { fetch })
    ana = await server.signIn('ana@example.com', 'Ana')
    ben = await server.signIn('ben@example.com', 'Ben')
    benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
    running = T.runFork(server.background, server.env)
    expect((await ben.api('POST', '/push/subscriptions', benDevice.subscription(ENDPOINT))).status).toBe(200)
  })

  afterEach(async () => {
    await running.interrupt()
    await server.close()
  })

  const sendNote = async (body: string) => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body })).json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    await server.settled()
    return sent
  }

  it('hands out the server key and stores a subscription per device', async () => {
    const { publicKey } = (await benAgent.api('GET', '/push/key')).json
    expect(Buffer.from(publicKey, 'base64url')).toHaveLength(65)
    expect((await ana.api('GET', '/push/key')).json.publicKey).toBe(publicKey)
    await ben.api('POST', '/push/subscriptions', benDevice.subscription(ENDPOINT))
    expect(await storedRows(server, 'push_subscriptions')).toHaveLength(1)
  })

  it('refuses a subscription whose endpoint is not a known push service', async () => {
    for (const endpoint of [
      'https://attacker.example/hook',
      'https://169.254.169.254/',
      'http://fcm.googleapis.com/x',
    ])
      expect((await ana.api('POST', '/push/subscriptions', benDevice.subscription(endpoint))).status).toBe(
        400,
      )
    expect(
      (
        await ana.api('POST', '/push/subscriptions', {
          endpoint: ENDPOINT,
          keys: { p256dh: 'short', auth: 'x' },
        })
      ).status,
    ).toBe(400)
  })

  it('forgets a subscription the push service reports as gone, and keeps it on other failures', async () => {
    status = 500
    await sendNote('transient failure')
    expect(await storedRows(server, 'push_subscriptions')).toHaveLength(1)
    status = 410
    await sendNote('gone')
    expect(await storedRows(server, 'push_subscriptions')).toEqual([])
    await sendNote('nobody to tell')
    expect(deliveries).toHaveLength(2)
  })

  it('lets a person remove only their own subscription', async () => {
    expect((await ana.api('POST', '/push/subscriptions/remove', { endpoint: ENDPOINT })).status).toBe(200)
    expect(await storedRows(server, 'push_subscriptions')).toHaveLength(1)
    expect((await ben.api('POST', '/push/subscriptions/remove', { endpoint: ENDPOINT })).status).toBe(200)
    expect(await storedRows(server, 'push_subscriptions')).toEqual([])
  })

  it('moves a device’s subscription to whoever signed in on it last', async () => {
    await ana.api('POST', '/push/subscriptions', benDevice.subscription(ENDPOINT))
    const rows = await storedRows(server, 'push_subscriptions')
    expect(rows.map((row) => row.member_id)).toEqual([ana.me.member.id])
  })
})
