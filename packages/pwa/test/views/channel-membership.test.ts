import { fire, getByRole, installFakeDom, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { answeringChip, privateMark, roomControls } from '../../src/views/channel-membership.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CY,
  OPS,
  channel,
  entry,
  everything,
  group,
  managersOf,
  me,
  member,
} from '../support/fixtures.ts'

usingFakeDom()

const signedIn = (context: ReturnType<typeof testContext>['context'], admin = false) => {
  context.state.session.set(me({}, admin ? { role: 'admin' } : {}))
  context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
}

const openMenu = (shown: HTMLElement): void => (shown.querySelector('.room-more') as HTMLElement).click()

/** Opens the room's ⋯ menu and chooses one of its items. */
const choose = (shown: HTMLElement, name: string): void => {
  openMenu(shown)
  getByRole(shown, 'button', { name }).click()
}

describe('roomControls', () => {
  it('switches answering, and leaves a channel after confirming', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const billing = channel('billing', { joined: true })
    const shown = mount(roomControls(context, billing))
    getByRole(shown, 'switch', { name: strings.answerHere }).click()
    expect(called('setAnswering')[0]!.args).toEqual(['billing', true])
    choose(shown, strings.leaveChannel)
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.leaveChannelBody)
    fire.submit(dialog.querySelector('form')!)
    expect(called('leaveChannel')[0]!.then!.attempt).toBe('managers')
    expect(shown.querySelector('.room-menu')!.matches(':popover-open')).toBe(false)
    openMenu(shown)
    expect(textOf(shown)).toContain(billing.description)
    expect(queryByRole(shown, 'button', { name: strings.manageMembers })).toBeNull()
  })

  it('asks once for a managed channel’s roster, and keeps a manager in the room', () => {
    const { context, called } = testContext()
    signedIn(context)
    const managed = channel('billing', { joined: true, managing: true, memberCount: 2 })
    roomControls(context, managed)
    roomControls(context, managed)
    expect(called('loadChannelMembers')).toHaveLength(1)
    called('loadChannelMembers')[0]!.then!.done!([])
    context.state.rosters.set(
      new Map([
        [
          'billing',
          {
            memberCount: 2,
            members: [
              { memberId: ANA, manager: true, answering: false },
              { memberId: BEN, manager: false, answering: false },
            ],
          },
        ],
      ]),
    )
    const shown = mount(roomControls(context, managed))
    openMenu(shown)
    expect((getByRole(shown, 'button', { name: strings.leaveChannel }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(textOf(shown)).toContain(strings.managerCannotLeave)
  })

  it('manages the members and the managers: adds and removes people, adds a manager and a team', () => {
    const { context, called } = testContext()
    signedIn(context)
    context.state.serverInfo.set(everything())
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')])
    mount(dialogHost())
    const secret = channel('secret', { joined: true, managing: true, visibility: 'private', memberCount: 2 })
    const shown = mount(roomControls(context, secret))
    choose(shown, strings.manageMembers)
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.loading)
    expect(called('loadGroups')).toHaveLength(1)
    context.state.groups.set([
      managersOf('secret', { memberIds: [ANA, BEN], mayAdd: true, mayRemove: true }),
      group(OPS, { name: 'Operations', memberIds: [CY] }),
    ])
    expect(textOf(dialog)).toContain(
      strings.groups.managedBy({ group: strings.groups.managersOf({ channel: '#secret' }) }),
    )
    expect(queryByRole(dialog, 'link')).toBeNull()
    const reload = () => called('loadChannelMembers').at(-1)!.then!.done!
    reload()([
      { memberId: ANA, manager: true, answering: true },
      { memberId: BEN, manager: true, answering: false },
      { memberId: CY, manager: false, answering: false },
    ])
    expect((getByRole(dialog, 'button', { name: strings.leaveChannel }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    getByRole(dialog, 'button', { name: strings.removeMember }).click()
    expect(called('setChannelMember')[0]!.args).toEqual(['secret', CY, false])
    const ben = dialog.querySelector(`[data-member="${BEN}"]`) as HTMLElement
    getByRole(ben, 'button', { name: strings.groups.unmanage }).click()
    expect(called('setGroupMembers')[0]!.args).toEqual(['grp_secret000000', [ANA]])
    expect(called('setGroupMembers')[0]!.then!.attempt).toBe('managers')
    fire.select(getByRole(dialog, 'combobox', { name: strings.groups.addManager }), CY)
    fire.submit(dialog.querySelector('form.add-manager')!)
    expect(called('setGroupMembers')[1]!.args).toEqual(['grp_secret000000', [ANA, BEN, CY]])
    expect(textOf(dialog)).toContain(strings.groups.addTeamHint)
    fire.select(getByRole(dialog, 'combobox', { name: strings.groups.addTeam }), OPS)
    fire.submit(dialog.querySelector('form.add-team')!)
    expect(called('addTeam')[0]!.args).toEqual(['secret', OPS])
    expect(called('addTeam')[0]!.then!.attempt).toBe('managers')
    reload()([
      { memberId: ANA, manager: true, answering: true },
      { memberId: BEN, manager: false, answering: false },
    ])
    fire.select(getByRole(dialog, 'combobox', { name: strings.addMemberLabel }), CY)
    fire.submit(dialog.querySelector('form.add-member')!)
    expect(called('setChannelMember')[1]!.args).toEqual(['secret', CY, true])
  })

  it('offers no change of managers while groups are off', () => {
    const { context, called } = testContext()
    signedIn(context)
    context.state.serverInfo.set({ ...everything(), features: { ...everything().features, groups: false } })
    context.state.groups.set([managersOf('billing', { memberIds: [ANA], mayAdd: true, mayRemove: true })])
    mount(dialogHost())
    const shown = mount(roomControls(context, channel('billing', { joined: true, managing: true })))
    choose(shown, strings.manageMembers)
    const dialog = document.getElementById('dialog')!
    called('loadChannelMembers').at(-1)!.then!.done!([{ memberId: ANA, manager: true, answering: false }])
    expect(dialog.querySelector('form.add-manager')).toBeNull()
    expect(dialog.querySelector('form.add-team')).toBeNull()
    expect(queryByRole(dialog, 'button', { name: strings.groups.unmanage })).toBeNull()
  })

  it('leaves from the own row after confirming, and says the channel is open with no way to change it', () => {
    const { context, called } = testContext()
    signedIn(context)
    mount(dialogHost())
    const billing = channel('billing', { joined: true, managing: true, memberCount: 2 })
    context.state.groups.set([managersOf('billing', { memberIds: [BEN] })])
    const shown = mount(roomControls(context, billing))
    choose(shown, strings.manageMembers)
    const dialog = document.getElementById('dialog')!
    called('loadChannelMembers').at(-1)!.then!.done!([
      { memberId: ANA, manager: false, answering: false },
      { memberId: BEN, manager: true, answering: false },
    ])
    expect(dialog.querySelector('p.visibility')!.textContent).toBe(strings.visibilityOpen)
    choose(shown, strings.manageMembers)
    called('loadChannelMembers').at(-1)!.then!.done!([{ memberId: ANA, manager: false, answering: false }])
    getByRole(dialog, 'button', { name: strings.leaveChannel }).click()
    fire.submit(dialog.querySelector('form.self-confirmation')!)
    expect(called('leaveChannel')).toHaveLength(1)
  })

  it('tells an administrator outside a channel why they manage it, and shows a private channel as private', () => {
    const { context, called } = testContext()
    signedIn(context, true)
    context.state.directory.set([])
    mount(dialogHost())
    const shown = mount(roomControls(context, channel('ops', { managing: true })))
    choose(shown, strings.manageMembers)
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.managedByAdmin)
    called('loadChannelMembers').at(-1)!.then!.done!([{ memberId: BEN, manager: false, answering: false }])
    expect(textOf(dialog)).toContain(strings.formerMember)
    const secret = mount(roomControls(context, channel('hidden', { managing: true, visibility: 'private' })))
    choose(secret, strings.manageMembers)
    called('loadChannelMembers').at(-1)!.then!.done!([{ memberId: BEN, manager: true, answering: false }])
    expect(textOf(dialog)).toContain(strings.nobodyToAdd)
    expect(dialog.querySelector('p.visibility')!.textContent).toBe(strings.visibilityPrivate)
    expect(member(ANA, 'Ana').id).toBe(ANA)
  })
})

describe('an administrator outside a private channel', () => {
  it('sees its roster read-only: removal where the server allows it, no adding, managers or visibility', () => {
    const { context, called } = testContext()
    signedIn(context, true)
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
    mount(dialogHost())
    const secret = channel('secret', {
      visibility: 'private',
      managing: false,
      joined: false,
      memberCount: 2,
    })
    const shown = mount(roomControls(context, secret))
    expect(queryByRole(shown, 'switch', { name: strings.answerHere })).toBeNull()
    choose(shown, strings.manageMembers)
    const dialog = document.getElementById('dialog')!
    called('loadChannelMembers').at(-1)!.then!.done!([
      { memberId: BEN, manager: true, answering: false },
      { memberId: CY, manager: false, answering: false },
    ])
    expect(textOf(dialog)).toContain(strings.seenByAdmin)
    expect(textOf(dialog)).toContain('Ben')
    expect(dialog.querySelector('form.change-managing')).toBeNull()
    expect(dialog.querySelector('p.visibility')).toBeNull()
    expect(dialog.querySelector('form.add-member')).toBeNull()
    getByRole(dialog, 'button', { name: strings.removeMember }).click()
    expect(called('setChannelMember')[0]!.args).toEqual(['secret', CY, false])
  })
})

describe('the room menu without the Popover API', () => {
  it('shows its items in place, and a choice still works', () => {
    installFakeDom({ popovers: false })
    const { context, called } = testContext()
    signedIn(context)
    context.state.serverInfo.set(everything())
    const shown = mount(roomControls(context, channel('billing', { joined: true, agent: null })))
    mount(dialogHost())
    const menu = shown.querySelector<HTMLElement>('.room-menu')!
    expect('hidePopover' in menu).toBe(false)
    menu.querySelector<HTMLElement>('.leave-channel')!.click()
    expect(textOf(document.getElementById('dialog')!)).toContain(strings.leaveChannelBody)
    expect(called('leaveChannel')).toHaveLength(0)
  })
})

describe('the marks of a channel', () => {
  it('marks a private channel, and says whether the person answers there', () => {
    const { context } = testContext()
    expect(privateMark(channel('open'))).toBe(false)
    expect(textOf(privateMark(channel('secret', { visibility: 'private' })) as HTMLElement)).toBe(
      strings.privateChannel,
    )
    expect(answeringChip(context, channel('billing'))).toBeNull()
    const on = answeringChip(context, channel('billing', { joined: true, answering: true })) as HTMLElement
    expect(on.getAttribute('title')).toBe(strings.answerHereHint)
    expect(getByRole(on, 'switch').getAttribute('aria-checked')).toBe('true')
    expect(textOf(on)).toContain(strings.switchOn)
  })
})
