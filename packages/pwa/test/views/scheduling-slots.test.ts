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
const WORK = START + 11 * HOUR
const ID = 'debate_000000000000'

const collecting = (anaAnswer: 'choosing' | 'by_agent' | 'waiting' = 'choosing') =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    schedule: {
      minutes: 60,
      window: { startsAt: WORK, endsAt: WORK + 4 * HOUR },
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

describe('the card to pick free times', () => {
  it('shows the hours of the window and keeps the picks while the flock is drawn again', () => {
    const { shown, context } = opened(collecting(), false)
    expect(shown.querySelectorAll('.scheduling-pick-cell')).toHaveLength(4)
    expect(textOf(shown)).toContain(strings.scheduling.pickTitle)
    expect(shown.querySelector<HTMLButtonElement>('.scheduling-pick-send')!.disabled).toBe(true)
    tick(shown, WORK, true)
    tick(shown, WORK + HOUR, true)
    expect(textOf(shown)).toContain('2 hours picked')
    expect(shown.querySelector<HTMLButtonElement>('.scheduling-pick-send')!.disabled).toBe(false)
    context.state.shownDebate.set(collecting())
    expect(textOf(shown)).toContain('2 hours picked')
    tick(shown, WORK + HOUR, false)
    expect(textOf(shown)).toContain('1 hour picked')
  })

  it('sends the picked hours joined, then the picks start again from what the flock holds', () => {
    const { shown, called } = opened(collecting(), false)
    tick(shown, WORK, true)
    tick(shown, WORK + HOUR, true)
    tick(shown, WORK + 3 * HOUR, true)
    getByRole(shown, 'button', { name: strings.scheduling.pickSend }).click()
    const [sent] = called('setMyFreeTimes')
    expect(sent!.args).toEqual([
      ID,
      [
        { startsAt: WORK, endsAt: WORK + 2 * HOUR },
        { startsAt: WORK + 3 * HOUR, endsAt: WORK + 4 * HOUR },
      ],
    ])
    sent!.then!.done!(undefined)
    expect(textOf(shown)).toContain('0 hours picked')
  })

  it('shows the working hours first and all hours when asked', () => {
    const night = debate({
      type: 'scheduling',
      question: 'Planning sync',
      schedule: {
        minutes: 60,
        window: { startsAt: START, endsAt: START + 24 * HOUR },
        attendees: [
          { memberId: ANA, required: true, answer: 'choosing' },
          { memberId: BEN, required: true, answer: 'waiting' },
        ],
      },
    })
    const { shown, context } = opened(night, false)
    expect(shown.querySelectorAll('.scheduling-pick-cell')).toHaveLength(12)
    expect(textOf(shown)).toContain('GMT+9')
    getByRole(shown, 'button', { name: strings.scheduling.pickShowAll }).click()
    expect(shown.querySelectorAll('.scheduling-pick-cell')).toHaveLength(24)
    context.state.shownDebate.set({ ...night, question: 'Planning' })
    expect(shown.querySelectorAll('.scheduling-pick-cell')).toHaveLength(24)
    getByRole(shown, 'button', { name: strings.scheduling.pickShowWorking }).click()
    expect(shown.querySelectorAll('.scheduling-pick-cell')).toHaveLength(12)
  })

  it('says the person is busy throughout by sending no hour', () => {
    const { shown, called } = opened(collecting(), true)
    getByRole(shown, 'button', { name: strings.scheduling.pickBusy }).click()
    expect(called('setMyFreeTimes')[0]!.args).toEqual([ID, []])
  })

  it('is left out while the person has an agent still to answer for them', () => {
    const answered = collecting('waiting')
    const { shown } = opened(
      { ...answered, participants: [{ memberId: ANA, agentId: null, agentName: 'Laptop', joinedAt: 1 }] },
      true,
    )
    expect(shown.querySelector('.scheduling-pick')).toBeNull()
  })
})
