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
import { ANA, BEN, CY, channel, entry, member } from '../support/fixtures.ts'

const roster = (...members: ChannelMember[]) => ({ memberCount: members.length, members })
const one = (memberId: typeof ANA, manager = false, answering = false): ChannelMember => ({
  memberId,
  manager,
  answering,
})

describe('roomControlsModel', () => {
  it('offers answering and leaving in a channel the person is in, and managing where they manage', () => {
    const billing = channel('billing', { joined: true, managing: true })
    expect(roomControlsModel(billing, roster(one(ANA, true), one(BEN, true)), ANA)).toEqual({
      answering: answeringModel(billing),
      manage: strings.membersTitle({ channel: '#billing' }),
      leave: { kind: 'allowed', title: strings.leaveChannelTitle({ channel: '#billing' }) },
      leaveBody: strings.leaveChannelBody,
    })
  })

  it('keeps the last manager from leaving, and offers nothing in a channel the person is not in', () => {
    const billing = channel('billing', { joined: true, managing: true, visibility: 'private' })
    expect(roomControlsModel(billing, roster(one(ANA, true), one(BEN)), ANA).leave).toEqual({
      kind: 'blocked',
      reason: strings.lastManagerCannotLeave,
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
    ...fields,
  })

  it('waits for the roster, and tells an administrator outside the channel why they manage it', () => {
    expect(membersPanelModel(input({}))).toEqual({
      managedByAdmin: null,
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
      }),
    )
    expect(model).toEqual({
      managedByAdmin: strings.seenByAdmin,
      rows: [
        expect.objectContaining({ kind: 'other', memberId: ANA, manager: null, remove: null }),
        expect.objectContaining({
          kind: 'other',
          memberId: BEN,
          manager: null,
          remove: strings.removeMember,
        }),
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

  it('lets the person step down or leave, and change managers of others, but keeps one manager', () => {
    const model = membersPanelModel(input({ roster: [one(ANA, true, true), one(BEN, true), one(CY)] }))
    const [own, ben, cy] = model.rows!
    expect(own).toMatchObject({
      kind: 'own',
      name: 'Ana',
      roles: [
        { text: strings.managerLabel, className: 'kind is-manager' },
        { text: strings.answersLabel, className: 'kind is-helping' },
      ],
      blocked: null,
      stepDown: { confirm: strings.stepDown, title: strings.stepDownTitle({ channel: '#billing' }) },
      leave: { confirm: strings.leaveChannel, body: strings.leaveChannelBody },
    })
    expect(ben).toMatchObject({
      kind: 'other',
      name: 'Ben',
      manager: { label: strings.revokeManager, makes: false },
      remove: null,
    })
    expect(cy).toMatchObject({
      name: strings.formerMember,
      manager: { label: strings.makeManager, makes: true },
    })
    expect(model.addMember).toBeNull()
    expect(model.visibility).toMatchObject({
      current: strings.visibilityOpen,
      change: { kind: 'allowed', label: strings.makePrivate },
      confirmation: { confirm: strings.confirmMakePrivate },
    })
  })

  it('keeps the last manager in place and says why', () => {
    const own = membersPanelModel(input({ roster: [one(ANA, true), one(BEN)] })).rows![0]!
    expect(own).toMatchObject({ blocked: strings.lastManagerOwnRow, stepDown: expect.anything() })
    const other = membersPanelModel(input({ viewerId: CY, roster: [one(ANA, true), one(BEN)] })).rows![0]!
    expect(other).toMatchObject({ kind: 'other', manager: null, remove: null })
    const mine = membersPanelModel(input({ roster: [one(ANA)] })).rows![0]!
    expect(mine).toMatchObject({ blocked: null, stepDown: null })
  })

  it('adds and removes members of a private channel, and makes it open again', () => {
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
    expect(model.visibility).toMatchObject({
      current: strings.visibilityPrivate,
      change: { kind: 'allowed', label: strings.makeOpen },
      confirmation: {
        title: strings.makeOpenTitle({ channel: '#secret' }),
        body: strings.makeOpenBody({ channel: '#secret' }),
        confirm: strings.confirmMakeOpen,
      },
    })
    expect(
      membersPanelModel(input({ channel: secret, roster: [one(ANA, true)], directory: [entry(ANA, 'Ana')] }))
        .addMember,
    ).toEqual({ kind: 'nobody', text: strings.nobodyToAdd })
  })

  it('needs a manager before a channel turns private', () => {
    const model = membersPanelModel(input({ roster: [one(ANA), one(BEN)] }))
    expect(model.visibility!.change).toEqual({
      kind: 'blocked',
      label: strings.makePrivate,
      reason: strings.privateNeedsManager,
    })
    expect(model.visibility!.confirmation.body).toBe(
      strings.makePrivateBody({ count: 3, channel: '#billing' }),
    )
  })
})

describe('leaveConsequence', () => {
  it('warns that a private channel cannot be joined again alone', () => {
    expect(leaveConsequence(channel('secret', { visibility: 'private' }))).toBe(
      strings.leavePrivateChannelBody({ channel: '#secret' }),
    )
  })
})
