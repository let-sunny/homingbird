import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAgentTakingPart } from '../src/domain/debate-rows.ts'
import {
  type Cast,
  LIMITS,
  PAST_GRACE_MS,
  castOf,
  draftedAlone,
  openedRoom,
  resultFor,
  roomOfThree,
  withStatedModels,
} from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer()
  cast = await castOf(server)
})

afterEach(() => server?.close())

describe('a room as it is shown', () => {
  it('leaves out the model each agent stated while the organization keeps note details off', async () => {
    const hidden = await startTestServer({ HB_FEATURES: 'noteDetails=off' })
    const hiddenCast = await castOf(hidden)
    await withStatedModels(hidden)
    const id = await openedRoom(hiddenCast)
    await hiddenCast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'A point.', model: 'model-a' })
    const room = (await hiddenCast.ben.api('GET', `/debates/${id}`)).json
    expect(room.turns[0]).not.toHaveProperty('agentModel')
    expect((await storedRows(hidden, 'debate_turns'))[0]).toMatchObject({ agent_model: 'model-a' })
    await hidden.close()
  })

  it('is the same for every viewer, except that only a person sees which of their agents takes part', async () => {
    const id = await openedRoom(cast)
    const seenBy = async (who: Pick<Cast['ana'], 'api'>) => (await who.api('GET', `/debates/${id}`)).json
    const agentsSeenBy = async (who: Pick<Cast['ana'], 'api'>) =>
      Object.fromEntries(
        (await seenBy(who)).participants.map((one: { memberId: string; agentId: string | null }) => [
          one.memberId,
          one.agentId,
        ]),
      )
    expect(await agentsSeenBy(cast.ana)).toEqual({
      [cast.ana.me.member.id]: cast.anaAgent.id,
      [cast.ben.me.member.id]: null,
    })
    expect(await agentsSeenBy(cast.benAgent)).toEqual({
      [cast.ana.me.member.id]: null,
      [cast.ben.me.member.id]: cast.benAgent.id,
    })
    expect(Object.values(await agentsSeenBy(cast.cy))).toEqual([null, null])
    const { participants: _, ...rest } = await seenBy(cast.cy)
    const { participants: __, ...same } = await seenBy(cast.ana)
    expect(rest).toEqual(same)
  })

  it('counts an agent whose account was deactivated as dropped out at once', async () => {
    const id = await roomOfThree(cast)
    expect(
      (await cast.ana.api('PATCH', `/admin/members/${cast.ben.me.member.id}`, { status: 'deactivated' }))
        .status,
    ).toBe(200)
    const room = (await cast.ana.api('GET', `/debates/${id}`)).json
    expect(
      room.participants.find((one: { memberId: string }) => one.memberId === cast.ben.me.member.id)
        .takingPart,
    ).toBe(false)
  })

  it('shows which agents take part, from their requests within the room’s grace', async () => {
    const id = await openedRoom(cast)
    const takingPart = async () =>
      (await cast.cy.api('GET', `/debates/${id}`)).json.participants.map(
        (one: { memberId: string; takingPart: boolean }) => [one.memberId, one.takingPart],
      )
    expect(await takingPart()).toEqual(
      expect.arrayContaining([
        [cast.ana.me.member.id, true],
        [cast.ben.me.member.id, true],
      ]),
    )
    cast.sleep('ben')
    await server.clock.advance(PAST_GRACE_MS - 2 - cast.elapsed())
    expect(await takingPart()).toEqual(expect.arrayContaining([[cast.ben.me.member.id, true]]))
    await server.clock.advance(2)
    expect(await takingPart()).toEqual(
      expect.arrayContaining([
        [cast.ana.me.member.id, true],
        [cast.ben.me.member.id, false],
      ]),
    )
  })

  it('keeps a brief disconnect from dropping an agent out', async () => {
    const id = await openedRoom(cast)
    await server.clock.advance(PAST_GRACE_MS)
    cast.sleep('ben')
    await server.clock.advance(60_000)
    const ben = (await cast.cy.api('GET', `/debates/${id}`)).json.participants.find(
      (one: { memberId: string }) => one.memberId === cast.ben.me.member.id,
    )
    expect(ben.takingPart).toBe(true)
  })

  it('counts nobody as dropped out until one grace has passed since the server started', async () => {
    const unseen = {
      credential_id: 'cred_never000000',
      last_used_at: null,
      revoked_at: null,
      status: 'active',
    }
    const grace = 5 * 60_000
    expect(isAgentTakingPart(server.env, unseen as never, grace)).toBe(true)
    await server.clock.advance(grace - 1)
    expect(isAgentTakingPart(server.env, unseen as never, grace)).toBe(true)
    await server.clock.advance(2)
    expect(isAgentTakingPart(server.env, unseen as never, grace)).toBe(false)
    expect(
      isAgentTakingPart(server.env, { ...unseen, last_used_at: server.clock.now() } as never, grace),
    ).toBe(true)
    expect(
      isAgentTakingPart(
        server.env,
        { ...unseen, last_used_at: server.clock.now(), revoked_at: 1 } as never,
        grace,
      ),
    ).toBe(false)
  })

  it('applies the grace the room chose at setup, 5, 10 or 30 minutes', async () => {
    const id = await openedRoom(cast, { limits: { ...LIMITS, minutes: 60, graceMinutes: 30 } })
    expect((await cast.cy.api('GET', `/debates/${id}`)).json.limits.graceMinutes).toBe(30)
    cast.sleep('ben')
    await server.clock.advance(20 * 60_000)
    const ben = async () =>
      (await cast.cy.api('GET', `/debates/${id}`)).json.participants.find(
        (one: { memberId: string }) => one.memberId === cast.ben.me.member.id,
      ).takingPart
    expect(await ben()).toBe(true)
    await server.clock.advance(11 * 60_000)
    expect(await ben()).toBe(false)
  })

  it('drops out an agent that holds an event stream but makes no request, once the grace passed', async () => {
    const id = await openedRoom(cast)
    cast.sleep('ben')
    const halfOpen = new AbortController()
    server.env.hub.subscribe(cast.ben.me.member.id as never, 'agent', halfOpen.signal)
    await server.clock.advance(PAST_GRACE_MS)
    const ben = (await cast.cy.api('GET', `/debates/${id}`)).json.participants.find(
      (one: { memberId: string }) => one.memberId === cast.ben.me.member.id,
    )
    expect(server.env.hub.presenceOf(cast.ben.me.member.id as never).agentOnline).toBe(true)
    expect(ben.takingPart).toBe(false)
    halfOpen.abort()
  })

  it('keeps a streaming agent in by its heartbeat, unaudited and written at most every 30 seconds', async () => {
    const id = await openedRoom(cast, { limits: { ...LIMITS, minutes: 60 } })
    cast.sleep('ben')
    const lastUsed = async () =>
      (await storedRows(server, 'credentials')).find((row) => row.id === cast.benAgent.id)?.last_used_at
    for (let minute = 0; minute < 8; minute++) {
      await server.clock.advance(60_000)
      expect((await cast.benAgent.api('GET', '/presence/heartbeat')).json).toEqual({})
    }
    const beatAt = server.clock.now()
    expect(await lastUsed()).toBe(beatAt)
    await server.clock.advance(29_000)
    await cast.benAgent.api('GET', '/presence/heartbeat')
    expect(await lastUsed()).toBe(beatAt)
    const ben = (await cast.cy.api('GET', `/debates/${id}`)).json.participants.find(
      (one: { memberId: string }) => one.memberId === cast.ben.me.member.id,
    )
    expect(ben.takingPart).toBe(true)
    const audited = (await storedRows(server, 'audit_events')).map((entry) => String(entry.event))
    expect(audited.filter((action) => action.includes('heartbeat'))).toEqual([])
  })

  it('counts a remote connector that holds no stream by its requests', async () => {
    const id = await openedRoom(cast, { limits: { ...LIMITS, minutes: 60 } })
    cast.sleep('ben')
    for (let minute = 0; minute < 8; minute++) {
      await server.clock.advance(60_000)
      await cast.benAgent.api('GET', '/debate-asks')
    }
    const ben = (await cast.cy.api('GET', `/debates/${id}`)).json.participants.find(
      (one: { memberId: string }) => one.memberId === cast.ben.me.member.id,
    )
    expect(ben.takingPart).toBe(true)
  })

  it('tells everyone when an open room opens or ends, and only its members about each change in between', async () => {
    const watching = new AbortController()
    const seen: string[] = []
    void (async () => {
      for await (const event of server.env.hub.subscribe(cast.cy.me.member.id, 'hidden', watching.signal))
        if (event.body.type === 'debate.changed') seen.push(event.body.debateId)
    })()
    const id = await openedRoom(cast)
    await server.clock.flush()
    expect(seen).toEqual([id])
    for (const agent of [cast.anaAgent, cast.benAgent, cast.anaAgent, cast.benAgent])
      await agent.api('POST', `/debates/${id}/turns`, { body: 'A point.' })
    await server.clock.flush()
    expect(seen).toEqual([id])
    await draftedAlone(server, cast, id, resultFor(cast))
    await server.clock.flush()
    watching.abort()
    expect(seen).toEqual([id, id])
  })
})
