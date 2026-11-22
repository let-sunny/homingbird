import type { MemberId } from '@homingbird/protocol'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ChannelAgentActivity,
  type ReviewedDraft,
  channelAgentReportOf,
  channelAgentTotalsIn,
} from '../src/domain/channel-agent-figures.ts'
import { DAY_MS, periodEndingAt } from '../src/domain/trust-figures.ts'
import { CHANNEL, asRead, askAndDraft, startAgent, startWithChannel } from './channel-agent-support.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  storeChannelAsPrivate,
  storedRows,
} from './harness.ts'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60_000
const lastWeek = periodEndingAt(NOW, 7, 0)
const SETTINGS = { quickApprovalSeconds: 3, minimumGroupSize: 3 }

let answers = 0

const answer = (
  outcome: ReviewedDraft['outcome'],
  approvedBy: string | null,
  { hoursAgo = 1, seconds = 30 }: { readonly hoursAgo?: number; readonly seconds?: number } = {},
): ReviewedDraft => ({
  id: `note_${++answers}`,
  place: 'payments-wiki',
  createdAt: NOW - (hoursAgo + 1) * HOUR,
  seenAt: NOW - hoursAgo * HOUR - seconds * 1000,
  decidedAt: outcome === null ? null : NOW - hoursAgo * HOUR,
  outcome,
  approvedBy,
})

const managers = [
  { id: 'mem_zoe' as MemberId, name: 'Zoe' },
  { id: 'mem_ana' as MemberId, name: 'Ana' },
  { id: 'mem_bea' as MemberId, name: 'bea' },
]

const activity = (drafts: ReadonlyArray<ReviewedDraft>, waiting = 0): ChannelAgentActivity => ({
  drafts,
  waiting,
  managers,
})

describe('channelAgentReportOf', () => {
  it('counts the agent’s answers by how they were decided, beside the period before', () => {
    const report = channelAgentReportOf(
      'payments-wiki',
      activity(
        [
          answer('as_written', 'mem_ana'),
          answer('edited', 'mem_zoe'),
          answer('discarded', null),
          answer(null, null),
          answer('as_written', 'mem_ana', { hoursAgo: 8 * 24 }),
        ],
        1,
      ),
      NOW,
      SETTINGS,
    )
    expect(report).toMatchObject({
      minimumGroupSize: 3,
      generatedAt: NOW,
      channel: 'payments-wiki',
      quickApprovalSeconds: 3,
      waiting: 1,
    })
    expect(report.periods.map((period) => period.days)).toEqual([7, 30])
    expect(report.periods[0]!.current).toMatchObject({
      written: 4,
      sentAsWritten: 1,
      sentAfterEdits: 1,
      discarded: 1,
      medianDecisionMs: 30_000,
      quickApprovals: 0,
    })
    expect(report.periods[0]!.previous).toMatchObject({ written: 1, sentAsWritten: 1, discarded: 0 })
    expect(report.periods[1]!.current.sentAsWritten).toBe(2)
  })

  it('lists every manager alphabetically with a count only, those who sent none included', () => {
    const report = channelAgentReportOf(
      'payments-wiki',
      activity([
        answer('as_written', 'mem_zoe'),
        answer('as_written', 'mem_zoe'),
        answer('edited', 'mem_zoe'),
        answer('as_written', 'mem_ana'),
        answer('as_written', 'mem_gone'),
      ]),
      NOW,
      SETTINGS,
    )
    expect(report.periods[0]!.current.approvals).toEqual([
      { memberId: 'mem_ana', name: 'Ana', approved: 1 },
      { memberId: 'mem_bea', name: 'bea', approved: 0 },
      { memberId: 'mem_zoe', name: 'Zoe', approved: 3 },
    ])
    expect(report.periods[0]!.current.approvedByFormerManagers).toBe(1)
  })

  it('orders managers who share a name by their id', () => {
    const twins = [
      { id: 'mem_b' as MemberId, name: 'Kim' },
      { id: 'mem_a' as MemberId, name: 'Kim' },
    ]
    const report = channelAgentReportOf(
      'wiki',
      { drafts: [answer('as_written', 'mem_a'), answer('as_written', 'mem_b')], waiting: 0, managers: twins },
      NOW,
      { ...SETTINGS, minimumGroupSize: 2 },
    )
    expect(report.periods[0]!.current.approvals!.map((manager) => manager.memberId)).toEqual([
      'mem_a',
      'mem_b',
    ])
  })

  it('counts an answer sent within the quick-approval seconds as quick, and times only answers someone saw', () => {
    const unseen = { ...answer('as_written', 'mem_ana'), seenAt: null }
    const report = channelAgentReportOf(
      'payments-wiki',
      activity([
        answer('as_written', 'mem_ana', { seconds: 2 }),
        answer('edited', 'mem_ana', { seconds: 2 }),
        unseen,
      ]),
      NOW,
      SETTINGS,
    )
    expect(report.periods[0]!.current.quickApprovals).toBe(1)
    expect(report.periods[0]!.current.medianDecisionMs).toBe(2_000)
  })

  it('shows no typical decision time before any answer was decided', () => {
    expect(
      channelAgentReportOf('wiki', activity([answer(null, null)]), NOW, SETTINGS).periods[0]!.current
        .medianDecisionMs,
    ).toBeNull()
  })
})

describe('channelAgentReportOf in a small group', () => {
  it('shows each manager’s count only while that many people sent an answer in the period, however many manage it', () => {
    const drafts = [answer('as_written', 'mem_ana'), answer('edited', 'mem_zoe')]
    const small = channelAgentReportOf('wiki', activity(drafts), NOW, SETTINGS)
    expect(small.periods[0]!.current).toMatchObject({ approvals: null, sentAsWritten: 1, sentAfterEdits: 1 })
    expect(small.minimumGroupSize).toBe(3)
    const busier = [...drafts, answer('as_written', 'mem_bea')]
    const large = channelAgentReportOf('wiki', activity(busier), NOW, SETTINGS)
    expect(large.periods[0]!.current.approvals).toHaveLength(3)
    const old = [...drafts, answer('as_written', 'mem_bea', { hoursAgo: 8 * 24 })]
    expect(
      channelAgentReportOf('wiki', activity(old), NOW, SETTINGS).periods[0]!.current.approvals,
    ).toBeNull()
  })

  it('shows what people who no longer manage the channel sent as one total, even while each count is hidden', () => {
    const drafts = [answer('as_written', 'mem_ana'), answer('edited', 'mem_left'), answer('discarded', null)]
    const report = channelAgentReportOf('wiki', activity(drafts), NOW, { ...SETTINGS, minimumGroupSize: 5 })
    expect(report.periods[0]!.current).toMatchObject({ approvals: null, approvedByFormerManagers: 1 })
  })
})

describe('channelAgentTotalsIn', () => {
  const sentBy = (count: number) =>
    Array.from({ length: count }, (_, index) => answer('as_written', `mem_${index}`))

  it('gives every channel agent’s answers together once enough managers sent one', () => {
    expect(
      channelAgentTotalsIn([...sentBy(5), answer('discarded', null), answer(null, null)], [], lastWeek, 5),
    ).toEqual({
      written: 7,
      sentAsWritten: 5,
      sentAfterEdits: 0,
      discarded: 1,
    })
  })

  it('hides the totals while fewer managers than the minimum sent one, however many answers there were', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 20 }), (people, discards) => {
        const drafts = [
          ...sentBy(people),
          ...sentBy(people),
          ...Array.from({ length: discards }, () => answer('discarded', null)),
        ]
        expect(channelAgentTotalsIn(drafts, [], lastWeek, 5)).toBeNull()
      }),
    )
  })

  it('hides the totals when the organization’s other decisions, which subtracting them would give, have too few people', () => {
    const answers = sentBy(5)
    const ownDecisions = (people: number, unknown = 0) => [
      ...answers.map((draft) => ({ id: draft.id, authorId: draft.approvedBy })),
      ...Array.from({ length: people }, (_, index) => ({ id: `own${index}`, authorId: `mem_own${index}` })),
      ...Array.from({ length: unknown }, (_, index) => ({ id: `gone${index}`, authorId: null })),
    ]
    expect(channelAgentTotalsIn(answers, ownDecisions(0), lastWeek, 5)).not.toBeNull()
    expect(channelAgentTotalsIn(answers, ownDecisions(2), lastWeek, 5)).toBeNull()
    expect(channelAgentTotalsIn(answers, ownDecisions(0, 3), lastWeek, 5)).toBeNull()
    expect(channelAgentTotalsIn(answers, ownDecisions(5), lastWeek, 5)).not.toBeNull()
  })

  it('never lets the organization’s decisions minus the totals give fewer than the minimum of people', () => {
    const person = fc.constantFrom(...Array.from({ length: 9 }, (_, index) => `mem_${index}`), null)
    fc.assert(
      fc.property(
        fc.array(person, { maxLength: 12 }),
        fc.array(person, { maxLength: 12 }),
        fc.integer({ min: 2, max: 6 }),
        (approvers, others, minimum) => {
          const drafts = approvers.map((approvedBy) =>
            answer(approvedBy === null ? 'discarded' : 'as_written', approvedBy),
          )
          const organization = [
            ...drafts.map((draft) => ({ id: draft.id, authorId: draft.approvedBy })),
            ...others.map((authorId, index) => ({ id: `own${index}`, authorId })),
          ]
          const totals = channelAgentTotalsIn(drafts, organization, lastWeek, minimum)
          if (totals === null) return
          const known = (ids: ReadonlyArray<string | null>) => new Set(ids.filter((id) => id !== null)).size
          expect(known(approvers)).toBeGreaterThanOrEqual(minimum)
          if (others.length > 0) expect(known(others)).toBeGreaterThanOrEqual(minimum)
        },
      ),
    )
  })

  it('counts only the approvals decided in the period', () => {
    const old = Array.from({ length: 5 }, (_, index) =>
      answer('as_written', `mem_${index}`, { hoursAgo: 8 * 24 }),
    )
    expect(channelAgentTotalsIn(old, [], lastWeek, 5)).toBeNull()
    expect(channelAgentTotalsIn(old, [], periodEndingAt(NOW, 7, 1), 5)).toMatchObject({ sentAsWritten: 5 })
    expect(DAY_MS).toBe(24 * HOUR)
  })
})

describe('channels.agent.figures', () => {
  let server: TestServer
  let root: Session
  let ana: Session
  let ben: Session
  let cy: Session
  let agent: Agent & { readonly id: string }

  afterEach(async () => {
    await server?.close()
  })

  const FIVE = { HB_INSIGHTS_MINIMUM_GROUP: '5' }

  const start = async (overrides: Readonly<Record<string, string>> = {}) => {
    ;({ server, root, ana, ben, cy } = await startWithChannel(overrides))
    agent = await startAgent(server, ana)
  }

  const addManagers = async (...people: ReadonlyArray<Session>) => {
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    const members = (await ana.api('GET', `/groups/${group}`)).json.memberIds
    await ana.api('PUT', `/groups/${group}/members`, {
      memberIds: [...members, ...people.map((person) => person.me.member.id)],
    })
  }

  const figures = (person: Session | Agent) => person.api('GET', `/channels/${CHANNEL}/agent/figures`)

  it('shows the channel’s managers how its agent is doing, with no one’s count while they are fewer than the minimum', async () => {
    await start(FIVE)
    await addManagers(ben)
    const first = await askAndDraft(cy, agent, 'One?', 'One.')
    await server.clock.advance(1_000)
    await ben.api('POST', `/drafts/${first.draft.id}/send`, { expected: asRead(first.draft) })
    const second = await askAndDraft(cy, agent, 'Two?', 'Two.')
    await ana.api('POST', `/drafts/${second.draft.id}/send`, {
      body: 'Two, edited.',
      expected: asRead(second.draft),
    })
    const third = await askAndDraft(cy, agent, 'Three?', 'Three.')
    await ana.api('POST', `/drafts/${third.draft.id}/discard`)
    await askAndDraft(cy, agent, 'Four?', 'Four.')
    const report = (await figures(ana)).json
    expect(report).toMatchObject({ channel: CHANNEL, waiting: 1 })
    expect(report.periods[0].current).toMatchObject({
      written: 4,
      sentAsWritten: 1,
      sentAfterEdits: 1,
      discarded: 1,
    })
    expect(report.periods[0].current.approvals).toBeNull()
    expect(report.minimumGroupSize).toBe(5)
    expect((await figures(ben)).status).toBe(200)
  })

  it('shows each manager’s count and the administrators’ totals for a single manager by default', async () => {
    await start()
    const { draft } = await askAndDraft(cy, agent)
    await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    const report = (await figures(ana)).json
    expect(report.minimumGroupSize).toBe(1)
    expect(report.periods[0].current.approvals).toEqual([
      { memberId: ana.me.member.id, name: 'Ana', approved: 1 },
    ])
    const organization = (await root.api('GET', '/admin/insights')).json.periods[0].current
    expect(organization.channelAgents).toEqual({
      written: 1,
      sentAsWritten: 1,
      sentAfterEdits: 0,
      discarded: 0,
    })
    expect(JSON.stringify(organization)).not.toContain(ana.me.member.id)
  })

  it('answers as for nothing to a member who does not manage the channel and to an administrator outside its group', async () => {
    await start()
    await askAndDraft(cy, agent)
    expect((await figures(cy)).status).toBe(404)
    expect((await figures(root)).status).toBe(404)
    await storeChannelAsPrivate(server, CHANNEL)
    expect((await figures(root)).status).toBe(404)
    expect((await figures(cy)).status).toBe(404)
    expect((await root.api('GET', '/channels/nowhere/agent/figures')).status).toBe(404)
  })

  it('refuses every agent credential, the channel’s own agent and a manager’s own agent alike', async () => {
    await start()
    const own = await connectAgent(server, ana, { name: 'Ana agent' })
    expect((await figures(agent)).status).toBe(403)
    expect((await figures(own)).status).toBe(403)
  })

  it('times a decision from when the answer first appeared on a manager’s screen', async () => {
    await start()
    const { draft } = await askAndDraft(cy, agent)
    expect((await cy.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(404)
    expect((await ana.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(200)
    await server.clock.advance(4_000)
    await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    const report = (await figures(ana)).json
    expect(report.periods[0].current.medianDecisionMs).toBe(4_000)
    const row = (await storedRows(server, 'notes')).find((note) => note.id === draft.id)!
    expect(row.seen_at).not.toBeNull()
  })

  it('counts a manager’s approvals in their week, apart from their notes and their own agent’s figures', async () => {
    await start()
    const own = await connectAgent(server, ana, { name: 'Ana agent' })
    const { draft } = await askAndDraft(cy, agent)
    await ana.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    const mine = (await ana.api('GET', '/insights/me')).json
    expect(mine.week.current).toMatchObject({ notesSent: 0, approvedForChannels: 1 })
    expect(mine.periods[0].current).toMatchObject({ written: 0, sentAsWritten: 0, quickApprovals: 0 })
    expect(own.token).toBeTruthy()
  })

  it('gives administrators every channel agent’s answers together, never those of a private channel they are not in', async () => {
    const managers = await (async () => {
      await start(FIVE)
      const more: Session[] = []
      for (const name of ['Dee', 'Eve', 'Fay', 'Gus'])
        more.push(await server.signIn(`${name.toLowerCase()}@example.com`, name))
      for (const person of more) await person.api('PUT', `/channels/${CHANNEL}/membership`, {})
      await addManagers(ben, ...more)
      return [ana, ben, ...more]
    })()
    for (const manager of managers) {
      const { draft } = await askAndDraft(cy, agent, `Question for ${manager.me.member.name}?`, 'Answer.')
      await manager.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })
    }
    const approvals = (await ana.api('GET', `/channels/${CHANNEL}/agent/figures`)).json.periods[0].current
      .approvals
    expect(approvals.map((manager: any) => [manager.name, manager.approved])).toEqual(
      ['Ana', 'Ben', 'Dee', 'Eve', 'Fay', 'Gus'].map((name) => [name, 1]),
    )
    const organization = async () => (await root.api('GET', '/admin/insights')).json.periods[0].current
    expect((await organization()).channelAgents).toEqual({
      written: 6,
      sentAsWritten: 6,
      sentAfterEdits: 0,
      discarded: 0,
    })
    expect((await organization()).activeMembers).toBe(7)
    await storeChannelAsPrivate(server, CHANNEL)
    expect((await organization()).channelAgents).toBeNull()
  })
})
