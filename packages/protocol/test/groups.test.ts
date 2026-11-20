import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GROUP_MEMBERS_MAX, GROUP_NAME_MAX, Group, GroupName, membershipChange } from '../src/groups.ts'
import { MemberId } from '../src/ids.ts'
import { refinements } from './contract-refinements.ts'

const memberIds = fc.array(arbitrary(MemberId), { maxLength: 12 })
const sameMembers = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  expect([...new Set(a)].sort()).toEqual([...new Set(b)].sort())

const ana = 'mem_ana000000000'
const ben = 'mem_ben000000000'
const cy = 'mem_cy0000000000'

const group = {
  id: 'grp_payroll00000',
  kind: 'team',
  name: 'Payroll',
  memberIds: [ana, ben],
  channels: ['payroll'],
  mayAdd: true,
  mayRemove: true,
  createdAt: 1,
}

describe('a group', () => {
  it('round-trips every generated group through JSON', () => {
    fc.assert(
      fc.property(arbitrary(Group, refinements), (generated) => {
        expect(Group.decode(JSON.parse(JSON.stringify(generated)))).toEqual({ _tag: 'Ok', value: generated })
      }),
      { numRuns: 60 },
    )
  })

  it('is a team or a channel’s group, may have no name, and holds at most 500 members', () => {
    expect(Group.is({ ...group, kind: 'channel', name: null })).toBe(true)
    expect(Group.is({ ...group, kind: 'circle' })).toBe(false)
    expect(GROUP_MEMBERS_MAX).toBe(500)
    const many = Array.from({ length: GROUP_MEMBERS_MAX + 1 }, (_, index) =>
      MemberId.of(String(index).padStart(12, '0')),
    )
    expect(Group.is({ ...group, memberIds: many.slice(0, GROUP_MEMBERS_MAX) })).toBe(true)
    expect(Group.is({ ...group, memberIds: many })).toBe(false)
  })

  it('names itself with one printable line of at most 80 characters', () => {
    expect(GROUP_NAME_MAX).toBe(80)
    expect(GroupName.is('Payroll team')).toBe(true)
    expect(GroupName.is('x'.repeat(GROUP_NAME_MAX))).toBe(true)
    for (const refused of ['', '   ', 'x'.repeat(GROUP_NAME_MAX + 1), 'Pay\nroll', 'Pay​roll', 'Pay\troll'])
      expect([refused, GroupName.is(refused)]).toEqual([refused, false])
    expect(Group.is({ ...group, name: '' })).toBe(false)
  })
})

describe('a change of membership', () => {
  it('turns the old list into the new one when applied', () => {
    fc.assert(
      fc.property(memberIds, memberIds, (before, after) => {
        const { added, removed } = membershipChange(before, after)
        sameMembers([...before.filter((id) => !removed.includes(id)), ...added], after)
      }),
    )
  })

  it('turns the new list back into the old one when undone', () => {
    fc.assert(
      fc.property(memberIds, memberIds, (before, after) => {
        const { added, removed } = membershipChange(before, after)
        sameMembers([...after.filter((id) => !added.includes(id)), ...removed], before)
        expect(membershipChange(after, before)).toEqual({ added: removed, removed: added })
      }),
    )
  })

  it('names each member once, never on both sides, and nobody when nothing changes', () => {
    fc.assert(
      fc.property(memberIds, memberIds, (before, after) => {
        const { added, removed } = membershipChange(before, after)
        expect(new Set(added).size).toBe(added.length)
        expect(new Set(removed).size).toBe(removed.length)
        expect(added.filter((id) => removed.includes(id))).toEqual([])
        expect(membershipChange(before, [...before].reverse())).toEqual({ added: [], removed: [] })
      }),
    )
  })

  it('keeps the order of the list that names them', () => {
    expect(membershipChange([ana, ben, cy, ben], [cy, 'mem_dee000000000', ana, 'mem_eve000000000'])).toEqual({
      added: ['mem_dee000000000', 'mem_eve000000000'],
      removed: [ben],
    })
    expect(membershipChange([], [ben, ana, ben])).toEqual({ added: [ben, ana], removed: [] })
    expect(membershipChange([cy, ana], [])).toEqual({ added: [], removed: [cy, ana] })
  })
})
