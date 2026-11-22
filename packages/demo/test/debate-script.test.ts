import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  DEBATE_JOIN_AFTER_MS,
  DEBATE_TURN_AFTER_MS,
  changeRoom,
  colleagueJoinsLater,
  debateLater,
  roomById,
} from '../src/debate-script.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, memberNamed } from './support/demo.ts'

const started = () => {
  const clock = makeTestClock(NOW)
  return { clock, world: createWorld(clock) }
}

describe('debateLater', () => {
  it('plays nothing in a room that already has turns, or with one agent taking part', async () => {
    const { world, clock } = started()
    const [spoken, , waiting] = world.records().debates
    debateLater(world, spoken!.id)
    debateLater(world, waiting!.id)
    debateLater(world, 'deb_nosuchroom0')
    await clock.advance(DEBATE_TURN_AFTER_MS * 10)
    expect(roomById(world, spoken!.id)?.turns).toHaveLength(2)
    expect(roomById(world, waiting!.id)?.turns).toHaveLength(0)
  })

  it('asks one agent at a time, in join order, and nobody once the scripted turns are taken', async () => {
    const { world, clock } = started()
    const waiting = world.records().debates[2]!
    changeRoom(world, waiting.id, (room) => ({
      ...room,
      participants: [
        ...room.participants,
        { memberId: VISITOR_ID, agentId: null, agentName: "June's laptop", joinedAt: NOW, takingPart: true },
      ],
    }))
    const [first, second] = roomById(world, waiting.id)!.participants.map((one) => one.memberId)
    debateLater(world, waiting.id)
    expect(roomById(world, waiting.id)?.askedTurn).toEqual({
      memberId: first,
      until: NOW + 150_000,
      next: [second],
    })
    await clock.advance(DEBATE_TURN_AFTER_MS)
    expect(roomById(world, waiting.id)?.askedTurn).toMatchObject({ memberId: second, next: [first] })
    await clock.advance(DEBATE_TURN_AFTER_MS * 10)
    expect(roomById(world, waiting.id)?.askedTurn).toBeNull()
  })

  it('stops when the room closed meanwhile, and never plays the same room twice', async () => {
    const { world, clock } = started()
    const waiting = world.records().debates[2]!
    changeRoom(world, waiting.id, (room) => ({
      ...room,
      participants: [
        ...room.participants,
        { memberId: VISITOR_ID, agentId: null, agentName: "June's laptop", joinedAt: NOW, takingPart: true },
      ],
    }))
    debateLater(world, waiting.id)
    debateLater(world, waiting.id)
    await clock.advance(DEBATE_TURN_AFTER_MS)
    expect(roomById(world, waiting.id)?.turns).toHaveLength(1)
    changeRoom(world, waiting.id, (room) => ({ ...room, status: 'ended', endedBecause: 'no_turns' }))
    await clock.advance(DEBATE_TURN_AFTER_MS * 10)
    expect(roomById(world, waiting.id)?.turns).toHaveLength(1)
  })
})

describe('colleagueJoinsLater', () => {
  it('joins nobody without a colleague, and not a room that is no longer open', async () => {
    const { world, clock } = started()
    const closed = world.records().debates[1]!
    colleagueJoinsLater(world, closed.id, memberNamed(world, 'Kai Lin'))
    colleagueJoinsLater(world, closed.id, null)
    await clock.advance(DEBATE_JOIN_AFTER_MS)
    expect(roomById(world, closed.id)?.participants).toEqual(closed.participants)
  })
})

describe('changeRoom', () => {
  it('tells the room’s members and its agents’ people that it changed', () => {
    const { world } = started()
    const open = world.records().debates[0]!
    changeRoom(world, open.id, (room) => room)
    expect(world.eventsAfter(memberNamed(world, 'Kai Lin'), 0).at(-1)?.body).toEqual({
      type: 'debate.changed',
      debateId: open.id,
      participantIds: open.participants.map((participant) => participant.memberId),
    })
  })
})
