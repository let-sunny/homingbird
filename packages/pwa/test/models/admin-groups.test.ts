import { describe, expect, it } from 'vitest'
import { adminGroupsModel, importModel } from '../../src/models/admin-groups.ts'
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

  it('lists every team by name with its members, to import into and delete, and no channel’s managers', () => {
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
      {
        label: 'Alpha',
        href: '#/group/grp_ops000000000',
        members: strings.memberCount({ count: 0 }),
        deleteTitle: strings.groups.deleteTitle({ group: 'Alpha' }),
        importCsv: strings.groups.importCsv,
      },
      {
        label: 'Zeta',
        href: '#/group/grp_team00000000',
        members: strings.memberCount({ count: 1 }),
        deleteTitle: strings.groups.deleteTitle({ group: 'Zeta' }),
        importCsv: null,
      },
    ])
    expect(adminGroupsModel([managersOf('billing')], true, false)).toMatchObject({
      empty: strings.groups.none,
    })
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
