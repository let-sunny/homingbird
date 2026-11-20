import { describe, expect, it } from 'vitest'
import { memberAvatarOf } from '../../src/models/avatar.ts'
import { type GroupPageInput, groupNameFrom, groupPageModel } from '../../src/models/group-page.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, TEAM, entry, group, managersOf, member } from '../support/fixtures.ts'

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])

const input = (fields: Partial<GroupPageInput> = {}): GroupPageInput => ({
  id: TEAM,
  groups: [group(TEAM, { name: 'Finance', memberIds: [BEN, ANA] })],
  loaded: true,
  failed: false,
  members,
  directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy')],
  viewerId: ANA,
  charactersOn: false,
  ...fields,
})

describe('groupPageModel', () => {
  it('waits for the groups, offers to try again, and says when there is no such group', () => {
    expect(groupPageModel(input({ loaded: false }))).toEqual({ kind: 'loading' })
    expect(groupPageModel(input({ loaded: false, failed: true }))).toEqual({ kind: 'failed' })
    expect(groupPageModel(input({ id: 'grp_gone00000000' }))).toEqual({
      kind: 'missing',
      text: strings.notFound,
    })
    const managers = managersOf('billing', { memberIds: [ANA] })
    expect(groupPageModel(input({ id: managers.id, groups: [managers] }))).toEqual({
      kind: 'missing',
      text: strings.notFound,
    })
  })

  it('shows a team’s members by name, changing nothing the person may not, and no channel’s managers', () => {
    const model = groupPageModel(input())
    expect(model).toMatchObject({
      kind: 'group',
      title: 'Finance',
      membersHeading: strings.groups.membersOf({ group: 'Finance' }),
      rename: null,
      addMember: null,
    })
    expect(model.kind === 'group' && model.members).toEqual([
      {
        memberId: ANA,
        avatar: memberAvatarOf(members.get(ANA), false),
        name: 'Ana',
        isYou: true,
        remove: null,
      },
      {
        memberId: BEN,
        avatar: memberAvatarOf(members.get(BEN), false),
        name: 'Ben',
        isYou: false,
        remove: null,
      },
    ])
  })

  it('lets a person who may add rename the group and add active people not in it yet', () => {
    const groups = [group(TEAM, { name: 'Finance', memberIds: [ANA], mayAdd: true, mayRemove: true })]
    const gone = entry(BEN, 'Ben', { member: member(BEN, 'Ben', { status: 'deactivated' }) })
    const model = groupPageModel(input({ groups, directory: [entry(ANA, 'Ana'), gone, entry(CY, 'Cy')] }))
    expect(model).toMatchObject({
      title: 'Finance',
      rename: { label: strings.groups.rename, value: 'Finance' },
      addMember: { label: strings.addMemberLabel, choices: [{ value: CY, label: 'Cy · cy@example.com' }] },
      members: [{ name: 'Ana', remove: strings.removeMember }],
    })
    const everyone = groupPageModel(input({ groups, directory: [entry(ANA, 'Ana')] }))
    expect(everyone).toMatchObject({ addMember: null, rename: { value: 'Finance' } })
    const unnamed = groupPageModel(input({ groups: [group(TEAM, { mayAdd: true })] }))
    expect(unnamed).toMatchObject({ title: strings.groups.unnamed, rename: { value: '' } })
  })

  it('offers an administrator who may only remove the remove buttons and no way to add or rename', () => {
    const groups = [group(TEAM, { memberIds: [BEN, CY], mayRemove: true })]
    const model = groupPageModel(input({ groups, viewerId: CY }))
    expect(model).toMatchObject({ rename: null, addMember: null })
    expect(model.kind === 'group' && model.members.map((row) => [row.name, row.remove])).toEqual([
      ['Ben', strings.removeMember],
      [strings.formerMember, strings.removeMember],
    ])
  })
})

describe('groupNameFrom', () => {
  it('takes the name as typed without the spaces around it', () => {
    expect(groupNameFrom('  Finance ')).toBe('Finance')
    expect(groupNameFrom('   ')).toBe('')
  })
})
