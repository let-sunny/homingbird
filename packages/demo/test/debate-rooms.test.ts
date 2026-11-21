import { CredentialId, Debate, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { demoDebates } from '../src/debate-rooms.ts'
import { NOW } from './support/demo.ts'

const people = {
  june: MemberId.of('demojune0000'),
  juneDesk: CredentialId.of('demojunedesk'),
  ana: MemberId.of('demoana00000'),
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
})
