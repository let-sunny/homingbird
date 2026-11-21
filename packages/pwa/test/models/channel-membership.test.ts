import type { ChannelMember } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  type MembersPanelInput,
  answeringModel,
  leaveConsequence,
  membersPanelModel,
  roomControlsModel,
  rosterNeed,
} from '../../src/models/channel-membership.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, OPS, TEAM, channel, entry, group, managersOf, member } from '../support/fixtures.ts'

const roster = (...members: ChannelMember[]) => ({ memberCount: members.length, members })
const one = (memberId: typeof ANA, manager = false, answering = false): ChannelMember => ({
  memberId,
  manager,
  answering,
})

describe('roomControlsModel', () => {
  it('offers answering and leaving in a channel the person is in, and managing where they manage', () => {
    const billing = channel('billing', { joined: true, managing: true })
    expect(roomControlsModel(billing, roster(one(ANA), one(BEN, true)), ANA)).toEqual({
      answering: answeringModel(billing),
      more: { id: 'room-menu-billing', label: strings.roomMore({ channel: '#billing' }) },
      description: billing.description,
      manage: strings.membersTitle({ channel: '#billing' }),
      leave: { kind: 'allowed', title: strings.leaveChannelTitle({ channel: '#billing' }) },
      leaveBody: strings.leaveChannelBody,
    })
  })

  it('keeps a manager in the room while they are in its group, and offers nothing in a channel the person is not in', () => {
    const billing = channel('billing', { joined: true, managing: true, visibility: 'private' })
    expect(roomControlsModel(billing, roster(one(ANA, true), one(BEN)), ANA).leave).toEqual({
      kind: 'blocked',
      reason: strings.managerCannotLeave,
    })
    expect(roomControlsModel(billing, roster(one(ANA, true), one(BEN)), BEN).leave).toMatchObject({
      kind: 'allowed',
    })
    expect(roomControlsModel(channel('ops'), null, ANA)).toMatchObject({
      answering: null,
      manage: null,
      leave: null,
    })
  })
})

describe('rosterNeed', () => {
  it('asks for the roster of a managed channel when it is missing or its member count changed', () => {
    const managed = channel('billing', { joined: true, managing: true, memberCount: 2 })
    expect(rosterNeed(managed, new Map())).toEqual({ roster: null, stale: true })
    const known = roster(one(ANA), one(BEN))
    expect(rosterNeed(managed, new Map([['billing', known]]))).toEqual({ roster: known, stale: false })
    expect(rosterNeed(channel('billing'), new Map())).toEqual({ roster: null, stale: false })
  })
})

describe('answeringModel', () => {
  it('says whether the person answers there', () => {
    expect(answeringModel(channel('billing', { answering: true }))).toEqual({
      labelId: 'answering-label-billing',
      hintId: 'answering-billing',
      label: strings.answerHere,
      hint: strings.answerHereHint,
      helpLabel: strings.answerHereHelp,
      checked: true,
      state: strings.switchOn,
    })
    expect(answeringModel(channel('billing')).state).toBe(strings.switchOff)
  })
})

describe('membersPanelModel', () => {
  const members = new Map([
    [ANA, member(ANA, 'Ana')],
    [BEN, member(BEN, 'Ben')],
  ])
  const input = (fields: Partial<MembersPanelInput>): MembersPanelInput => ({
    channel: channel('billing', { joined: true, managing: true }),
    roster: null,
    viewerId: ANA,
    viewerIsAdmin: false,
    members,
    directory: [],
    groups: [],
    groupsOn: true,
    ...fields,
  })

  it('waits for the roster, and tells an administrator outside the channel why they manage it', () => {
    expect(membersPanelModel(input({}))).toEqual({
      managedByAdmin: null,
      managedBy: null,
      addManager: null,
      addTeam: null,
      rows: null,
      addMember: null,
      visibility: null,
    })
    expect(
      membersPanelModel(input({ viewerIsAdmin: true, channel: channel('billing', { managing: true }) }))
        .managedByAdmin,
    ).toBe(strings.managedByAdmin)
  })

  it('shows an administrator outside a private channel its roster, with removal but nothing that adds', () => {
    const secret = channel('secret', { visibility: 'private', managing: false, joined: false })
    const model = membersPanelModel(
      input({
        channel: secret,
        viewerId: CY,
        viewerIsAdmin: true,
        roster: [one(ANA, true), one(BEN)],
        directory: [entry(CY, 'Cy')],
        groups: [
          managersOf('secret', { memberIds: [ANA], mayRemove: true }),
          group(OPS, { name: 'Ops', memberIds: [CY] }),
        ],
      }),
    )
    expect(model).toEqual({
      managedByAdmin: strings.seenByAdmin,
      managedBy: {
        text: strings.groups.managedBy({ group: strings.groups.managersOf({ channel: '#secret' }) }),
      },
      addManager: null,
      addTeam: null,
      rows: [
        expect.objectContaining({ kind: 'other', memberId: ANA, remove: null }),
        expect.objectContaining({ kind: 'other', memberId: BEN, remove: strings.removeMember }),
      ],
      addMember: null,
      visibility: null,
    })
    expect(roomControlsModel(secret, null, CY, true).manage).toBe(
      strings.membersTitle({ channel: '#secret' }),
    )
    expect(roomControlsModel(secret, null, CY, false).manage).toBeNull()
    expect(roomControlsModel(channel('ops'), null, CY, true).manage).toBeNull()
  })

  it('lets the person leave, marks the managers, and removes no manager from the room', () => {
    const model = membersPanelModel(input({ roster: [one(ANA, false, true), one(BEN, true), one(CY)] }))
    const [own, ben, cy] = model.rows!
    expect(own).toEqual({
      kind: 'own',
      memberId: ANA,
      name: 'Ana',
      roles: [{ text: strings.answersLabel, className: 'kind is-helping' }],
      blocked: null,
      leave: {
        title: strings.leaveChannelTitle({ channel: '#billing' }),
        body: strings.leaveChannelBody,
        confirm: strings.leaveChannel,
      },
      unmanage: null,
    })
    expect(ben).toEqual({
      kind: 'other',
      memberId: BEN,
      name: 'Ben',
      roles: [{ text: strings.managerLabel, className: 'kind is-manager' }],
      remove: null,
      unmanage: null,
    })
    expect(cy).toMatchObject({ name: strings.formerMember, remove: null })
    expect(model.addMember).toBeNull()
    expect(model.visibility).toBe(strings.visibilityOpen)
  })

  it('keeps a manager in the room while they are in its managing group, and says why', () => {
    const own = membersPanelModel(input({ roster: [one(ANA, true), one(BEN)] })).rows![0]!
    expect(own).toMatchObject({ kind: 'own', blocked: strings.managerCannotLeave })
  })

  it('names the channel’s managers, as far as the person can see them', () => {
    const groups = [managersOf('billing', { memberIds: [ANA] })]
    expect(membersPanelModel(input({ groups })).managedBy).toEqual({
      text: strings.groups.managedBy({ group: strings.groups.managersOf({ channel: '#billing' }) }),
    })
    expect(membersPanelModel(input({})).managedBy).toBeNull()
  })

  it('adds one person to the managers, or the people of a team once, where the person may add managers', () => {
    const groups = [
      managersOf('billing', { memberIds: [ANA], mayAdd: true, mayRemove: true }),
      group(OPS, { name: 'Operations', memberIds: [ANA, BEN] }),
      group(TEAM, { name: 'Finance', memberIds: [ANA] }),
    ]
    const roster = [one(ANA, true)]
    const directory = [entry(ANA, 'Ana'), entry(BEN, 'Ben')]
    const model = membersPanelModel(input({ groups, roster, directory }))
    expect(model.addManager).toEqual({
      label: strings.groups.addManager,
      choices: [{ value: BEN, label: 'Ben · ben@example.com' }],
      groupId: 'grp_billing00000',
      memberIds: [ANA],
    })
    expect(model.addTeam).toEqual({
      label: strings.groups.addTeam,
      hint: strings.groups.addTeamHint,
      choices: [{ value: OPS, label: 'Operations' }],
    })
    const everyone = [managersOf('billing', { memberIds: [ANA, BEN], mayAdd: true }), groups[1]!]
    expect(membersPanelModel(input({ groups: everyone, roster, directory }))).toMatchObject({
      addManager: null,
      addTeam: null,
    })
    for (const shut of [
      input({ groups: [{ ...groups[0]!, mayAdd: false }, ...groups.slice(1)], roster, directory }),
      input({ groups, roster, directory, groupsOn: false }),
    ])
      expect(membersPanelModel(shut)).toMatchObject({ addManager: null, addTeam: null })
  })

  it('takes a manager out of the managers where the person may, never the last one', () => {
    const groups = [managersOf('billing', { memberIds: [ANA, BEN], mayRemove: true })]
    const roster = [one(ANA, true), one(BEN, true), one(CY)]
    const [own, ben, cy] = membersPanelModel(input({ groups, roster })).rows!
    expect(own!.unmanage).toEqual({
      label: strings.groups.unmanage,
      groupId: 'grp_billing00000',
      memberIds: [BEN],
    })
    expect(ben!.unmanage).toEqual({
      label: strings.groups.unmanage,
      groupId: 'grp_billing00000',
      memberIds: [ANA],
    })
    expect(cy!.unmanage).toBeNull()
    const alone = [managersOf('billing', { memberIds: [ANA], mayRemove: true })]
    expect(
      membersPanelModel(input({ groups: alone, roster: [one(ANA, true)] })).rows![0]!.unmanage,
    ).toBeNull()
    const barred = [managersOf('billing', { memberIds: [ANA, BEN], mayRemove: false })]
    expect(membersPanelModel(input({ groups: barred, roster })).rows![1]!.unmanage).toBeNull()
  })

  it('adds and removes members of a private channel, and says it is private', () => {
    const secret = channel('secret', { joined: true, managing: true, visibility: 'private', memberCount: 2 })
    const model = membersPanelModel(
      input({
        channel: secret,
        roster: [one(ANA, true), one(BEN)],
        directory: [entry(ANA, 'Ana'), entry(CY, 'Cy')],
      }),
    )
    expect(model.rows![1]).toMatchObject({ remove: strings.removeMember })
    expect(model.addMember).toEqual({
      kind: 'choose',
      choices: [{ value: CY, label: 'Cy · cy@example.com' }],
    })
    expect(model.visibility).toBe(strings.visibilityPrivate)
    expect(
      membersPanelModel(input({ channel: secret, roster: [one(ANA, true)], directory: [entry(ANA, 'Ana')] }))
        .addMember,
    ).toEqual({ kind: 'nobody', text: strings.nobodyToAdd })
  })
})

describe('leaveConsequence', () => {
  it('warns that a private channel cannot be joined again alone', () => {
    expect(leaveConsequence(channel('secret', { visibility: 'private' }))).toBe(
      strings.leavePrivateChannelBody({ channel: '#secret' }),
    )
  })
})
