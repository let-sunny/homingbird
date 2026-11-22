import { type RouteName, contract, humanOnlyRoutes } from '@homingbird/protocol'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { MEMBER_ROUTES, type MemberApi, type MemberRouteName, memberApiOf } from '../src/member-api.ts'
import { fakeApi } from './support.ts'

describe('memberApiOf', () => {
  it('exposes no route that needs a human or an admin', () => {
    const exposed = Object.keys(memberApiOf(fakeApi().api))
    expect(exposed.filter((name) => humanOnlyRoutes.includes(name as RouteName))).toEqual([])
    expect(exposed.sort()).toEqual([...MEMBER_ROUTES].sort())
  })

  it('exposes every route that is open to any member, except browser push routes', () => {
    const open = (Object.keys(contract) as RouteName[]).filter(
      (name) => !humanOnlyRoutes.includes(name) && !name.startsWith('push.'),
    )
    expect([...MEMBER_ROUTES].sort()).toEqual(open.sort())
    expect(MEMBER_ROUTES).toContain('drafts.create')
    expect(MEMBER_ROUTES).not.toContain('drafts.send')
    expect(MEMBER_ROUTES).not.toContain('drafts.discard')
    expect(MEMBER_ROUTES).not.toContain('credentials.list')
    expect(MEMBER_ROUTES).not.toContain('contacts.request')
    expect(MEMBER_ROUTES).not.toContain('blocks.add')
    expect(MEMBER_ROUTES.filter((name) => name.startsWith('push.'))).toEqual([])
  })

  it('exposes no draft preview route, so no unconfirmed draft of a colleague ever reaches a model', () => {
    for (const name of ['previews.list', 'me.draftPreviews.get', 'me.draftPreviews.set'] as const) {
      expect(MEMBER_ROUTES as ReadonlyArray<string>).not.toContain(name)
      expectTypeOf<typeof name>().not.toMatchTypeOf<MemberRouteName>()
    }
  })

  it('passes calls through to the underlying route', () => {
    const { api, calls } = fakeApi()
    memberApiOf(api)['me.get']({}).run(undefined, new AbortController().signal)
    expect(calls.map((call) => call.name)).toEqual(['me.get'])
  })

  it('has no approval, contact or credential route in its type', () => {
    expectTypeOf<'drafts.send'>().not.toMatchTypeOf<MemberRouteName>()
    expectTypeOf<'drafts.discard'>().not.toMatchTypeOf<MemberRouteName>()
    expectTypeOf<'contacts.request'>().not.toMatchTypeOf<MemberRouteName>()
    expectTypeOf<'credentials.list'>().not.toMatchTypeOf<MemberRouteName>()
    expectTypeOf<'drafts.create'>().toMatchTypeOf<MemberRouteName>()
    expectTypeOf<MemberApi>().not.toHaveProperty('drafts.send')
  })
})
