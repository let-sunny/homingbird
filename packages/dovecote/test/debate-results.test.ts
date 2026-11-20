import { Task as T } from '@homingbird/kernel'
import { RESULT_DRAFTING_WINDOW_MS, RESULT_VOTING_WINDOW_MS, RESULT_WINDOW_MS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DebateRow } from '../src/domain/debate-rows.ts'
import { settleDebateRow } from '../src/domain/debate-settling.ts'
import { transact } from '../src/events/events.ts'
import { debateDeadlinePass } from '../src/runtime.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import {
  type Cast,
  castOf,
  draftedAlone,
  dropOut,
  openedRoom,
  resultFor,
  roomOfThree as roomOfThreeOf,
  threeResult as threeResultOf,
  turnsRunOut,
  withStatedModels,
} from './debate-support.ts'
import { type TestServer, asShown, startTestServer, storedRows } from './harness.ts'

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
  await draftedAlone(server, cast, id)
  return id
}

const roomOfThree = () => roomOfThreeOf(cast)

const threeResult = (conclusion: string) => threeResultOf(cast, conclusion)

const roomOf = async (id: string) => (await cast.cy.api('GET', `/debates/${id}`)).json

const storedRoom = async (id: string): Promise<DebateRow> =>
  (await storedRows(server, 'debates')).find((row) => row.id === id) as unknown as DebateRow

describe('drafting the result', () => {
  it('keeps collecting drafts after the first, then closes the room with the only draft', async () => {
    const id = await concludedRoom()
    const first = (await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion')))
      .json
    expect(first.result).toBeNull()
    expect(first.drafts).toEqual([expect.objectContaining({ draftedBy: cast.ben.me.member.id, votes: null })])
    expect(first.draftsCloseAt).toBe(first.drafts[0].draftedAt + RESULT_DRAFTING_WINDOW_MS)
    expect((await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(409)
    expect((await cast.benAgent.api('GET', '/debate-asks')).json.asks).toEqual([])
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.asks).toHaveLength(1)
    await server.clock.advance(RESULT_DRAFTING_WINDOW_MS)
    const room = await roomOf(id)
    expect(room).toMatchObject({
      status: 'closed',
      result: { draftedBy: cast.ben.me.member.id, result: { kind: 'no_conclusion' } },
      voteRecord: { votes: [], droppedOut: [] },
    })
    expect(room.drafts[0].votes).toBe(0)
    expect((await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(409)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json).toEqual({
      asks: [],
      ballots: [],
      ended: [],
    })
  })

  it('stops collecting at once when every agent taking part drafted, and puts the drafts to a vote', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    const both = (await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion')))
      .json
    expect(both).toMatchObject({ result: null, draftsCloseAt: null, votedBy: [], voteRecord: null })
    expect(both.votingClosesAt).toEqual(expect.any(Number))
    expect((await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).status).toBe(409)
    const ballots = (await cast.anaAgent.api('GET', '/debate-asks')).json
    expect(ballots.asks).toEqual([])
    expect(ballots.ballots.map((room: { id: string }) => room.id)).toEqual([id])
  })

  it('does not wait for an agent that dropped out, and puts the drafts of those taking part to a vote', async () => {
    const id = await roomOfThree()
    await dropOut(server, cast, 'cy')
    const first = (await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult('A.'))).json
    expect(first).toMatchObject({ result: null, votingClosesAt: null })
    expect(
      first.participants.find((one: { memberId: string }) => one.memberId === cast.cy.me.member.id),
    ).toMatchObject({
      takingPart: false,
    })
    const room = (await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('B.'))).json
    expect(room).toMatchObject({ status: 'concluding', result: null, votingClosesAt: expect.any(Number) })
  })

  it('hides the other agents’ drafts from an agent until it drafted, never from a person', async () => {
    const id = await concludedRoom()
    await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion'))
    expect((await cast.anaAgent.api('GET', `/debates/${id}`)).json.drafts).toEqual([])
    const asked = (await cast.anaAgent.api('GET', '/debate-asks')).json.asks
    expect(asked[0].debate.drafts).toEqual([])
    expect((await cast.benAgent.api('GET', `/debates/${id}`)).json.drafts).toHaveLength(1)
    expect((await cast.ana.api('GET', `/debates/${id}`)).json.drafts).toHaveLength(1)
    const voting = (await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))).json
    expect(voting.drafts).toHaveLength(2)
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

  it('refuses a draft once the drafting window passed, even before the room was read again', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await server.clock.advance(RESULT_DRAFTING_WINDOW_MS)
    const late = await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    expect(late.status).toBe(409)
  })
})

describe('settling the result by vote', () => {
  it('closes the room with the draft that has the most votes, and records who voted for which', async () => {
    const id = await roomOfThree()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult('Ana’s draft.'))
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('Ben’s draft.'))
    const voting = (await cast.cyAgent.api('PUT', `/debates/${id}/result`, threeResult('Cy’s draft.'))).json
    expect(voting.drafts.map((draft: { votes: number | null }) => draft.votes)).toEqual([null, null, null])
    const round = voting.resultRound
    const ana = cast.ana.me.member.id
    const ben = cast.ben.me.member.id
    const cy = cast.cy.me.member.id
    expect(
      (await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: ben })).status,
    ).toBe(200)
    const halfway = (await cast.cyAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: ben }))
      .json
    expect(halfway).toMatchObject({ result: null, voteRecord: null })
    expect([...halfway.votedBy].sort()).toEqual([ana, cy].sort())
    expect(halfway.drafts.map((draft: { votes: number | null }) => draft.votes)).toEqual([null, null, null])
    const decided = (await cast.benAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: ana }))
      .json
    expect(decided).toMatchObject({
      status: 'closed',
      result: { draftedBy: ben, result: { conclusion: 'Ben’s draft.' } },
    })
    expect(decided.voteRecord.votes).toEqual(
      expect.arrayContaining([
        { voterId: ana, draftBy: ben, agentModel: null },
        { voterId: cy, draftBy: ben, agentModel: null },
        { voterId: ben, draftBy: ana, agentModel: null },
      ]),
    )
    expect(decided.voteRecord.droppedOut).toEqual([])
    const votesFor = Object.fromEntries(
      decided.drafts.map((draft: { draftedBy: string; votes: number }) => [draft.draftedBy, draft.votes]),
    )
    expect(votesFor).toEqual({ [ana]: 1, [ben]: 2, [cy]: 0 })
    const closed = (await storedRows(server, 'audit_events')).find((entry) => entry.event === 'debate.closed')
    expect(JSON.parse(String(closed?.detail))).toMatchObject({ draftedBy: ben, votes: 2, drafts: 3 })
    expect(String(closed?.detail)).not.toMatch(/summary|conclusion/i)
  })

  it('records the model each agent states with its draft and its vote, apart from the result', async () => {
    await withStatedModels(server)
    const id = await roomOfThree()
    const ana = cast.ana.me.member.id
    const ben = cast.ben.me.member.id
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, {
      ...threeResult('Ana’s draft.'),
      model: 'model-a',
    })
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('Ben’s draft.'))
    const voting = (await cast.cyAgent.api('PUT', `/debates/${id}/result`, threeResult('Cy’s draft.'))).json
    const modelOf = Object.fromEntries(
      voting.drafts.map((draft: { draftedBy: string; agentModel: string | null }) => [
        draft.draftedBy,
        draft.agentModel,
      ]),
    )
    expect(modelOf).toEqual({ [ana]: 'model-a', [ben]: null, [cast.cy.me.member.id]: null })
    for (const draft of voting.drafts) expect(draft.result).not.toHaveProperty('model')
    const round = voting.resultRound
    await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: ben, model: 'model-a' })
    await cast.cyAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: ben })
    const decided = (await cast.benAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: ana }))
      .json
    expect(decided.voteRecord.votes).toEqual(
      expect.arrayContaining([
        { voterId: ana, draftBy: ben, agentModel: 'model-a' },
        { voterId: cast.cy.me.member.id, draftBy: ben, agentModel: null },
        { voterId: ben, draftBy: ana, agentModel: null },
      ]),
    )
    expect(JSON.stringify(await storedRows(server, 'audit_events'))).not.toContain('model-a')
    expect(server.logged.join('\n')).not.toContain('model-a')
  })

  it('breaks a tie by the earliest draft', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await server.clock.advance(1_000)
    const room = (await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion')))
      .json
    await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, {
      round: room.resultRound,
      draftBy: cast.ben.me.member.id,
    })
    const decided = (
      await cast.benAgent.api('POST', `/debates/${id}/result/vote`, {
        round: room.resultRound,
        draftBy: cast.ana.me.member.id,
      })
    ).json
    expect(decided).toMatchObject({ status: 'closed', result: { draftedBy: cast.ana.me.member.id } })
  })

  it('refuses a vote for one’s own draft, a second vote, a stale round and a person', async () => {
    const id = await roomOfThree()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult('A.'))
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('B.'))
    const room = (await cast.cyAgent.api('PUT', `/debates/${id}/result`, threeResult('C.'))).json
    const vote = (draftBy: string, round = room.resultRound) => ({ round, draftBy })
    const own = await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, vote(cast.ana.me.member.id))
    expect(own.status).toBe(409)
    expect(own.json.error.message).toMatch(/own draft/)
    expect(
      (await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, vote(cast.ben.me.member.id, 7))).status,
    ).toBe(409)
    expect(
      (await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, vote(cast.ben.me.member.id))).status,
    ).toBe(200)
    expect(
      (await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, vote(cast.cy.me.member.id))).status,
    ).toBe(409)
    expect(
      (await cast.ana.api('POST', `/debates/${id}/result/vote`, vote(cast.cy.me.member.id))).status,
    ).toBe(403)
  })

  it('leaves an agent that dropped out out of the vote, records it, and lets its draft win', async () => {
    const id = await roomOfThree()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult('A.'))
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('B.'))
    await cast.cyAgent.api('PUT', `/debates/${id}/result`, threeResult('C.'))
    cast.sleep('ben')
    await server.clock.advance(RESULT_VOTING_WINDOW_MS - 1)
    const round = (await roomOf(id)).resultRound
    await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: cast.ben.me.member.id })
    await cast.cyAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: cast.ben.me.member.id })
    expect((await roomOf(id)).status).toBe('concluding')
    await server.clock.advance(2)
    const closed = await roomOf(id)
    expect(closed).toMatchObject({ status: 'closed', result: { draftedBy: cast.ben.me.member.id } })
    expect(closed.voteRecord.droppedOut).toEqual([cast.ben.me.member.id])
  })

  it('stops waiting for an agent that dropped out, and records that it did not vote', async () => {
    const id = await roomOfThree()
    await dropOut(server, cast, 'cy')
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult('A.'))
    const voting = (await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('B.'))).json
    expect(voting.votingClosesAt).toEqual(expect.any(Number))
    const round = voting.resultRound
    await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: cast.ben.me.member.id })
    const closed = (
      await cast.benAgent.api('POST', `/debates/${id}/result/vote`, { round, draftBy: cast.ana.me.member.id })
    ).json
    expect(closed).toMatchObject({ status: 'closed', voteRecord: { droppedOut: [cast.cy.me.member.id] } })
  })

  it('takes an agent that dropped out back in once it makes a request again', async () => {
    const id = await roomOfThree()
    await dropOut(server, cast, 'cy')
    const takingPart = async () =>
      Object.fromEntries(
        (await roomOf(id)).participants.map((one: { memberId: string; takingPart: boolean }) => [
          one.memberId,
          one.takingPart,
        ]),
      )
    expect(await takingPart()).toEqual({
      [cast.ana.me.member.id]: true,
      [cast.ben.me.member.id]: true,
      [cast.cy.me.member.id]: false,
    })
    await cast.cyAgent.api('GET', '/debate-asks')
    expect((await roomOf(id)).participants.every((one: { takingPart: boolean }) => one.takingPart)).toBe(true)
  })

  it('closes with the earliest draft when the vote runs out, and ends a room with one agent left', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await server.clock.advance(1_000)
    await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion'))
    await server.clock.advance(RESULT_VOTING_WINDOW_MS)
    expect(await roomOf(id)).toMatchObject({ status: 'closed', result: { draftedBy: cast.ana.me.member.id } })

    const other = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${other}/result`, resultFor(cast))
    await dropOut(server, cast, 'ben')
    expect(await roomOf(other)).toMatchObject({
      status: 'ended',
      endedBecause: 'one_agent_left',
      result: null,
    })
    expect(
      (await cast.anaAgent.api('PUT', `/debates/${other}/result`, resultFor(cast, 'no_conclusion'))).status,
    ).toBe(409)
  })
})

describe('a room settled before 0.1.4', () => {
  const waitingForApprovals = async () => {
    const id = await concludedRoom()
    const result = JSON.stringify(resultFor(cast))
    await T.runPromise(
      run(sql`UPDATE debates SET result = ${result}, result_by = ${cast.ana.me.member.id},
        result_at = ${server.clock.now()} WHERE id = ${id}`),
      server.env,
    )
    return id
  }

  it('closes a room stored while it waited for approvals with the result it chose, on the next pass', async () => {
    const id = await waitingForApprovals()
    await T.runPromise(debateDeadlinePass, server.env)
    const room = (await storedRows(server, 'debates')).find((row) => row.id === id)!
    expect(room).toMatchObject({ status: 'closed', result_by: cast.ana.me.member.id })
    const credits = (await storedRows(server, 'debate_credits')).map((row) => [row.member_id, row.kind])
    expect(credits).toEqual(expect.arrayContaining([[cast.ana.me.member.id, 'gap_filled']]))
  })

  it('closes a room that waited for approvals for more than a day with its result, not without one', async () => {
    const id = await waitingForApprovals()
    await server.clock.advance(RESULT_WINDOW_MS + 1)
    await T.runPromise(debateDeadlinePass, server.env)
    expect(await storedRoom(id)).toMatchObject({ status: 'closed', ended_because: null })
  })

  it('closes a room whose vote ran out unread for more than a day with the winning draft', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await server.clock.advance(1_000)
    await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion'))
    await server.clock.advance(RESULT_WINDOW_MS + 1)
    await T.runPromise(debateDeadlinePass, server.env)
    expect(await storedRoom(id)).toMatchObject({ status: 'closed', result_by: cast.ana.me.member.id })
  })

  it('closes a room left unread for more than a day before its vote opened with the earliest draft', async () => {
    const id = await roomOfThree()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult('Ship.'))
    await server.clock.advance(1_000)
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult('Wait.'))
    await server.clock.advance(RESULT_WINDOW_MS + 1)
    await T.runPromise(debateDeadlinePass, server.env)
    expect(await storedRoom(id)).toMatchObject({
      status: 'closed',
      result_by: cast.ana.me.member.id,
      votes_open_at: null,
    })
  })

  it('leaves a room alone when its round or result changed after it was described', async () => {
    const id = await waitingForApprovals()
    const described = await storedRoom(id)
    await T.runPromise(
      run(sql`UPDATE debates SET result = NULL, result_by = NULL, result_at = NULL,
        result_round = result_round + 1 WHERE id = ${id}`),
      server.env,
    )
    await T.runPromise(transact(settleDebateRow(described)), server.env)
    expect(await storedRoom(id)).toMatchObject({ status: 'concluding', result: null })
    expect(await storedRows(server, 'debate_credits')).toEqual([])
  })
})

describe('credits', () => {
  it('credits the growth record when the room closes, with no person approving', async () => {
    await closedRoom()
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
  })

  it('offers no route to approve or decline a result', async () => {
    const id = await closedRoom()
    expect((await cast.ana.api('POST', `/debates/${id}/result/approval`, { draftedAt: 1 })).status).toBe(404)
    expect((await cast.ana.api('POST', `/debates/${id}/result/decline`, { draftedAt: 1 })).status).toBe(404)
  })
})

describe('the settled result leaving the room', () => {
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
    const sent = (
      await cast.ana.api('POST', `/drafts/${asWritten.id}/send`, await asShown(cast.ana, asWritten.id))
    ).json
    expect(sent.origin).toBe('agent')
    const seen = (await cast.cy.api('GET', `/notes/${asWritten.id}`)).json
    expect(seen).toMatchObject({ origin: 'agent', fromDebate: { debateId: id } })
    const edited = (await cast.ben.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id }))
      .json
    const changed = (
      await cast.ben.api(
        'POST',
        `/drafts/${edited.id}/send`,
        await asShown(cast.ben, edited.id, { body: `${edited.body}\n\nMy own words.` }),
      )
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
      ]).replace(/"debateResultsSent":\d+,/g, '')
    }
    const before = await figures()
    const asWritten = (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id }))
      .json
    await cast.ana.api('POST', `/drafts/${asWritten.id}/send`, await asShown(cast.ana, asWritten.id))
    const edited = (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.ben.me.member.id }))
      .json
    await cast.ana.api(
      'POST',
      `/drafts/${edited.id}/send`,
      await asShown(cast.ana, edited.id, {
        body: `${edited.body}\n\nAnd one more thing from me, about dates.`,
      }),
    )
    const discarded = (
      await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.ben.me.member.id })
    ).json
    await cast.ana.api('POST', `/drafts/${discarded.id}/discard`)
    expect(await figures()).toBe(before)
    const mine = (await cast.ana.api('GET', '/insights/me')).json.periods[0].current
    expect(mine).toMatchObject({ debateResultsSent: 2, written: 0, wroteYourself: 0 })
    expect(await storedRows(server, 'principle_offers')).toEqual([])
  })

  it('refuses before the room closed, from someone whose agent took no turn, and without exactly one destination', async () => {
    const id = await concludedRoom()
    expect(
      (await cast.ana.api('POST', `/debates/${id}/result/post`, { to: cast.cy.me.member.id })).status,
    ).toBe(409)
    await draftedAlone(server, cast, id)
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

  it('lets a person whose agent was opted in but took no turn neither post nor approve', async () => {
    const created = await cast.ana.api('POST', '/debates', {
      question: 'Which week?',
      limits: { turnsPerAgent: 1, totalTurns: 2, minutes: 30, turnCharacters: 300 },
    })
    const id = created.json.id as string
    for (const [who, agent] of [
      [cast.ana, cast.anaAgent],
      [cast.ben, cast.benAgent],
      [cast.cy, cast.cyAgent],
    ] as const)
      await who.api('PUT', `/debates/${id}/agent`, { agentId: agent.id })
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'Thursday.' })
    await cast.benAgent.api('POST', `/debates/${id}/turns`, { body: 'Friday.' })
    await draftedAlone(server, cast, id, threeResult('Thursday.'))
    expect((await roomOf(id)).status).toBe('closed')
    const refused = await cast.cy.api('POST', `/debates/${id}/result/post`, { to: cast.ana.me.member.id })
    expect(refused.status).toBe(403)
    expect(refused.json.error.message).toMatch(/took a turn/)
    expect(
      (await cast.ben.api('POST', `/debates/${id}/result/post`, { to: cast.ana.me.member.id })).status,
    ).toBe(200)
  })

  it('exports the closed room as Markdown and JSON with display names, recording the export', async () => {
    const id = await closedRoom()
    const markdown = (await cast.ben.api('POST', `/debates/${id}/export`, { format: 'markdown' })).json
    expect(markdown).toMatchObject({ mediaType: 'text/markdown', filename: expect.stringMatching(/\.md$/) })
    expect(markdown.text).toContain('Ana’s agent (Ana agent; model: not stated)')
    expect(markdown.text).not.toContain(cast.ana.me.member.id)
    const json = (await cast.cy.api('POST', `/debates/${id}/export`, { format: 'json' })).json
    expect(JSON.parse(json.text).participants).toEqual(
      expect.arrayContaining([
        { name: 'Ana', agent: 'Ana agent' },
        { name: 'Ben', agent: 'Ben agent' },
      ]),
    )
    const audited = (await storedRows(server, 'audit_events')).filter(
      (entry) => entry.event === 'debate.exported',
    )
    expect(audited.map((entry) => entry.actor_id)).toEqual([cast.ben.me.member.id, cast.cy.me.member.id])
    expect((await storedRows(server, 'audit_events')).some((entry) => entry.event === 'debate.closed')).toBe(
      true,
    )
  })

  it('writes the export’s headings in the exporting person’s language, chosen or asked for', async () => {
    const id = await closedRoom()
    await cast.ben.api('PATCH', '/me', { locale: 'ko' })
    const korean = (await cast.ben.api('POST', `/debates/${id}/export`, { format: 'markdown' })).json.text
    expect(korean).toMatch(/^# 토론방: /)
    expect(korean).toContain('## 차례')
    const asked = (
      await cast.ben.api('POST', `/debates/${id}/export`, { format: 'markdown', language: 'en' })
    ).json.text
    expect(asked).toMatch(/^# Debate room: /)
    const fallback = (await cast.ana.api('POST', `/debates/${id}/export`, { format: 'markdown' })).json.text
    expect(fallback).toContain('## Turns')
    expect(fallback).toContain('## Vote\n\nNo vote was held: the result was the only draft.')
    expect(korean).toContain('## 투표\n\n초안이 하나뿐이라 투표하지 않았어요.')
  })

  it('exports a private room to its members only, and no room before it closed', async () => {
    const secret = await closedRoom('private')
    expect((await cast.cy.api('POST', `/debates/${secret}/export`, { format: 'json' })).status).toBe(404)
    expect((await cast.ben.api('POST', `/debates/${secret}/export`, { format: 'json' })).status).toBe(200)
    const record = JSON.parse(
      (await cast.ben.api('POST', `/debates/${secret}/export`, { format: 'json' })).json.text,
    )
    expect(record.vote).toEqual({ votes: [], droppedOut: [] })
    const open = await concludedRoom()
    expect((await cast.ana.api('POST', `/debates/${open}/export`, { format: 'json' })).status).toBe(409)
    expect((await cast.anaAgent.api('POST', `/debates/${open}/export`, { format: 'json' })).status).toBe(403)
  })
})
