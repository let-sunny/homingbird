import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { debateView } from '../../src/views/debate-room.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, credential, debate, entry, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const HOUR = 3_600_000
const START = Date.UTC(2026, 10, 19, 12)
const ID = 'debate_000000000000'

const collecting = (anaAnswer: 'choosing' | 'by_agent' = 'choosing') =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    schedule: {
      minutes: 60,
      window: { startsAt: START, endsAt: START + 4 * HOUR },
      attendees: [
        { memberId: ANA, required: true, answer: anaAnswer },
        { memberId: BEN, required: true, answer: 'waiting' },
      ],
    },
  })

const closed = (attendance: 'asked' | 'added') =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    status: 'closed',
    result: {
      draftedBy: null,
      draftedAt: 1,
      result: {
        kind: 'slot',
        startsAt: START + HOUR,
        endsAt: START + 2 * HOUR,
        optionalFree: [],
        optionalBusy: [],
        unanswered: [],
      },
    } as never,
    schedule: {
      minutes: 60,
      window: { startsAt: START, endsAt: START + 4 * HOUR },
      attendees: [
        { memberId: ANA, required: true, answer: 'by_person', attendance },
        { memberId: BEN, required: true, answer: 'by_agent', attendance: 'added' },
      ],
      invite: { uid: 'abc@example.com', meetingUrl: 'https://meet.example.com/x' },
    },
  })

const opened = (room: ReturnType<typeof debate>, withAgent: boolean) => {
  const kit = testContext()
  kit.context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
  kit.context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
  if (withAgent) kit.context.state.agentCredentials.set([credential('cred_agent0000000')])
  kit.context.state.shownDebate.set(room)
  const shown = mount(debateView(kit.context, lifetime(), me(), ID, null))
  return { ...kit, shown }
}

const tick = (shown: HTMLElement, startsAt: number, checked: boolean): void => {
  const box = shown.querySelector<HTMLInputElement>(`.scheduling-pick-cell input[data-start="${startsAt}"]`)!
  box.checked = checked
  fire.event(box, 'change')
}

describe('the card to add or take out a meeting', () => {
  it('lets a person with an agent add the meeting, and shows the link', () => {
    const { shown, called } = opened(closed('asked'), true)
    expect(shown.querySelector('.scheduling-meeting-link')!.getAttribute('href')).toBe(
      'https://meet.example.com/x',
    )
    expect(shown.querySelector('.scheduling-calendar-file')).toBeNull()
    getByRole(shown, 'button', { name: strings.scheduling.addMeeting }).click()
    expect(called('addMeeting')[0]!.args).toEqual([ID])
    getByRole(shown, 'button', { name: strings.scheduling.cancelMeeting }).click()
    expect(called('removeMeeting')[0]!.args).toEqual([ID])
    expect(textOf(shown)).toContain(strings.scheduling.removeCancelsForEveryone)
  })

  it('gives a person without an agent the calendar file and a way to say they added it', () => {
    const { shown, called, page } = opened(closed('asked'), false)
    getByRole(shown, 'button', { name: strings.scheduling.getCalendarFile }).click()
    expect(page.downloads).toHaveLength(1)
    expect(page.downloads[0]!.filename).toBe('meeting.ics')
    expect(page.downloads[0]!.text).toContain('DTSTART:20261119T130000Z')
    getByRole(shown, 'button', { name: strings.scheduling.addedMeetingMyself }).click()
    expect(called('addMeeting')).toHaveLength(1)
  })

  it('offers only to take the meeting out once it is in the calendar', () => {
    const { shown } = opened(closed('added'), true)
    expect(shown.querySelector('.scheduling-add')).toBeNull()
    expect(shown.querySelector('.scheduling-remove')).not.toBeNull()
  })

  it('shows no card before a time is settled', () => {
    const { shown } = opened(collecting('by_agent'), true)
    expect(shown.querySelector('.scheduling-attendance')).toBeNull()
  })
})
