import type { AsRead, ConversationId } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { isArchived, isMuted } from '../thread.ts'
import type { ActivityKind, ActivityModel } from './activity.ts'

/**
 * What waits for the person, read from the activity panel's own groups so that the bell, the tab's
 * title, the app badge, the list's filter and the switcher all count the same things. Approvals come
 * first: their agent's drafts and the channel answers they review. A decision held a moment no longer
 * waits, as the bell already counts it. The panel lists its groups approvals first.
 */
export const waitingOf = (activity: Pick<ActivityModel, 'groups'>): Waiting => {
  const counted = activity.groups.flatMap((group) =>
    group.items.filter((item) => item.weight > 0).map((item) => ({ group, item })),
  )
  const weightOf = (kinds: ReadonlyArray<ActivityKind>): number =>
    counted.filter(({ group }) => kinds.includes(group.kind)).reduce((sum, { item }) => sum + item.weight, 0)
  const places = new Map<string, WaitingPlace>()
  for (const { group, item } of counted)
    if (!places.has(placeKey(item.place)))
      places.set(placeKey(item.place), {
        key: placeKey(item.place),
        conversationId: item.place.conversationId,
        text: item.place.text,
        href: item.place.href,
        why: group.title,
      })
  return {
    approvals: weightOf(APPROVALS),
    others: weightOf(KIND_ORDER.filter((kind) => !APPROVALS.includes(kind))),
    places: [...places.values()],
    conversationIds: new Set(
      counted.flatMap(({ item }) => (item.place.conversationId === null ? [] : [item.place.conversationId])),
    ),
  }
}

/**
 * The tab's title and the app badge: approvals first, then whatever else waits, then unread notes in
 * conversations the person has not muted. The badge counts what waits, and is only a mark when nothing
 * waits but notes are unread.
 */
export const outsideTabModel = (input: OutsideTabInput): OutsideTab => {
  const { name, waiting } = input
  const unread = unreadCount(input.conversations)
  const total = waiting.approvals + waiting.others
  return {
    title:
      waiting.approvals > 0
        ? unread > 0
          ? strings.waiting.titleApproveUnread({ approve: waiting.approvals, unread, name })
          : strings.waiting.titleApprove({ approve: waiting.approvals, name })
        : waiting.others > 0
          ? unread > 0
            ? strings.waiting.titleWaitingUnread({ waiting: waiting.others, unread, name })
            : strings.waiting.titleWaiting({ waiting: waiting.others, name })
          : unread > 0
            ? strings.waiting.titleUnread({ unread, name })
            : name,
    badge: total > 0 ? total : unread > 0 ? 'unread' : null,
  }
}

/** Unread notes in the conversations the person keeps open and has not muted. */
export const unreadCount = (conversations: ReadonlyArray<AsRead.Conversation>): number =>
  conversations
    .filter((room) => !isArchived(room) && !isMuted(room))
    .reduce((sum, room) => sum + room.unreadCount, 0)

/**
 * The list's filter: on, only the conversations that wait for the person are shown. It counts
 * places in words, so that it never reads as the bell's count of the things that wait.
 */
export const waitingFilterModel = (pressed: boolean, waiting: Waiting): WaitingFilter => {
  const count = waiting.conversationIds.size
  return {
    text: strings.waiting.filter,
    label: count === 0 ? strings.waiting.filterNone : strings.waiting.filterLabel({ count }),
    count: count === 0 ? null : strings.waiting.filterCount({ count }),
    pressed,
  }
}

export interface Waiting {
  /** Drafts to approve and answers to review, counted as the bell counts them. */
  readonly approvals: number
  /** Notes the agent skipped and debate rooms that need the person. */
  readonly others: number
  /** Where each thing waits, approvals first, each place once. */
  readonly places: ReadonlyArray<WaitingPlace>
  readonly conversationIds: ReadonlySet<ConversationId>
}

export interface WaitingPlace {
  readonly key: string
  readonly conversationId: ConversationId | null
  readonly text: string
  readonly href: string
  /** The activity group it is listed under: “Drafts from your agent”. */
  readonly why: string
}

export interface OutsideTabInput {
  readonly name: string
  readonly waiting: Waiting
  readonly conversations: ReadonlyArray<AsRead.Conversation>
}

export interface OutsideTab {
  readonly title: string
  /** A count, a mark without a number, or no badge. */
  readonly badge: number | 'unread' | null
}

export interface WaitingFilter {
  readonly text: string
  readonly label: string
  readonly count: string | null
  readonly pressed: boolean
}

export const NOTHING_WAITS: Waiting = { approvals: 0, others: 0, places: [], conversationIds: new Set() }

const KIND_ORDER: ReadonlyArray<ActivityKind> = ['drafts', 'reviews', 'skipped', 'debates']

const APPROVALS: ReadonlyArray<ActivityKind> = ['drafts', 'reviews']

const placeKey = (place: { readonly conversationId: ConversationId | null; readonly href: string }): string =>
  place.conversationId ?? place.href
