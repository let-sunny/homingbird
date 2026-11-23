import { FEATURE_OFF_MESSAGE } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MeetingNotice } from '../src/domain/meeting-rows.ts'
import { type Cast, askFirst, castOf } from './debate-support.ts'
import { type Agent, type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let cast: Cast
let start: number
let told: Array<{ to: string; notice: MeetingNotice }>

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  cast = await castOf(server)
  await askFirst(cast.ana, cast.ben, cast.cy)
  start = Math.ceil((server.clock.now() + DAY) / (15 * 60_000)) * 15 * 60_000
  told = []
  ;(server.env as { meetingPushSink: unknown }).meetingPushSink = (to: string, notice: MeetingNotice) =>
    told.push({ to, notice })
})

afterEach(() => server?.close())

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const INVITE = {
  inviteUid: '7kq2l9b1v0@google.com',
  meetingUrl: 'https://meet.example.com/abc-defg-hij?pwd=s3cr3t',
}

const hours = (from: number, length: number) => ({
  startsAt: start + from * HOUR,
  endsAt: start + (from + length) * HOUR,
})

/**
 * Ana opens a flock asking Ben, required, and Cy, optional; Ana's and Ben's agents share their free times,
 * so the flock settles at once and Cy, who never answered, is invited to add it by hand.
 */
const confirmed = async (visibility: 'open' | 'private' = 'private') => {
  const opened = await cast.ana.api('POST', '/scheduling-rooms', {
    title: 'Plan the launch',
    minutes: 60,
    window: { startsAt: start, endsAt: start + 8 * HOUR },
    attendees: [
      { memberId: cast.ben.me.member.id, required: true },
      { memberId: cast.cy.me.member.id, required: false },
    ],
    visibility,
  })
  const id = opened.json.id as string
  await cast.optIn(cast.ana, id, cast.anaAgent.id)
  await cast.optIn(cast.ben, id, cast.benAgent.id)
  await cast.anaAgent.api('POST', `/debates/${id}/slots`, { slots: [hours(0, 8)] })
  const closed = await cast.benAgent.api('POST', `/debates/${id}/slots`, { slots: [hours(1, 2)] })
  expect(closed.json).toMatchObject({ status: 'closed', result: { result: { kind: 'slot' } } })
  return id
}

/** The invitation sent by Ana's agent after her click. */
const sent = async () => {
  const id = await confirmed()
  await cast.ana.api('POST', `/debates/${id}/attendance`)
  expect((await report(cast.anaAgent, id, { outcome: 'sent', ...INVITE })).status).toBe(200)
  told.length = 0
  return id
}

/** Ben's agent added the meeting after his click. */
const benAdded = async () => {
  const id = await sent()
  await cast.ben.api('POST', `/debates/${id}/attendance`)
  await report(cast.benAgent, id, { outcome: 'accepted' })
  told.length = 0
  return id
}

const report = (agent: Agent, id: string, body: unknown) => agent.api('POST', `/debates/${id}/calendar`, body)

const partsOf = async (id: string, as: Session = cast.ana) =>
  Object.fromEntries(
    (await as.api('GET', `/debates/${id}`)).json.schedule.attendees.map(
      (attendee: { memberId: string; attendance?: string }) => [attendee.memberId, attendee.attendance],
    ),
  )

const meetingsOf = async (agent: Agent) =>
  ((await agent.api('GET', '/debate-asks')).json.meetings as Array<{ ask: string; debate: any }>).map(
    (ask) => ({ id: ask.debate.id, ask: ask.ask, invite: ask.debate.schedule.invite }),
  )

/** What each person was told, each sent to the person it is for. */
const noticesTold = () =>
  told.map(({ to, notice }) => {
    expect(to).toBe(notice.notice.to)
    return notice.notice
  })

describe('a meeting the flock confirmed', () => {
  it('waits on the opener’s click to send one invitation, and asks nobody else anything yet', async () => {
    const id = await confirmed()
    const { ana, ben, cy } = cast
    expect(await partsOf(id)).toEqual({
      [ana.me.member.id]: 'asked',
      [ben.me.member.id]: 'waiting_invite',
      [cy.me.member.id]: 'waiting_invite',
    })
    expect((await ana.api('GET', `/debates/${id}`)).json.schedule.invite).toBeNull()
    expect(noticesTold()).toEqual([{ to: ana.me.member.id, notice: 'waits' }])
    expect(told[0]!.notice).toMatchObject({ debateId: id, title: 'Plan the launch', toOpener: true })
    expect(await meetingsOf(cast.anaAgent)).toEqual([])
    expect(await meetingsOf(cast.benAgent)).toEqual([])
  })

  it('invites no optional person who is busy at that time, and their part says so', async () => {
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
    await cast.cy.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(6, 1)] })
    await cast.ben.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(1, 2)] })
    await cast.ana.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(0, 8)] })
    expect(await partsOf(id)).toEqual({
      [cast.ana.me.member.id]: 'by_hand',
      [cast.ben.me.member.id]: 'waiting_invite',
      [cast.cy.me.member.id]: 'not_invited',
    })
    expect((await cast.cy.api('POST', `/debates/${id}/attendance`)).status).toBe(409)
  })

  it('tells nobody on their devices while web push is off', async () => {
    const settings = (await cast.ana.api('GET', '/admin/settings')).json
    await cast.ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, webPush: false },
    })
    const id = await confirmed()
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('asked')
    expect(told).toEqual([])
  })

  it('starts no meeting for a flock that found no time', async () => {
    const opened = await cast.ana.api('POST', '/scheduling-rooms', {
      title: 'Plan the launch',
      minutes: 60,
      window: { startsAt: start, endsAt: start + 8 * HOUR },
      attendees: [{ memberId: cast.ben.me.member.id, required: true }],
    })
    const id = opened.json.id as string
    await cast.ben.api('PUT', `/debates/${id}/slots/mine`, { slots: [] })
    await cast.ana.api('PUT', `/debates/${id}/slots/mine`, { slots: [hours(0, 8)] })
    expect((await cast.ana.api('GET', `/debates/${id}`)).json.result.result.kind).toBe('no_slot')
    expect((await cast.ana.api('POST', `/debates/${id}/attendance`)).status).toBe(409)
    expect(told).toEqual([])
  })
})

describe('the opener’s one invitation', () => {
  it('is sent by the opener’s agent after their click, with its id and link, and then reaches everyone', async () => {
    const id = await confirmed()
    told.length = 0
    const clicked = await cast.ana.api('POST', `/debates/${id}/attendance`)
    expect(clicked.status).toBe(200)
    expect(await meetingsOf(cast.anaAgent)).toEqual([{ id, ask: 'send_invite', invite: null }])
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'scheduling.meeting_added',
    )
    expect(audited.map((row) => [row.target_id, JSON.parse(String(row.detail))])).toEqual([
      [id, { by: 'agent', byDelegation: false }],
    ])
    expect((await report(cast.anaAgent, id, { outcome: 'sent', ...INVITE })).status).toBe(200)
    expect(await partsOf(id)).toEqual({
      [cast.ana.me.member.id]: 'added',
      [cast.ben.me.member.id]: 'asked',
      [cast.cy.me.member.id]: 'by_hand',
    })
    expect(noticesTold()).toEqual([
      { to: cast.ana.me.member.id, notice: 'added' },
      { to: cast.ben.me.member.id, notice: 'waits' },
      { to: cast.cy.me.member.id, notice: 'waits' },
    ])
    expect(told.map(({ notice }) => notice.toOpener)).toEqual([true, false, false])
    const invite = { uid: INVITE.inviteUid, meetingUrl: INVITE.meetingUrl }
    expect((await cast.cy.api('GET', `/debates/${id}`)).json.schedule.invite).toEqual(invite)
    expect((await cast.benAgent.api('GET', `/debates/${id}`)).json.schedule.invite).toEqual(invite)
    expect(await meetingsOf(cast.anaAgent)).toEqual([])
  })

  it('is sent by the opener themself when their agent cannot, with neither id nor link', async () => {
    const id = await confirmed()
    await cast.ana.api('POST', `/debates/${id}/attendance`)
    await report(cast.anaAgent, id, { outcome: 'failed' })
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('by_hand')
    const byHand = await cast.ana.api('POST', `/debates/${id}/attendance`)
    expect(byHand.json.schedule.invite).toEqual({ uid: null, meetingUrl: null })
    expect((await partsOf(id))[cast.ben.me.member.id]).toBe('asked')
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'scheduling.meeting_added',
    )
    expect(JSON.parse(String(audited.at(-1)!.detail))).toEqual({ by: 'person', byDelegation: false })
  })

  it('is sent by the opener themself once their agent left it waiting, never while it may still pick it up', async () => {
    const id = await confirmed()
    await cast.ana.api('POST', `/debates/${id}/attendance`)
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('adding')
    expect((await cast.anaAgent.api('GET', `/debates/${id}`)).json.schedule.attendees[0]).toMatchObject({
      attendance: 'adding',
      attendanceSince: server.clock.now(),
    })
    expect((await cast.ana.api('POST', `/debates/${id}/attendance`)).status).toBe(409)
    await server.clock.advance(10 * 60_000)
    const byHand = await cast.ana.api('POST', `/debates/${id}/attendance`)
    expect(byHand.status).toBe(200)
    expect(byHand.json.schedule.invite).toEqual({ uid: null, meetingUrl: null })
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('added')
    expect(await meetingsOf(cast.anaAgent)).toEqual([])
  })

  it('is sent by the opener themself at once while their desk is not running', async () => {
    const id = await confirmed()
    await cast.ana.api('POST', `/debates/${id}/attendance`)
    cast.sleep('ana')
    expect((await cast.ana.api('POST', `/debates/${id}/attendance`)).status).toBe(200)
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('added')
  })

  it('waits on the opener’s card again when their agent found the time taken', async () => {
    const id = await confirmed()
    await cast.ana.api('POST', `/debates/${id}/attendance`)
    told.length = 0
    await report(cast.anaAgent, id, { outcome: 'conflict' })
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('asked')
    expect(noticesTold()).toEqual([{ to: cast.ana.me.member.id, notice: 'waits' }])
  })
})

describe('each person’s part', () => {
  it('is added by their agent after their click, and they are told so they can take it out', async () => {
    const id = await sent()
    await cast.ben.api('POST', `/debates/${id}/attendance`)
    expect(await meetingsOf(cast.benAgent)).toEqual([
      { id, ask: 'accept_invite', invite: { uid: INVITE.inviteUid, meetingUrl: INVITE.meetingUrl } },
    ])
    expect((await report(cast.benAgent, id, { outcome: 'accepted' })).status).toBe(200)
    expect((await partsOf(id))[cast.ben.me.member.id]).toBe('added')
    expect(noticesTold()).toEqual([{ to: cast.ben.me.member.id, notice: 'added' }])
    expect(await meetingsOf(cast.benAgent)).toEqual([])
  })

  it('is marked added by a person without an agent, once they put it in their calendar themself', async () => {
    const id = await sent()
    expect((await cast.cy.api('POST', `/debates/${id}/attendance`)).status).toBe(200)
    expect((await partsOf(id))[cast.cy.me.member.id]).toBe('added')
    expect(told).toEqual([])
    expect((await cast.cy.api('POST', `/debates/${id}/attendance`)).status).toBe(409)
  })

  it('goes back to their card when their agent finds the time taken, and the opener is told', async () => {
    const id = await sent()
    await cast.ben.api('POST', `/debates/${id}/attendance`)
    await report(cast.benAgent, id, { outcome: 'conflict' })
    expect((await partsOf(id))[cast.ben.me.member.id]).toBe('asked')
    expect(noticesTold()).toEqual([
      { to: cast.ben.me.member.id, notice: 'waits' },
      { to: cast.ana.me.member.id, notice: 'busy', memberId: cast.ben.me.member.id },
    ])
  })

  it('is taken out by their own agent, and the opener is told', async () => {
    const id = await benAdded()
    const out = await cast.ben.api('DELETE', `/debates/${id}/attendance`)
    expect(out.status).toBe(200)
    expect(await meetingsOf(cast.benAgent)).toEqual([expect.objectContaining({ ask: 'decline_invite' })])
    expect(await meetingsOf(cast.anaAgent)).toEqual([])
    expect(noticesTold()).toEqual([
      { to: cast.ana.me.member.id, notice: 'left', memberId: cast.ben.me.member.id, because: 'took_out' },
    ])
    await report(cast.benAgent, id, { outcome: 'declined' })
    expect(await partsOf(id)).toMatchObject({
      [cast.ana.me.member.id]: 'added',
      [cast.ben.me.member.id]: 'removed',
    })
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'scheduling.meeting_removed',
    )
    expect(audited.map((row) => JSON.parse(String(row.detail)))).toEqual([{ because: 'took_out' }])
  })

  it('is left to the person to take out when their agent fails to, and they are told', async () => {
    const id = await benAdded()
    await cast.ben.api('DELETE', `/debates/${id}/attendance`)
    told.length = 0
    await report(cast.benAgent, id, { outcome: 'failed' })
    expect((await partsOf(id))[cast.ben.me.member.id]).toBe('removed')
    expect(noticesTold()).toEqual([{ to: cast.ben.me.member.id, notice: 'remove_by_hand' }])
  })

  it('is declined by a person who cannot come while it still waits on them', async () => {
    const id = await confirmed()
    told.length = 0
    expect((await cast.cy.api('DELETE', `/debates/${id}/attendance`)).status).toBe(200)
    expect((await partsOf(id))[cast.cy.me.member.id]).toBe('declined')
    expect(noticesTold()).toEqual([
      { to: cast.ana.me.member.id, notice: 'left', memberId: cast.cy.me.member.id, because: 'declined' },
    ])
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'scheduling.meeting_removed',
    )
    expect(audited.map((row) => JSON.parse(String(row.detail)))).toEqual([{ because: 'declined' }])
  })
})

describe('the opener taking the meeting out', () => {
  it('cancels it for everyone: their agent cancels the invitation and everyone else is told', async () => {
    const id = await benAdded()
    expect((await cast.ana.api('DELETE', `/debates/${id}/attendance`)).status).toBe(200)
    expect(await partsOf(id)).toEqual({
      [cast.ana.me.member.id]: 'removing',
      [cast.ben.me.member.id]: 'cancelled',
      [cast.cy.me.member.id]: 'cancelled',
    })
    expect(await meetingsOf(cast.anaAgent)).toEqual([
      { id, ask: 'cancel_invite', invite: { uid: INVITE.inviteUid, meetingUrl: INVITE.meetingUrl } },
    ])
    expect(await meetingsOf(cast.benAgent)).toEqual([])
    expect(noticesTold()).toEqual([
      { to: cast.ben.me.member.id, notice: 'cancelled' },
      { to: cast.cy.me.member.id, notice: 'cancelled' },
    ])
    expect(await storedRows(server, 'scheduling_rooms')).toMatchObject([{ invite_state: 'cancelled' }])
    await report(cast.anaAgent, id, { outcome: 'cancelled' })
    expect((await partsOf(id))[cast.ana.me.member.id]).toBe('removed')
    expect((await cast.ana.api('DELETE', `/debates/${id}/attendance`)).status).toBe(409)
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'scheduling.meeting_removed',
    )
    expect(audited.map((row) => JSON.parse(String(row.detail)))).toEqual([{ because: 'cancelled' }])
  })

  it('before sending anything cancels it with nothing for an agent to do', async () => {
    const id = await confirmed()
    await cast.ana.api('DELETE', `/debates/${id}/attendance`)
    expect(await partsOf(id)).toEqual({
      [cast.ana.me.member.id]: 'removed',
      [cast.ben.me.member.id]: 'cancelled',
      [cast.cy.me.member.id]: 'cancelled',
    })
    expect((await cast.ana.api('GET', `/debates/${id}`)).json.schedule.invite).toBeNull()
    expect(await meetingsOf(cast.anaAgent)).toEqual([])
  })
})

describe('reports and clicks that do not fit', () => {
  it('refuses a person on the agents’ route and an agent on the people’s, changing nothing', async () => {
    const id = await sent()
    const before = await storedRows(server, 'scheduling_attendees')
    expect((await cast.ana.api('POST', `/debates/${id}/calendar`, { outcome: 'failed' })).status).toBe(403)
    for (const method of ['POST', 'DELETE'])
      expect((await cast.benAgent.api(method, `/debates/${id}/attendance`)).status).toBe(403)
    expect(await storedRows(server, 'scheduling_attendees')).toEqual(before)
  })

  it('refuses an agent its person did not opt in, and a person not asked to the meeting', async () => {
    const id = await confirmed('open')
    expect((await report(cast.cyAgent, id, { outcome: 'accepted' })).status).toBe(403)
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await dee.api('POST', `/debates/${id}/attendance`)).status).toBe(403)
    expect((await dee.api('DELETE', `/debates/${id}/attendance`)).status).toBe(403)
  })

  it('refuses an id or link with anything but a sent invitation, and anything beyond the report', async () => {
    const id = await sent()
    await cast.ben.api('POST', `/debates/${id}/attendance`)
    const refused = [
      { outcome: 'accepted', inviteUid: INVITE.inviteUid },
      { outcome: 'accepted', meetingUrl: INVITE.meetingUrl },
      { outcome: 'accepted', title: 'Plan the launch' },
      { outcome: 'sent', meetingUrl: 'javascript:alert(1)' },
    ]
    for (const body of refused)
      expect([body, (await report(cast.benAgent, id, body)).status]).toEqual([body, 400])
    expect((await partsOf(id))[cast.ben.me.member.id]).toBe('adding')
  })

  it('refuses a report on what does not wait on the agent, and before the flock found a time', async () => {
    const id = await sent()
    expect((await report(cast.benAgent, id, { outcome: 'accepted' })).status).toBe(409)
    expect((await report(cast.benAgent, id, { outcome: 'sent', ...INVITE })).status).toBe(409)
    const open = await cast.ana.api('POST', '/scheduling-rooms', {
      title: 'Another',
      minutes: 60,
      window: { startsAt: start, endsAt: start + 8 * HOUR },
      attendees: [{ memberId: cast.ben.me.member.id, required: true }],
    })
    await cast.optIn(cast.ana, open.json.id, cast.anaAgent.id)
    expect((await report(cast.anaAgent, open.json.id, { outcome: 'sent' })).status).toBe(409)
    expect((await cast.ana.api('POST', `/debates/${open.json.id}/attendance`)).status).toBe(409)
  })

  it('answers that the feature is off while scheduling flocks or flocks are off', async () => {
    const id = await sent()
    const settings = (await cast.ana.api('GET', '/admin/settings')).json
    for (const off of [{ schedulingRooms: false }, { debateRooms: false }]) {
      await cast.ana.api('PUT', '/admin/settings', {
        ...settings,
        features: { ...settings.features, schedulingRooms: true, ...off },
      })
      const refused = await cast.ben.api('POST', `/debates/${id}/attendance`)
      expect([off, refused.status, refused.json.error.message]).toEqual([off, 404, FEATURE_OFF_MESSAGE])
    }
  })
})

describe('the invitation as people see it', () => {
  it('is shown to the people invited and their agents only, never to anyone else who can see the flock', async () => {
    const id = await confirmed('open')
    await cast.ana.api('POST', `/debates/${id}/attendance`)
    await report(cast.anaAgent, id, { outcome: 'sent', ...INVITE })
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await dee.api('GET', `/debates/${id}`)).json.schedule.invite).toBeNull()
    expect((await cast.ben.api('GET', `/debates/${id}`)).json.schedule.invite).toMatchObject({
      meetingUrl: INVITE.meetingUrl,
    })
  })

  it('never reaches the audit trail or the log', async () => {
    await benAdded()
    const audited = JSON.stringify(await storedRows(server, 'audit_events'))
    for (const secret of [INVITE.inviteUid, 'meet.example.com', 's3cr3t']) {
      expect(audited).not.toContain(secret)
      expect(server.logged.join('\n')).not.toContain(secret)
    }
  })
})
