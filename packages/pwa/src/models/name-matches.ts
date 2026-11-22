import { type AsRead, type MemberId, isPerson } from '@homingbird/protocol'
import { channelLabel, isPrivate } from '../channels.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { conversationTitle, isArchived } from '../thread.ts'

/**
 * The people, channels and group messages whose name holds what was typed, read only from the lists
 * the client already holds, so nothing appears that the server did not show the person: a private
 * channel only when they are in it, a conversation only when they take part. Names that start with
 * what was typed come first.
 */
export const nameMatches = (input: NameMatchInput): NameMatches => {
  const needle = normalized(input.query).replace(/^#+/, '')
  if (needle === '') return { people: [], channels: [], rooms: [] }
  return {
    people: ranked(
      needle,
      input.directory
        .filter(
          ({ member }) => isPerson(member) && member.status === 'active' && member.id !== input.viewerId,
        )
        .map((entry) => ({
          match: personMatch(input, entry),
          names: [entry.member.name, entry.member.email],
        })),
    ),
    channels: ranked(
      needle,
      input.channels
        .filter((channel) => !isPrivate(channel) || channel.joined)
        .map((channel) => ({ match: channelMatch(channel), names: [channel.slug] })),
    ),
    rooms: ranked(
      needle,
      input.conversations
        .filter((room) => room.kind === 'group')
        .map((room) => {
          const match = roomMatch(input, room)
          const people = room.participantIds.flatMap((id) =>
            id === input.viewerId ? [] : [input.members.get(id)?.name ?? ''],
          )
          return { match, names: [match.label, ...people] }
        }),
    ),
  }
}

/** A conversation row as the switcher lists it: a channel's room, a group, or a direct message. */
export const roomMatch = (
  input: Pick<NameMatchInput, 'members' | 'viewerId'>,
  room: AsRead.Conversation,
): NameMatch => ({
  key: `room:${room.id}`,
  kind: room.kind === 'channel' ? 'channel' : 'room',
  label: conversationTitle(room, input.members, input.viewerId, strings.formerMember),
  detail: isArchived(room) ? strings.switcher.archived : null,
  target: { kind: 'href', href: hrefFor({ name: 'conversation', id: room.id, draft: null }) },
})

export interface NameMatchInput {
  readonly query: string
  readonly viewerId: MemberId
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
}

export interface NameMatches {
  readonly people: ReadonlyArray<NameMatch>
  readonly channels: ReadonlyArray<NameMatch>
  readonly rooms: ReadonlyArray<NameMatch>
}

export interface NameMatch {
  readonly key: string
  readonly kind: 'person' | 'channel' | 'room' | 'waiting'
  readonly label: string
  readonly detail: string | null
  /** A place to go, or a direct message to start with someone the person has none with yet. */
  readonly target:
    | { readonly kind: 'href'; readonly href: string }
    | { readonly kind: 'message'; readonly memberId: MemberId }
}

/** How many matches of each kind are shown. */
export const MATCHES_SHOWN = 6

const personMatch = (input: NameMatchInput, entry: AsRead.DirectoryEntry): NameMatch => {
  const direct = input.conversations.find(
    (room) => room.kind === 'direct' && !isArchived(room) && room.participantIds.includes(entry.member.id),
  )
  return {
    key: `person:${entry.member.id}`,
    kind: 'person',
    label: entry.member.name,
    detail: direct === undefined && entry.canMessage ? strings.switcher.startMessage : entry.member.email,
    target:
      direct !== undefined
        ? { kind: 'href', href: hrefFor({ name: 'conversation', id: direct.id, draft: null }) }
        : entry.canMessage
          ? { kind: 'message', memberId: entry.member.id }
          : { kind: 'href', href: hrefFor({ name: 'people' }) },
  }
}

const channelMatch = (channel: AsRead.Channel): NameMatch => ({
  key: `channel:${channel.slug}`,
  kind: 'channel',
  label: channelLabel(channel.slug),
  detail: channel.joined ? channel.description || null : strings.switcher.notJoined,
  target: {
    kind: 'href',
    href: channel.joined
      ? hrefFor({ name: 'conversation', id: channel.conversationId, draft: null })
      : hrefFor({ name: 'channel', slug: channel.slug }),
  },
})

const ranked = (
  needle: string,
  candidates: ReadonlyArray<{ readonly match: NameMatch; readonly names: ReadonlyArray<string> }>,
): NameMatch[] =>
  candidates
    .flatMap(({ match, names }) => {
      const found = names.map(normalized)
      if (!found.some((name) => name.includes(needle))) return []
      return [{ match, starts: found.some((name) => name.startsWith(needle)) }]
    })
    .sort(
      (one, other) =>
        Number(other.starts) - Number(one.starts) || one.match.label.localeCompare(other.match.label),
    )
    .slice(0, MATCHES_SHOWN)
    .map(({ match }) => match)

const normalized = (text: string): string => text.normalize('NFKC').trim().toLocaleLowerCase()
