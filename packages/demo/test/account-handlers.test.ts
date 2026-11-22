import {
  BUILT_IN_CHARACTERS,
  FEATURE_NAMES,
  NoteId,
  PROTOCOL_VERSION,
  type PrincipleId,
} from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEMO_FEATURES } from '../src/account-handlers.ts'
import { VISITOR_SESSION } from '../src/team.ts'
import { demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('the server and the visitor', () => {
  it('speaks this protocol and offers the demo’s features, each a feature the contract knows', async () => {
    const { api } = demoApi()
    const info = await succeeded(api['server.info']({}))
    expect(info).toMatchObject({ name: 'dovecote', protocolVersion: PROTOCOL_VERSION, contactMode: 'open' })
    expect(DEMO_FEATURES.every((name) => FEATURE_NAMES.includes(name))).toBe(true)
  })

  it('signs the visitor in through their own browser session, as a person', async () => {
    const { api, viewerId } = demoApi()
    const me = await succeeded(api['me.get']({}))
    expect(me).toMatchObject({
      member: { id: viewerId, name: 'June Park' },
      credential: { id: VISITOR_SESSION, kind: 'human' },
    })
    const { credentials } = await succeeded(api['credentials.list']({}))
    expect(credentials.map((each) => [each.kind, each.current])).toEqual([
      ['human', true],
      ['agent', false],
    ])
  })

  it('changes the visitor’s name, profile, character and notifications for this visit', async () => {
    const { api, world, viewerId } = demoApi()
    expect(await succeeded(api['me.update']({ body: { name: 'June P.', profile: 'Hello.' } }))).toMatchObject(
      {
        name: 'June P.',
        profile: 'Hello.',
      },
    )
    expect((await succeeded(api['me.update']({ body: {} }))).name).toBe('June P.')
    const character = BUILT_IN_CHARACTERS[4]!
    expect((await succeeded(api['me.character.set']({ body: character }))).character).toEqual(character)
    expect((await succeeded(api['me.character.clear']({}))).character).toBeNull()
    expect(await succeeded(api['me.notifications.set']({ body: { notifications: 'direct' } }))).toEqual({
      notifications: 'direct',
    })
    expect((await succeeded(api['me.get']({}))).notifications).toBe('direct')
    expect(world.eventsAfter(viewerId, 0).map((event) => event.body.type)).toContain('directory.changed')
  })

  it('lists the directory as asked, with no contacts to keep in an open organization', async () => {
    const { api } = demoApi()
    const { entries } = await succeeded(api['directory.list']({ query: { channel: 'billing', q: 'a' } }))
    expect(entries.map((entry) => entry.member.name)).toEqual(['Ana Silva', 'June Park'])
    const team = (await succeeded(api['groups.list']({}))).groups.find((group) => group.name === 'Customer')!
    expect((await succeeded(api['directory.list']({ query: { group: team.id } }))).entries).toHaveLength(2)
    expect(await succeeded(api['contacts.list']({}))).toEqual({ contacts: [], blocked: [] })
  })

  it('answers the presence and heartbeat a client sends, and the events a poll asks for', async () => {
    const { api, world, viewerId } = demoApi()
    expect(
      await succeeded(api['presence.visibility']({ body: { page: 'page-1234', visible: true } })),
    ).toEqual({})
    expect(await succeeded(api['presence.heartbeat']({}))).toEqual({})
    expect(await succeeded(api['events.poll']({ query: {} }))).toEqual({ events: [], cursor: 0 })
    world.emit([viewerId], { type: 'contact.changed', memberId: memberNamed(world, 'Ana Silva') })
    expect(await succeeded(api['events.poll']({ query: { after: '0' } }))).toMatchObject({ cursor: 1 })
    expect(await succeeded(api['answeringFlow.get']({}))).toEqual({ flow: null, updatedAt: null })
  })
})

describe('the visitor’s agent', () => {
  it('reports the agent’s week and month', async () => {
    const { api } = demoApi()
    const report = await succeeded(api['insights.mine']({}))
    expect(report.periods.map((period) => period.days)).toEqual([7, 30])
    expect(report.week?.days).toBe(7)
  })

  it('counts each place as Dovecote does and agrees with the figures and the principles’ own counts', async () => {
    const { api } = demoApi()
    const taught = await succeeded(api['principles.list']({}))
    const month = (await succeeded(api['insights.mine']({}))).periods[1]!.current
    expect(taught.routes).toEqual([
      { place: 'deploys', drafted: 12, principles: 1, heldUp: 4, chances: 0 },
      { place: 'billing', drafted: 26, principles: 2, heldUp: 4, chances: 0 },
      { place: null, drafted: 26, principles: 1, heldUp: 3, chances: 1 },
    ])
    for (const route of taught.routes)
      expect(month.places.find((place) => place.place === route.place)?.written).toBe(route.drafted)
    expect(taught.routes.reduce((sum, route) => sum + route.heldUp, 0)).toBe(
      taught.principles.reduce((sum, principle) => sum + (principle.counts?.sentAsWritten ?? 0), 0),
    )
    expect(taught.routes.reduce((sum, route) => sum + route.chances, 0)).toBe(taught.offers.length)
    const [anywhere] = taught.principles
    await succeeded(api['principles.delete']({ params: { id: anywhere!.id } }))
    expect((await succeeded(api['principles.list']({}))).routes.map((route) => route.heldUp)).toEqual([
      0, 3, 0,
    ])
  })

  it('keeps what the visitor teaches: adds, changes, reorders, misses and removes a principle', async () => {
    const { api } = demoApi()
    const before = await succeeded(api['principles.list']({}))
    expect(before.principles).toHaveLength(2)
    const added = await succeeded(
      api['principles.create']({
        body: { kind: 'answer', topic: 'Deploys', rule: 'Ask Kai before a Friday deploy.', place: null },
      }),
    )
    expect(added).toMatchObject({ kind: 'answer', enabled: true, position: 2, counts: null })
    expect(
      (await succeeded(api['principles.create']({ body: { topic: 'Tone', rule: 'Short.', place: null } })))
        .kind,
    ).toBe('rule')
    const changed = await succeeded(
      api['principles.update']({
        params: { id: added.id },
        body: { enabled: false, topic: 'Friday deploys' },
      }),
    )
    expect(changed).toMatchObject({ enabled: false, topic: 'Friday deploys', rule: added.rule })
    const reordered = await succeeded(
      api['principles.reorder']({ body: { ids: [added.id, ...before.principles.map((each) => each.id)] } }),
    )
    expect(reordered.principles[0]?.id).toBe(added.id)
    const first = before.principles[0]!
    const missed = await succeeded(
      api['principles.miss']({ params: { id: first.id }, body: { noteId: NoteId.of('demoana00004') } }),
    )
    expect(missed.counts?.missed).toBe(1)
    expect(
      (
        await succeeded(
          api['principles.miss']({
            params: { id: added.id },
            body: { noteId: NoteId.of('demoana00004') },
          }),
        )
      ).counts,
    ).toBeNull()
    expect((await succeeded(api['principles.delete']({ params: { id: added.id } }))).id).toBe(added.id)
    expect(await refused(api['principles.delete']({ params: { id: added.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(
      await refused(
        api['principles.update']({ params: { id: 'prin_demonothing00' as PrincipleId }, body: {} }),
      ),
    ).toMatchObject({ _tag: 'NotFound' })
    expect(
      await succeeded(api['principles.offers.dismiss']({ params: { id: 'offer_demo00000000' }, body: {} })),
    ).toEqual({})
  })

  it('gives an agent the principles that are on, as it drafts', async () => {
    const { api } = demoApi()
    const [first] = (await succeeded(api['principles.list']({}))).principles
    await succeeded(api['principles.update']({ params: { id: first!.id }, body: { enabled: false } }))
    const drafting = await succeeded(api['principles.drafting']({ query: {} }))
    expect(drafting.principles.map((each) => each.topic)).toEqual(['Annual refunds'])
  })
})

describe('connecting an agent', () => {
  it('shows a sign-in code and an app asking for access, and leaves deciding to a real server', async () => {
    const { api } = demoApi()
    expect(await succeeded(api['device.get']({ params: { userCode: 'ABCD-EFGH' } }))).toMatchObject({
      userCode: 'ABCD-EFGH',
      client: 'Homingbird CLI',
    })
    expect(await succeeded(api['consent.get']({ params: { id: 'consent_1' } }))).toMatchObject({
      redirectHost: 'notes.example.com',
    })
    expect(
      await refused(api['device.decide']({ params: { userCode: 'ABCD-EFGH' }, body: { approve: true } })),
    ).toMatchObject({ _tag: 'Forbidden' })
  })
})
