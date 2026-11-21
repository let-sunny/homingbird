import type { AsRead, ChannelMember, ConversationId, MemberId } from '@homingbird/protocol'

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

export const similarChannels = (channels: ReadonlyArray<AsRead.Channel>, typed: string): AsRead.Channel[] => {
  const wanted = slugFrom(typed).replace(/-+$/, '')
  if (wanted === '') return []
  return channels
    .filter((channel) => channel.slug.includes(wanted) || wanted.includes(channel.slug))
    .sort((a, b) => Number(b.slug === wanted) - Number(a.slug === wanted) || a.slug.localeCompare(b.slug))
}

export const channelNamed = (channels: ReadonlyArray<AsRead.Channel>, slug: string): AsRead.Channel | null =>
  channels.find((channel) => channel.slug === slug) ?? null

export const channelOfRoom = (
  channels: ReadonlyArray<AsRead.Channel>,
  conversationId: ConversationId,
): AsRead.Channel | null => channels.find((channel) => channel.conversationId === conversationId) ?? null

export const channelRooms = (conversations: ReadonlyArray<AsRead.Conversation>): AsRead.Conversation[] =>
  conversations
    .filter((conversation) => conversation.kind === 'channel' && !isArchivedRoom(conversation))
    .sort(byTitle)

export const archivedRooms = (conversations: ReadonlyArray<AsRead.Conversation>): AsRead.Conversation[] =>
  conversations.filter(isArchivedRoom).sort(byTitle)

export const peopleConversations = (
  conversations: ReadonlyArray<AsRead.Conversation>,
): AsRead.Conversation[] =>
  conversations.filter((conversation) => conversation.kind !== 'channel' && !isArchivedRoom(conversation))

export const joinedFirst = (a: AsRead.Channel, b: AsRead.Channel): number =>
  Number(b.joined) - Number(a.joined) || b.memberCount - a.memberCount || a.slug.localeCompare(b.slug)

export const destinationsFrom = (
  channels: ReadonlyArray<AsRead.Channel>,
  here: AsRead.Channel | null,
  movingFrom: AsRead.Channel | null,
): AsRead.Channel[] =>
  channels
    .filter((channel) => channel.slug !== here?.slug && mayMoveBetween(movingFrom, channel))
    .sort(joinedFirst)

export const mayMoveBetween = (from: AsRead.Channel | null, to: AsRead.Channel): boolean =>
  from !== null && isPrivate(from) ? isPrivate(to) && to.joined : !isPrivate(to) || to.joined

export const isPrivate = (channel: AsRead.Channel): boolean => channel.visibility === 'private'

export const withChannel = (
  channels: ReadonlyArray<AsRead.Channel>,
  changed: AsRead.Channel,
): AsRead.Channel[] =>
  channels.some((channel) => channel.slug === changed.slug)
    ? channels.map((channel) => (channel.slug === changed.slug ? changed : channel))
    : [...channels, changed].sort((a, b) => a.slug.localeCompare(b.slug))

export const withoutRoom = (
  channels: ReadonlyArray<AsRead.Channel>,
  conversationId: ConversationId,
  viewerIsAdmin: boolean,
): AsRead.Channel[] =>
  channels.flatMap((channel) =>
    channel.conversationId !== conversationId
      ? [channel]
      : isPrivate(channel) && !viewerIsAdmin
        ? []
        : [{ ...channel, joined: false, answering: false, managing: viewerIsAdmin && !isPrivate(channel) }],
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

/**
 * The channels' agents as members, so that a note one wrote shows its name: they are not in the directory,
 * which lists people.
 */
export const agentMembersOf = (
  channels: ReadonlyArray<AsRead.Channel>,
): ReadonlyArray<readonly [MemberId, AsRead.Member]> =>
  channels.flatMap(({ agent, createdAt }) =>
    agent === undefined || agent === null
      ? []
      : [
          [
            agent.id,
            {
              id: agent.id,
              email: '',
              name: agent.name,
              profile: '',
              role: 'member',
              status: 'active',
              kind: 'channel_agent',
              createdAt,
              character: null,
            },
          ] as const,
        ],
  )

export interface Roster {
  readonly memberCount: number
  readonly members: ReadonlyArray<ChannelMember>
}

export interface RosterFacts {
  /** A manager stays in the room while they are in its managing group. */
  readonly viewerIsManager: boolean
}

export const rosterFacts = (roster: Roster | null, viewerId: MemberId | null): RosterFacts => {
  const managers = (roster?.members ?? []).filter((member) => member.manager)
  return { viewerIsManager: managers.some((member) => member.memberId === viewerId) }
}

const isArchivedRoom = (conversation: AsRead.Conversation): boolean => conversation.archivedAt !== null

const byTitle = (a: AsRead.Conversation, b: AsRead.Conversation): number =>
  (a.title ?? '').localeCompare(b.title ?? '')

const SLUG_MAX = 40
const CHIPS_SHOWN = 6
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
