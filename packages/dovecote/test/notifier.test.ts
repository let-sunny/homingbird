import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vapidSubject } from '../src/push/notifier.ts'
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
    await server?.close()
  })

  const sendNote = async (body: string) => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body })).json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    await server.settled()
    return sent
  }

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
    await server.settled()
    expect(deliveries).toHaveLength(1)
    expect(JSON.parse(decrypt(deliveries[0]!.body, benDevice))).toMatchObject({
      title: 'A draft is waiting for your approval',
      body: 'agent answer',
      url: `/#/c/${draft.conversationId}?draft=${draft.id}`,
      tag: `draft:${draft.id}`,
    })
    await server.clock.advance(1_000)
    await benAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'agent answer, revised' })
    await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'typed by hand' })
    await server.settled()
    expect(deliveries).toHaveLength(1)
  })

  it('stays quiet only while a page of the person’s reports that it is visible', async () => {
    const hangUp = new AbortController()
    await server.request('GET', '/api/v1/events/stream', { cookie: ben.cookie, signal: hangUp.signal })
    await sendNote('the page is open but minimised')
    expect(deliveries).toHaveLength(1)
    await ben.api('POST', '/presence/visibility', { page: 'page-0001', visible: true })
    await sendNote('you are looking at it')
    expect(deliveries).toHaveLength(1)
    await ben.api('POST', '/presence/visibility', { page: 'page-0002', visible: false })
    await sendNote('another tab went to the background, this one is still visible')
    expect(deliveries).toHaveLength(1)
    await ben.api('POST', '/presence/visibility', { page: 'page-0001', visible: false })
    await sendNote('now nothing is visible')
    expect(deliveries).toHaveLength(2)
    await ben.api('POST', '/presence/visibility', { page: 'page-0001', visible: true })
    await server.clock.advance(90_000)
    await sendNote('a visible report expires unless renewed')
    expect(deliveries).toHaveLength(3)
    hangUp.abort()
    expect(
      (await benAgent.api('POST', '/presence/visibility', { page: 'page-0003', visible: true })).status,
    ).toBe(403)
    expect(
      (await storedRows(server, 'audit_events')).filter((row) => String(row.event).includes('presence')),
    ).toEqual([])
  })

  it('logs every push attempt with the member, the push service host and its answer, and nothing secret', async () => {
    status = 410
    await sendNote('a note')
    const line = server.logged.find((each) => each.includes('"push.delivered"'))
    expect(JSON.parse(line!).attributes).toMatchObject({
      memberId: ben.me.member.id,
      endpointHost: 'fcm.googleapis.com',
      status: 410,
      removed: true,
    })
    expect(line).not.toContain(ENDPOINT)
  })

  it('sends a test notification to the person’s own devices only, and says how each went', async () => {
    const tested = await ben.api('POST', '/push/test', {})
    expect(tested.json).toEqual({
      results: [{ endpointHost: 'fcm.googleapis.com', status: 201, removed: false }],
    })
    expect(JSON.parse(decrypt(deliveries[0]!.body, benDevice))).toEqual({
      title: 'Homingbird test notification',
      body: 'Notifications reach this device.',
      url: '/#/me',
    })
    expect((await ana.api('POST', '/push/test', {})).json).toEqual({ results: [] })
    expect((await benAgent.api('POST', '/push/test', {})).status).toBe(403)
    status = 403
    expect((await ben.api('POST', '/push/test', {})).json.results[0]).toMatchObject({
      status: 403,
      removed: false,
    })
  })

  it('tells the person once, on their devices, that their running desk’s agent cannot answer, and why', async () => {
    const desk = new AbortController()
    server.env.hub.subscribe(ben.me.member.id, 'agent', desk.signal)
    await benAgent.api('POST', '/me/desk/unavailable', { kind: 'signed_out' })
    await benAgent.api('POST', '/me/desk/unavailable', { kind: 'signed_out' })
    expect(deliveries).toHaveLength(1)
    expect(JSON.parse(decrypt(deliveries[0]!.body, benDevice))).toEqual({
      title: 'Your agent cannot answer right now',
      body: 'It is signed out. Sign it in again on the computer your desk runs on.',
      url: '/#/agent/connection',
      tag: 'desk-unavailable',
    })
    desk.abort()
  })

  it('tells a person how a scheduling room’s meeting changed for them, opening the room, and never its time or link', async () => {
    const debateId = 'deb_meeting00000001'
    const about = ana.me.member.id
    const told = (notice: object, toOpener = false) =>
      server.env.meetingPushSink(ben.me.member.id, {
        debateId,
        title: 'Plan the launch',
        toOpener,
        notice: { to: ben.me.member.id, ...notice },
      } as never)
    told({ notice: 'waits' }, true)
    told({ notice: 'waits' })
    told({ notice: 'added' })
    told({ notice: 'cancelled' })
    told({ notice: 'remove_by_hand' })
    told({ notice: 'busy', memberId: about })
    told({ notice: 'left', memberId: about, because: 'took_out' })
    told({ notice: 'left', memberId: 'mem_gone000000000', because: 'declined' })
    told({ notice: 'joined', agentName: 'Ben laptop' })
    told({ notice: 'joined', agentName: null })
    await server.settled()
    expect(deliveries.map((delivery) => JSON.parse(decrypt(delivery.body, benDevice)))).toEqual(
      [
        ['Plan the launch · A time was found', 'Open it to send the invitation.'],
        ['Plan the launch · A time was found', 'Open it to add the meeting to your calendar.'],
        ['Plan the launch · Added to your calendar', 'Your agent added the meeting. Open it to take it out.'],
        ['Plan the launch · Cancelled', 'Whoever opened the room took the meeting out.'],
        [
          'Plan the launch · Take it out yourself',
          'Your agent could not take the meeting out of your calendar.',
        ],
        [
          'Plan the launch · Ana is busy then',
          'Their calendar is taken at that time. Open it to find another time.',
        ],
        ['Plan the launch · Ana left', 'They took the meeting out. Open it to find another time.'],
        ['Plan the launch · A colleague left', 'They cannot come. Open it to find another time.'],
        [
          'Plan the launch · Your agent is finding a time',
          'Ben laptop joined for you to share your free times. You can change this in Settings.',
        ],
        ['Plan the launch · Your agent is finding a time', 'It joined for you to share your free times.'],
      ].map(([title, body]) => ({ title, body, url: `/#/debate/${debateId}` })),
    )
  })

  it('tells nothing of a meeting while the person is looking, and in the language they picked', async () => {
    const notice = {
      debateId: 'deb_meeting00000001',
      title: 'Plan the launch',
      toOpener: false,
      notice: { to: ben.me.member.id, notice: 'added' },
    } as never
    await ben.api('POST', '/presence/visibility', { page: 'page-0001', visible: true })
    server.env.meetingPushSink(ben.me.member.id, notice)
    await server.settled()
    expect(deliveries).toEqual([])
    await ben.api('POST', '/presence/visibility', { page: 'page-0001', visible: false })
    await ben.api('PATCH', '/me', { locale: 'ko' })
    server.env.meetingPushSink(ben.me.member.id, notice)
    await server.settled()
    expect(JSON.parse(decrypt(deliveries[0]!.body, benDevice)).title).toBe(
      'Plan the launch · 캘린더에 들어갔어요',
    )
  })

  it('names a VAPID subject push services accept: the https address, else an administrator’s mailto', () => {
    expect(vapidSubject({ publicUrl: 'https://hb.example.com', adminEmails: ['root@example.com'] })).toBe(
      'https://hb.example.com',
    )
    expect(vapidSubject({ publicUrl: 'http://localhost:8080', adminEmails: ['root@example.com'] })).toBe(
      'mailto:root@example.com',
    )
    expect(vapidSubject({ publicUrl: 'http://localhost:8080', adminEmails: [] })).toBe(
      'mailto:dovecote@localhost',
    )
  })

  it('signs each push with a subject the push service accepts, for no longer than a day', async () => {
    await sendNote('signed')
    const token = /^vapid t=([^,]+),/.exec(deliveries[0]!.headers.authorization!)![1]!
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toMatch(/^(mailto:|https:\/\/)/)
    expect(claims.exp - Math.floor(server.clock.now() / 1000)).toBeLessThanOrEqual(24 * 60 * 60)
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
    await server.settled()
    expect(deliveries.map((delivery) => JSON.parse(decrypt(delivery.body, benDevice)).title)).toEqual([
      'Ana님이 보낸 노트',
      '승인을 기다리는 초안이 있어요',
    ])
    await ben.api('PATCH', '/me', { locale: 'en' })
    await ben.api('POST', '/push/subscriptions', { ...benDevice.subscription(ENDPOINT), locale: 'ko' })
    await sendNote('again')
    expect(JSON.parse(decrypt(deliveries[2]!.body, benDevice)).title).toBe('Note from Ana')
  })
})
