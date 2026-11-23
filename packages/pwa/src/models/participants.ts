import type { AsRead, MemberId } from '@homingbird/protocol'
import { channelLabel, channelOfRoom } from '../channels.ts'
import { listOf, strings } from '../strings.ts'

/**
 * Everyone in a conversation, each by name with what they are here: the person first, then whoever asked
 * a private question, the channel's agent and its managers, then the rest. A private question also says
 * that whoever manages its channel later joins it. It lists only the participants the server named.
 */
export const conversationParticipants = (input: ParticipantsInput): Participants => {
  const { conversation, viewerId } = input
  const slug = channelSlugOf(conversation, input.channels)
  const channel = slug === null ? null : (input.channels.find((each) => each.slug === slug) ?? null)
  const managers = new Set(conversation.managerIds ?? [])
  const managerRole = slug === null ? null : strings.participants.manager({ channel: channelLabel(slug) })
  const ranked = conversation.participantIds.map((memberId) => {
    const member = input.members.get(memberId)
    const isAgent = memberId === channel?.agent?.id || member?.kind === 'channel_agent'
    const isAsker = memberId === conversation.askedBy
    const isManager = managerRole !== null && managers.has(memberId)
    const row: ParticipantRow = {
      memberId,
      name: member?.name ?? strings.formerMember,
      you: memberId === viewerId,
      roles: [
        ...(isAsker ? [strings.participants.asker] : []),
        ...(isAgent ? [agentRole(slug)] : []),
        ...(isManager ? [managerRole] : []),
      ],
    }
    return { row, rank: memberId === viewerId ? 0 : isAsker ? 1 : isAgent ? 2 : isManager ? 3 : 4 }
  })
  const people = ranked.sort((a, b) => a.rank - b.rank).map((each) => each.row)
  return {
    id: `people-${conversation.id}`,
    label: strings.groupPeople({ count: people.length }),
    title:
      conversation.kind === 'channel' && slug !== null
        ? strings.participants.inChannel({ channel: channelLabel(slug) })
        : strings.participants.title,
    summary: listOf(people.map((person) => person.name)),
    people,
    note:
      conversation.privateQuestionOf != null && conversation.archivedAt === null
        ? strings.participants.laterManagers({ channel: channelLabel(conversation.privateQuestionOf) })
        : null,
  }
}

/** The agents taking part in a flock, each named with the person it takes part for. */
export const debateParticipants = (
  debate: AsRead.Debate,
  viewerId: MemberId,
  nameOf: (memberId: MemberId) => string,
): Participants => {
  const people = [...debate.participants]
    .sort((a, b) => Number(b.memberId === viewerId) - Number(a.memberId === viewerId))
    .map(
      (participant): ParticipantRow => ({
        memberId: participant.memberId,
        name: nameOf(participant.memberId),
        you: participant.memberId === viewerId,
        roles: [
          strings.participants.takesPartThrough({ agent: participant.agentName }),
          ...(participant.memberId === debate.createdBy ? [strings.participants.openedRoom] : []),
        ],
      }),
    )
  return {
    id: `people-${debate.id}`,
    label: strings.groupPeople({ count: people.length }),
    title: strings.participants.inRoom,
    summary: listOf(people.map((person) => person.name)),
    people,
    note: null,
  }
}

export interface ParticipantsInput {
  readonly conversation: AsRead.Conversation
  readonly viewerId: MemberId
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly channels: ReadonlyArray<AsRead.Channel>
}

export interface Participants {
  /** The id of the list, which the head's names and count open. */
  readonly id: string
  /** How many are in it, on the button that opens the list. */
  readonly label: string
  readonly title: string
  /** Every name in one sentence, as a hint on the button. */
  readonly summary: string
  readonly people: ReadonlyArray<ParticipantRow>
  /** Who else will read along later, when someone will. */
  readonly note: string | null
}

export interface ParticipantRow {
  readonly memberId: MemberId
  readonly name: string
  readonly you: boolean
  readonly roles: ReadonlyArray<string>
}

const agentRole = (slug: string | null): string =>
  slug === null
    ? strings.participants.agent
    : strings.participants.channelAgent({ channel: channelLabel(slug) })

/** The channel a room belongs to: its own room, or the one a private question was asked in. */
const channelSlugOf = (
  conversation: AsRead.Conversation,
  channels: ReadonlyArray<AsRead.Channel>,
): string | null => {
  if (conversation.privateQuestionOf !== undefined) return conversation.privateQuestionOf
  if (conversation.kind !== 'channel') return null
  return channelOfRoom(channels, conversation.id)?.slug ?? null
}
