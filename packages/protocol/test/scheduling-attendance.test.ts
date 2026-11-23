import { Result } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MemberId } from '../src/ids.ts'
import type { CalendarOutcome } from '../src/meeting.ts'
import {
  AGENT_PICKUP_MS,
  type Adding,
  type Attendance,
  type AttendanceEvent,
  type AttendanceState,
  type AttendanceStep,
  askWaitingOn,
  confirmAttendance,
  isAgentIdle,
  stepAttendance,
} from '../src/scheduling-attendance.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')
const DAN = MemberId.of('dan000000000')
const PEOPLE = [ANA, BEN, CY] as const

const byAgents = (_: MemberId): Adding => 'agent'

const accepted = (
  attendance: Attendance,
  event: AttendanceEvent,
  addingOf: (memberId: MemberId) => Adding = byAgents,
): AttendanceStep => {
  const step = stepAttendance(attendance, event, addingOf)
  if (!Result.isOk(step)) throw new Error(`refused: ${step.error.message}`)
  return step.value
}

const refusal = (
  attendance: Attendance,
  event: AttendanceEvent,
  addingOf: (memberId: MemberId) => Adding = byAgents,
): string | null => {
  const step = stepAttendance(attendance, event, addingOf)
  return Result.isOk(step) ? null : step.error.message
}

const statesOf = (attendance: Attendance) =>
  Object.fromEntries(attendance.attendees.map((one) => [one.memberId, one.state]))

const report = (memberId: MemberId, outcome: CalendarOutcome): AttendanceEvent => ({
  type: 'report',
  memberId,
  outcome,
})

/** Sent by the opener's agent; everyone else adds as `others` says. */
const sent = (others: (memberId: MemberId) => Adding = byAgents) => {
  const addingOf = (memberId: MemberId): Adding => (memberId === ANA ? 'agent' : others(memberId))
  return accepted(confirmAttendance(ANA, PEOPLE, addingOf, []).attendance, report(ANA, 'sent'), addingOf)
    .attendance
}

describe('a confirmed meeting', () => {
  it('asks the opener’s agent for one invitation, and nobody else for anything yet', () => {
    expect(confirmAttendance(ANA, [BEN, ANA, CY, BEN], byAgents, [])).toEqual({
      attendance: {
        openedBy: ANA,
        attendees: [
          { memberId: ANA, state: 'adding' },
          { memberId: BEN, state: 'waiting_invite' },
          { memberId: CY, state: 'waiting_invite' },
        ],
      },
      asks: [{ memberId: ANA, ask: 'send_invite' }],
      notices: [],
    })
  })

  it('leaves out an optional person busy then, saying so, and never asks, invites or cancels them', () => {
    const step = confirmAttendance(ANA, [ANA, BEN], byAgents, [DAN, BEN, ANA, DAN])
    expect(step.attendance.attendees).toEqual([
      { memberId: ANA, state: 'adding' },
      { memberId: BEN, state: 'waiting_invite' },
      { memberId: DAN, state: 'not_invited' },
    ])
    const sent = accepted(step.attendance, report(ANA, 'sent'), byAgents)
    expect(statesOf(sent.attendance)[DAN]).toBe('not_invited')
    expect(sent.asks.map((ask) => ask.memberId)).not.toContain(DAN)
    for (const type of ['add', 'decline', 'remove'] as const)
      expect(refusal(sent.attendance, { type, memberId: DAN })).toMatch(/not_invited/)
    const cancelled = accepted(sent.attendance, { type: 'remove', memberId: ANA }, byAgents)
    expect(statesOf(cancelled.attendance)[DAN]).toBe('not_invited')
    expect(cancelled.notices.map((notice) => notice.to)).not.toContain(DAN)
  })

  it('asks the opener on a card when their agent waits for a click, or when they send it themself', () => {
    for (const adding of ['agent_after_click', 'person'] as const) {
      const step = confirmAttendance(ANA, PEOPLE, () => adding, [])
      expect(statesOf(step.attendance)[ANA]).toBe(adding === 'person' ? 'by_hand' : 'asked')
      expect(step.asks).toEqual([])
      expect(step.notices).toEqual([{ to: ANA, notice: 'waits' }])
    }
  })
})

describe('the opener’s invitation', () => {
  it('reaches everyone once sent: an agent adds at once, or the person is asked on a card', () => {
    const addingOf = (memberId: MemberId): Adding =>
      memberId === BEN ? 'agent' : memberId === CY ? 'agent_after_click' : 'agent'
    const step = accepted(
      confirmAttendance(ANA, PEOPLE, addingOf, []).attendance,
      report(ANA, 'sent'),
      addingOf,
    )
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'added', [BEN]: 'adding', [CY]: 'asked' })
    expect(step.asks).toEqual([{ memberId: BEN, ask: 'accept_invite' }])
    expect(step.notices).toEqual([
      { to: ANA, notice: 'added' },
      { to: CY, notice: 'waits' },
    ])
  })

  it('is sent by the opener themself when their agent cannot, after which people add it by hand', () => {
    const byHand = () => 'person' as const
    const opened = confirmAttendance(ANA, PEOPLE, byHand, []).attendance
    const step = accepted(opened, { type: 'add', memberId: ANA }, byHand)
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'added', [BEN]: 'by_hand', [CY]: 'by_hand' })
    expect(step.notices).toEqual([
      { to: BEN, notice: 'waits' },
      { to: CY, notice: 'waits' },
    ])
    expect(statesOf(accepted(step.attendance, { type: 'add', memberId: BEN }, byHand).attendance)[BEN]).toBe(
      'added',
    )
  })

  it('waits on the opener’s card when their agent failed or found the time taken', () => {
    const opened = confirmAttendance(ANA, PEOPLE, byAgents, []).attendance
    expect(statesOf(accepted(opened, report(ANA, 'failed')).attendance)[ANA]).toBe('by_hand')
    const busy = accepted(opened, report(ANA, 'conflict'))
    expect(statesOf(busy.attendance)[ANA]).toBe('asked')
    expect(busy.notices).toEqual([{ to: ANA, notice: 'waits' }])
    const again = accepted(busy.attendance, { type: 'add', memberId: ANA })
    expect(again.asks).toEqual([{ memberId: ANA, ask: 'send_invite' }])
  })

  it('is sent by the opener themself once their agent left it idle, reaching everyone as if it had', () => {
    const opened = confirmAttendance(ANA, PEOPLE, byAgents, []).attendance
    expect(refusal(opened, { type: 'add', memberId: ANA })).toMatch(/adding/)
    expect(refusal(opened, { type: 'add', memberId: ANA, agentIdle: false })).toMatch(/adding/)
    const step = accepted(opened, { type: 'add', memberId: ANA, agentIdle: true })
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'added', [BEN]: 'adding', [CY]: 'adding' })
    expect(askWaitingOn(step.attendance, ANA)).toBeNull()
    expect(step.asks).toEqual([
      { memberId: BEN, ask: 'accept_invite' },
      { memberId: CY, ask: 'accept_invite' },
    ])
    const added = accepted(step.attendance, { type: 'add', memberId: BEN, agentIdle: true }).attendance
    expect(statesOf(added)[BEN]).toBe('added')
    expect(refusal(step.attendance, report(ANA, 'sent'))).toMatch(/added/)
  })

  it('counts an agent idle when its desk is off or it has left the meeting waiting ten minutes', () => {
    const since = 1_000_000
    expect(isAgentIdle({ agentOnline: true, since, now: since + AGENT_PICKUP_MS - 1 })).toBe(false)
    expect(isAgentIdle({ agentOnline: true, since, now: since + AGENT_PICKUP_MS })).toBe(true)
    expect(isAgentIdle({ agentOnline: false, since, now: since })).toBe(true)
    expect(AGENT_PICKUP_MS).toBe(10 * 60_000)
  })

  it('is not accepted, added or reported on by anyone else before it is sent', () => {
    const opened = confirmAttendance(ANA, PEOPLE, byAgents, []).attendance
    expect(refusal(opened, report(BEN, 'accepted'))).toBe(
      'Nothing waits for this agent to report accepted: its person’s part of the meeting is waiting_invite.',
    )
    expect(refusal(opened, { type: 'add', memberId: BEN })).toBe(
      'There is nothing for this person to add now: their part of the meeting is waiting_invite.',
    )
    expect(refusal(opened, report(BEN, 'sent'))).toBe(
      'Only the agent of whoever opened the flock reports the invitation sent.',
    )
    expect(refusal(opened, report(ANA, 'accepted'))).toBe(
      'The agent of whoever opened the flock sends and cancels the invitation; it does not report accepted.',
    )
    expect(refusal(opened, report(DAN, 'accepted'))).toBe('This person is not invited to this meeting.')
  })
})

describe('an invited person', () => {
  it('is told when their agent added the meeting, so they can take it out', () => {
    const step = accepted(sent(), report(BEN, 'accepted'))
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'added', [BEN]: 'added', [CY]: 'adding' })
    expect(step.asks).toEqual([])
    expect(step.notices).toEqual([{ to: BEN, notice: 'added' }])
  })

  it('lets their agent add the meeting after their click', () => {
    const afterClick = () => 'agent_after_click' as const
    const step = accepted(sent(afterClick), { type: 'add', memberId: BEN }, afterClick)
    expect(statesOf(step.attendance)[BEN]).toBe('adding')
    expect(step.asks).toEqual([{ memberId: BEN, ask: 'accept_invite' }])
    expect(step.notices).toEqual([])
  })

  it('who takes the meeting out while their agent is adding it asks that agent to decline it instead', () => {
    const step = accepted(sent(), { type: 'remove', memberId: BEN })
    expect(statesOf(step.attendance)[BEN]).toBe('removing')
    expect(step.asks).toEqual([{ memberId: BEN, ask: 'decline_invite' }])
    expect(step.notices).toEqual([{ to: ANA, notice: 'left', memberId: BEN, because: 'took_out' }])
  })

  it('is asked on a card when their agent found the time taken, and the opener is told', () => {
    const step = accepted(sent(), report(BEN, 'conflict'))
    expect(statesOf(step.attendance)[BEN]).toBe('asked')
    expect(step.notices).toEqual([
      { to: BEN, notice: 'waits' },
      { to: ANA, notice: 'busy', memberId: BEN },
    ])
    expect(statesOf(accepted(sent(), report(BEN, 'failed')).attendance)[BEN]).toBe('by_hand')
  })

  it('who cannot come is told to the opener', () => {
    const busy = accepted(sent(), report(BEN, 'conflict')).attendance
    const step = accepted(busy, { type: 'decline', memberId: BEN })
    expect(statesOf(step.attendance)[BEN]).toBe('declined')
    expect(step.notices).toEqual([{ to: ANA, notice: 'left', memberId: BEN, because: 'declined' }])
    expect(refusal(step.attendance, { type: 'decline', memberId: BEN })).toBe(
      'This person can no longer say they cannot come: their part of the meeting is declined.',
    )
    expect(refusal(busy, { type: 'decline', memberId: ANA })).toBe(
      'Whoever opened the flock takes the meeting out instead, which cancels it.',
    )
  })

  it('who takes the meeting out asks only their own agent to decline it, and the opener is told', () => {
    const added = accepted(sent(), report(BEN, 'accepted')).attendance
    const step = accepted(added, { type: 'remove', memberId: BEN })
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'added', [BEN]: 'removing', [CY]: 'adding' })
    expect(step.asks).toEqual([{ memberId: BEN, ask: 'decline_invite' }])
    expect(step.notices).toEqual([{ to: ANA, notice: 'left', memberId: BEN, because: 'took_out' }])
    const done = accepted(step.attendance, report(BEN, 'declined'))
    expect(statesOf(done.attendance)[BEN]).toBe('removed')
    expect(done.notices).toEqual([])
    expect(refusal(done.attendance, { type: 'remove', memberId: BEN })).toBe(
      'There is nothing for this person to take out: their part of the meeting is removed.',
    )
  })

  it('whose agent fails to take the meeting out is counted out and told to take it out themself', () => {
    const added = accepted(sent(), report(BEN, 'accepted')).attendance
    const removing = accepted(added, { type: 'remove', memberId: BEN }).attendance
    const step = accepted(removing, report(BEN, 'failed'))
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'added', [BEN]: 'removed', [CY]: 'adding' })
    expect(step.asks).toEqual([])
    expect(step.notices).toEqual([{ to: BEN, notice: 'remove_by_hand' }])
    expect(accepted(sent(), report(BEN, 'failed')).notices).toEqual([{ to: BEN, notice: 'waits' }])
  })

  it('who added the meeting by hand takes it out by hand', () => {
    const byHand = () => 'person' as const
    const added = accepted(sent(byHand), { type: 'add', memberId: BEN }, byHand).attendance
    const step = accepted(added, { type: 'remove', memberId: BEN }, byHand)
    expect(statesOf(step.attendance)[BEN]).toBe('removed')
    expect(step.asks).toEqual([])
  })
})

describe('what an agent is asked now', () => {
  it('is to send or cancel the invitation for the opener, and to accept or decline it for anyone else', () => {
    const opened = confirmAttendance(ANA, PEOPLE, byAgents, []).attendance
    expect([ANA, BEN, DAN].map((memberId) => askWaitingOn(opened, memberId))).toEqual([
      'send_invite',
      null,
      null,
    ])
    const added = accepted(sent(), report(BEN, 'accepted')).attendance
    expect([ANA, BEN, CY].map((memberId) => askWaitingOn(added, memberId))).toEqual([
      null,
      null,
      'accept_invite',
    ])
    const leaving = accepted(added, { type: 'remove', memberId: BEN }).attendance
    expect(askWaitingOn(leaving, BEN)).toBe('decline_invite')
    const cancelling = accepted(leaving, { type: 'remove', memberId: ANA }).attendance
    expect(askWaitingOn(cancelling, ANA)).toBe('cancel_invite')
    expect(askWaitingOn(cancelling, BEN)).toBeNull()
  })
})

describe('a click that does not fit', () => {
  it('is refused: a decline from the opener, or taking out what is not yet in a calendar', () => {
    const afterClick = () => 'agent_after_click' as const
    const opened = confirmAttendance(ANA, PEOPLE, afterClick, []).attendance
    expect(refusal(opened, { type: 'decline', memberId: ANA }, afterClick)).toBe(
      'Whoever opened the flock takes the meeting out instead, which cancels it.',
    )
    const asked = sent(afterClick)
    expect(refusal(asked, { type: 'remove', memberId: BEN }, afterClick)).toBe(
      'There is nothing for this person to take out: their part of the meeting is asked.',
    )
  })

  it('lets a person say they cannot come before the invitation or on a card to add it by hand', () => {
    const opened = confirmAttendance(ANA, PEOPLE, byAgents, []).attendance
    expect(statesOf(accepted(opened, { type: 'decline', memberId: BEN }).attendance)[BEN]).toBe('declined')
    const byHand = sent(() => 'person')
    expect(statesOf(accepted(byHand, { type: 'decline', memberId: BEN }).attendance)[BEN]).toBe('declined')
  })
})

describe('the opener taking the meeting out', () => {
  it('cancels it: their agent cancels the invitation and everyone not gone is told', () => {
    const declined = accepted(accepted(sent(), report(CY, 'conflict')).attendance, {
      type: 'decline',
      memberId: CY,
    })
    const step = accepted(declined.attendance, { type: 'remove', memberId: ANA })
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'removing', [BEN]: 'cancelled', [CY]: 'declined' })
    expect(step.asks).toEqual([{ memberId: ANA, ask: 'cancel_invite' }])
    expect(step.notices).toEqual([{ to: BEN, notice: 'cancelled' }])
    const done = accepted(step.attendance, report(ANA, 'cancelled'))
    expect(statesOf(done.attendance)[ANA]).toBe('removed')
    expect(done.notices).toEqual([])
  })

  it('leaves whoever already took it out as they are', () => {
    const removed = accepted(
      accepted(accepted(sent(), report(BEN, 'accepted')).attendance, { type: 'remove', memberId: BEN })
        .attendance,
      report(BEN, 'declined'),
    ).attendance
    const step = accepted(removed, { type: 'remove', memberId: ANA })
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'removing', [BEN]: 'removed', [CY]: 'cancelled' })
    expect(step.notices).toEqual([{ to: CY, notice: 'cancelled' }])
  })

  it('leaves cancelling the invitation to them when their agent fails to', () => {
    const cancelling = accepted(sent(), { type: 'remove', memberId: ANA }).attendance
    const step = accepted(cancelling, report(ANA, 'failed'))
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'removed', [BEN]: 'cancelled', [CY]: 'cancelled' })
    expect(step.asks).toEqual([])
    expect(step.notices).toEqual([{ to: ANA, notice: 'remove_by_hand' }])
  })

  it('before sending it by hand cancels it with nothing for an agent to do', () => {
    const byHand = () => 'person' as const
    const step = accepted(
      confirmAttendance(ANA, PEOPLE, byHand, []).attendance,
      { type: 'remove', memberId: ANA },
      byHand,
    )
    expect(statesOf(step.attendance)[ANA]).toBe('removed')
    expect(step.asks).toEqual([])
  })

  it('before anything was sent cancels it with nothing for an agent to do', () => {
    const afterClick = () => 'agent_after_click' as const
    const opened = confirmAttendance(ANA, PEOPLE, afterClick, []).attendance
    const step = accepted(opened, { type: 'remove', memberId: ANA }, afterClick)
    expect(statesOf(step.attendance)).toEqual({ [ANA]: 'removed', [BEN]: 'cancelled', [CY]: 'cancelled' })
    expect(step.asks).toEqual([])
  })
})

describe('any run of clicks and reports', () => {
  const memberOf = fc.constantFrom(ANA, BEN, CY, DAN)
  const outcome = fc.constantFrom<CalendarOutcome>(
    'sent',
    'accepted',
    'declined',
    'cancelled',
    'conflict',
    'failed',
  )
  const eventOf = fc.oneof(
    fc.record({ type: fc.constant('report' as const), memberId: memberOf, outcome }),
    fc.record({
      type: fc.constantFrom('add' as const, 'decline' as const, 'remove' as const),
      memberId: memberOf,
    }),
  )
  const adding = fc.constantFrom<Adding>('agent', 'agent_after_click', 'person')
  const run = fc.record({
    addings: fc.record({ [ANA]: adding, [BEN]: adding, [CY]: adding }),
    events: fc.array(eventOf, { minLength: 1, maxLength: 30 }),
  })

  const walk = (
    addings: Record<string, Adding>,
    events: ReadonlyArray<AttendanceEvent>,
    check: (
      before: Attendance,
      event: AttendanceEvent,
      step: AttendanceStep | null,
      sentEver: boolean,
    ) => void,
  ) => {
    const addingOf = (memberId: MemberId) => addings[memberId] ?? 'agent'
    let attendance = confirmAttendance(ANA, PEOPLE, addingOf, []).attendance
    let sentEver = false
    for (const event of events) {
      const step = stepAttendance(attendance, event, addingOf)
      check(attendance, event, Result.isOk(step) ? step.value : null, sentEver)
      if (!Result.isOk(step)) continue
      attendance = step.value.attendance
      if (statesOf(attendance)[ANA] === 'added') sentEver = true
    }
  }

  it('lets nobody accept, add or be added before the invitation was sent', () => {
    fc.assert(
      fc.property(run, ({ addings, events }) => {
        walk(addings, events, (_, __, step, sentEver) => {
          if (step === null) return
          const reached = statesOf(step.attendance)[ANA] === 'added' || sentEver
          if (reached) return
          for (const one of step.attendance.attendees.filter((one) => one.memberId !== ANA))
            expect(['waiting_invite', 'declined', 'cancelled']).toContain(one.state)
          expect(step.asks.some((ask) => ask.ask === 'accept_invite')).toBe(false)
        })
      }),
    )
  })

  it('changes only the acting person’s part, and the opener’s also the invitation’s reach or its cancelling', () => {
    fc.assert(
      fc.property(run, ({ addings, events }) => {
        walk(addings, events, (before, event, step) => {
          if (step === null) return
          const was = statesOf(before)
          const now = statesOf(step.attendance)
          for (const memberId of PEOPLE) {
            if (memberId === event.memberId || was[memberId] === now[memberId]) continue
            expect(event.memberId).toBe(ANA)
            const reach =
              event.type === 'remove' ? 'cancelled' : (['adding', 'asked', 'by_hand'] as AttendanceState[])
            if (event.type === 'remove') expect(now[memberId]).toBe(reach)
            else {
              expect(was[memberId]).toBe('waiting_invite')
              expect(reach).toContain(now[memberId])
            }
          }
          for (const ask of step.asks) expect(['adding', 'removing']).toContain(now[ask.memberId])
        })
      }),
    )
  })

  it('asks an agent for what its person’s state waits on, and for nothing while it waits on no agent', () => {
    fc.assert(
      fc.property(run, ({ addings, events }) => {
        walk(addings, events, (_, __, step) => {
          if (step === null) return
          for (const ask of step.asks) expect(askWaitingOn(step.attendance, ask.memberId)).toBe(ask.ask)
          for (const one of step.attendance.attendees)
            expect(askWaitingOn(step.attendance, one.memberId) !== null).toBe(
              one.state === 'adding' || one.state === 'removing',
            )
        })
      }),
    )
  })

  it('tells the opener whenever anyone else takes the meeting out or says they cannot come', () => {
    fc.assert(
      fc.property(run, ({ addings, events }) => {
        walk(addings, events, (_, event, step) => {
          if (step === null || event.memberId === ANA) return
          const left = step.notices.some(
            (notice) => notice.to === ANA && notice.notice === 'left' && notice.memberId === event.memberId,
          )
          expect(left).toBe(event.type === 'remove' || event.type === 'decline')
        })
      }),
    )
  })

  it('cancels the meeting for everyone not already gone whenever the opener takes it out', () => {
    fc.assert(
      fc.property(run, ({ addings, events }) => {
        walk(addings, events, (before, event, step) => {
          if (step === null || event.memberId !== ANA || event.type !== 'remove') return
          for (const one of before.attendees.filter((one) => one.memberId !== ANA)) {
            const gone = ['declined', 'removed', 'cancelled'].includes(one.state)
            expect(statesOf(step.attendance)[one.memberId]).toBe(gone ? one.state : 'cancelled')
            expect(
              step.notices.some((notice) => notice.to === one.memberId && notice.notice === 'cancelled'),
            ).toBe(!gone)
          }
        })
      }),
    )
  })
})
