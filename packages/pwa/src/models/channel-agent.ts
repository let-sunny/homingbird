import {
  type AsRead,
  type ConversationId,
  type CredentialId,
  type DraftAsShown,
  type MemberId,
  type NoteId,
  isPerson,
} from '@homingbird/protocol'
import { type ChannelAgentState, channelAgentState } from '../channel-answerers.ts'
import { channelLabel, channelOfRoom, isPrivate } from '../channels.ts'
import { type SourceShown, draftBasisOf } from '../draft-basis.ts'
import { isChangedSinceRead } from '../drafts-read.ts'
import { featureOn } from '../features.ts'
import { type HeldChoices, heldWordsFor, keptEditLine } from '../held-decisions.ts'
import { hrefFor } from '../routes.ts'
import { formats, strings } from '../strings.ts'

/** What a channel's own controls offer about its agent: running it, for a manager, and asking it privately. */
export const agentControlsModel = (
  channel: AsRead.Channel,
  serverInfo: AsRead.ServerInfo | null,
): AgentControls => {
  if (!featureOn('channelAgents', serverInfo)) return { manage: null, askPrivately: null }
  const agent = channel.agent ?? null
  const mayAsk = agent !== null && (channel.joined || !isPrivate(channel))
  return {
    manage: channel.runsAgent === true ? strings.channelAgent.title : null,
    askPrivately: mayAsk ? strings.channelAgent.askPrivately({ agent: agent.name }) : null,
  }
}

/** The page of a channel's agent: its channel once known, for a manager of it; anyone else finds nothing. */
export const channelAgentPageModel = (
  channels: ReadonlyArray<AsRead.Channel>,
  loaded: boolean,
  slug: string,
): ChannelAgentPage => {
  const channel = channels.find((one) => one.slug === slug)
  if (channel === undefined && !loaded) return { kind: 'loading' }
  if (channel === undefined || channel.runsAgent !== true)
    return { kind: 'missing', text: strings.channelAgent.notYours }
  return {
    kind: 'channel',
    title: strings.channelAgent.pageTitle({ channel: channelLabel(slug) }),
    channel,
    agentState: channel.agent == null ? null : channelAgentState(channel.agent),
  }
}

/**
 * The agent panel of a channel's manager: making the agent, or naming it, its desks and retiring it. In
 * the dialog it leads to the agent's page, where its waiting answers and figures are.
 */
export const agentPanelModel = (
  agent: AsRead.ChannelAgent | null | 'loading' | 'failed',
  members: ReadonlyMap<MemberId, AsRead.Member>,
  place: AgentPanelPlace,
  joinCodes: boolean,
): AgentPanel => {
  if (agent === 'loading') return { kind: 'loading' }
  if (agent === 'failed') return { kind: 'failed', text: strings.channelAgent.loadFailed }
  if (agent === null)
    return {
      kind: 'none',
      intro: strings.channelAgent.intro,
      text: strings.channelAgent.none,
      create: strings.channelAgent.create,
    }
  const name = agent.agent.name
  return {
    kind: 'agent',
    intro: strings.channelAgent.intro,
    name,
    desksTitle: strings.channelAgent.desksTitle({ agent: name }),
    desks: agent.credentials.map((credential) => ({
      id: credential.id,
      name: credential.name,
      issuedBy:
        credential.issuedBy === null
          ? null
          : strings.channelAgent.approvedByManager({
              name: members.get(credential.issuedBy)?.name ?? strings.formerMember,
            }),
      disconnect: credential.revokedAt === null ? strings.channelAgent.revoke : null,
      state: credential.revokedAt === null ? null : strings.channelAgent.revoked,
    })),
    desksNone: agent.credentials.length === 0 ? strings.channelAgent.desksNone : null,
    connectHint: joinCodes
      ? strings.channelAgent.connectHintWithJoin({ agent: name })
      : strings.channelAgent.connectHint({ agent: name }),
    retireTitle: strings.channelAgent.retireTitle,
    retireBody: strings.channelAgent.retireBody,
    retire: strings.channelAgent.retire({ agent: name }),
    page:
      place === 'dialog'
        ? {
            href: hrefFor({ name: 'channel-agent', slug: agent.channel, draft: null }),
            label: strings.channelAgent.openPage,
            hint: strings.channelAgent.openPageHint,
          }
        : null,
  }
}

/**
 * The answers waiting in one channel, each as a card; one the agent changed since it was read says so,
 * and the one a notification opened is the focused card.
 */
export const reviewCardsModel = (
  reviews: ReadonlyArray<AsRead.Review>,
  slug: string,
  read: ReadonlyMap<NoteId, DraftAsShown>,
  members: ReadonlyMap<MemberId, AsRead.Member>,
  edits: ReadonlyMap<NoteId, string>,
  focus: string | null,
): ReviewCards => {
  const shown = reviews.filter((review) => review.channel === slug)
  return {
    title: strings.channelAgent.reviewsTitle,
    none: shown.length === 0 ? strings.channelAgent.reviewsNone : null,
    cards: shown.map((review) => reviewCardModel(review, read, members, edits, focus, 'quoted')),
  }
}

/** One answer waiting for review; its question is quoted on the card unless the card sits right under it. */
export const reviewCardModel = (
  review: AsRead.Review,
  read: ReadonlyMap<NoteId, DraftAsShown>,
  members: ReadonlyMap<MemberId, AsRead.Member>,
  edits: ReadonlyMap<NoteId, string>,
  focus: string | null,
  question: 'quoted' | 'above',
): ReviewCard => {
  const basis = draftBasisOf(review.note)
  const channel = channelLabel(review.channel)
  const asker = review.question === null ? null : (members.get(review.question.authorId)?.name ?? null)
  return {
    review,
    focused: review.note.id === focus,
    heading: null,
    why: strings.channelAgent.whyYouReview({ channel }),
    question:
      review.question === null || question === 'above'
        ? null
        : {
            from: strings.channelAgent.questionFrom({
              name: members.get(review.question.authorId)?.name ?? strings.formerMember,
            }),
            body: review.question.body,
          },
    privately: review.privately ? strings.channelAgent.askedPrivately : null,
    body: review.note.body,
    basis:
      basis?.kind === 'given'
        ? { title: strings.channelAgent.reliedOn, lines: basis.lines, sources: basis.sources }
        : null,
    readAgain: isChangedSinceRead(read, review.note)
      ? { notice: strings.draftChangedSinceRead, confirm: strings.draftReadAgain }
      : null,
    send: strings.channelAgent.send,
    edit: strings.channelAgent.edit,
    discard: strings.channelAgent.discard,
    discarding: {
      title: strings.channelAgent.discardTitle,
      label: strings.channelAgent.discardReason,
      hint:
        asker === null
          ? strings.channelAgent.discardReasonHintPrivately({ channel })
          : strings.channelAgent.discardReasonHint({ channel, name: asker }),
      confirm: strings.channelAgent.discardConfirm,
    },
    held: heldWordsFor(review.privately ? (asker ?? channel) : channel),
    editText: edits.get(review.note.id) ?? review.note.body,
    keptEdit: keptEditLine(edits, review.note.id),
  }
}

/**
 * The answers waiting for the person in one room, each under the question it answers. Only a reviewer
 * holds them, as `reviews.list` gave them; one whose question the person asked is never shown to them.
 * A question not loaded here keeps the answer at the end, quoted on its card.
 */
export const reviewsInRoomModel = <Item extends RoomItem>(
  items: ReadonlyArray<Item>,
  reviews: ReadonlyArray<AsRead.Review>,
  room: { readonly conversationId: ConversationId; readonly viewerId: MemberId },
  read: ReadonlyMap<NoteId, DraftAsShown>,
  members: ReadonlyMap<MemberId, AsRead.Member>,
  edits: ReadonlyMap<NoteId, string>,
  focus: string | null,
): ReadonlyArray<Item | RoomReview> => {
  const here = reviews.filter(
    (review) =>
      review.note.conversationId === room.conversationId &&
      review.note.authorId !== room.viewerId &&
      review.question?.authorId !== room.viewerId,
  )
  const questions = new Set(items.flatMap((item) => (item.type === 'note' ? [item.note.id] : [])))
  const placed = Map.groupBy(
    here.filter((review) => questions.has(questionOf(review) as NoteId)),
    (review) => questionOf(review) as NoteId,
  )
  const asItem = (review: AsRead.Review, question: 'quoted' | 'above'): RoomReview => ({
    type: 'review',
    key: `review:${review.note.id}`,
    card: {
      ...reviewCardModel(review, read, members, edits, focus, question),
      heading: strings.channelAgent.waitsInRoom({ agent: review.agent.name }),
    },
  })
  return [
    ...items.flatMap(
      (item): Array<Item | RoomReview> =>
        item.type === 'note'
          ? [item, ...(placed.get(item.note.id) ?? []).map((review) => asItem(review, 'above'))]
          : [item],
    ),
    ...here
      .filter((review) => !questions.has(questionOf(review) as NoteId))
      .map((review) => asItem(review, 'quoted')),
  ]
}

/**
 * Why the answer a notification opened is not among the cards: who sent it, or that it no longer waits,
 * so that a notification left on another device does not read as an error.
 */
export const decidedAnswerModel = (
  decided: AsRead.Note | null,
  viewerId: MemberId | null,
  members: ReadonlyMap<MemberId, AsRead.Member>,
): string => {
  const approvedBy = decided?.status === 'sent' ? (decided.approvedBy ?? null) : null
  if (approvedBy === null) return strings.channelAgent.decided.gone
  if (approvedBy === viewerId) return strings.channelAgent.decided.sentByYou
  return strings.channelAgent.decided.sentBy({ name: members.get(approvedBy)?.name ?? strings.formerMember })
}

/**
 * How many of a channel's agent's answers wait for the person, for the badge on the channel's row, and
 * where the row then leads: the first question whose answer waits there, or, when all of them wait in
 * private questions, the first of those.
 */
export const reviewBadgeOf = (reviews: ReadonlyArray<AsRead.Review>, slug: string): ReviewBadge | null => {
  const count = reviews.filter((review) => review.channel === slug).length
  if (count === 0) return null
  const first = firstWaitingIn(reviews, slug)
  return {
    text: strings.channelAgent.reviewBadge({ count: formats.decimal.format(count) }),
    label: strings.channelAgent.reviewBadgeLabel({ count }),
    href: hrefFor({ name: 'conversation', id: first.conversationId, draft: null, review: first.id }),
  }
}

/** Beside a channel's agent's sent answer: where it answered and who approved it ("#payments-wiki · approved by Kim"). */
export const approvalLine = (
  note: AsRead.Note,
  room: AsRead.Conversation | undefined,
  channels: ReadonlyArray<AsRead.Channel>,
  members: ReadonlyMap<MemberId, AsRead.Member>,
): string | null => {
  const approvedBy = note.approvedBy ?? null
  if (approvedBy === null || room === undefined) return null
  const slug = room.privateQuestionOf ?? channelOfRoom(channels, room.id)?.slug ?? null
  const name = members.get(approvedBy)?.name ?? strings.formerMember
  return slug === null
    ? strings.channelAgent.approvedByManager({ name })
    : strings.channelAgent.approvedBy({ channel: channelLabel(slug), name })
}

/**
 * Who wrote a channel's agent's note, said as the agent of its channel, never as a person's agent; null
 * for a note a person or their own agent wrote.
 */
export const agentAuthorshipLine = (
  note: AsRead.Note,
  room: AsRead.Conversation | undefined,
  channels: ReadonlyArray<AsRead.Channel>,
  members: ReadonlyMap<MemberId, AsRead.Member>,
): string | null => {
  const author = members.get(note.authorId)
  if (author === undefined || isPerson(author)) return null
  const slug =
    room === undefined ? null : (room.privateQuestionOf ?? channelOfRoom(channels, room.id)?.slug ?? null)
  const channel = slug === null ? strings.channelAgent.someChannel : channelLabel(slug)
  const approver = note.approvedBy ?? null
  return note.origin === 'human_edited' && approver !== null
    ? strings.channelAgent.writtenByEdited({
        agent: author.name,
        channel,
        name: members.get(approver)?.name ?? strings.formerMember,
      })
    : strings.channelAgent.writtenBy({ agent: author.name, channel })
}

/** The first screen of a private question: who else reads it, now and later. */
export const privateQuestionNotice = (
  room: AsRead.Conversation | undefined,
  channels: ReadonlyArray<AsRead.Channel>,
): string | null => {
  if (room === undefined || room.privateQuestionOf === undefined) return null
  const slug = room.privateQuestionOf
  if (slug === null || room.archivedAt !== null) return strings.channelAgent.privateNoticeArchived
  const agent = channels.find((channel) => channel.slug === slug)?.agent ?? null
  return strings.channelAgent.privateNotice({
    agent: agent?.name ?? channelLabel(slug),
    channel: channelLabel(slug),
  })
}

/**
 * Whom a desk approved on the device page connects as: the person's own agent, or the agent of a channel
 * they manage. Empty when there is nothing but their own.
 */
export const deviceTargetsModel = (
  channels: ReadonlyArray<AsRead.Channel>,
  serverInfo: AsRead.ServerInfo | null,
): DeviceTargets | null => {
  if (!featureOn('channelAgents', serverInfo)) return null
  const managed = channels.flatMap(({ slug, runsAgent, agent }) =>
    runsAgent === true && agent !== undefined && agent !== null
      ? [
          {
            value: slug,
            label: strings.channelAgent.connectAsAgent({ agent: agent.name, channel: channelLabel(slug) }),
          },
        ]
      : [],
  )
  if (managed.length === 0) return null
  return {
    label: strings.channelAgent.connectAs,
    choices: [{ value: '', label: strings.channelAgent.connectAsMe }, ...managed],
  }
}

export type ChannelAgentPage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing'; readonly text: string }
  | {
      readonly kind: 'channel'
      readonly title: string
      readonly channel: AsRead.Channel
      /** Whether the agent is there to answer, as a person's agent is shown. */
      readonly agentState: ChannelAgentState | null
    }

export interface ReviewBadge {
  readonly text: string
  readonly label: string
  readonly href: string
}

export interface AgentControls {
  readonly manage: string | null
  readonly askPrivately: string | null
}

export type AgentPanel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'none'; readonly intro: string; readonly text: string; readonly create: string }
  | {
      readonly kind: 'agent'
      readonly intro: string
      readonly name: string
      readonly desksTitle: string
      readonly desks: ReadonlyArray<{
        readonly id: CredentialId
        readonly name: string
        readonly issuedBy: string | null
        readonly disconnect: string | null
        readonly state: string | null
      }>
      readonly desksNone: string | null
      readonly connectHint: string
      readonly retireTitle: string
      readonly retireBody: string
      readonly retire: string
      readonly page: { readonly href: string; readonly label: string; readonly hint: string } | null
    }

/** Where the panel is shown: the dialog a channel's controls open, or the agent's own page. */
export type AgentPanelPlace = 'dialog' | 'page'

export interface ReviewCards {
  readonly title: string
  readonly none: string | null
  readonly cards: ReadonlyArray<ReviewCard>
}

export interface ReviewCard {
  readonly review: AsRead.Review
  readonly focused: boolean
  readonly heading: string | null
  /** Why this person is shown the answer: they manage its channel. */
  readonly why: string
  readonly question: { readonly from: string; readonly body: string } | null
  readonly privately: string | null
  readonly body: string
  readonly basis: {
    readonly title: string
    readonly lines: ReadonlyArray<string>
    readonly sources: ReadonlyArray<SourceShown>
  } | null
  readonly readAgain: { readonly notice: string; readonly confirm: string } | null
  readonly send: string
  readonly edit: string
  readonly discard: string
  /** Asking why before a discard; the reason is the managers' alone. */
  readonly discarding: {
    readonly title: string
    readonly label: string
    readonly hint: string
    readonly confirm: string
  }
  /** What the card's place and the toast say while a send or discard is held, and after. */
  readonly held: HeldChoices
  /** The text Edit opens with: the manager's kept edit, or the answer as it stands. */
  readonly editText: string
  /** Said when the manager edited the answer and did not send the edit. */
  readonly keptEdit: string | null
}

/** What a room's list needs of an item to place an answer under its question. */
export type RoomItem =
  | { readonly type: 'note'; readonly key: string; readonly note: Pick<AsRead.Note, 'id'> }
  | { readonly type: 'drafts'; readonly key: string }

export interface RoomReview {
  readonly type: 'review'
  readonly key: string
  readonly card: ReviewCard
}

export interface DeviceTargets {
  readonly label: string
  readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

const questionOf = (review: AsRead.Review): NoteId | null =>
  review.note.inReplyTo ?? review.question?.id ?? null

const firstWaitingIn = (reviews: ReadonlyArray<AsRead.Review>, slug: string): AsRead.Note => {
  const inChannel = reviews
    .filter((review) => review.channel === slug)
    .sort(
      (one, other) =>
        Number(one.privately) - Number(other.privately) || one.note.createdAt - other.note.createdAt,
    )
  return inChannel[0]!.note
}
