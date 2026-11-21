import type {
  AsRead,
  ConversationId,
  DraftAsShown,
  DraftRequest,
  MemberId,
  NoteId,
} from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import { featureOn } from '../features.ts'
import { deskUnavailableReason } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import type { Release, Thread } from '../state.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt, isArchived, threadItems } from '../thread.ts'
import { type ReviewCard, reviewCardModel } from './channel-agent.ts'
import { type DraftsItemModel, draftsItemModel } from './drafts-item.ts'
import type { ThreadInput } from './thread-room.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * Everything that waits for the person, by kind, newest first in each: their own agent's drafts, the
 * channel agents' answers they review, notes their agent skipped, their agent being unable to answer,
 * and debate rooms that need them. Only the person's own drafts are listed, and never an answer to a
 * question they asked (rule 2); a kind whose feature is off is left out.
 */
export const activityModel = (input: ActivityInput): ActivityModel => {
  const groups = [
    group('drafts', draftItems(input)),
    group('reviews', featureOn('channelAgents', input.serverInfo) ? reviewItems(input) : []),
    group('skipped', skippedItems(input)),
    group('unavailable', unavailableItems(input)),
    group('debates', featureOn('debateRooms', input.serverInfo) ? debateItems(input) : []),
  ].filter((shown) => shown.items.length > 0)
  const count = groups.reduce(
    (sum, shown) => sum + shown.items.reduce((all, item) => all + item.weight, 0),
    0,
  )
  return {
    title: strings.activity.title,
    count,
    label: count === 0 ? strings.activity.bellNone : strings.activity.bell({ count }),
    empty: groups.length === 0 ? strings.activity.empty : null,
    groups,
  }
}

/** How long a closed room's result stays listed for a person whose agent helped reach it. */
export const RESULT_LISTED_MS = 7 * 24 * 60 * 60_000

export interface ActivityInput {
  readonly me: AsRead.Me
  readonly threads: ReadonlyMap<ConversationId, Thread>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly draftsRead: ReadonlyMap<NoteId, DraftAsShown>
  readonly draftRequests: ReadonlyArray<DraftRequest>
  readonly releases: ReadonlyMap<NoteId, Release>
  readonly reviews: ReadonlyArray<AsRead.Review>
  readonly reviewsRead: ReadonlyMap<NoteId, DraftAsShown>
  readonly debates: ReadonlyArray<AsRead.DebateSummary>
  readonly taught: AsRead.MyPrinciples | 'failed' | null
  readonly agentReport: AsRead.AgentReport | 'failed' | null
  readonly serverInfo: AsRead.ServerInfo | null
  readonly now: number
}

export interface ActivityModel {
  readonly title: string
  /** How many things wait: each draft, answer, skipped note and room once. */
  readonly count: number
  /** The bell's name, with the count in words. */
  readonly label: string
  readonly empty: string | null
  readonly groups: ReadonlyArray<ActivityGroup>
}

export type ActivityKind = 'drafts' | 'reviews' | 'skipped' | 'unavailable' | 'debates'

export interface ActivityGroup {
  readonly kind: ActivityKind
  readonly title: string
  readonly items: ReadonlyArray<ActivityItem>
}

/** Where an item happens, as a link to the conversation, with when it arrived. */
export interface ActivityPlace {
  readonly text: string
  readonly href: string
  readonly label: string
  readonly time: TimeShown | null
}

export type ActivityItem =
  | ActivityEntry<'drafts', { readonly drafts: DraftsItemModel }>
  | ActivityEntry<'drafts-loading', { readonly text: string }>
  | ActivityEntry<'review', { readonly card: ReviewCard }>
  | ActivityEntry<
      'skipped',
      { readonly from: string; readonly body: string; readonly reason: string; readonly reply: string }
    >
  | ActivityEntry<'unavailable', { readonly heading: string; readonly lines: ReadonlyArray<string> }>
  | ActivityEntry<'debate', { readonly text: string }>

type ActivityEntry<Type extends string, Fields> = {
  readonly type: Type
  readonly key: string
  readonly at: number
  /** How many things this item counts for in the bell. */
  readonly weight: number
  readonly place: ActivityPlace
} & Fields

const group = (kind: ActivityKind, items: ReadonlyArray<ActivityItem>): ActivityGroup => ({
  kind,
  title: strings.activity.groups[kind],
  items: [...items].sort((one, other) => other.at - one.at),
})

const draftItems = (input: ActivityInput): ActivityItem[] =>
  input.conversations
    .filter((room) => !isArchived(room))
    .flatMap((room): ActivityItem[] => {
      const thread = input.threads.get(room.id)
      if (thread === undefined)
        return room.draftCount === 0
          ? []
          : [
              {
                type: 'drafts-loading',
                key: `drafts-loading:${room.id}`,
                at: room.lastActivityAt,
                weight: room.draftCount,
                place: placeOf(
                  input,
                  room,
                  hrefFor({ name: 'conversation', id: room.id, draft: null }),
                  null,
                ),
                text: strings.activity.draftsLoading({ count: room.draftCount }),
              },
            ]
      return threadItems(thread.notes, input.draftRequests).flatMap((item): ActivityItem[] => {
        if (item.type !== 'drafts') return []
        const own = item.drafts.filter((draft) => draft.authorId === input.me.member.id)
        if (own.length === 0) return []
        const latest = Math.max(...own.map((draft) => draft.updatedAt))
        return [
          {
            type: 'drafts',
            key: `drafts:${room.id}:${item.key}`,
            at: latest,
            weight: own.length,
            place: placeOf(
              input,
              room,
              hrefFor({ name: 'conversation', id: room.id, draft: own[0]!.id }),
              latest,
            ),
            drafts: draftsItemModel(threadInputOf(input, room.id, thread), { ...item, drafts: own }),
          },
        ]
      })
    })

const reviewItems = (input: ActivityInput): ActivityItem[] =>
  input.reviews
    .filter(
      (review) =>
        review.note.authorId !== input.me.member.id && review.question?.authorId !== input.me.member.id,
    )
    .map((review) => {
      const room = input.conversations.find((candidate) => candidate.id === review.note.conversationId)
      return {
        type: 'review',
        key: `review:${review.note.id}`,
        at: review.note.updatedAt,
        weight: 1,
        place: {
          text: strings.activity.inPlace({
            place:
              room === undefined
                ? channelLabel(review.channel)
                : conversationTitle(room, input.members, input.me.member.id, strings.formerMember),
          }),
          href: hrefFor({
            name: 'conversation',
            id: review.note.conversationId,
            draft: null,
            review: review.note.id,
          }),
          label: strings.activity.openConversation,
          time: timeShown(review.note.updatedAt, input.now),
        },
        card: {
          ...reviewCardModel(review, input.reviewsRead, input.members, null, 'quoted'),
          heading: strings.channelAgent.waitsInRoom({ agent: review.agent.name }),
        },
      }
    })

const skippedItems = (input: ActivityInput): ActivityItem[] =>
  [...input.releases].flatMap(([noteId, release]): ActivityItem[] => {
    const found = noteInThreads(input.threads, noteId)
    if (found === null || found.note.authorId === input.me.member.id) return []
    const { note, thread } = found
    const answered = thread.notes.some(
      (other) =>
        other.inReplyTo === noteId && other.authorId === input.me.member.id && other.status !== 'discarded',
    )
    const room = input.conversations.find((candidate) => candidate.id === note.conversationId)
    if (answered || room === undefined || isArchived(room)) return []
    const at = note.sentAt ?? note.createdAt
    return [
      {
        type: 'skipped',
        key: `skipped:${noteId}`,
        at,
        weight: 1,
        place: placeOf(input, room, hrefFor({ name: 'conversation', id: room.id, draft: null }), at),
        from: strings.activity.skippedFrom({
          name: input.members.get(note.authorId)?.name ?? strings.formerMember,
        }),
        body: excerpt(note.body, SKIPPED_EXCERPT),
        reason:
          release.reason === null
            ? strings.agentReleasedWithoutReason
            : strings.agentReleased({ reason: release.reason }),
        reply: strings.activity.replyYourself,
      },
    ]
  })

const unavailableItems = (input: ActivityInput): ActivityItem[] => {
  const presence = input.directory.find((entry) => entry.member.id === input.me.member.id)?.presence ?? null
  const lines = deskUnavailableReason(presence)
  return lines.length === 0
    ? []
    : [
        {
          type: 'unavailable',
          key: 'unavailable',
          at: input.now,
          weight: 1,
          place: {
            text: strings.navMyAgent,
            href: hrefFor({ name: 'agent', section: 'connection' }),
            label: strings.activity.openConnection,
            time: null,
          },
          heading: strings.activity.unavailableTitle,
          lines,
        },
      ]
}

const debateItems = (input: ActivityInput): ActivityItem[] => {
  const me = input.me.member.id
  const postedFrom = new Set(
    [...input.threads.values()].flatMap((thread) =>
      thread.notes.flatMap((note) =>
        note.authorId === me && note.status !== 'discarded' && note.fromDebate != null
          ? [note.fromDebate.debateId as string]
          : [],
      ),
    ),
  )
  return input.debates.flatMap((room): ActivityItem[] => {
    const takesPart = room.participantIds.includes(me)
    const asks = room.status === 'open' && room.joined && !takesPart
    const result =
      room.status === 'closed' &&
      room.resultDrafted &&
      takesPart &&
      input.now - room.deadlineAt < RESULT_LISTED_MS &&
      !postedFrom.has(room.id)
    if (!asks && !result) return []
    const at = asks ? room.createdAt : room.deadlineAt
    return [
      {
        type: 'debate',
        key: `debate:${room.id}`,
        at,
        weight: 1,
        place: {
          text: room.question,
          href: hrefFor({ name: 'debate', id: room.id }),
          label: strings.activity.openRoom,
          time: timeShown(at, input.now),
        },
        text: asks ? strings.activity.debateAsks : strings.activity.debateResult,
      },
    ]
  })
}

const placeOf = (
  input: ActivityInput,
  room: AsRead.Conversation,
  href: string,
  at: number | null,
): ActivityPlace => ({
  text: strings.activity.inPlace({
    place: conversationTitle(room, input.members, input.me.member.id, strings.formerMember),
  }),
  href,
  label: strings.activity.openConversation,
  time: at === null ? null : timeShown(at, input.now),
})

const threadInputOf = (
  input: ActivityInput,
  conversationId: ConversationId,
  thread: Thread,
): ThreadInput => ({
  me: input.me,
  conversationId,
  thread,
  draftsRead: input.draftsRead,
  conversations: input.conversations,
  channels: input.channels,
  members: input.members,
  directory: input.directory,
  releases: input.releases,
  archiveDiscards: [],
  replyTarget: null,
  draftRequests: input.draftRequests,
  taught: input.taught,
  agentReport: input.agentReport,
  serverInfo: input.serverInfo,
  sending: false,
  now: input.now,
  focusedDraft: null,
})

const noteInThreads = (
  threads: ReadonlyMap<ConversationId, Thread>,
  noteId: NoteId,
): { readonly note: AsRead.Note; readonly thread: Thread } | null => {
  for (const thread of threads.values()) {
    const note = thread.notes.find((candidate) => candidate.id === noteId)
    if (note !== undefined) return { note, thread }
  }
  return null
}

const SKIPPED_EXCERPT = 280
