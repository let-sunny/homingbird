import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASKING_FIRST, type Cast, askFirst, castOf } from './debate-support.ts'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

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

const hours = (from: number, length: number) => ({
  startsAt: start + from * HOUR,
  endsAt: start + (from + length) * HOUR,
})

/** Ana opens a room asking Ben, required, and Cy, optional; Ana and Ben choose their times themselves. */
const confirmed = async () => {
  const opened = await cast.ana.api('POST', '/scheduling-rooms', {
    title: 'Plan the launch',
    minutes: 60,
    window: { startsAt: start, endsAt: start + 8 * HOUR },
    attendees: [
      { memberId: cast.ben.me.member.id, required: true },
      { memberId: cast.cy.me.member.id, required: false },
    ],
  })
  const id = opened.json.id as string
  await cast.ben.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(1, 2)] })
  await cast.ana.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(0, 8)] })
  return id
}

const mineIn = async (as: Session, id: string) =>
  ((await as.api('GET', '/debates')).json.debates as Array<{ id: string; mine?: unknown }>).find(
    (room) => room.id === id,
  )?.mine

describe('a meeting’s notices', () => {
  it('are kept for the person they are for and listed with their own part of the room, newest first', async () => {
    const id = await confirmed()
    await cast.ana.api('POST', `/debates/${id}/attendance`)
    await server.clock.advance(60_000)
    await cast.ben.api('DELETE', `/debates/${id}/attendance`)
    expect(await mineIn(cast.ana, id)).toEqual({
      answer: 'by_person',
      attendance: 'added',
      notices: [
        {
          notice: 'left',
          memberId: cast.ben.me.member.id,
          because: 'declined',
          agentName: null,
          at: expect.any(Number),
        },
        { notice: 'waits', memberId: null, because: null, agentName: null, at: expect.any(Number) },
      ],
    })
    expect(await mineIn(cast.ben, id)).toMatchObject({
      answer: 'by_person',
      attendance: 'declined',
      notices: [{ notice: 'waits' }],
    })
    expect(await mineIn(cast.cy, id)).toMatchObject({
      answer: 'waiting',
      attendance: 'by_hand',
      notices: [{ notice: 'waits' }],
    })
    const kept = await storedRows(server, 'meeting_notices')
    expect(kept.map((row) => [row.member_id, row.notice])).toEqual(
      expect.arrayContaining([
        [cast.ana.me.member.id, 'waits'],
        [cast.ben.me.member.id, 'waits'],
        [cast.ana.me.member.id, 'left'],
      ]),
    )
  })

  it('are kept when an agent joins by its person’s delegation, naming it the first time', async () => {
    await cast.ben.api('PUT', '/me/scheduling', { ...ASKING_FIRST, autoJoin: true })
    const opened = await cast.ana.api('POST', '/scheduling-rooms', {
      title: 'Plan the launch',
      minutes: 60,
      window: { startsAt: start, endsAt: start + 8 * HOUR },
      attendees: [{ memberId: cast.ben.me.member.id, required: true }],
    })
    expect(await mineIn(cast.ben, opened.json.id)).toMatchObject({
      answer: 'waiting',
      notices: [{ notice: 'joined', agentName: 'Ben agent' }],
    })
  })

  it('give a person in a debate room, and anyone not asked, no part of it', async () => {
    const debate = (await cast.ana.api('POST', '/debates', { question: 'Ship it?' })).json
    expect(await mineIn(cast.ana, debate.id)).toBeUndefined()
    const id = await confirmed()
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect(await dee.api('GET', '/debates')).toMatchObject({ status: 200 })
    expect(await mineIn(dee, id)).toBeUndefined()
  })
})
