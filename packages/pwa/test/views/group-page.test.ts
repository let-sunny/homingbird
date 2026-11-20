import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { groupPageView } from '../../src/views/group-page.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, TEAM, entry, group } from '../support/fixtures.ts'

usingFakeDom()

describe('groupPageView', () => {
  it('waits for the groups, offers a retry, and says when the group does not exist', () => {
    const { context, called } = testContext()
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    expect(textOf(shown)).toContain(strings.loading)
    called('loadGroups')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('loadGroups')).toHaveLength(2)
    context.state.groupsLoaded.set(true)
    expect(textOf(shown)).toContain(strings.notFound)
  })

  it('shows the members, and changes nothing the person may not', () => {
    const { context } = testContext()
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [ANA, BEN] })])
    context.state.groupsLoaded.set(true)
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    expect(getByRole(shown, 'heading', { name: 'Finance' })).toBeTruthy()
    expect(textOf(shown)).toContain(strings.groups.membersOf({ group: 'Finance' }))
    expect(textOf(shown)).toContain(strings.youMark)
    expect(queryByRole(shown, 'button', { name: strings.groups.rename })).toBeNull()
    expect(queryByRole(shown, 'button', { name: strings.removeMember })).toBeNull()
    expect(shown.querySelector('form.add-member')).toBeNull()
  })

  it('renames, adds and removes people where the person may, sending the whole list each time', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([
      group(TEAM, { name: 'Finance', memberIds: [ANA, BEN], mayAdd: true, mayRemove: true }),
    ])
    context.state.groupsLoaded.set(true)
    const shown = mount(groupPageView(context, lifetime(), ANA, TEAM))
    const ben = shown.querySelector(`[data-member-id="${BEN}"]`) as HTMLElement
    getByRole(ben, 'button', { name: strings.removeMember }).click()
    fire.select(getByRole(shown, 'combobox', { name: strings.addMemberLabel }), CY)
    fire.submit(shown.querySelector('form.add-member')!)
    expect(called('setGroupMembers').map((call) => call.args)).toEqual([
      [TEAM, [ANA]],
      [TEAM, [ANA, BEN, CY]],
    ])
    expect(called('setGroupMembers')[0]!.then!.attempt).toBe('managers')
    getByRole(shown, 'button', { name: strings.groups.rename }).click()
    const dialog = document.getElementById('dialog')!
    const name = getByRole(dialog, 'textbox', {
      name: `${strings.groups.nameLabel} ${strings.groups.nameHint}`,
    })
    expect((name as HTMLInputElement).value).toBe('Finance')
    fire.type(name, ' Money ')
    fire.submit(dialog.querySelector('form')!)
    expect(called('renameGroup')[0]!.args).toEqual([TEAM, 'Money'])
    called('renameGroup')[0]!.then!.done!(undefined)
    expect((dialog as HTMLDialogElement).open).toBe(false)
  })

  it('shows an administrator who may only remove the remove buttons and no add control', () => {
    const { context } = testContext()
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { memberIds: [BEN], mayRemove: true })])
    context.state.groupsLoaded.set(true)
    const shown = groupPageView(context, lifetime(), CY, TEAM)
    expect(getByRole(shown, 'button', { name: strings.removeMember })).toBeTruthy()
    expect(shown.querySelector('form.add-member')).toBeNull()
    expect(queryByRole(shown, 'button', { name: strings.groups.rename })).toBeNull()
    expect(getByRole(shown, 'heading', { name: strings.groups.unnamed })).toBeTruthy()
  })
})
