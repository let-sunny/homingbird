import { Task as T } from '@homingbird/kernel'
import type { MemberId, Note } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notPostedNoticeFor } from '../src/slack/slack-not-posted.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type Agent, type Session, type TestServer, connectAgent } from './harness.ts'
import {
  type FakeSlack,
  askInSlack,
  fakeSlack,
  linkChannel,
  linkPerson,
  startSlackServer,
} from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session
let ben: Session
let cy: Session
let benAgent: Agent

beforeEach(async () => {
  slack = fakeSlack([
    { id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' },
    { id: 'U0BOB', name: 'Bob', email: 'bob@elsewhere.example' },
  ])
  server = await startSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
  await ben.api('PUT', '/channels/billing/membership')
  await ben.api('PUT', '/channels/billing/answering')
  await cy.api('PUT', '/channels/billing/membership')
  await linkPerson(server, slack, ana)
  await linkChannel(server, slack, ana, 'U0ANA', 'billing')
})

afterEach(() => server?.close())

/** Ben's reply to a question from Slack, sent and waiting to be posted. */
const sentReply = async (): Promise<Note> => {
  await askInSlack(server, 'U0BOB', 'Do refunds keep the discount?')
  const question = (await ben.api('GET', '/inbox')).json.items[0].note
  const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Yes.' })).json
  await ben.api('POST', `/drafts/${draft.id}/send`, {
    expected: { body: draft.body, conversationId: draft.conversationId, threadAt: question.via.threadAt },
  })
  return (await ben.api('GET', `/notes/${draft.id}`)).json
}

const told = (memberId: MemberId, note: Note) => T.runPromise(notPostedNoticeFor(memberId, note), server.env)

/** Stands in for the outbox giving up after its last wait, which the outbox's own tests walk through. */
const giveUp = (note: Note) =>
  T.runPromise(run(sql`UPDATE slack_outbox SET state = 'failed' WHERE note_id = ${note.id}`), server.env)

describe('who is told that a reply was not posted to Slack', () => {
  it('tells its sender and the channel’s managers, with a link to the room, and nobody else', async () => {
    const reply = await sentReply()
    expect(await told(ben.me.member.id, reply)).toBeNull()
    await giveUp(reply)
    const url = `/#/c/${encodeURIComponent(reply.conversationId)}`
    expect(await told(ben.me.member.id, reply)).toEqual({ channel: 'billing-help', url })
    expect(await told(ana.me.member.id, reply)).toEqual({ channel: 'billing-help', url })
    expect(await told(cy.me.member.id, reply)).toBeNull()
  })

  it('tells the person who approved a channel’s agent’s answer, as its sender', async () => {
    const reply = await sentReply()
    await giveUp(reply)
    const approved = { ...reply, authorId: 'mem_agent0000000' as MemberId, approvedBy: cy.me.member.id }
    expect(await told(cy.me.member.id, approved)).not.toBeNull()
  })

  it('tells nobody once the link was removed', async () => {
    const reply = await sentReply()
    await ana.api('DELETE', '/channels/billing/slack')
    expect(await told(ana.me.member.id, reply)).toBeNull()
    expect(await told(ben.me.member.id, reply)).toBeNull()
  })
})
