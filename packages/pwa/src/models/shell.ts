import type { AsRead, MemberId, Presence } from '@homingbird/protocol'
import { archivedRooms, channelOfRoom, channelRooms, peopleConversations } from '../channels.ts'
import { featureOn } from '../features.ts'
import { type Route, hrefFor } from '../routes.ts'
import { spriteOwner } from '../sprite-owner.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt, otherParticipants } from '../thread.ts'
import { type AvatarModel, groupAvatarOf, memberAvatarOf } from './avatar.ts'
import { type TimeShown, timeShown } from './time.ts'

/** The header's tabs, the current one marked; Debates only where the organization has it. */
export const tabsModel = (route: Route, info: AsRead.ServerInfo | null): ReadonlyArray<Tab> => [
  tab(strings.navNotes, { name: 'home' }, ['home', 'conversation'], route),
  tab(strings.navMyAgent, { name: 'agent', section: null }, ['agent'], route, 'connect'),
  tab(strings.navPeople, { name: 'people' }, ['people'], route),
  tab(strings.channels, { name: 'channels' }, ['channels', 'channel'], route, 'channels'),
  ...(featureOn('debateRooms', info)
    ? [tab(strings.navDebates, { name: 'debates' }, ['debates', 'debate'], route)]
    : []),
  tab(strings.navSearch, { name: 'search', query: '' }, ['search'], route),
]

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
  readonly agentCount: number
  readonly charactersOn: boolean
  readonly now: number
  /** The conversations whose row plays a note's arrival now. */
  readonly arrived: ReadonlySet<string>
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
    | { readonly kind: 'group'; readonly faces: ReadonlyArray<AvatarModel> }
    | { readonly kind: 'member'; readonly avatar: AvatarModel }
  readonly title: string
  readonly presence: Presence | null
  readonly archived: boolean
  readonly channel: { readonly memberCount: number; readonly helperCount: number } | null
  readonly preview: string
  readonly time: TimeShown | null
  readonly unread: { readonly count: number; readonly label: string } | null
  readonly drafts: { readonly text: string; readonly label: string } | null
}

const tab = (
  label: string,
  target: Route,
  activeFor: ReadonlyArray<Route['name']>,
  route: Route,
  tour: string | null = null,
): Tab => ({ label, href: hrefFor(target), current: activeFor.includes(route.name), tour })

const isOpen = (route: Route, conversation: AsRead.Conversation): boolean =>
  route.name === 'conversation' && route.id === conversation.id

const conversationRow = (input: SidebarInput, conversation: AsRead.Conversation): ConversationRow => {
  const viewerId = input.me.member.id
  const others = otherParticipants(conversation, viewerId)
  const archived = conversation.archivedAt !== null
  const channel = conversation.kind === 'channel' ? channelOfRoom(input.channels, conversation.id) : null
  const last = conversation.lastNote
  return {
    id: conversation.id,
    href: hrefFor({ name: 'conversation', id: conversation.id }),
    current: isOpen(input.route, conversation),
    face:
      conversation.kind === 'channel' || archived ? { kind: 'channel' } : faceOf(input, conversation, others),
    title: conversationTitle(conversation, input.members, viewerId, strings.formerMember),
    presence:
      conversation.kind === 'direct'
        ? (input.directory.find((entry) => entry.member.id === others[0])?.presence ?? null)
        : null,
    archived,
    channel,
    preview:
      last !== null
        ? excerpt(last.body, 60)
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
  }
}

const faceOf = (
  input: SidebarInput,
  conversation: AsRead.Conversation,
  others: ReadonlyArray<MemberId>,
): ConversationRow['face'] => {
  const people = others.map((id) => input.members.get(id))
  if (conversation.kind !== 'direct' && people.length > 1)
    return { kind: 'group', faces: groupAvatarOf(people, input.charactersOn) }
  const arrived = input.arrived.has(conversation.id)
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
