import { Task as T } from '@homingbird/kernel'
import type { DebateId, MemberId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addingsOf, attendanceOf, meetingAgentOf } from '../src/domain/meeting-rows.ts'
import { ASKING_FIRST, type Cast, askFirst, castOf } from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast
let start: number

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  cast = await castOf(server)
  await askFirst(cast.ana, cast.ben, cast.cy)
  start = Math.ceil((server.clock.now() + DAY) / (15 * 60_000)) * 15 * 60_000
})

afterEach(() => server?.close())

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** Ben opens a room asking Cy; both opt their agents in, and only Ben's shares free slots. */
const openedWithAgents = async () => {
  const id = (
    await cast.ben.api('POST', '/scheduling-rooms', {
      title: 'Plan the launch',
      minutes: 60,
      window: { startsAt: start, endsAt: start + 8 * HOUR },
      attendees: [{ memberId: cast.cy.me.member.id, required: true }],
    })
  ).json.id as string
  await cast.optIn(cast.ben, id, cast.benAgent.id)
  await cast.optIn(cast.cy, id, cast.cyAgent.id)
  await cast.benAgent.api('POST', `/debates/${id}/slots`, {
    slots: [{ startsAt: start, endsAt: start + HOUR }],
  })
  return id as DebateId
}

const ben = () => cast.ben.me.member.id as MemberId
const cy = () => cast.cy.me.member.id as MemberId

describe('a meeting as it is stored', () => {
  it('has no attendance before the room found a time', async () => {
    const id = await openedWithAgents()
    const row = { id, created_by: ben() }
    expect(await T.runPromise(attendanceOf(row), server.env)).toBeNull()
  })

  it('is added by the agent that shared its person’s free slots, and by hand by anyone else', async () => {
    const id = await openedWithAgents()
    const addingOf = await T.runPromise(addingsOf(id), server.env)
    expect([addingOf(ben()), addingOf(cy())]).toEqual(['agent_after_click', 'person'])
  })

  it('is added by that agent at once where its person’s delegation covers the meeting', async () => {
    const id = await openedWithAgents()
    await cast.cyAgent.api('POST', `/debates/${id}/slots`, {
      slots: [{ startsAt: start, endsAt: start + HOUR }],
    })
    await cast.ben.api('PUT', '/me/scheduling', { ...ASKING_FIRST, autoAdd: true })
    await cast.cy.api('PUT', '/me/scheduling', {
      ...ASKING_FIRST,
      autoAdd: true,
      scope: { ...ASKING_FIRST.scope, maxMinutes: 30 },
    })
    const addingOf = await T.runPromise(addingsOf(id), server.env)
    expect([addingOf(ben()), addingOf(cy())]).toEqual(['agent', 'agent_after_click'])
  })

  it('is added by hand once that agent’s credential is revoked', async () => {
    const id = await openedWithAgents()
    expect((await cast.ben.api('DELETE', `/credentials/${cast.benAgent.id}`)).status).toBe(200)
    const addingOf = await T.runPromise(addingsOf(id), server.env)
    expect(addingOf(ben())).toBe('person')
  })

  it('is acted on in each person’s calendar by the agent they opted in, and by no agent for anyone else', async () => {
    const id = await openedWithAgents()
    expect(await T.runPromise(meetingAgentOf(id, cy()), server.env)).toBe(cast.cyAgent.id)
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect(await T.runPromise(meetingAgentOf(id, dee.me.member.id as MemberId), server.env)).toBeNull()
    expect(await storedRows(server, 'scheduling_attendees')).toMatchObject([{ state: null }, { state: null }])
  })
})
