import type { MemberId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { spriteOwner } from '../src/sprite-owner.ts'

const me = 'mem_me' as MemberId
const june = 'mem_june' as MemberId

describe('spriteOwner', () => {
  it('draws a note as the person who wrote it, mine included', () => {
    expect(spriteOwner({ kind: 'note', authorId: me })).toBe(me)
    expect(spriteOwner({ kind: 'note', authorId: june })).toBe(june)
  })

  it('draws a conversation as the other person', () => {
    expect(
      spriteOwner({ kind: 'conversation', viewerId: me, participantIds: [me, june], arrivedFrom: null }),
    ).toBe(june)
  })

  it('draws a conversation as whoever just wrote, never as me', () => {
    const ben = 'mem_ben' as MemberId
    const place = { kind: 'conversation', viewerId: me, participantIds: [me, june, ben] } as const
    expect(spriteOwner({ ...place, arrivedFrom: ben })).toBe(ben)
    expect(spriteOwner({ ...place, arrivedFrom: me })).toBe(june)
  })

  it('falls back to me in a conversation with nobody else', () => {
    expect(spriteOwner({ kind: 'conversation', viewerId: me, participantIds: [me], arrivedFrom: null })).toBe(
      me,
    )
  })
})
