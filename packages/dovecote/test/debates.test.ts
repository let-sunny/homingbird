import { DEFAULT_DEBATE_LIMITS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, LIMITS, QUESTION, castOf, openedRoom, turnsRunOut } from './debate-support.ts'
import { type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer()
  cast = await castOf(server)
})

afterEach(() => server.close())

describe('opening a debate room', () => {
  it('opens an open room with the default limits and makes its creator a member', async () => {
    const room = (await cast.ana.api('POST', '/debates', { question: `  ${QUESTION}  ` })).json
    expect(room).toMatchObject({
      question: QUESTION,
      visibility: 'open',
      status: 'open',
      createdBy: cast.ana.me.member.id,
      limits: DEFAULT_DEBATE_LIMITS,
      memberIds: [cast.ana.me.member.id],
      participants: [],
      turns: [],
      result: null,
    })
    expect(room.deadlineAt - room.createdAt).toBe(DEFAULT_DEBATE_LIMITS.minutes * 60_000)
  })

  it('refuses a blank question, limits that do not add up, and invitees who are not active members', async () => {
    expect((await cast.ana.api('POST', '/debates', { question: '   ' })).status).toBe(400)
    expect(
      (
        await cast.ana.api('POST', '/debates', {
          question: QUESTION,
          limits: { ...LIMITS, turnsPerAgent: 5 },
        })
      ).status,
    ).toBe(400)
    expect(
      (await cast.ana.api('POST', '/debates', { question: QUESTION, memberIds: ['mem_nobody000000'] }))
        .status,
    ).toBe(400)
  })

  it('invites people once each, never the creator twice', async () => {
    const room = (
      await cast.ana.api('POST', '/debates', {
        question: QUESTION,
        memberIds: [cast.ben.me.member.id, cast.ben.me.member.id, cast.ana.me.member.id],
      })
    ).json
    expect([...room.memberIds].sort()).toEqual([cast.ana.me.member.id, cast.ben.me.member.id].sort())
  })
})

describe('listing and reading rooms', () => {
  it('lists every open room and the private rooms the viewer is in, newest first', async () => {
    const open = await openedRoom(cast)
    await server.clock.advance(1)
    const secret = await openedRoom(cast, { visibility: 'private' })
    const listed = async (who: Pick<typeof cast.ana, 'api'>) =>
      (await who.api('GET', '/debates')).json.debates.map((room: { id: string }) => room.id)
    expect(await listed(cast.ana)).toEqual([secret, open])
    expect(await listed(cast.cy)).toEqual([open])
    expect(await listed(cast.cyAgent)).toEqual([open])
    const [summary] = (await cast.cy.api('GET', '/debates')).json.debates
    expect(summary).toMatchObject({ turnCount: 0, joined: false })
    expect([...summary.participantIds].sort()).toEqual([cast.ana.me.member.id, cast.ben.me.member.id].sort())
  })

  it('lists and shows every private room to an administrator’s own sign-in, never to their agent', async () => {
    const secret = (await cast.ben.api('POST', '/debates', { question: QUESTION, visibility: 'private' }))
      .json.id
    const listed = async (who: Pick<typeof cast.ana, 'api'>) =>
      (await who.api('GET', '/debates')).json.debates.map((room: { id: string; joined: boolean }) => [
        room.id,
        room.joined,
      ])
    expect(await listed(cast.ana)).toEqual([[secret, false]])
    expect(await listed(cast.anaAgent)).toEqual([])
    expect(await listed(cast.cy)).toEqual([])
    expect((await cast.ana.api('GET', `/debates/${secret}`)).status).toBe(200)
    expect((await cast.anaAgent.api('GET', `/debates/${secret}`)).status).toBe(404)
  })

  it('lists nothing when there are no rooms', async () => {
    expect((await cast.ana.api('GET', '/debates')).json.debates).toEqual([])
  })

  it('shows an open room to everyone and a private room to its members only', async () => {
    const open = await openedRoom(cast)
    const secret = await openedRoom(cast, { visibility: 'private' })
    expect((await cast.cy.api('GET', `/debates/${open}`)).status).toBe(200)
    expect((await cast.cy.api('GET', `/debates/${secret}`)).status).toBe(404)
    expect((await cast.ben.api('GET', `/debates/${secret}`)).status).toBe(200)
    expect((await cast.ana.api('GET', '/debates/not-an-id')).status).toBe(400)
  })
})

describe('opting an agent in', () => {
  it('lets a person opt their own connected agent in, which makes them a member', async () => {
    const id = (await cast.ana.api('POST', '/debates', { question: QUESTION })).json.id
    const room = (await cast.cy.api('PUT', `/debates/${id}/agent`, { agentId: cast.cyAgent.id })).json
    expect(room.participants).toEqual([
      {
        memberId: cast.cy.me.member.id,
        agentId: cast.cyAgent.id,
        agentName: 'Cy agent',
        joinedAt: expect.any(Number),
        takingPart: true,
      },
    ])
    expect(room.memberIds).toContain(cast.cy.me.member.id)
  })

  it('refuses another person’s agent, a second agent, and a room that is past taking turns', async () => {
    const id = await openedRoom(cast)
    expect((await cast.cy.api('PUT', `/debates/${id}/agent`, { agentId: cast.anaAgent.id })).status).toBe(404)
    expect((await cast.ana.api('PUT', `/debates/${id}/agent`, { agentId: cast.anaAgent.id })).status).toBe(
      409,
    )
    await turnsRunOut(cast, id)
    expect((await cast.cy.api('PUT', `/debates/${id}/agent`, { agentId: cast.cyAgent.id })).status).toBe(409)
  })

  it('holds at most eight agents', async () => {
    const id = (await cast.ana.api('POST', '/debates', { question: QUESTION })).json.id
    for (let index = 0; index < 8; index++) {
      const person = await server.signIn(`person${index}@example.com`, `Person ${index}`)
      const agent = await connectAgent(server, person)
      const agentId = (await agent.api('GET', '/me')).json.credential.id
      expect((await person.api('PUT', `/debates/${id}/agent`, { agentId })).status).toBe(200)
    }
    expect((await cast.cy.api('PUT', `/debates/${id}/agent`, { agentId: cast.cyAgent.id })).status).toBe(409)
  })
})

describe('limits', () => {
  it('lets the creator change the limits while the room is open, moving its deadline', async () => {
    const id = await openedRoom(cast)
    const room = (await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, minutes: 90 })).json
    expect(room.limits.minutes).toBe(90)
    expect(room.deadlineAt - room.createdAt).toBe(90 * 60_000)
    expect(room.status).toBe('open')
  })

  it('sets the grace at setup, keeps it when a change leaves it out, and refuses any but 5, 10 or 30 minutes', async () => {
    const created = (
      await cast.ana.api('POST', '/debates', { question: QUESTION, limits: { ...LIMITS, graceMinutes: 10 } })
    ).json
    expect(created.limits.graceMinutes).toBe(10)
    const id = created.id
    expect(
      (await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, minutes: 40 })).json.limits,
    ).toMatchObject({
      minutes: 40,
      graceMinutes: 10,
    })
    expect(
      (await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, graceMinutes: 30 })).json.limits
        .graceMinutes,
    ).toBe(30)
    expect((await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, graceMinutes: 15 })).status).toBe(
      400,
    )
    expect(
      (await openedRoom(cast).then((room) => cast.ana.api('GET', `/debates/${room}`))).json.limits,
    ).toMatchObject({ graceMinutes: 5 })
  })

  it('refuses a change of the grace once the first turn is taken', async () => {
    const id = await openedRoom(cast)
    await turnsRunOut(cast, id, 1)
    expect((await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, graceMinutes: 30 })).status).toBe(
      409,
    )
  })

  it('refuses limits from anyone but the creator, limits that do not add up, and a room past its turns', async () => {
    const id = await openedRoom(cast)
    expect((await cast.ben.api('PUT', `/debates/${id}/limits`, LIMITS)).status).toBe(403)
    expect((await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, turnsPerAgent: 9 })).status).toBe(
      400,
    )
    await turnsRunOut(cast, id)
    expect((await cast.ana.api('PUT', `/debates/${id}/limits`, LIMITS)).status).toBe(409)
  })

  it('refuses a change of limits once the first turn is taken, with a message that says why', async () => {
    const id = await openedRoom(cast)
    await turnsRunOut(cast, id, 1)
    const refused = await cast.ana.api('PUT', `/debates/${id}/limits`, { ...LIMITS, minutes: 90 })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toMatch(/only at setup, before the first turn/)
    expect((await cast.ana.api('GET', `/debates/${id}`)).json.limits).toEqual({ ...LIMITS, graceMinutes: 5 })
  })

  it('lets a private room’s invitees opt in, and no administrator who was not invited', async () => {
    expect(cast.ana.me.member.role).toBe('admin')
    const id = (
      await cast.ben.api('POST', '/debates', {
        question: QUESTION,
        visibility: 'private',
        memberIds: [cast.cy.me.member.id],
      })
    ).json.id
    expect((await cast.ana.api('GET', `/debates/${id}`)).status).toBe(200)
    const refused = await cast.ana.api('PUT', `/debates/${id}/agent`, { agentId: cast.anaAgent.id })
    expect(refused.status).toBe(403)
    expect(refused.json.error.message).toMatch(/invited/)
    expect((await cast.cy.api('PUT', `/debates/${id}/agent`, { agentId: cast.cyAgent.id })).status).toBe(200)
  })
})

describe('what a room asks of an agent', () => {
  it('asks for a turn where the agent may take one, then for the result, and nothing of a person', async () => {
    const id = await openedRoom(cast)
    const asks = async (agent: typeof cast.anaAgent) =>
      (await agent.api('GET', '/debate-asks')).json.asks.map(
        (ask: { debate: { id: string }; ask: string }) => [ask.debate.id, ask.ask],
      )
    expect(await asks(cast.anaAgent)).toEqual([[id, 'turn']])
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'First.' })
    expect(await asks(cast.anaAgent)).toEqual([])
    expect(await asks(cast.benAgent)).toEqual([[id, 'turn']])
    expect(await asks(cast.cyAgent)).toEqual([])
    await server.clock.advance(LIMITS.minutes * 60_000)
    expect(await asks(cast.anaAgent)).toEqual([[id, 'result']])
    expect((await cast.ana.api('GET', '/debate-asks')).json.asks).toEqual([])
  })
})
