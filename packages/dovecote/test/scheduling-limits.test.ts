import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, askFirst, castOf } from './debate-support.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast
let midnight: number

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  cast = await castOf(server)
  await askFirst(cast.ana, cast.ben, cast.cy)
  midnight = (Math.floor(server.clock.now() / DAY) + 2) * DAY
})

afterEach(() => server?.close())

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const dayOfWeek = (at: number): number => new Date(at).getUTCDay() || 7
const hours = (from: number, length: number) => ({
  startsAt: midnight + from * HOUR,
  endsAt: midnight + (from + length) * HOUR,
})

const open = (limits: Readonly<Record<string, unknown>>) =>
  cast.ana.api('POST', '/scheduling-rooms', {
    title: 'Plan the launch',
    minutes: 60,
    window: { startsAt: midnight, endsAt: midnight + 8 * HOUR },
    attendees: [{ memberId: cast.ben.me.member.id, required: true }],
    ...limits,
  })

const answerBoth = async (id: string) => {
  await cast.optIn(cast.ana, id, cast.anaAgent.id)
  await cast.optIn(cast.ben, id, cast.benAgent.id)
  await cast.anaAgent.api('POST', `/debates/${id}/slots`, { slots: [hours(0, 8)] })
  return (await cast.benAgent.api('POST', `/debates/${id}/slots`, { slots: [hours(0, 8)] })).json
}

describe('a scheduling room limited to weekdays and hours', () => {
  it('stores the limits, shows them with the room, and keeps them when the room is opened again', async () => {
    const limits = { weekdays: [dayOfWeek(midnight), 7], hours: { from: 180, to: 360 }, timeZone: 'UTC' }
    const room = (await open(limits)).json
    expect(room.schedule).toMatchObject({
      weekdays: expect.arrayContaining(limits.weekdays),
      hours: limits.hours,
      timeZone: 'UTC',
    })
    expect(await storedRows(server, 'scheduling_rooms')).toMatchObject([
      { hours_from: 180, hours_to: 360, time_zone: 'UTC' },
    ])
    await answerBoth(room.id)
    const again = await cast.ana.api('POST', `/debates/${room.id}/retry`, {})
    expect(again.json.schedule).toMatchObject({ hours: limits.hours, timeZone: 'UTC' })
  })

  it('settles inside the chosen hours, not at the first time everyone is free', async () => {
    const room = (await open({ hours: { from: 180, to: 360 }, timeZone: 'UTC' })).json
    expect((await answerBoth(room.id)).result.result).toMatchObject({ kind: 'slot', ...hours(3, 1) })
  })

  it('settles with no slot when everyone is free only outside the chosen hours', async () => {
    const room = (await open({ hours: { from: 180, to: 360 }, timeZone: 'UTC' })).json
    await cast.optIn(cast.ana, room.id, cast.anaAgent.id)
    await cast.optIn(cast.ben, room.id, cast.benAgent.id)
    await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(0, 2)] })
    const settled = await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(0, 2)] })
    expect(settled.json.result.result).toMatchObject({ kind: 'no_slot', closest: null })
  })

  it('refuses limits that leave no time in the window for the meeting', async () => {
    const other = (dayOfWeek(midnight) % 7) + 1
    expect((await open({ weekdays: [other], timeZone: 'UTC' })).status).toBe(400)
    expect((await open({ hours: { from: 180, to: 210 }, timeZone: 'UTC' })).status).toBe(400)
  })

  it('has no limit for a room opened without them', async () => {
    const room = (await open({})).json
    expect(room.schedule.weekdays).toBeUndefined()
    expect((await answerBoth(room.id)).result.result).toMatchObject({ kind: 'slot', ...hours(0, 1) })
  })

  it('refuses limits without a real zone, off the quarter hour, backwards or naming a day twice', async () => {
    const refused = async (limits: Readonly<Record<string, unknown>>) =>
      [400, 422].includes((await open(limits)).status)
    expect(await refused({ hours: { from: 180, to: 360 } })).toBe(true)
    expect(await refused({ weekdays: [1], timeZone: 'Mars/Olympus' })).toBe(true)
    expect(await refused({ timeZone: 'UTC' })).toBe(true)
    expect(await refused({ hours: { from: 190, to: 360 }, timeZone: 'UTC' })).toBe(true)
    expect(await refused({ hours: { from: 360, to: 180 }, timeZone: 'UTC' })).toBe(true)
    expect(await refused({ weekdays: [1, 1], timeZone: 'UTC' })).toBe(true)
    expect(await refused({ weekdays: [8], timeZone: 'UTC' })).toBe(true)
    expect(await storedRows(server, 'scheduling_rooms')).toEqual([])
  })
})
