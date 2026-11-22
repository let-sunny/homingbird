import { FEATURE_NAMES, featureSwitches } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  type AdminMembersInput,
  adminChannelsModel,
  adminMembersModel,
  adminModel,
  archiveModel,
  deactivationModel,
  domainsFrom,
  featureRows,
  flowToolsModel,
  isDormant,
  saveBarModel,
  whoCanInviteChoices,
} from '../../src/models/admin.ts'
import { formats, strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  OPS,
  TEAM,
  channel,
  entry,
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
    expect(on.tabs[2]).toEqual({
      section: 'groups',
      href: '#/admin/groups',
      label: strings.groups.title,
      current: true,
    })
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

describe('saveBarModel', () => {
  const saved = {
    allowedDomains: ['example.com'],
    contactMode: 'open',
    answeringFlow: null,
    whoCanInvite: 'admins',
    features: { teaching: true, groups: true },
  }

  it('hides the bar while nothing differs from what was saved', () => {
    expect(saveBarModel(saved, { ...saved, features: { ...saved.features } })).toEqual({
      shown: false,
      text: strings.unsavedSettings,
      save: strings.save,
    })
  })

  it('shows it once any one setting differs', () => {
    for (const change of [
      { allowedDomains: ['example.com', 'acme.io'] },
      { contactMode: 'contacts' },
      { answeringFlow: 'Check the dates.' },
      { whoCanInvite: 'members' },
      { features: { ...saved.features, teaching: false } },
    ])
      expect(saveBarModel(saved, { ...saved, ...change }).shown).toBe(true)
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
  const NOW = Date.UTC(2026, 10, 19, 12)
  const DAY = 24 * 60 * 60 * 1000
  const input = (fields: Partial<AdminMembersInput> = {}): AdminMembersInput => ({
    members: [],
    viewerId: ANA,
    charactersOn: true,
    directory: [],
    groups: [],
    agentCredentials: null,
    query: '',
    dormantOnly: false,
    now: NOW,
    ...fields,
  })

  it('waits for the list, and offers each member what may change, never for the person themself', () => {
    expect(adminMembersModel(input({ members: null }))).toBeNull()
    const { rows } = adminMembersModel(
      input({
        members: [
          member(ANA, 'Ana', { role: 'admin' }),
          member(BEN, 'Ben', { role: 'admin', status: 'deactivated', character: { id: 'owl' } as never }),
          member(CY, 'Cy'),
        ],
      }),
    )!
    expect(rows[0]).toMatchObject({
      isYou: true,
      actions: [],
      role: { text: strings.memberRole.admin, className: 'kind is-admin' },
    })
    expect(rows[1]!.actions.map((action) => action.kind)).toEqual(['reactivate', 'reset-character'])
    expect(rows[2]!.actions).toEqual([
      { kind: 'make-admin', label: strings.makeAdmin, danger: false },
      { kind: 'deactivate', label: strings.deactivate, danger: true },
    ])
    expect(
      adminMembersModel(
        input({ members: [member(BEN, 'Ben', { character: { id: 'owl' } as never })], charactersOn: false }),
      )!.rows[0]!.actions.map((action) => action.kind),
    ).toEqual(['make-admin', 'deactivate'])
  })

  it('offers no role change to a deactivated member, admin or not, until they are reactivated', () => {
    const { rows } = adminMembersModel(
      input({
        members: [
          member(ANA, 'Ana', { role: 'admin' }),
          member(BEN, 'Ben', { status: 'deactivated' }),
          member(CY, 'Cy', { role: 'admin', status: 'deactivated' }),
        ],
      }),
    )!
    expect(rows.slice(1).map((row) => row.actions.map((action) => action.kind))).toEqual([
      ['reactivate'],
      ['reactivate'],
    ])
  })

  it('says when each member was last active, in full on hover, and never for one who never connected', () => {
    const { rows } = adminMembersModel(
      input({
        members: [member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy')],
        directory: [
          entry(ANA, 'Ana', { lastSeenAt: NOW - 3 * DAY }),
          entry(BEN, 'Ben', { lastSeenAt: NOW - 2 * 60 * 60 * 1000 }),
          entry(CY, 'Cy', { lastSeenAt: null }),
        ],
      }),
    )!
    const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    expect(rows[0]!.lastActive).toEqual({
      text: strings.adminMemberList.lastActive({ when: relative.format(-3, 'day') }),
      title: strings.adminMemberList.lastActiveTitle({ time: formats.full.format(new Date(NOW - 3 * DAY)) }),
    })
    expect(rows[1]!.lastActive!.text).toBe(
      strings.adminMemberList.lastActive({ when: relative.format(-2, 'hour') }),
    )
    expect(rows[2]!.lastActive).toEqual({ text: strings.adminMemberList.neverActive, title: null })
  })

  it('says nothing of activity or agent for a member the directory does not list, such as a deactivated one', () => {
    const { rows } = adminMembersModel(
      input({ members: [member(BEN, 'Ben', { status: 'deactivated', createdAt: NOW - 90 * DAY })] }),
    )!
    expect(rows[0]).toMatchObject({ lastActive: null, agent: null, dormant: null })
  })

  it('tells an awake agent, one that is not awake, and one whose desk runs but cannot answer', () => {
    const { rows } = adminMembersModel(
      input({
        members: [member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy')],
        directory: [
          entry(ANA, 'Ana', { presence: { humanOnline: true, agentOnline: true } }),
          entry(BEN, 'Ben', { presence: { humanOnline: false, agentOnline: false } }),
          entry(CY, 'Cy', {
            presence: { humanOnline: false, agentOnline: true, agentUnavailable: { until: null } },
          }),
        ],
      }),
    )!
    expect(rows.map((row) => [row.agent!.className, row.agent!.text])).toEqual([
      ['agent-light is-on', strings.agentOnline],
      ['agent-light is-off', strings.agentOffline],
      ['agent-light is-unavailable', strings.agentUnavailable],
    ])
  })

  it('flags an active member with no activity for more than 30 days, counting from joining if they never connected', () => {
    const at = (lastSeenAt: number | null, createdAt = NOW - 100 * DAY) =>
      adminMembersModel(
        input({
          members: [member(BEN, 'Ben', { createdAt })],
          directory: [entry(BEN, 'Ben', { lastSeenAt })],
        }),
      )!.rows[0]!.dormant
    expect(at(NOW - 30 * DAY)).toBeNull()
    expect(at(NOW - 30 * DAY - 1)).toBe(strings.adminMemberList.dormant)
    expect(at(null)).toBe(strings.adminMemberList.dormant)
    expect(at(null, NOW - DAY)).toBeNull()
    expect(isDormant(member(BEN, 'Ben', { status: 'deactivated' }), null, NOW)).toBe(false)
  })

  it('names the teams a member is in and the channels they manage apart, and nothing for one in none', () => {
    const { rows } = adminMembersModel(
      input({
        members: [member(BEN, 'Ben'), member(CY, 'Cy')],
        groups: [
          group(TEAM, { name: 'Finance', memberIds: [BEN] }),
          managersOf('billing', { memberIds: [BEN] }),
          managersOf('payroll', { memberIds: [BEN] }),
        ],
      }),
    )!
    expect(rows[0]!.groupNames).toEqual([
      'Finance',
      strings.groups.managersOf({ channel: '#billing' }),
      strings.groups.managersOf({ channel: '#payroll' }),
    ])
    expect(rows[0]!.groups).toBe(
      strings.adminMemberList.groups({ groups: formats.names.format(['Finance']) }),
    )
    expect(rows[0]!.manages).toBe(strings.groups.manages({ channels: '#billing and #payroll' }))
    expect(rows[1]).toMatchObject({ groupNames: [], groups: null, manages: null })
  })

  it('says how many agent connections each person holds and when the newest expires, and nothing where the server does not say', () => {
    const members = [member(BEN, 'Ben'), member(CY, 'Cy')]
    const expires = NOW + 30 * DAY
    const { rows } = adminMembersModel(
      input({ members, agentCredentials: [{ memberId: BEN, count: 2, newestExpiresAt: expires }] }),
    )!
    expect(rows[0]!.agentCredentials).toBe(
      strings.adminMemberList.agentCredentials({ count: 2, date: formats.day.format(new Date(expires)) }),
    )
    expect(rows[1]!.agentCredentials).toBe(strings.adminMemberList.noAgentCredentials)
    expect(adminMembersModel(input({ members }))!.rows[0]!.agentCredentials).toBeNull()
  })

  it('filters by name, email or group whatever the case, and says when nothing matches', () => {
    const members = [member(ANA, 'Ana'), member(BEN, 'Ben', { email: 'b.lee@corp.test' }), member(CY, 'Cy')]
    const groups = [group(TEAM, { name: 'Finance', memberIds: [CY] })]
    const names = (query: string) =>
      adminMembersModel(input({ members, groups, query }))!.rows.map((row) => row.member.name)
    expect(names('')).toEqual(['Ana', 'Ben', 'Cy'])
    expect(names('  aNA ')).toEqual(['Ana'])
    expect(names('CORP.test')).toEqual(['Ben'])
    expect(names('fin')).toEqual(['Cy'])
    expect(adminMembersModel(input({ members, query: ' zed ' }))).toEqual({
      rows: [],
      noMatch: strings.adminMemberList.noMatch({ query: 'zed' }),
    })
    expect(adminMembersModel(input({ members: [] }))).toEqual({ rows: [], noMatch: null })
  })

  it('shows only the members with no activity for 30 days when asked, with the search, and says when none has gone quiet', () => {
    const members = [member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy')]
    const directory = [
      entry(ANA, 'Ana', { lastSeenAt: NOW }),
      entry(BEN, 'Ben', { lastSeenAt: NOW - 40 * DAY }),
      entry(CY, 'Cy', { lastSeenAt: NOW - 60 * DAY }),
    ]
    const names = (fields: Partial<AdminMembersInput>) =>
      adminMembersModel(input({ members, directory, dormantOnly: true, ...fields }))!.rows.map(
        (row) => row.member.name,
      )
    expect(names({})).toEqual(['Ben', 'Cy'])
    expect(names({ query: 'cy' })).toEqual(['Cy'])
    expect(names({ dormantOnly: false })).toEqual(['Ana', 'Ben', 'Cy'])
    const quiet = [
      entry(ANA, 'Ana', { lastSeenAt: NOW }),
      entry(BEN, 'Ben', { lastSeenAt: NOW }),
      entry(CY, 'Cy', { lastSeenAt: NOW }),
    ]
    expect(adminMembersModel(input({ members, directory: quiet, dormantOnly: true }))).toEqual({
      rows: [],
      noMatch: strings.adminMemberList.noDormant,
    })
    expect(
      adminMembersModel(input({ members, directory: quiet, dormantOnly: true, query: 'zed' }))!.noMatch,
    ).toBe(strings.adminMemberList.noMatch({ query: 'zed' }))
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
