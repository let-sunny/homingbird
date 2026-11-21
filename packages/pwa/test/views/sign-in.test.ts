import { getByRole, queryByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { signInView } from '../../src/views/sign-in.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { serverInfo } from '../support/fixtures.ts'

usingFakeDom()

describe('signInView', () => {
  it('signs the person in with the server’s provider, back where they were', () => {
    const { context } = testContext('#/people')
    context.state.serverInfo.set(serverInfo())
    const shown = signInView(context, null, null)
    const link = getByRole(shown, 'link', { name: strings.signInWith({ provider: 'Google' }) })
    expect(link.getAttribute('href')).toBe('/auth/login?return_to=%2F%23%2Fpeople')
    expect(queryByRole(shown, 'alert')).toBeNull()
    expect(getByRole(shown, 'heading', { name: 'homingbird' })).toBeTruthy()
  })

  it('says why the person was signed out', () => {
    const { context } = testContext()
    expect(getByRole(signInView(context, 'Not allowed.', null), 'alert').textContent).toBe('Not allowed.')
  })

  it('accepts an invite with a form that posts its code to the server', () => {
    const { context } = testContext('#/invite/hbi_secret')
    context.state.serverInfo.set(serverInfo())
    const shown = signInView(context, null, 'hbi_secret')
    const form = shown.querySelector('form')!
    expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual(['post', '/auth/invite'])
    const code = form.querySelector('input[name="code"]') as HTMLInputElement
    expect([code.getAttribute('type'), code.value]).toEqual(['hidden', 'hbi_secret'])
    expect(getByRole(shown, 'button', { name: strings.signInWith({ provider: 'Google' }) })).toBeTruthy()
    expect(shown.textContent).toContain(strings.invites.invitedBody({ name: 'homingbird' }))
  })
})
