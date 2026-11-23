import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MeetingNotice } from '../src/domain/meeting-rows.ts'
import { ASKING_FIRST, type Cast, castOf } from './debate-support.ts'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast
let start: number
let told: Array<{ to: string; notice: MeetingNotice }>

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  cast = await castOf(server)
  start = Math.ceil((server.clock.now() + DAY) / (15 * 60_000)) * 15 * 60_000
  told = []
  ;(server.env as { meetingPushSink: unknown }).meetingPushSink = (to: string, notice: MeetingNotice) =>
    told.push({ to, notice })
})

afterEach(() => server?.close())

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** Ana opens a room for an hour-long meeting asking Ben and Cy, or whoever else is named. */
const opened = async (attendees: ReadonlyArray<Session> = [cast.ben, cast.cy]) => {
  const room = await cast.ana.api('POST', '/scheduling-rooms', {
    title: 'Plan the launch',
    minutes: 60,
    window: { startsAt: start, endsAt: start + 8 * HOUR },
    attendees: attendees.map((person) => ({ memberId: person.me.member.id, required: true })),
  })
  if (room.status !== 200) throw new Error(JSON.stringify(room.json))
  return room.json
}

const joinedIn = (room: { participants: ReadonlyArray<{ memberId: string; agentId: string | null }> }) =>
  Object.fromEntries(room.participants.map((participant) => [participant.memberId, participant.agentId]))

describe('an agent its person’s delegation opts in', () => {
  it('joins each room its person is invited to without a click, with their brief, and is named to them the first time', async () => {
    const { ana, ben, cy } = cast
    await ben.api('PUT', '/me/scheduling', { ...ASKING_FIRST, autoJoin: true, brief: 'Mornings are free.' })
    const room = await opened()
    expect(joinedIn(await (await ana.api('GET', `/debates/${room.id}`)).json)).toEqual({
      [ana.me.member.id]: cast.anaAgent.id,
      [ben.me.member.id]: null,
      [cy.me.member.id]: null,
    })
    const participants = await storedRows(server, 'debate_participants')
    expect(participants.find((row) => row.member_id === ben.me.member.id)?.brief).toBe('Mornings are free.')
    expect(participants.find((row) => row.member_id === cy.me.member.id)?.brief).toBeNull()
    expect(
      (await storedRows(server, 'scheduling_attendees')).map((row) => [row.member_id, row.by_delegation]),
    ).toEqual(
      expect.arrayContaining([
        [ana.me.member.id, 1],
        [ben.me.member.id, 1],
        [cy.me.member.id, 1],
      ]),
    )
    expect(told.map(({ to, notice }) => [to, notice.notice])).toEqual([
      [ana.me.member.id, { to: ana.me.member.id, notice: 'joined', agentName: 'Ana agent' }],
      [ben.me.member.id, { to: ben.me.member.id, notice: 'joined', agentName: 'Ben agent' }],
      [cy.me.member.id, { to: cy.me.member.id, notice: 'joined', agentName: 'Cy agent' }],
    ])
    expect(told[0]!.notice).toMatchObject({ debateId: room.id, title: 'Plan the launch', toOpener: true })
    told.length = 0
    await opened([ben])
    expect(told.map(({ notice }) => notice.notice)).toEqual([
      { to: ana.me.member.id, notice: 'joined', agentName: null },
      { to: ben.me.member.id, notice: 'joined', agentName: null },
    ])
    const optedIn = (await storedRows(server, 'audit_events'))
      .filter((row) => row.event === 'debate.agent_opted_in')
      .map((row) => [row.actor_id, row.credential_id, JSON.parse(String(row.detail))])
    expect(optedIn[0]).toEqual([
      ana.me.member.id,
      null,
      { credentialId: cast.anaAgent.id, byDelegation: true },
    ])
    expect(optedIn).toHaveLength(5)
  })

  it('waits for the click of a person who turned it off, whose scope leaves the room out, or who has no agent', async () => {
    const { ana, ben, cy } = cast
    const dee = await server.signIn('dee@example.com', 'Dee')
    await ben.api('PUT', '/me/scheduling', ASKING_FIRST)
    await cy.api('PUT', '/me/scheduling', {
      ...ASKING_FIRST,
      autoJoin: true,
      scope: { ...ASKING_FIRST.scope, maxMinutes: 30 },
    })
    const room = await opened([ben, cy, dee])
    expect(Object.keys(joinedIn((await ana.api('GET', `/debates/${room.id}`)).json))).toEqual([
      ana.me.member.id,
    ])
    expect(told.map(({ to }) => to)).toEqual([ana.me.member.id])
    await cy.api('PUT', '/me/scheduling', {
      ...ASKING_FIRST,
      autoJoin: true,
      scope: { ...ASKING_FIRST.scope, people: [ben.me.member.id] },
    })
    const other = await opened([cy])
    expect(Object.keys(joinedIn((await ana.api('GET', `/debates/${other.id}`)).json))).toEqual([
      ana.me.member.id,
    ])
  })

  it('leaves the person free to change the agent’s brief in the room, and refuses opting it in twice', async () => {
    const { ben } = cast
    const room = await opened()
    expect((await ben.api('PUT', `/debates/${room.id}/brief`, { brief: 'Afternoons too.' })).status).toBe(200)
    expect(
      (await storedRows(server, 'debate_participants')).find((row) => row.member_id === ben.me.member.id)
        ?.brief,
    ).toBe('Afternoons too.')
    expect((await ben.api('PUT', `/debates/${room.id}/agent`, { agentId: cast.benAgent.id })).status).toBe(
      409,
    )
  })
})
