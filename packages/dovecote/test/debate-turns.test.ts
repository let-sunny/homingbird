import { Task as T } from '@homingbird/kernel'
import { RESULT_WINDOW_MS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySettling } from '../src/domain/debate-settling.ts'
import { transact } from '../src/events/events.ts'
import { debateDeadlinePass } from '../src/runtime.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type Cast, LIMITS, castOf, openedRoom, resultFor, turnsRunOut } from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer()
  cast = await castOf(server)
})

afterEach(() => server.close())

const turn = (agent: Cast['anaAgent'], id: string, body = 'A point.') =>
  agent.api('POST', `/debates/${id}/turns`, { body })

describe('taking turns', () => {
  it('records each turn for the agent its person opted in, in order', async () => {
    const id = await openedRoom(cast)
    await turn(cast.anaAgent, id, 'The March incident report says the rollback failed.')
    const room = (await turn(cast.benAgent, id, 'I had not read it; that changes my view.')).json
    expect(room.turns).toEqual([
      expect.objectContaining({ position: 1, memberId: cast.ana.me.member.id, agentName: 'Ana agent' }),
      expect.objectContaining({ position: 2, memberId: cast.ben.me.member.id, agentName: 'Ben agent' }),
    ])
    expect(room.status).toBe('open')
  })

  it('refuses a person, an agent nobody opted in, and an agent that cannot see a private room', async () => {
    const id = await openedRoom(cast)
    const secret = await openedRoom(cast, { visibility: 'private' })
    expect((await cast.ana.api('POST', `/debates/${id}/turns`, { body: 'Mine.' })).status).toBe(403)
    expect((await turn(cast.cyAgent, id)).status).toBe(403)
    expect((await turn(cast.cyAgent, secret)).status).toBe(404)
  })

  it('refuses two turns in a row, a blank turn, and a turn over the length cap', async () => {
    const id = await openedRoom(cast)
    await turn(cast.anaAgent, id)
    expect((await turn(cast.anaAgent, id)).status).toBe(409)
    expect((await turn(cast.benAgent, id, '   ')).status).toBe(400)
    expect((await turn(cast.benAgent, id, 'x'.repeat(LIMITS.turnCharacters + 1))).status).toBe(400)
  })

  it('waits for a second agent before the first turn', async () => {
    const id = (await cast.ana.api('POST', '/debates', { question: 'Q?', limits: LIMITS })).json.id
    await cast.ana.api('PUT', `/debates/${id}/agent`, { agentId: cast.anaAgent.id })
    const refused = await turn(cast.anaAgent, id)
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toMatch(/second agent/)
  })

  it('moves to concluding at the total, and takes no turn after it', async () => {
    const id = await openedRoom(cast)
    await turnsRunOut(cast, id)
    const room = (await cast.ana.api('GET', `/debates/${id}`)).json
    expect(room).toMatchObject({ status: 'concluding', concludedAt: expect.any(Number) })
    expect((await turn(cast.anaAgent, id)).status).toBe(409)
  })

  it('moves to concluding once every agent has used its share', async () => {
    const id = await openedRoom(cast, { limits: { ...LIMITS, turnsPerAgent: 1 } })
    await turn(cast.anaAgent, id)
    expect((await turn(cast.benAgent, id)).json.status).toBe('concluding')
  })

  it('moves to concluding when the time runs out, by itself, and records why', async () => {
    const id = await openedRoom(cast)
    await turn(cast.anaAgent, id)
    await server.clock.advance(LIMITS.minutes * 60_000)
    await T.runPromise(debateDeadlinePass, server.env)
    const [row] = await storedRows(server, 'debates')
    expect(row!.status).toBe('concluding')
    const audit = (await storedRows(server, 'audit_events')).filter(
      (entry) => entry.event === 'debate.concluded',
    )
    expect(audit.map((entry) => JSON.parse(String(entry.detail)))).toEqual([{ because: 'time' }])
    expect((await turn(cast.benAgent, id)).status).toBe(409)
  })

  it('moves the other rooms on when one room fails in the per-minute pass', async () => {
    const broken = await openedRoom(cast)
    await turnsRunOut(cast, broken)
    await T.runPromise(
      run(sql`UPDATE debates SET result = ${'not json'}, result_by = ${cast.ana.me.member.id}, result_at = 1
        WHERE id = ${broken}`),
      server.env,
    )
    const healthy = await openedRoom(cast)
    await turn(cast.anaAgent, healthy)
    await server.clock.advance(LIMITS.minutes * 60_000)
    await T.runPromise(debateDeadlinePass, server.env)
    const rows = await storedRows(server, 'debates')
    expect(rows.find((row) => row.id === healthy)?.status).toBe('concluding')
    expect(rows.find((row) => row.id === broken)?.status).toBe('concluding')
    expect(server.logged.some((line) => line.includes(`debate room ${broken}`))).toBe(true)
  })

  it('skips and logs a room that fails to settle in an agent’s asks, and still answers with the others', async () => {
    const [earlier, later] = [await openedRoom(cast), await openedRoom(cast)].sort()
    const broken = later!
    const healthy = earlier!
    await turnsRunOut(cast, broken)
    await T.runPromise(
      run(sql`UPDATE debates SET result = ${'not json'}, result_by = ${cast.ana.me.member.id}, result_at = 1
        WHERE id = ${broken}`),
      server.env,
    )
    const waiting = await openedRoom(cast, { limits: { ...LIMITS, minutes: 60 } })
    await turn(cast.anaAgent, healthy)
    await server.clock.advance(LIMITS.minutes * 60_000)
    const asks = await cast.benAgent.api('GET', '/debate-asks')
    expect(asks.status).toBe(200)
    expect(asks.json.asks.map((ask: { debate: { id: string } }) => ask.debate.id)).toContain(waiting)
    expect(asks.json.asks.map((ask: { debate: { id: string } }) => ask.debate.id)).toContain(healthy)
    expect((await storedRows(server, 'debates')).find((row) => row.id === healthy)?.status).toBe('concluding')
    expect(server.logged.some((line) => line.includes(`debate room ${broken}`))).toBe(true)
  })

  it('leaves a room’s updated_at alone when a read or a pass changes nothing', async () => {
    const id = await openedRoom(cast)
    await turn(cast.anaAgent, id)
    const before = (await storedRows(server, 'debates')).find((row) => row.id === id)?.updated_at
    await server.clock.advance(60_000)
    await cast.ana.api('GET', `/debates/${id}`)
    await cast.benAgent.api('GET', '/debate-asks')
    await T.runPromise(debateDeadlinePass, server.env)
    expect((await storedRows(server, 'debates')).find((row) => row.id === id)?.updated_at).toBe(before)
    await turn(cast.benAgent, id)
    expect((await storedRows(server, 'debates')).find((row) => row.id === id)?.updated_at).toBe(
      server.clock.now(),
    )
  })

  it('ends a room without a result when time runs out with fewer than two agents, or with no turn', async () => {
    const lonely = (await cast.ana.api('POST', '/debates', { question: 'Alone?', limits: LIMITS })).json.id
    await cast.ana.api('PUT', `/debates/${lonely}/agent`, { agentId: cast.anaAgent.id })
    const silent = await openedRoom(cast)
    await server.clock.advance(LIMITS.minutes * 60_000)
    await T.runPromise(debateDeadlinePass, server.env)
    expect((await cast.ana.api('GET', `/debates/${lonely}`)).json).toMatchObject({
      status: 'ended',
      endedBecause: 'too_few_agents',
      result: null,
    })
    expect((await cast.ana.api('GET', `/debates/${silent}`)).json.endedBecause).toBe('no_turns')
    const ended = (await storedRows(server, 'audit_events')).filter((entry) => entry.event === 'debate.ended')
    expect(ended.map((entry) => JSON.parse(String(entry.detail)).because).sort()).toEqual([
      'no_turns',
      'too_few_agents',
    ])
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.asks).toEqual([])
    expect((await cast.anaAgent.api('PUT', `/debates/${silent}/result`, resultFor(cast))).status).toBe(409)
    expect((await cast.ana.api('POST', `/debates/${silent}/export`, { format: 'json' })).status).toBe(409)
    expect(
      (await cast.ana.api('POST', `/debates/${silent}/result/post`, { to: cast.cy.me.member.id })).status,
    ).toBe(409)
    expect(await storedRows(server, 'debate_credits')).toEqual([])
  })

  it('records and announces a room’s stop once, however often it is asked to stop', async () => {
    const id = await openedRoom(cast)
    await turn(cast.anaAgent, id)
    const [row] = await storedRows(server, 'debates')
    for (let time = 0; time < 2; time++)
      await T.runPromise(
        transact(applySettling(row as never, { type: 'conclude', because: 'limit' })),
        server.env,
      )
    const stops = (await storedRows(server, 'audit_events')).filter(
      (entry) => entry.event === 'debate.concluded',
    )
    expect(stops).toHaveLength(1)
    expect((await cast.ana.api('GET', `/debates/${id}`)).json.status).toBe('concluding')
  })

  it('leaves rooms as they are while debate rooms are switched off', async () => {
    const id = await openedRoom(cast)
    const settings = (await cast.ana.api('GET', '/admin/settings')).json
    await cast.ana.api('PUT', '/admin/settings', { ...settings, features: { debateRooms: false } })
    await server.clock.advance(LIMITS.minutes * 60_000)
    await T.runPromise(debateDeadlinePass, server.env)
    const [row] = await storedRows(server, 'debates')
    expect([row!.id, row!.status]).toEqual([id, 'open'])
  })

  it('ends a room that waited a day for its agents to draft a result, without one and without credits', async () => {
    const id = await openedRoom(cast)
    await turnsRunOut(cast, id)
    await server.clock.advance(RESULT_WINDOW_MS - 1)
    await T.runPromise(debateDeadlinePass, server.env)
    expect((await cast.ana.api('GET', `/debates/${id}`)).json.status).toBe('concluding')
    await server.clock.advance(1)
    await T.runPromise(debateDeadlinePass, server.env)
    await T.runPromise(debateDeadlinePass, server.env)
    expect((await cast.ana.api('GET', `/debates/${id}`)).json).toMatchObject({
      status: 'ended',
      endedBecause: 'no_result',
    })
    const ended = (await storedRows(server, 'audit_events')).filter((entry) => entry.event === 'debate.ended')
    expect(ended.map((entry) => JSON.parse(String(entry.detail)))).toEqual([{ because: 'no_result' }])
    expect(await storedRows(server, 'debate_credits')).toEqual([])
    expect((await cast.ana.api('POST', `/debates/${id}/export`, { format: 'json' })).status).toBe(409)
  })
})
