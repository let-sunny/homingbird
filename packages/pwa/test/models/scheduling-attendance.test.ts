import { AGENT_PICKUP_MS, type AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { schedulingAttendanceModel } from '../../src/models/scheduling-attendance.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, debate, entry, member } from '../support/fixtures.ts'

const NOW = Date.UTC(2026, 10, 19, 12)
const AGENT_PICKUP_MINUTES = AGENT_PICKUP_MS / 60_000
const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])

type Attendance = NonNullable<NonNullable<AsRead.Debate['schedule']>['attendees'][number]['attendance']>

const settled = (
  attendance: Attendance | undefined,
  fields: Parameters<typeof debate>[0] = {},
  invite: { uid: string | null; meetingUrl: string | null } | null = null,
) =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    status: 'closed',
    createdBy: ANA,
    result: {
      draftedBy: null,
      draftedAt: 1,
      result: {
        kind: 'slot',
        startsAt: Date.UTC(2026, 10, 19, 15),
        endsAt: Date.UTC(2026, 10, 19, 16),
        optionalFree: [],
        optionalBusy: [],
        unanswered: [],
      },
    } as never,
    schedule: {
      minutes: 60,
      window: { startsAt: 0, endsAt: 1 },
      attendees: [
        { memberId: ANA, required: true, answer: 'by_agent', attendance: 'added' },
        { memberId: BEN, required: true, answer: 'by_person', ...(attendance && { attendance }) },
      ],
      invite,
    },
    ...fields,
  })

const as = (viewerId: typeof ANA, room: ReturnType<typeof settled>, hasAgent: boolean) =>
  schedulingAttendanceModel({ debate: room, viewerId, hasAgent, directory: [], members, now: NOW })

const deskOf = (viewerId: typeof ANA, running: boolean) => [
  entry(viewerId, 'Viewer', { presence: { humanOnline: true, agentOnline: running } }),
]

/** The viewer's part of the meeting waits on their agent, since a while before now. */
const waitingOnAgent = (viewerId: typeof ANA, minutesAgo: number | null, running: boolean) => {
  const room = settled('adding')
  const schedule = room.schedule!
  return schedulingAttendanceModel({
    debate: {
      ...room,
      closedAt: NOW - 60 * 60_000,
      schedule: {
        ...schedule,
        attendees: schedule.attendees.map((one) =>
          one.memberId === viewerId
            ? {
                ...one,
                attendance: 'adding' as const,
                ...(minutesAgo !== null && { attendanceSince: NOW - minutesAgo * 60_000 }),
              }
            : one,
        ),
      },
    },
    viewerId,
    hasAgent: true,
    directory: deskOf(viewerId, running),
    members,
    now: NOW,
  })!
}

describe('schedulingAttendanceModel', () => {
  it('offers a person with an agent to add the meeting, or to say they cannot come', () => {
    const shown = as(BEN, settled('asked'), true)!
    expect(shown.status).toBe(strings.scheduling.attendance.asked)
    expect(shown.actions).toEqual([
      { name: 'add', label: strings.scheduling.addMeeting, emphasis: 'primary' },
      { name: 'remove', label: strings.scheduling.cannotCome, emphasis: 'plain' },
    ])
    expect(shown.calendarFile).toBeNull()
    expect(shown.removeHint).toBeNull()
  })

  it('offers a person without an agent to say they added it, and the time as a calendar file', () => {
    const shown = as(BEN, settled('by_hand', {}, { uid: 'abc@example.com', meetingUrl: null }), false)!
    expect(shown.status).toBe(strings.scheduling.attendance.by_hand)
    expect(shown.actions.map((action) => action.label)).toEqual([
      strings.scheduling.addedMeetingMyself,
      strings.scheduling.cannotCome,
    ])
    expect(shown.calendarFile?.text).toContain('UID:abc@example.com')
    expect(shown.calendarFile?.text).toContain('ATTENDEE;CN="Ben"')
    expect(shown.calendarFile?.text).toContain('DTSTAMP:20261119T120000Z')
  })

  it('makes a calendar file with an id of its own when no invitation was sent, and none without the opener known', () => {
    const noInvite = as(BEN, settled('asked'), false)!
    expect(noInvite.calendarFile?.text).toContain('UID:debate_000000000000@homingbird')
    expect(
      schedulingAttendanceModel({
        debate: settled('asked'),
        viewerId: BEN,
        hasAgent: false,
        directory: [],
        members: new Map([[BEN, member(BEN, 'Ben')]]),
        now: NOW,
      })!.calendarFile,
    ).toBeNull()
  })

  it('leaves out of the calendar file a person this client does not know', () => {
    const shown = schedulingAttendanceModel({
      debate: settled('asked'),
      viewerId: BEN,
      hasAgent: false,
      directory: [],
      members: new Map([
        [ANA, member(ANA, 'Ana')],
        ['mem_zed000000000' as never, member(ANA, 'Zed')],
      ]),
      now: NOW,
    })!
    expect(shown.calendarFile?.text).toContain('ORGANIZER;CN="Ana"')
    expect(shown.calendarFile?.text).not.toContain('CN="Ben"')
  })

  it('says it waits for the agent while the desk runs, with nothing to do by hand yet', () => {
    for (const [viewer, said] of [
      [ANA, strings.scheduling.waitingOnAgent.opener.awake],
      [BEN, strings.scheduling.waitingOnAgent.attendee.awake],
    ] as const) {
      const shown = waitingOnAgent(viewer, AGENT_PICKUP_MINUTES - 1, true)
      expect(shown.status).toBe(said)
      expect(shown.actions.map((action) => action.name)).toEqual(['remove'])
      expect(shown.calendarFile).toBeNull()
    }
  })

  it('offers the opener to send the invitation themself once the agent left it waiting or the desk is off', () => {
    for (const [minutes, running, said] of [
      [AGENT_PICKUP_MINUTES, true, strings.scheduling.waitingOnAgent.opener.slow],
      [null, true, strings.scheduling.waitingOnAgent.opener.slow],
      [0, false, strings.scheduling.waitingOnAgent.opener.asleep],
    ] as const) {
      const shown = waitingOnAgent(ANA, minutes, running)
      expect(shown.status).toBe(said)
      expect(shown.actions[0]).toEqual({
        name: 'add',
        label: strings.scheduling.sentInviteMyself,
        emphasis: 'primary',
      })
      expect(shown.calendarFile?.text).toContain('ATTENDEE;CN="Ben"')
    }
  })

  it('offers anyone else to add the meeting themself once their agent left it waiting or their desk is off', () => {
    const slow = waitingOnAgent(BEN, AGENT_PICKUP_MINUTES + 5, true)
    expect(slow.status).toBe(strings.scheduling.waitingOnAgent.attendee.slow)
    expect(slow.actions.map((action) => action.label)).toEqual([
      strings.scheduling.addedMeetingMyself,
      strings.scheduling.removeMeeting,
    ])
    expect(slow.calendarFile).not.toBeNull()
    expect(waitingOnAgent(BEN, 0, false).status).toBe(strings.scheduling.waitingOnAgent.attendee.asleep)
  })

  it('gives no calendar file before the invitation is sent, even to a person without an agent', () => {
    expect(as(BEN, settled('waiting_invite'), false)!.calendarFile).toBeNull()
  })

  it('offers to take the meeting out once it is in the calendar, and gives no second add', () => {
    for (const state of ['adding', 'added'] as const) {
      const shown = as(BEN, settled(state), true)!
      expect(shown.actions).toEqual([
        { name: 'remove', label: strings.scheduling.removeMeeting, emphasis: 'plain' },
      ])
    }
  })

  it('asks a person whose agent could not add the meeting to add it by hand, with the calendar file', () => {
    const shown = as(BEN, settled('by_hand'), true)!
    expect(shown.status).toBe(strings.scheduling.attendance.by_hand)
    expect(shown.actions).toEqual([
      { name: 'add', label: strings.scheduling.addedMeetingMyself, emphasis: 'primary' },
      { name: 'remove', label: strings.scheduling.cannotCome, emphasis: 'plain' },
    ])
    expect(shown.calendarFile).not.toBeNull()
  })

  it('offers no add before the invitation is sent, only to say they cannot come', () => {
    expect(as(BEN, settled('waiting_invite'), true)!.actions).toEqual([
      { name: 'remove', label: strings.scheduling.cannotCome, emphasis: 'plain' },
    ])
    const opened = settled('asked')
    const schedule = opened.schedule!
    const waiting = {
      ...opened,
      schedule: {
        ...schedule,
        attendees: schedule.attendees.map((one) =>
          one.memberId === ANA ? { ...one, attendance: 'waiting_invite' as const } : one,
        ),
      },
    }
    expect(as(ANA, waiting, true)!.actions).toEqual([])
    expect(as(ANA, waiting, true)!.removeHint).toBeNull()
  })

  it('offers nothing to a person the meeting has no part for', () => {
    const shown = as(BEN, settled(undefined), true)!
    expect(shown.status).toBe(strings.scheduling.attendance.unknown)
    expect(shown.actions).toEqual([])
  })

  it('tells a person with an agent that it adds meetings and where to change that', () => {
    expect(as(BEN, settled('added'), true)!.delegation).toEqual({
      text: strings.scheduling.delegationNote,
      changeLabel: strings.scheduling.delegationChange,
    })
    expect(as(BEN, settled('added'), false)!.delegation).toBeNull()
  })

  it('says that whoever opened the room cancels the meeting for everyone by taking it out', () => {
    const shown = as(ANA, settled('asked'), true)!
    expect(shown.actions.at(-1)).toEqual({
      name: 'remove',
      label: strings.scheduling.cancelMeeting,
      emphasis: 'plain',
    })
    expect(shown.removeHint).toBe(strings.scheduling.removeCancelsForEveryone)
    expect(as(ANA, settled('asked'), true)!.status).toBe(strings.scheduling.attendance.added)
  })

  it('offers nothing once the person took it out, said they cannot come, or the meeting was cancelled', () => {
    for (const state of ['declined', 'removing', 'removed', 'cancelled'] as const) {
      const shown = as(BEN, settled(state), true)!
      expect(shown.actions).toEqual([])
      expect(shown.removeHint).toBeNull()
    }
    expect(as(BEN, settled('cancelled'), false)!.calendarFile).toBeNull()
  })

  it('says an optional person busy then was not invited, and offers them nothing to click or download', () => {
    const shown = as(BEN, settled('not_invited'), false)!
    expect(shown.status).toBe(strings.scheduling.attendance.not_invited)
    expect(shown.actions).toEqual([])
    expect(shown.calendarFile).toBeNull()
  })

  it('reads a state it does not know as not in the calendar', () => {
    expect(as(BEN, settled('brand_new' as never), true)!.status).toBe(strings.scheduling.attendance.unknown)
  })

  it('links only an http or https meeting address', () => {
    expect(
      as(BEN, settled('added', {}, { uid: null, meetingUrl: 'https://meet.example.com/x' }), true)!
        .meetingUrl,
    ).toBe('https://meet.example.com/x')
    expect(
      as(BEN, settled('added', {}, { uid: null, meetingUrl: 'javascript:alert(1)' }), true)!.meetingUrl,
    ).toBeNull()
    expect(as(BEN, settled('added'), true)!.meetingUrl).toBeNull()
  })

  it('is not there before a time is settled or for someone not invited', () => {
    expect(as(BEN, settled('asked', { status: 'open' }), true)).toBeNull()
    expect(as(BEN, settled('asked', { result: null }), true)).toBeNull()
    expect(as(BEN, settled('asked', { schedule: null }), true)).toBeNull()
    expect(as('mem_zed000000000' as never, settled('asked'), true)).toBeNull()
    const noTime = settled('asked', {
      result: {
        draftedBy: null,
        draftedAt: 1,
        result: { kind: 'no_slot', closest: null, unanswered: [] },
      } as never,
    })
    expect(as(BEN, noTime, true)).toBeNull()
  })
})
