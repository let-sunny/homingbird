import { type Delivery, PICKUP_WAIT_MS, QUICK_PICKUP_MS } from '@homingbird/protocol'
import { isEnough } from './disclosure.ts'
import { type Window, isIn, median } from './trust-figures.ts'

/** One recipient of one sent note: whether they had an agent then, and when it first picked the note up. */
export interface ReceivedNote {
  readonly recipientId: string
  readonly sentAt: number
  readonly hasAgent: boolean
  readonly pickedUpAt: number | null
}

/** Each figure hides while too few people stand behind it, so no subtraction isolates one person. */
export const deliveryIn = (
  received: ReadonlyArray<ReceivedNote>,
  window: Window,
  now: number,
  minimum: number,
): Delivery | null => {
  const inWindow = received.filter((note) => isIn(window, note.sentAt))
  const toAgents = inWindow.filter((note) => note.hasAgent)
  if (!isEnough(peopleIn(toAgents), minimum)) return null
  const pickedUp = toAgents.filter((note) => note.pickedUpAt !== null)
  const waits = pickedUp.map(waitOf)
  const withoutAgents = peopleIn(inWindow.filter((note) => !note.hasAgent))
  return {
    received: withoutAgents === 0 || isEnough(withoutAgents, minimum) ? inWindow.length : null,
    toAgents: toAgents.length,
    pickedUpQuickly: waits.filter((wait) => wait <= QUICK_PICKUP_MS).length,
    medianPickupMs: isEnough(peopleIn(pickedUp), minimum) ? median(waits) : null,
    waitedWithoutAgent: toAgents.filter(
      (note) =>
        note.sentAt + PICKUP_WAIT_MS <= now && (note.pickedUpAt === null || waitOf(note) > PICKUP_WAIT_MS),
    ).length,
  }
}

const peopleIn = (notes: ReadonlyArray<ReceivedNote>): number =>
  new Set(notes.map((note) => note.recipientId)).size

const waitOf = (note: ReceivedNote): number => Math.max(0, (note.pickedUpAt ?? note.sentAt) - note.sentAt)
