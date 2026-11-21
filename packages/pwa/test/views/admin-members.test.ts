import { presetById } from '@homingbird/sprites'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { formats, strings } from '../../src/strings.ts'
import { adminMembersSection } from '../../src/views/admin-members.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, TEAM, entry, group, me, member } from '../support/fixtures.ts'

usingFakeDom()

describe('adminMembersSection', () => {
  it('changes roles and statuses, resets a character, and reloads after each', () => {
    const { context, called } = testContext()
    const shown = adminMembersSection(context, lifetime(), me({}, { role: 'admin' }))
    expect(textOf(shown)).toContain(strings.loading)
    called('listMembers')[0]!.then!.done!([
      member(ANA, 'Ana', { role: 'admin' }),
      member(BEN, 'Ben', { role: 'admin', status: 'deactivated', character: presetById('owl')! }),
      member(CY, 'Cy'),
    ])
    expect(textOf(shown)).toContain(strings.cannotChangeOwnRole)
    const ben = shown.querySelector(`[data-member-id="${BEN}"]`)!
    const cy = shown.querySelector(`[data-member-id="${CY}"]`)!
    getByRole(ben, 'button', { name: strings.makeMember }).click()
    getByRole(ben, 'button', { name: strings.reactivate }).click()
    getByRole(cy, 'button', { name: strings.makeAdmin }).click()
    getByRole(cy, 'button', { name: strings.deactivate }).click()
    expect(called('updateMember').map((call) => call.args)).toEqual([
      [BEN, { role: 'member' }],
      [BEN, { status: 'active' }],
      [CY, { role: 'admin' }],
      [CY, { status: 'deactivated' }],
    ])
    called('updateMember')[0]!.then!.done!(undefined)
    expect(called('listMembers')).toHaveLength(2)
    getByRole(ben, 'button', { name: strings.character.resetMember }).click()
    called('resetMemberCharacter')[0]!.then!.done!(member(BEN, 'Ben'))
    expect(context.state.notice.get()).toEqual({
      kind: 'info',
      text: strings.character.resetMemberDone({ name: 'Ben' }),
    })
    expect(called('listMembers')).toHaveLength(3)
  })

  it('asks before deactivating someone in a group, naming every group they leave', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [CY] })])
    const shown = mount(adminMembersSection(context, lifetime(), me({}, { role: 'admin' })))
    expect(called('loadGroups')).toHaveLength(1)
    called('listMembers')[0]!.then!.done!([member(ANA, 'Ana', { role: 'admin' }), member(CY, 'Cy')])
    getByRole(shown, 'button', { name: strings.deactivate }).click()
    expect(called('updateMember')).toHaveLength(0)
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.deactivateTitle({ name: 'Cy' }))
    expect(textOf(dialog)).toContain(strings.groups.deactivateLeaves({ name: 'Cy', groups: 'Finance' }))
    fire.submit(dialog.querySelector('form')!)
    expect(called('updateMember')[0]!.args).toEqual([CY, { status: 'deactivated' }])
    called('updateMember')[0]!.then!.done!(undefined)
    expect((dialog as HTMLDialogElement).open).toBe(false)
    expect(called('listMembers')).toHaveLength(2)
    expect(called('loadGroups')).toHaveLength(2)
  })

  it('shows each member’s last activity, agent, groups and a 30-day flag, and filters by the search', () => {
    const { context, called, clock } = testContext()
    const now = clock.now()
    const day = 24 * 60 * 60 * 1000
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [CY] })])
    const shown = mount(adminMembersSection(context, lifetime(), me({}, { role: 'admin' })))
    expect(called('loadPeople')).toHaveLength(1)
    called('listMembers')[0]!.then!.done!([
      member(ANA, 'Ana', { role: 'admin' }),
      member(BEN, 'Ben', { createdAt: now - 90 * day }),
      member(CY, 'Cy'),
    ])
    const ben = (): Element => shown.querySelector(`[data-member-id="${BEN}"]`)!
    const cy = (): Element => shown.querySelector(`[data-member-id="${CY}"]`)!
    expect(textOf(ben())).not.toContain(strings.adminMemberList.neverActive)
    context.state.directory.set([
      entry(ANA, 'Ana', { lastSeenAt: now }),
      entry(BEN, 'Ben', { lastSeenAt: null }),
      entry(CY, 'Cy', {
        lastSeenAt: now - day,
        presence: { humanOnline: true, agentOnline: true },
      }),
    ])
    expect(textOf(ben())).toContain(strings.adminMemberList.neverActive)
    expect(textOf(ben())).toContain(strings.adminMemberList.dormant)
    expect(ben().classList.contains('is-dormant')).toBe(true)
    expect(textOf(ben())).toContain(strings.agentOffline)
    expect(textOf(cy())).toContain(strings.agentOnline)
    expect(textOf(cy())).toContain(strings.adminMemberList.groups({ groups: 'Finance' }))
    expect(textOf(cy())).not.toContain(strings.adminMemberList.dormant)
    expect(cy().querySelector('.member-last-active')!.getAttribute('title')).toBe(
      strings.adminMemberList.lastActiveTitle({ time: formats.full.format(new Date(now - day)) }),
    )
    fire.type(getByRole(shown, 'searchbox'), 'finance')
    expect(shown.querySelectorAll('[data-member-id]')).toHaveLength(1)
    expect(cy().isConnected).toBe(true)
    fire.type(getByRole(shown, 'searchbox'), 'nobody')
    expect(shown.querySelectorAll('[data-member-id]')).toHaveLength(0)
    expect(textOf(shown)).toContain(strings.adminMemberList.noMatch({ query: 'nobody' }))
  })
})
