import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, castOf, decide, openedRoom, resultFor, turnsRunOut } from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  cast = await castOf(server)
})

afterEach(() => server.close())

const concludedRoom = async (visibility: 'open' | 'private' = 'open') => {
  const id = await openedRoom(cast, { visibility })
  await turnsRunOut(cast, id)
  return id
}

const closedRoom = async (visibility: 'open' | 'private' = 'open') => {
  const id = await concludedRoom(visibility)
  await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
  await decide(cast.ana, id, 'approval')
  await decide(cast.ben, id, 'approval')
  return id
}

describe('drafting the result', () => {
  it('saves the first agent’s draft, with every participant’s approval still to come', async () => {
    const id = await concludedRoom()
    const room = (await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion')))
      .json
    expect(room.result).toMatchObject({ draftedBy: cast.ben.me.member.id, result: { kind: 'no_conclusion' } })
    expect(room.approvals).toEqual([
      expect.objectContaining({ approvedAt: null }),
      expect.objectContaining({ approvedAt: null }),
    ])
    expect((await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(409)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.asks).toEqual([])
  })

  it('refuses a draft before the turns ran out, from a person or an outside agent, and one that leaves someone out', async () => {
    const id = await openedRoom(cast)
    expect((await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(409)
    await turnsRunOut(cast, id)
    expect((await cast.ana.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(403)
    expect((await cast.cyAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(403)
    const partial = { ...resultFor(cast), contributions: resultFor(cast).contributions.slice(0, 1) }
    expect((await cast.anaAgent.api('PUT', `/debates/${id}/result`, partial)).status).toBe(400)
  })
})

describe('approving the result', () => {
  it('closes the room once every participant’s person approved, and credits the growth record', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    const halfway = (await decide(cast.ana, id, 'approval')).json
    expect(halfway.status).toBe('concluding')
    const closed = (await decide(cast.ben, id, 'approval')).json
    expect(closed).toMatchObject({ status: 'closed', closedAt: expect.any(Number) })
    expect(closed.approvals.every((one: { approvedAt: number | null }) => one.approvedAt !== null)).toBe(true)
    const credits = (await storedRows(server, 'debate_credits')).map((row) => [row.member_id, row.kind])
    expect(credits.sort()).toEqual(
      [
        [cast.ana.me.member.id, 'conclusion'],
        [cast.ana.me.member.id, 'gap_filled'],
        [cast.ana.me.member.id, 'next_step_accepted'],
        [cast.ben.me.member.id, 'conclusion'],
        [cast.ben.me.member.id, 'position_changed'],
      ].sort(),
    )
    const mine = (await cast.ana.api('GET', '/principles')).json
    expect(mine.debateCredits).toEqual(['conclusion', 'gap_filled', 'next_step_accepted'])
    expect(mine.achievements).toEqual(['debate_conclusion', 'debate_gap_filled', 'debate_next_step_accepted'])
    expect((await decide(cast.ana, id, 'approval')).status).toBe(409)
  })

  it('lets only a participant’s person approve or decline, never an agent', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    expect((await decide(cast.anaAgent, id, 'approval')).status).toBe(403)
    expect((await decide(cast.cy, id, 'approval')).status).toBe(403)
    expect((await decide(cast.cy, id, 'decline')).status).toBe(403)
  })

  it('asks the agents again when a person declines, dropping earlier approvals', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await decide(cast.ana, id, 'approval')
    const declined = (await decide(cast.ben, id, 'decline')).json
    expect(declined.result).toBeNull()
    expect(declined.approvals.map((one: { approvedAt: number | null }) => one.approvedAt)).toEqual([
      null,
      null,
    ])
    expect((await cast.benAgent.api('GET', '/debate-asks')).json.asks).toHaveLength(1)
    expect((await decide(cast.ben, id, 'decline')).status).toBe(409)
  })
})

describe('a decision on the result', () => {
  it('counts a new round when a person declines, so the agents draft again', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    const declined = (await decide(cast.ben, id, 'decline')).json
    expect(declined.resultRound).toBe(1)
    const asks = (await cast.anaAgent.api('GET', '/debate-asks')).json.asks
    expect(
      asks.map((ask: { ask: string; debate: { resultRound: number } }) => [ask.ask, ask.debate.resultRound]),
    ).toEqual([['result', 1]])
    const redrafted = (
      await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion'))
    ).json
    expect(redrafted).toMatchObject({ resultRound: 1, result: { draftedBy: cast.ben.me.member.id } })
  })

  it('refuses a decision on a draft other than the one the person read', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    const read = (await cast.ana.api('GET', `/debates/${id}`)).json.result.draftedAt
    await decide(cast.ben, id, 'decline')
    await server.clock.advance(1_000)
    await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion'))
    const stale = await decide(cast.ana, id, 'approval', read)
    expect(stale.status).toBe(409)
    expect(stale.json.error.message).toMatch(/changed since you read it/)
    expect((await decide(cast.ana, id, 'decline', read)).status).toBe(409)
    expect((await decide(cast.ana, id, 'approval')).status).toBe(200)
  })
})

describe('the approved result leaving the room', () => {
  it('puts only the result into a draft of the person’s own, sent like any other note', async () => {
    const id = await closedRoom()
    const lobby = (await cast.ana.api('PUT', '/channels/lobby/membership', {})).json
    const draft = (await cast.ana.api('POST', `/debates/${id}/result/post`, { channel: 'lobby' })).json
    expect(draft).toMatchObject({
      status: 'draft',
      origin: 'agent',
      agentName: null,
      conversationId: lobby.conversationId,
      fromDebate: { debateId: id, question: 'Should we ship the billing migration this week?' },
    })
    expect(draft.fromDebate.agents).toEqual(
      expect.arrayContaining([
        { agent: 'Ana agent', person: 'Ana' },
        { agent: 'Ben agent', person: 'Ben' },
      ]),
    )
    expect(draft.body).toMatch(/^From the debate room: Should we ship the billing migration this week\?\n/)
    expect(draft.body).toContain('Ship on Thursday.')
    expect(draft.body).not.toMatch(/approved by/i)
    expect(draft.body).not.toContain('Turn 1')
    const direct = (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id }))
      .json
    expect(direct.status).toBe('draft')
    const again = (
      await cast.ana.api('POST', `/debates/${id}/result/post`, { conversationId: direct.conversationId })
    ).json
    expect(again.conversationId).toBe(direct.conversationId)
  })

  it('marks the posted result as the agents’ note, edited when the person changed it, and shows the mark only once sent', async () => {
    const id = await closedRoom()
    const asWritten = (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id }))
      .json
    expect((await cast.cy.api('GET', `/notes/${asWritten.id}`)).status).toBe(404)
    expect(JSON.stringify((await cast.cy.api('GET', '/events/poll?after=0')).json)).not.toContain(id)
    const sent = (await cast.ana.api('POST', `/drafts/${asWritten.id}/send`, {})).json
    expect(sent.origin).toBe('agent')
    const seen = (await cast.cy.api('GET', `/notes/${asWritten.id}`)).json
    expect(seen).toMatchObject({ origin: 'agent', fromDebate: { debateId: id } })
    const edited = (await cast.ben.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id }))
      .json
    const changed = (
      await cast.ben.api('POST', `/drafts/${edited.id}/send`, { body: `${edited.body}\n\nMy own words.` })
    ).json
    expect(changed).toMatchObject({ origin: 'human_edited', fromDebate: { debateId: id } })
    expect(await storedRows(server, 'principle_offers')).toEqual([])
  })

  it('leaves a posted result out of every agent figure, insight, route map and chance to teach', async () => {
    const id = await closedRoom()
    const figures = async () => {
      const mine = (await cast.ana.api('GET', '/insights/me')).json
      const organization = (await cast.ana.api('GET', '/admin/insights')).json
      const taught = (await cast.ana.api('GET', '/principles')).json
      return JSON.stringify([
        mine.periods,
        mine.weeks,
        mine.sessions,
        organization.periods,
        taught.routes,
        taught.offers,
      ])
    }
    const before = await figures()
    const asWritten = (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id }))
      .json
    await cast.ana.api('POST', `/drafts/${asWritten.id}/send`, {})
    const edited = (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.ben.me.member.id }))
      .json
    await cast.ana.api('POST', `/drafts/${edited.id}/send`, {
      body: `${edited.body}\n\nAnd one more thing from me, about dates.`,
    })
    const discarded = (
      await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.ben.me.member.id })
    ).json
    await cast.ana.api('POST', `/drafts/${discarded.id}/discard`)
    expect(await figures()).toBe(before)
    expect(await storedRows(server, 'principle_offers')).toEqual([])
  })

  it('refuses before approval, from someone whose agent took no part, and without exactly one destination', async () => {
    const id = await concludedRoom()
    expect(
      (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id })).status,
    ).toBe(409)
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await decide(cast.ana, id, 'approval')
    await decide(cast.ben, id, 'approval')
    expect(
      (await cast.cy.api('POST', `/debates/${id}/result/post`, { to: cast.ana.me.member.id })).status,
    ).toBe(403)
    expect((await cast.ana.api('POST', `/debates/${id}/result/post`, {})).status).toBe(400)
    expect(
      (
        await cast.ana.api('POST', `/debates/${id}/result/post`, {
          to: cast.cy.me.member.id,
          channel: 'lobby',
        })
      ).status,
    ).toBe(400)
  })

  it('exports the closed room as Markdown and JSON with display names, recording the export', async () => {
    const id = await closedRoom()
    const markdown = (await cast.ben.api('POST', `/debates/${id}/export`, { format: 'markdown' })).json
    expect(markdown).toMatchObject({ mediaType: 'text/markdown', filename: expect.stringMatching(/\.md$/) })
    expect(markdown.text).toContain('Ana’s agent (Ana agent)')
    expect(markdown.text).not.toContain(cast.ana.me.member.id)
    const json = (await cast.cy.api('POST', `/debates/${id}/export`, { format: 'json' })).json
    expect(JSON.parse(json.text).participants).toEqual(
      expect.arrayContaining([
        { name: 'Ana', agent: 'Ana agent' },
        { name: 'Ben', agent: 'Ben agent' },
      ]),
    )
    const audited = (await storedRows(server, 'audit_log')).filter(
      (entry) => entry.action === 'debates.export',
    )
    expect(audited.map((entry) => entry.actor_id)).toEqual([cast.ben.me.member.id, cast.cy.me.member.id])
    expect((await storedRows(server, 'audit_log')).some((entry) => entry.action === 'debates.closed')).toBe(
      true,
    )
  })

  it('exports a private room to its members only, and no room before it closed', async () => {
    const secret = await closedRoom('private')
    expect((await cast.cy.api('POST', `/debates/${secret}/export`, { format: 'json' })).status).toBe(404)
    expect((await cast.ben.api('POST', `/debates/${secret}/export`, { format: 'json' })).status).toBe(200)
    const open = await concludedRoom()
    expect((await cast.ana.api('POST', `/debates/${open}/export`, { format: 'json' })).status).toBe(409)
    expect((await cast.anaAgent.api('POST', `/debates/${open}/export`, { format: 'json' })).status).toBe(403)
  })
})
