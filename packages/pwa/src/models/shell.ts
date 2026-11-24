import type { AsRead, MemberId } from '@homingbird/protocol'
import { archivedRooms, channelLabel, channelOfRoom, channelRooms, peopleConversations } from '../channels.ts'
import { featureOn } from '../features.ts'
import type { HintConcept } from '../hints.ts'
import { type Route, hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt, isHidden, isMuted, otherParticipants } from '../thread.ts'
import { type AvatarModel, type GroupAvatarModel, groupAvatarOf, memberAvatarOf } from './avatar.ts'
import { reviewBadgeOf } from './channel-agent.ts'
import { leaveConsequence, leaveRefusal } from './channel-membership.ts'
import { type ConversationActions, conversationActionsModel, offersAny } from './conversation-actions.ts'
import { type MuteToggle, muteToggleModel } from './mute-toggle.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * The header's tabs, the current one marked; Flocks only where the organization has it. My agent
 * carries a mark while the person's agent cannot answer, named by `agentUnavailable`. On a phone the
 * same tabs are the bar at the bottom of the screen, each word under its glyph.
 */
export const tabsModel = (
  route: Route,
  info: AsRead.ServerInfo | null,
  agentUnavailable: string | null = null,
): ReadonlyArray<Tab> => [
  tab(strings.navNotes, { name: 'home' }, ['home', 'conversation'], route, { glyph: 'notes' }),
  {
    ...tab(strings.navMyAgent, { name: 'agent', section: null }, ['agent'], route, {
      glyph: 'agent',
      tour: 'connect',
      hint: { concept: 'nest', text: strings.hints.nest },
    }),
    mark: agentUnavailable,
  },
  tab(strings.navPeople, { name: 'people' }, ['people', 'group'], route, {
    glyph: 'people',
    hint: { concept: 'keepers', text: strings.hints.keepers },
  }),
  tab(strings.channels, { name: 'channels' }, ['channels', 'channel', 'channel-agent'], route, {
    glyph: 'channels',
    tour: 'channels',
  }),
  ...(featureOn('debateRooms', info)
    ? [
        tab(strings.navDebates, { name: 'debates' }, ['debates', 'debate'], route, {
          glyph: 'debates',
          hint: { concept: 'flocksTab', text: strings.hints.flocksTab },
        }),
      ]
    : []),
]

/**
 * Whether the phone's tab bar is shown: not inside an open conversation, where Back returns to the list
 * and the composer and the approval card keep the bottom of the screen to themselves.
 */
export const tabBarFor = (route: Route): 'shown' | 'hidden' =>
  route.name === 'conversation' ? 'hidden' : 'shown'

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

/**
 * The sidebar: direct notes, channel rooms and archived rooms, each as rows. It invites connecting an
 * agent while none is, once a conversation exists; before that, the first steps on home say the same.
 * With the Waiting for you filter on, only the conversations the activity panel lists are shown, and no
 * archived room.
 */
export const sidebarModel = (input: SidebarInput): SidebarModel => {
  const waitingOnly = input.waitingOnly ?? null
  const shown = (rooms: AsRead.Conversation[]): AsRead.Conversation[] =>
    waitingOnly === null ? rooms : rooms.filter((room) => waitingOnly.has(room.id))
  const people = peopleConversations(input.conversations).filter((conversation) => !isHidden(conversation))
  const archived = waitingOnly === null ? archivedRooms(input.conversations) : []
  const row = (conversation: AsRead.Conversation): ConversationRow => conversationRow(input, conversation)
  const peopleShown = shown(people)
  return {
    onboarding: input.agentCount === 0 && input.loaded && input.conversations.length > 0,
    people: !input.loaded
      ? { kind: 'loading' }
      : people.length === 0
        ? { kind: 'none' }
        : peopleShown.length === 0
          ? { kind: 'nothing-waits', text: strings.waiting.peopleNone }
          : { kind: 'rows', rows: peopleShown.map(row) },
    channelRooms: shown(channelRooms(input.conversations)).map(row),
    channelRoomsEmpty: waitingOnly === null ? strings.noChannelRooms : strings.waiting.roomsNone,
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

/** The words of the link that skips past the header and the list to the composer, in a conversation. */
export const skipLinkModel = (route: Route): string | null =>
  route.name === 'conversation' ? strings.skipToComposer : null

export interface Tab {
  readonly label: string
  readonly href: string
  readonly current: boolean
  readonly tour: string | null
  /** A state the tab's page tells about, as a small mark with these words for assistive technology. */
  readonly mark: string | null
  /** A one-line hint of what the tab holds, shown while the person is new. */
  readonly hint: TabHint | null
  /** The picture over the word in the phone's tab bar. */
  readonly glyph: TabGlyph | null
}

export interface TabHint {
  readonly concept: HintConcept
  readonly text: string
}

export type TabGlyph = 'notes' | 'agent' | 'people' | 'channels' | 'debates'

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
  readonly hideOn: boolean
  readonly leaveOn: boolean
  readonly now: number
  /** The conversations whose row plays a note's arrival now; a muted one never does. */
  readonly arrived: ReadonlySet<string>
  /** The conversations whose composer holds text the person has not sent. */
  readonly typedIn: ReadonlySet<string>
  /** With the Waiting for you filter on, the conversations that wait for the person. */
  readonly waitingOnly?: ReadonlySet<string> | null
}

export interface SidebarModel {
  readonly onboarding: boolean
  readonly people:
    | { readonly kind: 'loading' }
    | { readonly kind: 'none' }
    | { readonly kind: 'nothing-waits'; readonly text: string }
    | { readonly kind: 'rows'; readonly rows: ReadonlyArray<ConversationRow> }
  readonly channelRooms: ReadonlyArray<ConversationRow>
  /** What the channel list says when it has no row to show. */
  readonly channelRoomsEmpty: string
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
  /** The pencil and count, with a word a touch screen shows beside them, where no hover explains them. */
  readonly drafts: { readonly text: string; readonly label: string; readonly word: string } | null
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
    /** Hiding the row, leaving its group and starting a new group with its people. */
    readonly place: ConversationActions
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
  shown: { readonly glyph?: TabGlyph; readonly tour?: string; readonly hint?: TabHint } = {},
): Tab => ({
  label,
  href: hrefFor(target),
  current: activeFor.includes(route.name),
  tour: shown.tour ?? null,
  mark: null,
  hint: shown.hint ?? null,
  glyph: shown.glyph ?? null,
})

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
            word: strings.draftsShort({ count: conversation.draftCount }),
          }
        : null,
    typed: input.typedIn.has(conversation.id) && !archived ? { text: '✎', label: strings.unsentText } : null,
    review: review === null ? null : { text: review.text, label: review.label },
    mute,
    menu: rowMenu(
      conversation,
      title,
      channel,
      mute,
      conversationActionsModel({
        conversation,
        title,
        viewerId,
        hideOn: input.hideOn,
        leaveOn: input.leaveOn,
      }),
    ),
  }
}

/**
 * A row's own menu: muting it, leaving a channel the person joined, and hiding, leaving or starting
 * again a direct or group message; none when it offers nothing.
 */
const rowMenu = (
  conversation: AsRead.Conversation,
  title: string,
  channel: AsRead.Channel | null,
  mute: MuteToggle | null,
  place: ConversationActions,
): ConversationRow['menu'] => {
  const refusal = channel === null ? null : leaveRefusal(channel, null, null)
  const leave: RowLeave | null =
    channel === null || !channel.joined || conversation.archivedAt !== null
      ? null
      : refusal !== null
        ? { kind: 'blocked', slug: channel.slug, reason: refusal }
        : {
            kind: 'allowed',
            slug: channel.slug,
            title: strings.leaveChannelTitle({ channel: channelLabel(channel.slug) }),
            body: leaveConsequence(channel),
          }
  if (mute === null && leave === null && !offersAny(place)) return null
  return {
    id: `row-menu-${conversation.id}`,
    label: strings.conversationMore({ name: title }),
    mute,
    leave,
    place,
  }
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
