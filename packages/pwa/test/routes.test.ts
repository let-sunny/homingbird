import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type AdminSection, type Route, hrefFor, parseRoute, signInHref } from '../src/routes.ts'

const segment = fc.string({ minLength: 1, maxLength: 24 })

const routes: fc.Arbitrary<Route> = fc.oneof(
  fc.constant<Route>({ name: 'home' }),
  fc.constant<Route>({ name: 'people' }),
  fc.constant<Route>({ name: 'topics' }),
  segment.map((slug): Route => ({ name: 'topic', slug })),
  fc.constant<Route>({ name: 'profile' }),
  fc.constant<Route>({ name: 'credentials' }),
  fc.constant<Route>({ name: 'character', draft: null, from: null }),
  segment.map((draft): Route => ({ name: 'character', draft, from: null })),
  segment.map((from): Route => ({ name: 'character', draft: null, from })),
  segment.map((id): Route => ({ name: 'conversation', id })),
  segment.map((id): Route => ({ name: 'consent', id })),
  fc.option(segment, { nil: null }).map((code): Route => ({ name: 'device', code })),
  fc.string({ maxLength: 40 }).map((query): Route => ({ name: 'search', query })),
  fc
    .constantFrom<AdminSection>('settings', 'members', 'topics', 'audit')
    .map((section): Route => ({ name: 'admin', section })),
  fc
    .option(fc.string({ maxLength: 60 }), { nil: null })
    .map((reason): Route => ({ name: 'signed-out', reason })),
)

describe('routes', () => {
  it('parses back every route it writes', () => {
    fc.assert(
      fc.property(routes, (route) => {
        expect(parseRoute(hrefFor(route))).toEqual(route)
      }),
    )
  })

  it.each([
    ['', { name: 'home' }],
    ['#', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/c/conv_1', { name: 'conversation', id: 'conv_1' }],
    ['#/device', { name: 'device', code: null }],
    ['#/device/BCDF-GHJK', { name: 'device', code: 'BCDF-GHJK' }],
    ['#/admin', { name: 'admin', section: 'settings' }],
    ['#/admin/nonsense', { name: 'admin', section: 'settings' }],
    ['#/search?q=billing', { name: 'search', query: 'billing' }],
    ['#/search', { name: 'search', query: '' }],
    ['#/topics', { name: 'topics' }],
    ['#/t/billing', { name: 'topic', slug: 'billing' }],
    ['#/t', { name: 'unknown' }],
    ['#/admin/topics', { name: 'admin', section: 'topics' }],
    ['#/c', { name: 'unknown' }],
    ['#/consent', { name: 'unknown' }],
    ['#/nowhere', { name: 'unknown' }],
    ['#/c/%E0%A4%A', { name: 'conversation', id: '%E0%A4%A' }],
    ['#/character', { name: 'character', draft: null, from: null }],
    ['#/character?from=cat', { name: 'character', draft: null, from: 'cat' }],
    ['#/character/eyJ2ZXJzaW9uIjoxfQ', { name: 'character', draft: 'eyJ2ZXJzaW9uIjoxfQ', from: null }],
  ])('reads %j', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected)
  })

  it('sends an unknown route home', () => {
    expect(hrefFor({ name: 'unknown' })).toBe('#/')
  })

  it('returns to the current page after signing in, except from the signed-out page', () => {
    expect(signInHref('#/c/conv_1')).toBe('/auth/login?return_to=%2F%23%2Fc%2Fconv_1')
    expect(signInHref('#/signed-out?reason=x')).toBe('/auth/login?return_to=%2F')
    expect(signInHref('')).toBe('/auth/login?return_to=%2F')
  })
})
