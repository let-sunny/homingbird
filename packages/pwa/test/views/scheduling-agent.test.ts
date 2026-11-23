import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
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

const opened = (agents: ReadonlyArray<ReturnType<typeof credential>>) => {
  const kit = testContext()
  kit.context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
  kit.context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
  kit.context.state.agentCredentials.set(agents)
  kit.context.state.shownDebate.set(collecting())
  const shown = mount(debateView(kit.context, lifetime(), me(), ID, null))
  return { ...kit, shown }
}

describe('the card to let an agent answer a scheduling flock', () => {
  it('opts the person’s one agent in, beside the card to pick free times themself', () => {
    const { shown, called } = opened([credential('cred_laptop000000', { name: 'Laptop' })])
    expect(textOf(shown)).toContain(strings.scheduling.agentTitle)
    expect(textOf(shown)).toContain(strings.scheduling.pickTitle)
    expect(shown.querySelector('.scheduling-agent select')).toBeNull()
    getByRole(shown, 'button', { name: strings.scheduling.agentAnswer }).click()
    expect(called('optInAgent')[0]!.args).toEqual([ID, 'cred_laptop000000', ''])
  })

  it('lets the person choose which agent answers when they have more than one', () => {
    const { shown, called } = opened([credential('cred_laptop000000'), credential('cred_desk00000000')])
    const choice = shown.querySelector<HTMLSelectElement>('.scheduling-agent select')!
    choice.value = 'cred_desk00000000'
    getByRole(shown, 'button', { name: strings.scheduling.agentAnswer }).click()
    expect(called('optInAgent')[0]!.args).toEqual([ID, 'cred_desk00000000', ''])
  })

  it('is not drawn for a person with no agent', () => {
    const { shown } = opened([])
    expect(shown.querySelector('.scheduling-agent')).toBeNull()
    expect(textOf(shown)).toContain(strings.scheduling.pickTitle)
  })
})
