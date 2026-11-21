import { describe, expect, it } from 'vitest'
import { adminGroupModel, adminGroupsModel, importModel } from '../../src/models/admin-groups.ts'
import { type GroupPageInput, groupPageModel } from '../../src/models/group-page.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, OPS, TEAM, group, managersOf, member } from '../support/fixtures.ts'

describe('adminGroupsModel', () => {
  it('waits for the groups, offers to try again, and says when there are none yet', () => {
    expect(adminGroupsModel([], false, false)).toEqual({ kind: 'loading' })
    expect(adminGroupsModel([], false, true)).toEqual({ kind: 'failed' })
    expect(adminGroupsModel([], true, false)).toEqual({
      kind: 'groups',
      create: strings.groups.create,
      empty: strings.groups.none,
      rows: [],
    })
  })

  it('lists every team by name with its members, each opening its editor, and no channel’s managers', () => {
    const model = adminGroupsModel(
      [
        group(TEAM, { name: 'Zeta', memberIds: [ANA] }),
        group(OPS, { name: 'Alpha', mayAdd: true }),
        managersOf('billing', { memberIds: [ANA] }),
      ],
      true,
      false,
    )
    expect(model.kind === 'groups' && model.rows.map(({ group: _, ...row }) => row)).toEqual([
      { label: 'Alpha', href: '#/admin/groups/grp_ops000000000', members: strings.memberCount({ count: 0 }) },
      { label: 'Zeta', href: '#/admin/groups/grp_team00000000', members: strings.memberCount({ count: 1 }) },
    ])
    expect(adminGroupsModel([managersOf('billing')], true, false)).toMatchObject({
      empty: strings.groups.none,
    })
  })
})

describe('adminGroupModel', () => {
  const back = { label: strings.groups.backToGroups, href: '#/admin/groups' }
  const page = (fields: Partial<GroupPageInput> = {}) =>
    groupPageModel({
      id: TEAM,
      groups: [group(TEAM, { name: 'Finance', memberIds: [ANA], mayAdd: true })],
      loaded: true,
      failed: false,
      members: new Map(),
      directory: [],
      conversations: [],
      viewerId: ANA,
      charactersOn: false,
      ...fields,
    })

  it('waits, fails or misses the group with the way back to every group', () => {
    expect(adminGroupModel(page({ loaded: false }))).toEqual({ kind: 'loading', back })
    expect(adminGroupModel(page({ loaded: false, failed: true }))).toEqual({ kind: 'failed', back })
    expect(adminGroupModel(page({ groups: [] }))).toEqual({ kind: 'missing', back })
  })

  it('edits the team, imports into it only where the administrator may add, and deletes it', () => {
    const shown = adminGroupModel(page())
    expect(shown).toMatchObject({
      kind: 'group',
      back,
      page: { title: 'Finance', rename: { value: 'Finance' } },
      importCsv: strings.groups.importCsv,
      remove: {
        label: strings.groups.delete,
        title: strings.groups.deleteTitle({ group: 'Finance' }),
        hint: strings.groups.deleteHint,
      },
    })
    const frozen = adminGroupModel(page({ groups: [group(TEAM, { name: 'Finance' })] }))
    expect(frozen).toMatchObject({ importCsv: null, page: { rename: null } })
  })
})

describe('importModel', () => {
  const members = [member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy')]
  const team = group(TEAM, { memberIds: [ANA, 'mem_gone00000000' as typeof ANA], mayAdd: true })

  it('waits for the members and for a file', () => {
    expect(importModel({ typed: 'ana@example.com', members: null, group: team })).toEqual({ kind: 'loading' })
    expect(importModel({ typed: '  \n', members, group: team })).toEqual({ kind: 'waiting' })
  })

  it('previews who is added, who is removed and which addresses nobody here uses', () => {
    expect(
      importModel({
        typed: 'email\nben@example.com\ncy@example.com\nnobody@example.com\n',
        members,
        group: team,
      }),
    ).toEqual({
      kind: 'preview',
      memberIds: [BEN, CY],
      adds: { text: strings.groups.adds({ count: 2 }), names: ['Ben', 'Cy'] },
      removes: { text: strings.groups.removes({ count: 2 }), names: ['Ana', strings.formerMember] },
      unknown: strings.groups.unknown({ emails: 'nobody@example.com' }),
      nothing: null,
      mayImport: true,
    })
  })

  it('says when the file changes nobody, and imports nothing then', () => {
    expect(
      importModel({ typed: 'ana@example.com', members, group: group(TEAM, { memberIds: [ANA] }) }),
    ).toEqual({
      kind: 'preview',
      memberIds: [ANA],
      adds: null,
      removes: null,
      unknown: null,
      nothing: strings.groups.importNothing,
      mayImport: false,
    })
  })
})
