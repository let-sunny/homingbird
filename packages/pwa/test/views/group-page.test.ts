import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { withPresence } from '../../src/thread.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { groupPageView } from '../../src/views/group-page.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, ROOM, TEAM, conversation, entry, group } from '../support/fixtures.ts'
import { setLoad } from '../support/resource-load.ts'

usingFakeDom()

const DEE = 'mem_dee000000000' as typeof CY

describe('groupPageView', () => {
  it('waits for the groups, offers a retry, and says when the group does not exist', () => {
    const { context, called } = testContext()
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    expect(textOf(shown)).toContain(strings.loading)
    expect(called('loadGroups')).toHaveLength(1)
    setLoad(context.state.groups, { step: 'failed' })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('loadGroupsAgain')).toHaveLength(1)
    setLoad(context.state.groups, { loaded: true })
    expect(textOf(shown)).toContain(strings.notFound)
  })

  it('shows the members, and changes nothing the person may not', () => {
    const { context } = testContext()
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [ANA, BEN] })])
    setLoad(context.state.groups, { loaded: true })
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
    setLoad(context.state.groups, { loaded: true })
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

  it('keeps the person chosen to be added while colleagues come and go', () => {
    const { context, called } = testContext()
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [ANA], mayAdd: true })])
    setLoad(context.state.groups, { loaded: true })
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    fire.select(shown.querySelector('.add-member select')!, CY)
    context.state.directory.update((entries) =>
      withPresence(entries, [{ memberId: BEN, humanOnline: true, agentOnline: true }]),
    )
    fire.submit(shown.querySelector('form.add-member')!)
    expect(called('setGroupMembers')[0]!.args[1]).toEqual([ANA, CY])
  })

  it('keeps the person chosen when someone is listed newly, and asks again only when they are gone', () => {
    const { context, called } = testContext()
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [ANA], mayAdd: true })])
    setLoad(context.state.groups, { loaded: true })
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    const select = () => shown.querySelector<HTMLSelectElement>('.add-member select')!
    fire.select(select(), CY)
    context.state.directory.update((entries) => [entry(DEE, 'Dee'), ...entries])
    expect(select().value).toBe(CY)
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
    fire.submit(shown.querySelector('form.add-member')!)
    expect(called('setGroupMembers')).toHaveLength(0)
    expect(shown.querySelector('.choice-problem')?.textContent).toBe(strings.choiceGone)
  })

  it('starts from no choice, before and after the person adds someone, and says to choose first', () => {
    const { context, called } = testContext()
    const team = (memberIds: ReadonlyArray<typeof CY>) =>
      group(TEAM, { name: 'Finance', memberIds: [...memberIds], mayAdd: true })
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([team([ANA])])
    setLoad(context.state.groups, { loaded: true })
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    const select = () => shown.querySelector<HTMLSelectElement>('.add-member select')!
    const refused = () => {
      fire.submit(shown.querySelector('form.add-member')!)
      return shown.querySelector('.choice-problem')?.textContent
    }
    expect(refused()).toBe(strings.chooseFirst)
    fire.select(select(), CY)
    fire.submit(shown.querySelector('form.add-member')!)
    expect(called('setGroupMembers').map((call) => call.args[1])).toEqual([[ANA, CY]])
    expect(select().value).toBe('')
    context.state.groups.set([team([ANA, CY])])
    expect([...select().options].map((option) => option.textContent)).not.toContain(strings.chooseAgain)
    expect(refused()).toBe(strings.chooseFirst)
    expect(called('setGroupMembers')).toHaveLength(1)
  })

  it('shows an administrator who may only remove the remove buttons and no add control', () => {
    const { context } = testContext()
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { memberIds: [BEN], mayRemove: true })])
    setLoad(context.state.groups, { loaded: true })
    const shown = groupPageView(context, lifetime(), CY, TEAM)
    expect(getByRole(shown, 'button', { name: strings.removeMember })).toBeTruthy()
    expect(shown.querySelector('form.add-member')).toBeNull()
    expect(queryByRole(shown, 'button', { name: strings.groups.rename })).toBeNull()
    expect(getByRole(shown, 'heading', { name: strings.groups.unnamed })).toBeTruthy()
  })

  it('loads the people, opens a direct message from a member’s tile, and starts a group message', () => {
    const { context, called } = testContext()
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [ANA, BEN, CY] })])
    setLoad(context.state.groups, { loaded: true })
    const shown = groupPageView(context, lifetime(), ANA, TEAM)
    expect(called('loadPeople')).toHaveLength(1)
    const ana = shown.querySelector(`[data-member-id="${ANA}"]`) as HTMLElement
    expect(ana.querySelector('button')).toBeNull()
    getByRole(shown, 'button', { name: strings.groups.writeTo({ name: 'Ben' }) }).click()
    expect(called('openConversationWith')[0]!.args).toEqual([BEN])
    getByRole(shown, 'button', { name: strings.groups.messageGroup({ group: 'Finance' }) }).click()
    expect(called('openConversationAmong')[0]!.args).toEqual([[BEN, CY]])
    context.state.conversations.set([conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })])
    expect(
      getByRole(shown, 'link', { name: strings.groups.openGroupMessage({ group: 'Finance' }) }).getAttribute(
        'href',
      ),
    ).toBe(`#/c/${ROOM}`)
  })
})
