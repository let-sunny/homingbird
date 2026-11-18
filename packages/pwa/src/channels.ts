import type { Channel, ChannelMember, Conversation, ConversationId, MemberId } from '@homingbird/protocol'

export const channelLabel = (slug: string): string => `#${slug}`

export const slugFrom = (typed: string): string =>
  typed
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)

export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug)

export const similarChannels = (channels: ReadonlyArray<Channel>, typed: string): Channel[] => {
  const wanted = slugFrom(typed).replace(/-+$/, '')
  if (wanted === '') return []
  return channels
    .filter((channel) => channel.slug.includes(wanted) || wanted.includes(channel.slug))
    .sort((a, b) => Number(b.slug === wanted) - Number(a.slug === wanted) || a.slug.localeCompare(b.slug))
}

export const channelNamed = (channels: ReadonlyArray<Channel>, slug: string): Channel | null =>
  channels.find((channel) => channel.slug === slug) ?? null

export const channelOfRoom = (
  channels: ReadonlyArray<Channel>,
  conversationId: ConversationId,
): Channel | null => channels.find((channel) => channel.conversationId === conversationId) ?? null

export const channelRooms = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations
    .filter((conversation) => conversation.kind === 'channel' && !isArchivedRoom(conversation))
    .sort(byTitle)

export const archivedRooms = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations.filter(isArchivedRoom).sort(byTitle)

export const peopleConversations = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations.filter((conversation) => conversation.kind !== 'channel' && !isArchivedRoom(conversation))

export const joinedFirst = (a: Channel, b: Channel): number =>
  Number(b.joined) - Number(a.joined) || b.memberCount - a.memberCount || a.slug.localeCompare(b.slug)

export const destinationsFrom = (
  channels: ReadonlyArray<Channel>,
  here: Channel | null,
  movingFrom: Channel | null,
): Channel[] =>
  channels
    .filter((channel) => channel.slug !== here?.slug && mayMoveBetween(movingFrom, channel))
    .sort(joinedFirst)

export const mayMoveBetween = (from: Channel | null, to: Channel): boolean =>
  from !== null && isPrivate(from) ? isPrivate(to) && to.joined : !isPrivate(to) || to.joined

export const isPrivate = (channel: Channel): boolean => channel.visibility === 'private'

export const withChannel = (channels: ReadonlyArray<Channel>, changed: Channel): Channel[] =>
  channels.some((channel) => channel.slug === changed.slug)
    ? channels.map((channel) => (channel.slug === changed.slug ? changed : channel))
    : [...channels, changed].sort((a, b) => a.slug.localeCompare(b.slug))

export const withoutRoom = (
  channels: ReadonlyArray<Channel>,
  conversationId: ConversationId,
  viewerIsAdmin: boolean,
): Channel[] =>
  channels.flatMap((channel) =>
    channel.conversationId !== conversationId
      ? [channel]
      : isPrivate(channel) && !viewerIsAdmin
        ? []
        : [{ ...channel, joined: false, answering: false, managing: viewerIsAdmin }],
  )

export const chipsForPerson = (
  theirs: ReadonlyArray<string>,
  mine: ReadonlySet<string>,
  shown = CHIPS_SHOWN,
): { readonly first: string[]; readonly rest: string[] } => {
  const ordered = [...theirs].sort((a, b) => Number(mine.has(b)) - Number(mine.has(a)))
  const keep = ordered.length > shown + 1 ? shown : ordered.length
  return { first: ordered.slice(0, keep), rest: ordered.slice(keep) }
}

export interface Roster {
  readonly memberCount: number
  readonly members: ReadonlyArray<ChannelMember>
}

export interface RosterFacts {
  readonly hasManager: boolean
  readonly lastManagerId: MemberId | null
  readonly viewerIsLastManager: boolean
}

export const rosterFacts = (roster: Roster | null, viewerId: MemberId | null): RosterFacts => {
  const managers = (roster?.members ?? []).filter((member) => member.manager)
  const lastManagerId = managers.length === 1 ? managers[0]!.memberId : null
  return {
    hasManager: managers.length > 0,
    lastManagerId,
    viewerIsLastManager:
      lastManagerId !== null && lastManagerId === viewerId && (roster?.members.length ?? 0) > 1,
  }
}

const isArchivedRoom = (conversation: Conversation): boolean => conversation.archivedAt !== null

const byTitle = (a: Conversation, b: Conversation): number => (a.title ?? '').localeCompare(b.title ?? '')

const SLUG_MAX = 40
const CHIPS_SHOWN = 6
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
