import { FEATURE_OFF_MESSAGE } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Cast, askFirst, castOf } from './debate-support.ts'
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

/** A day after the cast signed in, on the quarter hour, and a span by hours from it. */
const windowStart = () => start
const hours = (from: number, length: number) => ({
  startsAt: windowStart() + from * HOUR,
  endsAt: windowStart() + (from + length) * HOUR,
})

const setupFor = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  title: 'Plan the launch',
  minutes: 60,
  window: { startsAt: windowStart(), endsAt: windowStart() + 8 * HOUR },
  attendees: [
    { memberId: cast.ben.me.member.id, required: true },
    { memberId: cast.cy.me.member.id, required: false },
  ],
  ...overrides,
})

const opened = async (overrides: Readonly<Record<string, unknown>> = {}, by: Session = cast.ana) => {
  const room = await by.api('POST', '/scheduling-rooms', setupFor(overrides))
  if (room.status !== 200) throw new Error(JSON.stringify(room.json))
  return room.json as { id: string; createdAt: number; deadlineAt: number }
}

const withAgents = async () => {
  const room = await opened()
  await cast.optIn(cast.ana, room.id, cast.anaAgent.id)
  await cast.optIn(cast.ben, room.id, cast.benAgent.id)
  return room
}

const roomOf = async (id: string, as: Session = cast.ana) => (await as.api('GET', `/debates/${id}`)).json

describe('opening a scheduling room', () => {
  it('opens a private room whose opener is a required attendee, with a day from now for answers', async () => {
    const room = (await cast.ana.api('POST', '/scheduling-rooms', setupFor({ title: '  Plan the launch ' })))
      .json
    expect(room).toMatchObject({
      type: 'scheduling',
      question: 'Plan the launch',
      visibility: 'private',
      status: 'open',
      createdBy: cast.ana.me.member.id,
      limits: { turnsPerAgent: 1, totalTurns: 3, minutes: 24 * 60, graceMinutes: 5 },
      memberIds: [cast.ana.me.member.id, cast.ben.me.member.id, cast.cy.me.member.id],
      schedule: {
        minutes: 60,
        window: { startsAt: windowStart(), endsAt: windowStart() + 8 * HOUR },
        attendees: [
          { memberId: cast.ana.me.member.id, required: true, answer: 'waiting' },
          { memberId: cast.ben.me.member.id, required: true, answer: 'waiting' },
          { memberId: cast.cy.me.member.id, required: false, answer: 'waiting' },
        ],
        freeSlots: [],
      },
    })
    expect(room.deadlineAt - room.createdAt).toBe(DAY)
    const audited = (await storedRows(server, 'audit_events')).filter((row) => row.event === 'debate.opened')
    expect(audited).toMatchObject([{ target_id: room.id }])
    expect(JSON.stringify((await cast.ana.api('GET', '/debates')).json)).toContain('"type":"scheduling"')
  })

  it('collects answers until an hour before the last start that fits a near window, and for at least two hours', async () => {
    const now = server.clock.now()
    const soon = Math.ceil((now + HOUR) / (15 * 60_000)) * 15 * 60_000
    const near = await opened({ window: { startsAt: soon, endsAt: soon + 6 * HOUR } })
    expect(near.deadlineAt - near.createdAt).toBe(Math.floor((soon + 4 * HOUR - now) / 60_000) * 60_000)
    const tight = await opened({ window: { startsAt: soon, endsAt: soon + 2 * HOUR } })
    expect(tight.deadlineAt - tight.createdAt).toBe(2 * HOUR)
  })

  it('refuses a blank title, a meeting off the quarter hour, a window gone, too long or too short, and people asked wrongly', async () => {
    const refused = [
      { title: '   ' },
      { minutes: 50 },
      { window: { startsAt: server.clock.now() - DAY, endsAt: server.clock.now() - HOUR } },
      { window: { startsAt: windowStart(), endsAt: windowStart() + 15 * DAY } },
      { window: { startsAt: windowStart(), endsAt: windowStart() + 30 * 60_000 } },
      { window: { startsAt: server.clock.now() - DAY, endsAt: server.clock.now() + 30 * 60_000 } },
      { attendees: [{ memberId: cast.ana.me.member.id, required: true }] },
      {
        attendees: [
          { memberId: cast.ben.me.member.id, required: true },
          { memberId: cast.ben.me.member.id, required: false },
        ],
      },
      { attendees: [{ memberId: 'mem_nobody000000', required: true }] },
    ]
    for (const overrides of refused)
      expect([
        overrides,
        (await cast.ana.api('POST', '/scheduling-rooms', setupFor(overrides))).status,
      ]).toEqual([overrides, 400])
    expect(await storedRows(server, 'scheduling_rooms')).toEqual([])
  })

  it('answers that the feature is off while debate rooms are off, even with scheduling rooms on', async () => {
    const settings = (await cast.ana.api('GET', '/admin/settings')).json
    await cast.ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, debateRooms: false, schedulingRooms: true },
    })
    const refused = await cast.ana.api('POST', '/scheduling-rooms', setupFor())
    expect(refused.status).toBe(404)
    expect(refused.json.error.message).toBe(FEATURE_OFF_MESSAGE)
  })

  it('lets only the people asked opt their agent in, even when the room is open', async () => {
    const room = await opened({
      visibility: 'open',
      attendees: [{ memberId: cast.ben.me.member.id, required: true }],
    })
    expect((await cast.cy.api('PUT', `/debates/${room.id}/agent`, { agentId: cast.cyAgent.id })).status).toBe(
      403,
    )
    expect(
      (await cast.ben.api('PUT', `/debates/${room.id}/agent`, { agentId: cast.benAgent.id })).status,
    ).toBe(200)
  })
})

describe('collecting free times from agents', () => {
  it('asks the agents for free slots in turn and settles at the earliest time every required person is free', async () => {
    const room = await withAgents()
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.asks).toMatchObject([
      { ask: 'slots', debate: { id: room.id } },
    ])
    const first = await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, {
      slots: [hours(1, 3), hours(2, 2)],
      note: 'Mornings are best.',
    })
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({
      status: 'open',
      turns: [{ memberId: cast.ana.me.member.id, body: 'Mornings are best.' }],
      schedule: { freeSlots: [{ memberId: cast.ana.me.member.id, slots: [hours(1, 3)] }] },
    })
    expect((await cast.benAgent.api('GET', '/debate-asks')).json.asks).toMatchObject([{ ask: 'slots' }])
    const settled = await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(2.5, 4)] })
    expect(settled.json).toMatchObject({
      status: 'closed',
      result: {
        draftedBy: null,
        result: {
          kind: 'slot',
          ...hours(2.5, 1),
          optionalFree: [],
          optionalBusy: [],
          unanswered: [cast.cy.me.member.id],
        },
      },
    })
    expect(await storedRows(server, 'scheduling_rooms')).toMatchObject([
      { debate_id: room.id, slot_starts_at: hours(2.5, 1).startsAt },
    ])
    const audited = (await storedRows(server, 'audit_events')).filter((row) => row.event === 'debate.settled')
    expect(audited).toHaveLength(1)
    expect(JSON.parse(String(audited[0]!.detail))).toEqual({
      outcome: 'slot',
      answered: 2,
      unanswered: 1,
      droppedOut: [],
    })
    expect((await storedRows(server, 'audit_events')).map((row) => row.event)).not.toContain('debate.closed')
  })

  it('settles with no slot when a required person is busy throughout, an empty list of slots', async () => {
    const room = await withAgents()
    await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 2)] })
    const settled = await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [] })
    expect(settled.json.result.result).toMatchObject({ kind: 'no_slot' })
    const audited = (await storedRows(server, 'audit_events')).find((row) => row.event === 'debate.settled')
    expect(JSON.parse(String(audited!.detail))).toMatchObject({ outcome: 'no_slot', answered: 2 })
  })

  it('lets an agent replace its own person’s free times while the room collects, and nobody else’s', async () => {
    const room = await opened({
      attendees: [
        { memberId: cast.ben.me.member.id, required: true },
        { memberId: cast.cy.me.member.id, required: true },
      ],
    })
    await cast.optIn(cast.ana, room.id, cast.anaAgent.id)
    await cast.optIn(cast.ben, room.id, cast.benAgent.id)
    await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 1)], note: 'Late.' })
    const again = await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, {
      slots: [hours(3, 2)],
      note: 'Afternoons.',
    })
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({
      status: 'open',
      turns: [{ memberId: cast.ana.me.member.id, body: 'Afternoons.' }],
      schedule: { freeSlots: [{ memberId: cast.ana.me.member.id, slots: [hours(3, 2)] }] },
    })
    expect(await storedRows(server, 'debate_turns')).toHaveLength(1)
    const outside = { slots: [{ startsAt: windowStart() - HOUR, endsAt: windowStart() }] }
    expect((await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, outside)).status).toBe(400)
    await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(0, 8)] })
    const benSlots = (await storedRows(server, 'room_free_slots')).filter(
      (row) => row.member_id === cast.ben.me.member.id,
    )
    expect(benSlots).toMatchObject([{ starts_at: hours(0, 8).startsAt, ends_at: hours(0, 8).endsAt }])
    await cast.cy.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(0, 8)] })
    expect((await roomOf(room.id)).result.result).toMatchObject({ kind: 'slot', ...hours(3, 1) })
    expect(
      (await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 1)] })).status,
    ).toBe(409)
  })

  it('lets a person replace the times they chose themself while the room collects', async () => {
    const room = await opened()
    await cast.ana.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(0, 1)] })
    const again = await cast.ana.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(5, 2)] })
    expect(again.json.schedule.freeSlots).toEqual([{ memberId: cast.ana.me.member.id, slots: [hours(5, 2)] }])
  })

  it('refuses slots outside the window, keeping the agent’s place and storing nothing of them', async () => {
    const room = await withAgents()
    const outside = await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, {
      slots: [{ startsAt: windowStart() - HOUR, endsAt: windowStart() + HOUR }],
    })
    expect(outside.status).toBe(400)
    expect(outside.json.error.message).toMatch(/Your place in the room is kept until/)
    expect(await storedRows(server, 'room_free_slots')).toEqual([])
    expect(await storedRows(server, 'debate_turns')).toEqual([])
  })

  it('takes a text turn in no scheduling room, and free slots in no debate', async () => {
    const room = await withAgents()
    expect((await cast.anaAgent.api('POST', `/debates/${room.id}/turns`, { body: 'Tuesday?' })).status).toBe(
      400,
    )
    const debate = (await cast.ana.api('POST', '/debates', { question: 'Ship it?' })).json
    await cast.optIn(cast.ana, debate.id, cast.anaAgent.id)
    expect((await cast.anaAgent.api('POST', `/debates/${debate.id}/slots`, { slots: [] })).status).toBe(409)
  })

  it('refuses a person on the agents’ route, and an agent whose person did not opt it in', async () => {
    const room = await withAgents()
    expect((await cast.ana.api('POST', `/debates/${room.id}/slots`, { slots: [] })).status).toBe(403)
    expect((await cast.cyAgent.api('POST', `/debates/${room.id}/slots`, { slots: [] })).status).toBe(403)
  })

  it('keeps no result to post as a note: the time goes into calendars', async () => {
    const room = await withAgents()
    await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 2)] })
    await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 2)] })
    const posted = await cast.ana.api('POST', `/debates/${room.id}/result/post`, {
      to: cast.ben.me.member.id,
    })
    expect(posted.status).toBe(409)
    expect(await storedRows(server, 'notes')).toEqual([])
  })
})

describe('free times a person chooses themself', () => {
  it('asks the person to choose when their agent cannot read the calendar, and stops waiting on that agent', async () => {
    const room = await withAgents()
    const told = await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, {
      slots: [],
      cannotReadCalendar: true,
    })
    expect(told.status).toBe(200)
    expect(told.json.turns).toEqual([])
    expect(told.json.schedule.attendees[0]).toMatchObject({ answer: 'choosing' })
    expect(told.json.askedTurn).toMatchObject({ memberId: cast.ben.me.member.id, next: [] })
    expect((await cast.anaAgent.api('GET', '/debate-asks')).json.asks).toEqual([])
    expect(
      (await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 1)] })).status,
    ).toBe(409)
    const chosen = await cast.ana.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(3, 2)] })
    expect(chosen.json.schedule.attendees[0]).toMatchObject({ answer: 'by_person' })
    const settled = await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(0, 8)] })
    expect(settled.json.result.result).toMatchObject({ kind: 'slot', ...hours(3, 1) })
  })

  it('refuses free slots alongside saying the calendar cannot be read, and once the agent took its turn', async () => {
    const room = await withAgents()
    const both = { slots: [hours(1, 1)], cannotReadCalendar: true }
    expect((await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, both)).status).toBe(400)
    await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 1)] })
    const late = { slots: [], cannotReadCalendar: true }
    expect((await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, late)).status).toBe(409)
  })

  it('settles from people’s own answers alone, with no agent at all, counting each over their agent’s', async () => {
    const room = await opened()
    expect(
      (await cast.ben.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(0, 2)] })).json.status,
    ).toBe('open')
    await cast.ben.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(4, 2)] })
    const settled = (await cast.ana.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(0, 8)] }))
      .json
    expect(settled).toMatchObject({ status: 'closed', result: { result: { kind: 'slot', ...hours(4, 1) } } })
    expect(
      (await cast.ana.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(0, 8)] })).status,
    ).toBe(409)
  })

  it('lets only an attendee choose, inside the window, and never in a debate', async () => {
    const room = await opened({ visibility: 'open' })
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await dee.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [] })).status).toBe(403)
    const outside = { slots: [{ startsAt: windowStart() + 7 * HOUR, endsAt: windowStart() + 9 * HOUR }] }
    expect((await cast.ben.api('PUT', `/debates/${room.id}/slots/mine`, outside)).status).toBe(400)
    expect(await storedRows(server, 'room_free_slots')).toEqual([])
    const debate = (await cast.ana.api('POST', '/debates', { question: 'Ship it?' })).json
    expect((await cast.ana.api('PUT', `/debates/${debate.id}/slots/mine`, { slots: [] })).status).toBe(409)
  })
})

describe('a scheduling room’s time', () => {
  it('runs from when it opened, so a late first answer leaves the deadline, and leaves out whoever did not answer', async () => {
    const room = await withAgents()
    await server.clock.advance(100 * 60_000)
    const answered = await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 2)] })
    expect(answered.json.deadlineAt).toBe(room.deadlineAt)
    await server.clock.advance(room.deadlineAt - server.clock.now())
    expect((await roomOf(room.id)).result.result).toMatchObject({
      kind: 'slot',
      ...hours(1, 1),
      unanswered: [cast.ben.me.member.id, cast.cy.me.member.id],
    })
  })

  it('settles on a time still ahead in a window that has already begun', async () => {
    const now = server.clock.now()
    const window = { startsAt: now - 2 * HOUR, endsAt: now + 6 * HOUR }
    const room = await opened({ window })
    await cast.ben.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [window] })
    const settled = (await cast.ana.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [window] })).json
    const ahead = Math.ceil(now / (15 * 60_000)) * 15 * 60_000
    expect(settled.result.result).toMatchObject({ kind: 'slot', startsAt: ahead, endsAt: ahead + HOUR })
  })

  it('ends with no turns when no required person answered by the deadline', async () => {
    const room = await opened()
    await cast.cy.api('PUT', `/debates/${room.id}/slots/mine`, { slots: [hours(1, 2)] })
    await server.clock.advance(DAY)
    expect(await roomOf(room.id)).toMatchObject({ status: 'ended', endedBecause: 'no_turns', result: null })
  })
})

describe('opening a scheduling room again', () => {
  it('asks the same people for the same meeting, in a wider window or the same one, once the room settled', async () => {
    const room = await withAgents()
    const retry = (as: Session, body: unknown = {}) => as.api('POST', `/debates/${room.id}/retry`, body)
    expect((await retry(cast.ana)).status).toBe(409)
    await cast.anaAgent.api('POST', `/debates/${room.id}/slots`, { slots: [hours(1, 2)] })
    await cast.benAgent.api('POST', `/debates/${room.id}/slots`, { slots: [] })
    expect((await retry(cast.ben)).status).toBe(403)
    const wider = { startsAt: windowStart(), endsAt: windowStart() + 3 * DAY }
    const again = await retry(cast.ana, { window: wider })
    expect(again.status).toBe(200)
    expect(again.json.id).not.toBe(room.id)
    expect(again.json).toMatchObject({ question: 'Plan the launch', status: 'open', visibility: 'private' })
    expect(again.json.schedule).toMatchObject({
      minutes: 60,
      window: wider,
      attendees: [
        { memberId: cast.ana.me.member.id, required: true },
        { memberId: cast.ben.me.member.id, required: true },
        { memberId: cast.cy.me.member.id, required: false },
      ],
    })
    expect((await retry(cast.ana)).json.schedule.window).toEqual(setupFor().window)
    const debate = (await cast.ana.api('POST', '/debates', { question: 'Ship it?' })).json
    expect((await cast.ana.api('POST', `/debates/${debate.id}/retry`, {})).status).toBe(409)
  })
})
