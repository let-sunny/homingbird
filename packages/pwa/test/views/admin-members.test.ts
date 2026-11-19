import { presetById } from '@homingbird/sprites'
import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { adminMembersSection } from '../../src/views/admin-members.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, me, member } from '../support/fixtures.ts'

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
})
