import { lifetime } from '@homingbird/ui'
import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { schedulingRoomModel } from '../../src/models/scheduling-room.ts'
import { strings } from '../../src/strings.ts'
import { debateView } from '../../src/views/debate-room.ts'
import { renderSchedulingRoom } from '../../src/views/scheduling-room.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, debate, entry, me, member, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const meeting = (fields: Parameters<typeof debate>[0] = {}) =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    schedule: {
      minutes: 60,
      window: { startsAt: Date.UTC(2026, 10, 19, 15), endsAt: Date.UTC(2026, 10, 26, 15) },
      attendees: [
        { memberId: ANA, required: true, answer: 'by_person' },
        { memberId: BEN, required: false, answer: 'waiting' },
      ],
    },
    ...fields,
  })

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])

const model = (room: ReturnType<typeof meeting>) =>
  schedulingRoomModel({ debate: room, viewerId: ANA, enabled: true, members, timeZone: 'Asia/Seoul' })

describe('renderSchedulingRoom', () => {
  it('shows the title, who has answered, what each attendee does and that the result is still to come', () => {
    const shown = mount(renderSchedulingRoom(model(meeting({ visibility: 'private' }))))
    expect(shown.querySelector('h1')?.textContent).toBe('Planning sync')
    expect(textOf(shown)).toContain('Answered: 1 of 2')
    expect(textOf(shown)).toContain(strings.scheduling.stage.collecting)
    expect(textOf(shown)).toContain(strings.debates.private)
    expect(shown.querySelectorAll('.scheduling-attendee-list li')).toHaveLength(2)
    expect(shown.querySelector(`li[data-member="${ANA}"]`)?.className).toBe('is-answered')
    expect(textOf(shown)).toContain(strings.scheduling.waitingForResult)
    expect(shown.querySelector('.scheduling-deadline')).not.toBeNull()
  })

  it('shows the time the room settled on and no deadline', () => {
    const slot = {
      kind: 'slot',
      startsAt: 0,
      endsAt: 3_600_000,
      optionalFree: [],
      optionalBusy: [BEN],
      unanswered: [],
    }
    const shown = mount(
      renderSchedulingRoom(
        model(
          meeting({ status: 'closed', result: { draftedBy: null, draftedAt: 1, result: slot } as never }),
        ),
      ),
    )
    expect(shown.querySelector('.scheduling-time, .schedule-time')).not.toBeNull()
    expect(textOf(shown)).toContain('Ben is optional and busy then.')
    expect(shown.querySelector('.scheduling-deadline')).toBeNull()
  })

  it('says why a room it cannot show is not shown', () => {
    const shown = mount(
      renderSchedulingRoom(
        schedulingRoomModel({ debate: meeting(), viewerId: ANA, enabled: false, members }),
      ),
    )
    expect(textOf(shown)).toContain(strings.scheduling.off)
  })

  it('shows the time a room ended without as a plain line', () => {
    const shown = mount(renderSchedulingRoom(model(meeting({ status: 'ended' }))))
    expect(textOf(shown)).toContain(strings.scheduling.endedNoTime)
  })
})

describe('debateView for a scheduling room', () => {
  it('shows a scheduling room as one when the feature is on, and draws it again as the room changes', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
    context.state.shownDebate.set(meeting())
    const shown = mount(debateView(context, lifetime(), me(), 'debate_000000000000', null))
    expect(textOf(shown)).toContain('Answered: 1 of 2')
    context.state.shownDebate.set(meeting({ status: 'ended' }))
    expect(textOf(shown)).toContain(strings.scheduling.endedNoTime)
  })

  it('hides a scheduling room while the feature is off, and a room of a type it does not know', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo())
    context.state.shownDebate.set(meeting())
    const shown = mount(debateView(context, lifetime(), me(), 'debate_000000000000', null))
    expect(textOf(shown)).toContain(strings.scheduling.off)
    context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
    context.state.shownDebate.set(meeting({ type: 'unknown' }))
    expect(textOf(shown)).toContain(strings.scheduling.unsupported)
  })
})
