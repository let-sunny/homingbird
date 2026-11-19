import { describe, expect, it } from 'vitest'
import { languageChoicesFor, notificationsModel, profileModel } from '../../src/models/account.ts'
import { strings } from '../../src/strings.ts'
import { me } from '../support/fixtures.ts'

describe('profileModel', () => {
  it('fills the form and checks the appearance in use', () => {
    const model = profileModel({
      me: me({}, { profile: 'About me' }),
      appearance: 'dark',
      charactersOn: true,
      webPushOn: true,
      pushAvailable: true,
    })
    expect(model).toMatchObject({
      email: 'ana@example.com',
      name: 'Ana',
      profile: 'About me',
      showsCharacter: true,
    })
    expect(model.appearances).toEqual([
      { value: 'auto', label: strings.appearanceAuto, checked: false },
      { value: 'light', label: strings.appearanceLight, checked: false },
      { value: 'dark', label: strings.appearanceDark, checked: true },
    ])
    expect(model.notifications).toBe('available')
  })

  it('says notifications are unavailable in this browser, and leaves them out where the server has none', () => {
    const base = { me: me(), appearance: 'auto' as const, charactersOn: false }
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
