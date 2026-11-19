import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DRAFT_REQUEST_LIFETIME_MS } from '../src/domain/draft-requests.ts'
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

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

const agentDraft = async (agent: Agent, to: Session, body = 'A draft') =>
  (await agent.api('POST', '/drafts', { to: [to.me.member.id], body })).json

const thisWeek = async (person: Session) => (await person.api('GET', '/insights/me')).json.periods[0].current

const noteRow = async (id: string) => (await storedRows(server, 'notes')).find((row) => row.id === id)!

describe('drafts.seen', () => {
  it('records when its person first saw a draft, and changes nothing when called again', async () => {
    const draft = await agentDraft(anaAgent, ben)
    const firstSeen = server.clock.now()
    expect((await ana.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(200)
    await server.clock.advance(5_000)
    expect((await ana.api('POST', `/drafts/${draft.id}/seen`)).json).toEqual({})
    expect(Number((await noteRow(draft.id)).seen_at)).toBe(firstSeen)
  })

  it('answers as for a draft that does not exist to anyone but its author, and refuses an agent', async () => {
    const draft = await agentDraft(anaAgent, ben)
    expect((await ben.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(404)
    expect((await anaAgent.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(403)
    expect((await noteRow(draft.id)).seen_at).toBeNull()
  })

  it('leaves a sent note as it was', async () => {
    const draft = await agentDraft(anaAgent, ben)
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    expect((await ana.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(200)
    expect((await noteRow(draft.id)).seen_at).toBeNull()
  })
})

describe('insights.mine', () => {
  it('counts what happened to each draft the agent wrote, and only what its person decided', async () => {
    const unchanged = await agentDraft(anaAgent, ben, 'as written')
    const edited = await agentDraft(anaAgent, ben, 'to edit')
    const thrownAway = await agentDraft(anaAgent, ben, 'to discard')
    await agentDraft(anaAgent, ben, 'still waiting')
    await ana.api('POST', `/drafts/${unchanged.id}/send`, {})
    await ana.api('POST', `/drafts/${edited.id}/send`, { body: 'edited by Ana' })
    await ana.api('POST', `/drafts/${thrownAway.id}/discard`)
    const question = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'Question?' })).json
    await ben.api('POST', `/drafts/${question.id}/send`, {})
    const chosen = (await anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Answer one' }))
      .json
    await anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Answer two' })
    await ana.api('POST', `/drafts/${chosen.id}/send`, {})
    expect(await thisWeek(ana)).toMatchObject({
      written: 6,
      sentAsWritten: 2,
      sentAfterEdits: 1,
      discarded: 1,
      verdict: 'too_few',
      places: [{ place: null, written: 6, sentAsWritten: 2, sentAfterEdits: 1, discarded: 1 }],
    })
  })

  it('counts the notes a person wrote themself apart from their agent’s drafts', async () => {
    const own = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'by hand' })).json
    await ana.api('POST', `/drafts/${own.id}/send`, {})
    expect(await thisWeek(ana)).toMatchObject({ written: 0, sentAsWritten: 0, wroteYourself: 1 })
  })

  it('measures the time from shown to decided and counts a quick approval', async () => {
    const quick = await agentDraft(anaAgent, ben, 'quick')
    const careful = await agentDraft(anaAgent, ben, 'careful')
    await ana.api('POST', `/drafts/${quick.id}/seen`)
    await ana.api('POST', `/drafts/${careful.id}/seen`)
    await server.clock.advance(2_000)
    await ana.api('POST', `/drafts/${quick.id}/send`, {})
    await server.clock.advance(58_000)
    await ana.api('POST', `/drafts/${careful.id}/send`, {})
    expect(await thisWeek(ana)).toMatchObject({ quickApprovals: 1, medianDecisionMs: 31_000 })
  })

  it('takes the quick-approval seconds from the setting', async () => {
    const draft = await agentDraft(anaAgent, ben)
    await ana.api('POST', `/drafts/${draft.id}/seen`)
    await server.clock.advance(4_000)
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    const request = server.requestWithSettings({ HB_QUICK_APPROVAL_SECONDS: '5' })
    const report = (await request('GET', '/api/v1/insights/me', { cookie: ana.cookie })).json
    expect(report.quickApprovalSeconds).toBe(5)
    expect(report.periods[0].current.quickApprovals).toBe(1)
    expect((await thisWeek(ana)).quickApprovals).toBe(0)
  })

  it('counts the notes the agent skipped with their reasons, but not a person’s own release', async () => {
    const first = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'One' })).json
    const second = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'Two' })).json
    await ben.api('POST', `/drafts/${first.id}/send`, {})
    await ben.api('POST', `/drafts/${second.id}/send`, {})
    await anaAgent.api('POST', `/notes/${first.id}/release`, { reason: 'Needs the release plan' })
    await anaAgent.api('POST', `/notes/${first.id}/release`, { reason: 'Asked again' })
    await server.clock.advance(1_000)
    await anaAgent.api('POST', `/notes/${second.id}/release`, { reason: ' needs the release plan' })
    await ana.api('POST', `/notes/${second.id}/release`, {})
    expect(await thisWeek(ana)).toMatchObject({
      skipped: 2,
      skipReasons: [{ reason: 'Needs the release plan', count: 2 }],
    })
  })

  it('counts a draft request that expired without any draft', async () => {
    const conversation = (await agentDraft(anaAgent, ben)).conversationId
    await ana.api('POST', '/draft-requests', { conversationId: conversation, instruction: 'Say hello' })
    const answered = (await ana.api('POST', '/draft-requests', { conversationId: conversation })).json
    await anaAgent.api('POST', '/drafts', { requestId: answered.id, body: 'Hello' })
    await server.clock.advance(DRAFT_REQUEST_LIFETIME_MS + 1)
    expect((await thisWeek(ana)).expiredRequests).toBe(1)
  })

  it('names the channel of each draft and keeps the name after the channel is archived', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })
    const question = (await anaAgent.api('POST', '/drafts', { channel: 'billing', body: 'Who invoices?' }))
      .json
    await ana.api('POST', `/drafts/${question.id}/send`, {})
    await agentDraft(anaAgent, ben)
    const places = async () =>
      (await thisWeek(ana)).places.map((place: { place: string | null }) => place.place)
    expect(await places()).toEqual(['billing', null])
    await ana.api('POST', '/admin/channels/billing/archive', {})
    expect(await places()).toEqual(['billing', null])
  })

  it('shows each person only their own agent', async () => {
    const draft = await agentDraft(anaAgent, ben)
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    expect((await thisWeek(ben)).sentAsWritten).toBe(0)
    expect((await thisWeek(ana)).sentAsWritten).toBe(1)
  })
})

describe('admin.insights', () => {
  const team = async (count: number): Promise<Session[]> => {
    const people: Session[] = [ana, ben]
    for (let index = people.length; index < count; index++)
      people.push(await server.signIn(`person${index}@example.com`, `Person ${index}`))
    return people
  }

  const sendBetween = async (author: Session, to: Session, body: string) => {
    const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
    return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
  }

  it('is for administrators only', async () => {
    expect((await ben.api('GET', '/admin/insights')).status).toBe(403)
    expect((await anaAgent.api('GET', '/admin/insights')).status).toBe(403)
  })

  it('shows no figures while fewer than five people were active, and no block count for a small organization', async () => {
    const people = await team(4)
    for (const person of people) await sendBetween(person, people[0] === person ? ben : ana, 'hello')
    const insights = (await ana.api('GET', '/admin/insights')).json
    expect(insights.periods[0]).toEqual({ days: 7, current: null, previous: null })
    expect(insights.blocks).toBeNull()
    expect(insights.minimumGroupSize).toBe(5)
  })

  it('shows organization-wide totals once five people were active, and hides one person’s draft decisions, with no member id, name or email', async () => {
    const people = await team(6)
    await ben.api('PUT', `/blocks/${people[5]!.me.member.id}`)
    for (const person of people.slice(0, 5)) await sendBetween(person, person === ana ? ben : ana, 'hello')
    const draft = await agentDraft(anaAgent, ben, 'Agent text')
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    const insights = (await ana.api('GET', '/admin/insights')).json
    expect(insights.blocks).toBe(1)
    expect(insights.periods[0].current).toMatchObject({
      activeMembers: 5,
      notesSent: 6,
      agentDraftsWritten: 1,
      sentAsWritten: null,
      sentAfterEdits: null,
      discarded: null,
      quickApprovals: null,
      places: [{ place: null, notesSent: 6, sentAsWritten: null, sentAfterEdits: null, discarded: null }],
      hiddenPlaces: 0,
    })
    const text = JSON.stringify(insights)
    for (const person of people) {
      expect(text).not.toContain(person.me.member.id)
      expect(text).not.toContain(person.me.member.name)
      expect(text).not.toContain(person.me.member.email)
    }
    expect(text).not.toContain('Agent text')
  })

  it('leaves out a channel that fewer than five people used, and the smallest other group with it', async () => {
    const people = await team(6)
    await ana.api('POST', '/channels', { slug: 'payroll', description: 'Pay' })
    for (const person of people.slice(0, 5)) await sendBetween(person, person === ana ? ben : ana, 'hello')
    const asked = (await ben.api('POST', '/drafts', { channel: 'payroll', body: 'When is pay day?' })).json
    await ben.api('POST', `/drafts/${asked.id}/send`, {})
    const figures = (await ana.api('GET', '/admin/insights')).json.periods[0].current
    expect(figures.notesSent).toBe(6)
    expect(figures.places).toEqual([])
    expect(figures.hiddenPlaces).toBe(2)
    expect(JSON.stringify(figures)).not.toContain('payroll')
  })

  it('raises the minimum group size from the setting', async () => {
    const people = await team(5)
    for (const person of people) await sendBetween(person, person === ana ? ben : ana, 'hello')
    const request = server.requestWithSettings({ HB_INSIGHTS_MINIMUM_GROUP: '6' })
    const insights = (await request('GET', '/api/v1/admin/insights', { cookie: ana.cookie })).json
    expect(insights.minimumGroupSize).toBe(6)
    expect(insights.periods[0].current).toBeNull()
    expect((await ana.api('GET', '/admin/insights')).json.periods[0].current.activeMembers).toBe(5)
  })
})

describe('session health', () => {
  it('records the desk session with each agent draft for its author alone, never for the recipient', async () => {
    const draft = (
      await anaAgent.api('POST', '/drafts', {
        to: [ben.me.member.id],
        body: 'Session check',
        session: { ageMinutes: 500, contextPercent: 85 },
      })
    ).json
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    const report = (await ana.api('GET', '/insights/me')).json
    expect(
      report.sessions.byAge.find((bucket: { bucket: string }) => bucket.bucket === 'half_day').decided,
    ).toBe(1)
    expect(report.sessions.latest).toEqual([
      { agentName: 'Ana agent', ageMinutes: 500, contextPercent: 85, at: draft.createdAt },
    ])
    const received = JSON.stringify((await ben.api('GET', `/notes/${draft.id}`)).json)
    expect(received).not.toMatch(/ageMinutes|contextPercent|session/)
    expect(JSON.stringify((await ben.api('GET', '/insights/me')).json.sessions.latest)).toBe('[]')
  })

  it('refuses a session that is not a whole number of minutes and a percentage', async () => {
    for (const session of [
      { ageMinutes: -1 },
      { ageMinutes: 1, contextPercent: 120 },
      { ageMinutes: 'long' },
    ])
      expect(
        (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'x', session })).status,
      ).toBe(400)
  })
})
