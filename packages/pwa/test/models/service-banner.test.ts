import { describe, expect, it } from 'vitest'
import { serviceBannerModel } from '../../src/models/service-banner.ts'
import { strings } from '../../src/strings.ts'
import { credential } from '../support/fixtures.ts'

const NOW = 1_000
const ORIGIN = 'https://hb.example.com'

describe('serviceBannerModel', () => {
  it('shows nothing while the credentials load', () => {
    expect(serviceBannerModel({ credentials: null, origin: ORIGIN, now: NOW, joinCodes: false })).toBeNull()
  })

  it('shows nothing once an agent credential can be used', () => {
    const usable = credential('cred_desk', { expiresAt: NOW + 1 })
    expect(
      serviceBannerModel({ credentials: [usable], origin: ORIGIN, now: NOW, joinCodes: false }),
    ).toBeNull()
  })

  it('says the desk has not connected, with the sign-in command for this server and the code page', () => {
    expect(serviceBannerModel({ credentials: [], origin: ORIGIN, now: NOW, joinCodes: false })).toEqual({
      title: strings.serviceBanner.title,
      body: strings.serviceBanner.body,
      command: `homingbird login --server ${ORIGIN}`,
      link: { href: '#/device', label: strings.serviceBanner.enterCode },
    })
  })

  it('points a server to a join code when the server offers them, and a computer with a browser to the command', () => {
    expect(serviceBannerModel({ credentials: [], origin: ORIGIN, now: NOW, joinCodes: true })).toMatchObject({
      body: strings.serviceBanner.bodyWithJoin,
      command: `homingbird login --server ${ORIGIN}`,
    })
  })

  it('counts no browser, revoked or expired credential as a connected desk', () => {
    const credentials = [
      credential('cred_web', { kind: 'human', expiresAt: NOW + 1 }),
      credential('cred_revoked', { expiresAt: NOW + 1, revokedAt: 5 }),
      credential('cred_expired', { expiresAt: NOW }),
    ]
    expect(serviceBannerModel({ credentials, origin: ORIGIN, now: NOW, joinCodes: false })).not.toBeNull()
  })
})
