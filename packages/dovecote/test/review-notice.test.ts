import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { NoteId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REVIEW_PUSH_WINDOW_MS } from '../src/push/notifier.ts'
import { reviewCardUrl } from '../src/push/review-notice.ts'
import { CHANNEL, asRead, startAgent } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, startTestServer } from './harness.ts'

const device = (name: string) => {
  const keys = createECDH('prime256v1')
  keys.generateKeys()
  const auth = Buffer.from('0123456789abcdef')
  const endpoint = `https://fcm.googleapis.com/fcm/send/${name}`
  return {
    endpoint,
    subscription: {
      endpoint,
      keys: { p256dh: keys.getPublicKey('base64url'), auth: auth.toString('base64url') },
    },
    read: (body: Buffer) => JSON.parse(decrypt(body, keys, auth)),
  }
}

const decrypt = (body: Buffer, keys: ReturnType<typeof createECDH>, auth: Buffer): string => {
  const salt = body.subarray(0, 16)
  const keyLength = body[20]!
  const senderPublicKey = body.subarray(21, 21 + keyLength)
  const sealed = body.subarray(21 + keyLength)
  const shared = keys.computeSecret(senderPublicKey)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), keys.getPublicKey(), senderPublicKey])
  const inputKey = Buffer.from(hkdfSync('sha256', shared, auth, info, 32))
  const key = Buffer.from(
    hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
  return plain.subarray(0, plain.length - 1).toString('utf8')
}

describe('a push when a channel’s agent’s answer waits for review', () => {
  let server: TestServer
  let root: Session
  let ana: Session
  let ben: Session
  let cy: Session
  let agent: Agent & { readonly id: string }
  let running: T.RunningTask<never, never> | null
  let pushed: Array<{ readonly endpoint: string; readonly body: Buffer }>
  const devices = { root: device('root'), ana: device('ana'), ben: device('ben'), cy: device('cy') }

  const startPushing = () => {
    running = T.runFork(server.background, server.env)
  }
  const pushedTo = (who: keyof typeof devices) =>
    pushed
      .filter((each) => each.endpoint === devices[who].endpoint)
      .map((each) => devices[who].read(each.body))
      .filter((message) => message.url.includes('/agent?draft='))
  const reviewPushes = () => (Object.keys(devices) as Array<keyof typeof devices>).flatMap(pushedTo)
  const managersGroup = async () => (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
  const setManagers = async (people: ReadonlyArray<Session>) =>
    ana.api('PUT', `/groups/${await managersGroup()}/members`, {
      memberIds: people.map((person) => person.me.member.id),
    })
  const ask = async (asker: Session, body: string) => {
    const asked = (await asker.api('POST', '/drafts', { channel: CHANNEL, body })).json
    return (await asker.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
  }
  const answer = async (question: { readonly id: string }, body: string) =>
    (await agent.api('POST', '/drafts', { inReplyTo: question.id, body })).json
  const askAndAnswer = async (asker: Session, body = 'In the wiki under Refunds.') =>
    answer(await ask(asker, 'Where is the refund runbook?'), body)

  beforeEach(async () => {
    pushed = []
    running = null
    const fetch = (async (url: string, init?: RequestInit) => {
      pushed.push({ endpoint: url, body: Buffer.from(init?.body as Uint8Array) })
      return new Response('', { status: 201 })
    }) as never
    server = await startTestServer({ HB_FEATURES: 'channelAgents=on' }, { fetch })
    root = await server.signIn('root@example.com', 'Root')
    ana = await server.signIn('ana@example.com', 'Ana')
    ben = await server.signIn('ben@example.com', 'Ben')
    cy = await server.signIn('cy@example.com', 'Cy')
    await ana.api('POST', '/channels', { slug: CHANNEL, description: 'Answers from the payments wiki' })
    for (const person of [root, ben, cy]) await person.api('PUT', `/channels/${CHANNEL}/membership`, {})
    await setManagers([ana, ben])
    agent = await startAgent(server, ana)
    for (const [who, person] of [
      ['root', root],
      ['ana', ana],
      ['ben', ben],
      ['cy', cy],
    ] as const)
      expect((await person.api('POST', '/push/subscriptions', devices[who].subscription)).status).toBe(200)
  })

  afterEach(async () => {
    await running?.interrupt()
    await server?.close()
  })

  it('tells every manager who may review it, titled by the channel and opening the card', async () => {
    startPushing()
    const question = await ask(cy, 'Where is the refund runbook?')
    await server.settled()
    pushed.length = 0
    const draft = await answer(question, 'Refunds live in the wiki, under Payments.')
    await server.settled()
    const expected = {
      title: '#payments-wiki · An answer waits for your review',
      body: 'Refunds live in the wiki, under Payments.',
      url: `/#/channel/payments-wiki/agent?draft=${draft.id}`,
      tag: `review:${draft.id}`,
    }
    expect(pushedTo('ana')).toEqual([expected])
    expect(pushedTo('ben')).toEqual([expected])
    expect(pushedTo('cy')).toEqual([])
    expect(pushedTo('root')).toEqual([])
  })

  it('never tells the person whose question it answers, even when they manage the channel', async () => {
    startPushing()
    await askAndAnswer(ben)
    await server.settled()
    expect(pushedTo('ana').map((message) => message.title)).toEqual([
      '#payments-wiki · An answer waits for your review',
    ])
    expect(pushedTo('ben')).toEqual([])
  })

  it('tells nobody who stopped managing the channel before the push went out', async () => {
    await askAndAnswer(cy)
    await setManagers([ana])
    startPushing()
    await server.settled()
    expect(pushedTo('ana')).toHaveLength(1)
    expect(pushedTo('ben')).toEqual([])
  })

  it('sends nothing about an answer already sent or discarded when the push goes out', async () => {
    const sent = await askAndAnswer(cy, 'First.')
    await ana.api('POST', `/drafts/${sent.id}/send`, { expected: asRead(sent) })
    const discarded = await askAndAnswer(cy, 'Second.')
    await ben.api('POST', `/drafts/${discarded.id}/discard`)
    startPushing()
    await server.settled()
    expect(pushedTo('ana')).toEqual([])
    expect(pushedTo('ben')).toEqual([])
  })

  it('sends nothing when the agent changes an answer, only when it writes one', async () => {
    startPushing()
    const draft = await askAndAnswer(cy)
    await server.settled()
    await server.clock.advance(REVIEW_PUSH_WINDOW_MS)
    pushed.length = 0
    await agent.api('PATCH', `/drafts/${draft.id}`, { body: 'In the wiki, revised.' })
    await server.settled()
    expect(reviewPushes()).toEqual([])
  })

  it('sends one push per manager for a burst of answers in a channel, and another once the window passes', async () => {
    startPushing()
    await askAndAnswer(cy, 'One.')
    await server.clock.advance(REVIEW_PUSH_WINDOW_MS - 1)
    await askAndAnswer(cy, 'Two.')
    await server.settled()
    expect(pushedTo('ana').map((message) => message.body)).toEqual(['One.'])
    expect(pushedTo('ben').map((message) => message.body)).toEqual(['One.'])
    await server.clock.advance(1)
    await askAndAnswer(cy, 'Three.')
    await server.settled()
    expect(pushedTo('ana').map((message) => message.body)).toEqual(['One.', 'Three.'])
  })

  it('follows the channel: nothing once it is muted, at direct, or at none, and every answer at all', async () => {
    startPushing()
    const question = await ask(cy, 'Muted?')
    await ben.api('PUT', `/conversations/${question.conversationId}/mute`)
    await ana.api('PUT', '/me/notifications', { notifications: 'direct' })
    await answer(question, 'Nobody hears this.')
    await server.settled()
    expect(reviewPushes()).toEqual([])
    await server.clock.advance(REVIEW_PUSH_WINDOW_MS)
    await ana.api('PUT', '/me/notifications', { notifications: 'none' })
    await askAndAnswer(cy)
    await server.settled()
    expect(reviewPushes()).toEqual([])
    await server.clock.advance(REVIEW_PUSH_WINDOW_MS)
    await ana.api('PUT', '/me/notifications', { notifications: 'all' })
    await askAndAnswer(cy)
    await server.settled()
    expect(pushedTo('ana')).toHaveLength(1)
    expect(pushedTo('ben')).toEqual([])
  })

  it('tells managers about an answer to a private question unless they muted that question', async () => {
    startPushing()
    const room = (await cy.api('POST', `/channels/${CHANNEL}/private-question`)).json.id
    await ben.api('PUT', `/conversations/${room}/mute`)
    const asked = (await cy.api('POST', '/drafts', { conversationId: room, body: 'Privately?' })).json
    const question = (await cy.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    pushed.length = 0
    const draft = await answer(question, 'Privately, yes.')
    await server.settled()
    expect(pushedTo('ana')).toEqual([
      {
        title: '#payments-wiki · An answer waits for your review',
        body: 'Privately, yes.',
        url: `/#/channel/payments-wiki/agent?draft=${draft.id}`,
        tag: `review:${draft.id}`,
      },
    ])
    expect(pushedTo('ben')).toEqual([])
    expect(pushedTo('cy')).toEqual([])
  })

  it('sends nothing about an answer to a private question once the manager muted the channel', async () => {
    startPushing()
    const channelRoom = (await ana.api('GET', `/channels/${CHANNEL}`)).json.conversationId
    await ben.api('PUT', `/conversations/${channelRoom}/mute`)
    const room = (await cy.api('POST', `/channels/${CHANNEL}/private-question`)).json.id
    const asked = (await cy.api('POST', '/drafts', { conversationId: room, body: 'Privately?' })).json
    const question = (await cy.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    await answer(question, 'Privately, yes.')
    await server.settled()
    expect(pushedTo('ana')).toHaveLength(1)
    expect(pushedTo('ben')).toEqual([])
  })

  it('still tells reviewers about a new answer the agent changed before the push went out, as it reads then', async () => {
    const draft = await askAndAnswer(cy, 'First wording.')
    await server.clock.advance(1_000)
    await agent.api('PATCH', `/drafts/${draft.id}`, { body: 'Second wording.' })
    startPushing()
    await server.settled()
    expect(pushedTo('ana').map((message) => message.body)).toEqual(['Second wording.'])
    expect(pushedTo('ben').map((message) => message.body)).toEqual(['Second wording.'])
  })

  it('stays quiet while the manager has a Homingbird page on screen', async () => {
    startPushing()
    await ana.api('POST', '/presence/visibility', { page: 'page-0001', visible: true })
    await askAndAnswer(cy)
    await server.settled()
    expect(pushedTo('ana')).toEqual([])
    expect(pushedTo('ben')).toHaveLength(1)
  })

  it('sends nothing once channel agents are switched off', async () => {
    await askAndAnswer(cy)
    const settings = (await root.api('GET', '/admin/settings')).json
    await root.api('PUT', '/admin/settings', { ...settings, features: { channelAgents: false } })
    startPushing()
    await server.settled()
    expect(reviewPushes()).toEqual([])
  })

  it('titles the push in the manager’s language', async () => {
    await ana.api('PATCH', '/me', { locale: 'ko' })
    startPushing()
    await askAndAnswer(cy)
    await server.settled()
    expect(pushedTo('ana').map((message) => message.title)).toEqual([
      '#payments-wiki · 검토를 기다리는 답변이 있어요',
    ])
  })

  it('addresses the card with the channel and the draft encoded', () => {
    const id = NoteId.of('n 1/2')
    expect(reviewCardUrl('payments-wiki', id)).toBe(
      `/#/channel/payments-wiki/agent?draft=${encodeURIComponent(id)}`,
    )
    expect(reviewCardUrl('payments-wiki', id)).not.toContain(' ')
  })
})
