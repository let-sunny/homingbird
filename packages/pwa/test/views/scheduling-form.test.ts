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
  getByRole(shown, 'button', { name: strings.debates.newRoom }).click()
  getByRole(document.getElementById('dialog')!, 'radio', { name: strings.scheduling.newRoom }).click()
  return { ...made, shown, dialog: document.getElementById('dialog')! }
}

const choose = (dialog: HTMLElement, typed: string): void => {
  const invite = getByRole(dialog, 'combobox', { name: strings.scheduling.attendees })
  fire.type(invite, typed)
  fire.key(invite, 'Enter')
}

describe('the button to schedule a meeting', () => {
  it('shows only while scheduling flocks are on', () => {
    const { context } = testContext()
    context.state.serverInfo.set(serverInfo())
    const shown = mount(debatesView(context, lifetime(), me()))
    const kinds = (): number => {
      getByRole(shown, 'button', { name: strings.debates.newRoom }).click()
      return document.getElementById('dialog')!.querySelectorAll('input[name=roomType]').length
    }
    mount(dialogHost())
    expect(kinds()).toBe(0)
    context.state.serverInfo.set(serverInfo({ schedulingRooms: true }))
    expect(kinds()).toBe(2)
  })

  it('shows the debate fields first and the meeting fields once the kind is chosen', () => {
    const { dialog } = opened()
    const debateForm = dialog.querySelector('.create-debate') as HTMLElement
    expect([debateForm.hidden, (dialog.querySelector('.scheduling-form') as HTMLElement).hidden]).toEqual([
      true,
      false,
    ])
    getByRole(dialog, 'radio', { name: strings.debates.typeDebate }).click()
    expect([debateForm.hidden, (dialog.querySelector('.scheduling-form') as HTMLElement).hidden]).toEqual([
      false,
      true,
    ])
  })

  it('lists a scheduling flock with its kind, and not at all while the feature is off', () => {
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
  it('opens a flock for the title, the people with the optional ones marked, the length and the days', () => {
    const { context, dialog, called, page } = opened()
    fire.type(getByRole(dialog, 'textbox', { name: strings.scheduling.titleLabel }), ' Planning sync ')
    choose(dialog, 'be')
    choose(dialog, 'cy')
    expect(dialog.querySelectorAll('.scheduling-optional-list li')).toHaveLength(2)
    getByRole(dialog, 'checkbox', { name: strings.scheduling.optionalFor({ name: 'Cy' }) }).click()
    context.state.notice.set({ kind: 'error', text: strings.scheduling.problems.noAttendee })
    fire.submit(dialog.querySelector('.scheduling-form')!)
    expect(context.state.notice.get()).toBeNull()
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

  it('opens a flock limited to the days ticked and the hours typed, in the browser’s time zone', () => {
    const { dialog, called } = opened()
    fire.type(getByRole(dialog, 'textbox', { name: strings.scheduling.titleLabel }), 'Planning sync')
    choose(dialog, 'be')
    const field = (name: string) => dialog.querySelector(`[name=${name}]`) as HTMLInputElement
    for (const box of dialog.querySelectorAll<HTMLInputElement>('[name=weekday]'))
      if (['1', '3'].includes(box.value)) box.click()
    field('hoursFrom').value = '10:00'
    field('hoursTo').value = '15:00'
    fire.submit(dialog.querySelector('.scheduling-form')!)
    expect(called('createSchedulingRoom')[0]!.args[0]).toMatchObject({
      weekdays: [1, 3],
      hours: { from: 600, to: 900 },
      timeZone: 'Asia/Seoul',
    })
  })

  it('names the weekdays and the hours as fields, and says which time zone the hours are in', () => {
    const { dialog } = opened()
    expect(dialog.querySelectorAll('[name=weekday]')).toHaveLength(7)
    expect(textOf(dialog)).toContain(strings.scheduling.limitsLegend)
    expect(textOf(dialog)).toContain(strings.scheduling.hoursHint({ zone: 'Asia/Seoul' }))
  })

  it('says what is missing instead of opening a flock', () => {
    const { context, dialog, called } = opened()
    fire.submit(dialog.querySelector('.scheduling-form')!)
    expect(context.state.notice.get()).toEqual({ kind: 'error', text: strings.scheduling.problems.noTitle })
    expect(called('createSchedulingRoom')).toHaveLength(0)
  })
})
