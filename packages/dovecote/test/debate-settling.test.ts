import { Task as T } from '@homingbird/kernel'
import { RESULT_DRAFTING_WINDOW_MS, RESULT_VOTING_WINDOW_MS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { debateDeadlinePass } from '../src/runtime.ts'
import {
  type Cast,
  PAST_GRACE_MS,
  castOf,
  draftedAlone,
  dropOut,
  openedRoom,
  resultFor,
  roomOfThree,
  threeResult,
  turnsRunOut,
} from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer()
  cast = await castOf(server)
})

afterEach(() => server?.close())

const concludedRoom = async () => {
  const id = await openedRoom(cast)
  await turnsRunOut(cast, id)
  return id
}

const roomOf = async (id: string) => (await cast.cy.api('GET', `/debates/${id}`)).json

describe('a flock that moves on by itself', () => {
  it('keeps collecting while the window is open and an agent taking part has not drafted', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await server.clock.advance(RESULT_DRAFTING_WINDOW_MS - 1)
    expect(await roomOf(id)).toMatchObject({ result: null, votingClosesAt: null })
    await server.clock.advance(1)
    expect(await roomOf(id)).toMatchObject({ status: 'closed', result: { draftedBy: cast.ana.me.member.id } })
  })

  it('waits for a voter taking part until the vote’s time runs out, then closes with the winner', async () => {
    const id = await concludedRoom()
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    const voting = (await cast.benAgent.api('PUT', `/debates/${id}/result`, resultFor(cast, 'no_conclusion')))
      .json
    await cast.anaAgent.api('POST', `/debates/${id}/result/vote`, {
      round: voting.resultRound,
      draftBy: cast.ben.me.member.id,
    })
    await server.clock.advance(RESULT_VOTING_WINDOW_MS - 1)
    expect((await roomOf(id)).result).toBeNull()
    await server.clock.advance(1)
    const chosen = await roomOf(id)
    expect(chosen).toMatchObject({ status: 'closed', result: { draftedBy: cast.ben.me.member.id } })
    expect(chosen.votingClosesAt).toBeNull()
  })

  it('stops waiting for a voter the moment it dropped out', async () => {
    const id = await roomOfThree(cast)
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult(cast, 'A.'))
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult(cast, 'B.'))
    cast.sleep('ben')
    await server.clock.advance(RESULT_DRAFTING_WINDOW_MS)
    const voting = await roomOf(id)
    expect(voting.votingClosesAt).toEqual(expect.any(Number))
    for (const agent of [cast.anaAgent, cast.cyAgent])
      await agent.api('POST', `/debates/${id}/result/vote`, {
        round: voting.resultRound,
        draftBy: cast.ben.me.member.id,
      })
    expect((await roomOf(id)).result).toBeNull()
    await server.clock.advance(PAST_GRACE_MS - RESULT_DRAFTING_WINDOW_MS)
    const closed = await roomOf(id)
    expect(closed.votingClosesAt).toBeNull()
    expect(closed).toMatchObject({
      status: 'closed',
      result: { draftedBy: cast.ben.me.member.id },
      voteRecord: { droppedOut: [cast.ben.me.member.id] },
    })
  })

  it('closes a flock as it is, without a result, the moment the vote is down to one agent', async () => {
    const id = await roomOfThree(cast)
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, threeResult(cast, 'A.'))
    await cast.benAgent.api('PUT', `/debates/${id}/result`, threeResult(cast, 'B.'))
    cast.sleep('ana')
    cast.sleep('ben')
    await server.clock.advance(RESULT_DRAFTING_WINDOW_MS - 1)
    const voting = (await cast.cyAgent.api('PUT', `/debates/${id}/result`, threeResult(cast, 'C.'))).json
    expect(voting.votingClosesAt).toEqual(expect.any(Number))
    await server.clock.advance(PAST_GRACE_MS - RESULT_DRAFTING_WINDOW_MS + 1)
    expect(await roomOf(id)).toMatchObject({ status: 'ended', endedBecause: 'one_agent_left', result: null })
    expect(await storedRows(server, 'debate_credits')).toEqual([])
  })

  it('stops a started flock at once when the agents with turns left dropped out', async () => {
    const created = await cast.ana.api('POST', '/debates', {
      question: 'Which week?',
      limits: { turnsPerAgent: 1, totalTurns: 3, minutes: 30, turnCharacters: 300 },
    })
    const id = created.json.id as string
    await cast.optIn(cast.ana, id, cast.anaAgent.id)
    await cast.optIn(cast.ben, id, cast.benAgent.id)
    await cast.optIn(cast.cy, id, cast.cyAgent.id)
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'First.' })
    await cast.benAgent.api('POST', `/debates/${id}/turns`, { body: 'Second.' })
    expect((await roomOf(id)).status).toBe('open')
    await dropOut(server, cast, 'cy')
    expect((await roomOf(id)).status).toBe('concluding')
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.asks).toEqual([
      expect.objectContaining({ ask: 'result' }),
    ])
  })

  it('closes a started flock as it is, without a result, when one agent is left', async () => {
    const id = await openedRoom(cast)
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'First.' })
    await dropOut(server, cast, 'ben')
    expect(await roomOf(id)).toMatchObject({ status: 'ended', endedBecause: 'one_agent_left', result: null })
    const ended = (await storedRows(server, 'audit_events')).filter((entry) => entry.event === 'debate.ended')
    expect(ended.map((entry) => JSON.parse(String(entry.detail)).because)).toEqual(['one_agent_left'])
    const waiting = (await cast.anaAgent.api('GET', '/debate-asks')).json
    expect(waiting).toMatchObject({
      asks: [],
      ballots: [],
      ended: [{ id, endedBecause: 'one_agent_left', closedAt: expect.any(Number) }],
    })
    await server.clock.advance(24 * 60 * 60_000 + 1)
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.ended).toEqual([])
    expect((await cast.ana.api('GET', '/debate-asks')).json).toEqual({
      answers: [],
      asks: [],
      upcoming: [],
      ballots: [],
      ended: [],
      meetings: [],
    })
  })

  it('closes a started flock as it is, without a result, when every agent dropped out', async () => {
    const id = await openedRoom(cast)
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'First.' })
    cast.sleep('ana')
    await dropOut(server, cast, 'ben')
    expect(await roomOf(id)).toMatchObject({ status: 'ended', endedBecause: 'no_agent_left', result: null })
    const ended = (await storedRows(server, 'audit_events')).filter((entry) => entry.event === 'debate.ended')
    expect(ended.map((entry) => JSON.parse(String(entry.detail)).because)).toEqual(['no_agent_left'])
  })

  it('waits before the first turn, while people opt agents in before their desks start', async () => {
    const id = await openedRoom(cast)
    await dropOut(server, cast, 'ben')
    expect((await roomOf(id)).status).toBe('open')
  })

  it('settles only the flock a request reads, leaving the others to the per-minute pass', async () => {
    const first = await openedRoom(cast)
    const second = await openedRoom(cast)
    await server.clock.advance(31 * 60_000)
    expect((await roomOf(first)).status).toBe('ended')
    const stored = (await storedRows(server, 'debates')).find((row) => row.id === second)
    expect(stored?.status).toBe('open')
    await T.runPromise(debateDeadlinePass, server.env)
    expect((await storedRows(server, 'debates')).find((row) => row.id === second)?.status).toBe('ended')
  })
})
