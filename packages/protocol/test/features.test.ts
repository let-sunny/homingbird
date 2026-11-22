import { describe, expect, it } from 'vitest'
import { contract } from '../src/contract.ts'
import {
  FEATURES,
  FEATURE_NAMES,
  featureOfRoute,
  featureSwitches,
  featureSwitchesFrom,
  isFeatureOn,
} from '../src/features.ts'

describe('feature switches', () => {
  it('fills in every default and drops names it does not know', () => {
    expect(featureSwitches({ teaching: false, nonsense: false })).toEqual({
      ...Object.fromEntries(FEATURE_NAMES.map((name) => [name, FEATURES[name].default])),
      teaching: false,
    })
    expect(isFeatureOn(undefined, 'insights')).toBe(true)
  })

  it('gives each switchable route one feature, and the core none', () => {
    expect(featureOfRoute('principles.create')).toBe('teaching')
    expect(featureOfRoute('push.subscribe')).toBe('webPush')
    expect(featureOfRoute('groups.members.set')).toBe('groups')
    expect(featureOfRoute('admin.groups.create')).toBe('groups')
    expect(featureOfRoute('channels.managers.addTeam')).toBe('groups')
    for (const core of [
      'drafts.send',
      'drafts.create',
      'notes.read',
      'me.get',
      'admin.settings.put',
      'channels.members.add',
      'directory.list',
    ] as const)
      expect(featureOfRoute(core)).toBeNull()
    for (const name of FEATURE_NAMES)
      for (const route of FEATURES[name].routes) expect(Object.keys(contract)).toContain(route)
  })

  it('reads the seed from the environment and names what it cannot read', () => {
    expect(featureSwitchesFrom('teaching=off, characters=on,,')).toEqual({
      switches: { teaching: false, characters: true },
      unknown: [],
    })
    expect(featureSwitchesFrom('principles=off,teaching=maybe').unknown).toEqual([
      'principles=off',
      'teaching=maybe',
    ])
  })

  it('reads names and values with spaces around them, and refuses anything but exactly on or off', () => {
    expect(featureSwitchesFrom('  teaching  =  off  ,insights=on').switches).toEqual({
      teaching: false,
      insights: true,
    })
    expect(featureSwitchesFrom('teaching=offx,teaching=xon,teaching,=on,teaching=').unknown).toEqual([
      'teaching=offx',
      'teaching=xon',
      'teaching',
      '=on',
      'teaching=',
    ])
    expect(featureSwitchesFrom('').switches).toEqual({})
  })

  it('accepts and ignores a retired switch for one release, but still refuses a value it cannot read', () => {
    expect(featureSwitchesFrom('routeMap=off,teaching=off')).toEqual({
      switches: { teaching: false },
      unknown: [],
    })
    expect(featureSwitchesFrom('routeMap=on').switches).toEqual({})
    expect(featureSwitchesFrom('routeMap=maybe').unknown).toEqual(['routeMap=maybe'])
    expect(FEATURE_NAMES).not.toContain('routeMap')
  })
})
