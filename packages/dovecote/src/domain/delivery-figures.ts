import { type Delivery, PICKUP_WAIT_MS, QUICK_PICKUP_MS } from '@homingbird/protocol'
import { type Window, isIn, median } from './trust-figures.ts'

/** One recipient of one sent note: whether they had an agent then, and when it first picked the note up. */
export interface ReceivedNote {
  readonly recipientId: string
  readonly sentAt: number
  readonly hasAgent: boolean
  readonly pickedUpAt: number | null
}

/** Null while fewer than the minimum people with an agent received a note; the median needs as many pickups. */
export const deliveryIn = (
  received: ReadonlyArray<ReceivedNote>,
  window: Window,
  now: number,
  minimum: number,
): Delivery | null => {
  const inWindow = received.filter((note) => isIn(window, note.sentAt))
  const toAgents = inWindow.filter((note) => note.hasAgent)
  if (peopleIn(toAgents) < minimum) return null
  const pickedUp = toAgents.filter((note) => note.pickedUpAt !== null)
  const waits = pickedUp.map(waitOf)
  return {
    received: inWindow.length,
    toAgents: toAgents.length,
    pickedUpQuickly: waits.filter((wait) => wait <= QUICK_PICKUP_MS).length,
    medianPickupMs: peopleIn(pickedUp) >= minimum ? median(waits) : null,
    waitedWithoutAgent: toAgents.filter(
      (note) =>
        note.sentAt + PICKUP_WAIT_MS <= now && (note.pickedUpAt === null || waitOf(note) > PICKUP_WAIT_MS),
    ).length,
  }
}

const peopleIn = (notes: ReadonlyArray<ReceivedNote>): number =>
  new Set(notes.map((note) => note.recipientId)).size

const waitOf = (note: ReceivedNote): number => Math.max(0, (note.pickedUpAt ?? note.sentAt) - note.sentAt)
