import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { debatesView } from '../../src/views/debates.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, entry, me, serverInfo, summary } from '../support/fixtures.ts'

usingFakeDom()

const opened = () => {
  const made = testContext()
  mount(dialogHost())
  made.context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
  made.context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
  const shown = mount(debatesView(made.context, lifetime(), me()))
  getByRole(shown, 'button', { name: strings.scheduling.newRoom }).click()
  return { ...made, shown, dialog: document.getElementById('dialog')! }
}

const choose = (dialog: HTMLElement, typed: string): void => {
  const invite = getByRole(dialog, 'combobox', { name: strings.scheduling.attendees })
  fire.type(invite, typed)
  fire.key(invite, 'Enter')
}

describe('the button to schedule a meeting', () => {
  it('shows only while scheduling rooms are on', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo())
    const shown = mount(debatesView(context, lifetime(), me()))
    expect(textOf(shown)).not.toContain(strings.scheduling.newRoom)
    context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
    expect(textOf(shown)).toContain(strings.scheduling.newRoom)
    context.state.serverInfo.set(serverInfo())
    expect(textOf(shown)).not.toContain(strings.scheduling.newRoom)
  })

  it('lists a scheduling room with its kind, and not at all while the feature is off', () => {
    const { context } = testContext()
    context.state.debatesLoaded.set(true)
    context.state.debates.set([summary({ type: 'scheduling' })])
    context.state.serverInfo.set(serverInfo())
    const shown = mount(debatesView(context, lifetime(), me()))
    expect(textOf(shown)).toContain(strings.debates.empty)
    context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
    expect(shown.querySelector('.debate-kind')?.textContent).toBe(strings.scheduling.kind)
  })
})

describe('the form to schedule a meeting', () => {
  it('opens a room for the title, the people with the optional ones marked, the length and the days', () => {
    const { dialog, called, page } = opened()
    fire.type(getByRole(dialog, 'textbox', { name: strings.scheduling.titleLabel }), ' Planning sync ')
    choose(dialog, 'be')
    choose(dialog, 'cy')
    expect(dialog.querySelectorAll('.scheduling-optional-list li')).toHaveLength(2)
    getByRole(dialog, 'checkbox', { name: strings.scheduling.optionalFor({ name: 'Cy' }) }).click()
    fire.submit(dialog.querySelector('form')!)
    const [create] = called('createSchedulingRoom')
    expect(create!.args[0]).toMatchObject({
      title: 'Planning sync',
      minutes: 30,
      attendees: [
        { memberId: BEN, required: true },
        { memberId: CY, required: false },
      ],
    })
    create!.then!.done!({ id: 'debate_1' })
    expect(page.visited).toEqual(['go #/debate/debate_1'])
    getByRole(dialog, 'checkbox', { name: strings.scheduling.optionalFor({ name: 'Cy' }) }).click()
    expect(
      (
        getByRole(dialog, 'checkbox', {
          name: strings.scheduling.optionalFor({ name: 'Cy' }),
        }) as HTMLInputElement
      ).checked,
    ).toBe(false)
  })

  it('says what is missing instead of opening a room', () => {
    const { context, dialog, called } = opened()
    fire.submit(dialog.querySelector('form')!)
    expect(context.state.notice.get()).toEqual({ kind: 'error', text: strings.scheduling.problems.noTitle })
    expect(called('createSchedulingRoom')).toHaveLength(0)
  })
})
