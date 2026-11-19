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
    const shown = signInView(context, null)
    const link = getByRole(shown, 'link', { name: strings.signInWith({ provider: 'Google' }) })
    expect(link.getAttribute('href')).toBe('/auth/login?return_to=%2F%23%2Fpeople')
    expect(queryByRole(shown, 'alert')).toBeNull()
    expect(getByRole(shown, 'heading', { name: 'homingbird' })).toBeTruthy()
  })

  it('says why the person was signed out', () => {
    const { context } = testContext()
    expect(getByRole(signInView(context, 'Not allowed.'), 'alert').textContent).toBe('Not allowed.')
  })
})
