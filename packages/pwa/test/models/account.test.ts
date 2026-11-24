import { describe, expect, it } from 'vitest'
import {
  languageChoicesFor,
  myGroupsModel,
  notificationLevelModel,
  notificationsModel,
  profileModel,
} from '../../src/models/account.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, OPS, TEAM, group, managersOf, me } from '../support/fixtures.ts'
import { CHECKING } from '../support/resource-load.ts'

describe('profileModel', () => {
  it('fills the form and checks the appearance in use', () => {
    const model = profileModel({
      me: me({}, { profile: 'About me' }),
      appearance: 'dark',
      charactersOn: true,
      groupsOn: true,
      schedulingOn: true,
      webPushOn: true,
      pushAvailable: true,
    })
    expect(model).toMatchObject({
      showsScheduling: true,
      email: 'ana@example.com',
      name: 'Ana',
      profile: 'About me',
      showsCharacter: true,
      showsGroups: true,
    })
    expect(model.appearances).toEqual([
      { value: 'auto', label: strings.appearanceAuto, checked: false },
      { value: 'light', label: strings.appearanceLight, checked: false },
      { value: 'dark', label: strings.appearanceDark, checked: true },
    ])
    expect(model.notifications).toBe('available')
  })

  it('says notifications are unavailable in this browser, and leaves them out where the server has none', () => {
    const base = {
      me: me(),
      appearance: 'auto' as const,
      charactersOn: false,
      groupsOn: false,
      schedulingOn: false,
    }
    expect(profileModel({ ...base, webPushOn: true, pushAvailable: false }).notifications).toBe('unavailable')
    expect(profileModel({ ...base, webPushOn: false, pushAvailable: true }).notifications).toBeNull()
  })
})

describe('languageChoicesFor', () => {
  it('checks the language chosen, or following the browser when none is', () => {
    expect(
      languageChoicesFor(me())
        .filter((choice) => choice.checked)
        .map((choice) => choice.value),
    ).toEqual([null])
    expect(languageChoicesFor(me({ locale: 'ko' })).find((choice) => choice.checked)?.lang).toBe('ko')
  })
})

describe('notificationsModel', () => {
  it('offers a test only while notifications are on, and holds the switch while the browser asks', () => {
    expect(notificationsModel({ isOn: true, isBusy: false, tested: ['sent'] })).toEqual({
      checked: true,
      disabled: false,
      mayTest: true,
      results: ['sent'],
    })
    expect(notificationsModel({ isOn: false, isBusy: true, tested: [] })).toMatchObject({
      disabled: true,
      mayTest: false,
    })
  })
})

describe('notificationLevelModel', () => {
  it('offers every level with the chosen one checked, and explains direct messages only', () => {
    const model = notificationLevelModel({
      me: me({ notifications: 'direct' }),
      muteOn: true,
      webPushOn: true,
    })
    expect(model).toEqual({
      legend: strings.mute.levelLegend,
      hint: strings.mute.levelHint,
      options: [
        { value: 'all', label: strings.mute.all, hint: null, checked: false },
        { value: 'direct', label: strings.mute.direct, hint: strings.mute.directHint, checked: true },
        { value: 'none', label: strings.mute.none, hint: null, checked: false },
      ],
    })
  })

  it('checks nothing for a level this client does not know', () => {
    const model = notificationLevelModel({
      me: me({ notifications: 'unknown' }),
      muteOn: true,
      webPushOn: true,
    })
    expect(model!.options.filter((option) => option.checked)).toEqual([])
  })

  it('offers nothing while muting or device notifications are off', () => {
    expect(notificationLevelModel({ me: me(), muteOn: false, webPushOn: true })).toBeNull()
    expect(notificationLevelModel({ me: me(), muteOn: true, webPushOn: false })).toBeNull()
  })
})

describe('myGroupsModel', () => {
  it('lists the person’s teams and the channels they manage, waits for them, and shows nothing while groups are off', () => {
    const groups = [
      group(TEAM, { name: 'Finance', memberIds: [ANA, BEN] }),
      group(OPS, { name: 'Ops', memberIds: [BEN] }),
      managersOf('payroll', { memberIds: [ANA] }),
      managersOf('billing', { memberIds: [ANA, BEN] }),
      managersOf('lobby', { memberIds: [BEN] }),
    ]
    expect(myGroupsModel(me(), groups, null, true)).toEqual({
      kind: 'groups',
      title: strings.groups.yours,
      empty: null,
      groups: [{ label: 'Finance', href: '#/group/grp_team00000000' }],
      manages: strings.groups.manages({ channels: '#billing and #payroll' }),
      channels: ['billing', 'payroll'],
    })
    expect(myGroupsModel(me(), [], null, true)).toEqual({
      kind: 'groups',
      title: strings.groups.yours,
      empty: strings.groups.yoursNone,
      groups: [],
      manages: strings.groups.managesNone,
      channels: [],
    })
    expect(myGroupsModel(me(), [], CHECKING, true)).toEqual({
      kind: 'waiting',
      title: strings.groups.yours,
      wait: CHECKING,
    })
    expect(myGroupsModel(me(), groups, null, false)).toBeNull()
    expect(myGroupsModel(me(), groups, CHECKING, false)).toBeNull()
  })
})
