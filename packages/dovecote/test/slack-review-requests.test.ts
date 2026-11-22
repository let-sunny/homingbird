import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, asShown, connectAgent } from './harness.ts'
import { type FakeSlack, fakeSlack, startSlackServer } from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session
let ben: Session
let benAgent: Agent
let running: T.RunningTask<never, never>

const DRAFT_TEXT = 'agent answer about the refund rule'

const linkBen = async () => {
  await ben.api('POST', '/me/slack/connect', {})
  const code = /#\/slack\/link\/([A-Za-z0-9_-]+)/.exec(slack.posted().at(-1)!.text!)![1]!
  await ben.api('POST', '/me/slack/link', { code })
  slack.calls.length = 0
}

const noteToBen = async () => {
  const draft = (
    await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'What is the refund rule?' })
  ).json
  return (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
}

beforeEach(async () => {
  slack = fakeSlack([{ id: 'U0BEN', name: 'Ben', email: 'ben@example.com' }])
  server = await startSlackServer(slack, { HB_FEATURES: 'slack=on,webPush=off' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  running = T.runFork(server.background, server.env)
})

afterEach(async () => {
  await running.interrupt()
  await server.close()
})

describe('a review request in Slack', () => {
  it('tells a linked person in a direct message that a draft waits, with a link to its card and nothing of the draft', async () => {
    await linkBen()
    const note = await noteToBen()
    await server.settled()
    expect(slack.posted()).toEqual([])
    const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: DRAFT_TEXT })).json
    await server.settled()
    const [request] = slack.posted()
    expect(request!.channel).toBe('DU0BEN')
    expect(request!.text).toBe(
      `A draft waits for your decision. <http://localhost:8080/#/c/${draft.conversationId}?draft=${draft.id}|Open it in Homingbird>`,
    )
    expect(JSON.stringify(slack.calls)).not.toContain('refund')
    expect(server.logged.some((line) => line.includes('slack.review_request_sent'))).toBe(true)
  })

  it('sends nothing to a person who is not linked, nor for an edit of the draft', async () => {
    const note = await noteToBen()
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: DRAFT_TEXT })
    await server.settled()
    expect(slack.posted()).toEqual([])
    await linkBen()
    const second = await noteToBen()
    const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: second.id, body: DRAFT_TEXT })).json
    await server.settled()
    slack.calls.length = 0
    await server.clock.advance(1000)
    await benAgent.api('PATCH', `/drafts/${draft.id}`, { body: `${DRAFT_TEXT}, revised` })
    await server.settled()
    expect(slack.posted()).toEqual([])
  })

  it('follows the person’s notification level, as a push does', async () => {
    await linkBen()
    await ben.api('PUT', '/me/notifications', { notifications: 'none' })
    const note = await noteToBen()
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: DRAFT_TEXT })
    await server.settled()
    expect(slack.posted()).toEqual([])
  })

  it('sends nothing when Slack refuses to open the direct message or to post it', async () => {
    await linkBen()
    slack.refuseNext('conversations.open', 'user_not_found')
    const note = await noteToBen()
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: DRAFT_TEXT })
    await server.settled()
    slack.refuseNext('chat.postMessage', 'channel_not_found')
    const second = await noteToBen()
    await benAgent.api('POST', '/drafts', { inReplyTo: second.id, body: DRAFT_TEXT })
    await server.settled()
    expect(server.logged.some((line) => line.includes('slack.review_request_sent'))).toBe(false)
  })
})
