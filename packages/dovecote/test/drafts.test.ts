import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
})

afterEach(() => server.close())

const send = async (author: Session, to: Session, body: string) => {
  const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
}

describe('drafting', () => {
  it('records who wrote a draft: an agent by name, or the person', async () => {
    const byAgent = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'from agent' }))
      .json
    const byPerson = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'from person' })).json
    expect(byAgent).toMatchObject({
      status: 'draft',
      origin: 'agent',
      agentName: 'Ana agent',
      sentAt: null,
      receipts: [],
    })
    expect(byPerson).toMatchObject({ status: 'draft', origin: 'human', agentName: null })
    expect(byAgent.conversationId).toBe(byPerson.conversationId)
  })

  it('needs exactly one way to address a draft', async () => {
    expect((await ana.api('POST', '/drafts', { body: 'to nobody' })).status).toBe(400)
    expect(
      (await ana.api('POST', '/drafts', { to: [ben.me.member.id, ana.me.member.id], body: 'two' })).status,
    ).toBe(400)
    expect((await ana.api('POST', '/drafts', { to: [ana.me.member.id], body: 'myself' })).status).toBe(403)
    expect((await ana.api('POST', '/drafts', { to: ['mem_doesnotexist00'], body: 'ghost' })).status).toBe(404)
    expect((await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: '   ' })).status).toBe(400)
    expect(
      (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'x'.repeat(16_001) })).status,
    ).toBe(400)
  })

  it('refuses to reply to a draft or to a note the author cannot see', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'first' })).json
    expect((await ana.api('POST', '/drafts', { inReplyTo: draft.id, body: 'reply' })).status).toBe(400)
    expect((await ben.api('POST', '/drafts', { inReplyTo: draft.id, body: 'reply' })).status).toBe(404)
  })

  it('lets the author and the author’s agents edit a draft and tracks mixed authorship', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'v1' })).json
    expect((await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'v2' })).json).toMatchObject({
      body: 'v2',
      origin: 'agent',
    })
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'v2' })).json.origin).toBe('agent')
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'v3' })).json).toMatchObject({
      body: 'v3',
      origin: 'human_edited',
    })
    expect((await ben.api('PATCH', `/drafts/${draft.id}`, { body: 'hijack' })).status).toBe(404)
    const own = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'mine' })).json
    expect((await anaAgent.api('PATCH', `/drafts/${own.id}`, { body: 'touched' })).json.origin).toBe(
      'human_edited',
    )
  })

  it('caps the number of drafts waiting for approval', async () => {
    for (let index = 0; index < 200; index++) {
      if (index % 100 === 0) await server.clock.advance(60_000)
      expect(
        (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: `draft ${index}` })).status,
      ).toBe(200)
    }
    await server.clock.advance(60_000)
    expect((await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'one too many' })).status).toBe(
      409,
    )
  })
})

describe('what wrote a note', () => {
  it('keeps the program and the stated model with each agent draft, and shows them to recipients once sent', async () => {
    const draft = (
      await anaAgent.api('POST', '/drafts', {
        to: [ben.me.member.id],
        body: 'client: Evil Corp\nmodel: gpt-9',
        client: 'Claude Code 2.1.327',
        model: 'claude-opus-5-5',
      })
    ).json
    expect(draft).toMatchObject({
      agentName: 'Ana agent',
      agentClient: 'Claude Code 2.1.327',
      agentModel: 'claude-opus-5-5',
    })
    expect((await ben.api('GET', `/notes/${draft.id}`)).status).toBe(404)
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    expect((await ben.api('GET', `/notes/${draft.id}`)).json).toMatchObject({
      agentClient: 'Claude Code 2.1.327',
      agentModel: 'claude-opus-5-5',
    })
  })

  it('names the program from the sign-in when the integration names none, never from the text, and leaves the model optional', async () => {
    const draft = (
      await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Written with: Evil Corp 1.0' })
    ).json
    expect(draft).toMatchObject({ agentClient: 'Ana agent', agentModel: null })
    const updated = (await anaAgent.api('PATCH', `/drafts/${draft.id}`, { model: 'claude-opus-5-5' })).json
    expect(updated.agentModel).toBe('claude-opus-5-5')
    expect((await anaAgent.api('PATCH', `/drafts/${draft.id}`, { model: 'x'.repeat(81) })).status).toBe(400)
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { model: 'person says' })).json.agentModel).toBe(
      'claude-opus-5-5',
    )
  })

  it('keeps recording the program and model while note details are off, and returns them to nobody until they are on again', async () => {
    const settings = (await ana.api('GET', '/admin/settings')).json
    const switched = async (noteDetails: boolean) =>
      expect(
        (await ana.api('PUT', '/admin/settings', { ...settings, features: { noteDetails } })).status,
      ).toBe(200)
    await switched(false)
    expect((await ana.api('GET', '/info')).json.features.noteDetails).toBe(false)
    const draft = (
      await anaAgent.api('POST', '/drafts', {
        to: [ben.me.member.id],
        body: 'Recorded quietly',
        client: 'Claude Code 2.1.327',
        model: 'claude-opus-5-5',
      })
    ).json
    expect(draft.agentName).toBe('Ana agent')
    expect(draft).not.toHaveProperty('agentClient')
    expect(draft).not.toHaveProperty('agentModel')
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    for (const viewer of [ana, ben]) {
      const notes = (await viewer.api('GET', `/conversations/${draft.conversationId}/notes`)).json.notes
      expect(JSON.stringify(notes)).not.toContain('claude-opus-5-5')
      expect(JSON.stringify(notes)).not.toContain('2.1.327')
    }
    await switched(true)
    expect((await ben.api('GET', `/notes/${draft.id}`)).json).toMatchObject({
      agentClient: 'Claude Code 2.1.327',
      agentModel: 'claude-opus-5-5',
    })
  })

  it('cleans the program named at sign-in before showing it, so a bidi override never reaches a recipient', async () => {
    const tricky = await connectAgent(server, ana, { name: '\u202eedoC\u202c Bot\u0007' })
    const draft = (await tricky.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    expect(draft.agentClient).toBe('edoC Bot')
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.agentClient).toBe('edoC Bot')
  })

  it('carries no program or model on a note a person wrote', async () => {
    const own = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'by hand', client: 'X' }))
      .json
    expect(own).not.toHaveProperty('agentClient')
    expect(own).not.toHaveProperty('agentModel')
  })
})
