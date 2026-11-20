import { describe, expect, it } from 'vitest'
import { type ReceivedNote, deliveryIn } from '../src/domain/delivery-figures.ts'
import { DAY_MS, periodEndingAt } from '../src/domain/trust-figures.ts'

const NOW = 1_700_000_000_000
const MINUTE = 60_000
const thisWeek = periodEndingAt(NOW, 7, 0)

const received = (
  recipientId: string,
  sentAgo: number,
  pickedAfter: number | null,
  hasAgent = true,
): ReceivedNote => ({
  recipientId,
  sentAt: NOW - sentAgo,
  hasAgent,
  pickedUpAt: pickedAfter === null ? null : NOW - sentAgo + pickedAfter,
})

const five = (pickedAfter: number | null, sentAgo = 2 * DAY_MS): ReceivedNote[] =>
  ['a', 'b', 'c', 'd', 'e'].map((id) => received(id, sentAgo, pickedAfter))

describe('deliveryIn', () => {
  it('counts received notes, those to agents, quick pickups and the typical pickup time', () => {
    const notes = [
      ...five(MINUTE),
      received('a', DAY_MS, 5 * MINUTE),
      received('b', DAY_MS, 5 * MINUTE + 1),
      received('f', HOUR, null, false),
    ]
    expect(deliveryIn(notes, thisWeek, NOW, 5)).toEqual({
      received: 8,
      toAgents: 7,
      pickedUpQuickly: 6,
      medianPickupMs: MINUTE,
      waitedWithoutAgent: 0,
    })
  })

  it('counts a note that no agent picked up within a day, but not one whose day has not passed', () => {
    const notes = [
      ...five(MINUTE),
      received('a', 3 * DAY_MS, null),
      received('b', 3 * DAY_MS, DAY_MS + 1),
      received('c', 3 * DAY_MS, DAY_MS),
      received('d', HOUR, null),
    ]
    expect(deliveryIn(notes, thisWeek, NOW, 5)?.waitedWithoutAgent).toBe(2)
  })

  it('shows nothing while fewer people than the minimum with an agent received a note', () => {
    const notes = [...five(MINUTE).slice(0, 4), received('e', DAY_MS, null, false)]
    expect(deliveryIn(notes, thisWeek, NOW, 5)).toBeNull()
    expect(deliveryIn(five(MINUTE, 8 * DAY_MS), thisWeek, NOW, 5)).toBeNull()
  })

  it('hides the typical pickup time while too few people’s agents picked a note up', () => {
    const notes = [...five(null).slice(0, 2), ...five(MINUTE).slice(2)]
    expect(deliveryIn(notes, thisWeek, NOW, 5)).toMatchObject({ toAgents: 5, medianPickupMs: null })
  })
})

const HOUR = 60 * MINUTE
