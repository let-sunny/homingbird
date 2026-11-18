import type { Conversation, MemberId, Note } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { ARRIVAL_PLAYS_MS, arrivalTracker } from '../src/arrivals.ts'

const clock = () => {
  let time = 1000
  return { now: () => time, advance: (ms: number) => void (time += ms) }
}

const ME = 'mem_me0000000000' as MemberId
const BEN = 'mem_ben000000000' as MemberId

const conversation = (
  id: string,
  last: { id: string; authorId: MemberId; sentAt?: number } | null,
): Conversation =>
  ({ id, lastNote: last === null ? null : ({ ...last } as unknown as Note) }) as unknown as Conversation

describe('arrivalTracker', () => {
  it('animates nothing the first time a conversation is drawn', () => {
    const time = clock()
    const justArrived = arrivalTracker(100, time.now)
    expect(justArrived(conversation('c1', { id: 'n1', authorId: BEN }), ME)).toBe(false)
  })

  it('animates a conversation that first appears with a note sent after the page loaded', () => {
    const time = clock()
    const justArrived = arrivalTracker(100, time.now)
    expect(justArrived(conversation('c2', { id: 'n1', authorId: BEN, sentAt: 101 }), ME)).toBe(true)
    time.advance(ARRIVAL_PLAYS_MS)
    expect(justArrived(conversation('c2', { id: 'n1', authorId: BEN, sentAt: 101 }), ME)).toBe(false)
    expect(justArrived(conversation('c3', { id: 'n2', authorId: BEN, sentAt: 100 }), ME)).toBe(false)
    expect(justArrived(conversation('c4', { id: 'n3', authorId: ME, sentAt: 200 }), ME)).toBe(false)
  })

  it('animates a row once when a colleague’s note arrives, and not when it is drawn again later', () => {
    const time = clock()
    const justArrived = arrivalTracker(100, time.now)
    justArrived(conversation('c1', { id: 'n1', authorId: BEN }), ME)
    expect(justArrived(conversation('c1', { id: 'n2', authorId: BEN }), ME)).toBe(true)
    time.advance(ARRIVAL_PLAYS_MS)
    expect(justArrived(conversation('c1', { id: 'n2', authorId: BEN }), ME)).toBe(false)
  })

  it('keeps the arrival through a redraw that comes while it still plays', () => {
    const time = clock()
    const justArrived = arrivalTracker(100, time.now)
    justArrived(conversation('c1', { id: 'n1', authorId: BEN }), ME)
    expect(justArrived(conversation('c1', { id: 'n2', authorId: BEN }), ME)).toBe(true)
    time.advance(ARRIVAL_PLAYS_MS - 1)
    expect(justArrived(conversation('c1', { id: 'n2', authorId: BEN }), ME)).toBe(true)
  })

  it('does not animate for a note the viewer sent, or a conversation with no note', () => {
    const time = clock()
    const justArrived = arrivalTracker(100, time.now)
    justArrived(conversation('c1', null), ME)
    expect(justArrived(conversation('c1', null), ME)).toBe(false)
    expect(justArrived(conversation('c1', { id: 'n3', authorId: ME }), ME)).toBe(false)
    expect(justArrived(conversation('c1', { id: 'n4', authorId: BEN }), ME)).toBe(true)
  })
})
