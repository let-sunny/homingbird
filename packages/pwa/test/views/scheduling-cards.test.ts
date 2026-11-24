import { lifetime } from '@homingbird/ui'
import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { withPresence } from '../../src/thread.ts'
import { debateView } from '../../src/views/debate-room.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, credential, debate, entry, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const HOUR = 3_600_000
const START = Date.UTC(2026, 10, 19, 12)
const ID = 'debate_000000000000'

const collecting = () =>
  debate({
    type: 'scheduling',
    question: 'Planning sync',
    schedule: {
      minutes: 60,
      window: { startsAt: START, endsAt: START + 4 * HOUR },
      attendees: [
        { memberId: ANA, required: true, answer: 'waiting' },
        { memberId: BEN, required: true, answer: 'waiting' },
      ],
    },
  })

const opened = (agents: ReadonlyArray<ReturnType<typeof credential>>, room = collecting()) => {
  const kit = testContext()
  kit.context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
  kit.context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
  kit.context.state.agentCredentials.set(agents)
  kit.context.state.shownDebate.set(room)
  const shown = mount(debateView(kit.context, lifetime(), me(), ID, null))
  return { ...kit, shown }
}

describe('schedulingCards', () => {
  it('keeps a pressed button, an hour and the answer’s time as the same elements while colleagues come and go', () => {
    const { context, shown, clock } = opened([credential('cred_laptop000000', { name: 'Laptop' })])
    const kept = () => [
      getByRole(shown, 'button', { name: strings.scheduling.agentAnswer }),
      shown.querySelector('.scheduling-pick-cell input'),
      shown.querySelector('.scheduling-attendee-list'),
    ]
    const before = kept()
    void clock.advance(1)
    context.state.directory.update((entries) =>
      withPresence(entries, [{ memberId: BEN, humanOnline: true, agentOnline: true }]),
    )
    kept().forEach((one, index) => expect(one).toBe(before[index]))
  })

  it('works out the window to open the flock again in when the button is clicked', async () => {
    const ended = debate({
      ...collecting(),
      createdBy: ANA,
      status: 'ended',
      endedBecause: 'no_turns',
    } as never)
    const { shown, called, clock } = opened([], ended)
    await clock.advance(START + 2 * HOUR - clock.now())
    getByRole(shown, 'button', { name: strings.scheduling.retryWider }).click()
    expect(called('retrySchedulingRoom')[0]!.args[1]).toMatchObject({ startsAt: START + 2 * HOUR })
  })
})
