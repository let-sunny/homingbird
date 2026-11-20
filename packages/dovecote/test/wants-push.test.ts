import { createECDH } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPushWanted } from '../src/push/wants-push.ts'
import { CHANNEL, asRead, startAgent } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

const LEVELS = ['all', 'direct', 'none'] as const
const KINDS = ['direct', 'group', 'channel'] as const

describe('the push rule', () => {
  it('never pushes about a muted conversation, whatever the level', () => {
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), fc.constantFrom(...LEVELS), (kind, level) => {
        expect(isPushWanted({ kind, level, muted: true })).toBe(false)
      }),
    )
  })

  it('pushes about every conversation at all, none at none, and all but channels at direct', () => {
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), (kind) => {
        expect(isPushWanted({ kind, level: 'all', muted: false })).toBe(true)
        expect(isPushWanted({ kind, level: 'none', muted: false })).toBe(false)
        expect(isPushWanted({ kind, level: 'direct', muted: false })).toBe(kind !== 'channel')
      }),
    )
  })
})

describe('pushing to a person who muted or chose a level', () => {
  let server: TestServer
  let ana: Session
  let ben: Session
  let benAgent: Agent
  let deliveries: number
  let running: T.RunningTask<never, never>

  beforeEach(async () => {
    deliveries = 0
    const fetch = (async () => {
      deliveries += 1
      return new Response('', { status: 201 })
    }) as never
    server = await startTestServer({ HB_CHANNELS: 'general' }, { fetch })
    ana = await server.signIn('ana@example.com', 'Ana')
    ben = await server.signIn('ben@example.com', 'Ben')
    benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
    await ben.api('PUT', '/channels/general/membership', {})
    running = T.runFork(server.background, server.env)
    expect((await ben.api('POST', '/push/subscriptions', subscription())).status).toBe(200)
  })

  afterEach(async () => {
    await running.interrupt()
    await server.close()
  })

  const send = async (where: { readonly to: string[] } | { readonly channel: string }, body: string) => {
    const draft = (await ana.api('POST', '/drafts', { ...where, body })).json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
    await server.settled()
    return sent
  }
  const toBen = () => ({ to: [ben.me.member.id] })

  it('sends nothing about a muted conversation, still delivers it, and pushes again once unmuted', async () => {
    const first = await send(toBen(), 'first')
    expect(deliveries).toBe(1)
    await ben.api('PUT', `/conversations/${first.conversationId}/mute`)
    await send(toBen(), 'second')
    expect(deliveries).toBe(1)
    expect((await ben.api('GET', `/conversations/${first.conversationId}`)).json.unreadCount).toBe(2)
    await ben.api('DELETE', `/conversations/${first.conversationId}/mute`)
    await send(toBen(), 'third')
    expect(deliveries).toBe(2)
  })

  it('sends no draft-waiting notice from a muted conversation either', async () => {
    const note = await send(toBen(), 'question')
    await ben.api('PUT', `/conversations/${note.conversationId}/mute`)
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'agent answer' })
    await server.settled()
    expect(deliveries).toBe(1)
  })

  it('keeps direct messages and drops channels at direct, and sends nothing at none', async () => {
    await ben.api('PUT', '/me/notifications', { notifications: 'direct' })
    await send({ channel: 'general' }, 'in the channel')
    expect(deliveries).toBe(0)
    await send(toBen(), 'to Ben')
    expect(deliveries).toBe(1)
    await ben.api('PUT', '/me/notifications', { notifications: 'none' })
    await send(toBen(), 'to Ben again')
    await send({ channel: 'general' }, 'in the channel again')
    expect(deliveries).toBe(1)
  })

  it('ignores mutes and levels while the mute feature is off', async () => {
    const first = await send(toBen(), 'first')
    await ben.api('PUT', `/conversations/${first.conversationId}/mute`)
    await ben.api('PUT', '/me/notifications', { notifications: 'none' })
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', { ...settings, features: { mute: false } })
    await send(toBen(), 'second')
    expect(deliveries).toBe(2)
  })
})

describe('pushing about a private question to a channel’s agent', () => {
  it('pushes a manager’s answer to the asker as a conversation of its own, and nothing once the asker muted it', async () => {
    let deliveries = 0
    const fetch = (async () => {
      deliveries += 1
      return new Response('', { status: 201 })
    }) as never
    const server = await startTestServer({ HB_FEATURES: 'channelAgents=on' }, { fetch })
    const running = T.runFork(server.background, server.env)
    try {
      const ana = await server.signIn('ana@example.com', 'Ana')
      const cy = await server.signIn('cy@example.com', 'Cy')
      await ana.api('POST', '/channels', { slug: CHANNEL, description: 'Answers from the payments wiki' })
      await cy.api('PUT', `/channels/${CHANNEL}/membership`, {})
      await startAgent(server, ana)
      const room: string = (await cy.api('POST', `/channels/${CHANNEL}/private-question`)).json.id
      expect((await cy.api('POST', '/push/subscriptions', subscription())).status).toBe(200)
      const answer = async (body: string) => {
        const draft = (await ana.api('POST', '/drafts', { conversationId: room, body })).json
        await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
        await server.settled()
      }
      await cy.api('PUT', '/me/notifications', { notifications: 'direct' })
      await answer('It is in the wiki.')
      expect(deliveries).toBe(1)
      await cy.api('PUT', `/conversations/${room}/mute`)
      await answer('Under Refunds.')
      expect(deliveries).toBe(1)
    } finally {
      await running.interrupt()
      await server.close()
    }
  })
})

const subscription = () => {
  const keys = createECDH('prime256v1')
  keys.generateKeys()
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/ben-device',
    keys: {
      p256dh: keys.getPublicKey('base64url'),
      auth: Buffer.from('0123456789abcdef').toString('base64url'),
    },
  }
}
