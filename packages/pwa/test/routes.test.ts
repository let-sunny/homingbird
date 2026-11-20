import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type AdminSection,
  type AgentSection,
  type Route,
  currentHashFor,
  hrefFor,
  parseRoute,
  signInHref,
} from '../src/routes.ts'

const segment = fc.string({ minLength: 1, maxLength: 24 })

const routes: fc.Arbitrary<Route> = fc.oneof(
  fc.constant<Route>({ name: 'home' }),
  fc.constant<Route>({ name: 'people' }),
  fc.constant<Route>({ name: 'channels' }),
  segment.map((slug): Route => ({ name: 'channel', slug })),
  segment.map((slug): Route => ({ name: 'channel-agent', slug, draft: null })),
  fc.tuple(segment, segment).map(([slug, draft]): Route => ({ name: 'channel-agent', slug, draft })),
  segment.map((id): Route => ({ name: 'group', id })),
  fc.constant<Route>({ name: 'profile' }),
  fc.constant<Route>({ name: 'measured' }),
  fc
    .constantFrom<AgentSection | null>(null, 'connection', 'teaching', 'doing', 'routes')
    .map((section): Route => ({ name: 'agent', section })),
  fc.constant<Route>({ name: 'character', draft: null, from: null }),
  segment.map((draft): Route => ({ name: 'character', draft, from: null })),
  segment.map((from): Route => ({ name: 'character', draft: null, from })),
  segment.map((id): Route => ({ name: 'conversation', id, draft: null })),
  fc.tuple(segment, segment).map(([id, draft]): Route => ({ name: 'conversation', id, draft })),
  segment.map((id): Route => ({ name: 'consent', id })),
  fc.option(segment, { nil: null }).map((code): Route => ({ name: 'device', code })),
  fc.string({ maxLength: 40 }).map((query): Route => ({ name: 'search', query })),
  fc
    .constantFrom<AdminSection>('settings', 'members', 'groups', 'channels', 'insights')
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
    ['#/c/conv_1', { name: 'conversation', id: 'conv_1', draft: null }],
    ['#/c/conv_1?draft=note_1', { name: 'conversation', id: 'conv_1', draft: 'note_1' }],
    ['#/device', { name: 'device', code: null }],
    ['#/device/BCDF-GHJK', { name: 'device', code: 'BCDF-GHJK' }],
    ['#/admin', { name: 'admin', section: 'settings' }],
    ['#/admin/nonsense', { name: 'admin', section: 'settings' }],
    ['#/search?q=billing', { name: 'search', query: 'billing' }],
    ['#/search', { name: 'search', query: '' }],
    ['#/channels', { name: 'channels' }],
    ['#/channel/billing', { name: 'channel', slug: 'billing' }],
    ['#/channel/billing/agent', { name: 'channel-agent', slug: 'billing', draft: null }],
    ['#/channel/billing/agent?draft=note_1', { name: 'channel-agent', slug: 'billing', draft: 'note_1' }],
    ['#/channel/billing/other', { name: 'channel', slug: 'billing' }],
    ['#/channel', { name: 'unknown' }],
    ['#/t/billing', { name: 'channel', slug: 'billing' }],
    ['#/t', { name: 'unknown' }],
    ['#/admin/channels', { name: 'admin', section: 'channels' }],
    ['#/admin/groups', { name: 'admin', section: 'groups' }],
    ['#/group/grp_team00000000', { name: 'group', id: 'grp_team00000000' }],
    ['#/group', { name: 'unknown' }],
    ['#/admin/insights', { name: 'admin', section: 'insights' }],
    ['#/agent', { name: 'agent', section: null }],
    ['#/measured', { name: 'measured' }],
    ['#/agent/teaching', { name: 'agent', section: 'teaching' }],
    ['#/agent/nonsense', { name: 'agent', section: null }],
    ['#/connect', { name: 'agent', section: 'connection' }],
    ['#/credentials', { name: 'agent', section: 'connection' }],
    ['#/c', { name: 'unknown' }],
    ['#/consent', { name: 'unknown' }],
    ['#/nowhere', { name: 'unknown' }],
    ['#/c/%E0%A4%A', { name: 'conversation', id: '%E0%A4%A', draft: null }],
    ['#/character', { name: 'character', draft: null, from: null }],
    ['#/character?from=cat', { name: 'character', draft: null, from: 'cat' }],
    ['#/character/eyJ2ZXJzaW9uIjoxfQ', { name: 'character', draft: 'eyJ2ZXJzaW9uIjoxfQ', from: null }],
  ])('reads %j', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected)
  })

  it('replaces an old channel address with the current one and leaves current addresses alone', () => {
    expect(currentHashFor('#/t/billing')).toBe('#/channel/billing')
    expect(currentHashFor('#/t/caf%C3%A9')).toBe('#/channel/caf%C3%A9')
    expect(hrefFor({ name: 'channel', slug: 'billing' })).toBe('#/channel/billing')
    expect(currentHashFor('#/connect')).toBe('#/agent/connection')
    expect(currentHashFor('#/credentials')).toBe('#/agent/connection')
    expect(currentHashFor('#/connector')).toBeNull()
    for (const hash of ['#/channel/billing', '#/t', '#/c/conv_1', '#/', ''])
      expect(currentHashFor(hash)).toBeNull()
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
