import { describe, expect, it } from 'vitest'
import { signInModel } from '../../src/models/sign-in.ts'
import { strings } from '../../src/strings.ts'

describe('signInModel', () => {
  it('welcomes a person and signs them in with the server’s provider, back to where they were', () => {
    const model = signInModel({
      refusal: null,
      brandingName: 'Homingbird',
      signInWith: 'Google',
      hash: '#/people',
    })
    expect(model).toEqual({
      title: strings.welcome,
      pip: 'sign-in',
      wordmark: 'homingbird',
      tagline: strings.tagline,
      refusal: null,
      signIn: {
        href: '/auth/login?return_to=%2F%23%2Fpeople',
        label: strings.signInWith({ provider: 'Google' }),
      },
    })
  })

  it('says why a person was signed out, and waits for the provider’s name', () => {
    const model = signInModel({
      refusal: 'Your domain is not allowed.',
      brandingName: 'Acme',
      signInWith: null,
      hash: '',
    })
    expect(model.title).toBe(strings.signedOutTitle)
    expect(model.pip).toBe('failed')
    expect(model.refusal).toBe('Your domain is not allowed.')
    expect(model.signIn.label).toBe(strings.signInWith({ provider: '…' }))
    expect(model.wordmark).toBe('Acme')
  })
})
