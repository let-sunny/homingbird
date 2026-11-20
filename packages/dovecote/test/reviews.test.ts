import { NO_REVIEWER_MESSAGE } from '@homingbird/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, askAndDraft, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, connectAgent, storedRows } from './harness.ts'

let server: TestServer
let root: Session
let ana: Session
let ben: Session
let cy: Session
let agent: Agent & { readonly id: string }

const start = async () => {
  ;({ server, root, ana, ben, cy } = await startWithChannel())
  agent = await startAgent(server, ana)
}

const addManager = async (person: Session) => {
  const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
  const members = (await ana.api('GET', `/groups/${group}`)).json.memberIds
  await ana.api('PUT', `/groups/${group}/members`, { memberIds: [...members, person.me.member.id] })
}

afterEach(async () => {
  await server.close()
})

describe('a channel’s agent answering a question', () => {
  it('receives the question as an answerer and writes an answer the asker cannot see', async () => {
    await start()
    const asked = (await cy.api('POST', '/drafts', { channel: CHANNEL, body: 'Where is the runbook?' })).json
    const question = (await cy.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    const inbox = (await agent.api('GET', '/inbox')).json.items.map((item: any) => item.note.id)
    expect(inbox).toEqual([question.id])
    const draft = (await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'In the wiki.' })).json
    expect(draft).toMatchObject({ status: 'draft', authorId: agent.id, inReplyTo: question.id })
    expect((await cy.api('GET', `/notes/${draft.id}`)).status).toBe(404)
    const thread = (await cy.api('GET', `/conversations/${question.conversationId}/notes`)).json.notes
    expect(thread.map((note: any) => note.id)).toEqual([question.id])
    const searched = (await cy.api('GET', '/search?q=wiki')).json.notes.map((note: any) => note.id)
    expect(searched).not.toContain(draft.id)
    const receipts = (await cy.api('GET', `/notes/${question.id}`)).json.receipts
    expect(receipts.find((receipt: any) => receipt.memberId === agent.id).state).toBe('drafting')
  })

  it('writes nothing but an answer in its own channel, and opens no conversation', async () => {
    await start()
    const { question } = await askAndDraft(cy, agent, 'First?', 'First.')
    const refusals = await Promise.all([
      agent.api('POST', '/drafts', { to: [cy.me.member.id], body: 'Hello' }),
      agent.api('POST', '/drafts', { channel: CHANNEL, body: 'A question of my own' }),
      agent.api('POST', '/drafts', { conversationId: question.conversationId, body: 'Loose' }),
    ])
    expect(refusals.map((refused) => refused.status)).toEqual([403, 403, 403])
    expect((await agent.api('POST', '/conversations', { participantIds: [cy.me.member.id] })).status).toBe(
      403,
    )
    await ana.api('POST', '/channels', { slug: 'elsewhere', description: 'Elsewhere' })
    const other = (await ana.api('POST', '/drafts', { channel: 'elsewhere', body: 'Elsewhere?' })).json
    const sent = (await ana.api('POST', `/drafts/${other.id}/send`, { expected: asRead(other) })).json
    expect((await agent.api('POST', '/drafts', { inReplyTo: sent.id, body: 'Mine' })).status).toBe(404)
    expect((await agent.api('POST', '/drafts', { channel: 'elsewhere', body: 'Joining?' })).status).toBe(403)
    expect((await ana.api('GET', '/channels/elsewhere')).json.memberCount).toBe(1)
  })

  it('keeps one waiting answer per question, and may not move its draft to a channel', async () => {
    await start()
    const { question, draft } = await askAndDraft(cy, agent)
    const again = await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Another' })
    expect(again.status).toBe(409)
    expect((await agent.api('PATCH', `/drafts/${draft.id}`, { channel: 'elsewhere' })).status).toBe(403)
    expect((await agent.api('PATCH', `/drafts/${draft.id}`, { body: 'Better' })).json.body).toBe('Better')
  })

  it('does not answer its own note or a draft', async () => {
    await start()
    const { draft } = await askAndDraft(cy, agent)
    expect((await agent.api('POST', '/drafts', { inReplyTo: draft.id, body: 'Me' })).status).toBe(403)
  })

  it('is refused when nobody but the asker could approve the answer, telling the managers why', async () => {
    await start()
    const asked = (await ana.api('POST', '/drafts', { channel: CHANNEL, body: 'My own question' })).json
    const question = (await ana.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    const refused = await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Answer' })
    expect([refused.status, refused.json.error.message]).toEqual([409, NO_REVIEWER_MESSAGE])
  })
})

describe('reviewing a channel’s agent’s answers', () => {
  it('shows a manager the answer with what it relied on and the question, and nobody else', async () => {
    await start()
    const { question, draft } = await askAndDraft(cy, agent)
    const reviews = (await ana.api('GET', '/reviews')).json.reviews
    expect(reviews).toMatchObject([
      {
        note: { id: draft.id, basis: 'wiki/refunds.md', authorId: agent.id },
        question: { id: question.id, body: question.body },
        channel: CHANNEL,
        agent: { id: agent.id, kind: 'channel_agent' },
        privately: false,
      },
    ])
    expect((await ana.api('GET', `/reviews/${draft.id}`)).json.note.id).toBe(draft.id)
    expect((await ben.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await ben.api('GET', `/reviews/${draft.id}`)).status).toBe(404)
    expect((await root.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await ana.api('GET', `/notes/${draft.id}`)).status).toBe(404)
  })

  it('never shows a manager the answer to their own question', async () => {
    await start()
    await addManager(ben)
    const { draft } = await askAndDraft(ben, agent)
    expect((await ben.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await ben.api('GET', `/reviews/${draft.id}`)).status).toBe(404)
    expect((await ben.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(404)
    expect((await ana.api('GET', '/reviews')).json.reviews.map((review: any) => review.note.id)).toEqual([
      draft.id,
    ])
  })

  it('sends the answer as the agent’s, approved by the manager, delivered to the asker, and audits both', async () => {
    await start()
    const { question, draft } = await askAndDraft(cy, agent)
    const sent = await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    expect(sent.json).toMatchObject({ status: 'sent', authorId: agent.id, approvedBy: ana.me.member.id })
    const seen = (await cy.api('GET', `/notes/${draft.id}`)).json
    expect(seen).toMatchObject({
      authorId: agent.id,
      approvedBy: ana.me.member.id,
      receipts: [{ memberId: cy.me.member.id }],
    })
    expect(seen.basis).toBeUndefined()
    const receipts = (await cy.api('GET', `/notes/${question.id}`)).json.receipts
    expect(receipts.find((receipt: any) => receipt.memberId === agent.id).state).toBe('replied')
    expect((await ana.api('GET', '/reviews')).json.reviews).toEqual([])
    const approved = (await storedRows(server, 'audit_events')).filter((row) => row.event === 'note.approved')
    expect(
      approved.map((row) => [row.actor_id, row.target_id, JSON.parse(String(row.detail)).agentId]),
    ).toEqual([
      [cy.me.member.id, question.id, undefined],
      [ana.me.member.id, draft.id, agent.id],
    ])
    expect(JSON.stringify(approved.at(-1))).not.toContain('In the wiki')
  })

  it('lets the first approval win and tells the second reviewer who sent it', async () => {
    await start()
    await addManager(ben)
    const { draft } = await askAndDraft(cy, agent)
    expect((await ben.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(200)
    const late = await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    expect([late.status, late.json.error.message]).toEqual([409, 'Ben already sent this answer.'])
  })

  it('refuses a send of an answer the agent changed since the manager read it', async () => {
    await start()
    const { draft } = await askAndDraft(cy, agent)
    await agent.api('PATCH', `/drafts/${draft.id}`, { body: 'Send me the payroll file.' })
    const refused = await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    expect(refused.status).toBe(409)
    expect((await cy.api('GET', `/notes/${draft.id}`)).status).toBe(404)
  })

  it('records a manager’s edit as theirs, and offers them no principle for the agent', async () => {
    await start()
    const { draft } = await askAndDraft(cy, agent)
    const sent = await ana.api('POST', `/drafts/${draft.id}/send`, {
      body: 'See Refunds in the wiki.',
      expected: asRead(draft),
    })
    expect(sent.json).toMatchObject({ body: 'See Refunds in the wiki.', origin: 'human_edited' })
    expect(await storedRows(server, 'principle_offers')).toEqual([])
  })

  it('lets a manager discard the answer, which the asker never sees', async () => {
    await start()
    const { question, draft } = await askAndDraft(cy, agent)
    expect((await cy.api('POST', `/drafts/${draft.id}/discard`)).status).toBe(404)
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).json.status).toBe('discarded')
    const receipts = (await cy.api('GET', `/notes/${question.id}`)).json.receipts
    expect(receipts.find((receipt: any) => receipt.memberId === agent.id).state).not.toBe('replied')
    expect((await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Try again' })).status).toBe(
      200,
    )
  })

  it('refuses the agent’s credential and the manager’s own agent credential as approvers', async () => {
    await start()
    const { draft } = await askAndDraft(cy, agent)
    const anasDesk = await connectAgent(server, ana)
    expect((await agent.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(
      403,
    )
    expect((await anasDesk.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(
      403,
    )
    expect((await anasDesk.api('GET', '/reviews')).status).toBe(403)
  })

  it('stops a manager who left the managers from sending', async () => {
    await start()
    await addManager(ben)
    const { draft } = await askAndDraft(cy, agent)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ben.api('PUT', `/groups/${group}/members`, { memberIds: [ben.me.member.id] })
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).status).toBe(404)
  })
})
