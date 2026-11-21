import type { AsRead, MemberId } from '@homingbird/protocol'
import { archivedRooms, channelLabel, channelOfRoom, channelRooms, peopleConversations } from '../channels.ts'
import { featureOn } from '../features.ts'
import { type Route, hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt, isMuted, otherParticipants } from '../thread.ts'
import { type AvatarModel, type GroupAvatarModel, groupAvatarOf, memberAvatarOf } from './avatar.ts'
import { reviewBadgeOf } from './channel-agent.ts'
import { leaveConsequence } from './channel-membership.ts'
import { type MuteToggle, muteToggleModel } from './mute-toggle.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * The header's tabs, the current one marked; Debates only where the organization has it. My agent
 * carries a mark while the person's agent cannot answer, named by `agentUnavailable`.
 */
export const tabsModel = (
  route: Route,
  info: AsRead.ServerInfo | null,
  agentUnavailable: string | null = null,
): ReadonlyArray<Tab> => [
  tab(strings.navNotes, { name: 'home' }, ['home', 'conversation'], route),
  {
    ...tab(strings.navMyAgent, { name: 'agent', section: null }, ['agent'], route, 'connect'),
    mark: agentUnavailable,
  },
  tab(strings.navPeople, { name: 'people' }, ['people', 'group'], route),
  tab(strings.channels, { name: 'channels' }, ['channels', 'channel', 'channel-agent'], route, 'channels'),
  ...(featureOn('debateRooms', info)
    ? [tab(strings.navDebates, { name: 'debates' }, ['debates', 'debate'], route)]
    : []),
]

/** Search, offered as an icon beside the activity bell so the tabs stay short. */
export const searchLinkModel = (route: Route): Tab =>
  tab(strings.search, { name: 'search', query: '' }, ['search'], route)

/** The user menu: who is signed in, the profile, administration for an administrator, and signing out. */
export const userMenuModel = (me: AsRead.Me): UserMenu => ({
  name: me.member.name,
  email: me.member.email,
  links: [
    { label: strings.menuProfile, href: hrefFor({ name: 'profile' }) },
    ...(me.member.role === 'admin'
      ? [{ label: strings.menuAdmin, href: hrefFor({ name: 'admin', section: 'settings' }) }]
      : []),
  ],
  signOut: strings.menuSignOut,
})

/** The sidebar: direct messages, channel rooms and archived rooms, each as rows. */
export const sidebarModel = (input: SidebarInput): SidebarModel => {
  const people = peopleConversations(input.conversations)
  const archived = archivedRooms(input.conversations)
  const row = (conversation: AsRead.Conversation): ConversationRow => conversationRow(input, conversation)
  return {
    onboarding: input.agentCount === 0,
    people: !input.loaded
      ? { kind: 'loading' }
      : people.length === 0
        ? { kind: 'none' }
        : { kind: 'rows', rows: people.map(row) },
    channelRooms: channelRooms(input.conversations).map(row),
    archived:
      archived.length === 0
        ? null
        : {
            title: strings.archivedGroup({ count: archived.length }),
            open: archived.some((conversation) => isOpen(input.route, conversation)),
            rows: archived.map(row),
          },
  }
}

/** Whether the list or the stage is shown on a narrow screen: the list only on home. */
export const paneFor = (route: Route): 'list' | 'stage' => (route.name === 'home' ? 'list' : 'stage')

export interface Tab {
  readonly label: string
  readonly href: string
  readonly current: boolean
  readonly tour: string | null
  /** A state the tab's page tells about, as a small mark with these words for assistive technology. */
  readonly mark: string | null
}

export interface UserMenu {
  readonly name: string
  readonly email: string
  readonly links: ReadonlyArray<{ readonly label: string; readonly href: string }>
  readonly signOut: string
}

export interface SidebarInput {
  readonly me: AsRead.Me
  readonly route: Route
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly loaded: boolean
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly channels: ReadonlyArray<AsRead.Channel>
  /** The answers of channels' agents waiting for the person's review, from `reviews.list`. */
  readonly reviews: ReadonlyArray<AsRead.Review>
  readonly agentCount: number
  readonly charactersOn: boolean
  readonly muteOn: boolean
  readonly now: number
  /** The conversations whose row plays a note's arrival now; a muted one never does. */
  readonly arrived: ReadonlySet<string>
  /** The conversations whose composer holds text the person has not sent. */
  readonly typedIn: ReadonlySet<string>
}

export interface SidebarModel {
  readonly onboarding: boolean
  readonly people:
    | { readonly kind: 'loading' }
    | { readonly kind: 'none' }
    | { readonly kind: 'rows'; readonly rows: ReadonlyArray<ConversationRow> }
  readonly channelRooms: ReadonlyArray<ConversationRow>
  readonly archived: {
    readonly title: string
    readonly open: boolean
    readonly rows: ReadonlyArray<ConversationRow>
  } | null
}

export interface ConversationRow {
  readonly id: string
  readonly href: string
  readonly current: boolean
  readonly face:
    | { readonly kind: 'channel' }
    | ({ readonly kind: 'group' } & GroupAvatarModel)
    | { readonly kind: 'member'; readonly avatar: AvatarModel }
  readonly title: string
  readonly presence: AsRead.Presence | null
  readonly archived: boolean
  readonly channel: { readonly memberCount: number; readonly helperCount: number } | null
  readonly preview: string
  readonly time: TimeShown | null
  readonly unread: { readonly count: number; readonly label: string } | null
  readonly drafts: { readonly text: string; readonly label: string } | null
  /** A pencil while the composer keeps text the person has not sent. */
  readonly typed: { readonly text: string; readonly label: string } | null
  /** The channel's agent's answers waiting for the person's review; the row then opens at the first. */
  readonly review: { readonly text: string; readonly label: string } | null
  readonly mute: MuteToggle | null
  readonly menu: {
    readonly id: string
    readonly label: string
    readonly mute: MuteToggle | null
    readonly leave: RowLeave | null
  } | null
}

/** Leaving a channel from its row: confirmed in a dialog, or refused with the reason. */
export type RowLeave =
  | { readonly kind: 'allowed'; readonly slug: string; readonly title: string; readonly body: string }
  | { readonly kind: 'blocked'; readonly slug: string; readonly reason: string }

const tab = (
  label: string,
  target: Route,
  activeFor: ReadonlyArray<Route['name']>,
  route: Route,
  tour: string | null = null,
): Tab => ({ label, href: hrefFor(target), current: activeFor.includes(route.name), tour, mark: null })

const isOpen = (route: Route, conversation: AsRead.Conversation): boolean =>
  route.name === 'conversation' && route.id === conversation.id

const conversationRow = (input: SidebarInput, conversation: AsRead.Conversation): ConversationRow => {
  const viewerId = input.me.member.id
  const others = otherParticipants(conversation, viewerId)
  const archived = conversation.archivedAt !== null
  const channel = conversation.kind === 'channel' ? channelOfRoom(input.channels, conversation.id) : null
  const last = conversation.lastNote
  const title = conversationTitle(conversation, input.members, viewerId, strings.formerMember)
  const mute = muteToggleModel(conversation, title, input.muteOn)
  const review = channel === null || archived ? null : reviewBadgeOf(input.reviews, channel.slug)
  return {
    id: conversation.id,
    href: review?.href ?? hrefFor({ name: 'conversation', id: conversation.id, draft: null }),
    current: isOpen(input.route, conversation),
    face:
      conversation.kind === 'channel' || archived ? { kind: 'channel' } : faceOf(input, conversation, others),
    title,
    presence:
      conversation.kind === 'direct'
        ? (input.directory.find((entry) => entry.member.id === others[0])?.presence ?? null)
        : null,
    archived,
    channel,
    preview:
      last !== null
        ? excerpt(last.body, 60)
        : conversation.kind === 'group'
          ? strings.groupNotSentYet
          : conversation.draftCount > 0
            ? strings.draftsWaiting({ count: conversation.draftCount })
            : strings.noNotesYet,
    time: last?.sentAt != null ? timeShown(last.sentAt, input.now) : null,
    unread:
      conversation.unreadCount > 0
        ? { count: conversation.unreadCount, label: strings.unread({ count: conversation.unreadCount }) }
        : null,
    drafts:
      conversation.draftCount > 0
        ? {
            text: `✎${conversation.draftCount}`,
            label: strings.draftsWaiting({ count: conversation.draftCount }),
          }
        : null,
    typed: input.typedIn.has(conversation.id) && !archived ? { text: '✎', label: strings.unsentText } : null,
    review: review === null ? null : { text: review.text, label: review.label },
    mute,
    menu: rowMenu(conversation, title, channel, mute),
  }
}

/** A row's own menu: muting it, and leaving a channel the person joined; none when it offers nothing. */
const rowMenu = (
  conversation: AsRead.Conversation,
  title: string,
  channel: AsRead.Channel | null,
  mute: MuteToggle | null,
): ConversationRow['menu'] => {
  const leave: RowLeave | null =
    channel === null || !channel.joined || conversation.archivedAt !== null
      ? null
      : channel.managing
        ? { kind: 'blocked', slug: channel.slug, reason: strings.managerCannotLeave }
        : {
            kind: 'allowed',
            slug: channel.slug,
            title: strings.leaveChannelTitle({ channel: channelLabel(channel.slug) }),
            body: leaveConsequence(channel),
          }
  if (mute === null && leave === null) return null
  return { id: `row-menu-${conversation.id}`, label: strings.conversationMore({ name: title }), mute, leave }
}

const faceOf = (
  input: SidebarInput,
  conversation: AsRead.Conversation,
  others: ReadonlyArray<MemberId>,
): ConversationRow['face'] => {
  const people = others.map((id) => input.members.get(id))
  if (conversation.kind !== 'direct' && people.length > 1)
    return { kind: 'group', ...groupAvatarOf(people, input.charactersOn) }
  const arrived = input.arrived.has(conversation.id) && !isMuted(conversation)
  const owner = spriteOwner({
    kind: 'conversation',
    viewerId: input.me.member.id,
    participantIds: conversation.participantIds,
    arrivedFrom: arrived ? (conversation.lastNote?.authorId ?? null) : null,
  }) as MemberId
  return {
    kind: 'member',
    avatar: memberAvatarOf(input.members.get(owner), input.charactersOn, {
      labelled: false,
      ...(arrived && { state: 'new-note', motion: 'once' }),
    }),
  }
}
