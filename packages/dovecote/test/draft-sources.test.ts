import { afterEach, describe, expect, it } from 'vitest'
import { UNREAD_SOURCE } from '../src/domain/draft-sources.ts'
import { askAndDraft, startAgent, startWithChannel } from './channel-agent-support.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
  connectAgent,
  startTestServer,
} from './harness.ts'

let server: TestServer

afterEach(async () => {
  await server.close()
})

const WIKI = { url: 'https://wiki.example.com/refunds', quote: 'Refunds take five days.' }

describe('the sources a person’s agent reports with a draft', () => {
  let ana: Session
  let ben: Session
  let cy: Session
  let anaAgent: Agent

  const start = async () => {
    server = await startTestServer()
    ana = await server.signIn('ana@example.com', 'Ana')
    ben = await server.signIn('ben@example.com', 'Ben')
    cy = await server.signIn('cy@example.com', 'Cy')
    anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  }

  const noteFrom = async (author: Session, to: Session, body: string) => {
    const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
    return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
  }

  it('shows them to the author with where an earlier note is, before and after sending, and never to the recipient', async () => {
    await start()
    const question = await noteFrom(ben, ana, 'How long do refunds take?')
    const draft = await anaAgent.api('POST', '/drafts', {
      inReplyTo: question.id,
      body: 'Five days.',
      basis: 'Read the wiki',
      sources: [WIKI, { noteId: question.id, quote: 'How long' }],
    })
    const shown = [WIKI, { noteId: question.id, conversationId: question.conversationId, quote: 'How long' }]
    expect(draft.json.sources).toEqual(shown)
    expect((await ana.api('GET', `/notes/${draft.json.id}`)).json.sources).toEqual(shown)
    await ana.api('POST', `/drafts/${draft.json.id}/send`, await asShown(ana, draft.json.id))
    expect((await ana.api('GET', `/notes/${draft.json.id}`)).json.sources).toEqual(shown)
    const received = (await ben.api('GET', `/notes/${draft.json.id}`)).json
    expect([received.basis, received.sources]).toEqual([undefined, undefined])
  })

  it('refuses a note its author cannot read, and a draft, as a source', async () => {
    await start()
    const elsewhere = await noteFrom(ben, cy, 'Between us')
    const refused = await anaAgent.api('POST', '/drafts', {
      to: [ben.me.member.id],
      body: 'Hi',
      sources: [{ noteId: elsewhere.id }],
    })
    expect([refused.status, refused.json.error.message]).toEqual([400, UNREAD_SOURCE])
    const own = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Not sent' })).json
    const onDraft = await anaAgent.api('PATCH', `/drafts/${own.id}`, { sources: [{ noteId: own.id }] })
    expect(onDraft.status).toBe(400)
  })

  it('replaces them when the agent revises the draft, and keeps them otherwise', async () => {
    await start()
    const draft = (
      await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Five days.', sources: [WIKI] })
    ).json
    const reworded = await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'About five days.' })
    expect(reworded.json.sources).toEqual([WIKI])
    const cleared = await anaAgent.api('PATCH', `/drafts/${draft.id}`, { sources: [] })
    expect(cleared.json.sources).toBeUndefined()
  })

  it('refuses an address that is not a web page', async () => {
    await start()
    const refused = await anaAgent.api('POST', '/drafts', {
      to: [ben.me.member.id],
      body: 'Hi',
      sources: [{ url: 'javascript:alert(1)' }],
    })
    expect(refused.status).toBe(400)
  })
})

describe('the sources a channel’s agent reports with an answer', () => {
  it('are shown to its reviewers, with the question it names, and never to the asker', async () => {
    let ana: Session
    let cy: Session
    ;({ server, ana, cy } = await startWithChannel())
    const agent = await startAgent(server, ana)
    const { question, draft } = await askAndDraft(cy, agent)
    const revised = await agent.api('PATCH', `/drafts/${draft.id}`, {
      sources: [{ noteId: question.id }, WIKI],
    })
    expect(revised.status).toBe(200)
    const [review] = (await ana.api('GET', '/reviews')).json.reviews
    expect(review.note.sources).toEqual([
      { noteId: question.id, conversationId: question.conversationId },
      WIKI,
    ])
    await ana.api('POST', `/drafts/${draft.id}/send`, {
      expected: { body: draft.body, conversationId: draft.conversationId },
    })
    const read = (await cy.api('GET', `/notes/${draft.id}`)).json
    expect(read.sources).toBeUndefined()
  })
})
