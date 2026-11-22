import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APPLIED,
  OFFICE_HOURS,
  allowAutoSend,
  directRoom,
  eventsOf,
  savedAnswerFor,
} from './auto-send-support.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent
let room: string

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  await allowAutoSend(ana, true)
  room = await directRoom(ana, ben)
})

afterEach(() => server.close())

const draftToBen = async (body: string, basis: string | undefined = APPLIED) =>
  (
    await anaAgent.api('POST', '/drafts', {
      to: [ben.me.member.id],
      body,
      ...(basis !== undefined && { basis }),
    })
  ).json

describe('sending a saved answer without a click', () => {
  it('delivers it to the recipient and tells the room it was sent, never that a draft waits', async () => {
    await savedAnswerFor(ana, [room])
    const sent = await draftToBen(OFFICE_HOURS.rule)
    expect(sent).toMatchObject({ status: 'sent', autoSent: true, origin: 'agent' })
    expect(sent.receipts.map((receipt: { memberId: string }) => receipt.memberId)).toEqual([ben.me.member.id])
    const drafted = (await eventsOf(ana)).filter(
      (event) => event.body.type === 'draft.saved' && JSON.stringify(event.body).includes(sent.id),
    )
    expect(drafted).toEqual([])
    expect((await eventsOf(ben)).map((event) => event.body.type)).toContain('note.sent')
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
  })

  it('sends a reply in an open channel, where the channel was allowed, delivered to the person who asked', async () => {
    const cy = await server.signIn('cy@example.com', 'Cy')
    const lobby = (await ana.api('PUT', '/channels/lobby/membership', {})).json.conversationId
    await ben.api('PUT', '/channels/lobby/membership', {})
    await cy.api('PUT', '/channels/lobby/membership', { answering: true })
    await savedAnswerFor(ana, [lobby])
    const asked = (await ben.api('POST', '/drafts', { channel: 'lobby', body: 'When is the office open?' }))
      .json
    const question = (
      await ben.api('POST', `/drafts/${asked.id}/send`, {
        expected: { body: asked.body, conversationId: asked.conversationId },
      })
    ).json
    const answer = (
      await anaAgent.api('POST', '/drafts', {
        inReplyTo: question.id,
        body: OFFICE_HOURS.rule,
        basis: APPLIED,
      })
    ).json
    expect(answer).toMatchObject({ status: 'sent', conversationId: lobby, autoSent: true })
    expect(answer.receipts.map((receipt: { memberId: string }) => receipt.memberId)).toEqual([
      ben.me.member.id,
    ])
  })

  it('leaves a draft written by the person, a rule and a switched-off answer on the approval card', async () => {
    const saved = await savedAnswerFor(ana, [room])
    const own = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: OFFICE_HOURS.rule })).json
    expect(own.status).toBe('draft')
    await ana.api('PUT', `/principles/${saved.id}/auto-send`, { enabled: false, places: [room] })
    expect((await draftToBen(OFFICE_HOURS.rule)).status).toBe('draft')
    await ana.api('PUT', `/principles/${saved.id}/auto-send`, { enabled: true, places: [room] })
    await ana.api('PATCH', `/principles/${saved.id}`, { enabled: false })
    expect((await draftToBen(OFFICE_HOURS.rule)).status).toBe('draft')
  })

  it('stops when the answer becomes a rule or is deleted, and starts again only when its person switches it on', async () => {
    const saved = await savedAnswerFor(ana, [room])
    await ana.api('PATCH', `/principles/${saved.id}`, { kind: 'rule' })
    expect((await draftToBen(OFFICE_HOURS.rule)).status).toBe('draft')
    await ana.api('PATCH', `/principles/${saved.id}`, { kind: 'answer' })
    expect((await draftToBen(OFFICE_HOURS.rule)).status).toBe('draft')
    expect((await ana.api('GET', '/principles')).json.principles[0].autoSend).toEqual({
      enabled: false,
      places: [],
    })
    await ana.api('DELETE', `/principles/${saved.id}`)
    expect(await storedRows(server, 'principle_auto_send_places')).toEqual([])
  })

  it('stops sending to a conversation the person may no longer message', async () => {
    await savedAnswerFor(ana, [room])
    const draft = await draftToBen('Let me check the hours.')
    await ben.api('PUT', `/blocks/${ana.me.member.id}`)
    const changed = (await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: OFFICE_HOURS.rule })).json
    expect(changed.status).toBe('draft')
    expect((await ben.api('GET', `/notes/${draft.id}`)).status).toBe(404)
  })

  it('counts each automatic send apart: never as a decided draft, a quick approval or a decision time', async () => {
    const saved = await savedAnswerFor(ana, [room])
    await draftToBen(OFFICE_HOURS.rule)
    await draftToBen(OFFICE_HOURS.rule)
    const week = (await ana.api('GET', '/insights/me')).json.periods[0].current
    expect(week).toMatchObject({
      autoSent: 2,
      written: 0,
      sentAsWritten: 0,
      quickApprovals: 0,
      medianDecisionMs: null,
    })
    const principle = (await ana.api('GET', '/principles')).json.principles.find(
      (each: { id: string }) => each.id === saved.id,
    )
    expect(principle.counts).toMatchObject({ applied: 2, sentAsWritten: 0, autoSent: 2 })
    expect((await ana.api('GET', '/admin/insights')).json.periods[0].current.autoSent).toBe(2)
  })

  it('shows neither the switch nor the count while the organization has automatic sending off', async () => {
    await savedAnswerFor(ana, [room])
    await draftToBen(OFFICE_HOURS.rule)
    await allowAutoSend(ana, false)
    const [principle] = (await ana.api('GET', '/principles')).json.principles
    expect(principle.autoSend).toBeUndefined()
    expect(principle.counts.autoSent).toBeUndefined()
  })
})
