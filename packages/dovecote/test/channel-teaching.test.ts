import { afterEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, askAndDraft, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type Session, type TestServer, connectAgent, storedRows } from './harness.ts'

let server: TestServer
let root: Session
let ana: Session
let ben: Session
let cy: Session

const start = async (overrides: Readonly<Record<string, string>> = {}) => {
  ;({ server, root, ana, ben, cy } = await startWithChannel(overrides))
}

afterEach(async () => {
  await server?.close()
})

const TEACHING = `/channels/${CHANNEL}/agent/teaching`
const PRINCIPLES = `/channels/${CHANNEL}/agent/principles`

const auditEvents = async (prefix: string) =>
  (await storedRows(server, 'audit_events'))
    .filter((row) => String(row.event).startsWith(prefix))
    .map((row) => ({
      event: row.event,
      actor: row.actor_id,
      target: row.target_id,
      detail: JSON.parse(String(row.detail)),
    }))

describe('teaching a channel’s agent', () => {
  it('lets a manager write the instruction and sources and save, change, order and delete principles', async () => {
    await start()
    await startAgent(server, ana)
    expect((await ana.api('GET', TEACHING)).json).toEqual({
      channel: CHANNEL,
      instruction: '',
      sources: [],
      updatedAt: null,
      principles: [],
      limit: 50,
    })
    const set = await ana.api('PUT', TEACHING, {
      instruction: '  Answer from the payments wiki only.  ',
      sources: ['https://wiki.example/payments'],
    })
    expect(set.status).toBe(200)
    expect(set.json).toMatchObject({
      instruction: 'Answer from the payments wiki only.',
      sources: ['https://wiki.example/payments'],
    })
    expect(set.json.updatedAt).toEqual(expect.any(Number))
    const again = await ana.api('PUT', TEACHING, { instruction: 'Be brief.', sources: [] })
    expect(again.json).toMatchObject({ instruction: 'Be brief.', sources: [] })

    const refunds = await ana.api('POST', PRINCIPLES, {
      kind: 'answer',
      topic: 'Refund window',
      rule: 'Refunds are possible within 14 days.',
    })
    expect(refunds.status).toBe(200)
    expect(refunds.json).toMatchObject({ kind: 'answer', place: null, origin: 'manual', enabled: true })
    const invoices = (
      await ana.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the invoice page in the wiki' })
    ).json
    const changed = await ana.api('PATCH', `${PRINCIPLES}/${refunds.json.id}`, { enabled: false })
    expect(changed.json.enabled).toBe(false)
    const ordered = await ana.api('PUT', `${PRINCIPLES}/order`, { ids: [invoices.id, refunds.json.id] })
    expect(ordered.json.principles.map((each: any) => each.topic)).toEqual(['Invoices', 'Refund window'])
    expect((await ana.api('DELETE', `${PRINCIPLES}/${refunds.json.id}`)).status).toBe(200)
    expect((await ana.api('GET', TEACHING)).json.principles.map((each: any) => each.id)).toEqual([
      invoices.id,
    ])
  })

  it('keeps the agent’s principles apart from every person’s own', async () => {
    await start()
    await startAgent(server, ana)
    await ana.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the invoice page in the wiki' })
    expect((await ana.api('GET', '/principles')).json.principles).toEqual([])
    await ana.api('POST', '/principles', { topic: 'Invoices', rule: 'say I will check', place: null })
    expect((await ana.api('GET', TEACHING)).json.principles).toHaveLength(1)
  })

  it('validates again what the web client checks', async () => {
    await start()
    await startAgent(server, ana)
    const sources = ['https://wiki.example/a', 'http://WIKI.example/a/']
    expect((await ana.api('PUT', TEACHING, { instruction: '', sources })).status).toBe(400)
    expect((await ana.api('PUT', TEACHING, { instruction: 'a'.repeat(501), sources: [] })).status).toBe(400)
    expect(
      (await ana.api('PUT', TEACHING, { instruction: '', sources: ['javascript:alert(1)'] })).status,
    ).toBe(400)
    const six = Array.from({ length: 6 }, (_, index) => `https://wiki.example/${index}`)
    expect((await ana.api('PUT', TEACHING, { instruction: '', sources: six })).status).toBe(400)
    expect((await ana.api('POST', PRINCIPLES, { topic: 'Empty', rule: '' })).status).toBe(400)
    expect((await ana.api('POST', PRINCIPLES, { topic: 'Has: colon', rule: 'check it' })).status).toBe(400)
    expect((await ana.api('POST', PRINCIPLES, { kind: 'answer', topic: 'Empty', rule: '' })).status).toBe(400)
    await ana.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the invoice page' })
    expect((await ana.api('POST', PRINCIPLES, { topic: 'invoices', rule: 'other' })).status).toBe(409)
    const listed = (await ana.api('GET', TEACHING)).json.principles
    expect((await ana.api('PUT', `${PRINCIPLES}/order`, { ids: [] })).status).toBe(400)
    expect((await ana.api('PATCH', `${PRINCIPLES}/${listed[0].id}`, { rule: '' })).status).toBe(400)
  })

  it('records that a manager changed it, never its words', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await ana.api('PUT', TEACHING, { instruction: 'Secret wording', sources: ['https://wiki.example/x'] })
    await ana.api('PUT', TEACHING, { instruction: 'Secret wording', sources: [] })
    const made = (
      await ana.api('POST', PRINCIPLES, { topic: 'Hidden title', rule: 'hidden rule', taughtFrom: 'edit' })
    ).json
    await ana.api('PATCH', `${PRINCIPLES}/${made.id}`, { rule: 'other hidden rule', enabled: false })
    await ana.api('PUT', `${PRINCIPLES}/order`, { ids: [made.id] })
    await ana.api('DELETE', `${PRINCIPLES}/${made.id}`)
    const actor = ana.me.member.id
    expect(await auditEvents('channel.agent_')).toEqual([
      expect.objectContaining({ event: 'channel.agent_created' }),
      {
        event: 'channel.agent_instruction_changed',
        actor,
        target: agent.id,
        detail: { channel: CHANNEL, fields: ['instruction', 'sources'] },
      },
      {
        event: 'channel.agent_instruction_changed',
        actor,
        target: agent.id,
        detail: { channel: CHANNEL, fields: ['sources'] },
      },
      {
        event: 'channel.agent_principle_created',
        actor,
        target: made.id,
        detail: { channel: CHANNEL, kind: 'rule', taughtFrom: 'edit' },
      },
      {
        event: 'channel.agent_principle_changed',
        actor,
        target: made.id,
        detail: { channel: CHANNEL, fields: ['rule', 'enabled'], enabled: false },
      },
      {
        event: 'channel.agent_principles_reordered',
        actor,
        target: agent.id,
        detail: { channel: CHANNEL, count: 1 },
      },
      { event: 'channel.agent_principle_deleted', actor, target: made.id, detail: { channel: CHANNEL } },
    ])
    const stored = JSON.stringify(await storedRows(server, 'audit_events'))
    for (const words of ['Secret wording', 'Hidden title', 'hidden rule', 'wiki.example'])
      expect(stored).not.toContain(words)
  })

  it('records a principle taught from a correction by where it came from', async () => {
    await start()
    await startAgent(server, ana)
    const made = await ana.api('POST', PRINCIPLES, {
      topic: 'Refund runbook',
      rule: 'link the refunds page',
      taughtFrom: 'discard',
    })
    expect(made.json.origin).toBe('discard')
    expect(
      (await ana.api('POST', PRINCIPLES, { topic: 'X', rule: 'y z', taughtFrom: 'manual' })).status,
    ).toBe(400)
  })
})

describe('who may teach a channel’s agent', () => {
  it('is only a current manager: never a member of the room, an administrator outside the group or the agent', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const made = (await ana.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the invoice page' }))
      .json
    for (const outsider of [cy, root]) {
      expect((await outsider.api('GET', TEACHING)).status).toBe(403)
      expect((await outsider.api('PUT', TEACHING, { instruction: 'x', sources: [] })).status).toBe(403)
      expect((await outsider.api('POST', PRINCIPLES, { topic: 'Mine', rule: 'do as I say' })).status).toBe(
        403,
      )
      expect((await outsider.api('PATCH', `${PRINCIPLES}/${made.id}`, { enabled: false })).status).toBe(403)
      expect((await outsider.api('PUT', `${PRINCIPLES}/order`, { ids: [made.id] })).status).toBe(403)
      expect((await outsider.api('DELETE', `${PRINCIPLES}/${made.id}`)).status).toBe(403)
    }
    expect((await agent.api('GET', TEACHING)).status).toBe(403)
    expect((await agent.api('PUT', TEACHING, { instruction: 'x', sources: [] })).status).toBe(403)
    expect((await agent.api('POST', PRINCIPLES, { topic: 'Mine', rule: 'do as I say' })).status).toBe(403)
    expect((await agent.api('PATCH', `${PRINCIPLES}/${made.id}`, { enabled: false })).status).toBe(403)
    expect((await agent.api('PUT', `${PRINCIPLES}/order`, { ids: [made.id] })).status).toBe(403)
    expect((await agent.api('DELETE', `${PRINCIPLES}/${made.id}`)).status).toBe(403)
    expect((await agent.api('POST', '/principles', { topic: 'Mine', rule: 'x y', place: null })).status).toBe(
      403,
    )
    expect((await ana.api('GET', TEACHING)).json.principles).toEqual([
      expect.objectContaining({ topic: 'Invoices', enabled: true }),
    ])
  })

  it('follows the managing group: a manager added may teach, one removed may not', async () => {
    await start()
    await startAgent(server, ana)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    expect((await ben.api('GET', TEACHING)).status).toBe(403)
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    expect((await ben.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the page' })).status).toBe(200)
    await ben.api('PUT', `/groups/${group}/members`, { memberIds: [ben.me.member.id] })
    expect((await ana.api('GET', TEACHING)).status).toBe(403)
    expect((await ben.api('GET', TEACHING)).json.principles).toHaveLength(1)
  })

  it('answers 404 without an agent, and when channel agents or teaching are off', async () => {
    await start()
    expect((await ana.api('GET', TEACHING)).status).toBe(404)
    await server.close()
    await start({ HB_FEATURES: 'channelAgents=on,teaching=off' })
    await startAgent(server, ana)
    expect((await ana.api('GET', TEACHING)).status).toBe(404)
    expect((await ana.api('POST', PRINCIPLES, { topic: 'A', rule: 'b c' })).status).toBe(404)
    await server.close()
    await start({ HB_FEATURES: 'channelAgents=off' })
    expect((await ana.api('GET', TEACHING)).status).toBe(404)
  })
})

describe('what a channel’s agent drafts with', () => {
  it('is its channel’s instruction, sources and enabled principles, read by its own credential', async () => {
    await start()
    const agent = await startAgent(server, ana)
    expect((await agent.api('GET', '/principles/drafting')).json).toEqual({
      principles: [],
      leftOut: 0,
      ignored: [],
      ignoredLeftOut: 0,
      channel: { channel: CHANNEL, instruction: '', sources: [] },
    })
    await ana.api('PUT', TEACHING, { instruction: 'Answer briefly.', sources: ['https://wiki.example/p'] })
    await ana.api('POST', PRINCIPLES, { kind: 'answer', topic: 'Refund window', rule: 'Within 14 days.' })
    const off = (await ana.api('POST', PRINCIPLES, { topic: 'Old', rule: 'an old rule to skip' })).json
    await ana.api('PATCH', `${PRINCIPLES}/${off.id}`, { enabled: false })
    await ana.api('POST', '/principles', { topic: 'Ana only', rule: 'a personal rule', place: CHANNEL })
    expect((await agent.api('GET', '/principles/drafting')).json).toEqual({
      principles: [{ kind: 'answer', topic: 'Refund window', rule: 'Within 14 days.', source: null }],
      leftOut: 0,
      ignored: [],
      ignoredLeftOut: 0,
      channel: { channel: CHANNEL, instruction: 'Answer briefly.', sources: ['https://wiki.example/p'] },
    })
  })

  it('is the same for a conversation it answers in, and refused for one it is not in', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await ana.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the invoice page' })
    const { question } = await askAndDraft(cy, agent)
    const here = await agent.api('GET', `/principles/drafting?conversationId=${question.conversationId}`)
    expect(here.json.principles.map((each: any) => each.topic)).toEqual(['Invoices'])
    const outside = (await cy.api('POST', '/conversations', { participantIds: [ben.me.member.id] })).json
    expect((await agent.api('GET', `/principles/drafting?conversationId=${outside.id}`)).status).toBe(400)
  })

  it('never reaches a person’s own agent', async () => {
    await start()
    await startAgent(server, ana)
    await ana.api('PUT', TEACHING, { instruction: 'Answer briefly.', sources: [] })
    await ana.api('POST', PRINCIPLES, { topic: 'Invoices', rule: 'link the invoice page' })
    const anaAgent = await connectAgent(server, ana, { name: 'Ana desk' })
    const drafting = (await anaAgent.api('GET', '/principles/drafting')).json
    expect(drafting).toEqual({ principles: [], leftOut: 0, ignored: [], ignoredLeftOut: 0 })
  })

  it('counts, for each principle, the answers that applied it and those sent as written', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await ana.api('POST', PRINCIPLES, { topic: 'Refund runbook', rule: 'link the refunds page' })
    const asked = (await cy.api('POST', '/drafts', { channel: CHANNEL, body: 'Where are refunds?' })).json
    const question = (await cy.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    const drafted = (
      await agent.api('POST', '/drafts', {
        inReplyTo: question.id,
        body: 'See the refunds page.',
        basis: 'wiki\nPrinciples applied: Refund runbook',
      })
    ).json
    expect((await ana.api('POST', `/drafts/${drafted.id}/send`, { expected: asRead(drafted) })).status).toBe(
      200,
    )
    const [taught] = (await ana.api('GET', TEACHING)).json.principles
    expect(taught.counts).toMatchObject({ applied: 1, sentAsWritten: 1, edited: 0, discarded: 0 })
  })
})
