import { describe, expect, it } from 'vitest'
import {
  channelList,
  channelsManagedBy,
  groupById,
  groupLabel,
  groupsOf,
  managesText,
  teamsByLabel,
  teamsOf,
} from '../src/groups.ts'
import { strings } from '../src/strings.ts'
import { ANA, BEN, OPS, TEAM, group, managersOf } from './support/fixtures.ts'

describe('groupLabel', () => {
  it('uses the name a team was given', () => {
    expect(groupLabel(group(TEAM, { name: 'Finance' }))).toBe('Finance')
  })

  it('calls a channel’s group after its channel', () => {
    expect(groupLabel(managersOf('billing'))).toBe(strings.groups.managersOf({ channel: '#billing' }))
  })

  it('calls a group it cannot name unnamed, so no private slug ever shows', () => {
    expect(groupLabel(group(TEAM))).toBe(strings.groups.unnamed)
    expect(groupLabel(managersOf('billing', { channels: [] }))).toBe(strings.groups.unnamed)
    expect(groupLabel(group(TEAM, { kind: 'unknown', name: 'Circle', channels: ['billing'] }))).toBe(
      strings.groups.unnamed,
    )
  })
})

describe('finding groups', () => {
  const groups = [
    group(TEAM, { name: 'Zeta', memberIds: [ANA, BEN] }),
    group(OPS, { name: 'Alpha', memberIds: [BEN] }),
    managersOf('payroll', { memberIds: [BEN] }),
    managersOf('billing', { memberIds: [BEN, ANA] }),
    group('grp_odd000000000' as never, { kind: 'unknown', memberIds: [BEN] }),
  ]

  it('finds a group by id, or none', () => {
    expect(groupById(groups, OPS)?.name).toBe('Alpha')
    expect(groupById(groups, 'grp_gone00000000')).toBeNull()
    expect(groupById(groups, null)).toBeNull()
  })

  it('lists teams only, by name, for everyone and for a member', () => {
    expect(teamsByLabel(groups).map((one) => one.name)).toEqual(['Alpha', 'Zeta'])
    expect(teamsOf(groups, ANA).map((one) => one.name)).toEqual(['Zeta'])
    expect(teamsOf(groups, null)).toEqual([])
  })

  it('lists every group a member is in, channels’ managers too, and the channels they manage', () => {
    expect(groupsOf(groups, BEN).map(groupLabel)).toEqual([
      'Alpha',
      strings.groups.managersOf({ channel: '#billing' }),
      strings.groups.managersOf({ channel: '#payroll' }),
      strings.groups.unnamed,
      'Zeta',
    ])
    expect(groupsOf(groups, null)).toEqual([])
    expect(channelsManagedBy(groups, BEN)).toEqual(['billing', 'payroll'])
    expect(channelsManagedBy(groups, ANA)).toEqual(['billing'])
  })
})

describe('managesText', () => {
  it('says which channels someone manages as one list, or that they manage none', () => {
    expect(managesText(['billing', 'payroll'])).toBe(
      strings.groups.manages({ channels: '#billing and #payroll' }),
    )
    expect(managesText([])).toBe(strings.groups.managesNone)
    expect(channelList(['a', 'b', 'c'])).toBe('#a, #b, and #c')
  })
})
