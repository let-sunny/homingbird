import { makeTestClock } from '@homingbird/kernel'
import { CredentialId, DEFAULT_SCHEDULING_DELEGATION, type MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  ACCEPT_AFTER_MS,
  ACCEPT_GAP_MS,
  INVITE_AFTER_MS,
  TAKE_OUT_AFTER_MS,
} from '../src/scheduling-invitation.ts'
import { ANSWER_AFTER_MS, ANSWER_GAP_MS, OWN_ANSWER_AFTER_MS } from '../src/scheduling-script.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

const DAY = 86_400_000
const HOUR = 3_600_000
const TOMORROW = Date.UTC(2026, 10, 22)
const SUNDAY = Date.UTC(2026, 10, 22)
const WINDOW = { startsAt: NOW, endsAt: NOW + 3 * DAY }

describe('scheduling flocks', () => {
  it('has the visitor’s own agent share free times, settle the flock and have the agents send and accept the invitation', async () => {
    const { api, clock, ana, ben } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana, ben]) }))
    expect(room).toMatchObject({
      type: 'scheduling',
      status: 'open',
      createdBy: VISITOR_ID,
      participants: [{ memberId: VISITOR_ID, agentName: "June's laptop" }],
    })
    expect(room.schedule?.attendees.map((one) => [one.memberId, one.answer])).toEqual([
      [VISITOR_ID, 'waiting'],
      [ana, 'waiting'],
      [ben, 'waiting'],
    ])
    await clock.advance(OWN_ANSWER_AFTER_MS)
    const shared = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(shared.schedule?.attendees.map((one) => one.answer)).toEqual(['by_agent', 'waiting', 'waiting'])
    expect(shared.turns.map((turn) => turn.agentName)).toEqual(["June's laptop"])
    await clock.advance(ANSWER_AFTER_MS + ANSWER_GAP_MS - OWN_ANSWER_AFTER_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(settled.turns.map((turn) => turn.agentName)).toEqual([
      "June's laptop",
      "Ana's laptop",
      "Ben's laptop",
    ])
    expect(settled).toMatchObject({
      status: 'closed',
      result: { result: { kind: 'slot', startsAt: NOW + 2 * HOUR, endsAt: NOW + 3 * HOUR, unanswered: [] } },
    })
    expect(settled.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'adding',
      'waiting_invite',
      'waiting_invite',
    ])
    expect(settled.schedule?.invite).toBeNull()
    await clock.advance(INVITE_AFTER_MS)
    const sent = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(sent.schedule?.attendees.map((one) => one.attendance)).toEqual(['added', 'adding', 'adding'])
    expect(sent.schedule?.invite?.meetingUrl).toMatch(/^https:\/\/meet\.example\.com\//)
    await clock.advance(ACCEPT_AFTER_MS + 2 * ACCEPT_GAP_MS)
    const accepted = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(accepted.schedule?.attendees.map((one) => one.attendance)).toEqual(['added', 'added', 'added'])
  })

  it('settles inside the visitor’s own times once they replace what their agent shared', async () => {
    const { api, clock, ana, ben } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana, ben]) }))
    await clock.advance(OWN_ANSWER_AFTER_MS)
    const replaced = await succeeded(
      api['scheduling.slots.set']({
        params: { id: room.id },
        body: { slots: [{ startsAt: TOMORROW + 8 * HOUR, endsAt: TOMORROW + 18 * HOUR }] },
      }),
    )
    expect(replaced.status).toBe('open')
    expect(replaced.schedule?.attendees[0]?.answer).toBe('by_person')
    await clock.advance(ANSWER_AFTER_MS + ANSWER_GAP_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(settled.result?.result).toMatchObject({
      kind: 'slot',
      startsAt: TOMORROW + 8 * HOUR,
      endsAt: TOMORROW + 9 * HOUR,
    })
    expect(
      (await succeeded(api['debates.list']({}))).debates.find((each) => each.id === room.id),
    ).toMatchObject({ type: 'scheduling', joined: true, mine: { answer: 'by_person', attendance: 'adding' } })
  })

  it('settles with the closest time when the visitor is busy throughout, and takes another go', async () => {
    const { api, clock, ana } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana]) }))
    await clock.advance(OWN_ANSWER_AFTER_MS)
    await succeeded(api['scheduling.slots.set']({ params: { id: room.id }, body: { slots: [] } }))
    await clock.advance(ANSWER_AFTER_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(settled.result?.result).toMatchObject({ kind: 'no_slot', closest: { missing: [VISITOR_ID] } })
    expect(await refused(api['scheduling.attendance.add']({ params: { id: room.id } }))).toMatchObject({
      _tag: 'Conflict',
    })
    const again = await succeeded(
      api['scheduling.retry']({
        params: { id: room.id },
        body: { window: { ...WINDOW, endsAt: NOW + DAY } },
      }),
    )
    expect(again).toMatchObject({
      status: 'open',
      question: 'Planning',
      schedule: { window: { endsAt: NOW + DAY }, attendees: [{ memberId: VISITOR_ID }, { memberId: ana }] },
    })
    expect(await refused(api['scheduling.retry']({ params: { id: again.id }, body: {} }))).toMatchObject({
      _tag: 'Conflict',
    })
  })

  it('leaves a busy optional person out and waits for the visitor’s click when they asked their agent to', async () => {
    const { api, clock, ana, ben } = started()
    await succeeded(api['me.scheduling.set']({ body: { ...DEFAULT_SCHEDULING_DELEGATION, autoAdd: false } }))
    const room = await succeeded(
      api['scheduling.create']({
        body: setup([ben, ana], {
          attendees: [
            { memberId: ben, required: false },
            { memberId: ana, required: true },
          ],
        }),
      }),
    )
    await clock.advance(OWN_ANSWER_AFTER_MS)
    await succeeded(
      api['scheduling.slots.set']({
        params: { id: room.id },
        body: { slots: [{ startsAt: TOMORROW + 9 * HOUR, endsAt: TOMORROW + 11 * HOUR }] },
      }),
    )
    await clock.advance(ANSWER_AFTER_MS + ANSWER_GAP_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(settled.result?.result).toMatchObject({
      kind: 'slot',
      startsAt: TOMORROW + 9 * HOUR,
      optionalBusy: [ben],
    })
    expect(settled.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'asked',
      'not_invited',
      'waiting_invite',
    ])
    const added = await succeeded(api['scheduling.attendance.add']({ params: { id: room.id } }))
    expect(added.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'adding',
      'not_invited',
      'waiting_invite',
    ])
    await clock.advance(INVITE_AFTER_MS + ACCEPT_AFTER_MS + 2 * ACCEPT_GAP_MS)
    const sent = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(sent.schedule?.attendees.map((one) => one.attendance)).toEqual(['added', 'not_invited', 'added'])
    const cancelled = await succeeded(api['scheduling.attendance.remove']({ params: { id: room.id } }))
    expect(cancelled.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'removing',
      'not_invited',
      'cancelled',
    ])
    await clock.advance(TAKE_OUT_AFTER_MS)
    const gone = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(gone.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'removed',
      'not_invited',
      'cancelled',
    ])
    expect(await refused(api['scheduling.attendance.remove']({ params: { id: room.id } }))).toMatchObject({
      _tag: 'Conflict',
    })
  })

  it('asks the visitor to send the invitation themself when they have no agent', async () => {
    const { api, world, clock, ana } = started()
    world.update((records) => ({
      ...records,
      credentials: records.credentials.filter(
        (kept) => !(kept.memberId === VISITOR_ID && kept.credential.kind === 'agent'),
      ),
    }))
    const room = await succeeded(api['scheduling.create']({ body: setup([ana]) }))
    await succeeded(
      api['scheduling.slots.set']({
        params: { id: room.id },
        body: { slots: [{ startsAt: TOMORROW + 8 * HOUR, endsAt: TOMORROW + 18 * HOUR }] },
      }),
    )
    await clock.advance(ANSWER_AFTER_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(settled.schedule?.attendees.map((one) => one.attendance)).toEqual(['by_hand', 'waiting_invite'])
    const added = await succeeded(api['scheduling.attendance.add']({ params: { id: room.id } }))
    expect(added.schedule?.attendees.map((one) => one.attendance)).toEqual(['added', 'adding'])
    const asAna = demoApi(ana, world)
    expect(await refused(asAna.api['scheduling.retry']({ params: { id: room.id }, body: {} }))).toMatchObject(
      { _tag: 'Forbidden' },
    )
  })

  it('offers working hours in the visitor’s own zone when no hours were chosen', async () => {
    const { api, clock, ana, ben } = started()
    const { hours: _hours, timeZone: _zone, ...open } = setup([ana, ben])
    const room = await succeeded(api['scheduling.create']({ body: open }))
    await clock.advance(ANSWER_AFTER_MS + 2 * ANSWER_GAP_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    const result = settled.result?.result
    expect(result?.kind).toBe('slot')
    const hourOf = (at: number): number =>
      Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23' }).format(at))
    if (result?.kind === 'slot') {
      expect(hourOf(result.startsAt)).toBeGreaterThanOrEqual(9)
      expect(hourOf(result.endsAt - 1)).toBeLessThan(18)
    }
  })

  it('shares and settles only inside the weekdays and hours chosen, in the zone of the visitor', async () => {
    const { api, clock, ana } = started()
    const limits = { weekdays: [7], hours: { from: 780, to: 900 }, timeZone: 'UTC' }
    expect(
      await refused(api['scheduling.create']({ body: setup([ana], { ...limits, weekdays: [1, 1] }) })),
    ).toMatchObject({ _tag: 'Invalid' })
    expect(
      await refused(api['scheduling.create']({ body: setup([ana], { weekdays: [5], timeZone: 'UTC' }) })),
    ).toMatchObject({ _tag: 'Invalid' })
    const room = await succeeded(api['scheduling.create']({ body: setup([ana], limits) }))
    expect(room.schedule).toMatchObject(limits)
    await clock.advance(ANSWER_AFTER_MS)
    const settled = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(settled.result?.result).toMatchObject({
      kind: 'slot',
      startsAt: SUNDAY + 13 * HOUR,
      endsAt: SUNDAY + 14 * HOUR,
    })
    const again = await succeeded(api['scheduling.retry']({ params: { id: room.id }, body: {} }))
    expect(again.schedule).toMatchObject(limits)
  })

  it('has the visitor choose when they have no agent, and refuses free times outside the window', async () => {
    const { api, world, ana } = started()
    world.update((records) => ({
      ...records,
      credentials: records.credentials.filter(
        (kept) => !(kept.memberId === VISITOR_ID && kept.credential.kind === 'agent'),
      ),
    }))
    const room = await succeeded(api['scheduling.create']({ body: setup([ana]) }))
    expect(room.participants).toEqual([])
    expect(room.schedule?.attendees[0]?.answer).toBe('waiting')
    expect(
      await refused(
        api['scheduling.slots.set']({
          params: { id: room.id },
          body: { slots: [{ startsAt: WINDOW.endsAt, endsAt: WINDOW.endsAt + HOUR }] },
        }),
      ),
    ).toMatchObject({ _tag: 'Invalid' })
  })

  it('refuses a flock with nobody else, a stranger, a channel, a long window or no title', async () => {
    const { api, ana } = started()
    const problems = await Promise.all(
      [
        setup([]),
        setup([ana, ana]),
        setup([ana], { title: '  ' }),
        setup([ana], { window: { startsAt: NOW, endsAt: NOW + 15 * DAY } }),
        setup([ana], { window: { startsAt: NOW, endsAt: NOW } }),
        setup([ana], { attendees: [{ memberId: 'demobillagnt' as MemberId, required: true }] }),
      ].map((body) => refused(api['scheduling.create']({ body }))),
    )
    expect(problems.map((problem) => problem?._tag)).toEqual(Array(6).fill('Invalid'))
    expect(
      await refused(api['scheduling.slots.set']({ params: { id: 'deb_nothere' }, body: { slots: [] } })),
    ).toMatchObject({ _tag: 'NotFound' })
  })

  it('stops taking free times once the flock has settled', async () => {
    const { api, clock, ana } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana]) }))
    await clock.advance(ANSWER_AFTER_MS)
    expect(
      await refused(api['scheduling.slots.set']({ params: { id: room.id }, body: { slots: [] } })),
    ).toMatchObject({ _tag: 'Conflict' })
  })

  it('keeps what the visitor lets their agent do about meetings', async () => {
    const { api } = demoApi()
    expect(await succeeded(api['me.scheduling.get']({}))).toEqual({
      delegation: DEFAULT_SCHEDULING_DELEGATION,
      agentInUse: 'cred_demojunelapt',
    })
    const changed = { ...DEFAULT_SCHEDULING_DELEGATION, autoAdd: false, brief: 'Mornings only.' }
    expect(await succeeded(api['me.scheduling.set']({ body: changed }))).toMatchObject({
      delegation: changed,
    })
    expect((await succeeded(api['me.scheduling.get']({}))).delegation).toEqual(changed)
    expect(
      await refused(
        api['me.scheduling.set']({ body: { ...changed, agentId: CredentialId.of('demonoagent0') } }),
      ),
    ).toMatchObject({ _tag: 'NotFound' })
  })
})

const started = () => {
  const clock = makeTestClock(NOW)
  const world = createWorld(clock)
  const { api } = demoApi(VISITOR_ID, world)
  return {
    api,
    world,
    clock,
    ana: memberNamed(world, 'Ana Silva'),
    ben: memberNamed(world, 'Ben Okafor'),
  }
}

const setup = (
  people: ReadonlyArray<MemberId>,
  changes: Partial<{
    title: string
    window: { startsAt: number; endsAt: number }
    attendees: ReadonlyArray<{ memberId: MemberId; required: boolean }>
    weekdays: ReadonlyArray<number>
    hours: { from: number; to: number }
    timeZone: string
  }> = {},
) => ({
  title: 'Planning',
  minutes: 60,
  window: WINDOW,
  attendees: people.map((memberId) => ({ memberId, required: true })),
  hours: { from: 0, to: 1440 },
  timeZone: 'UTC',
  ...changes,
})
