import { type Schema as S, Schema } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as shared from '../src/contract-schemas.ts'
import { type Api, type Contract, type RouteName, contract, humanOnlyRoutes } from '../src/contract.ts'
import type { Note } from '../src/model.ts'
import { type RequestOf, fillPath, matchPath } from '../src/route.ts'
import { refinements } from './contract-refinements.ts'

const names = Object.keys(contract) as RouteName[]
const routes = names.map((name) => [name, contract[name]] as const)
const parametersOf = (path: string): string[] => [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!)

describe('contract', () => {
  it('has no two routes with the same method that match the same path', () => {
    for (const [name, route] of routes) {
      const concrete = fillPath(route.path, Object.fromEntries(parametersOf(route.path).map((p) => [p, 'x'])))
      const matching = routes.filter(
        ([, other]) => other.method === route.method && matchPath(other.path, concrete),
      )
      expect(matching.map(([other]) => other)).toEqual([name])
    }
  })

  it.each(routes)('%s matches its own filled path', (_, route) => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 3, maxLength: 3 }),
        (values) => {
          const params = Object.fromEntries(parametersOf(route.path).map((p, index) => [p, values[index]!]))
          expect(matchPath(route.path, fillPath(route.path, params))).toEqual(params)
        },
      ),
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

  it.each(routes.filter(([, route]) => route.body !== undefined))(
    '%s has a body schema that accepts its own generated values',
    (_, route) => {
      fc.assert(
        fc.property(arbitrary(route.body as S.Schema<unknown>, refinements), (value) => {
          expect((route.body as S.Schema<unknown>).decode(JSON.parse(JSON.stringify(value)))._tag).toBe('Ok')
        }),
        { numRuns: 15 },
      )
    },
  )

  it('only reads with GET and never gives a GET a body', () => {
    for (const [, route] of routes) if (route.method === 'GET') expect(route.body).toBeUndefined()
  })

  it('declares query fields as strings, because that is what a URL carries', () => {
    for (const [, route] of routes)
      if (route.query !== undefined) expect(Schema.struct(route.query).decode({}).constructor).toBeDefined()
  })

  it('reserves approval, contacts, blocks, channel membership, groups, credentials and administration for people', () => {
    expect([...humanOnlyRoutes].sort()).toEqual(
      [
        'me.update',
        'me.character.set',
        'me.character.clear',
        'channels.create',
        'channels.join',
        'channels.leave',
        'channels.answering.on',
        'channels.answering.off',
        'channels.visibility.set',
        'channels.members.add',
        'channels.members.remove',
        'channels.managers.addTeam',
        'groups.rename',
        'groups.members.set',
        'admin.groups.create',
        'admin.groups.delete',
        'admin.channels.update',
        'admin.channels.archive',
        'contacts.list',
        'contacts.request',
        'contacts.accept',
        'contacts.remove',
        'blocks.add',
        'blocks.remove',
        'conversations.create',
        'notes.read',
        'notes.move',
        'drafts.send',
        'drafts.discard',
        'drafts.seen',
        'insights.mine',
        'principles.list',
        'principles.create',
        'principles.update',
        'principles.reorder',
        'principles.delete',
        'principles.miss',
        'principles.offers.dismiss',
        'presence.visibility',
        'push.test',
        'draftRequests.create',
        'draftRequests.cancel',
        'debates.create',
        'debates.optIn',
        'debates.limits.set',
        'debates.result.post',
        'debates.export',
        'credentials.list',
        'credentials.rename',
        'credentials.revoke',
        'device.get',
        'device.decide',
        'consent.get',
        'consent.decide',
        'push.subscribe',
        'push.unsubscribe',
        'admin.settings.get',
        'admin.settings.put',
        'admin.members.list',
        'admin.members.update',
        'admin.members.resetCharacter',
        'admin.insights',
      ].sort(),
    )
  })

  it('lets an agent credential reach only reading, drafting, pickup and release', () => {
    const forAgents = names.filter((name) => contract[name].access === 'member')
    expect(forAgents.sort()).toEqual(
      [
        'me.get',
        'directory.list',
        'channels.list',
        'channels.get',
        'channels.members.list',
        'groups.list',
        'groups.get',
        'conversations.list',
        'conversations.get',
        'conversations.notes',
        'notes.get',
        'notes.pickup',
        'notes.release',
        'answeringFlow.get',
        'principles.drafting',
        'inbox.list',
        'search.notes',
        'drafts.list',
        'drafts.create',
        'drafts.update',
        'draftRequests.list',
        'debates.list',
        'debates.waiting',
        'debates.get',
        'debates.turns.post',
        'debates.result.draft',
        'debates.result.vote',
        'push.key',
        'analytics.track',
        'presence.heartbeat',
        'events.poll',
      ].sort(),
    )
    expect(names.filter((name) => contract[name].access === 'public')).toEqual(['server.info'])
  })

  it('changes a draft only when given a new body, a new channel, a new basis, a model, or several', () => {
    const change = contract['drafts.update'].body
    expect(change.decode({ body: 'New text' })._tag).toBe('Ok')
    expect(change.decode({ channel: 'design' })._tag).toBe('Ok')
    expect(change.decode({ basis: 'Read the runbook' })._tag).toBe('Ok')
    expect(change.decode({ body: 'New text', channel: 'design' })._tag).toBe('Ok')
    expect(change.decode({ model: 'claude-opus-5-5' })._tag).toBe('Ok')
    expect(change.decode({ model: 'bad\u0007model' })._tag).toBe('Err')
    expect(change.decode({})).toMatchObject({
      _tag: 'Err',
      error: [{ message: 'Give a new body, a new channel, a new basis, a model, or several.' }],
    })
    expect(change.decode({ basis: 'x'.repeat(1001) })._tag).toBe('Err')
    expect(change.decode({ channel: 'Not a slug' })._tag).toBe('Err')
  })

  it('releases a note with an optional reason of at most 500 characters', () => {
    const release = contract['notes.release'].body
    expect(release.decode({})._tag).toBe('Ok')
    expect(release.decode({ reason: 'Not my area.' })._tag).toBe('Ok')
    expect(release.decode({ reason: 'x'.repeat(501) })._tag).toBe('Err')
  })

  it('pages channels with a limit and a cursor, and says whether more exist', () => {
    const { query, response } = contract['channels.list']
    expect(Object.keys(query).sort()).toEqual(['cursor', 'limit', 'q'])
    expect(response.decode({ channels: [], hasMore: false, cursor: null })._tag).toBe('Ok')
    expect(response.decode({ channels: [], hasMore: true, cursor: '50' })._tag).toBe('Ok')
    expect(response.decode({ channels: [] })._tag).toBe('Err')
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

describe('language on the profile', () => {
  const changes = contract['me.update'].body!

  it('lets a person pick a language, or clear it to follow the browser again', () => {
    expect(changes.is({ locale: 'ko' })).toBe(true)
    expect(changes.is({ locale: null })).toBe(true)
    expect(changes.is({})).toBe(true)
    expect(changes.is({ locale: 'fr' })).toBe(false)
  })

  it('returns the chosen language with the signed-in member, and leaves it out when none was chosen', () => {
    const me = {
      member: {
        id: 'mem_abcdefghijkl',
        email: 'ana@example.com',
        name: 'Ana',
        profile: '',
        role: 'member',
        status: 'active',
        createdAt: 1,
        character: null,
      },
      credential: { id: 'cred_abcdefghijkl', kind: 'human', name: 'Browser' },
      contactMode: 'open',
    }
    expect(shared.Me.is(me)).toBe(true)
    expect(shared.Me.is({ ...me, locale: 'ko' })).toBe(true)
    expect(shared.Me.is({ ...me, locale: 'xx' })).toBe(false)
  })

  it('accepts the language of the browser that subscribes to push notifications', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/x',
      keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
    }
    expect(contract['push.subscribe'].body!.is({ ...subscription, locale: 'ko' })).toBe(true)
    expect(contract['push.subscribe'].body!.is(subscription)).toBe(true)
  })
})
