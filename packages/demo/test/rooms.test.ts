import { describe, expect, it } from 'vitest'
import { destinationOf, roomOf, roomWith } from '../src/rooms.ts'
import { demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

describe('roomWith', () => {
  it('finds the viewer’s conversation with exactly these people, and starts one when there is none', () => {
    const { world, viewerId } = demoApi()
    const ana = memberNamed(world, 'Ana Silva')
    const kai = memberNamed(world, 'Kai Lin')
    expect(roomWith(world, viewerId, [ana], null).id).toBe(
      noteStarting(world, 'Yes. I checked').conversationId,
    )
    const started = roomWith(world, viewerId, [ana, kai], 'Release')
    expect(started).toMatchObject({ kind: 'group', title: 'Release', startedBy: viewerId })
    expect(roomWith(world, viewerId, [kai, ana], null).id).toBe(started.id)
  })

  it('never finds a private question as a group conversation', () => {
    const { world } = demoApi()
    const ben = memberNamed(world, 'Ben Okafor')
    const asked = world.records().conversations.find((room) => room.privateQuestionOf !== undefined)!
    const others = asked.participantIds.filter((id) => id !== ben)
    expect(roomWith(world, ben, others, null).id).not.toBe(asked.id)
  })
})

describe('destinationOf', () => {
  it('goes to a conversation, a channel’s room or the one with a person, and says what is missing', async () => {
    const { world, viewerId } = demoApi()
    const kai = memberNamed(world, 'Kai Lin')
    const billing = world.records().channels.find((channel) => channel.slug === 'billing')!
    expect((await succeeded(destinationOf(world, viewerId, { channel: 'billing' }))).id).toBe(
      billing.conversationId,
    )
    expect((await succeeded(destinationOf(world, viewerId, { to: [kai] }))).participantIds).toEqual([
      viewerId,
      kai,
    ])
    expect(await refused(destinationOf(world, viewerId, { channel: 'nowhere' }))).toMatchObject({
      _tag: 'Invalid',
    })
    expect(
      await refused(destinationOf(world, viewerId, { to: [kai.replace('kai', 'zzz') as typeof kai] })),
    ).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(destinationOf(world, viewerId, {}))).toMatchObject({ _tag: 'Invalid' })
  })
})

describe('roomOf', () => {
  it('finds a conversation only for a person who takes part in it', async () => {
    const { world } = demoApi()
    const room = noteStarting(world, 'Yes. I checked').conversationId
    expect(await refused(roomOf(world.records(), memberNamed(world, 'Kai Lin'), room))).toMatchObject({
      _tag: 'NotFound',
    })
  })
})
