import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEBATE_LIMITS,
  Debate,
  DebateAsk,
  DebateExport,
  DebateLimits,
  DebateLimitsWish,
  DebateSummary,
  MeetingAsk,
  RoomScheduleDetails,
  ScheduleSetup,
  TURNS_PER_AGENT_OFFERED,
} from '../src/debates.ts'
import { ANA, roomOf } from './debate-fixtures.ts'

describe('flock schemas', () => {
  it.each([
    ['Debate', Debate],
    ['DebateSummary', DebateSummary],
    ['DebateAsk', DebateAsk],
    ['DebateExport', DebateExport],
  ] as const)('round-trips every generated %s through JSON', (_, schema) => {
    fc.assert(
      fc.property(arbitrary(schema as typeof Debate), (value) => {
        expect(schema.decode(JSON.parse(JSON.stringify(value)))._tag).toBe('Ok')
      }),
      { numRuns: 25 },
    )
  })

  it('ships default limits that its own schema accepts, three turns per agent and no fixed total', () => {
    expect(DebateLimitsWish.is(DEFAULT_DEBATE_LIMITS)).toBe(true)
    expect(DEFAULT_DEBATE_LIMITS).not.toHaveProperty('totalTurns')
    expect(DEFAULT_DEBATE_LIMITS.turnsPerAgent).toBe(3)
    expect(TURNS_PER_AGENT_OFFERED).toBe(4)
  })

  it('refuses limits outside the bounds people may choose', () => {
    for (const change of [{ totalTurns: 1 }, { turnsPerAgent: 21 }, { minutes: 1 }, { turnCharacters: 50 }]) {
      expect(DebateLimits.is({ ...DEFAULT_DEBATE_LIMITS, totalTurns: 9, ...change })).toBe(false)
      expect(DebateLimitsWish.is({ ...DEFAULT_DEBATE_LIMITS, ...change })).toBe(false)
    }
  })

  it('reads a flock from before types as a debate, and a type it does not know as unknown', () => {
    const stored = JSON.parse(JSON.stringify(roomOf()))
    expect(Debate.decode(stored)).toMatchObject({ _tag: 'Ok', value: { id: stored.id } })
    expect(Debate.read(stored)).toMatchObject({ _tag: 'Ok', value: { id: stored.id } })
    expect(Debate.read({ ...stored, type: 'poll' })).toMatchObject({ value: { type: 'unknown' } })
    expect(Debate.decode({ ...stored, type: 'scheduling' })).toMatchObject({ _tag: 'Ok' })
    expect(Debate.decode({ ...stored, type: 'poll' })).toMatchObject({ _tag: 'Err' })
  })

  it('decodes the result of a debate as before, and one the flock computed with no drafter', () => {
    const stored = JSON.parse(JSON.stringify(roomOf()))
    const slot = { kind: 'slot', startsAt: 1, endsAt: 2, optionalFree: [], optionalBusy: [], unanswered: [] }
    expect(Debate.decode(stored)).toMatchObject({ value: { result: { draftedBy: ANA } } })
    const computed = {
      ...stored,
      type: 'scheduling',
      result: { result: slot, draftedBy: null, draftedAt: 3 },
    }
    expect(Debate.decode(computed)).toMatchObject({ _tag: 'Ok', value: { result: { draftedBy: null } } })
    const later = { ...stored, result: { ...stored.result, result: { kind: 'later' } } }
    expect(Debate.read(later)).toMatchObject({ value: { result: { result: { kind: 'unknown' } } } })
  })

  it('says what a scheduling flock asks, within the lengths a person may choose', () => {
    const asked = {
      minutes: 30,
      window: { startsAt: 1, endsAt: 2 },
      attendees: [{ memberId: ANA, required: true }],
    }
    expect(RoomScheduleDetails.decode(asked)).toMatchObject({ _tag: 'Ok' })
    expect(RoomScheduleDetails.decode({ ...asked, minutes: 10 })).toMatchObject({ _tag: 'Err' })
    const answered = {
      ...asked,
      attendees: [{ memberId: ANA, required: true, answer: 'by_person' }],
      freeSlots: [{ memberId: ANA, slots: [{ startsAt: 1, endsAt: 2 }] }],
    }
    expect(RoomScheduleDetails.decode(answered)).toMatchObject({ _tag: 'Ok' })
    const later = { ...asked, attendees: [{ memberId: ANA, required: true, answer: 'delegated' }] }
    expect(RoomScheduleDetails.read(later)).toMatchObject({ value: { attendees: [{ answer: 'unknown' }] } })
  })

  it('carries each person’s part of the confirmed meeting and the invitation once sent', () => {
    const confirmed = {
      minutes: 30,
      window: { startsAt: 1, endsAt: 2 },
      attendees: [{ memberId: ANA, required: true, answer: 'by_agent', attendance: 'added' }],
      invite: { uid: 'event-1@example.com', meetingUrl: 'https://meet.example.com/x' },
    }
    expect(RoomScheduleDetails.decode(confirmed)).toMatchObject({ _tag: 'Ok' })
    expect(RoomScheduleDetails.decode({ ...confirmed, invite: null })).toMatchObject({ _tag: 'Ok' })
    const later = { ...confirmed, attendees: [{ memberId: ANA, required: true, attendance: 'tentative' }] }
    expect(RoomScheduleDetails.read(later)).toMatchObject({
      value: { attendees: [{ attendance: 'unknown' }] },
    })
  })

  it('asks an agent for free slots in a scheduling flock, and an old client reads that ask as unknown', () => {
    const debate = JSON.parse(JSON.stringify(roomOf()))
    expect(DebateAsk.decode({ debate, ask: 'slots' })).toMatchObject({ _tag: 'Ok' })
    expect(DebateAsk.read({ debate, ask: 'invite' })).toMatchObject({ value: { ask: 'unknown' } })
  })

  it('asks an agent to send, accept, decline or cancel the meeting’s one invitation, apart from its turns', () => {
    const debate = JSON.parse(JSON.stringify(roomOf()))
    for (const ask of ['send_invite', 'accept_invite', 'decline_invite', 'cancel_invite']) {
      expect(MeetingAsk.decode({ debate, ask })).toMatchObject({ _tag: 'Ok', value: { ask } })
      expect(DebateAsk.read({ debate, ask })).toMatchObject({ value: { ask: 'unknown' } })
    }
    expect(MeetingAsk.read({ debate, ask: 'reschedule' })).toMatchObject({ value: { ask: 'unknown' } })
  })

  it('opens a scheduling flock for one to seven other people, its opener being the eighth', () => {
    const setup = {
      title: 'Plan the launch',
      minutes: 30,
      window: { startsAt: 1, endsAt: 2 },
      attendees: [{ memberId: ANA, required: false }],
    }
    expect(ScheduleSetup.decode(setup)).toMatchObject({ _tag: 'Ok' })
    expect(ScheduleSetup.decode({ ...setup, attendees: [] })).toMatchObject({ _tag: 'Err' })
    const eight = Array.from({ length: 8 }, () => ({ memberId: ANA, required: true }))
    expect(ScheduleSetup.decode({ ...setup, attendees: eight })).toMatchObject({ _tag: 'Err' })
    expect(ScheduleSetup.decode({ ...setup, attendees: eight.slice(1) })).toMatchObject({ _tag: 'Ok' })
    expect(ScheduleSetup.decode({ ...setup, title: '' })).toMatchObject({ _tag: 'Err' })
  })
})

describe("a flock summary's outcome", () => {
  const listed = arbitrary(DebateSummary)

  it('is optional and reads an outcome it does not know as unknown', () => {
    const summary = fc.sample(listed, 1)[0]!
    const { outcome: _omitted, ...without } = summary as typeof summary & { outcome?: unknown }
    expect(DebateSummary.decode(JSON.parse(JSON.stringify(without)))._tag).toBe('Ok')
    for (const outcome of ['slot', 'no_slot', 'conclusion', 'no_conclusion'])
      expect(DebateSummary.decode({ ...without, outcome })._tag).toBe('Ok')
    expect(DebateSummary.read({ ...without, outcome: 'from_the_future' })).toMatchObject({
      value: { outcome: 'unknown' },
    })
  })
})
