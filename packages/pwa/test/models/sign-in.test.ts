import { describe, expect, it } from 'vitest'
import { signInModel } from '../../src/models/sign-in.ts'
import { strings } from '../../src/strings.ts'

describe('signInModel', () => {
  it('welcomes a person and signs them in with the server’s provider, back to where they were', () => {
    const model = signInModel({
      refusal: null,
      invite: null,
      brandingName: 'Homingbird',
      signInWith: 'Google',
      hash: '#/people',
      origin: 'https://hb.example.com',
    })
    expect(model).toEqual({
      title: strings.welcome,
      pip: 'sign-in',
      wordmark: 'homingbird',
      tagline: strings.tagline,
      refusal: null,
      signIn: {
        kind: 'link',
        href: '/auth/login?return_to=%2F%23%2Fpeople',
        label: strings.signInWith({ provider: 'Google' }),
      },
    })
  })

  it('says why a person was signed out, and waits for the provider’s name', () => {
    const model = signInModel({
      refusal: 'Your domain is not allowed.',
      invite: null,
      brandingName: 'Acme',
      signInWith: null,
      hash: '',
      origin: 'https://hb.example.com',
    })
    expect(model.title).toBe(strings.signedOutTitle)
    expect(model.pip).toBe('failed')
    expect(model.refusal).toBe('Your domain is not allowed.')
    expect(model.signIn.label).toBe(strings.signInWith({ provider: '…' }))
    expect(model.wordmark).toBe('Acme')
  })

  it('invites a person to sign in by posting the link’s code, never by putting it in an address', () => {
    const model = signInModel({
      refusal: null,
      invite: 'hbi_secret',
      brandingName: 'Acme',
      signInWith: 'Google',
      hash: '#/invite/hbi_secret',
      origin: 'https://hb.example.com',
    })
    expect(model).toMatchObject({
      title: strings.invites.invitedTitle,
      pip: 'sign-in',
      tagline: strings.invites.invitedBody({ name: 'Acme', address: 'hb.example.com' }),
      refusal: null,
      signIn: {
        kind: 'invite',
        action: '/auth/invite',
        code: 'hbi_secret',
        label: strings.signInWith({ provider: 'Google' }),
      },
    })
  })

  it('says why an invite was refused instead of inviting again', () => {
    const model = signInModel({
      refusal: strings.invites.refused,
      invite: 'hbi_secret',
      brandingName: 'Acme',
      signInWith: 'Google',
      hash: '',
      origin: 'https://hb.example.com',
    })
    expect(model.title).toBe(strings.signedOutTitle)
    expect(model.signIn.kind).toBe('link')
  })

  it('names the server by its address when the organization gave it no name', () => {
    const model = signInModel({
      refusal: null,
      invite: 'hbi_secret',
      brandingName: 'Homingbird',
      signInWith: 'Google',
      hash: '#/invite/hbi_secret',
      origin: 'http://localhost:8080',
    })
    expect(model.tagline).toBe(strings.invites.invitedBodyAt({ address: 'localhost:8080' }))
  })
})
