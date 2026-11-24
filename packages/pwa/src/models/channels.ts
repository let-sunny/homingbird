import type { AsRead, ConversationId, Group, GroupId, MemberId } from '@homingbird/protocol'
import {
  type ChannelPageWish,
  type ListedChannels,
  channelLabel,
  channelNamed,
  isPrivate,
  isValidSlug,
  similarChannels,
  slugFrom,
} from '../channels.ts'
import { hrefFor } from '../routes.ts'
import type { Workspace } from '../state.ts'
import { strings } from '../strings.ts'
import { answeredByAgent } from './channel-membership.ts'
import { type ListStep, type ListWait, listWaitModel, offersRetry } from './start.ts'

/** Channels: waiting for the list, none yet, none matching, or the cards with a hint and a way to see more. */
export const channelListModel = (
  listed: ListedChannels,
  wish: ChannelPageWish,
  step: ListStep | null,
  workspace: Workspace,
): ChannelListModel => {
  const isOfWordBefore = step !== null && listed.query !== wish.query
  const awaited = isOfWordBefore && step === 'loading' ? null : step
  const wait = awaited === null ? null : listWaitModel(awaited, workspace, strings.checking.channels)
  if (wait !== null && (isOfWordBefore || listed.channels.length === 0)) return { kind: 'waiting', wait }
  if (listed.channels.length === 0 && listed.query === '')
    return { kind: 'none-yet', text: strings.noChannelsYet }
  if (listed.channels.length === 0) return { kind: 'no-match', text: strings.noChannels }
  return {
    kind: 'channels',
    cards: listed.channels.map(channelCard),
    onlyOne:
      listed.query === '' && listed.channels.length === 1 && !listed.hasMore ? strings.onlyOneChannel : null,
    more: listed.hasMore && !offersRetry(wait) ? strings.showMoreChannels : null,
    wait,
  }
}

/** One page more of the list, or a fresh first page for what was typed. */
export const withPage = (
  previous: ListedChannels | null,
  query: string,
  found: {
    readonly channels: ReadonlyArray<AsRead.Channel>
    readonly hasMore: boolean
    readonly cursor: string | null
  },
): ListedChannels => ({
  query,
  channels: [...(previous?.channels ?? []), ...found.channels],
  hasMore: found.hasMore,
  cursor: found.cursor,
})

/** A channel's own page: ask it a question, join it, manage it, or, as an administrator, see who is in it. */
export const askPageModel = (channel: AsRead.Channel, viewerIsAdmin = false): AskPageModel => {
  const mayAsk = channel.joined || !isPrivate(channel)
  return {
    title: mayAsk
      ? strings.askChannelTitle({ channel: channelLabel(channel.slug) })
      : channelLabel(channel.slug),
    description: channel.description,
    mayJoin: !channel.joined && !isPrivate(channel),
    managing: channel.managing,
    seesMembers: channel.managing || (viewerIsAdmin && isPrivate(channel)),
    intro: !mayAsk
      ? null
      : channel.helperCount === 0
        ? strings.askChannelNobodyAnswers
        : strings.askChannelIntro({ count: channel.helperCount }),
    mayAsk,
  }
}

/** The room of a channel the person is in, which its page opens instead of asking. */
export const joinedRoom = (
  channels: ReadonlyArray<AsRead.Channel>,
  conversations: ReadonlyArray<AsRead.Conversation>,
  slug: string,
): ConversationId | null => {
  const channel = channelNamed(channels, slug)
  const joined = channel !== null && conversations.some((room) => room.id === channel.conversationId)
  return joined ? channel.conversationId : null
}

/** What the create form says about the name typed: it exists already, or similar ones do. */
export const nameCheck = (channels: ReadonlyArray<AsRead.Channel>, typed: string): NameCheck => {
  const exact = channelNamed(channels, typed.replace(/-+$/, ''))
  if (exact !== null)
    return {
      kind: 'exists',
      text: strings.channelExists({ channel: channelLabel(exact.slug) }),
      href: hrefFor({ name: 'channel', slug: exact.slug }),
    }
  const similar = similarChannels(channels, typed)
  return similar.length === 0
    ? { kind: 'free' }
    : { kind: 'similar', slugs: similar.map((channel) => channel.slug) }
}

/** The slug to create from what was typed, or null when it is not valid or already taken. */
export const slugToCreate = (channels: ReadonlyArray<AsRead.Channel>, typed: string): string | null => {
  const wanted = slugFrom(typed).replace(/-+$/, '')
  return isValidSlug(wanted) && channelNamed(channels, wanted) === null ? wanted : null
}

export type ChannelListModel =
  | { readonly kind: 'waiting'; readonly wait: ListWait }
  | { readonly kind: 'none-yet'; readonly text: string }
  | { readonly kind: 'no-match'; readonly text: string }
  | {
      readonly kind: 'channels'
      readonly cards: ReadonlyArray<ChannelCard>
      readonly onlyOne: string | null
      readonly more: string | null
      /** In place of the next page while it is on its way or did not come. */
      readonly wait: ListWait | null
    }

export interface ChannelCard {
  readonly channel: AsRead.Channel
  readonly className: string
  readonly label: string
  readonly href: string
  readonly status: { readonly text: string; readonly className: string } | null
  /** Why the person's own agent drafts nothing here, while they answer or could join to: its own agent answers. */
  readonly agentNote: string | null
  /** Joining an open channel the person is not in: one button, answering there too in its menu. */
  readonly join: { readonly label: string; readonly more: string; readonly joinAndAnswer: string } | null
}

export interface AskPageModel {
  readonly title: string
  readonly description: string
  readonly mayJoin: boolean
  readonly managing: boolean
  /** Whether the room controls show, with the members: a manager's, or an administrator's read-only view. */
  readonly seesMembers: boolean
  readonly intro: string | null
  readonly mayAsk: boolean
}

export type NameCheck =
  | { readonly kind: 'free' }
  | { readonly kind: 'exists'; readonly text: string; readonly href: string }
  | { readonly kind: 'similar'; readonly slugs: ReadonlyArray<string> }

const channelCard = (channel: AsRead.Channel): ChannelCard => ({
  channel,
  className: `channel-card ${channel.answering ? 'is-helping' : ''} ${isPrivate(channel) ? 'is-private' : ''}`,
  label: channelLabel(channel.slug),
  href: hrefFor({ name: 'channel', slug: channel.slug }),
  status: channel.answering
    ? { text: strings.helpingHere, className: 'kind is-helping' }
    : channel.joined
      ? { text: strings.inRoom, className: 'kind is-joined' }
      : null,
  agentNote: channel.answering || !channel.joined ? answeredByAgent(channel) : null,
  join:
    channel.joined || isPrivate(channel)
      ? null
      : {
          label: strings.join,
          more: strings.channelMore({ channel: channelLabel(channel.slug) }),
          joinAndAnswer: strings.joinAndAnswer,
        },
})
