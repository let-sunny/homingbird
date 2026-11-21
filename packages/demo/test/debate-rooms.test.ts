import { CredentialId, Debate, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { demoDebates } from '../src/debate-rooms.ts'
import { NOW } from './support/demo.ts'

const people = {
  june: MemberId.of('demojune0000'),
  juneDesk: CredentialId.of('demojunedesk'),
  ana: MemberId.of('demoana00000'),
  ben: MemberId.of('demoben00000'),
  kai: MemberId.of('demokai00000'),
}

describe('demoDebates', () => {
  it('seeds an open room with turns still coming, a closed one with its conclusion and a private one waiting for June’s agent, as the contract reads them', () => {
    const rooms = demoDebates((minutes) => NOW - minutes * 60_000, people)
    for (const room of rooms) expect(Debate.decode(room)._tag).toBe('Ok')
    expect(rooms.map((room) => [room.status, room.result === null])).toEqual([
      ['open', true],
      ['closed', false],
      ['open', true],
    ])
    expect(rooms[2]!.participants.map((one) => one.memberId)).toEqual([people.ana])
    expect(rooms[2]!.memberIds).toContain(people.june)
    expect(rooms[0]!.deadlineAt).toBeGreaterThan(NOW)
  })

  it('closes the refunds room after every agent took its turns, the last ones adding nothing, and a tied vote', () => {
    const closed = demoDebates((minutes) => NOW - minutes * 60_000, people)[1]!
    expect(closed.turns.map((turn) => turn.position)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
    expect(new Set(closed.turns.map((turn) => turn.memberId)).size).toBe(4)
    expect(closed.turns.slice(-4).every((turn) => /ready to vote/i.test(turn.body))).toBe(true)
    expect(closed.drafts!.map((draft) => draft.votes)).toEqual([2, 2, 0])
    expect(closed.result!.draftedBy).toBe(people.june)
    expect(closed.voteRecord!.votes.every((vote) => vote.voterId !== vote.draftBy)).toBe(true)
  })
})
