import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { roomKindFields } from '../src/room-summaries.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi } from './support/demo.ts'

describe('room kind fields', () => {
  const [open] = demoApi(VISITOR_ID, createWorld(makeTestClock(NOW))).world.records().debates

  it('adds nothing for a plain debate room', () => {
    expect(roomKindFields(open!, VISITOR_ID)).toEqual({})
  })

  it('says a room came from a suggestion', () => {
    expect(roomKindFields({ ...open!, fromSuggestion: true }, VISITOR_ID)).toEqual({ fromSuggestion: true })
  })

  it('gives a meeting its type and the viewer’s part, and only the type to someone not invited', () => {
    const meeting = {
      ...open!,
      type: 'scheduling' as const,
      schedule: {
        minutes: 30,
        window: { startsAt: NOW, endsAt: NOW + 1 },
        attendees: [{ memberId: VISITOR_ID, required: true, answer: 'by_person' as const }],
      },
    }
    expect(roomKindFields(meeting, VISITOR_ID)).toEqual({
      type: 'scheduling',
      mine: { answer: 'by_person', notices: [] },
    })
    expect(
      roomKindFields({ ...meeting, schedule: { ...meeting.schedule, attendees: [] } }, VISITOR_ID),
    ).toEqual({ type: 'scheduling' })
    expect(
      roomKindFields(
        {
          ...meeting,
          schedule: { ...meeting.schedule, attendees: [{ memberId: VISITOR_ID, required: true }] },
        },
        VISITOR_ID,
      ),
    ).toEqual({ type: 'scheduling', mine: { answer: 'waiting', notices: [] } })
  })
})
