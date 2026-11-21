import { FEATURE_NAMES, featureSwitches } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  adminChannelsModel,
  adminMembersModel,
  adminModel,
  archiveModel,
  deactivationModel,
  domainsFrom,
  featureRows,
  flowToolsModel,
  whoCanInviteChoices,
} from '../../src/models/admin.ts'
import { strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  OPS,
  TEAM,
  channel,
  group,
  managersOf,
  member,
  serverInfo,
} from '../support/fixtures.ts'

describe('adminModel', () => {
  it('offers Insights only where it is on, and shows settings in its place otherwise', () => {
    const on = adminModel(serverInfo({ insights: true }), 'insights')
    expect(on.tabs.map((tab) => [tab.label, tab.current])).toEqual([
      [strings.adminSettings, false],
      [strings.adminMembers, false],
      [strings.adminChannels, false],
      [strings.adminInsights, true],
    ])
    expect(on.shown).toBe('insights')
    const off = adminModel(serverInfo(), 'insights')
    expect(off.tabs).toHaveLength(3)
    expect(off.shown).toBe('settings')
    expect(adminModel(serverInfo(), 'members')).toMatchObject({ title: strings.adminTitle, shown: 'members' })
  })

  it('offers Groups only where they are on, and shows settings in their place otherwise', () => {
    const on = adminModel(serverInfo({ groups: true }), 'groups')
    expect(on.tabs.map((tab) => tab.label)).toEqual([
      strings.adminSettings,
      strings.adminMembers,
      strings.groups.title,
      strings.adminChannels,
    ])
    expect(on.tabs[2]).toEqual({ href: '#/admin/groups', label: strings.groups.title, current: true })
    expect(on.shown).toBe('groups')
    expect(adminModel(serverInfo(), 'groups').shown).toBe('settings')
  })
})

describe('deactivationModel', () => {
  it('names every group a member leaves when deactivated, and asks nothing when they are in none', () => {
    const groups = [
      group(TEAM, { name: 'Finance', memberIds: [BEN] }),
      managersOf('ops', { memberIds: [BEN, CY] }),
    ]
    expect(deactivationModel(member(BEN, 'Ben'), groups)).toEqual({
      title: strings.deactivateTitle({ name: 'Ben' }),
      body: strings.groups.deactivateLeaves({ name: 'Ben', groups: 'Finance and Managers of #ops' }),
      confirm: strings.deactivate,
    })
    expect(deactivationModel(member(ANA, 'Ana'), groups)).toBeNull()
  })
})

describe('domainsFrom', () => {
  it('takes one domain per line or comma, in lower case', () => {
    expect(domainsFrom(' Example.com,\nacme.io  , \n')).toEqual(['example.com', 'acme.io'])
  })
})

describe('whoCanInviteChoices', () => {
  it.each([
    [undefined, 'admins'],
    ['admins', 'admins'],
    ['members', 'members'],
    ['unknown', 'admins'],
  ] as const)('selects %s as %s', (saved, selected) => {
    const choices = whoCanInviteChoices(saved)
    expect(choices.map((choice) => [choice.value, choice.label])).toEqual([
      ['admins', strings.whoCanInviteAdmins],
      ['members', strings.whoCanInviteMembers],
    ])
    expect(choices.find((choice) => choice.selected)?.value).toBe(selected)
  })
})

describe('featureRows', () => {
  it('shows each feature with its switch and what people lose without it', () => {
    const switches = { ...featureSwitches({}), teaching: false }
    const rows = featureRows(switches)
    expect(rows.map((row) => row.name)).toEqual([...FEATURE_NAMES])
    const teaching = rows.find((row) => row.name === 'teaching')!
    expect(teaching).toEqual({
      name: 'teaching',
      on: false,
      className: 'todo-row feature-row is-off',
      label: strings.features.names.teaching,
      loss: strings.features.whenOff.teaching,
      check: '',
    })
    expect(rows.find((row) => row.on)?.check).toBe('✓')
  })
})

describe('flowToolsModel', () => {
  it('counts the flow and allows the example only into an empty one', () => {
    const empty = flowToolsModel([])
    expect(empty.exampleDisabled).toBe(false)
    expect(empty.counterClass).toBe('flow-count')
    const full = flowToolsModel([{ part: 'before', text: 'x'.repeat(5000), enabled: true }])
    expect(full).toMatchObject({ exampleDisabled: true, counterClass: 'flow-count is-over' })
    expect(full.counter).toContain(' · ')
  })
})

describe('adminMembersModel', () => {
  it('waits for the list, and offers each member what may change, never for the person themself', () => {
    expect(adminMembersModel(null, ANA, true)).toBeNull()
    const rows = adminMembersModel(
      [
        member(ANA, 'Ana', { role: 'admin' }),
        member(BEN, 'Ben', { role: 'admin', status: 'deactivated', character: { id: 'owl' } as never }),
        member(CY, 'Cy'),
      ],
      ANA,
      true,
    )!
    expect(rows[0]).toMatchObject({
      isYou: true,
      actions: [],
      role: { text: strings.memberRole.admin, className: 'kind is-admin' },
    })
    expect(rows[1]!.actions.map((action) => action.kind)).toEqual([
      'make-member',
      'reactivate',
      'reset-character',
    ])
    expect(rows[2]!.actions).toEqual([
      { kind: 'make-admin', label: strings.makeAdmin, danger: false },
      { kind: 'deactivate', label: strings.deactivate, danger: true },
    ])
    expect(
      adminMembersModel(
        [member(BEN, 'Ben', { character: { id: 'owl' } as never })],
        ANA,
        false,
      )![0]!.actions.map((action) => action.kind),
    ).toEqual(['make-admin', 'deactivate'])
  })
})

describe('adminChannelsModel', () => {
  it('waits, offers a retry after a failure, says when there are none, and lists each channel', () => {
    expect(adminChannelsModel([], false, false)).toEqual({ kind: 'loading' })
    expect(adminChannelsModel([], false, true)).toEqual({ kind: 'failed' })
    expect(adminChannelsModel([], true, false)).toEqual({ kind: 'empty', text: strings.adminNoChannels })
    expect(adminChannelsModel([channel('billing')], true, false)).toEqual({
      kind: 'channels',
      rows: [
        {
          channel: channel('billing'),
          label: '#billing',
          editTitle: strings.editChannelTitle({ channel: '#billing' }),
          archiveTitle: strings.archiveChannelTitle({ channel: '#billing' }),
        },
      ],
    })
  })
})

describe('archiveModel', () => {
  it('says what archiving does, and where members may move when there is another channel', () => {
    expect(archiveModel([channel('billing')], 'billing')).toEqual({
      effects: [
        strings.archiveLeavesList,
        strings.archiveRoomReadOnly,
        strings.archiveNotesStay,
        strings.archiveDraftsDiscarded,
      ],
      moveTo: null,
    })
    const moving = archiveModel([channel('billing'), channel('ops')], 'billing')
    expect(moving.effects.at(-1)).toBe(strings.archiveMembersMove)
    expect(moving.moveTo).toEqual([{ value: 'ops', label: '#ops' }])
  })
})
