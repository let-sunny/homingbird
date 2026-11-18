import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PUSH_HOSTS } from '../src/push/default-hosts.ts'
import { MAX_PLAINTEXT_BYTES, encryptPushPayload } from '../src/push/payload-encryption.ts'
import { isKnownPushService } from '../src/push/subscriptions.ts'
import { generateVapidKeys, vapidAuthorization } from '../src/push/vapid.ts'
import {
  type Agent,
  type Session,
  type TestServer,
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

describe('VAPID', () => {
  it('signs a token the push service can verify with the public key', () => {
    const keys = generateVapidKeys()
    const header = vapidAuthorization(keys, {
      audience: 'https://fcm.googleapis.com',
      subject: 'https://hb.example.com',
      expiresAtSeconds: 1234,
    })
    const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(publicKey).toBe(keys.publicKey)
    const [head, payload, signature] = token!.split('.')
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1234,
      sub: 'https://hb.example.com',
    })
    const point = Buffer.from(keys.publicKey, 'base64url')
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
    })
    const verified = verify(
      'sha256',
      Buffer.from(`${head}.${payload}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    )
    expect(verified).toBe(true)
  })
})

describe('payload encryption', () => {
  it('refuses a payload that does not fit in one record', () => {
    const receiver = subscriber()
    const sender = createECDH('prime256v1')
    sender.generateKeys()
    const input = {
      subscriberPublicKey: receiver.keys.getPublicKey(),
      subscriberAuthSecret: receiver.auth,
      senderPrivateKey: sender.getPrivateKey(),
      salt: Buffer.alloc(16, 7),
    }
    expect(() => encryptPushPayload({ ...input, plaintext: Buffer.alloc(MAX_PLAINTEXT_BYTES + 1) })).toThrow(
      RangeError,
    )
    const body = encryptPushPayload({ ...input, plaintext: Buffer.from('fits') })
    expect(decrypt(body, receiver)).toBe('fits')
  })
})

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

describe('push notifications', () => {
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
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
    await server.clock.flush()
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

  it('pushes an encrypted preview of a new note to the recipient, and nothing to the author', async () => {
    const note = await sendNote('Is the migration safe to run today?')
    expect(deliveries).toHaveLength(1)
    const [delivery] = deliveries
    expect(delivery!.url).toBe(ENDPOINT)
    expect(delivery!.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      ttl: '86400',
      urgency: 'normal',
    })
    expect(delivery!.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/)
    expect(delivery!.body.toString('latin1')).not.toContain('migration')
    expect(JSON.parse(decrypt(delivery!.body, benDevice))).toEqual({
      title: 'Note from Ana',
      body: 'Is the migration safe to run today?',
      url: `/#/c/${note.conversationId}`,
    })
  })

  it('shortens a long note in the preview', async () => {
    await sendNote('x'.repeat(500))
    const message = JSON.parse(decrypt(deliveries[0]!.body, benDevice))
    expect(message.body).toHaveLength(140)
    expect(message.body.endsWith('…')).toBe(true)
  })

  it('tells a person when their agent has a draft waiting, but not for edits or their own drafts', async () => {
    const note = await sendNote('question')
    deliveries.length = 0
    const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'agent answer' })).json
    await server.clock.flush()
    expect(deliveries).toHaveLength(1)
    expect(JSON.parse(decrypt(deliveries[0]!.body, benDevice))).toMatchObject({
      title: 'A draft is waiting for your approval',
      body: 'agent answer',
    })
    await server.clock.advance(1_000)
    await benAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'agent answer, revised' })
    await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'typed by hand' })
    await server.clock.flush()
    expect(deliveries).toHaveLength(1)
  })

  it('stays quiet while the person has the web client open', async () => {
    const hangUp = new AbortController()
    await server.request('GET', '/api/v1/events/stream', { cookie: ben.cookie, signal: hangUp.signal })
    await sendNote('you are looking at it')
    expect(deliveries).toEqual([])
    hangUp.abort()
    await sendNote('now you are not')
    expect(deliveries).toHaveLength(1)
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

  it('titles the notification in the language of the browser that subscribed', async () => {
    await ben.api('POST', '/push/subscriptions', { ...benDevice.subscription(ENDPOINT), locale: 'ko' })
    await sendNote('질문이 있어요')
    expect(JSON.parse(decrypt(deliveries[0]!.body, benDevice))).toMatchObject({
      title: 'Ana님이 보낸 노트',
      body: '질문이 있어요',
    })
  })

  it('titles the notification in the language the person picked, on every device', async () => {
    await ben.api('PATCH', '/me', { locale: 'ko' })
    const note = await sendNote('question')
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'agent answer' })
    await server.clock.flush()
    expect(deliveries.map((delivery) => JSON.parse(decrypt(delivery.body, benDevice)).title)).toEqual([
      'Ana님이 보낸 노트',
      '승인을 기다리는 초안이 있어요',
    ])
    await ben.api('PATCH', '/me', { locale: 'en' })
    await ben.api('POST', '/push/subscriptions', { ...benDevice.subscription(ENDPOINT), locale: 'ko' })
    await sendNote('again')
    expect(JSON.parse(decrypt(deliveries[2]!.body, benDevice)).title).toBe('Note from Ana')
  })

  it('moves a device’s subscription to whoever signed in on it last', async () => {
    await ana.api('POST', '/push/subscriptions', benDevice.subscription(ENDPOINT))
    const rows = await storedRows(server, 'push_subscriptions')
    expect(rows.map((row) => row.member_id)).toEqual([ana.me.member.id])
  })
})
