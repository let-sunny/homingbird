import { afterEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, askAndDraft, startAgent, startWithChannel } from './channel-agent-support.ts'
import type { Agent, Session, TestServer } from './harness.ts'

let server: TestServer
let root: Session
let ana: Session
let ben: Session
let cy: Session

const start = async (overrides: Readonly<Record<string, string>> = {}) => {
  ;({ server, root, ana, ben, cy } = await startWithChannel(overrides))
}

afterEach(async () => {
  await server.close()
})

const DECISIONS = `/channels/${CHANNEL}/agent/decisions`
const DAY_MS = 24 * 60 * 60_000

const decisionsOf = async (person: Session) => (await person.api('GET', DECISIONS)).json.decisions

const managedBy = async (manager: Session, members: ReadonlyArray<Session>) => {
  const group = (await manager.api('GET', `/channels/${CHANNEL}`)).json.managedBy
  await manager.api('PUT', `/groups/${group}/members`, {
    memberIds: members.map((member) => member.me.member.id),
  })
}

const sendAsWritten = (manager: Session, draft: any) =>
  manager.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })

describe('a channel’s recent decisions', () => {
  it('lists each answer sent as written, sent after an edit or discarded, newest first, with who and when', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const first = await askAndDraft(cy, agent, 'Where is the refund runbook?', 'In the wiki under Refunds.')
    await sendAsWritten(ana, first.draft)
    await server.clock.advance(60_000)
    const second = await askAndDraft(cy, agent, 'Can I refund twice?', 'Yes, refunds are automatic.')
    await ana.api('POST', `/drafts/${second.draft.id}/send`, {
      body: 'Duplicate refunds over 200 EUR need Ana.',
      expected: asRead(second.draft),
    })
    await server.clock.advance(60_000)
    const third = await askAndDraft(cy, agent, 'Who approves credits?', 'Nobody, credits are free.')
    await ana.api('POST', `/drafts/${third.draft.id}/discard`, { reason: '  Wrong: policy changed.  ' })

    const listed = (await ana.api('GET', DECISIONS)).json
    expect(listed).toMatchObject({ channel: CHANNEL, days: 30 })
    expect(listed.decisions).toEqual([
      {
        noteId: third.draft.id,
        conversationId: third.question.conversationId,
        privately: false,
        outcome: 'discarded',
        decidedBy: ana.me.member.id,
        decidedAt: expect.any(Number),
        question: { id: third.question.id, authorId: cy.me.member.id, body: 'Who approves credits?' },
        answer: 'Nobody, credits are free.',
        agentAnswer: null,
        reason: 'Wrong: policy changed.',
        principles: [],
      },
      expect.objectContaining({
        noteId: second.draft.id,
        outcome: 'sent_edited',
        decidedBy: ana.me.member.id,
        answer: 'Duplicate refunds over 200 EUR need Ana.',
        agentAnswer: 'Yes, refunds are automatic.',
        reason: null,
      }),
      expect.objectContaining({
        noteId: first.draft.id,
        outcome: 'sent_as_written',
        answer: 'In the wiki under Refunds.',
        agentAnswer: null,
      }),
    ])
    expect(listed.decisions[0].decidedAt).toBeGreaterThan(listed.decisions[1].decidedAt)
  })

  it('leaves out the answers still waiting and those older than thirty days', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const old = await askAndDraft(cy, agent, 'Old question?', 'Old answer.')
    await sendAsWritten(ana, old.draft)
    expect(await decisionsOf(ana)).toHaveLength(1)
    await server.clock.advance(31 * DAY_MS)
    ana = await server.signIn('ana@example.com', 'Ana')
    cy = await server.signIn('cy@example.com', 'Cy')
    await askAndDraft(cy, agent, 'Still waiting?', 'Waiting answer.')
    expect(await decisionsOf(ana)).toEqual([])
  })

  it('names the principles an answer said it applied, and none while teaching is off', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await ana.api('POST', `/channels/${CHANNEL}/agent/principles`, {
      topic: 'Refund runbook',
      rule: 'link the refunds page',
    })
    const asked = (await cy.api('POST', '/drafts', { channel: CHANNEL, body: 'Where are refunds?' })).json
    const question = (await cy.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    const drafted = (
      await agent.api('POST', '/drafts', {
        inReplyTo: question.id,
        body: 'See the refunds page.',
        basis: 'wiki\nPrinciples applied: Refund runbook',
      })
    ).json
    await sendAsWritten(ana, drafted)
    const [decision] = await decisionsOf(ana)
    expect(decision.principles).toEqual([{ id: expect.stringMatching(/^prin_/), topic: 'Refund runbook' }])
    const settings = (await root.api('GET', '/admin/settings')).json
    await root.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, teaching: false },
    })
    expect((await decisionsOf(ana))[0].principles).toEqual([])
  })

  it('marks an answer to a private question, and shows it to every manager but the asker', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await managedBy(ana, [ana, ben])
    const room = (await cy.api('POST', `/channels/${CHANNEL}/private-question`)).json
    const asked = (await cy.api('POST', '/drafts', { conversationId: room.id, body: 'Private refund?' })).json
    const question = (await cy.api('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
    const drafted = (await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Yes.' })).json
    await ana.api('POST', `/drafts/${drafted.id}/discard`, {})
    expect(await decisionsOf(ben)).toEqual([
      expect.objectContaining({
        privately: true,
        outcome: 'discarded',
        reason: null,
        decidedBy: ana.me.member.id,
      }),
    ])
  })
})

describe('who sees a channel’s recent decisions', () => {
  const decideOne = async (agent: Agent, asker: Session, decider: Session) => {
    const { draft } = await askAndDraft(asker, agent)
    await sendAsWritten(decider, draft)
  }

  it('is a current manager only: never a member of the room, an administrator outside the group or the agent', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await decideOne(agent, cy, ana)
    expect(await decisionsOf(ana)).toHaveLength(1)
    for (const outsider of [cy, root]) expect((await outsider.api('GET', DECISIONS)).status).toBe(404)
    expect((await agent.api('GET', DECISIONS)).status).toBe(403)
  })

  it('follows the managing group: a manager added sees them, one removed does not', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await decideOne(agent, cy, ana)
    expect((await ben.api('GET', DECISIONS)).status).toBe(404)
    await managedBy(ana, [ana, ben])
    expect(await decisionsOf(ben)).toHaveLength(1)
    await managedBy(ben, [ben])
    expect((await ana.api('GET', DECISIONS)).status).toBe(404)
  })

  it('leaves out, for a manager who asked, every decision on their question', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await managedBy(ana, [ana, ben])
    const { draft } = await askAndDraft(ben, agent, 'Ben asks?', 'An answer Ben never sees.')
    await ana.api('POST', `/drafts/${draft.id}/send`, { body: 'Edited.', expected: asRead(draft) })
    expect(await decisionsOf(ben)).toEqual([])
    expect(await decisionsOf(ana)).toEqual([
      expect.objectContaining({ agentAnswer: 'An answer Ben never sees.' }),
    ])
  })

  it('answers 404 while channel agents are off', async () => {
    await start({ HB_FEATURES: 'channelAgents=off' })
    expect((await ana.api('GET', DECISIONS)).status).toBe(404)
  })
})
