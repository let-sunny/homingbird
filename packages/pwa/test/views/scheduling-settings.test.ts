import { DEFAULT_SCHEDULING_DELEGATION } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { profileView } from '../../src/views/account.ts'
import { schedulingSettingsSection } from '../../src/views/scheduling-settings.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { BEN, credential, entry, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const AGENT = 'cred_agent0000000'
const copy = strings.scheduling.delegation

const shownWith = () => {
  const test = testContext()
  test.context.state.directory.set([entry(BEN, 'Ben')])
  test.context.state.agentCredentials.set([credential(AGENT, { name: 'Desk agent' })])
  const shown = mount(schedulingSettingsSection(test.context, lifetime(), me()))
  return { ...test, shown }
}

const loaded = (test: ReturnType<typeof shownWith>, delegation = DEFAULT_SCHEDULING_DELEGATION) =>
  test.called('loadSchedulingDelegation')[0]!.then!.done!({ delegation, agentInUse: AGENT })

describe('schedulingSettingsSection', () => {
  it('loads the delegation and says it is on, with the agent it uses', () => {
    const test = shownWith()
    expect(test.called('loadPeople')).toHaveLength(1)
    expect(test.called('loadAgents')).toHaveLength(1)
    expect(textOf(test.shown)).toContain(strings.loading)
    loaded(test)
    expect(textOf(test.shown)).toContain(copy.summary.both)
    expect(textOf(test.shown)).toContain(copy.agentInUse({ name: 'Desk agent' }))
    expect(
      (getByRole(test.shown, 'checkbox', { name: new RegExp(copy.join) }) as HTMLInputElement).checked,
    ).toBe(true)
    expect(test.shown.querySelector('select[name="agent"]')).toBeNull()
    expect(textOf(test.shown)).toContain(copy.hoursZone({ timeZone: 'GMT+9' }))
  })

  it('says when the delegation could not be read', () => {
    const test = shownWith()
    test.called('loadSchedulingDelegation')[0]!.then!.failed!({})
    expect(textOf(test.shown)).toContain(strings.loadFailed)
  })

  it('saves it off after the person unticks both, and says it saved', () => {
    const test = shownWith()
    loaded(test)
    fire.click(getByRole(test.shown, 'checkbox', { name: new RegExp(copy.join) }))
    fire.click(getByRole(test.shown, 'checkbox', { name: new RegExp(copy.add) }))
    fire.event(test.shown.querySelector('form')!, 'submit')
    const [save] = test.called('saveSchedulingDelegation')
    expect(save!.args).toEqual([{ ...DEFAULT_SCHEDULING_DELEGATION, autoJoin: false, autoAdd: false }])
    save!.then!.done!({
      delegation: { ...DEFAULT_SCHEDULING_DELEGATION, autoJoin: false, autoAdd: false },
      agentInUse: AGENT,
    })
    expect(textOf(test.shown)).toContain(copy.saved)
    expect(textOf(test.shown)).toContain(copy.summary.neither)
  })

  it('saves the limits the person ticks and the agent they choose', () => {
    const test = shownWith()
    loaded(test)
    fire.click(getByRole(test.shown, 'button', { name: copy.agentChange }))
    const agent = test.shown.querySelector<HTMLSelectElement>('select[name="agent"]')!
    agent.value = AGENT
    fire.click(getByRole(test.shown, 'checkbox', { name: copy.peopleLimited }))
    fire.click(getByRole(test.shown, 'checkbox', { name: 'Ben' }))
    fire.click(getByRole(test.shown, 'checkbox', { name: copy.hoursLimited }))
    fire.click(getByRole(test.shown, 'checkbox', { name: copy.maxLimited }))
    test.shown.querySelector<HTMLTextAreaElement>('textarea')!.value = 'Keep Fridays free.'
    fire.event(test.shown.querySelector('form')!, 'submit')
    expect(test.called('saveSchedulingDelegation')[0]!.args).toEqual([
      {
        autoJoin: true,
        autoAdd: true,
        agentId: AGENT,
        brief: 'Keep Fridays free.',
        scope: {
          people: [BEN],
          hours: { from: 540, to: 1080, timeZone: 'Asia/Seoul' },
          maxMinutes: 60,
        },
      },
    ])
  })

  it('does not save a limit on people with nobody chosen', () => {
    const test = shownWith()
    loaded(test)
    fire.click(getByRole(test.shown, 'checkbox', { name: copy.peopleLimited }))
    fire.event(test.shown.querySelector('form')!, 'submit')
    expect(test.called('saveSchedulingDelegation')).toHaveLength(0)
    expect(test.context.state.notice.get()).toEqual({ kind: 'error', text: copy.problems.noPeople })
  })
})

describe('Settings', () => {
  it('shows the section only when scheduling flocks are on', () => {
    for (const on of [true, false]) {
      const { context } = testContext()
      context.state.serverInfo.set(serverInfo({ schedulingRooms: on }))
      const shown = mount(profileView(context, lifetime(), me()))
      expect(shown.querySelector('.scheduling-settings-host') !== null).toBe(on)
    }
  })
})
