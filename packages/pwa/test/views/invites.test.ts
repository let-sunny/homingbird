import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { invitesSection } from '../../src/views/invites.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA } from '../support/fixtures.ts'

usingFakeDom()

const URL_MADE = 'https://hb.example.com/#/invite/hbi_secret'

const waiting = (now: number) => ({
  id: 'inv_1',
  email: 'friend@gmail.com',
  createdBy: ANA,
  createdAt: now,
  expiresAt: now + 7 * 86_400_000,
})

describe('invitesSection', () => {
  it('makes an invite link for the address typed, shows it to copy, and lists it to revoke', async () => {
    const { context, called, clock, page } = testContext()
    const shown = mount(invitesSection(context, lifetime()))
    expect(textOf(shown)).toContain(strings.invites.title)
    called('listInvites')[0]!.then!.done!([])
    expect(textOf(shown)).toContain(strings.invites.none)

    const email = shown.querySelector('input[name="email"]') as HTMLInputElement
    email.value = ' Friend@Gmail.com '
    getByRole(shown, 'button', { name: strings.invites.create }).click()
    expect(called('createInvite')[0]!.args).toEqual(['friend@gmail.com'])
    expect(getByRole(shown, 'button', { name: strings.invites.creating }).hasAttribute('disabled')).toBe(true)
    called('createInvite')[0]!.then!.done!({ invite: waiting(clock.now()), url: URL_MADE })
    expect(shown.querySelector('pre')!.textContent).toBe(URL_MADE)
    expect(textOf(shown)).toContain(strings.invites.madeFor({ email: 'friend@gmail.com' }))
    expect(email.value).toBe('')

    getByRole(shown, 'button', { name: strings.invites.copy }).click()
    await Promise.resolve()
    expect(page.copied).toEqual([URL_MADE])
    expect(getByRole(shown, 'button', { name: strings.invites.copied })).toBeTruthy()

    called('listInvites')[1]!.then!.done!([waiting(clock.now())])
    expect(textOf(shown)).toContain('friend@gmail.com')
    getByRole(shown, 'button', { name: strings.invites.revoke }).click()
    expect(called('revokeInvite')[0]!.args).toEqual(['inv_1'])
    called('revokeInvite')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.invites.revoked })
    expect(called('listInvites')).toHaveLength(3)
  })

  it('makes a link anyone may use when no address is typed, and says when none came or copying failed', async () => {
    const { context, called, page } = testContext()
    page.state.clipboard = false
    const shown = mount(invitesSection(context, lifetime()))
    getByRole(shown, 'button', { name: strings.invites.create }).click()
    expect(called('createInvite')[0]!.args).toEqual([null])
    called('createInvite')[0]!.then!.failed!({ _tag: 'Forbidden', message: 'no' } as never)
    expect(textOf(shown)).toContain(strings.invites.failed)
    getByRole(shown, 'button', { name: strings.invites.create }).click()
    called('createInvite')[1]!.then!.done!({ invite: { ...waiting(0), email: null }, url: URL_MADE })
    expect(textOf(shown)).toContain(strings.invites.made)
    getByRole(shown, 'button', { name: strings.invites.copy }).click()
    await Promise.resolve()
    expect(textOf(shown)).toContain(strings.invites.copyFailed)
  })
})
