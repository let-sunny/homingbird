import { makeTestClock } from '@homingbird/kernel'
import { CredentialId, DEFAULT_SCHEDULING_DELEGATION, type MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { ANSWER_AFTER_MS, ANSWER_GAP_MS } from '../src/scheduling-script.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

const DAY = 86_400_000
const HOUR = 3_600_000
const TOMORROW = Date.UTC(2026, 10, 22)
const WINDOW = { startsAt: NOW, endsAt: NOW + 3 * DAY }

describe('scheduling rooms', () => {
  it('settles at the earliest time everyone is free once the visitor has chosen their own', async () => {
    const { api, clock, ana, ben } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana, ben]) }))
    expect(room).toMatchObject({
      type: 'scheduling',
      status: 'open',
      createdBy: VISITOR_ID,
      participants: [{ memberId: VISITOR_ID, agentName: "June's laptop" }],
    })
    expect(room.schedule?.attendees.map((one) => [one.memberId, one.answer])).toEqual([
      [VISITOR_ID, 'choosing'],
      [ana, 'waiting'],
      [ben, 'waiting'],
    ])
    await clock.advance(ANSWER_AFTER_MS + ANSWER_GAP_MS)
    const asked = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(asked.schedule?.attendees.map((one) => one.answer)).toEqual(['choosing', 'by_agent', 'by_agent'])
    expect(asked.turns.map((turn) => turn.agentName)).toEqual(["Ana's laptop", "Ben's laptop"])
    const answered = await succeeded(
      api['scheduling.slots.set']({
        params: { id: room.id },
        body: { slots: [{ startsAt: TOMORROW + 8 * HOUR, endsAt: TOMORROW + 18 * HOUR }] },
      }),
    )
    expect(answered).toMatchObject({
      status: 'closed',
      result: {
        draftedBy: null,
        result: {
          kind: 'slot',
          startsAt: TOMORROW + 8 * HOUR,
          endsAt: TOMORROW + 9 * HOUR,
          unanswered: [],
        },
      },
    })
    expect(answered.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'by_hand',
      'waiting_invite',
      'waiting_invite',
    ])
    expect(
      (await succeeded(api['debates.list']({}))).debates.find((each) => each.id === room.id),
    ).toMatchObject({
      type: 'scheduling',
      joined: true,
      mine: { answer: 'by_person', attendance: 'by_hand' },
    })
  })

  it('settles with the closest time when the visitor is busy throughout, and takes another go', async () => {
    const { api, clock, ana } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana]) }))
    await clock.advance(ANSWER_AFTER_MS)
    const settled = await succeeded(
      api['scheduling.slots.set']({ params: { id: room.id }, body: { slots: [] } }),
    )
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

  it('leaves a busy optional person out of the invitation and lets the opener add and take out the meeting', async () => {
    const { api, world, clock, ana, ben } = started()
    const room = await succeeded(
      api['scheduling.create']({
        body: setup([ana], {
          attendees: [
            { memberId: ana, required: true },
            { memberId: ben, required: false },
          ],
        }),
      }),
    )
    await clock.advance(ANSWER_AFTER_MS + ANSWER_GAP_MS)
    const settled = await succeeded(
      api['scheduling.slots.set']({
        params: { id: room.id },
        body: { slots: [{ startsAt: TOMORROW + 13 * HOUR, endsAt: TOMORROW + 15 * HOUR }] },
      }),
    )
    expect(settled.result?.result).toMatchObject({
      kind: 'slot',
      startsAt: TOMORROW + 13 * HOUR,
      optionalBusy: [ben],
    })
    expect(settled.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'by_hand',
      'waiting_invite',
      'not_invited',
    ])
    const added = await succeeded(api['scheduling.attendance.add']({ params: { id: room.id } }))
    expect(added.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'added',
      'by_hand',
      'not_invited',
    ])
    const cancelled = await succeeded(api['scheduling.attendance.remove']({ params: { id: room.id } }))
    expect(cancelled.schedule?.attendees.map((one) => one.attendance)).toEqual([
      'removed',
      'cancelled',
      'not_invited',
    ])
    expect(await refused(api['scheduling.attendance.remove']({ params: { id: room.id } }))).toMatchObject({
      _tag: 'Conflict',
    })
    const asAna = demoApi(ana, world)
    expect(await refused(asAna.api['scheduling.retry']({ params: { id: room.id }, body: {} }))).toMatchObject(
      {
        _tag: 'Forbidden',
      },
    )
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

  it('refuses a room with nobody else, a stranger, a channel, a long window or no title', async () => {
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

  it('stops taking free times once the room has settled', async () => {
    const { api, clock, ana } = started()
    const room = await succeeded(api['scheduling.create']({ body: setup([ana]) }))
    await clock.advance(ANSWER_AFTER_MS)
    await succeeded(api['scheduling.slots.set']({ params: { id: room.id }, body: { slots: [] } }))
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
  }> = {},
) => ({
  title: 'Planning',
  minutes: 60,
  window: WINDOW,
  attendees: people.map((memberId) => ({ memberId, required: true })),
  ...changes,
})
