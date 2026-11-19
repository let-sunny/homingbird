import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, castOf, decide, openedRoom, resultFor } from './debate-support.ts'
import { type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let cast: Cast

beforeEach(async () => {
  server = await startTestServer()
  cast = await castOf(server)
})

afterEach(() => server.close())

describe('a room as it is shown', () => {
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

  it('counts approvals only from participants whose member is still active', async () => {
    const id = await openedRoom(cast)
    for (const agent of [cast.anaAgent, cast.benAgent, cast.anaAgent, cast.benAgent])
      await agent.api('POST', `/debates/${id}/turns`, { body: 'A point.' })
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    expect(
      (await cast.ana.api('PATCH', `/admin/members/${cast.ben.me.member.id}`, { status: 'deactivated' }))
        .status,
    ).toBe(200)
    const room = (await cast.ana.api('GET', `/debates/${id}`)).json
    expect(room.approvals.map((one: { memberId: string }) => one.memberId)).toEqual([cast.ana.me.member.id])
    expect((await decide(cast.ana, id, 'approval')).json.status).toBe('closed')
  })

  it('lists one approval per participant, none given until a person approves', async () => {
    const room = (await cast.ana.api('GET', `/debates/${await openedRoom(cast)}`)).json
    expect(room.approvals.map((one: { approvedAt: number | null }) => one.approvedAt)).toEqual([null, null])
    expect(room.result).toBeNull()
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
    await cast.anaAgent.api('PUT', `/debates/${id}/result`, resultFor(cast))
    await decide(cast.ana, id, 'approval')
    await decide(cast.ben, id, 'approval')
    await server.clock.flush()
    watching.abort()
    expect(seen).toEqual([id, id])
  })
})
