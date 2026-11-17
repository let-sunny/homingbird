import { Schema as S } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  API_PREFIX,
  type PathParams,
  type RequestOf,
  type ResponseOf,
  fillPath,
  matchPath,
  route,
} from '../src/route.ts'

const segment = fc.string({ minLength: 1, maxLength: 12 })

describe('route', () => {
  it('keeps what it is given and defaults query and body to undefined', () => {
    const plain = route({ method: 'GET', path: '/things', access: 'member', response: S.boolean })
    expect(plain).toEqual({
      method: 'GET',
      path: '/things',
      access: 'member',
      query: undefined,
      body: undefined,
      response: S.boolean,
    })
    const full = route({
      method: 'POST',
      path: '/things/:id',
      access: 'human',
      query: { q: S.string() },
      body: S.struct({ n: S.int() }),
      response: S.boolean,
    })
    expect(full.query).toBeDefined()
    expect(full.body).toBeDefined()
  })

  it('derives request and response types from the declaration', () => {
    const declared = route({
      method: 'POST',
      path: '/a/:one/b/:two',
      access: 'human',
      query: { q: S.optional(S.string()) },
      body: S.struct({ n: S.int() }),
      response: S.struct({ ok: S.boolean }),
    })
    expectTypeOf<PathParams<'/a/:one/b/:two'>>().toMatchTypeOf<{
      readonly one: string
      readonly two: string
    }>()
    expectTypeOf<PathParams<'/plain'>>().toEqualTypeOf<{}>()
    expectTypeOf<RequestOf<typeof declared>>().toEqualTypeOf<{
      readonly params: { readonly one: string; readonly two: string }
      readonly query: { readonly q?: string }
      readonly body: { readonly n: number }
    }>()
    expectTypeOf<ResponseOf<typeof declared>>().toEqualTypeOf<{ readonly ok: boolean }>()
    const bare = route({ method: 'GET', path: '/x', access: 'public', response: S.boolean })
    expectTypeOf<RequestOf<typeof bare>>().toEqualTypeOf<{}>()
    expectTypeOf(declared.access).toEqualTypeOf<'human'>()
  })

  it('prefixes the API', () => {
    expect(API_PREFIX).toBe('/api/v1')
  })
})

describe('fillPath and matchPath', () => {
  it('fills and URL-encodes parameters', () => {
    expect(fillPath('/notes/:id/read', { id: 'a/b c' })).toBe('/notes/a%2Fb%20c/read')
    expect(fillPath('/plain', {})).toBe('/plain')
  })

  it('refuses a missing parameter', () => {
    expect(() => fillPath('/notes/:id', {})).toThrow(/missing path parameter "id"/)
  })

  it('matches a filled path back to the same parameters, whatever they contain', () => {
    fc.assert(
      fc.property(segment, segment, (one, two) => {
        const template = '/a/:one/b/:two'
        expect(matchPath(template, fillPath(template, { one, two }))).toEqual({ one, two })
      }),
    )
  })

  it.each([
    ['/notes/:id', '/notes', null],
    ['/notes/:id', '/notes/', null],
    ['/notes/:id', '/notes/1/extra', null],
    ['/notes/:id', '/drafts/1', null],
    ['/notes/:id', '/notes/%E0%A4%A', null],
    ['/notes', '/notes', {}],
    ['/notes/:id/read', '/notes/n1/read', { id: 'n1' }],
  ])('matches %s against %s as %j', (template, path, expected) => {
    expect(matchPath(template, path)).toEqual(expected)
  })

  it('never lets an encoded slash cross a segment', () => {
    expect(matchPath('/notes/:id', '/notes/a%2Fb')).toEqual({ id: 'a/b' })
  })
})
