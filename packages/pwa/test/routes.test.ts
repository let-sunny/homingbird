import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type AdminSection,
  type AgentSection,
  type DebateTab,
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
  segment.map((person): Route => ({ name: 'people', person })),
  fc
    .array(fc.stringMatching(/^mem_[a-z0-9]{1,12}$/), { maxLength: 4 })
    .map((to): Route => ({ name: 'new', to })),
  fc.constant<Route>({ name: 'channels' }),
  segment.map((slug): Route => ({ name: 'channel', slug })),
  segment.map((slug): Route => ({ name: 'channel-agent', slug, draft: null })),
  fc.tuple(segment, segment).map(([slug, draft]): Route => ({ name: 'channel-agent', slug, draft })),
  segment.map((slug): Route => ({ name: 'channel-agent', slug, draft: null, teach: true })),
  segment.map((id): Route => ({ name: 'group', id })),
  fc.constant<Route>({ name: 'profile' }),
  fc.constant<Route>({ name: 'measured' }),
  fc.constant<Route>({ name: 'activity' }),
  fc.constant<Route>({ name: 'debates' }),
  fc
    .tuple(segment, fc.constantFrom<DebateTab | null>(null, 'result', 'votes', 'credit', 'turns'))
    .map(([id, tab]): Route => ({ name: 'debate', id, tab })),
  fc
    .tuple(segment, fc.integer({ min: 1, max: 999 }))
    .map(([id, turn]): Route => ({ name: 'debate', id, tab: 'turns', turn })),
  fc
    .constantFrom<AgentSection | null>(null, 'connection', 'teaching', 'doing', 'previews')
    .map((section): Route => ({ name: 'agent', section })),
  fc.constant<Route>({ name: 'character', draft: null, from: null }),
  segment.map((draft): Route => ({ name: 'character', draft, from: null })),
  segment.map((from): Route => ({ name: 'character', draft: null, from })),
  segment.map((id): Route => ({ name: 'conversation', id, draft: null })),
  fc.tuple(segment, segment).map(([id, draft]): Route => ({ name: 'conversation', id, draft })),
  fc
    .tuple(segment, fc.option(segment, { nil: null }), segment)
    .map(([id, draft, review]): Route => ({ name: 'conversation', id, draft, review })),
  fc.tuple(segment, segment).map(([id, note]): Route => ({ name: 'conversation', id, draft: null, note })),
  segment.map((id): Route => ({ name: 'consent', id })),
  fc.option(segment, { nil: null }).map((code): Route => ({ name: 'device', code })),
  fc.string({ maxLength: 40 }).map((query): Route => ({ name: 'search', query })),
  fc
    .constantFrom<AdminSection>('settings', 'members', 'groups', 'channels', 'insights')
    .map((section): Route => ({ name: 'admin', section })),
  segment.map((id): Route => ({ name: 'admin-group', id })),
  fc
    .option(fc.string({ maxLength: 60 }), { nil: null })
    .map((reason): Route => ({ name: 'signed-out', reason })),
  segment.map((code): Route => ({ name: 'invite', code })),
  fc.constant<Route>({ name: 'invite-refused' }),
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
    ['#/c/conv_1?review=note_2', { name: 'conversation', id: 'conv_1', draft: null, review: 'note_2' }],
    ['#/c/conv_1?note=note_3', { name: 'conversation', id: 'conv_1', draft: null, note: 'note_3' }],
    ['#/device', { name: 'device', code: null }],
    ['#/new', { name: 'new', to: [] }],
    ['#/new?to=mem_a,,mem_b', { name: 'new', to: ['mem_a', 'mem_b'] }],
    ['#/invite/hbi_abc', { name: 'invite', code: 'hbi_abc' }],
    ['#/invite', { name: 'unknown' }],
    ['#/invite-refused', { name: 'invite-refused' }],
    ['#/device/BCDF-GHJK', { name: 'device', code: 'BCDF-GHJK' }],
    ['#/admin', { name: 'admin', section: 'settings' }],
    ['#/admin/nonsense', { name: 'admin', section: 'settings' }],
    ['#/activity', { name: 'activity' }],
    ['#/search?q=billing', { name: 'search', query: 'billing' }],
    ['#/search', { name: 'search', query: '' }],
    ['#/channels', { name: 'channels' }],
    ['#/channel/billing', { name: 'channel', slug: 'billing' }],
    ['#/channel/billing/agent', { name: 'channel-agent', slug: 'billing', draft: null }],
    ['#/channel/billing/agent?draft=note_1', { name: 'channel-agent', slug: 'billing', draft: 'note_1' }],
    ['#/channel/billing/agent/teach', { name: 'channel-agent', slug: 'billing', draft: null, teach: true }],
    ['#/channel/billing/other', { name: 'channel', slug: 'billing' }],
    ['#/channel', { name: 'unknown' }],
    ['#/t/billing', { name: 'channel', slug: 'billing' }],
    ['#/t', { name: 'unknown' }],
    ['#/admin/channels', { name: 'admin', section: 'channels' }],
    ['#/admin/groups', { name: 'admin', section: 'groups' }],
    ['#/admin/groups/grp_team00000000', { name: 'admin-group', id: 'grp_team00000000' }],
    ['#/group/grp_team00000000', { name: 'group', id: 'grp_team00000000' }],
    ['#/group', { name: 'unknown' }],
    ['#/admin/insights', { name: 'admin', section: 'insights' }],
    ['#/agent', { name: 'agent', section: null }],
    ['#/agent/routes', { name: 'agent', section: 'doing' }],
    ['#/debate/d1', { name: 'debate', id: 'd1', tab: null }],
    ['#/debate/d1/votes', { name: 'debate', id: 'd1', tab: 'votes' }],
    ['#/debate/d1/nonsense', { name: 'debate', id: 'd1', tab: null }],
    ['#/debate/d1/turns?turn=4', { name: 'debate', id: 'd1', tab: 'turns', turn: 4 }],
    ['#/debate/d1/turns?turn=0', { name: 'debate', id: 'd1', tab: 'turns' }],
    ['#/debate/d1/turns?turn=four', { name: 'debate', id: 'd1', tab: 'turns' }],
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
