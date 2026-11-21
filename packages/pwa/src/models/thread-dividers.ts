import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { isUnreadBy } from '../thread.ts'
import { dayHeading, isSameDay } from './time.ts'

/**
 * A thread's items with the lines between them: a day's heading where the day changes (and over the
 * first note when it is not from today), and "Unread" over the first note that was unread when the
 * person opened the conversation.
 */
export const withDividers = <Item extends DividedItem>(
  items: ReadonlyArray<Item>,
  input: { readonly now: number; readonly unreadFrom: NoteId | null },
): ReadonlyArray<Item | ThreadDivider> => {
  let previous: number | null = null
  return items.flatMap((item): Array<Item | ThreadDivider> => {
    if (item.note === undefined) return [item]
    const moment = momentOf(item.note)
    const startsDay = previous === null ? !isSameDay(moment, input.now) : !isSameDay(moment, previous)
    previous = moment
    return [
      ...(startsDay ? [dayDivider(moment, input.now)] : []),
      ...(item.note.id === input.unreadFrom ? [unreadDivider()] : []),
      item,
    ]
  })
}

/** The first note someone else sent that the person has not read, where the "Unread" line goes. */
export const firstUnreadIn = (notes: ReadonlyArray<AsRead.Note>, viewerId: MemberId): NoteId | null =>
  notes
    .filter((note) => isUnreadBy(note, viewerId))
    .reduce<AsRead.Note | null>(
      (first, note) => (first === null || momentOf(note) < momentOf(first) ? note : first),
      null,
    )?.id ?? null

export interface ThreadDivider {
  readonly type: 'divider'
  readonly key: string
  readonly kind: 'day' | 'unread'
  readonly text: string
}

/** What a thread item needs to have a divider placed before it: a sent note says when it was sent. */
export interface DividedItem {
  readonly type: string
  readonly note?: AsRead.Note
}

const momentOf = (note: AsRead.Note): number => note.sentAt ?? note.createdAt

const dayDivider = (moment: number, now: number): ThreadDivider => ({
  type: 'divider',
  key: `day:${new Date(moment).toDateString()}`,
  kind: 'day',
  text: dayHeading(moment, now),
})

const unreadDivider = (): ThreadDivider => ({
  type: 'divider',
  key: 'unread',
  kind: 'unread',
  text: strings.unreadFromHere,
})
