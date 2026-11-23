import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { ANSWER_AFTER_MS, ruleRoomOf, withAnswer } from '../src/scheduling-script.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, succeeded } from './support/demo.ts'

describe('scheduling script', () => {
  it('keeps one answer per person and marks who gave it', () => {
    const schedule = {
      minutes: 30,
      window: { startsAt: NOW, endsAt: NOW + 3_600_000 },
      attendees: [{ memberId: VISITOR_ID, required: true, answer: 'choosing' as const }],
      freeSlots: [{ memberId: VISITOR_ID, slots: [{ startsAt: NOW, endsAt: NOW + 1 }] }],
    }
    const slots = [{ startsAt: NOW + 10, endsAt: NOW + 20 }]
    expect(withAnswer(schedule, VISITOR_ID, 'by_person', slots)).toMatchObject({
      attendees: [{ answer: 'by_person' }],
      freeSlots: [{ memberId: VISITOR_ID, slots }],
    })
  })

  it('reads agents’ free times as turns and people’s own as their choice', async () => {
    const clock = makeTestClock(NOW)
    const { api, world } = demoApi(VISITOR_ID, createWorld(clock))
    const ana = memberNamed(world, 'Ana Silva')
    const room = await succeeded(
      api['scheduling.create']({
        body: {
          title: 'Sync',
          minutes: 30,
          window: { startsAt: NOW, endsAt: NOW + 86_400_000 },
          attendees: [{ memberId: ana, required: true }],
        },
      }),
    )
    await clock.advance(ANSWER_AFTER_MS)
    const asked = ruleRoomOf(world.records().debates.find((each) => each.id === room.id)!)
    expect(asked.turns.map((turn) => turn.memberId)).toEqual([VISITOR_ID, ana])
    expect(asked.schedule?.chosenByPeople).toEqual([])
  })
})
