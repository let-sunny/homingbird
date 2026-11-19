import { afterEach, describe, expect, it } from 'vitest'
import { locale, useLanguage } from '../../src/strings.ts'
import * as tasks from '../../src/tasks/account.ts'
import { testApp } from '../support/app.ts'
import { ANA, credential, me, member } from '../support/fixtures.ts'

afterEach(() => useLanguage('en'))

const answers = {
  'me.update': () => member(ANA, 'Ana B'),
  'me.character.set': () => member(ANA, 'Ana', { character: { id: 'owl' } as never }),
  'me.character.clear': () => member(ANA, 'Ana'),
  'directory.list': () => ({ entries: [] }),
  'contacts.list': () => ({ contacts: [] }),
  'credentials.list': () => ({ credentials: [credential('cred_one')] }),
  'device.get': () => ({ userCode: 'ABCD', client: 'Desk' }),
  'consent.get': () => ({ id: 'c1' }),
  'consent.decide': () => ({ redirectTo: 'https://desk.example.com' }),
}

describe('account tasks', () => {
  it('updates the profile and the character of the person signed in', async () => {
    const { run, state } = testApp(answers)
    await run(tasks.updateProfile('Ana B', ''))
    expect(state.session.get()).toBe('loading')
    state.session.set(me())
    await run(tasks.updateProfile('Ana B', ''))
    expect((state.session.get() as ReturnType<typeof me>).member.name).toBe('Ana B')
    await run(tasks.useCharacter({ id: 'owl' } as never))
    await run(tasks.useCharacter(null))
    expect((state.session.get() as ReturnType<typeof me>).member.character).toBeNull()
    state.session.set(null)
    await run(tasks.useCharacter(null))
  })

  it('chooses a language, or follows the browser again', async () => {
    const { run, state } = testApp(answers)
    state.session.set(me())
    await run(tasks.chooseLanguage('ko'))
    expect(locale).toBe('ko')
    expect((state.session.get() as ReturnType<typeof me>).locale).toBe('ko')
    await run(tasks.chooseLanguage(null))
    expect(locale).toBe('en')
    expect(state.session.get()).not.toHaveProperty('locale')
    state.session.set(null)
    await run(tasks.chooseLanguage(null))
    expect(state.session.get()).toBeNull()
  })

  it('lists, renames and revokes credentials, and decides on devices and consents', async () => {
    const { run, routes } = testApp(answers)
    expect(await run(tasks.listCredentials)).toEqual({ _tag: 'Ok', value: [credential('cred_one')] })
    await run(tasks.renameCredential('cred_one' as never, 'Laptop'))
    await run(tasks.revokeCredential('cred_one' as never))
    await run(tasks.lookUpDevice('ABCD'))
    await run(tasks.decideDevice('ABCD', true, 'Desk'))
    await run(tasks.lookUpConsent('c1'))
    expect(await run(tasks.decideConsent('c1', true, 'Desk'))).toEqual({
      _tag: 'Ok',
      value: { redirectTo: 'https://desk.example.com' },
    })
    expect(routes()).toEqual([
      'credentials.list',
      'credentials.rename',
      'credentials.revoke',
      'device.get',
      'device.decide',
      'consent.get',
      'consent.decide',
    ])
  })

  it('returns to an agent after a moment, and signs out, saying so when the server cannot be reached', async () => {
    const { run, app, page, clock } = testApp(answers)
    const back = run(tasks.returnAfterAMoment('https://desk.example.com'))
    await clock.advance(1500)
    await back
    expect(page.visited).toEqual(['assign https://desk.example.com'])
    Object.assign(page.page, { fetch: () => Promise.resolve(new Response('')) })
    await run(tasks.signOut)
    expect(page.visited.at(-1)).toBe('assign /')
    Object.assign(page.page, { fetch: () => Promise.reject(new Error('offline')) })
    expect((await run(tasks.signOut))._tag).toBe('Err')
    expect(app.state).toBeTruthy()
  })
})
