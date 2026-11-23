import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { INVITE_AFTER_MS, agentsContinue } from '../src/scheduling-invitation.ts'
import { ANSWER_AFTER_MS, ANSWER_GAP_MS } from '../src/scheduling-script.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, succeeded } from './support/demo.ts'

describe('the agents of a settled room', () => {
  it('send the invitation once, however often they are asked to continue', async () => {
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
    await clock.advance(ANSWER_AFTER_MS + ANSWER_GAP_MS)
    agentsContinue(world, room.id, () => 'agent')
    agentsContinue(world, room.id, () => 'agent')
    await clock.advance(INVITE_AFTER_MS)
    const sent = world.records().debates.find((each) => each.id === room.id)!
    expect(sent.schedule?.attendees.map((one) => one.attendance)).toEqual(['added', 'adding'])
    expect(sent.schedule?.invite?.uid).toContain(room.id)
  })
})
