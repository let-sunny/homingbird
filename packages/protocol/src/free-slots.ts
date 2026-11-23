import { Schema as S } from '@homingbird/kernel'
import { Timestamp } from './ids.ts'

/** A time a person is free, in UTC epoch milliseconds, and nothing else about it. */
export const FreeSlot = S.closed(S.struct({ startsAt: Timestamp, endsAt: Timestamp }))
export type FreeSlot = S.Infer<typeof FreeSlot>

export const FREE_SLOTS_MAX = 50

export const FREE_SLOTS_NOTE_MAX = 200

/** Never what fills the busy time: decoding refuses any other field, such as a title or a place. */
export const FreeSlotsTurn = S.closed(
  S.struct({
    slots: S.array(FreeSlot, { maxItems: FREE_SLOTS_MAX }),
    note: S.optional(S.string({ maxLength: FREE_SLOTS_NOTE_MAX })),
    cannotReadCalendar: S.optional(S.boolean),
  }),
)
export type FreeSlotsTurn = S.Infer<typeof FreeSlotsTurn>
