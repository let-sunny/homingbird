import type { AsRead } from '@homingbird/protocol'
import { presetById } from '@homingbird/sprites'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { formats, strings } from '../../src/strings.ts'
import { adminMembersSection } from '../../src/views/admin-members.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, TEAM, entry, group, managersOf, me, member } from '../support/fixtures.ts'

usingFakeDom()

const listing = (
  members: ReadonlyArray<AsRead.Member>,
  agentCredentials: ReadonlyArray<AsRead.AgentCredentialsHeld> | null = null,
) => ({ members, agentCredentials })

describe('adminMembersSection', () => {
  it('changes roles and statuses, resets a character, and reloads after each', () => {
    const { context, called } = testContext()
    const shown = adminMembersSection(context, lifetime(), me({}, { role: 'admin' }))
    expect(textOf(shown)).toContain(strings.loading)
    called('listMembers')[0]!.then!.done!(
      listing([
        member(ANA, 'Ana', { role: 'admin' }),
        member(BEN, 'Ben', { role: 'admin', character: presetById('owl')! }),
        member(CY, 'Cy', { status: 'deactivated' }),
      ]),
    )
    expect(textOf(shown)).toContain(strings.cannotChangeOwnRole)
    const ben = shown.querySelector(`[data-member-id="${BEN}"]`)!
    const cy = shown.querySelector(`[data-member-id="${CY}"]`)!
    expect(textOf(cy)).not.toContain(strings.makeAdmin)
    getByRole(ben, 'button', { name: strings.makeMember }).click()
    getByRole(ben, 'button', { name: strings.deactivate }).click()
    getByRole(cy, 'button', { name: strings.reactivate }).click()
    expect(called('updateMember').map((call) => call.args)).toEqual([
      [BEN, { role: 'member' }],
      [BEN, { status: 'deactivated' }],
      [CY, { status: 'active' }],
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
    called('listMembers')[0]!.then!.done!(listing([member(ANA, 'Ana', { role: 'admin' }), member(CY, 'Cy')]))
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

  it('shows each member’s last activity, agent, groups and a 30-day flag, and filters by the search and by that flag', () => {
    const { context, called, clock } = testContext()
    const now = clock.now()
    const day = 24 * 60 * 60 * 1000
    context.state.groups.set([group(TEAM, { name: 'Finance', memberIds: [CY] })])
    const shown = mount(adminMembersSection(context, lifetime(), me({}, { role: 'admin' })))
    expect(called('loadPeople')).toHaveLength(1)
    called('listMembers')[0]!.then!.done!(
      listing([
        member(ANA, 'Ana', { role: 'admin' }),
        member(BEN, 'Ben', { createdAt: now - 90 * day }),
        member(CY, 'Cy'),
      ]),
    )
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
    fire.type(getByRole(shown, 'searchbox'), '')
    getByRole(shown, 'checkbox', { name: strings.adminMemberList.dormantOnly }).click()
    expect(
      [...shown.querySelectorAll('[data-member-id]')].map((row) => row.getAttribute('data-member-id')),
    ).toEqual([BEN])
    getByRole(shown, 'checkbox', { name: strings.adminMemberList.dormantOnly }).click()
    expect(shown.querySelectorAll('[data-member-id]')).toHaveLength(3)
  })

  it('lays each row out as identity, a line of badges and one line of facts, with your own reason under the row', () => {
    const { context, called, clock } = testContext()
    const now = clock.now()
    const channels = ['billing', 'billing-team', 'payroll', 'procurement', 'security-review']
    context.state.groups.set([
      group(TEAM, { name: 'Security, Privacy, Compliance and Vendor Risk Management', memberIds: [ANA] }),
      ...channels.map((slug) => managersOf(slug, { memberIds: [ANA] })),
    ])
    const shown = mount(adminMembersSection(context, lifetime(), me({}, { role: 'admin' })))
    context.state.directory.set([entry(ANA, 'Ana', { lastSeenAt: null })])
    called('listMembers')[0]!.then!.done!(
      listing(
        [member(ANA, 'Ana', { role: 'admin', createdAt: now - 60 * 24 * 60 * 60 * 1000 })],
        [{ memberId: ANA, count: 2, newestExpiresAt: now + 1000 }],
      ),
    )
    const row = shown.querySelector(`[data-member-id="${ANA}"]`)!
    expect([...row.children].map((child) => child.className)).toEqual([
      expect.stringContaining('character'),
      'member-main',
      'hint own-row-reason',
    ])
    const main = row.querySelector('.member-main')!
    expect([...main.children].map((child) => child.className)).toEqual([
      'member-identity',
      'member-tags',
      'member-meta',
    ])
    expect([...main.querySelector('.member-tags')!.children].map((badge) => textOf(badge))).toEqual([
      strings.memberRole.admin,
      strings.memberStatus.active,
      strings.adminMemberList.dormant,
      strings.agentOffline,
    ])
    const meta = main.querySelector('.member-meta')!
    expect(textOf(meta)).toContain(strings.adminMemberList.neverActive)
    expect(textOf(meta.querySelector('.member-agent-credentials')!)).toContain('2')
    expect(textOf(meta.querySelector('.member-groups')!)).toBe(
      strings.adminMemberList.groups({ groups: 'Security, Privacy, Compliance and Vendor Risk Management' }),
    )
    expect(textOf(meta.querySelector('.member-manages')!)).toContain('#security-review')
  })
})
