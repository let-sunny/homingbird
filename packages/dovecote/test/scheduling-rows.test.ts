import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, askFirst, castOf } from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast
let start: number

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  cast = await castOf(server)
  await askFirst(cast.ana, cast.ben, cast.cy)
  start = Math.ceil((server.clock.now() + DAY) / QUARTER_HOUR) * QUARTER_HOUR
})

afterEach(() => server?.close())

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const QUARTER_HOUR = 15 * 60_000

const hours = (from: number, length: number) => ({
  startsAt: start + from * HOUR,
  endsAt: start + (from + length) * HOUR,
})

const openedWithAgents = async (visibility: 'open' | 'private' = 'private') => {
  const room = (
    await cast.ben.api('POST', '/scheduling-rooms', {
      title: 'Plan the launch',
      minutes: 30,
      window: { startsAt: start, endsAt: start + 8 * HOUR },
      attendees: [{ memberId: cast.cy.me.member.id, required: true }],
      visibility,
    })
  ).json as { id: string }
  await cast.optIn(cast.ben, room.id, cast.benAgent.id)
  await cast.optIn(cast.cy, room.id, cast.cyAgent.id)
  return room.id
}

describe('a scheduling flock’s stored free slots', () => {
  it('keeps overlapping and touching slots as one span per start, for an agent and for a person', async () => {
    const id = await openedWithAgents()
    await cast.benAgent.api('POST', `/debates/${id}/slots`, {
      slots: [hours(1, 1), hours(1, 2), hours(3, 1), hours(5, 1)],
    })
    await cast.cy.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(2, 1), hours(2, 1)] })
    const rows = (await storedRows(server, 'room_free_slots')).map((row) => ({
      member: row.member_id,
      startsAt: Number(row.starts_at),
      endsAt: Number(row.ends_at),
      byPerson: row.by_person === null ? null : Number(row.by_person),
    }))
    expect(rows).toEqual(
      expect.arrayContaining([
        { member: cast.ben.me.member.id, ...hours(1, 3), byPerson: null },
        { member: cast.ben.me.member.id, ...hours(5, 1), byPerson: null },
        { member: cast.cy.me.member.id, ...hours(2, 1), byPerson: 1 },
      ]),
    )
    expect(rows).toHaveLength(3)
  })

  it('shows each attendee’s free times only to them and their own agent', async () => {
    const id = await openedWithAgents('open')
    await cast.benAgent.api('POST', `/debates/${id}/slots`, { slots: [hours(1, 1)] })
    const bens = [{ memberId: cast.ben.me.member.id, slots: [hours(1, 1)] }]
    expect((await cast.ben.api('GET', `/debates/${id}`)).json.schedule.freeSlots).toEqual(bens)
    expect((await cast.cy.api('GET', `/debates/${id}`)).json.schedule.freeSlots).toEqual([])
    expect((await cast.benAgent.api('GET', `/debates/${id}`)).json.schedule.freeSlots).toEqual(bens)
    expect((await cast.cyAgent.api('GET', `/debates/${id}`)).json.schedule.freeSlots).toEqual([])
    const dee = await server.signIn('dee@example.com', 'Dee')
    const seen = (await dee.api('GET', `/debates/${id}`)).json
    expect(seen.schedule.freeSlots).toEqual([])
    expect(seen.schedule.attendees).toMatchObject([{ answer: 'by_agent' }, { answer: 'waiting' }])
    expect(JSON.stringify((await cast.cyAgent.api('GET', '/debate-asks')).json)).not.toContain(
      String(hours(1, 1).startsAt),
    )
  })
})
