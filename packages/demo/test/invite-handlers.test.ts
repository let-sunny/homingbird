import { makeTestClock } from '@homingbird/kernel'
import { INVITE_LIFETIME_SECONDS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('invites', () => {
  it('makes a link to the demo page for one address, lists it newest first, and revokes it', async () => {
    const { api, world } = demoApi()
    const made = await succeeded(api['invites.create']({ body: { email: 'Lee@Example.com' } }))
    expect(made.url).toMatch(/^https:\/\/demo\.homingbird\.invalid\/#\/invite\/hbi_/)
    expect(made.invite).toMatchObject({
      email: 'lee@example.com',
      createdAt: NOW,
      expiresAt: NOW + INVITE_LIFETIME_SECONDS * 1000,
    })
    const listed = await succeeded(api['invites.list']({}))
    expect(listed.invites.map((invite) => invite.id)).toEqual([
      made.invite.id,
      world.records().invites[0]!.id,
    ])
    await succeeded(api['invites.revoke']({ params: { id: made.invite.id } }))
    expect((await succeeded(api['invites.list']({}))).invites.map((invite) => invite.id)).not.toContain(
      made.invite.id,
    )
    expect(await refused(api['invites.revoke']({ params: { id: made.invite.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('makes a link anyone may use when no address is given', async () => {
    const { api } = demoApi()
    expect((await succeeded(api['invites.create']({ body: {} }))).invite.email).toBeNull()
  })

  it('shows a member their own invites only, and an administrator every one', async () => {
    const { world } = demoApi()
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect((await succeeded(kai.api['invites.list']({}))).invites).toEqual([])
    const own = await succeeded(kai.api['invites.create']({ body: {} }))
    expect((await succeeded(kai.api['invites.list']({}))).invites.map((invite) => invite.id)).toEqual([
      own.invite.id,
    ])
    const seeded = world.records().invites[0]!
    expect(await refused(kai.api['invites.revoke']({ params: { id: seeded.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    const june = demoApi(undefined, world)
    expect((await succeeded(june.api['invites.list']({}))).invites).toHaveLength(2)
  })

  it('lists no invite that stopped working', async () => {
    const clock = makeTestClock(NOW)
    const { api } = demoApi(undefined, createWorld(clock))
    await clock.advance(INVITE_LIFETIME_SECONDS * 1000)
    expect((await succeeded(api['invites.list']({}))).invites).toEqual([])
  })
})
