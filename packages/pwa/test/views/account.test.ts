import { lifetime } from '@homingbird/ui'
import { allByRole, fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../src/strings.ts'
import { profileView } from '../../src/views/account.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()
afterEach(() => vi.unstubAllGlobals())

describe('profileView', () => {
  it('saves the person’s name and about text, and says so', () => {
    const { context, called } = testContext()
    const shown = profileView(context, lifetime(), me({}, { profile: 'About' }))
    fire.type(getByRole(shown, 'textbox', { name: strings.profileName }), ' Ana B ')
    fire.submit(shown.querySelector('form')!)
    const [update] = called('updateProfile')
    expect(update!.args).toEqual(['Ana B', 'About'])
    update!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.saved })
  })

  it('applies and remembers an appearance, chooses a language and shows the tour again', () => {
    const { context, called, page, tour } = testContext()
    page.local.set('homingbird.appearance', 'dark')
    const shown = profileView(context, lifetime(), me())
    expect((getByRole(shown, 'radio', { name: strings.appearanceDark }) as HTMLInputElement).checked).toBe(
      true,
    )
    getByRole(shown, 'radio', { name: strings.appearanceLight }).click()
    expect(document.documentElement.dataset.appearance).toBe('light')
    expect(page.local.get('homingbird.appearance')).toBe('light')
    getByRole(shown, 'radio', { name: '한국어' }).click()
    expect(called('chooseLanguage')[0]!.args).toEqual(['ko'])
    getByRole(shown, 'button', { name: strings.tour.showAgain }).click()
    expect(tour.started).toBe(1)
  })

  it('shows the character section and notifications only where they are on', () => {
    const { context } = testContext()
    expect(
      queryByRole(profileView(context, lifetime(), me()), 'group', { name: strings.character.title }),
    ).not.toBeNull()
    context.state.serverInfo.set(serverInfo({ webPush: true }))
    const shown = profileView(context, lifetime(), me())
    expect(queryByRole(shown, 'group', { name: strings.character.title })).toBeNull()
    expect(textOf(shown)).toContain(strings.notificationsUnavailable)
  })

  it('turns notifications on and off, tests them, and says when the browser refused', () => {
    const { context, called, page } = testContext()
    page.state.push = true
    context.state.serverInfo.set(serverInfo({ webPush: true }))
    const shown = profileView(context, lifetime(), me())
    called('pushIsOn')[0]!.then!.done!(false)
    const box = () =>
      getByRole(shown, 'checkbox', { name: new RegExp(strings.notificationsToggle) }) as HTMLInputElement
    box().click()
    expect(box().checked).toBe(false)
    expect(box().disabled).toBe(true)
    box().click()
    expect(called('turnPushOn')).toHaveLength(1)
    called('turnPushOn')[0]!.then!.done!(false)
    expect(box().disabled).toBe(false)
    expect(context.state.notice.get()).toEqual({ kind: 'error', text: strings.notificationsRefused })
    box().click()
    called('turnPushOn')[1]!.then!.failed!({ _tag: 'Unavailable', message: 'no' })
    box().click()
    called('turnPushOn')[2]!.then!.done!(true)
    getByRole(shown, 'button', { name: strings.sendTestPush }).click()
    called('testPush')[0]!.then!.done!(['Sent.'])
    expect(getByRole(shown, 'status').textContent).toBe('Sent.')
    expect(box().checked).toBe(true)
    expect(box().disabled).toBe(false)
    box().click()
    expect(called('turnPushOff')).toHaveLength(1)
  })
})
