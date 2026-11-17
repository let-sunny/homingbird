import { type Schema as S, Schema } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as shared from '../src/contract-schemas.ts'
import { type Api, type Contract, type RouteName, contract, humanOnlyRoutes } from '../src/contract.ts'
import type { Note } from '../src/model.ts'
import { type RequestOf, fillPath, matchPath } from '../src/route.ts'

const names = Object.keys(contract) as RouteName[]
const routes = names.map((name) => [name, contract[name]] as const)
const noteBody = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0)
const refinements = { 'note-body': noteBody }

const parametersOf = (path: string): string[] => [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!)

describe('contract', () => {
  it('has no two routes with the same method that match the same path', () => {
    for (const [name, route] of routes) {
      const concrete = fillPath(route.path, Object.fromEntries(parametersOf(route.path).map((p) => [p, 'x'])))
      const matching = routes.filter(([, other]) => other.method === route.method && matchPath(other.path, concrete))
      expect(matching.map(([other]) => other)).toEqual([name])
    }
  })

  it.each(routes)('%s matches its own filled path', (_, route) => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 3, maxLength: 3 }), (values) => {
        const params = Object.fromEntries(parametersOf(route.path).map((p, index) => [p, values[index]!]))
        expect(matchPath(route.path, fillPath(route.path, params))).toEqual(params)
      }),
      { numRuns: 20 },
    )
  })

  it.each(routes)('%s has a response schema that accepts its own generated values', (_, route) => {
    fc.assert(
      fc.property(arbitrary(route.response as S.Schema<unknown>, refinements), (value) => {
        expect(route.response.decode(JSON.parse(JSON.stringify(value)))._tag).toBe('Ok')
      }),
      { numRuns: 15 },
    )
  })

  it.each(routes.filter(([, route]) => route.body !== undefined))('%s has a body schema that accepts its own generated values', (_, route) => {
    fc.assert(
      fc.property(arbitrary(route.body as S.Schema<unknown>, refinements), (value) => {
        expect((route.body as S.Schema<unknown>).decode(JSON.parse(JSON.stringify(value)))._tag).toBe('Ok')
      }),
      { numRuns: 15 },
    )
  })

  it('only reads with GET and never gives a GET a body', () => {
    for (const [, route] of routes) if (route.method === 'GET') expect(route.body).toBeUndefined()
  })

  it('declares query fields as strings, because that is what a URL carries', () => {
    for (const [, route] of routes)
      if (route.query !== undefined)
        expect(Schema.struct(route.query).decode({}).constructor).toBeDefined()
  })

  it('reserves approval, contacts, blocks, credentials and administration for people', () => {
    expect([...humanOnlyRoutes].sort()).toEqual(
      [
        'me.update',
        'contacts.list',
        'contacts.request',
        'contacts.accept',
        'contacts.remove',
        'blocks.add',
        'blocks.remove',
        'conversations.create',
        'notes.read',
        'drafts.send',
        'drafts.discard',
        'credentials.list',
        'credentials.rename',
        'credentials.revoke',
        'device.get',
        'device.decide',
        'consent.get',
        'consent.decide',
        'admin.settings.get',
        'admin.settings.put',
        'admin.members.list',
        'admin.members.update',
        'admin.audit.list',
      ].sort(),
    )
  })

  it('lets an agent credential reach only reading, drafting and pickup', () => {
    const forAgents = names.filter((name) => contract[name].access === 'member')
    expect(forAgents.sort()).toEqual(
      [
        'me.get',
        'directory.list',
        'conversations.list',
        'conversations.get',
        'conversations.notes',
        'notes.get',
        'notes.pickup',
        'inbox.list',
        'search.notes',
        'drafts.list',
        'drafts.create',
        'drafts.update',
        'events.poll',
      ].sort(),
    )
    expect(names.filter((name) => contract[name].access === 'public')).toEqual(['server.info'])
  })

  it('types the API as one function per route', () => {
    expectTypeOf<keyof Api>().toEqualTypeOf<RouteName>()
    expectTypeOf<Parameters<Api['drafts.send']>[0]>().toEqualTypeOf<{
      readonly params: { readonly id: string }
      readonly body: { readonly body?: string }
    }>()
    expectTypeOf<RequestOf<Contract['me.get']>>().toEqualTypeOf<{}>()
    type Sent = Awaited<ReturnType<Api['drafts.send']>> extends never ? never : Note
    expectTypeOf<Sent>().toEqualTypeOf<Note>()
  })
})

describe('shared contract schemas', () => {
  it('accepts page sizes and cursors made of digits only', () => {
    expect(shared.PageLimit.is('50')).toBe(true)
    expect(shared.PageLimit.is('5000')).toBe(false)
    expect(shared.PageLimit.is('-1')).toBe(false)
    expect(shared.Digits.is('1700000000000')).toBe(true)
    expect(shared.Digits.is('1e3')).toBe(false)
    expect(shared.Empty.decode({ extra: 1 })).toMatchObject({ _tag: 'Ok', value: {} })
  })

  it('needs between one and fifty recipients', () => {
    const id = 'mem_abcdefghijkl'
    expect(shared.Recipients.is([])).toBe(false)
    expect(shared.Recipients.is([id])).toBe(true)
    expect(shared.Recipients.is(Array.from({ length: 51 }, () => id))).toBe(false)
  })

  it.each(['InboxItem', 'DeviceRequest', 'ConsentRequest', 'ServerInfo', 'Me'] as const)('%s accepts its generated values', (name) => {
    const schema = shared[name] as S.Schema<unknown>
    fc.assert(
      fc.property(arbitrary(schema, refinements), (value) => {
        expect(schema.is(JSON.parse(JSON.stringify(value)))).toBe(true)
      }),
      { numRuns: 20 },
    )
  })
})
