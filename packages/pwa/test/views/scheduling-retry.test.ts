import { lifetime } from '@homingbird/ui'
import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { debateView } from '../../src/views/debate-room.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, debate, entry, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const ID = 'debate_000000000000'
const NOW = Date.UTC(2026, 10, 19, 12)
const DAY = 86_400_000

const ended = (createdBy = ANA) =>
  debate({
    type: 'scheduling',
    status: 'ended',
    createdBy,
    schedule: {
      minutes: 60,
      window: { startsAt: NOW, endsAt: NOW + 2 * DAY },
      attendees: [
        { memberId: ANA, required: true, answer: 'by_agent' },
        { memberId: BEN, required: true, answer: 'waiting' },
      ],
    },
  })

const opened = (room: ReturnType<typeof ended>, schedulingRooms = true) => {
  const kit = testContext()
  kit.context.state.serverInfo.set(serverInfo({ schedulingRooms }))
  kit.context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
  kit.context.state.shownDebate.set(room)
  return { ...kit, shown: mount(debateView(kit.context, lifetime(), me(), ID, null)) }
}

describe('the card to open a scheduling room again', () => {
  it('opens a new room in the same window, then shows it', () => {
    const { shown, called, page } = opened(ended())
    getByRole(shown, 'button', { name: strings.scheduling.retryAgain }).click()
    const [retry] = called('retrySchedulingRoom')
    expect(retry!.args).toEqual([ID, null])
    retry!.then!.done!({ id: 'debate_111111111111' })
    expect(page.visited).toContain('go #/debate/debate_111111111111')
  })

  it('asks for a wider window with the second button', () => {
    const { shown, called } = opened(ended())
    getByRole(shown, 'button', { name: strings.scheduling.retryWider }).click()
    expect(called('retrySchedulingRoom')[0]!.args).toEqual([ID, { startsAt: NOW, endsAt: NOW + 9 * DAY }])
  })

  it('is not shown to someone who did not open the room', () => {
    const { shown } = opened(ended(BEN))
    expect(shown.querySelector('.scheduling-retry')).toBeNull()
  })

  it('is not shown when scheduling rooms are off', () => {
    const { shown } = opened(ended(), false)
    expect(shown.querySelector('.scheduling-retry')).toBeNull()
  })
})
