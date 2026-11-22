import { makeTestClock } from '@homingbird/kernel'
import { JOIN_CODE_LIFETIME_SECONDS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEMO_SERVER_ADDRESS, redeemCopiedJoinCode } from '../src/join-codes.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('joinCodes.create', () => {
  it('makes the code for the one line to paste on a server, naming a placeholder server', async () => {
    const { api } = demoApi()
    const code = await succeeded(api['joinCodes.create']({ body: {} }))
    expect(code).toEqual({
      id: expect.stringMatching(/^join_/),
      code: expect.stringMatching(/^hbj_/),
      serverUrl: DEMO_SERVER_ADDRESS,
      expiresAt: NOW + JOIN_CODE_LIFETIME_SECONDS * 1000,
      expiresInSeconds: JOIN_CODE_LIFETIME_SECONDS,
    })
  })

  it('makes a code for a channel’s agent for its channel’s managers only (rule 6)', async () => {
    const { api, world } = demoApi()
    expect(await refused(api['joinCodes.create']({ body: { channel: 'billing' } }))).toBeNull()
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(await refused(kai.api['joinCodes.create']({ body: { channel: 'billing' } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(api['joinCodes.create']({ body: { channel: 'deploys' } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })
})

describe('joinCodes.status', () => {
  it('waits until the copied line is redeemed a few seconds later, then names the connection it made', async () => {
    const clock = makeTestClock(NOW)
    const { api, world } = demoApi(VISITOR_ID, createWorld(clock))
    const made = await succeeded(api['joinCodes.create']({ body: {} }))
    expect(await succeeded(api['joinCodes.status']({ params: { id: made.id } }))).toEqual({
      status: 'waiting',
    })
    redeemCopiedJoinCode(world, 'echo nothing to redeem')
    redeemCopiedJoinCode(
      world,
      ` homingbird setup --server ${made.serverUrl} --join ${made.code} --agent claude`,
    )
    await clock.advance(3_999)
    expect((await succeeded(api['joinCodes.status']({ params: { id: made.id } }))).status).toBe('waiting')
    await clock.advance(1)
    const status = await succeeded(api['joinCodes.status']({ params: { id: made.id } }))
    expect(status).toEqual({
      status: 'redeemed',
      credential: { id: expect.any(String), name: 'Team server' },
    })
    const listed = await succeeded(api['credentials.list']({}))
    expect(listed.credentials.find((each) => each.id === status.credential!.id)).toMatchObject({
      kind: 'agent',
      name: 'Team server',
    })
    expect(world.records().credentials.at(-1)).toMatchObject({ memberId: VISITOR_ID, issuedBy: VISITOR_ID })
  })

  it('issues a channel’s code to its agent, and redeems a code once and never after it expired', async () => {
    const clock = makeTestClock(NOW)
    const { api, world } = demoApi(VISITOR_ID, createWorld(clock))
    const made = await succeeded(api['joinCodes.create']({ body: { channel: 'billing' } }))
    const line = ` --join ${made.code}`
    redeemCopiedJoinCode(world, line)
    redeemCopiedJoinCode(world, line)
    await clock.advance(4_000)
    const agentId = world.records().channels.find((each) => each.slug === 'billing')!.agentId
    expect(
      world
        .records()
        .credentials.filter((each) => each.memberId === agentId && each.credential.name === 'Team server'),
    ).toHaveLength(1)
    const late = await succeeded(api['joinCodes.create']({ body: {} }))
    redeemCopiedJoinCode(world, ` --join ${late.code}`)
    await clock.advance(JOIN_CODE_LIFETIME_SECONDS * 1000)
    expect(await refused(api['joinCodes.status']({ params: { id: late.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('tells only the person who made the code', async () => {
    const { api, world } = demoApi()
    const made = await succeeded(api['joinCodes.create']({ body: {} }))
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(await refused(kai.api['joinCodes.status']({ params: { id: made.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })
})
