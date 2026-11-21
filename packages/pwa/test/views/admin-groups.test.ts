import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { adminGroupEditor, adminGroupsSection } from '../../src/views/admin-groups.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, OPS, TEAM, entry, group, managersOf, member } from '../support/fixtures.ts'

usingFakeDom()

const dialog = (): HTMLElement => document.getElementById('dialog')!

describe('adminGroupsSection', () => {
  it('waits for the groups, offers a retry, and says when there are none', () => {
    const { context, called } = testContext()
    const shown = adminGroupsSection(context, lifetime())
    expect(textOf(shown)).toContain(strings.loading)
    called('loadGroups')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('loadGroups')).toHaveLength(2)
    context.state.groupsLoaded.set(true)
    expect(textOf(shown)).toContain(strings.groups.none)
  })

  it('creates a group, with or without a name, and opens its page', () => {
    const { context, called, page } = testContext()
    mount(dialogHost())
    context.state.groupsLoaded.set(true)
    const shown = mount(adminGroupsSection(context, lifetime()))
    getByRole(shown, 'button', { name: strings.groups.create }).click()
    fire.type(
      getByRole(dialog(), 'textbox', { name: `${strings.groups.nameLabel} ${strings.groups.nameHint}` }),
      ' Finance ',
    )
    fire.submit(dialog().querySelector('form')!)
    const [create] = called('createGroup')
    expect(create!.args).toEqual(['Finance'])
    expect(create!.then!.attempt).toBe('channel-name')
    create!.then!.done!(group(TEAM, { name: 'Finance' }))
    expect(page.visited).toEqual(['go #/admin/groups/grp_team00000000'])
    expect((dialog() as HTMLDialogElement).open).toBe(false)
  })

  it('lists each team, linking to its editor, and no channel’s managers', () => {
    const { context } = testContext()
    context.state.groups.set([managersOf('billing', { memberIds: [ANA] }), group(OPS, { name: 'Ops' })])
    context.state.groupsLoaded.set(true)
    const shown = adminGroupsSection(context, lifetime())
    expect(shown.querySelector(`[data-group-id="grp_billing00000"]`)).toBeNull()
    const ops = shown.querySelector(`[data-group-id="${OPS}"]`) as HTMLElement
    expect(getByRole(ops, 'link', { name: 'Ops' }).getAttribute('href')).toBe(`#/admin/groups/${OPS}`)
    expect(queryByRole(ops, 'button', { name: strings.groups.delete })).toBeNull()
  })
})

describe('adminGroupEditor', () => {
  it('waits for the groups, offers a retry, and says when the group is gone, always with the way back', () => {
    const { context, called } = testContext()
    const shown = adminGroupEditor(context, lifetime(), ANA, TEAM)
    expect(textOf(shown)).toContain(strings.loading)
    expect(getByRole(shown, 'link', { name: `← ${strings.groups.backToGroups}` }).getAttribute('href')).toBe(
      '#/admin/groups',
    )
    called('loadGroups')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    context.state.groupsLoaded.set(true)
    expect(textOf(shown)).toContain(strings.notFound)
  })

  it('renames the team and changes its members where the administrator may', () => {
    const { context } = testContext()
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([
      group(TEAM, { name: 'Finance', memberIds: [ANA, BEN], mayAdd: true, mayRemove: true }),
    ])
    context.state.groupsLoaded.set(true)
    const shown = adminGroupEditor(context, lifetime(), ANA, TEAM)
    expect(getByRole(shown, 'heading', { name: 'Finance' })).toBeTruthy()
    expect(getByRole(shown, 'button', { name: strings.groups.rename })).toBeTruthy()
    expect(getByRole(shown, 'button', { name: strings.groups.importCsv })).toBeTruthy()
    expect(shown.querySelectorAll('.group-member')).toHaveLength(2)
    expect(shown.querySelector('form.add-member')).not.toBeNull()
  })

  it('deletes the team after confirming and goes back to every group', () => {
    const { context, called, page } = testContext()
    mount(dialogHost())
    context.state.groups.set([group(OPS, { name: 'Ops' })])
    context.state.groupsLoaded.set(true)
    const shown = mount(adminGroupEditor(context, lifetime(), ANA, OPS))
    getByRole(shown, 'button', { name: strings.groups.delete }).click()
    expect(textOf(dialog())).toContain(strings.groups.deleteTitle({ group: 'Ops' }))
    expect(textOf(dialog())).toContain(strings.groups.deleteHint)
    fire.submit(dialog().querySelector('form')!)
    expect(called('deleteGroup')[0]!.args).toEqual([OPS])
    called('deleteGroup')[0]!.then!.done!(undefined)
    expect((dialog() as HTMLDialogElement).open).toBe(false)
    expect(page.visited).toEqual(['go #/admin/groups'])
  })

  it('imports a file in the browser, previews the change, and sends one list of member ids', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    context.state.groups.set([
      group(TEAM, { name: 'Finance', memberIds: [ANA], mayAdd: true, mayRemove: true }),
    ])
    context.state.groupsLoaded.set(true)
    const shown = mount(adminGroupEditor(context, lifetime(), ANA, TEAM))
    getByRole(shown, 'button', { name: strings.groups.importCsv }).click()
    expect(textOf(dialog())).toContain(strings.groups.importHint)
    expect(textOf(dialog())).toContain(strings.loading)
    called('listMembers')[0]!.then!.done!([member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy')])
    const save = getByRole(dialog(), 'button', { name: strings.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fire.submit(dialog().querySelector('form')!)
    expect(called('setGroupMembers')).toHaveLength(0)
    const file = dialog().querySelector('input[type="file"]') as HTMLInputElement
    fire.event(file, 'change')
    const chosen = new Blob(['email\nben@example.com\nnobody@example.com'])
    Object.assign(file, { files: [chosen] })
    fire.event(file, 'change')
    const [read] = called('readImportFile')
    expect(read!.args).toEqual([chosen])
    read!.then!.done!('email\nben@example.com\nnobody@example.com')
    expect(textOf(dialog())).toContain(strings.groups.adds({ count: 1 }))
    expect(textOf(dialog())).toContain(strings.groups.removes({ count: 1 }))
    expect(textOf(dialog())).toContain(strings.groups.unknown({ emails: 'nobody@example.com' }))
    expect(save.disabled).toBe(false)
    fire.submit(dialog().querySelector('form')!)
    const [set] = called('setGroupMembers')
    expect(set!.args).toEqual([TEAM, [BEN]])
    expect(set!.then!.attempt).toBe('managers')
    set!.then!.done!(undefined)
    expect((dialog() as HTMLDialogElement).open).toBe(false)
  })

  it('says when a pasted list changes nobody, and offers no import where the administrator may not add', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    context.state.groups.set([
      group(TEAM, { name: 'Finance', memberIds: [ANA], mayAdd: true }),
      group(OPS, { name: 'Ops', mayRemove: true }),
    ])
    context.state.groupsLoaded.set(true)
    const ops = adminGroupEditor(context, lifetime(), ANA, OPS)
    expect(queryByRole(ops, 'button', { name: strings.groups.importCsv })).toBeNull()
    expect(queryByRole(ops, 'button', { name: strings.groups.rename })).toBeNull()
    const shown = mount(adminGroupEditor(context, lifetime(), ANA, TEAM))
    getByRole(shown, 'button', { name: strings.groups.importCsv }).click()
    called('listMembers')[0]!.then!.done!([member(ANA, 'Ana')])
    fire.type(getByRole(dialog(), 'textbox', { name: strings.groups.importText }), 'ana@example.com')
    expect(textOf(dialog())).toContain(strings.groups.importNothing)
    expect((getByRole(dialog(), 'button', { name: strings.save }) as HTMLButtonElement).disabled).toBe(true)
  })
})
