import type { AsRead, CredentialId, DraftAsShown, MemberId, NoteId } from '@homingbird/protocol'
import { channelLabel, channelOfRoom, isPrivate } from '../channels.ts'
import { draftBasisOf } from '../draft-basis.ts'
import { isChangedSinceRead } from '../drafts-read.ts'
import { featureOn } from '../features.ts'
import { strings } from '../strings.ts'

/** What a channel's own controls offer about its agent: running it, for a manager, and asking it privately. */
export const agentControlsModel = (
  channel: AsRead.Channel,
  serverInfo: AsRead.ServerInfo | null,
  viewerIsManager: boolean,
): AgentControls => {
  if (!featureOn('channelAgents', serverInfo)) return { manage: null, askPrivately: null }
  const agent = channel.agent ?? null
  const mayAsk = agent !== null && (channel.joined || !isPrivate(channel))
  return {
    manage: viewerIsManager && channel.joined ? strings.channelAgent.title : null,
    askPrivately: mayAsk ? strings.channelAgent.askPrivately({ agent: agent.name }) : null,
  }
}

/** The agent panel of a channel's manager: making the agent, or naming it, its desks and retiring it. */
export const agentPanelModel = (
  agent: AsRead.ChannelAgent | null | 'loading',
  members: ReadonlyMap<MemberId, AsRead.Member>,
): AgentPanel => {
  if (agent === 'loading') return { kind: 'loading' }
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
    connectHint: strings.channelAgent.connectHint({ agent: name }),
    retireTitle: strings.channelAgent.retireTitle({ agent: name }),
    retireBody: strings.channelAgent.retireBody,
  }
}

/** The answers waiting in one channel, each as a card; one the agent changed since it was read says so. */
export const reviewCardsModel = (
  reviews: ReadonlyArray<AsRead.Review>,
  slug: string,
  read: ReadonlyMap<NoteId, DraftAsShown>,
  members: ReadonlyMap<MemberId, AsRead.Member>,
): ReviewCards => {
  const shown = reviews.filter((review) => review.channel === slug)
  return {
    title: strings.channelAgent.reviewsTitle,
    none: shown.length === 0 ? strings.channelAgent.reviewsNone : null,
    cards: shown.map((review) => {
      const basis = draftBasisOf(review.note)
      return {
        review,
        question:
          review.question === null
            ? null
            : {
                from: strings.channelAgent.questionFrom({
                  name: members.get(review.question.authorId)?.name ?? strings.formerMember,
                }),
                body: review.question.body,
              },
        privately: review.privately ? strings.channelAgent.askedPrivately : null,
        body: review.note.body,
        basis: basis?.kind === 'given' ? { title: strings.channelAgent.reliedOn, lines: basis.lines } : null,
        readAgain: isChangedSinceRead(read, review.note)
          ? { notice: strings.draftChangedSinceRead, confirm: strings.draftReadAgain }
          : null,
        send: strings.channelAgent.send,
        discard: strings.channelAgent.discard,
      }
    }),
  }
}

/** How many answers wait for the person, or null for none. */
export const reviewsWaitingText = (reviews: ReadonlyArray<AsRead.Review>): string | null =>
  reviews.length === 0 ? null : strings.channelAgent.reviewsWaiting({ count: reviews.length })

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
  const managed = channels.flatMap(({ slug, joined, managing, agent }) =>
    joined && managing && agent !== undefined && agent !== null
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

export interface AgentControls {
  readonly manage: string | null
  readonly askPrivately: string | null
}

export type AgentPanel =
  | { readonly kind: 'loading' }
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
    }

export interface ReviewCards {
  readonly title: string
  readonly none: string | null
  readonly cards: ReadonlyArray<ReviewCard>
}

export interface ReviewCard {
  readonly review: AsRead.Review
  readonly question: { readonly from: string; readonly body: string } | null
  readonly privately: string | null
  readonly body: string
  readonly basis: { readonly title: string; readonly lines: ReadonlyArray<string> } | null
  readonly readAgain: { readonly notice: string; readonly confirm: string } | null
  readonly send: string
  readonly discard: string
}

export interface DeviceTargets {
  readonly label: string
  readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>
}
